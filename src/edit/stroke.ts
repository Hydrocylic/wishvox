// r04 T6（A2）：笔刷一笔状态机 + 预览——自 edit/editor.ts 迁出。
// D1 消重：旧版 strokeApply（手动，逐锚点）与 aiBrush（AI，整批）各有一份
// "逐锚点 applyBrush → 缓冲去重 → 旁路直写 → 归属 assign/unassign"近同 40 行——合并为
// applyBrushBatch 一份实现，手动路径（增量渲染）与 AI 路径（批量后一次渲染）共用；
// D2 消重：一笔标签拼串（放置 WxHxL（替换/增量）/ 擦除 / 上色）合并为 strokeLabel。
import { coordKey } from '../core/coords'
import { applyBrush } from '../core/brush/apply'
import type { BrushRejections } from '../core/brush/apply'
import type { LayerFilter } from '../core/brush/predicate'
import type { PatchLog } from '../core/patch-log'
import type { Coord, StrokeOp, VoxelChange } from '../core/types'
import type { Volume } from '../core/volume'
import type { PartRegistry } from '../core/parts'
import type { AutoSaver } from '../io/autosave'
import { setUi, useEditorUi } from '../state/editor-store'
import { nextPreviewReject, rejectKindOf } from '../state/preview-warning'
import type { PreviewRejectKind } from '../state/preview-warning'
import { commitColorTx, currentColorHex, newColorTx, rollbackColorTx, txKeyForColor } from './color'
import type { ColorTx } from './color'
import type { EditorRenderer } from './render-port'

/** 一笔的拒绝原因计数（可变——BrushRejections 是只读返回面，这里累积用） */
interface StrokeRejectTally {
  hidden: number
  occupied: number
  empty: number
  unchanged: number
  /** REQ-059（r03）：y<0 越界丢弃计数（回执可见） */
  outOfBounds: number
}

export function emptyStrokeRejects(): StrokeRejectTally {
  return { hidden: 0, occupied: 0, empty: 0, unchanged: 0, outOfBounds: 0 }
}

/** 一笔的旁路缓冲：每格首触时捕获落笔前键值与归属（commitStroke 的 changes / ownersBefore 来源） */
export interface StrokeCell {
  x: number
  y: number
  z: number
  before: number
  after: number
  ownerBefore: string | null
}

interface BrushBatchParams {
  size: Coord
  action: 'place' | 'erase' | 'paint'
  mode: 'additive' | 'override'
  key: number
}

/**
 * D1 合并后的锚点批应用核心（r04 T6）：逐锚点 applyBrush → 拒绝计数 → 缓冲去重合并 →
 * 旁路直写模型与归属（所见即所得，V8 ①：拖动期间旁路累积、松手才提交补丁）。
 * 结果并入调用方给的 buffer / rejected（手动路径跨多次 apply 累积成一笔；AI 路径一次性整批）。
 * 返回本次**实际经过的变更**（手动路径的增量渲染输入；AI 路径忽略、提交后一次渲染）。
 */
export function applyBrushBatch(
  volume: Volume,
  parts: PartRegistry,
  buffer: Map<string, StrokeCell>,
  rejected: StrokeRejectTally,
  anchors: readonly Coord[],
  params: BrushBatchParams,
  filter: LayerFilter | null,
  partId: string | null,
): VoxelChange[] {
  const applied: VoxelChange[] = []
  for (const anchor of anchors) {
    const result = applyBrush(
      volume,
      { size: params.size, anchor, action: params.action, mode: params.mode, key: params.key },
      filter,
    )
    for (const r of ['hidden', 'occupied', 'empty', 'unchanged', 'outOfBounds'] as const) {
      rejected[r] += result.rejected[r]
    }
    for (const c of result.changes) {
      const k = coordKey(c.x, c.y, c.z)
      let cell = buffer.get(k)
      if (!cell) {
        cell = { x: c.x, y: c.y, z: c.z, before: c.before, after: c.after, ownerBefore: parts.partIdOf(c.x, c.y, c.z) ?? null }
        buffer.set(k, cell)
      } else {
        cell.after = c.after
      }
      volume.setBlock(c.x, c.y, c.z, c.after)
      if (c.after === 0) parts.unassign(c.x, c.y, c.z)
      else if (c.before === 0 && partId && parts.get(partId)) parts.assign(c.x, c.y, c.z, partId)
      applied.push(c)
    }
  }
  return applied
}

/** D2 合并的一笔标签（手动路径与 AI 路径同一拼法） */
export function strokeLabel(action: 'place' | 'erase' | 'paint', mode: 'additive' | 'override', size: Coord): string {
  const sizeLabel = `${size.x}×${size.y}×${size.z}`
  return action === 'place'
    ? `放置 ${sizeLabel}（${mode === 'override' ? '替换' : '增量'}）`
    : action === 'erase'
      ? `擦除 ${sizeLabel}`
      : `上色 ${sizeLabel}`
}

