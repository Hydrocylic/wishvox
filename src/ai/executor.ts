// r03 · T5b 工具执行器（plan §2.2 的"执行"一步）——r04 T6（I1）瘦身为**主流程**：
// AI 工具参数 → ProgramOp / StrokeOp / 读查询 → **Editor 已有写入口**（aiProgramOp / aiBrush / aiSetCells /
// aiUndo / aiRedo——全部落在 runProgramOp + PatchLog.applyPlanned / commitStroke 同一条记账路，不新增写路径）。
// 拆分位：参数解析族 → args.ts · 回执面 → receipt.ts · 宾语对账 → rules/post.ts（H2 迁入）。
// 守卫三类（口径卡 §三注）：参数校验拒绝（教学式报错）· 坐标数域 ±2¹²（非法丢弃计数 + 回执可见，`REQ-065`）·
// 宾语对账（V7：收束类 ⊆ 宾语集 / 扩张类 = 声明扩张；越出 ⇒ 整笔回滚）。
import { coordKey } from '../core/coords'
import type { ScopeRef } from '../core/types'
import { resolveScope } from '../core/scope'
import { commitColorTx, newColorTx, resolveKeyRef, rollbackColorTx } from '../edit/color'
import type { ColorTx } from '../edit/color'
import type { Editor } from '../edit/editor'
import { parseWriteArgs } from './args'
import type { ParsedWrite, WriteParseResult } from './args'
import { argError, busyError } from './receipt'
import { STROKE_BUSY_REASON } from '../edit/ai-write'
import { receiptSnapshot } from './receipt'
import type { ExecOutcome } from './receipt'
import { renderMapFull, renderCompositionsList, renderPartsList, renderSelection, renderSnapshot, buildSnapshot } from './view'
import { reconcileNarrow, reconcileExpand, NARROW_OPS, EXPAND_OPS } from '../rules/post'
import type { ReconcileFail } from '../rules/post'

interface ExecuteOptions {
  /** job 开始时的补丁数（AI undo 地板） */
  readonly jobFloor: number
  /** D5 单解析（r04 T6）：loop 的 wideOf 已解析过的产物直传（一调用一解析）；缺省 = 本地解析
   *  （resume 补执行路径）。失败产物同样直传——避免为取教学报错而二次解析。 */
  readonly preparsed?: WriteParseResult
}

/** `REQ-027`（门四）：把解析期的**颜色引用**物化成项目键（规范色值在此才 intern）。
 *  任一引用失败 ⇒ 调用方整体回滚（本次新建的键全部收回，模型与色板零修改）。
 *  产物只经返回值传出（程序化操作的 `params` 除外——`ProgramOp` 的参数位必须是数字）；
 *  解析产物本身保持"引用"形态 ⇒ 同一产物被重复执行（刷新后重入）仍然幂等。 */
interface MaterializedKeys {
  readonly brushKey: number
  readonly cellKeys: readonly number[]
}

function materializeKeyRefs(editor: Editor, tx: ColorTx, p: ParsedWrite): { ok: true; keys: MaterializedKeys } | { ok: false; message: string } {
  let brushKey = 0
  let cellKeys: number[] = []
  if (p.op && p.opKeyRefs) {
    const params = p.op.params as unknown as Record<string, unknown>
    for (const slot of p.opKeyRefs) {
      const resolved: number[] = []
      for (const ref of slot.refs) {
        const r = resolveKeyRef(editor, tx, ref)
        if (!r.ok) return { ok: false, message: r.message }
        resolved.push(r.key)
      }
      params[slot.field] = slot.many === true ? resolved : resolved[0] ?? 0
    }
  }
  if (p.brush && p.brush.modifier !== 'erase') {
    const r = resolveKeyRef(editor, tx, p.brush.key)
    if (!r.ok) return { ok: false, message: r.message }
    brushKey = r.key
  }
  if (p.cells) {
    const resolved: number[] = []
    for (const cell of p.cells) {
      const r = resolveKeyRef(editor, tx, cell.key)
      if (!r.ok) return { ok: false, message: r.message }
      resolved.push(r.key)
    }
    cellKeys = resolved
  }
  return { ok: true, keys: { brushKey, cellKeys } }
}

