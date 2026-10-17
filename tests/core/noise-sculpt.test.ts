// r02 前半 · F8 噪声雕塑（V9 · REQ-057）：确定性（L2 摘要）· 六向勾选各自有效 · 范围外不变 ·
// 一次撤销退回 · 纯侵蚀不建 0 块构件（接住 debug-261003 的结论）。
import { describe, expect, it } from 'vitest'
import { internBuiltin } from '../../src/core/builtin-palette'
import { CompositionRegistry } from '../../src/core/composition'
import { PatchLog } from '../../src/core/patch-log'
import { applyProgramOp } from '../../src/ops/apply'
import { PartRegistry } from '../../src/core/parts'
import type { NoiseDirs, NoiseSculptParams } from '../../src/core/types'
import { Volume } from '../../src/core/volume'

const ALL_DIRS: NoiseDirs = { px: true, nx: true, py: true, ny: true, pz: true, nz: true }

function blankVolume(yOff = 0): { volume: Volume; parts: PartRegistry; log: PatchLog; compositions: CompositionRegistry; key: number } {
  const volume = new Volume()
  const key = internBuiltin(volume.palette).get('color:red')!
  for (let x = 0; x <= 2; x++) {
    for (let y = 0; y <= 2; y++) {
      for (let z = 0; z <= 2; z++) volume.setBlock(x, y + yOff, z, key)
    }
  }
  const parts = new PartRegistry()
  const compositions = new CompositionRegistry()
  const log = new PatchLog(volume, parts)
  return { volume, parts, log, compositions, key }
}

function opOf(over: Partial<NoiseSculptParams> = {}): { type: 'program'; name: 'noiseSculpt'; params: NoiseSculptParams } {
  return {
    type: 'program',
    name: 'noiseSculpt',
    params: { scope: { kind: 'all' }, amplitude: 1, density: 1, seed: 7, dirs: { ...ALL_DIRS }, key: 1, ...over },
  }
}

describe('V9 · 噪声雕塑：确定性（L2 摘要口径）', () => {
  it('同参数（含种子）同结果：两个独立实例 digest 相等（I4 同口径）', () => {
    const a = blankVolume()
    const b = blankVolume()
    applyProgramOp(a.log, opOf({ seed: 2026, density: 0.5, amplitude: 2, key: a.key }), a.compositions)
    applyProgramOp(b.log, opOf({ seed: 2026, density: 0.5, amplitude: 2, key: b.key }), b.compositions)
    expect(a.volume.digest()).toEqual(b.volume.digest())
  })

  it('换种子 ⇒ 摘要不同（形态随种子变化）', () => {
    const a = blankVolume()
    const b = blankVolume()
    applyProgramOp(a.log, opOf({ seed: 1, key: a.key }), a.compositions)
    applyProgramOp(b.log, opOf({ seed: 2, key: b.key }), b.compositions)
    expect(a.volume.digest().coordHash).not.toBe(b.volume.digest().coordHash)
  })

  it('参数不合法 ⇒ 教学式报错（幅度 / 密度 / 方位至少一个）', () => {
    const f = blankVolume()
    expect(() => applyProgramOp(f.log, opOf({ amplitude: 9 }), f.compositions)).toThrow(/幅度/)
    expect(() => applyProgramOp(f.log, opOf({ density: 0 }), f.compositions)).toThrow(/密度/)
    expect(() =>
      applyProgramOp(f.log, opOf({ dirs: { px: false, nx: false, py: false, ny: false, pz: false, nz: false } }), f.compositions),
    ).toThrow(/至少要勾选一个方位/)
  })
})

describe('V9 · 六向勾选各自有效（勾选方向有变化；未勾选方向无新块）', () => {
  // r03（REQ-059 / ADR-20）：−y 生长到 y=0 即止 ⇒ −y 用例的夹具抬一层（yOff=1），否则底面生长全被裁剪。
  const CASES: Array<[keyof NoiseDirs, string, number, (c: { x: number; y: number; z: number }, yOff: number) => boolean]> = [
    ['px', '+x', 0, (c) => c.x > 2],
    ['nx', '−x', 0, (c) => c.x < 0],
    ['py', '+y', 0, (c) => c.y > 2],
    ['ny', '−y', 1, (c, yOff) => c.y < yOff],
    ['pz', '+z', 0, (c) => c.z > 2],
    ['nz', '−z', 0, (c) => c.z < 2],
  ]

  for (const [dirKey, label, yOff, onThatSide] of CASES) {
    it(`只勾 ${label} ⇒ 生长的新块全部落在该方向外侧`, () => {
      // density=1 + 幅度 1：每个表面位点必然抽签，种子保证至少发生一次生长（确定性：种子 7 在 27 块 × 1 向上必中）
      const f = blankVolume(yOff)
      const dirs: NoiseDirs = { px: false, nx: false, py: false, ny: false, pz: false, nz: false, [dirKey]: true }
      const patch = applyProgramOp(f.log, opOf({ dirs, key: f.key, amplitude: 1, density: 1, seed: 7 }), f.compositions)
      expect(patch).not.toBeNull()
      const grown = patch!.changes.filter((c) => c.before === 0)
      expect(grown.length).toBeGreaterThan(0)
      for (const c of grown) expect(onThatSide(c, yOff)).toBe(true) // 新块只出现在勾选方向
    })
  }

  it('只勾 −y 且底面在 y=0 ⇒ 零新块（REQ-059：−y 生长到 y=0 即止，越界目标全部裁剪）', () => {
    const f = blankVolume()
    const dirs: NoiseDirs = { px: false, nx: false, py: false, ny: true, pz: false, nz: false }
    const patch = applyProgramOp(f.log, opOf({ dirs, key: f.key, amplitude: 4, density: 1, seed: 11 }), f.compositions)!
    expect(patch.changes.every((c) => c.before > 0)).toBe(true) // 只剩侵蚀，无一块新块落在 y<0
  })

  it('只勾 −y（夹具抬一层）⇒ 新块全部在夹具下方且 y≥0', () => {
    const f = blankVolume(1)
    const dirs: NoiseDirs = { px: false, nx: false, py: false, ny: true, pz: false, nz: false }
    const patch = applyProgramOp(f.log, opOf({ dirs, key: f.key, seed: 11 }), f.compositions)!
    for (const c of patch.changes) {
      if (c.before === 0) {
        expect(c.y).toBe(0) // 夹具底面 y=1 的 −y 生长恰好落在 y=0，不再向下
      }
    }
  })
})

