// I2 · 补丁日志：apply∘inverse = identity；replay(log) = 当前模型；undo 深度 = 1
// （REQ-017 undo/redo/重放；REQ-016 每操作恰好 1 次撤销；REQ-023 ② 回退到构件）
import { describe, expect, it } from 'vitest'
import { internBuiltin } from '../../src/core/builtin-palette'
import { CompositionRegistry } from '../../src/core/composition'
import { PatchLog } from '../../src/core/patch-log'
import { applyProgramOp } from '../../src/ops/apply'
import { PartRegistry } from '../../src/core/parts'
import type { DeleteOp, ProgramOp, SetOp } from '../../src/core/types'
import { Volume } from '../../src/core/volume'

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Fixture {
  volume: Volume
  parts: PartRegistry
  log: PatchLog
  keys: Map<string, number>
  randomOp(rng: () => number): SetOp | DeleteOp
}

function makeFixture(): Fixture {
  const volume = new Volume()
  const keys = internBuiltin(volume.palette)
  const parts = new PartRegistry()
  const log = new PatchLog(volume, parts)
  const ids = [...keys.keys()]
  const randomOp = (rng: () => number): SetOp | DeleteOp => {
    const x = Math.floor(rng() * 24) - 12
    const y = Math.floor(rng() * 8) - 4
    const z = Math.floor(rng() * 24) - 12
    const roll = rng()
    if (roll < 0.55) {
      const identity = ids[Math.floor(rng() * ids.length)]!
      return { type: 'set', x, y, z, key: keys.get(identity)!, partId: undefined }
    }
    return { type: 'delete', x, y, z, partId: undefined }
  }
  return { volume, parts, log, keys, randomOp }
}

