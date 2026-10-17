// T1 canary：证明 vitest 配线可用（先跑通流程，再追数字——test-preflight 的精神）。
// 另含 harness 种子基线：I8 采集失效条件（"S* 标称 = 实测"）的无头预检——数量对不上 ⇒ 采集作废。
// 判据目录 = 笔记库 curriculum/testing-plan.md；r01 落 I1/I2/I3/N1/N2（tests/）与 I8/I9（harness/）。
import { describe, expect, it } from 'vitest'
import { buildHouse, buildSStarVolume } from '../../harness/seed'
import { Volume } from '../../src/core/volume'

describe('T1 工程基线', () => {
  it('vitest 能跑（canary）', () => {
    expect([1, 2, 3].length).toBe(3)
  })
})

describe('harness 种子基线（I8 失效条件预检）', () => {
  it('buildSStarVolume 恰好产出 S* = 20 000（标称 = 实测）', () => {
    const volume = new Volume()
    expect(buildSStarVolume(volume, 20000)).toBe(20000)
    expect(volume.nonEmptyCount).toBe(20000)
  })

  it('同种子确定性：两次构建的模型摘要相同', () => {
    const a = new Volume()
    const b = new Volume()
    buildSStarVolume(a, 20000)
    buildSStarVolume(b, 20000)
    expect(a.digest()).toEqual(b.digest())
  })

  it('PD1 样例小屋：块数 > 300 且包围盒在 ≈16³ 内', () => {
    const volume = new Volume()
    const placed = buildHouse(volume, 0, 0, 0)
    expect(placed).toBeGreaterThan(300)
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (const b of volume.iterBlocks()) {
      minX = Math.min(minX, b.x)
      maxX = Math.max(maxX, b.x)
      minY = Math.min(minY, b.y)
      maxY = Math.max(maxY, b.y)
      minZ = Math.min(minZ, b.z)
      maxZ = Math.max(maxZ, b.z)
    }
    expect(maxX - minX + 1).toBeLessThanOrEqual(16)
    expect(maxY - minY + 1).toBeLessThanOrEqual(16)
    expect(maxZ - minZ + 1).toBeLessThanOrEqual(16)
  })
})
