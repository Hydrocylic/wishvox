import { isCoordTripleDomain } from '../coords'
import type { Coord, VoxelChange } from '../types'
import type { Volume } from '../volume'
import type { LayerFilter } from './predicate'
import { canWriteCell, isLayerVisible, writeKeyFor } from './predicate'
import type { BrushAction, BrushMode } from './types'
import { brushVolume } from './volume'

// 笔刷应用（纯函数，只读 volume）：按单一谓词把笔刷体积换算成变更集。
// 变更集口径与 ops 的"终态差分"一致——每个受影响坐标恰好一条 change；before==after 的格子不出现在补丁里。
// 拒绝原因分开计数（纪律④ 零变化反馈：区分"没有方块可作用"与"已占用/隐藏层"）。

interface BrushApplyParams {
  readonly size: Coord
  readonly anchor: Coord
  readonly action: BrushAction
  readonly mode: BrushMode
  /** 笔刷选定的调色板键（place / paint 写入用；erase 忽略） */
  readonly key: number
}

export interface BrushRejections {
  /** 所在层被层次渲染隐藏（Q7） */
  readonly hidden: number
  /** place 增量：目标格已有块（跳过，不覆盖） */
  readonly occupied: number
  /** erase / paint：目标格是空气（没有方块可作用） */
  readonly empty: number
  /** 谓词通过但 before==after（如上色同色）——零变化 */
  readonly unchanged: number
  /** REQ-059（ADR-20 ④）：y<0 的目标格（笔刷底面越界）——丢弃且回执计数 */
  readonly outOfBounds: number
}

interface BrushApplyResult {
  readonly changes: VoxelChange[]
  readonly cells: readonly Coord[]
  readonly rejected: BrushRejections
}

export function applyBrush(
  volume: Volume,
  params: BrushApplyParams,
  filter: LayerFilter | null,
): BrushApplyResult {
  const cells = brushVolume(params.size, params.anchor)
  const changes: VoxelChange[] = []
  let hidden = 0
  let occupied = 0
  let empty = 0
  let unchanged = 0
  let outOfBounds = 0
  for (const c of cells) {
    // `REQ-065`：目标格须是合法格坐标（±2¹² 内整数）。原 REQ-059 的 y<0 裁剪是其子集（y=0 下界已废止），
    // 仍并入同一 outOfBounds 计数 ⇒ "N 块因越界未放置" 的回执通道不变。
    if (!isCoordTripleDomain(c.x, c.y, c.z)) {
      outOfBounds++
      continue
    }
    const before = volume.getBlock(c.x, c.y, c.z)
    const layerVisible = isLayerVisible(filter, c.y)
    if (!canWriteCell({ action: params.action, override: params.mode === 'override', currentKey: before, layerVisible })) {
      if (!layerVisible) hidden++
      else if (params.action === 'place') occupied++
      else empty++
      continue
    }
    const after = writeKeyFor(params.action, params.key)
    if (before === after) {
      unchanged++
      continue
    }
    changes.push({ x: c.x, y: c.y, z: c.z, before, after })
  }
  return { changes, cells, rejected: { hidden, occupied, empty, unchanged, outOfBounds } }
}
