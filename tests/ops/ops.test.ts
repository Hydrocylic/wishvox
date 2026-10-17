// T5 · 8 个程序化操作的 L1 用例（每操作 ≥1 条）+ 边界（空范围 / 越界 / 单块）。
// 计数常量按格心中点采样公式算定（盒 3×2×3=18 · 柱 5×3×5=63 · 锥 5×5×5=37 · 球 5³=81 / 球 7³=179）——
// golden 口径：锁公式不被无意改动；另有结构性断言（对称 / 中轴 / 幂等）防"常量对了形状错了"。
import { describe, expect, it } from 'vitest'
import { internBuiltin } from '../../src/core/builtin-palette'
import { CompositionRegistry } from '../../src/core/composition'
import { PatchLog } from '../../src/core/patch-log'
import { applyProgramOp } from '../../src/ops/apply'
import { PartRegistry } from '../../src/core/parts'
import type { ProgramOp } from '../../src/core/types'
import { Volume } from '../../src/core/volume'

interface Fixture {
  volume: Volume
  parts: PartRegistry
  compositions: CompositionRegistry
  log: PatchLog
  k: (identity: string) => number
  run(op: ProgramOp): ReturnType<PatchLog['applyPlanned']>
}

function makeFixture(): Fixture {
  const volume = new Volume()
  const keys = internBuiltin(volume.palette)
  const parts = new PartRegistry()
  const compositions = new CompositionRegistry()
  const log = new PatchLog(volume, parts)
  return {
    volume,
    parts,
    compositions,
    log,
    k: (identity) => keys.get(identity)!,
    run: (op) => applyProgramOp(log, op, compositions),
  }
}

describe('T5 · 预设体块（盒·柱·锥·球，拍板 2026-10-03）', () => {
  it('盒：3×2×3 实心 = 18 块；hollow 4×4×4 = 56（64 − 内 8）', () => {
    const f = makeFixture()
    expect(
      f.run({ type: 'program', name: 'presetShape', params: { shape: 'box', origin: { x: 0, y: 0, z: 0 }, size: { x: 3, y: 2, z: 3 }, key: f.k('color:blue') } }),
    ).not.toBeNull()
    expect(f.volume.nonEmptyCount).toBe(18)
    expect(f.run({ type: 'program', name: 'presetShape', params: { shape: 'box', origin: { x: 10, y: 0, z: 0 }, size: { x: 4, y: 4, z: 4 }, key: f.k('color:red'), hollow: true } })).not.toBeNull()
    expect(f.volume.nonEmptyCount).toBe(18 + 56)
    // 掏空语义抽查：4×4×4 盒（origin=10）内腔 [11,12]³ 的中心空、壳的面实——常量对了形状也得对
    expect(f.volume.getBlock(11, 1, 1)).toBe(0)
    expect(f.volume.getBlock(10, 1, 1)).not.toBe(0) // 左壳面
    expect(f.volume.getBlock(11, 0, 1)).not.toBe(0) // 底壳面
  })

  it('柱（y 轴，x z 为直径）：5×3×5 实心 = 63 · hollow = 54；中轴 (2,·,2) 全实、角 (0,·,0) 空', () => {
    const f = makeFixture()
    f.run({ type: 'program', name: 'presetShape', params: { shape: 'cylinder', origin: { x: 0, y: 0, z: 0 }, size: { x: 5, y: 3, z: 5 }, key: f.k('color:teal') } })
    expect(f.volume.nonEmptyCount).toBe(63)
    expect(f.volume.getBlock(2, 1, 2)).toBe(f.k('color:teal'))
    expect(f.volume.getBlock(0, 1, 0)).toBe(0)
    const f2 = makeFixture()
    f2.run({ type: 'program', name: 'presetShape', params: { shape: 'cylinder', origin: { x: 0, y: 0, z: 0 }, size: { x: 5, y: 3, z: 5 }, key: f2.k('color:teal'), hollow: true } })
    expect(f2.volume.nonEmptyCount).toBe(54)
  })

  it('锥：5×5×5 = 37；逐层单调收窄（底 ≥ 腰 > 顶）且各层含中轴 (2,·,2)', () => {
    const f = makeFixture()
    f.run({ type: 'program', name: 'presetShape', params: { shape: 'cone', origin: { x: 0, y: 0, z: 0 }, size: { x: 5, y: 5, z: 5 }, key: f.k('color:yellow') } })
    expect(f.volume.nonEmptyCount).toBe(37)
    const layerCount = (y: number): number => {
      let n = 0
      for (let x = 0; x < 5; x++) for (let z = 0; z < 5; z++) if (f.volume.getBlock(x, y, z) !== 0) n++
      return n
    }
    expect(layerCount(0)).toBeGreaterThanOrEqual(layerCount(2))
    expect(layerCount(2)).toBeGreaterThan(layerCount(4))
    expect(f.volume.getBlock(2, 4, 2)).not.toBe(0) // 尖
  })

  it('球：5³ = 81（hollow = 62）· 7³ = 179（hollow = 98）；中心实、8 个包围盒角空', () => {
    const f = makeFixture()
    f.run({ type: 'program', name: 'presetShape', params: { shape: 'sphere', origin: { x: 0, y: 0, z: 0 }, size: { x: 5, y: 5, z: 5 }, key: f.k('color:green') } })
    expect(f.volume.nonEmptyCount).toBe(81)
    expect(f.volume.getBlock(2, 2, 2)).toBe(f.k('color:green'))
    expect(f.volume.getBlock(0, 0, 0)).toBe(0)
    expect(f.volume.getBlock(4, 4, 4)).toBe(0)
    const f2 = makeFixture()
    f2.run({ type: 'program', name: 'presetShape', params: { shape: 'sphere', origin: { x: -7, y: 0, z: -7 }, size: { x: 7, y: 7, z: 7 }, key: f2.k('color:green') } })
    expect(f2.volume.nonEmptyCount).toBe(179)
    const f3 = makeFixture()
    f3.run({ type: 'program', name: 'presetShape', params: { shape: 'sphere', origin: { x: 0, y: 0, z: 0 }, size: { x: 5, y: 5, z: 5 }, key: f3.k('color:green'), hollow: true } })
    expect(f3.volume.nonEmptyCount).toBe(62)
    expect(f3.volume.getBlock(2, 2, 2)).toBe(0) // 球心被掏空
  })

  it('边界：尺寸 0 ⇒ 空补丁（null）；负尺寸 / 超上限 ⇒ 明确报错且模型不变', () => {
    const f = makeFixture()
    expect(
      f.run({ type: 'program', name: 'presetShape', params: { shape: 'box', origin: { x: 0, y: 0, z: 0 }, size: { x: 0, y: 3, z: 3 }, key: f.k('color:red') } }),
    ).toBeNull()
    expect(() =>
      f.run({ type: 'program', name: 'presetShape', params: { shape: 'box', origin: { x: 0, y: 0, z: 0 }, size: { x: -1, y: 3, z: 3 }, key: f.k('color:red') } }),
    ).toThrow(/尺寸/)
    expect(() =>
      f.run({ type: 'program', name: 'presetShape', params: { shape: 'box', origin: { x: 0, y: 0, z: 0 }, size: { x: 200, y: 200, z: 200 }, key: f.k('color:red') } }),
    ).toThrow(/上限/)
    expect(f.volume.nonEmptyCount).toBe(0)
    expect(f.log.patches).toHaveLength(0)
  })
})

