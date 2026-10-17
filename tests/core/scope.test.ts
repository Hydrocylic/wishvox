// N3 · 范围解析确定性（REQ-051 + REQ-014 宾语面）：resolveScope 是纯函数；
// 同一引用 + 同一模型 ⇒ 同一块集合（与遍历顺序无关，输出按 (x,y,z) 排序）；
// 组合 = 成员 part 当前块 ∪ 仍存在的手工块坐标（逐元素相等）。
import { describe, expect, it } from 'vitest'
import { internBuiltin } from '../../src/core/builtin-palette'
import { CompositionRegistry } from '../../src/core/composition'
import { PatchLog } from '../../src/core/patch-log'
import { PartRegistry } from '../../src/core/parts'
import { resolveScope } from '../../src/core/scope'
import { Volume } from '../../src/core/volume'

function makeWorld(): {
  volume: Volume
  parts: PartRegistry
  compositions: CompositionRegistry
  log: PatchLog
  k: (identity: string) => number
  wallId: string
  roofId: string
} {
  const volume = new Volume()
  const keys = internBuiltin(volume.palette)
  const parts = new PartRegistry()
  const compositions = new CompositionRegistry()
  const log = new PatchLog(volume, parts)
  const wall = log.createPart('墙体')
  for (let x = 0; x < 4; x++) {
    log.apply({ type: 'set', x, y: 0, z: 0, key: keys.get('color:red-brick')!, partId: wall.id })
  }
  const roof = log.createPart('屋顶')
  for (let x = 0; x < 4; x++) {
    log.apply({ type: 'set', x, y: 1, z: 0, key: keys.get('color:blue')!, partId: roof.id })
  }
  // 手工块两枚（无归属）
  log.apply({ type: 'set', x: 9, y: 0, z: 9, key: keys.get('color:green')! })
  log.apply({ type: 'set', x: 9, y: 0, z: 10, key: keys.get('color:green')! })
  return { volume, parts, compositions, log, k: (i) => keys.get(i)!, wallId: wall.id, roofId: roof.id }
}

const coords = (list: Array<[number, number, number]>): Array<{ x: number; y: number; z: number }> =>
  list.map(([x, y, z]) => ({ x, y, z }))

describe('N3 · resolveScope（范围 / 宾语语义）', () => {
  it('全体 / 手工块 / 构件：各自解析正确且输出有序（与遍历顺序无关）', () => {
    const w = makeWorld()
    const all = resolveScope(w.volume, w.parts, w.compositions, { kind: 'all' })
    expect(all).toHaveLength(10)
    expect(all).toEqual(all.slice().sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z))
    expect(resolveScope(w.volume, w.parts, w.compositions, { kind: 'manual' })).toEqual(
      coords([
        [9, 0, 9],
        [9, 0, 10],
      ]),
    )
    expect(resolveScope(w.volume, w.parts, w.compositions, { kind: 'part', partId: w.roofId })).toEqual(
      coords([
        [0, 1, 0],
        [1, 1, 0],
        [2, 1, 0],
        [3, 1, 0],
      ]),
    )
  })

  it('组合 = 成员 part ∪ 手工块（逐元素相等）；被删的手工块自动退场、成员 part 后来新增的块自动进场（语义视图）', () => {
    const w = makeWorld()
    const comp = w.compositions.create('屋顶带烟囱')
    w.compositions.addPart(comp.id, w.roofId)
    w.compositions.addManualBlock(comp.id, 9, 0, 9) // 只并一枚手工块
    w.compositions.addManualBlock(comp.id, 5, 5, 5) // 坐标存在但当前无块 ⇒ 不解析

    const resolved = resolveScope(w.volume, w.parts, w.compositions, { kind: 'composition', compositionId: comp.id })
    // 屋顶 4 块 ∪ 手工块 1 块（(9,0,10) 不在组合；(5,5,5) 无块）——与"成员 part ∪ 手工块"逐元素相等
    const manual = resolveScope(w.volume, w.parts, w.compositions, { kind: 'manual' })
    const roof = resolveScope(w.volume, w.parts, w.compositions, { kind: 'part', partId: w.roofId })
    const expected = [...roof, ...manual.filter((c) => c.x === 9 && c.z === 9)]
    expect(resolved).toEqual(expected)
    expect(resolved).toHaveLength(5)

    // 语义视图：屋顶 part 后来新增的块自动进组合；组合里的手工块被删后退场
    w.log.apply({ type: 'set', x: 0, y: 1, z: 1, key: w.k('color:blue'), partId: w.roofId })
    w.log.apply({ type: 'delete', x: 9, y: 0, z: 9 })
    const resolved2 = resolveScope(w.volume, w.parts, w.compositions, { kind: 'composition', compositionId: comp.id })
    expect(resolved2).toEqual(
      coords([
        [0, 1, 0],
        [0, 1, 1],
        [1, 1, 0],
        [2, 1, 0],
        [3, 1, 0],
      ]),
    )
  })

  it('同一引用重复解析 ⇒ 同一结果（确定性）；空 / 不存在 ⇒ 空数组（操作侧转"无块可改"反馈）', () => {
    const w = makeWorld()
    const ref = { kind: 'all' as const }
    expect(resolveScope(w.volume, w.parts, w.compositions, ref)).toEqual(
      resolveScope(w.volume, w.parts, w.compositions, ref),
    )
    expect(resolveScope(w.volume, w.parts, w.compositions, { kind: 'part', partId: 'part-999' })).toEqual([])
    expect(resolveScope(w.volume, w.parts, w.compositions, { kind: 'composition', compositionId: 'comp-999' })).toEqual([])
    const emptyPart = w.parts.create('空', 0)
    expect(resolveScope(w.volume, w.parts, w.compositions, { kind: 'part', partId: emptyPart.id })).toEqual([])
  })
})
