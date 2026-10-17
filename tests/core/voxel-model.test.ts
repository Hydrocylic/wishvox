// I1 · 体素模型：增/删/改的幂等与交换性、空 chunk 回收（REQ-016 模型面 + REQ-025 单块面 + REQ-023 命名）
// 判据目录 = 笔记库 curriculum/testing-plan.md §二（I1 行）；本件只做 L1 无头断言。
import { describe, expect, it } from 'vitest'
import { internBuiltin } from '../../src/core/builtin-palette'
import { CompositionRegistry } from '../../src/core/composition'
import { PatchLog } from '../../src/core/patch-log'
import { applyProgramOp } from '../../src/ops/apply'
import { PartRegistry } from '../../src/core/parts'
import type { ProgramOp } from '../../src/core/types'
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

function makeVolume(): { volume: Volume; keys: Map<string, number> } {
  const volume = new Volume()
  const keys = internBuiltin(volume.palette)
  return { volume, keys }
}

describe('I1 · 体素模型幂等与交换性', () => {
  it('同格重复放置：低层写返回 false，模型不变（幂等）', () => {
    const { volume, keys } = makeVolume()
    const k = keys.get('color:red')!
    volume.setBlock(3, 4, 5, k)
    const d1 = volume.digest()
    expect(volume.setBlock(3, 4, 5, k)).toBe(false)
    expect(volume.digest()).toEqual(d1)
    expect(volume.nonEmptyCount).toBe(1)
  })

  it('不同格的操作可交换：A→B 与 B→A 终态相同（固定四格）', () => {
    const a = makeVolume()
    const b = makeVolume()
    const ops: Array<[number, number, number, string]> = [
      [1, 2, 3, 'color:red'],
      [40, -2, 7, 'color:blue'],
      [15, 15, 15, 'color:teal'],
      [16, 0, 0, 'color:pink'],
      [-17, 33, -5, 'color:white'],
    ]
    for (const [x, y, z, id] of ops) a.volume.setBlock(x, y, z, a.keys.get(id)!)
    for (const [x, y, z, id] of [...ops].reverse()) b.volume.setBlock(x, y, z, b.keys.get(id)!)
    expect(a.volume.digest()).toEqual(b.volume.digest())
  })

  it('不同格的操作可交换：50 格随机序列，两种顺序终态相同', () => {
    const rng = mulberry32(20260930)
    const cells: Array<[number, number, number, string]> = []
    const seen = new Set<string>()
    const ids = ['color:red', 'color:blue', 'color:yellow', 'color:teal', 'color:brown']
    while (cells.length < 50) {
      const x = Math.floor(rng() * 64) - 32
      const y = Math.floor(rng() * 16) - 8
      const z = Math.floor(rng() * 64) - 32
      const key = `${x},${y},${z}`
      if (seen.has(key)) continue
      seen.add(key)
      cells.push([x, y, z, ids[Math.floor(rng() * ids.length)]!])
    }
    const a = makeVolume()
    const b = makeVolume()
    for (const [x, y, z, id] of cells) a.volume.setBlock(x, y, z, a.keys.get(id)!)
    // 洗牌（确定性）
    const shuffled = [...cells]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]!]
    }
    for (const [x, y, z, id] of shuffled) b.volume.setBlock(x, y, z, b.keys.get(id)!)
    expect(a.volume.digest()).toEqual(b.volume.digest())
    expect(a.volume.nonEmptyCount).toBe(50)
  })

  it('置空后：空块计数 = 0 且空 chunk 被回收（计数断言）', () => {
    const { volume, keys } = makeVolume()
    const k = keys.get('color:red')!
    // 三个 chunk 各放两块
    for (const [x, y, z] of [
      [1, 1, 1],
      [2, 2, 2],
      [20, 1, 1],
      [21, 2, 2],
      [-20, 1, 1],
      [-21, 2, 2],
    ] as const) {
      volume.setBlock(x, y, z, k)
    }
    expect(volume.chunkCount).toBe(3)
    expect(volume.nonEmptyCount).toBe(6)
    // 清空正 x 那个 chunk
    volume.setBlock(20, 1, 1, 0)
    volume.setBlock(21, 2, 2, 0)
    expect(volume.chunkCount).toBe(2)
    expect(volume.nonEmptyCount).toBe(4)
    expect(volume.getBlock(20, 1, 1)).toBe(0)
    // 全清
    volume.setBlock(1, 1, 1, 0)
    volume.setBlock(2, 2, 2, 0)
    volume.setBlock(-20, 1, 1, 0)
    volume.setBlock(-21, 2, 2, 0)
    expect(volume.chunkCount).toBe(0)
    expect(volume.nonEmptyCount).toBe(0)
  })

  it('改色（before>0 → after>0）：换键不换块数', () => {
    const { volume, keys } = makeVolume()
    volume.setBlock(1, 1, 1, keys.get('color:white')!)
    volume.setBlock(1, 1, 1, keys.get('color:red')!)
    expect(volume.nonEmptyCount).toBe(1)
    expect(volume.getEntry(1, 1, 1)!.identity).toBe('color:red')
  })
})