describe('T5 · 噪声填充', () => {
  it('范围内包围盒的空位按密度填充、已有块不动（density=1 全填）', () => {
    const f = makeFixture()
    f.log.apply({ type: 'set', x: 0, y: 0, z: 0, key: f.k('color:red') })
    f.log.apply({ type: 'set', x: 4, y: 0, z: 4, key: f.k('color:red') })
    const patch = f.run({ type: 'program', name: 'noiseFill', params: { scope: { kind: 'all' }, density: 1, keys: [f.k('color:blue')], seed: 7 } })
    expect(patch).not.toBeNull()
    // 包围盒 5×1×5 = 25 格，原 2 块保留 ⇒ 共 25 块
    expect(f.volume.nonEmptyCount).toBe(25)
    expect(f.volume.getBlock(0, 0, 0)).toBe(f.k('color:red')) // 已有块不动
    expect(f.volume.getBlock(3, 0, 2)).toBe(f.k('color:blue')) // 空位被填
  })

  it('密度 0 / keys 空 / 空范围 ⇒ null（不记账）', () => {
    const f = makeFixture()
    f.log.apply({ type: 'set', x: 0, y: 0, z: 0, key: f.k('color:red') })
    expect(f.run({ type: 'program', name: 'noiseFill', params: { scope: { kind: 'all' }, density: 0, keys: [f.k('color:blue')], seed: 1 } })).toBeNull()
    expect(f.run({ type: 'program', name: 'noiseFill', params: { scope: { kind: 'all' }, density: 0.5, keys: [], seed: 1 } })).toBeNull()
    const emptyPart = f.parts.create('空构件', 0)
    expect(f.run({ type: 'program', name: 'noiseFill', params: { scope: { kind: 'part', partId: emptyPart.id }, density: 1, keys: [f.k('color:blue')], seed: 1 } })).toBeNull()
    expect(f.log.patches).toHaveLength(1) // 只有最初那条手工放置
  })
})

