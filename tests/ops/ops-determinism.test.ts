// I4 · 操作族确定性（L2 · REQ-014 ②）：同种子 + 同参数 + 同版本 ⇒ 结果摘要（volume.digest 的块集合稳定哈希）相等。
// 三次口径：同进程两次（两个独立实例）+ **新建实例第三次**；noiseFill 另断言"不同种子 ⇒ 摘要不同"。
// 摘要 = Volume.digest()（chunk 与下标排序 ⇒ 与写入顺序无关——r01 N1/N2 同口径）。
import { describe, expect, it } from 'vitest'
import { internBuiltin } from '../../src/core/builtin-palette'
import { CompositionRegistry } from '../../src/core/composition'
import { PatchLog } from '../../src/core/patch-log'
import { applyProgramOp } from '../../src/ops/apply'
import { PartRegistry } from '../../src/core/parts'
import type { ProgramOp } from '../../src/core/types'
import { Volume } from '../../src/core/volume'

/** 确定的基底场景：构件 A（4 块红砖）· 构件 B（4 块蓝，抬一层）· 手工块 1 枚 */
function buildBase(): {
  volume: Volume
  parts: PartRegistry
  compositions: CompositionRegistry
  log: PatchLog
  k: (i: string) => number
  partA: string
  partB: string
} {
  const volume = new Volume()
  const keys = internBuiltin(volume.palette)
  const parts = new PartRegistry()
  const compositions = new CompositionRegistry()
  const log = new PatchLog(volume, parts)
  const a = log.createPart('A')
  for (let x = 0; x < 4; x++) {
    log.apply({ type: 'set', x, y: 0, z: 0, key: keys.get('color:red-brick')!, partId: a.id })
  }
  const b = log.createPart('B')
  for (let x = 0; x < 4; x++) {
    log.apply({ type: 'set', x, y: 1, z: 0, key: keys.get('color:blue')!, partId: b.id })
  }
  log.apply({ type: 'set', x: 9, y: 0, z: 9, key: keys.get('color:green')! })
  return { volume, parts, compositions, log, k: (i) => keys.get(i)!, partA: a.id, partB: b.id }
}

interface OpCase {
  name: ProgramOp['name']
  make: (b: ReturnType<typeof buildBase>) => ProgramOp
}

const CASES: OpCase[] = [
  {
    name: 'noiseFill',
    make: (b) => ({ type: 'program', name: 'noiseFill', params: { scope: { kind: 'all' }, density: 0.5, keys: [b.k('color:orange'), b.k('color:cyan')], seed: 20261003 } }),
  },
  {
    name: 'presetShape',
    make: (b) => ({ type: 'program', name: 'presetShape', params: { shape: 'sphere', origin: { x: 0, y: 0, z: 5 }, size: { x: 7, y: 7, z: 7 }, key: b.k('color:teal') } }),
  },
  {
    name: 'raiseByLayers',
    make: (b) => ({ type: 'program', name: 'raiseByLayers', params: { scope: { kind: 'part', partId: b.partA }, layers: 2 } }),
  },
  {
    name: 'addLayer',
    make: (b) => ({ type: 'program', name: 'addLayer', params: { scope: { kind: 'all' }, count: 2, key: b.k('color:yellow') } }),
  },
  {
    name: 'recolor',
    make: (b) => ({ type: 'program', name: 'recolor', params: { scope: { kind: 'all' }, toKey: b.k('color:white'), fromKeys: [b.k('color:blue')] } }),
  },
  {
    name: 'clearScope',
    make: (b) => ({ type: 'program', name: 'clearScope', params: { scope: { kind: 'part', partId: b.partB } } }),
  },
  {
    name: 'mirrorArray',
    make: (b) => ({ type: 'program', name: 'mirrorArray', params: { scope: { kind: 'part', partId: b.partA }, axis: 'x', copies: 2, spacing: 1 } }),
  },
  {
    name: 'bevelEdges',
    make: () => ({ type: 'program', name: 'bevelEdges', params: { scope: { kind: 'all' }, radius: 2, passes: 2 } }),
  },
]

function runOnce(c: OpCase): string {
  const b = buildBase()
  const patch = applyProgramOp(b.log, c.make(b), b.compositions)
  expect(patch).not.toBeNull()
  return b.volume.digest().coordHash
}

describe('I4 · 操作族确定性（同种子同参数 ⇒ 同摘要）', () => {
  it('每个操作：同进程两次相等 + 新建实例第三次仍相等（8/8）', () => {
    for (const c of CASES) {
      const d1 = runOnce(c)
      const d2 = runOnce(c) // 同进程第二个独立实例
      const d3 = runOnce(c) // 新建实例第三次
      expect(d2, `${c.name} 第二次`).toEqual(d1)
      expect(d3, `${c.name} 新建实例第三次`).toEqual(d1)
    }
  })

  it('噪声填充：不同种子 ⇒ 摘要不同（种子里编进结果，不是摆设）', () => {
    const digestWith = (seed: number): string => {
      const b = buildBase()
      applyProgramOp(b.log, 
        { type: 'program', name: 'noiseFill', params: { scope: { kind: 'all' }, density: 0.5, keys: [b.k('color:orange')], seed } },
        b.compositions,
      )
      return b.volume.digest().coordHash
    }
    expect(digestWith(1)).not.toEqual(digestWith(2))
  })
})
