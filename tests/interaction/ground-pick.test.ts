// T14 · 工作平面落格纯函数（L1）：pick() 未点中模型时的平面落格规则（P2 起 = 独立工作平面，含 y≠0 与双向观察）。
// 判据目录 = 笔记库 curriculum/testing-plan.md；本件无头断言，不依赖 three / DOM。
// P2（A-03/A-05，`REQ-048`/`REQ-065`）改动：落点 y = 显式工作平面高度（不再硬编码 0）；
// 上下两个方向都可命中同一格（底面编辑）；数域沿用 ±2¹²（旧 ±256"过远"特例废止）。
import { describe, expect, it } from 'vitest'
import { GROUND_HALF_EXTENT, pickGroundCell } from '../../src/interaction/ground-pick'
import { COORD_LIMIT } from '../../src/core/coords'

describe('T14 · 工作平面落格（射线 × y=height 平面）', () => {
  it('贴地正坐标：垂直向下 ⇒ 取整到所在格、y = 0', () => {
    expect(pickGroundCell([3.2, 10, 4.7], [0, -1, 0])).toEqual([3, 0, 4])
  })

  it('负坐标：floor 语义（-2.5 → 格 -3，不是 -2）', () => {
    expect(pickGroundCell([-2.5, 8, -3.7], [0, -1, 0])).toEqual([-3, 0, -4])
  })

  it('斜射线：沿方向与平面交于同一点（方向不必归一化）', () => {
    expect(pickGroundCell([0, 10, 0], [0.6, -0.8, 0])).toEqual([7, 0, 0]) // t = 12.5 ⇒ 落点 x = 7.5
  })

  it('P2 双向：从下往上观察同一工作平面 ⇒ 命中同一格（A-05 底面编辑）', () => {
    expect(pickGroundCell([3.2, -10, 4.7], [0, 1, 0], 0)).toEqual([3, 0, 4])
  })

  it('P2 工作高度 ≠ 0：落格 y = 显式高度（含负层），不与过滤层耦合', () => {
    expect(pickGroundCell([3.2, 10, 4.7], [0, -1, 0], -3)).toEqual([3, -3, 4])
    expect(pickGroundCell([3.2, -10, 4.7], [0, 1, 0], 4)).toEqual([3, 4, 4])
  })

  it('数域边界：落格 = ±2¹² 有效；落格越界被拒绝（REQ-065 取代旧 ±256 特例）', () => {
    expect(pickGroundCell([GROUND_HALF_EXTENT, 10, 0], [0, -1, 0])).toEqual([GROUND_HALF_EXTENT, 0, 0])
    expect(GROUND_HALF_EXTENT).toBe(COORD_LIMIT)
    // 判据 = **落格**在域内（射线原点在域外但落格合法 ⇒ 仍可放置，不做位运算截断）
    expect(pickGroundCell([GROUND_HALF_EXTENT + 0.5, 10, 0], [0, -1, 0])).toEqual([GROUND_HALF_EXTENT, 0, 0])
    // 落格越界（4097 / -4098）⇒ 拒绝
    expect(pickGroundCell([GROUND_HALF_EXTENT + 1.5, 10, 0], [0, -1, 0])).toBeNull()
    expect(pickGroundCell([0, 10, -(GROUND_HALF_EXTENT + 2.5)], [0, -1, 0])).toBeNull()
  })

  it('非法高度与非有限输入 ⇒ 拒绝（REQ-065：不截断、不写到另一格）', () => {
    expect(pickGroundCell([0, 10, 0], [0, -1, 0], 0.5)).toBeNull()
    expect(pickGroundCell([0, 10, 0], [0, -1, 0], NaN)).toBeNull()
    expect(pickGroundCell([0, 10, 0], [0, -1, 0], COORD_LIMIT + 1)).toBeNull()
    expect(pickGroundCell([NaN, 10, 0], [0, -1, 0])).toBeNull()
  })

  it('反向 / 平行 ⇒ 拒绝：射线背向平面或与平面平行', () => {
    expect(pickGroundCell([0, 10, 0], [0, 1, 0])).toBeNull()
    expect(pickGroundCell([0, 10, 0], [1, 0, 0])).toBeNull()
  })

  it('P2 允许从平面下方向上命中（底面可编辑）——只有背向才是拒绝', () => {
    expect(pickGroundCell([0, -5, 0], [0, 1, 0])).toEqual([0, 0, 0])
    expect(pickGroundCell([0, -5, 0], [0, -1, 0])).toBeNull() // 背离平面 ⇒ 仍拒绝
  })
})
