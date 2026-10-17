import type { BrushAction } from './types'

// 单一谓词（kickoff 实现纪律 ②）："这格能不能写"只有一个纯函数——
// Q2 的布尔语义（增量/替换/擦除/上色）与 Q7 的隐藏层规则（不可拾取/不可放置）都走它，将来组合边界也走它。

/** 层次视图过滤（会话态）：below = 渲染 minY..y；single = 只渲染 y 这一层。null = 不过滤（全部可见） */
export interface LayerFilter {
  readonly mode: 'below' | 'single'
  readonly y: number
}

export function isLayerVisible(filter: LayerFilter | null, y: number): boolean {
  if (filter === null) return true
  return filter.mode === 'below' ? y <= filter.y : y === filter.y
}

/** 谓词输入：动作 + 替换开关 + 目标格现状（0 = 空）+ 所在层是否可见（Q7） */
export interface CellWriteQuery {
  readonly action: BrushAction
  readonly override: boolean
  readonly currentKey: number
  readonly layerVisible: boolean
}

/**
 * 单一谓词（纯函数）：
 * · place + 增量（默认）：只写空气（currentKey === 0）
 * · place + 替换（Override）：空气与已有块都写（逐块覆盖）
 * · erase：只清已有块
 * · paint：只改已有块（不新增）
 * 任何动作都要求该格所在层当前可见（Q7：隐藏层不可放置）。
 */
export function canWriteCell(q: CellWriteQuery): boolean {
  if (!q.layerVisible) return false
  if (q.action === 'place') {
    return q.override || q.currentKey === 0
  }
  return q.currentKey !== 0
}

/** 该动作落到这一格的键值（擦除 = 0，其余 = 笔刷选定的键） */
export function writeKeyFor(action: BrushAction, brushKey: number): number {
  return action === 'erase' ? 0 : brushKey
}
