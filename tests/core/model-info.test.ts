// r02 前半 · F1/F2/F3 纯函数面：非空块 AABB（W/H/L + 中心 = 相机目标点）与按层计数（V2/V3）。
// 坐标口径 = 右手系（x 右 / y 上 / z 向前；REQ-053）；只谈方块与层，不谈 chunk（REQ-050）。
import { describe, expect, it } from 'vitest'
import { countByLayer, modelBounds, visibleCountByFilter } from '../../src/core/model-info'
import { internBuiltin } from '../../src/core/builtin-palette'
import { Volume } from '../../src/core/volume'

function blank3(volume: Volume): void {
  const key = internBuiltin(volume.palette).get('color:light-gray')!
  for (let x = 0; x <= 2; x++) {
    for (let y = 0; y <= 2; y++) {
      for (let z = 0; z <= 2; z++) volume.setBlock(x, y, z, key)
    }
  }
}

describe('V2 · 非空块 AABB 与读数（F6 坯料口径）', () => {
  it('3³ 坯料（0..2）⇒ W=H=L=3，AABB 中心 = (1.5, 1.5, 1.5)（格心 = 坐标 + 0.5）', () => {
    const volume = new Volume()
    blank3(volume)
    const b = modelBounds(volume)!
    expect(b).not.toBeNull()
    expect([b.w, b.h, b.l]).toEqual([3, 3, 3])
    expect([b.minX, b.minY, b.minZ]).toEqual([0, 0, 0])
    expect([b.maxX, b.maxY, b.maxZ]).toEqual([2, 2, 2])
    expect([b.centerX, b.centerY, b.centerZ]).toEqual([1.5, 1.5, 1.5])
  })

  it('非对称 + 负坐标：W/H/L = 各轴格数；中心随包围盒走', () => {
    const volume = new Volume()
    const key = internBuiltin(volume.palette).get('color:red')!
    volume.setBlock(-2, 0, 5, key)
    volume.setBlock(3, 4, 5, key)
    const b = modelBounds(volume)!
    expect([b.w, b.h, b.l]).toEqual([6, 5, 1])
    expect([b.centerX, b.centerY, b.centerZ]).toEqual([1, 2.5, 5.5])
  })

  it('空模型 ⇒ null（无 AABB、无读数）', () => {
    expect(modelBounds(new Volume())).toBeNull()
  })

  it('增删块后随更新重算（REQ-053：AABB 与读数随模型变化）', () => {
    const volume = new Volume()
    blank3(volume)
    const key = internBuiltin(volume.palette).get('color:red')!
    volume.setBlock(10, 0, 0, key)
    expect(modelBounds(volume)!.w).toBe(11)
    volume.setBlock(10, 0, 0, 0)
    expect(modelBounds(volume)!.w).toBe(3)
  })
})

describe('V3 · 按层计数与层次可见性', () => {
  it('每层块数 = 该层非空块数（坯料 = 3 层各 9 块）', () => {
    const volume = new Volume()
    blank3(volume)
    expect(countByLayer(volume)).toEqual([
      { y: 0, count: 9 },
      { y: 1, count: 9 },
      { y: 2, count: 9 },
    ])
  })

  it('可见块数 = 按层计数：below(y) ⇒ minY..y 求和；single(y) ⇒ 该层计数', () => {
    const volume = new Volume()
    blank3(volume)
    expect(visibleCountByFilter(volume, null)).toBe(27)
    expect(visibleCountByFilter(volume, { mode: 'below', y: 2 })).toBe(27) // 滑块到顶（含建造余量层）
    expect(visibleCountByFilter(volume, { mode: 'below', y: 1 })).toBe(18)
    expect(visibleCountByFilter(volume, { mode: 'below', y: 0 })).toBe(9)
    expect(visibleCountByFilter(volume, { mode: 'single', y: 1 })).toBe(9)
    expect(visibleCountByFilter(volume, { mode: 'single', y: 3 })).toBe(0) // 余量空层
  })

  it('不连续层也按层计数（空层计 0、不进清单）', () => {
    const volume = new Volume()
    const key = internBuiltin(volume.palette).get('color:red')!
    volume.setBlock(0, 0, 0, key)
    volume.setBlock(0, 2, 0, key)
    expect(countByLayer(volume)).toEqual([
      { y: 0, count: 1 },
      { y: 2, count: 1 },
    ])
    expect(visibleCountByFilter(volume, { mode: 'below', y: 1 })).toBe(1)
    expect(visibleCountByFilter(volume, { mode: 'single', y: 1 })).toBe(0)
  })
})