describe('T5 · 按层抬升 / 加层（相对类）', () => {
  it('抬升 2 层：旧位清空、新位同键；压到范围外块 = 覆写且归属不变（D-B ②）', () => {
    const f = makeFixture()
    const part = f.log.createPart('柱')
    f.log.apply({ type: 'set', x: 0, y: 0, z: 0, key: f.k('color:red'), partId: part.id })
    f.log.apply({ type: 'set', x: 0, y: 1, z: 0, key: f.k('color:blue'), partId: part.id })
    const other = f.log.createPart('他者')
    f.log.apply({ type: 'set', x: 0, y: 2, z: 0, key: f.k('color:white'), partId: other.id })
    expect(
      f.run({ type: 'program', name: 'raiseByLayers', params: { scope: { kind: 'part', partId: part.id }, layers: 2 } }),
    ).not.toBeNull()
    expect(f.volume.getBlock(0, 0, 0)).toBe(0)
    expect(f.volume.getBlock(0, 1, 0)).toBe(0)
    expect(f.volume.getBlock(0, 2, 0)).toBe(f.k('color:red')) // 原 (0,0,0) 抬到 (0,2,0)，覆写白块
    expect(f.volume.getBlock(0, 3, 0)).toBe(f.k('color:blue'))
    expect(f.parts.partIdOf(0, 2, 0)).toBe(other.id) // 覆写不改归属（D-B ②）
    expect(f.parts.partIdOf(0, 3, 0)).toBeDefined() // 抬升产物归操作构件
  })

  it('加层：每列最高块轮廓向上复制 count 层（材质统一）', () => {
    const f = makeFixture()
    f.log.apply({ type: 'set', x: 0, y: 0, z: 0, key: f.k('color:red') })
    f.log.apply({ type: 'set', x: 1, y: 0, z: 0, key: f.k('color:red') })
    f.log.apply({ type: 'set', x: 0, y: 0, z: 5, key: f.k('color:red') })
    f.log.apply({ type: 'set', x: 0, y: 1, z: 5, key: f.k('color:red') })
    expect(
      f.run({ type: 'program', name: 'addLayer', params: { scope: { kind: 'all' }, count: 2, key: f.k('color:yellow') } }),
    ).not.toBeNull()
    expect(f.volume.nonEmptyCount).toBe(4 + 6) // 原 4 + 三列 × 2 层
    expect(f.volume.getBlock(0, 1, 0)).toBe(f.k('color:yellow'))
    expect(f.volume.getBlock(0, 2, 0)).toBe(f.k('color:yellow'))
    expect(f.volume.getBlock(1, 2, 0)).toBe(f.k('color:yellow'))
    expect(f.volume.getBlock(0, 3, 5)).toBe(f.k('color:yellow')) // 高列（顶 y=1）再往上 2 层 = y=3
  })

  it('边界：单块抬升 / 单块加层；layers=0 ⇒ 报错', () => {
    const f = makeFixture()
    f.log.apply({ type: 'set', x: 3, y: 3, z: 3, key: f.k('color:red') })
    f.run({ type: 'program', name: 'raiseByLayers', params: { scope: { kind: 'all' }, layers: 1 } })
    expect(f.volume.getBlock(3, 4, 3)).toBe(f.k('color:red'))
    f.run({ type: 'program', name: 'addLayer', params: { scope: { kind: 'all' }, count: 1, key: f.k('color:blue') } })
    expect(f.volume.getBlock(3, 5, 3)).toBe(f.k('color:blue'))
    expect(() => f.run({ type: 'program', name: 'raiseByLayers', params: { scope: { kind: 'all' }, layers: 0 } })).toThrow(/layers/)
  })
})

describe('T5 · 换材质 / 范围清除（绝对类）', () => {
  it('换材质：fromKeys 过滤——只换指定身份；重复应用 ⇒ 无补丁（幂等）', () => {
    const f = makeFixture()
    f.log.apply({ type: 'set', x: 0, y: 0, z: 0, key: f.k('color:red') })
    f.log.apply({ type: 'set', x: 1, y: 0, z: 0, key: f.k('color:blue') })
    expect(
      f.run({ type: 'program', name: 'recolor', params: { scope: { kind: 'all' }, toKey: f.k('color:white'), fromKeys: [f.k('color:red')] } }),
    ).not.toBeNull()
    expect(f.volume.getBlock(0, 0, 0)).toBe(f.k('color:white'))
    expect(f.volume.getBlock(1, 0, 0)).toBe(f.k('color:blue')) // 不在 fromKeys ⇒ 不动
    expect(
      f.run({ type: 'program', name: 'recolor', params: { scope: { kind: 'all' }, toKey: f.k('color:white'), fromKeys: [f.k('color:red')] } }),
    ).toBeNull() // 红块已换完 ⇒ 无可命中 ⇒ 不记账
  })

  it('范围清除：只清范围（构件）内，其他块留下；空构件 ⇒ null', () => {
    const f = makeFixture()
    const part = f.log.createPart('要清的')
    f.log.apply({ type: 'set', x: 0, y: 0, z: 0, key: f.k('color:red'), partId: part.id })
    f.log.apply({ type: 'set', x: 1, y: 0, z: 0, key: f.k('color:blue') }) // 手工块
    expect(f.run({ type: 'program', name: 'clearScope', params: { scope: { kind: 'part', partId: part.id } } })).not.toBeNull()
    expect(f.volume.getBlock(0, 0, 0)).toBe(0)
    expect(f.volume.getBlock(1, 0, 0)).toBe(f.k('color:blue'))
    expect(f.run({ type: 'program', name: 'clearScope', params: { scope: { kind: 'part', partId: part.id } } })).toBeNull()
  })
})