describe('I9 分母 · 受影响 chunk 的邻域规则（模型层定义，渲染层必须与之相等）', () => {
  function seededBoundaryVolume(): { volume: Volume; keys: Map<string, number> } {
    const { volume, keys } = makeVolume()
    const k = keys.get('color:light-gray')!
    // chunk(0,0,0)、(1,0,0)、(0,1,0)、(0,0,1) 各驻留一块
    volume.setBlock(5, 5, 5, k)
    volume.setBlock(20, 5, 5, k)
    volume.setBlock(5, 20, 5, k)
    volume.setBlock(5, 5, 20, k)
    return { volume, keys }
  }

  it('chunk 内部改动：受影响 chunk 数 = 1', () => {
    const { volume } = seededBoundaryVolume()
    expect(volume.affectedResidentChunks(5, 6, 7)).toHaveLength(1)
  })

  it('面跨界改动（x=15）：受影响 = 自身 + 相邻驻留 = 2', () => {
    const { volume } = seededBoundaryVolume()
    expect(volume.affectedResidentChunks(15, 5, 5)).toHaveLength(2)
  })

  it('角跨界改动（15,15,15）：受影响 = 自身 + 三邻 = 4', () => {
    const { volume } = seededBoundaryVolume()
    expect(volume.affectedResidentChunks(15, 15, 15)).toHaveLength(4)
  })

  it('负方向的跨界同样成立（x=0 相邻 chunk(-1,·,·)）', () => {
    const { volume, keys } = makeVolume()
    const k = keys.get('color:light-gray')!
    volume.setBlock(-5, 5, 5, k) // chunk(-1,0,0) 驻留
    volume.setBlock(5, 5, 5, k) // chunk(0,0,0) 驻留
    expect(volume.affectedResidentChunks(0, 5, 5)).toHaveLength(2)
  })

  it('邻 chunk 不驻留时只算自身（空 chunk 无实例数据可建）', () => {
    const { volume, keys } = makeVolume()
    volume.setBlock(5, 5, 5, keys.get('color:light-gray')!)
    expect(volume.affectedResidentChunks(15, 5, 5)).toHaveLength(1)
  })
})

describe('REQ-023 ① · 构件命名（注册表面）', () => {
  it('一次操作产出可命名构件；改名即生效', () => {
    const volume = new Volume()
    const keys = internBuiltin(volume.palette)
    const parts = new PartRegistry()
    const log = new PatchLog(volume, parts)
    const part = log.createPart('主楼')
    log.apply({ type: 'set', x: 1, y: 0, z: 1, key: keys.get('color:red-brick')!, partId: part.id })
    expect(parts.get(part.id)!.name).toBe('主楼')
    expect(parts.blockCount(part.id)).toBe(1)
    parts.rename(part.id, '钟楼')
    expect(parts.get(part.id)!.name).toBe('钟楼')
    expect(parts.partIdOf(1, 0, 1)).toBe(part.id)
  })
})

// ── r02 追加：I1 扩到程序化操作——绝对 / 相对两类分开断言（plan §1.1 注）──
// 绝对类（noiseFill / presetShape / recolor / clearScope / mirrorArray）：同参数（同范围引用）重复应用 ⇒ 终态不变。
// 相对类（raiseByLayers / addLayer / bevelEdges）：不幂等（重复应用终态改变），但一步撤销可逆。
// ⚠ bevelEdges 在 plan §1.1 原注列在绝对类；按削角的侵蚀语义（上一轮削完的边界成为新一轮的角）归相对类——
//   plan §5.2 预授权的降级口径（参数化最小面 + 记账），差异写进轮次 log。

