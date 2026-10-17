import type { LayerFilter } from './brush/predicate'
import { isLayerVisible } from './brush/predicate'
import type { Volume } from './volume'

// 模型读数（F1/F2/F3 的纯函数面）：非空块 AABB、按层计数、层次过滤后的可见块数。
// 坐标口径 = 右手系（x 右 / y 上 / z 向前；REQ-053）——
// 用户可见面只谈"方块与层"，不出现 chunk（REQ-050）。

export interface ModelBounds {
  readonly minX: number
  readonly minY: number
  readonly minZ: number
  readonly maxX: number
  readonly maxY: number
  readonly maxZ: number
  /** W(x) / H(y) / L(z)：非空块 AABB 三轴长度（格数） */
  readonly w: number
  readonly h: number
  readonly l: number
  /** AABB 几何中心（格心 = 坐标 + 0.5 ⇒ 中心 = (min + max + 1) / 2）——F1 相机目标点 */
  readonly centerX: number
  readonly centerY: number
  readonly centerZ: number
}

export function modelBounds(volume: Volume): ModelBounds | null {
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  let any = false
  for (const b of volume.iterBlocks()) {
    any = true
    if (b.x < minX) minX = b.x
    if (b.y < minY) minY = b.y
    if (b.z < minZ) minZ = b.z
    if (b.x > maxX) maxX = b.x
    if (b.y > maxY) maxY = b.y
    if (b.z > maxZ) maxZ = b.z
  }
  if (!any) return null
  return {
    minX,
    minY,
    minZ,
    maxX,
    maxY,
    maxZ,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
    l: maxZ - minZ + 1,
    centerX: (minX + maxX + 1) / 2,
    centerY: (minY + maxY + 1) / 2,
    centerZ: (minZ + maxZ + 1) / 2,
  }
}

/** 每层块数（y 升序；V3"每层块数与看到的对得上"的唯一出处） */
export function countByLayer(volume: Volume): Array<{ y: number; count: number }> {
  const counts = new Map<number, number>()
  for (const b of volume.iterBlocks()) counts.set(b.y, (counts.get(b.y) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([y, count]) => ({ y, count }))
}

/** 层次过滤后的可见块数（V3：below = minY..y 求和；single = 该层计数）——渲染层 mesh.count 的对拍基准 */
export function visibleCountByFilter(volume: Volume, filter: LayerFilter | null): number {
  if (filter === null) return volume.nonEmptyCount
  let n = 0
  for (const b of volume.iterBlocks()) {
    if (isLayerVisible(filter, b.y)) n++
  }
  return n
}