/** 执行一个工具调用。写工具 = 恰好 1 条补丁（或零变化/拒绝）；读工具直接回内容。 */
export function executeTool(editor: Editor, toolName: string, args: Record<string, unknown>, opts: ExecuteOptions): ExecOutcome {
  // 读工具 5 件（免闸、不写）
  switch (toolName) {
    case 'get_model_summary':
      return { ok: true, content: renderSnapshot(buildSnapshot(editor)), wide: false }
    case 'read_map_full': {
      const r = renderMapFull(editor.volume)
      return r.ok ? { ok: true, content: r.text, wide: false } : { ok: false, content: r.error, wide: false }
    }
    case 'list_parts':
      return { ok: true, content: renderPartsList(editor, typeof args.name_contains === 'string' ? args.name_contains : undefined), wide: false }
    case 'list_compositions':
      return { ok: true, content: renderCompositionsList(editor, typeof args.name_contains === 'string' ? args.name_contains : undefined), wide: false }
    case 'get_selection':
      return { ok: true, content: renderSelection(editor), wide: false }
    case 'update_plan':
      return argError('update_plan 由会话循环处理（计划闸门），不走执行器')
  }

  const parsed = opts.preparsed ?? parseWriteArgs(editor, toolName, args)
  if (!parsed.ok) return argError(parsed.message)
  const p = parsed.parsed
  // `REQ-027`：本次调用的颜色事务——写入边界内才分配新键，任一失败路径整体回收（不留半完成色板）
  const tx = newColorTx()
  const colorFail = (message: string): ExecOutcome => {
    rollbackColorTx(editor, tx)
    return argError(message)
  }
  const materialized = materializeKeyRefs(editor, tx, p)
  if (!materialized.ok) return colorFail(materialized.message)
  const mkeys = materialized.keys

  if (p.kind === 'undo' || p.kind === 'redo') {
    const steps = p.estimatedCells
    if (p.kind === 'undo') {
      const r = editor.aiUndo(steps, opts.jobFloor)
      if (r.done === 0) {
        return { ok: false, content: `未回退：${r.reason ?? '无可撤销的补丁'}`, wide: true, detail: { violations: [r.reason ?? '无可撤销'] } }
      }
      return {
        ok: true,
        content: `已撤销 ${r.done} 笔（地板 = 任务开始时的 ${opts.jobFloor} 笔用户编辑，退不穿）`,
        wide: true,
        detail: { undoDepth: r.done },
      }
    }
    const done = editor.aiRedo(steps)
    return done === 0
      ? { ok: false, content: '没有可重做的补丁（redo 栈为空）', wide: true, detail: { violations: ['redo 栈为空'] } }
      : { ok: true, content: `已重做 ${done} 笔`, wide: true, detail: { undoDepth: -done } }
  }

  if (p.kind === 'brush') {
    const b = p.brush!
    const r = editor.aiBrush({ anchors: b.anchors, size: b.size, action: b.action, mode: b.mode, key: mkeys.brushKey })
    // `A-09`：人工一笔进行中 ⇒ 零修改 + 明确 busy（可重试），不静默取消人工笔
    if (r.busy) {
      rollbackColorTx(editor, tx)
      return busyError(STROKE_BUSY_REASON)
    }
    const oob = r.rejected.outOfBounds
    if (!r.patch) {
      rollbackColorTx(editor, tx) // 零变化：本次新建的色键未落账，收回
      const why = oob > 0 ? `目标全部超出 ±4096 整数域或零变化（域外丢弃 ${oob} 格）` : '零变化（目标格已占用 / 没有方块可作用）——未记账'
      return { ok: false, content: why, wide: p.wide, detail: { skipped: r.rejected.occupied + r.rejected.empty + r.rejected.unchanged, outOfBounds: oob } }
    }
    commitColorTx(tx)
    const oobNote = oob > 0 ? `；${oob} 格超出 ±4096 整数域未放置` : ''
    const skipNote = r.rejected.occupied + r.rejected.empty + r.rejected.unchanged > 0 ? `；跳过 ${r.rejected.occupied + r.rejected.empty + r.rejected.unchanged} 格（占用/空/同色）` : ''
    return {
      ok: true,
      content: `笔刷 ${b.modifier} ${b.size.x}×${b.size.y}×${b.size.z} × ${b.anchors.length} 锚：改动 ${r.patch.changes.length} 格${oobNote}${skipNote}\n${receiptSnapshot(editor, r.patch.changes)}`,
      wide: p.wide,
      detail: { cells: r.patch.changes.length, patchSeq: r.patch.seq, outOfBounds: oob, skipped: r.rejected.occupied + r.rejected.empty + r.rejected.unchanged },
    }
  }

  if (p.kind === 'setCells') {
    // D4 收严（r04 T6）：直接用解析产物（未知身份已在解析期整笔拒；不再有"执行面 ?? 0 静默当 0"的重解析）
    const cells = (p.cells ?? []).map((c, i) => ({ x: c.x, y: c.y, z: c.z, key: mkeys.cellKeys[i] ?? 0 }))
    const outOfBounds = p.outOfBounds ?? 0
    const patch = editor.aiSetCells({ cells })
    if (patch && 'busy' in patch) {
      rollbackColorTx(editor, tx)
      return busyError(STROKE_BUSY_REASON) // `A-09`：人工一笔进行中（零修改）
    }
    if (!patch) {
      rollbackColorTx(editor, tx)
      return { ok: false, content: `零变化（${outOfBounds} 格超出 ±4096 整数域未放置；其余格与现状一致）——未记账`, wide: p.wide, detail: { outOfBounds } }
    }
    commitColorTx(tx)
    const oobNote = outOfBounds > 0 ? `；${outOfBounds} 格超出 ±4096 整数域未放置` : ''
    return {
      ok: true,
      content: `逐块写入：改动 ${patch.changes.length} 格${oobNote}\n${receiptSnapshot(editor, patch.changes)}`,
      wide: p.wide,
      detail: { cells: patch.changes.length, patchSeq: patch.seq, outOfBounds },
    }
  }

  // 程序化操作：解析时已带 ScopeRef；执行前再取一次范围（对账基准 = 执行前状态）
  const op = p.op!
  const scopeRef = (op.params as { scope?: ScopeRef }).scope ?? null
  const scopeCoords = scopeRef ? resolveScope(editor.volume, editor.parts, editor.compositions, scopeRef) : []
  const keyAt = new Map(scopeCoords.map((c) => [coordKey(c.x, c.y, c.z), editor.volume.getBlock(c.x, c.y, c.z)]))
  let patch: ReturnType<Editor['aiProgramOp']> = null
  try {
    patch = editor.aiProgramOp(op)
  } catch (e) {
    return colorFail(`操作被拒绝：${(e as Error).message}`)
  }
  if (patch && 'busy' in patch) {
    rollbackColorTx(editor, tx)
    return busyError(STROKE_BUSY_REASON) // `A-09`：人工一笔进行中（零修改、不取消人工笔）
  }
  if (!patch) {
    rollbackColorTx(editor, tx)
    return { ok: false, content: '范围内没有方块可作用（或全部与现状一致）——未记账', wide: p.wide, detail: { skipped: scopeCoords.length } }
  }
  commitColorTx(tx)

  // 宾语对账（V7）：越出 ⇒ 整笔回滚（"一次调用 = 1 条补丁"使回滚天然整笔）
  if (scopeRef && scopeCoords.length > 0) {
    let fail: ReconcileFail | null = null
    if (NARROW_OPS.has(op.name)) fail = reconcileNarrow(op, scopeCoords, patch.changes)
    else if (EXPAND_OPS.has(op.name)) fail = reconcileExpand(op, scopeCoords, keyAt, patch.changes, editor.volume)
    if (fail) {
      editor.undo() // 恰好撤掉刚落账的这一笔
      // `REQ-027`：整笔回滚后新键只被 undo 栈引用 ⇒ 保留（重做必须还原同一键）；无引用者收回
      rollbackColorTx(editor, tx)
      return {
        ok: false,
        content: `改动越出声明的宾语范围，已整笔回滚。原因：${fail.violations.join('；')}。请收窄范围或分步执行`,
        wide: p.wide,
        detail: { reverted: true, violations: fail.violations, cells: patch.changes.length, patchSeq: patch.seq },
      }
    }
  }

  const placed = patch.changes.filter((c) => c.after > 0 && c.before === 0).length
  const removed = patch.changes.filter((c) => c.after === 0).length
  const recolored = patch.changes.length - placed - removed
  const parts = [
    placed > 0 ? `放置 ${placed}` : '',
    removed > 0 ? `删除 ${removed}` : '',
    recolored > 0 ? `改写 ${recolored}` : '',
  ].filter(Boolean)
  const scopeNote = op.name === 'clearScope' && scopeRef?.kind === 'all' ? '（已清空全体）' : ''
  return {
    ok: true,
    content: `${op.name} 完成：${parts.join('、') || '无块级变化'}${scopeNote}\n[补丁] seq=${patch.seq} label="${patch.label ?? ''}"（一次撤销可全退）\n${receiptSnapshot(editor, patch.changes)}`,
    wide: p.wide,
    detail: { cells: patch.changes.length, patchSeq: patch.seq, objects: patch.partId ? 1 : 0 },
  }
}
