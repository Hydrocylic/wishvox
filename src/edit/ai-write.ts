// r04 T6（A5）：命令层对 AI 暴露的模型级写路径——自 edit/editor.ts 迁出。
// **不属于 ai/ 层**（那是会话循环 / 工具面 / provider）：这里是与 place/erase/paint 同口径的
// 模型级调用面（无检视态门），记账走 runProgramOp + PatchLog.applyPlanned / commitStroke 同一条路
// （r03 · plan §2.3 接口 1）；AI 的一次调用 = 恰好 1 条补丁（V1）。
import type { BrushRejections } from '../core/brush/apply'
import { coordKey, isCoordTripleDomain } from '../core/coords'
import type { Patch, ProgramOp } from '../core/types'
import type { Coord } from '../core/types'
import { runProgramOp } from '../ops'
import { setUi } from '../state/editor-store'
import { applyBrushBatch, emptyStrokeRejects, strokeLabel } from './stroke'
import type { StrokeCell } from './stroke'
import type { Editor } from './editor'

/** `A-09`（design §A4）：AI 写与人工笔互斥的**统一拒绝原因**。三条 AI 写路径（`aiProgramOp` /
 *  `aiBrush` / `aiSetCells`）走同一句、同一个判定；执行器据此回执给 AI（它可在人工笔结束后重试）。
 *  **不是锁**，也不会清人工笔：人工半笔只由人工交互收尾（松手提交 / 中断取消）。 */
export const STROKE_BUSY_REASON = '人工一笔进行中（笔刷未收尾）：本次 AI 写入未执行、模型未改动；请在人工笔结束后重试'

/** `A-09`：活动人工笔守卫——**零修改**返回 busy（不写模型、不记账、**不取消**人工笔）。
 *  原实现里 `aiBrush` / `aiSetCells` 会 `stroke.cancel()` 静默吃掉人工半笔，`aiProgramOp` 则毫无守卫：
 *  拖动期间是旁路直写（`stroke.ts#apply` 只写模型不进日志），AI 补丁一旦插进这段中间，
 *  随后的 `commitStroke` 记的是落笔前的 `before` ⇒ `PatchLog.replay(log) ≠ 当前模型`（I2 被破，撤销覆盖 AI 改动）。 */
export function strokeBusy(ed: Editor): boolean {
  if (!ed.stroke.active) return false
  setUi({ message: '一笔进行中：AI 写入已暂缓（未改动模型）；松开鼠标或取消该笔后重试' })
  return true
}

/** AI 程序化操作：runProgramOp + applyPlanned + afterChange。返回补丁；null = 零变化（不记账）；
 *  活动人工笔 ⇒ `{ busy: true }`（零修改，见 `strokeBusy`）；参数校验异常向上抛，由 AI 执行器捕获转教学式回执。 */
export function aiProgramOp(ed: Editor, op: ProgramOp): Patch | null | { busy: true } {
  if (strokeBusy(ed)) return { busy: true }
  const changes = runProgramOp(op, { volume: ed.volume, parts: ed.parts, compositions: ed.compositions })
  const patch = ed.log.applyPlanned(op, changes, ed.compositions)
  if (patch) ed.afterChange(patch.changes)
  return patch
}

/** AI 笔刷一笔：与人手路径同一套 applyBrushBatch 旁路写 + commitStroke 记账（恰好 1 条补丁，D1 合并后同源）。
 *  层次过滤不适用（null——AI 编辑模型本身）；放置归属沿 D-B ③（当前选中构件，未选中 ⇒ 手工块）。
 *  返回拒绝计数（含 y<0 越界——REQ-059 回执来源）；活动人工笔 ⇒ `busy: true` 且**不动人工笔**（`A-09`）。 */
/** AI 笔刷参数面（Editor.aiBrush facade 与本函数共用签名） */
export interface AiBrushArgs {
  anchors: readonly Coord[]
  size: Coord
  action: 'place' | 'erase' | 'paint'
  mode: 'additive' | 'override'
  key: number
  label?: string
}

