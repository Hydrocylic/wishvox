// `src/ai/args.ts` 的解析产物类型（结构超线兜底：args.ts 逼近 400 行 ⇒ 类型面按"文件 + 符号"分家）。
// `REQ-027`（门四）的颜色寻址在这两个类型里定型：**解析期只产出引用，键在执行边界内物化**。
import type { ProgramOp } from '../core/types'
import type { KeyRef } from '../edit/color'

/** 程序化操作参数里的颜色槽：解析期只产出引用，键在执行边界内物化；many = 键数组（`keys` / `fromKeys`） */
export interface OpKeySlot {
  readonly field: string
  readonly refs: readonly KeyRef[]
  readonly many?: boolean
}

export interface ParsedWrite {
  readonly kind: 'program' | 'brush' | 'setCells' | 'undo' | 'redo'
  readonly op?: ProgramOp
  /** `op.params` 里颜色字段的引用（数字槽位是占位 0，执行前由执行面物化填入） */
  readonly opKeyRefs?: readonly OpKeySlot[]
  readonly brush?: {
    readonly action: 'place' | 'erase' | 'paint'
    readonly mode: 'additive' | 'override'
    readonly size: { x: number; y: number; z: number }
    readonly anchors: ReadonlyArray<{ x: number; y: number; z: number }>
    /** 颜色引用（擦除 = `air`，不写色） */
    readonly key: KeyRef
    readonly modifier: string
  }
  /** D4 收严：set_cells 的解析产物（原版只留计数、执行面重解析）；`key` = 颜色引用 */
  readonly cells?: ReadonlyArray<{ x: number; y: number; z: number; key: KeyRef }>
  /** set_cells 的越界丢弃计数（REQ-059 回执"因越界未放置"来源；随解析产物同源） */
  readonly outOfBounds?: number
  readonly wide: boolean
  readonly estimatedCells: number
}

export type WriteParseResult = { ok: true; parsed: ParsedWrite } | { ok: false; message: string }
