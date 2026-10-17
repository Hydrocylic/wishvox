// D2 · 网格线与方块边界对齐（debug-261004，2026-10-04；MT-E5 走查发现）：
// 方块 (x,y,z) 占 [x, x+1) ⇒ 边界在整数。GridHelper 的线落在 center ± k·cell（cell = size/divisions），
// 故对齐 ⇔ cell = 1 且 center 对 1 取模 == 0（size 恒为 4 的倍数 ⇒ 四角 center ± size/2 也在整数）。
// 现状缺陷：center = AABB 几何中心（可为半整数，如 0..10 ⇒ 5.5）且 divisions = size ⇒ 线落在方块中心。
import { describe, expect, it } from 'vitest'
import { internBuiltin } from '../../src/core/builtin-palette'
import { modelBounds } from '../../src/core/model-info'
import { gridPlacement } from '../../src/interaction/grids'
import { Volume } from '../../src/core/volume'

/** 用真实 Volume + modelBounds 造 bounds（与 updateGrids 同一条取值路径） */
function boundsOf(cells: Array<[number, number, number]>) {
  const volume = new Volume()
  const key = internBuiltin(volume.palette).get('color:red')!
  for (const [x, y, z] of cells) volume.setBlock(x, y, z, key)
  return modelBounds(volume)
}

describe('D2 · 网格线落在整数边界（V4：能数格子）', () => {
  const cases: Array<{ name: string; bounds: ReturnType<typeof boundsOf> }> = [
    { name: '坯料 0..2（AABB 中心 = 1.5，半整数）', bounds: boundsOf([[0, 0, 0], [2, 2, 2]]) },
    { name: '0..10 放置后（AABB 中心 = 5.5）', bounds: boundsOf([[0, 0, 0], [2, 2, 2], [10, 0, 10]]) },
    { name: '负偏移 -7..5', bounds: boundsOf([[-7, 0, -7], [5, 0, 5]]) },
    { name: '单块 (4,0,4)（中心 = 4.5）', bounds: boundsOf([[4, 0, 4]]) },
    { name: '空模型（bounds = null）', bounds: null },
  ]

  it.each(cases)('$name：线位对 1 取模 == 0 · cell = 1 · size 为偶', ({ bounds }) => {
    const p = gridPlacement(bounds)
    expect(p.divisions).toBe(p.size) // cell = size/divisions = 1
    expect(Number.isInteger(p.centerX)).toBe(true) // 线位 = center + k ⇒ center 取整即线在整数边界
    expect(Number.isInteger(p.centerZ)).toBe(true)
    expect(Number.isInteger(p.size / 2)).toBe(true) // 四角（center ± size/2）也落在整数
  })

  it.each(cases.filter((c) => c.bounds))('$name：网格罩住模型 AABB 且中心不漂出 ±0.5', ({ bounds }) => {
    const b = bounds!
    const p = gridPlacement(b)
    expect(p.centerX - p.size / 2).toBeLessThanOrEqual(b.minX)
    expect(b.maxX + 1).toBeLessThanOrEqual(p.centerX + p.size / 2)
    expect(p.centerZ - p.size / 2).toBeLessThanOrEqual(b.minZ)
    expect(b.maxZ + 1).toBeLessThanOrEqual(p.centerZ + p.size / 2)
    expect(Math.abs(p.centerX - b.centerX)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(p.centerZ - b.centerZ)).toBeLessThanOrEqual(0.5)
  })
})