// ── REQ-063（r05 件三）：笔刷预览的"关键块"标识（纯函数，无渲染层依赖 ⇒ L1 可测）──

/** 预览的两组格子：关键块（锚点格 = 最小角格）与其余（附属块）。
 *  `cells` = **完整预览集合**（= 笔刷体积 ∩ 既有单一谓词，`REQ-055` 不动项；渲染层据此画附属色）。
 *  `keyCells` = 其中**锚点格**那一格（≤1）——锚点自身被过滤（隐藏层 / 已占用增量 / 空格擦除·上色）时为空。 */
interface BrushPreviewState {
  readonly cells: Coord[]
  readonly keyCells: Coord[]
  /** P2（A-02/A-04）：拒绝原因计数——预览为空时给"为什么"的可读原因，不另算一份谓词 */
  readonly rejected: BrushRejections
}

/**
 * `REQ-063` 的判定正本（P2 起与落笔**同一实现**）：可写性直接复用 `applyBrush`——预览与实际写入
 * 共用同一份数域检查、层可见判定与 before==after 零差分口径 ⇒ 二者逐格恒等（A-02"同源预览"）。
 * 口径：关键块 = 笔刷体积的**锚点格 = 最小角格**（`brushVolume` 以 anchor 为最小角向 +x/+y/+z 延伸）；
 * 锚点语义由调用方给（放置 = `hit.adjacent` / 擦除·上色 = `hit.cell`），本函数不做工具分支。
 */
export function brushPreviewState(
  volume: Volume,
  size: Coord,
  anchor: Coord,
  action: 'place' | 'erase' | 'paint',
  override: boolean,
  filter: LayerFilter | null,
  key = 1,
): BrushPreviewState {
  const result = applyBrush(volume, { size, anchor, action, mode: override ? 'override' : 'additive', key }, filter)
  const cells = result.changes.map(({ x, y, z }) => ({ x, y, z }))
  return {
    cells,
    keyCells: cells.filter((c) => c.x === anchor.x && c.y === anchor.y && c.z === anchor.z),
    rejected: result.rejected,
  }
}

/** StrokeSession 的宿主端口：Editor 提供的服务子集（结构匹配，Editor 隐式实现） */
interface StrokeHost {
  readonly volume: Volume
  readonly parts: PartRegistry
  readonly log: PatchLog
  readonly autosave: AutoSaver
  /** `REQ-027`：预览用键——已存在则复用，不存在给哨兵（悬停不得分配持久键） */
  previewColorKey(): number
  currentLayerFilter(): LayerFilter | null
  readonly selectedPartId: string | null
  /** 渲染层实例（预览 / 增量重建出口） */
  readonly renderer: EditorRenderer | null
  /** 渲染层增量重建入口（applyChanges + onModelChanged；F1 目标点重算） */
  renderChanges(changes: readonly VoxelChange[]): void
  /** 外观与 UI 投影刷新（不改模型 ⇒ 不进自动保存） */
  refreshViews(): void
}

/**
 * 笔刷一笔（F7/V8）：按下→涂抹→松手的状态机 + 虚方块预览。
 * Editor 的 strokeBegin/strokeApply/strokeCommit/strokeCancel 与 previewAt/clearPreview
 * 是本类的一行委托（facade 不变）。
 */
export class StrokeSession {
  private buffer: Map<string, StrokeCell> | null = null
  private op: StrokeOp | null = null
  private rejects: StrokeRejectTally = emptyStrokeRejects()
  /** `REQ-027` 门四：本笔的写入键（**落笔快照**——笔中途改色不影响这一笔） */
  private key = 0
  /** 本笔的颜色事务：只在真正写入前 intern；取消 / 零变化时回收未落账的新键 */
  private colorTx: ColorTx | null = null

  constructor(private readonly host: StrokeHost) {}

  /** 一笔进行中（Editor 的写入口守卫与打断逻辑读它） */
  get active(): boolean {
    return this.buffer !== null
  }

