import type { VoxelChange } from './types'

/** 逆补丁：before/after 交换并反序（I2 第一条的基石：apply ∘ inverse = identity） */
export function invertChanges(changes: readonly VoxelChange[]): VoxelChange[] {
  return [...changes]
    .reverse()
    .map((c) => ({ x: c.x, y: c.y, z: c.z, before: c.after, after: c.before }))
}
