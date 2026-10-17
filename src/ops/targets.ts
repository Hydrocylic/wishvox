import { coordKey } from '../core/coords'
import type { VoxelChange } from '../core/types'
import type { Volume } from '../core/volume'

// 终态差分：操作先算"目标态"（coordKey → 键），再与当前模型差分。
// 每个受影响坐标**恰好一条** change ⇒ 应用与顺序无关、before/after 精确、逆补丁天然成立（I2 批量口径）。

interface TargetEntry {
  x: number
  y: number
  z: number
  key: number
}

export class TargetMap {
  private readonly map = new Map<string, TargetEntry>()

  /** 同坐标后写覆盖先写（操作内部按确定的遍历序调用 ⇒ 结果确定） */
  set(x: number, y: number, z: number, key: number): void {
    this.map.set(coordKey(x, y, z), { x, y, z, key })
  }

  get size(): number {
    return this.map.size
  }

  entries(): TargetEntry[] {
    return [...this.map.values()]
  }
}

/** 与 volume 差分出变更（排序稳定；before==after 的格子不出现在补丁里） */
export function diffTargets(volume: Volume, targets: TargetMap): VoxelChange[] {
  return targets
    .entries()
    .map((t) => ({ x: t.x, y: t.y, z: t.z, before: volume.getBlock(t.x, t.y, t.z), after: t.key }))
    .filter((c) => c.before !== c.after)
    .sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z)
}

/** 包围盒（resolveScope 的坐标集 → bbox）；空集返回 null */
export function boundsOf(coords: ReadonlyArray<{ x: number; y: number; z: number }>): {
  minX: number
  minY: number
  minZ: number
  maxX: number
  maxY: number
  maxZ: number
} | null {
  if (coords.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (const c of coords) {
    if (c.x < minX) minX = c.x
    if (c.y < minY) minY = c.y
    if (c.z < minZ) minZ = c.z
    if (c.x > maxX) maxX = c.x
    if (c.y > maxY) maxY = c.y
    if (c.z > maxZ) maxZ = c.z
  }
  return { minX, minY, minZ, maxX, maxY, maxZ }
}