  /** 落笔。检视态拒绝（V10 读回断言）；一笔进行中拒绝并发起笔；吸管不是笔刷动作。 */
  begin(): boolean {
    if (this.buffer) return false
    const s = useEditorUi.getState()
    if (s.mode !== 'edit') {
      setUi({ message: '检视态不可编辑：顶栏切到「编辑」后再使用笔刷' })
      return false
    }
    if (s.tool === 'pick') {
      setUi({ message: '吸管只更新当前颜色，不产生笔刷（不改模型、不进历史，REQ-037）' })
      return false
    }
    // `REQ-027` 门四：颜色键在**真正写入前**才分配（选色/吸管不产生持久键）；擦除不写色 ⇒ 不需要键。
    const tx = newColorTx()
    let key = 0
    if (s.tool !== 'erase') {
      const r = txKeyForColor(this.host, tx, currentColorHex())
      if (!r.ok) {
        setUi({ message: r.message }) // 容量耗尽：不落笔、模型与色板零修改
        return false
      }
      key = r.key
    }
    this.buffer = new Map()
    this.key = key
    this.colorTx = tx
    this.op = {
      type: 'stroke',
      action: s.tool,
      mode: s.tool === 'place' && s.overridePlace ? 'override' : 'additive',
      size: s.brushSize,
    }
    this.rejects = emptyStrokeRejects()
    return true
  }

  /**
   * 涂抹一步（按下 / 拖到新锚点各调一次）：按单一谓词求变更，旁路直写模型与归属（所见即所得）。
   * 变更进缓冲，**不记账**（V8 ①：拖动期间旁路累积、松手才提交补丁）；自动保存同步抑制。
   * `REQ-027`：写入键取**落笔快照**（`this.key`），不在拖动中重新解析颜色。
   */
  apply(anchor: Coord): number {
    if (!this.buffer) return 0
    const s = useEditorUi.getState()
    if (s.tool === 'pick') return 0
    const op = this.op!
    const applied = applyBrushBatch(
      this.host.volume,
      this.host.parts,
      this.buffer,
      this.rejects,
      [anchor],
      { size: s.brushSize, action: s.tool, mode: op.mode, key: this.key },
      this.host.currentLayerFilter(),
      this.host.selectedPartId,
    )
    if (applied.length > 0) {
      this.host.renderChanges(applied)
      this.host.refreshViews()
    }
    return applied.length
  }