describe('I1 扩展 · 绝对 / 相对两类分开断言（r02）', () => {
  function base(): { volume: Volume; parts: PartRegistry; log: PatchLog; comps: CompositionRegistry; k: (i: string) => number; partA: string } {
    const volume = new Volume()
    const keys = internBuiltin(volume.palette)
    const parts = new PartRegistry()
    const comps = new CompositionRegistry()
    const log = new PatchLog(volume, parts)
    const a = log.createPart('A')
    for (let x = 0; x < 4; x++) {
      log.apply({ type: 'set', x, y: 0, z: 0, key: keys.get('color:red-brick')!, partId: a.id })
    }
    log.apply({ type: 'set', x: 2, y: 0, z: 2, key: keys.get('color:blue')! })
    // 一个实心盒（4×4×4，独立构件）——给抹角"逐次侵蚀"留出可观察的形状
    const box = log.createPart('盒')
    for (let x = 0; x < 4; x++) {
      for (let y = 3; y < 7; y++) {
        for (let z = 0; z < 4; z++) {
          log.apply({ type: 'set', x, y, z, key: keys.get('color:dark-gray')!, partId: box.id })
        }
      }
    }
    return { volume, parts, log, comps, k: (i) => keys.get(i)!, partA: a.id }
  }

  it('绝对类 ×5：同参数（同范围引用）重复应用 ⇒ 终态不变（幂等）', () => {
    type Maker = (f: ReturnType<typeof base>) => ProgramOp
    const absolutes: Array<[string, Maker]> = [
      ['noiseFill', (f) => ({ type: 'program', name: 'noiseFill', params: { scope: { kind: 'all' }, density: 0.6, keys: [f.k('color:orange')], seed: 77 } })],
      ['presetShape', (f) => ({ type: 'program', name: 'presetShape', params: { shape: 'box', origin: { x: 0, y: 3, z: 0 }, size: { x: 4, y: 3, z: 4 }, key: f.k('color:green'), hollow: true } })],
      ['recolor', (f) => ({ type: 'program', name: 'recolor', params: { scope: { kind: 'all' }, toKey: f.k('color:purple'), fromKeys: [f.k('color:blue')] } })],
      ['clearScope', () => ({ type: 'program', name: 'clearScope', params: { scope: { kind: 'manual' } } })],
      // r03（ADR-19）：mirrorArray 副本归范围管辖单位 ⇒ part 范围引用不再稳定（副本并入后第二次镜像位随 bbox 外移）；
      // 幂等断言改用 manual 范围（副本维持新建构件 ⇒ 手工块集合不变 ⇒ 引用稳定）——ADR-19 影响面 ③ 预授权的用例更新。
      ['mirrorArray', () => ({ type: 'program', name: 'mirrorArray', params: { scope: { kind: 'manual' }, axis: 'x', copies: 1, spacing: 0 } })],
    ]
    for (const [name, make] of absolutes) {
      const f = base()
      const first = applyProgramOp(f.log, make(f), f.comps)
      expect(first, `${name} 首次应用应有变化`).not.toBeNull()
      const d1 = f.volume.digest()
      const second = applyProgramOp(f.log, make(f), f.comps) // 同参数（同范围引用）重复应用
      expect(f.volume.digest(), `${name} 重复应用 ⇒ 终态不变`).toEqual(d1)
      expect(second, `${name} 重复应用 ⇒ 无补丁`).toBeNull()
    }
  })

  it('相对类 ×3：可逆但不幂等（重复应用 ⇒ 终态改变；一步撤销回到操作前）', () => {
    type Maker = (f: ReturnType<typeof base>) => ProgramOp
    // 相对类用 all 范围：抬升会把块搬进操作构件（原构件清空），part 引用第二次会解析为空；
    // addLayer 的新层也归操作构件——all 口径下"顶面"持续上移，非幂等才可观察。
    const relatives: Array<[string, Maker]> = [
      ['raiseByLayers', () => ({ type: 'program', name: 'raiseByLayers', params: { scope: { kind: 'all' }, layers: 2 } })],
      ['addLayer', (f) => ({ type: 'program', name: 'addLayer', params: { scope: { kind: 'all' }, count: 1, key: f.k('color:yellow') } })],
      // radius=2：第二轮面块实心度 10 ≤ 11 继续削（radius=1 在实心盒上削完角即停，非幂等观察不到）
      ['bevelEdges', () => ({ type: 'program', name: 'bevelEdges', params: { scope: { kind: 'all' }, radius: 2, passes: 1 } })],
    ]
    for (const [name, make] of relatives) {
      const f = base()
      const before = f.volume.digest()
      applyProgramOp(f.log, make(f), f.comps)!
      const d1 = f.volume.digest()
      expect(d1, `${name} 首次应有变化`).not.toEqual(before)
      applyProgramOp(f.log, make(f), f.comps)! // 重复应用：不幂等
      const d2 = f.volume.digest()
      expect(d2, `${name} 不幂等`).not.toEqual(d1)
      f.log.undo()
      expect(f.volume.digest(), `${name} 一步撤销回到第二次应用前`).toEqual(d1)
      f.log.undo()
      expect(f.volume.digest(), `${name} 再一步撤销回到操作前`).toEqual(before)
    }
  })
})
