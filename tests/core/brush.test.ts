// r02 前半 · F7 笔刷框架（V6 体积 / V7 布尔语义 / Q7 隐藏层）——纯函数坐标级比对。
// 谓词与体积是 UI（Viewport/BrushPanel）与后半程序化操作共用的唯一出处（brush 模块独立约束）。
import { describe, expect, it } from 'vitest'
import { applyBrush } from '../../src/core/brush/apply'
import { canWriteCell, isLayerVisible } from '../../src/core/brush/predicate'
import { brushVolume, validateBrushSize } from '../../src/core/brush/volume'
import { BRUSH_MAX_AXIS } from '../../src/core/brush'
import { internBuiltin } from '../../src/core/builtin-palette'
import type { Coord } from '../../src/core/types'
import { Volume } from '../../src/core/volume'

function keyOf(volume: Volume, identity: string): number {
  return internBuiltin(volume.palette).get(identity)!
}

const cellKey = (c: Coord): string => `${c.x},${c.y},${c.z}`

describe('V6 · 笔刷体积（角对齐）', () => {
  it('1×1×1 ⇒ 恰为锚点格本身（= "点面加块"，Q1 同一套规则）', () => {
    const cells = brushVolume({ x: 1, y: 1, z: 1 }, { x: 5, y: -3, z: 9 })
    expect(cells.map(cellKey)).toEqual(['5,-3,9'])
  })

  it('3×3×3 ⇒ 锚点为最小角，向 +x/+y/+z 延伸，27 格按字典序', () => {
    const cells = brushVolume({ x: 3, y: 3, z: 3 }, { x: 0, y: 0, z: 0 })
    expect(cells).toHaveLength(27)
    expect(cells[0]).toEqual({ x: 0, y: 0, z: 0 })
    expect(cells[26]).toEqual({ x: 2, y: 2, z: 2 })
    // 字典序（与遍历顺序无关，N3 同口径）
    for (let i = 1; i < cells.length; i++) {
      const a = cells[i - 1]!
      const b = cells[i]!
      expect(a.x < b.x || (a.x === b.x && a.y < b.y) || (a.x === b.x && a.y === b.y && a.z < b.z)).toBe(true)
    }
  })

  it('2×2×1 于负坐标锚点 ⇒ 逐坐标相等', () => {
    const cells = brushVolume({ x: 2, y: 2, z: 1 }, { x: -1, y: 4, z: -2 })
    expect(new Set(cells.map(cellKey))).toEqual(new Set(['-1,4,-2', '0,4,-2', '-1,5,-2', '0,5,-2']))
  })

  it('每调用上限：轴 1–8（越界 ⇒ 教学式报错）；8×8×8 = 512 恰为上限放行', () => {
    expect(() => validateBrushSize({ x: 0, y: 1, z: 1 })).toThrow(/1–8/)
    expect(() => validateBrushSize({ x: BRUSH_MAX_AXIS + 1, y: 1, z: 1 })).toThrow(/1–8/)
    expect(brushVolume({ x: 8, y: 8, z: 8 }, { x: 0, y: 0, z: 0 })).toHaveLength(512)
  })
})