describe('I2 · 补丁日志', () => {
  it('apply(p) 后 apply(inverse(p)) ⇒ 逐块相等（随机 120 条，含重复放置）', () => {
    const f = makeFixture()
    const rng = mulberry32(42)
    for (let i = 0; i < 120; i++) {
      const before = f.volume.digest()
      f.log.apply(f.randomOp(rng))
      f.log.undo() // undo = 应用逆补丁
      expect(f.volume.digest()).toEqual(before)
    }
  })

  it('replay(log) = 当前模型：逐块相等 + 构件归属一致', () => {
    const f = makeFixture()
    const rng = mulberry32(2026)
    const part = f.log.createPart('A 幢')
    // 200 条随机操作，其中一部分挂在构件 A 上
    for (let i = 0; i < 200; i++) {
      const op = f.randomOp(rng)
      f.log.apply(op.partId ? op : { ...op, partId: rng() < 0.5 ? part.id : undefined })
    }
    const replayed = PatchLog.replay(f.log.patches, f.volume.palette.list(), f.log.partCreations)
    expect(replayed.volume.digest()).toEqual(f.volume.digest())
    expect(replayed.parts.serialize()).toEqual(f.parts.serialize())
    // 撒一些 undo/redo 后再验一次（交错序列）
    for (let i = 0; i < 20; i++) f.log.undo()
    for (let i = 0; i < 10; i++) f.log.redo()
    const replayed2 = PatchLog.replay(f.log.patches, f.volume.palette.list(), f.log.partCreations)
    expect(replayed2.volume.digest()).toEqual(f.volume.digest())
    expect(replayed2.parts.serialize()).toEqual(f.parts.serialize())
  })

  it('undo 深度 = 1：一次操作恰好 1 次撤销可退（放置 / 擦除 / 改色三类）', () => {
    // 放置
    {
      const f = makeFixture()
      const d0 = f.volume.digest()
      f.log.apply({ type: 'set', x: 0, y: 0, z: 0, key: f.keys.get('color:red')! })
      expect(f.volume.digest()).not.toEqual(d0)
      expect(f.log.undo()).not.toBeNull()
      expect(f.volume.digest()).toEqual(d0)
      expect(f.log.canUndo).toBe(false) // 不再需要第二次撤销
    }
    // 擦除
    {
      const f = makeFixture()
      f.log.apply({ type: 'set', x: 0, y: 0, z: 0, key: f.keys.get('color:red')! })
      f.log.apply({ type: 'set', x: 1, y: 0, z: 0, key: f.keys.get('color:blue')! })
      const d0 = f.volume.digest()
      f.log.apply({ type: 'delete', x: 0, y: 0, z: 0 })
      expect(f.volume.digest()).not.toEqual(d0)
      f.log.undo()
      expect(f.volume.digest()).toEqual(d0)
    }
    // 改色
    {
      const f = makeFixture()
      f.log.apply({ type: 'set', x: 0, y: 0, z: 0, key: f.keys.get('color:white')! })
      const d0 = f.volume.digest()
      f.log.apply({ type: 'set', x: 0, y: 0, z: 0, key: f.keys.get('color:black')! })
      expect(f.volume.digest()).not.toEqual(d0)
      f.log.undo()
      expect(f.volume.digest()).toEqual(d0)
      expect(f.log.canUndo).toBe(true) // 之前还有一条放置，可继续退——但"本操作"一次已退净
    }
  })

  it('REQ-016：三类操作各 50 次随机序列，每次 1 次撤销即回到操作前', () => {
    const f = makeFixture()
    const rng = mulberry32(7)
    // 铺一层底，保证擦除有东西可擦
    for (let x = 0; x < 8; x++) {
      for (let z = 0; z < 8; z++) {
        f.log.apply({ type: 'set', x, y: 0, z, key: f.keys.get('color:light-gray')! })
      }
    }
    const tryOp = (op: SetOp | DeleteOp): void => {
      const before = f.volume.digest()
      f.log.apply(op)
      f.log.undo()
      expect(f.volume.digest()).toEqual(before)
      f.log.redo() // 序列继续向前
    }
    for (let i = 0; i < 50; i++) tryOp(f.randomOp(rng)) // 混合放置/擦除
    for (let i = 0; i < 50; i++) {
      const x = Math.floor(rng() * 8)
      const z = Math.floor(rng() * 8)
      const y = 1
      const before = f.volume.digest()
      f.log.apply({ type: 'set', x, y, z, key: f.keys.get('color:orange')! })
      f.log.undo()
      expect(f.volume.digest()).toEqual(before)
      f.log.redo()
    }
    for (let i = 0; i < 50; i++) {
      const x = Math.floor(rng() * 8)
      const z = Math.floor(rng() * 8)
      const before = f.volume.digest()
      f.log.apply({ type: 'delete', x, y: 0, z })
      f.log.undo()
      expect(f.volume.digest()).toEqual(before)
      f.log.redo()
    }
    // 全程 replay 仍一致
    const replayed = PatchLog.replay(f.log.patches, f.volume.palette.list(), f.log.partCreations)
    expect(replayed.volume.digest()).toEqual(f.volume.digest())
  })

  it('undo/redo 交错到任一点后，重放 = 当前模型（REQ-017）', () => {
    const f = makeFixture()
    const rng = mulberry32(99)
    for (let i = 0; i < 60; i++) f.log.apply(f.randomOp(rng))
    const walk = mulberry32(1000)
    for (let step = 0; step < 80; step++) {
      if (walk() < 0.45 && f.log.canUndo) f.log.undo()
      else if (f.log.canRedo) f.log.redo()
      else f.log.apply(f.randomOp(rng))
    }
    const replayed = PatchLog.replay(f.log.patches, f.volume.palette.list(), f.log.partCreations)
    expect(replayed.volume.digest()).toEqual(f.volume.digest())
  })

  it('REQ-023 ②：回退到构件 = 该构件创建时的快照（逐块相等）', () => {
    const f = makeFixture()
    const part = f.log.createPart('主楼')
    const patch = f.log.apply({
      type: 'set',
      x: 0,
      y: 0,
      z: 0,
      key: f.keys.get('color:red-brick')!,
      partId: part.id,
    })
    f.log.ensureSnapshot(patch.seq) // editor 在构件创建时保证锚点快照
    const anchor = f.volume.digest()
    // 之后做很多事：别的构件、游离块、再回退
    const other = f.log.createPart('副楼')
    for (let i = 1; i <= 30; i++) {
      f.log.apply({
        type: 'set',
        x: i,
        y: 0,
        z: 0,
        key: f.keys.get('color:blue')!,
        partId: i % 2 === 0 ? other.id : part.id,
      })
    }
    for (let i = 0; i < 10; i++) f.log.undo()
    expect(f.volume.digest()).not.toEqual(anchor)
    f.log.rollbackToSeq(part.createdAtPatch)
    expect(f.volume.digest()).toEqual(anchor)
    expect(f.log.patches).toHaveLength(part.createdAtPatch + 1)
    expect(f.log.canRedo).toBe(false)
    expect(f.parts.get(part.id)!.name).toBe('主楼')
  })
})