describe('V9 · 范围与记账', () => {
  it('范围外块逐块不变（scope = 构件 A，构件 B 与范围外格不动）', () => {
    const volume = new Volume()
    const keys = internBuiltin(volume.palette)
    const parts = new PartRegistry()
    const compositions = new CompositionRegistry()
    const log = new PatchLog(volume, parts)
    const a = log.createPart('A')
    const b = log.createPart('B')
    for (let x = 0; x <= 2; x++) {
      log.apply({ type: 'set', x, y: 0, z: 0, key: keys.get('color:red')!, partId: a.id })
    }
    for (let x = 10; x <= 12; x++) {
      log.apply({ type: 'set', x, y: 0, z: 0, key: keys.get('color:blue')!, partId: b.id })
    }
    const bDigest = volume.digest()
    const patch = applyProgramOp(log, 
      opOf({ scope: { kind: 'part', partId: a.id }, key: keys.get('color:yellow')!, seed: 3, density: 1, amplitude: 1 }),
      compositions,
    )
    expect(patch).not.toBeNull()
    // 范围外的 B 构件块逐块不变（坐标与键都原样）
    for (let x = 10; x <= 12; x++) expect(volume.getBlock(x, 0, 0)).toBe(keys.get('color:blue'))
    // A 的原块若被侵蚀是允许的（范围内），但变更不得发生在 B 的坐标上
    for (const c of patch!.changes) expect(c.x).toBeLessThan(10)
    expect(volume.digest().coordHash).not.toBe(bDigest.coordHash)
  })

  it('一次撤销退回（一条补丁）', () => {
    const f = blankVolume()
    const before = f.volume.digest()
    applyProgramOp(f.log, opOf({ key: f.key, seed: 5, density: 0.8, amplitude: 2 }), f.compositions)
    expect(f.volume.digest().coordHash).not.toBe(before.coordHash)
    f.log.undo()
    expect(f.volume.digest()).toEqual(before)
  })

  it('纯侵蚀（零新块）⇒ 不新建构件（接住 debug-261003"零新块不留 0 块构件"）', () => {
    // 单块 + 只勾 +y + density 1：唯一的表面位点要么生长要么侵蚀；
    // 找一个种子使抽签落在侵蚀侧（r2 ≥ 0.5），断言无新块 ⇒ parts 不增。
    const volume = new Volume()
    const keys = internBuiltin(volume.palette)
    const parts = new PartRegistry()
    const compositions = new CompositionRegistry()
    const log = new PatchLog(volume, parts)
    volume.setBlock(0, 0, 0, keys.get('color:red')!)
    const dirs: NoiseDirs = { px: false, nx: false, py: true, ny: false, pz: false, nz: false }
    const partsCountBefore = parts.list().length
    let erodeSeed: number | null = null
    for (let seed = 1; seed <= 50; seed++) {
      const v2 = new Volume()
      v2.setBlock(0, 0, 0, internBuiltin(v2.palette).get('color:red')!)
      const t = new PatchLog(v2, new PartRegistry())
      const p = applyProgramOp(t, opOf({ dirs, key: keys.get('color:red')!, seed }), new CompositionRegistry())
      if (p && !p.changes.some((c) => c.before === 0)) {
        erodeSeed = seed
        break
      }
    }
    expect(erodeSeed).not.toBeNull()
    const patch = applyProgramOp(log, 
      opOf({ dirs, key: keys.get('color:red')!, seed: erodeSeed!, density: 1, amplitude: 1 }),
      compositions,
    )
    expect(patch).not.toBeNull()
    expect(patch!.partId).toBeNull()
    expect(parts.list().length).toBe(partsCountBefore)
  })
})