export function aiBrush(
  ed: Editor,
  args: AiBrushArgs,
): { patch: Patch | null; rejected: BrushRejections; busy?: true } {
  if (strokeBusy(ed)) return { patch: null, rejected: emptyStrokeRejects(), busy: true }
  const rejected = emptyStrokeRejects()
  const buffer = new Map<string, StrokeCell>()
  const partId = ed.selectedPartId
  applyBrushBatch(ed.volume, ed.parts, buffer, rejected, args.anchors, { size: args.size, action: args.action, mode: args.mode, key: args.key }, null, partId)
  const cells = [...buffer.values()].sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z)
  const patch = ed.log.commitStroke({
    changes: cells.map((c) => ({ x: c.x, y: c.y, z: c.z, before: c.before, after: c.after })),
    ownersBefore: cells.map((c) => c.ownerBefore),
    op: { type: 'stroke', action: args.action, mode: args.mode, size: args.size },
    label: args.label ?? `AI·${strokeLabel(args.action, args.mode, args.size)}`, // D2：与人手路径同一拼法
    partId,
  })
  if (patch) {
    ed.renderChanges(patch.changes)
    ed.refreshViews()
    ed.autosave.notifyChange()
  }
  return { patch, rejected }
}

/** AI 逐块清单兜底（set_cells）：显式坐标差分 → 恰好 1 条 stroke 补丁（V1 口径：一次调用一条）。
 *  y<0 目标由调用方（AI 执行器）先丢弃并计数；这里只落合法目标。key=0 表示删除该格。
 *  `REQ-065`：非域坐标（非有限 / 小数 / 超 ±2¹²）**先滤掉**——若留给 `volume.setBlock` 抛错，
 *  循环中途抛出会留下"写了一半、又没记账"的模型（本单最忌讳的状态）；滤掉后模型与历史都零改动。
 *  活动人工笔 ⇒ `{ busy: true }` 且**不动人工笔**（`A-09`）。 */
export function aiSetCells(
  ed: Editor,
  args: { cells: ReadonlyArray<{ x: number; y: number; z: number; key: number }>; label?: string },
): Patch | null | { busy: true } {
  if (strokeBusy(ed)) return { busy: true }
  const buffer = new Map<string, StrokeCell>()
  const partId = ed.selectedPartId
  for (const cell of args.cells) {
    if (!isCoordTripleDomain(cell.x, cell.y, cell.z)) continue // `REQ-065`：非法坐标拒绝（零写入）
    const before = ed.volume.getBlock(cell.x, cell.y, cell.z)
    const after = cell.key
    if (before === after) continue
    const k = coordKey(cell.x, cell.y, cell.z)
    buffer.set(k, { x: cell.x, y: cell.y, z: cell.z, before, after, ownerBefore: ed.parts.partIdOf(cell.x, cell.y, cell.z) ?? null })
    ed.volume.setBlock(cell.x, cell.y, cell.z, after)
    if (after === 0) ed.parts.unassign(cell.x, cell.y, cell.z)
    else if (before === 0 && partId && ed.parts.get(partId)) ed.parts.assign(cell.x, cell.y, cell.z, partId)
  }
  const cells = [...buffer.values()].sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z)
  const patch = ed.log.commitStroke({
    changes: cells.map((c) => ({ x: c.x, y: c.y, z: c.z, before: c.before, after: c.after })),
    ownersBefore: cells.map((c) => c.ownerBefore),
    op: { type: 'stroke', action: 'place', mode: 'override', size: { x: 1, y: 1, z: 1 } },
    label: args.label ?? `AI·逐块写入（${cells.length} 格）`,
    partId,
  })
  if (patch) {
    ed.renderChanges(patch.changes)
    ed.refreshViews()
    ed.autosave.notifyChange()
  }
  return patch
}

/** AI undo/redo（带 job 开始地板——退不进 job 开始前用户的编辑，PetitMaker ①-23 先例）。
 *  返回实际回退/重做的步数；越地板 ⇒ 0 且给原因。 */
export function aiUndo(ed: Editor, steps: number, floorPatchCount: number): { done: number; reason?: string } {
  const can = ed.log.patches.length - Math.max(0, Math.min(steps, ed.log.patches.length))
  if (can < floorPatchCount) {
    return { done: 0, reason: `undo 地板：本次任务开始前用户已有 ${floorPatchCount} 笔编辑，不能退穿（PetitMaker ①-23 同口径）` }
  }
  let done = 0
  for (let i = 0; i < steps && ed.log.canUndo; i++) {
    ed.undo()
    done++
  }
  return { done }
}

export function aiRedo(ed: Editor, steps: number): number {
  let done = 0
  for (let i = 0; i < steps && ed.log.canRedo; i++) {
    ed.redo()
    done++
  }
  return done
}