// ── r02 追加：I2 批量扩展（一次程序化操作 = 恰好 1 条补丁；批量 apply∘inverse；含程序补丁的重放）──

interface BatchFixture extends Fixture {
  comps: CompositionRegistry
}

function opFixture(): BatchFixture {
  const f = makeFixture()
  return { ...f, comps: new CompositionRegistry() }
}

describe('I2 批量扩展 · applyOp（r02）', () => {
  it('一次程序化操作 = 恰好 1 条补丁 + label 在位；一次撤销全退回', () => {
    const f = opFixture()
    // 两个角标撑出 6×6×1 的包围盒（内部 34 个空位给噪声填充）
    f.log.apply({ type: 'set', x: 0, y: 0, z: 0, key: f.keys.get('color:light-gray')! })
    f.log.apply({ type: 'set', x: 5, y: 0, z: 5, key: f.keys.get('color:light-gray')! })
    const basePatches = f.log.patches.length
    const base = f.volume.digest()
    const patch = applyProgramOp(f.log, 
      {
        type: 'program',
        name: 'noiseFill',
        params: { scope: { kind: 'all' }, density: 1, keys: [f.keys.get('color:orange')!], seed: 42 },
      },
      f.comps,
    )!
    expect(patch).toBeDefined()
    expect(patch.label).toBe('噪声填充(全体, 密度=1, 种子=42)')
    expect(f.log.patches).toHaveLength(basePatches + 1) // 恰好 1 条
    expect(f.volume.digest()).not.toEqual(base)
    expect(f.log.undo()).not.toBeNull()
    expect(f.volume.digest()).toEqual(base) // 一次撤销全退回
    expect(f.log.canUndo).toBe(true) // 之前的底板还能退，但"本操作"一次已退净
    expect(f.log.redo()).not.toBeNull()
    expect(f.volume.digest()).not.toEqual(base) // 重做恢复操作效果
  })

  it('批量 apply ∘ inverse = identity：8 个操作逐个"应用→撤销→比对"（体积摘要 + 逐坐标归属）', () => {
    const ops: Array<(f: BatchFixture) => ProgramOp> = [
      (f) => ({ type: 'program', name: 'noiseFill', params: { scope: { kind: 'all' }, density: 0.7, keys: [f.keys.get('color:orange')!], seed: 9 } }),
      (f) => ({ type: 'program', name: 'presetShape', params: { shape: 'box', origin: { x: 0, y: 0, z: 0 }, size: { x: 4, y: 3, z: 4 }, key: f.keys.get('color:red')!, hollow: true } }),
      () => ({ type: 'program', name: 'raiseByLayers', params: { scope: { kind: 'all' }, layers: 3 } }),
      (f) => ({ type: 'program', name: 'addLayer', params: { scope: { kind: 'all' }, count: 2, key: f.keys.get('color:yellow')! } }),
      (f) => ({ type: 'program', name: 'recolor', params: { scope: { kind: 'all' }, toKey: f.keys.get('color:white')! } }),
      () => ({ type: 'program', name: 'clearScope', params: { scope: { kind: 'manual' } } }),
      () => ({ type: 'program', name: 'mirrorArray', params: { scope: { kind: 'all' }, axis: 'z', copies: 2, spacing: 1 } }),
      () => ({ type: 'program', name: 'bevelEdges', params: { scope: { kind: 'all' }, radius: 2, passes: 2 } }),
    ]
    for (const make of ops) {
      const f = opFixture()
      const owner = f.log.createPart('有主')
      f.log.apply({ type: 'set', x: 0, y: 0, z: 0, key: f.keys.get('color:red-brick')!, partId: owner.id })
      f.log.apply({ type: 'set', x: 3, y: 1, z: 3, key: f.keys.get('color:blue')! }) // 手工块
      const digestBefore = f.volume.digest()
      const partsBefore = JSON.stringify(f.parts.list().map((p) => [p.id, [...p.blocks].sort()]))
      const op = make(f)
      const patch = applyProgramOp(f.log, op, f.comps)
      if (patch !== null) {
        expect(f.volume.digest(), `${op.name} 应产生变化`).not.toEqual(digestBefore)
        f.log.undo()
        expect(f.volume.digest(), `${op.name} 撤销后应还原`).toEqual(digestBefore)
        // 归属还原：撤销后非空构件的 (id → 块集合) 与撤销前一致（操作的空构件不在比对里——r01 口径：构件创建不随撤销消失）
        const after = JSON.stringify(
          f.parts.list().filter((p) => p.blocks.size > 0).map((p) => [p.id, [...p.blocks].sort()]),
        )
        expect(after, `${op.name} 撤销后归属应还原`).toBe(partsBefore)
      }
    }
  })

  it('replay(log) = 当前模型：程序化补丁与单块补丁交错，含 undo/redo 交错（REQ-017）', () => {
    const f = opFixture()
    const owner = f.log.createPart('有主')
    for (let i = 0; i < 12; i++) {
      f.log.apply({ type: 'set', x: i, y: 0, z: 0, key: f.keys.get('color:red-brick')!, partId: owner.id })
    }
    applyProgramOp(f.log, 
      { type: 'program', name: 'presetShape', params: { shape: 'sphere', origin: { x: 0, y: 2, z: 2 }, size: { x: 5, y: 5, z: 5 }, key: f.keys.get('color:teal')! } },
      f.comps,
    )
    f.log.apply({ type: 'set', x: 20, y: 0, z: 20, key: f.keys.get('color:green')! })
    applyProgramOp(f.log, { type: 'program', name: 'recolor', params: { scope: { kind: 'all' }, toKey: f.keys.get('color:purple')! } }, f.comps)
    f.log.undo()
    applyProgramOp(f.log, 
      { type: 'program', name: 'mirrorArray', params: { scope: { kind: 'all' }, axis: 'x', copies: 1, spacing: 0 } },
      f.comps,
    )
    f.log.undo()
    f.log.redo()
    const replayed = PatchLog.replay(f.log.patches, f.volume.palette.list(), f.log.partCreations)
    expect(replayed.volume.digest()).toEqual(f.volume.digest())
    expect(replayed.parts.serialize()).toEqual(f.parts.serialize())
  })

  it('零新格的 applyOp ⇒ 不产出构件（partId = null、册不增）；undo 语义不变（plan §5.4.1）', () => {
    const f = opFixture()
    const box = (key: number): ProgramOp => ({
      type: 'program',
      name: 'presetShape',
      params: { shape: 'box', origin: { x: 0, y: 0, z: 0 }, size: { x: 3, y: 3, z: 3 }, key, hollow: true },
    })
    applyProgramOp(f.log, box(f.keys.get('color:white')!), f.comps)! // 首次：26 个新格 ⇒ 一个构件（用户实测参数）
    const partsBefore = f.parts.list().length
    const creationsBefore = f.log.partCreations.length
    const digestBefore = f.volume.digest()
    // 同一处再应用同盒、只换材质 ⇒ 26 格全是覆写（before>0）⇒ 零新格。
    // D-E 限定"产出新块时"才产构件：零新块的操作不留下 0 块构件。
    const patch = applyProgramOp(f.log, box(f.keys.get('color:red')!), f.comps)!
    expect(patch.changes.length).toBeGreaterThan(0) // 有变化 ⇒ 仍记一条补丁
    expect(patch.changes.every((c) => c.before > 0)).toBe(true) // 自证：确实零新格
    expect(patch.partId).toBeNull()
    expect(f.parts.list()).toHaveLength(partsBefore)
    expect(f.log.partCreations).toHaveLength(creationsBefore)
    f.log.undo() // 一步退回前一次材质；册里不多出 0 块构件
    expect(f.volume.digest()).toEqual(digestBefore)
    expect(f.parts.list()).toHaveLength(partsBefore)
  })
})
