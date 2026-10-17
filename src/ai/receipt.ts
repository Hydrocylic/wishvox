// r04 T6（I1 · ai 四拆之二）：回执面——自 ai/executor.ts 迁出。
// ExecOutcome（工具执行的统一返回面）+ receiptSnapshot（编辑区快照回执的装配）。
// 回执文案（教学式报错 / 拒绝面）与 rules 的 agentHint 是两套口径（code-map D8 登记），
// A1 同源纪律不覆盖回执面——将来统一另立线索（候选 = 回执引用 PreRuleHint.id）。
import type { VoxelChange } from '../core/types'
import type { Editor } from '../edit/editor'
import { renderYSlice, sliceLegend } from './view'
import { AI_LIMITS } from './tools'
import type { ToolResultDetail } from './session-log'

export interface ExecOutcome {
  /** ok=false ⇒ 未执行或已回滚（content 是给模型的教学式说明） */
  readonly ok: boolean
  readonly content: string
  readonly detail?: ToolResultDetail
  readonly patchSeq?: number
  readonly wide: boolean
}

/** 教学式报错（拒绝必带最小合法示例——args / scope-args 共用的文案正本） */
export function teachingError(msg: string, example: string): string {
  return `${msg}。最小合法示例：${example}`
}

/** 参数级拒绝的统一 ExecOutcome 形状 */
export function argError(msg: string): ExecOutcome {
  return { ok: false, content: msg, wide: false, detail: { violations: [msg] } }
}

/** `A-09`：人工一笔进行中的统一回执形状（AI 侧看到"未执行、可重试"，不是教学式参数错误） */
export function busyError(msg: string): ExecOutcome {
  return { ok: false, content: msg, wide: false, detail: { violations: [msg], busy: true } }
}

export function receiptSnapshot(editor: Editor, changes: readonly VoxelChange[]): string {
  if (changes.length === 0) return ''
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (const c of changes) {
    minX = Math.min(minX, c.x)
    minY = Math.min(minY, c.y)
    minZ = Math.min(minZ, c.z)
    maxX = Math.max(maxX, c.x)
    maxY = Math.max(maxY, c.y)
    maxZ = Math.max(maxZ, c.z)
  }
  const { charOfKey, legend } = sliceLegend(editor.volume)
  const rows: string[] = ['[编辑区快照]（"."=空）']
  const cap = Math.min(maxY, minY + AI_LIMITS.snapshotMaxRows - 1)
  for (let y = minY; y <= cap; y++) {
    rows.push(`── y=${y} ──`)
    rows.push(renderYSlice(editor.volume, y, { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] }, charOfKey))
  }
  if (maxY > cap) rows.push(`（共 ${maxY - minY + 1} 层，只显示底部 ${AI_LIMITS.snapshotMaxRows} 层）`)
  rows.push(`[图例] ${legend.join(' ')}`)
  return rows.join('\n')
}