describe('V7 · 单一谓词与布尔语义（Q2 四则：Place/Erase/Paint/Override）', () => {
  it('canWriteCell 四则逐条', () => {
    // place 增量：只写空气
    expect(canWriteCell({ action: 'place', override: false, currentKey: 0, layerVisible: true })).toBe(true)
    expect(canWriteCell({ action: 'place', override: false, currentKey: 7, layerVisible: true })).toBe(false)
    // place 替换（Override）：空气与已有块都写
    expect(canWriteCell({ action: 'place', override: true, currentKey: 0, layerVisible: true })).toBe(true)
    expect(canWriteCell({ action: 'place', override: true, currentKey: 7, layerVisible: true })).toBe(true)
    // erase / paint：只作用已有块
    expect(canWriteCell({ action: 'erase', override: false, currentKey: 7, layerVisible: true })).toBe(true)
    expect(canWriteCell({ action: 'erase', override: true, currentKey: 0, layerVisible: true })).toBe(false)
    expect(canWriteCell({ action: 'paint', override: false, currentKey: 7, layerVisible: true })).toBe(true)
    expect(canWriteCell({ action: 'paint', override: false, currentKey: 0, layerVisible: true })).toBe(false)
    // Q7：层被隐藏 ⇒ 一律不可写
    for (const action of ['place', 'erase', 'paint'] as const) {
      expect(canWriteCell({ action, override: false, currentKey: 7, layerVisible: false })).toBe(false)
      expect(canWriteCell({ action, override: true, currentKey: 0, layerVisible: false })).toBe(false)
    }
  })

  it('isLayerVisible：below = y ≤ 滑块；single = 只该层；null = 全可见', () => {
    expect(isLayerVisible({ mode: 'below', y: 1 }, 0)).toBe(true)
    expect(isLayerVisible({ mode: 'below', y: 1 }, 1)).toBe(true)
    expect(isLayerVisible({ mode: 'below', y: 1 }, 2)).toBe(false)
    expect(isLayerVisible({ mode: 'single', y: 1 }, 1)).toBe(true)
    expect(isLayerVisible({ mode: 'single', y: 1 }, 0)).toBe(false)
    expect(isLayerVisible(null, -5)).toBe(true)
  })

  it('增量放置：已有块逐坐标不变（before==after 不出补丁）', () => {
    const volume = new Volume()
    const red = keyOf(volume, 'color:red')
    const blue = keyOf(volume, 'color:blue')
    volume.setBlock(0, 0, 0, red)
    volume.setBlock(1, 0, 0, red)
    const before = volume.blockCoordKeys()
    const r = applyBrush(volume, { size: { x: 3, y: 1, z: 1 }, anchor: { x: 0, y: 0, z: 0 }, action: 'place', mode: 'additive', key: blue }, null)
    // 只有空气格（2,0,0）进变更；已有块 (0,0,0)(1,0,0) 不在 changes 里 ⇒ 不覆盖
    expect(r.changes.map(cellKey)).toEqual(['2,0,0'])
    expect(r.rejected.occupied).toBe(2)
    // 变更未应用（纯函数只读）——坐标集合与键值原样
    expect(volume.blockCoordKeys()).toEqual(before)
    expect(volume.getBlock(0, 0, 0)).toBe(red)
  })

  it('替换放置：体积内逐块覆盖（含已有块换键）', () => {
    const volume = new Volume()
    const red = keyOf(volume, 'color:red')
    const blue = keyOf(volume, 'color:blue')
    volume.setBlock(0, 0, 0, red)
    const r = applyBrush(volume, { size: { x: 2, y: 1, z: 1 }, anchor: { x: 0, y: 0, z: 0 }, action: 'place', mode: 'override', key: blue }, null)
    expect(r.changes).toEqual([
      { x: 0, y: 0, z: 0, before: red, after: blue },
      { x: 1, y: 0, z: 0, before: 0, after: blue },
    ])
  })

  it('擦除：体积内全清（只清已有；空气格不进补丁）', () => {
    const volume = new Volume()
    const red = keyOf(volume, 'color:red')
    volume.setBlock(0, 0, 0, red)
    volume.setBlock(2, 0, 0, red)
    const r = applyBrush(volume, { size: { x: 3, y: 1, z: 1 }, anchor: { x: 0, y: 0, z: 0 }, action: 'erase', mode: 'additive', key: 0 }, null)
    expect(r.changes).toEqual([
      { x: 0, y: 0, z: 0, before: red, after: 0 },
      { x: 2, y: 0, z: 0, before: red, after: 0 },
    ])
    expect(r.rejected.empty).toBe(1) // (1,0,0) 是空气
  })

  it('上色：只改已有块、不新增', () => {
    const volume = new Volume()
    const red = keyOf(volume, 'color:red')
    const blue = keyOf(volume, 'color:blue')
    volume.setBlock(0, 0, 0, red)
    const r = applyBrush(volume, { size: { x: 2, y: 1, z: 1 }, anchor: { x: 0, y: 0, z: 0 }, action: 'paint', mode: 'additive', key: blue }, null)
    expect(r.changes).toEqual([{ x: 0, y: 0, z: 0, before: red, after: blue }])
    expect(r.rejected.empty).toBe(1)
    // 同色上色 = 零变化（不进补丁；计数给"零变化反馈"）
    const r2 = applyBrush(volume, { size: { x: 1, y: 1, z: 1 }, anchor: { x: 0, y: 0, z: 0 }, action: 'paint', mode: 'additive', key: red }, null)
    expect(r2.changes).toEqual([])
    expect(r2.rejected.unchanged).toBe(1)
  })

  it('Q7：层次过滤 ⇒ 隐藏层的格子一律拒绝且计入 hidden', () => {
    const volume = new Volume()
    const red = keyOf(volume, 'color:red')
    volume.setBlock(0, 1, 0, red)
    // below y=0：第 1 层被隐藏 ⇒ 对 (0,1,0) 上色 / 放置 / 擦除都无变更
    const filter = { mode: 'below' as const, y: 0 }
    for (const action of ['place', 'erase', 'paint'] as const) {
      const r = applyBrush(volume, { size: { x: 1, y: 1, z: 1 }, anchor: { x: 0, y: 1, z: 0 }, action, mode: 'additive', key: 9 }, filter)
      expect(r.changes).toEqual([])
      expect(r.rejected.hidden).toBe(1)
    }
    // 可见层照常
    const ok = applyBrush(volume, { size: { x: 1, y: 1, z: 1 }, anchor: { x: 0, y: 1, z: 0 }, action: 'paint', mode: 'additive', key: red + 1 }, null)
    expect(ok.changes).toHaveLength(1)
  })
})