describe('T5 · 镜像阵列 / 抹角修边', () => {
  it('镜像：copies=2、spacing=1 ⇒ 两份翻转副本、相邻间隔恰好 1 空位（x 轴）', () => {
    const f = makeFixture()
    // 原件：x∈[0,1] 两个不同键 ⇒ 翻转可见（键随坐标镜像）
    f.log.apply({ type: 'set', x: 0, y: 0, z: 0, key: f.k('color:red') })
    f.log.apply({ type: 'set', x: 1, y: 0, z: 0, key: f.k('color:blue') })
    expect(
      f.run({ type: 'program', name: 'mirrorArray', params: { scope: { kind: 'all' }, axis: 'x', copies: 2, spacing: 1 } }),
    ).not.toBeNull()
    // 原件 [0,1]；镜像基 [2,3] + spacing 1 ⇒ 份1 = [3,4]，份2 = [3+step=3+3=6,7]
    expect(f.volume.getBlock(3, 0, 0)).toBe(f.k('color:blue')) // 镜像：最右(1,blue) → 最近(3)
    expect(f.volume.getBlock(4, 0, 0)).toBe(f.k('color:red'))
    expect(f.volume.getBlock(2, 0, 0)).toBe(0) // 原件与份1 之间空 1 格
    expect(f.volume.getBlock(6, 0, 0)).toBe(f.k('color:blue'))
    expect(f.volume.getBlock(7, 0, 0)).toBe(f.k('color:red'))
    expect(f.volume.getBlock(5, 0, 0)).toBe(0) // 份1 与份2 之间空 1 格
    expect(f.volume.nonEmptyCount).toBe(6)
  })

  it('抹角：5×5×5 实心盒 radius=1 ⇒ 恰好削 8 角（125 → 117）；radius=2 ⇒ 8 角 + 12 棱（→ 81）', () => {
    const f = makeFixture()
    f.run({ type: 'program', name: 'presetShape', params: { shape: 'box', origin: { x: 0, y: 0, z: 0 }, size: { x: 5, y: 5, z: 5 }, key: f.k('color:dark-gray') } })
    const before = f.volume.nonEmptyCount
    expect(before).toBe(125)
    f.run({ type: 'program', name: 'bevelEdges', params: { scope: { kind: 'all' }, radius: 1, passes: 1 } })
    expect(f.volume.nonEmptyCount).toBe(117)
    expect(f.volume.getBlock(0, 0, 0)).toBe(0) // 角被削
    expect(f.volume.getBlock(0, 2, 2)).not.toBe(0) // 面心留下
    const f2 = makeFixture()
    f2.run({ type: 'program', name: 'presetShape', params: { shape: 'box', origin: { x: 0, y: 0, z: 0 }, size: { x: 5, y: 5, z: 5 }, key: f2.k('color:dark-gray') } })
    f2.run({ type: 'program', name: 'bevelEdges', params: { scope: { kind: 'all' }, radius: 2, passes: 1 } })
    expect(f2.volume.nonEmptyCount).toBe(81)
  })

  it('边界：单块范围抹角（26 邻域全空 ⇒ 削掉）；copies=0 / spacing<0 ⇒ 报错', () => {
    const f = makeFixture()
    f.log.apply({ type: 'set', x: 0, y: 0, z: 0, key: f.k('color:red') })
    f.run({ type: 'program', name: 'bevelEdges', params: { scope: { kind: 'all' }, radius: 1, passes: 1 } })
    expect(f.volume.nonEmptyCount).toBe(0)
    expect(() => f.run({ type: 'program', name: 'mirrorArray', params: { scope: { kind: 'all' }, axis: 'x', copies: 0, spacing: 0 } })).toThrow(/copies/)
    expect(() => f.run({ type: 'program', name: 'mirrorArray', params: { scope: { kind: 'all' }, axis: 'x', copies: 1, spacing: -1 } })).toThrow(/spacing/)
  })
})