  /** 松手：缓冲合并成恰好 1 条补丁（V8）；零变化不入栈（V8 ②）并给可区分的反馈（纪律 ④）。 */
  commit(): void {
    if (!this.buffer || !this.op) return
    const cells = [...this.buffer.values()].sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z)
    const op = this.op
    const s = useEditorUi.getState()
    const label = strokeLabel(op.action, op.mode, s.brushSize)
    const patch = this.host.log.commitStroke({
      changes: cells.map((c) => ({ x: c.x, y: c.y, z: c.z, before: c.before, after: c.after })),
      ownersBefore: cells.map((c) => c.ownerBefore),
      op,
      label,
      partId: this.host.selectedPartId,
    })
    this.buffer = null
    this.op = null
    // `REQ-027` 门四：本笔未落账 ⇒ 收回本次新建且无引用的键（零变化 / 未记账的笔不留半完成色板）。
    if (patch) commitColorTx(this.colorTx ?? newColorTx())
    else if (this.colorTx) rollbackColorTx(this.host, this.colorTx)
    this.colorTx = null
    // C1 / MT-03：拖动中的 refreshViews 发生在补丁提交**之前**，此时 store.history 只可能看到旧日志；
    // commitStroke 完成后必须再投影一次，HistoryPanel 才会在本次松手立即看到新条目，而不是等下一笔 apply 才补刷。
    // 零变化笔也在收尾后同步一次，保证活动态结束后的 UI 投影一致；模型/日志仍由 commitStroke 决定是否变化。
    this.host.refreshViews()
    if (patch) {
      this.host.autosave.notifyChange() // 一笔落账才允许自动保存（拖动中途的旁路态不落库）
      // REQ-065：越界（±4096 外 / 非法）丢弃在操作回执可见（沿用 REQ-059 的回执通道）
      const oob = this.rejects.outOfBounds > 0 ? `；${this.rejects.outOfBounds} 块因越界（超出 ±4096 整数域）未放置` : ''
      setUi({ message: `已提交一笔「${label}」：改动 ${patch.changes.length} 格（一次撤销可全退）${oob}${this.rejects.hidden ? `；${this.rejects.hidden} 格因隐藏层未修改` : ''}` })
    } else {
      const r = this.rejects
      let why: string
      if (cells.length === 0 && r.outOfBounds > 0) why = '目标含非法或超出 ±4096 的格坐标（未记账）'
      else if (r.hidden > 0) why = '目标层被层次渲染隐藏（不可放置，未记录；REQ-052 不隐式切层）'
      else if (r.empty > 0) why = '范围内没有方块可作用（未记账）'
      else if (r.occupied > 0) why = '增量放置：目标格已全部被占用（零变化，不记账）'
      else why = '参数与现状一致（零变化，不记账）'
      setUi({ message: `本笔未产生变化——${why}` })
    }
  }

  /** 异常收尾（如切态打断）：按缓冲逆写，回到落笔前状态，不记账 */
  cancel(): void {
    if (!this.buffer) return
    const inverse: VoxelChange[] = []
    for (const c of this.buffer.values()) {
      inverse.push({ x: c.x, y: c.y, z: c.z, before: c.after, after: c.before })
      this.host.volume.setBlock(c.x, c.y, c.z, c.before)
      if (c.before === 0) this.host.parts.unassign(c.x, c.y, c.z)
      else if (c.ownerBefore && this.host.parts.get(c.ownerBefore)) this.host.parts.assign(c.x, c.y, c.z, c.ownerBefore)
      else this.host.parts.unassign(c.x, c.y, c.z)
    }
    this.buffer = null
    this.op = null
    // `REQ-027` 门四：取消的笔从未落账 ⇒ 收回本次新建的键（模型已还原，历史无引用）
    if (this.colorTx) rollbackColorTx(this.host, this.colorTx)
    this.colorTx = null
    if (inverse.length > 0) {
      this.host.renderChanges(inverse)
    }
    this.host.refreshViews()
    // `D5`：一笔取消 ⇒ 短原因随之消失（design §8 D5 的消失条件之一）
    this.host.renderer?.setPreview?.(null)
    setUi({ message: '本笔已取消（未记账）', previewReject: null, previewReadout: null })
  }

  // ── F7：笔刷预览（V6：预览集合 = 笔刷体积 ∩ 单一谓词；Q7：隐藏层无预览）──

  /** 以锚点计算预览（放置 = 被点面相邻格；擦除/上色 = 被点方块本体）。返回预览集合。
   *  `REQ-063`：同时把**关键块**（锚点格）分出来给渲染层（关键 = 半透明红 / 附属 = 绿）。 */
  previewAt(anchor: Coord): Coord[] {
    const s = useEditorUi.getState()
    if (s.tool === 'pick') {
      // 吸管无笔刷预览（它不改模型）：只收起上一次预览
      this.host.renderer?.setPreview?.(null)
      setUi({ previewReadout: null, previewReject: null })
      return []
    }
    const state = brushPreviewState(
      this.host.volume,
      s.brushSize,
      anchor,
      s.tool,
      s.overridePlace,
      this.host.currentLayerFilter(),
      this.host.previewColorKey(),
    )
    this.host.renderer?.setPreview?.(state.cells, state.keyCells)
    if (state.cells.length === 0) {
      // `D5`：**全无效**才给短原因（左上黄字）；`message` 只留诊断明细 ⇒ 两条通道不重复同一句话。
      const r = state.rejected
      const kind = rejectKindOf(r) ?? 'noTarget'
      setUi({
        message: `预览全无效（明细：隐藏 ${r.hidden} · 越界 ${r.outOfBounds} · 已占用 ${r.occupied} · 空目标 ${r.empty} · 零变化 ${r.unchanged}）——短原因见左上预览区`,
        previewReject: nextPreviewReject(useEditorUi.getState().previewReject, kind),
      })
    } else {
      // 下一次有效命中即撤掉提示（部分裁剪不算全无效：有格子可写就照常预览）
      setUi({ previewReject: null })
    }
    setUi({
      previewReadout: {
        anchor: [anchor.x, anchor.y, anchor.z],
        size: [s.brushSize.x, s.brushSize.y, s.brushSize.z],
        cells: state.cells.length,
      },
    })
    return state.cells
  }

  /** `D5`：**没命中**（射线没打到任何可见模型 / 工作平面）也属于"预览全无效"——由视口显式告知类别。
   *  为什么不让 `previewAt` 兜底：没命中时**没有锚点**，进不了笔刷谓词，拒绝计数自然是空的；
   *  而"没命中"与"命中但没方块可作用"是两句不同的短原因（design 的 `empty` 文案只对前者成立）。
   *  闸门放在这里而不是调用方：`D5` 只覆盖**编辑/放置**工具——吸管（不写模型）与检视态一律不留提示，
   *  免得"无法放置"的黄字出现在根本没有放置意图的时候。 */
  previewMiss(kind: PreviewRejectKind): void {
    this.host.renderer?.setPreview?.(null)
    const s = useEditorUi.getState()
    const applies = s.mode === 'edit' && s.tool !== 'pick'
    setUi({
      previewReadout: null,
      previewReject: applies ? nextPreviewReject(s.previewReject, kind) : null,
    })
  }

  clearPreview(): void {
    this.host.renderer?.setPreview?.(null)
    setUi({ previewReadout: null, previewReject: null })
  }

  /** 层次 / 笔刷参数变化后重算预览（保持锚点不变） */
  updatePreview(): void {
    const p = useEditorUi.getState().previewReadout
    if (!p) {
      this.clearPreview()
      return
    }
    this.previewAt({ x: p.anchor[0], y: p.anchor[1], z: p.anchor[2] })
  }
}
