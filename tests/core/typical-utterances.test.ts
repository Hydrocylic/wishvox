// N5 · 典型话可复算（REQ-014 ③ · L2）：三句素材典型话 → **操作序列** → 终态摘要固定且可复算。
// ①"屋顶改红"（换材质，范围 = 组合"屋顶"）②"再加一层"（抬屋顶 + 墙体加层，两步）③"把它缩小一圈"
// （**多步拆解**：范围清除 + 预设体块重生成——EX-03 的最难一例）。可复算口径：两份独立实例跑同一序列 ⇒ 摘要相等。
// 另按 plan §6 例外条款打印一次 ≥1000 块批量操作的耗时（只记录、不设门槛）。
import { describe, expect, it } from 'vitest'
import { internBuiltin } from '../../src/core/builtin-palette'
import { CompositionRegistry } from '../../src/core/composition'
import { PatchLog } from '../../src/core/patch-log'
import { applyProgramOp } from '../../src/ops/apply'
import { PartRegistry } from '../../src/core/parts'
import { resolveScope } from '../../src/core/scope'
import type { ProgramOp } from '../../src/core/types'
import { Volume } from '../../src/core/volume'

/** 场景：一座小房子 = 空心盒墙体（6×4×6 红砖）+ 板屋顶（8×1×8 蓝，y=4）+ 组合"屋顶"；外加一枚手工块烟囱 */
function buildHouse(): {
  volume: Volume
  parts: PartRegistry
  comps: CompositionRegistry
  log: PatchLog
  k: (i: string) => number
  wallPartId: string
  roofPartId: string
  roofCompId: string
} {
  const volume = new Volume()
  const keys = internBuiltin(volume.palette)
  const parts = new PartRegistry()
  const comps = new CompositionRegistry()
  const log = new PatchLog(volume, parts)
  const wallPatch = applyProgramOp(log, 
    { type: 'program', name: 'presetShape', params: { shape: 'box', origin: { x: 0, y: 0, z: 0 }, size: { x: 6, y: 4, z: 6 }, key: keys.get('color:red-brick')!, hollow: true } },
    comps,
  )!
  parts.rename(wallPatch.partId!, '墙体')
  const roofPatch = applyProgramOp(log, 
    { type: 'program', name: 'presetShape', params: { shape: 'box', origin: { x: -1, y: 4, z: -1 }, size: { x: 8, y: 1, z: 8 }, key: keys.get('color:blue')! } },
    comps,
  )!
  parts.rename(roofPatch.partId!, '屋顶')
  log.apply({ type: 'set', x: 5, y: 5, z: 5, key: keys.get('color:dark-gray')! }) // 手工块烟囱（无归属）
  const roofComp = comps.create('屋顶')
  comps.addPart(roofComp.id, roofPatch.partId!)
  comps.addManualBlock(roofComp.id, 5, 5, 5) // 烟囱也归"屋顶"这个意义单位
  return { volume, parts, comps, log, k: (i) => keys.get(i)!, wallPartId: wallPatch.partId!, roofPartId: roofPatch.partId!, roofCompId: roofComp.id }
}

/** 句①"屋顶改红"：换材质，范围 = 组合"屋顶"（成员 part ∪ 手工块烟囱） */
function seqRoofRed(h: ReturnType<typeof buildHouse>): ProgramOp[] {
  return [
    { type: 'program', name: 'recolor', params: { scope: { kind: 'composition', compositionId: h.roofCompId }, toKey: h.k('color:red'), fromKeys: [h.k('color:blue'), h.k('color:dark-gray')] } },
  ]
}

/** 句②"再加一层"：屋顶抬一层 + 墙体补一层（两步，屋顶先让位） */
function seqAddFloor(h: ReturnType<typeof buildHouse>): ProgramOp[] {
  return [
    { type: 'program', name: 'raiseByLayers', params: { scope: { kind: 'composition', compositionId: h.roofCompId }, layers: 1 } },
    { type: 'program', name: 'addLayer', params: { scope: { kind: 'part', partId: h.wallPartId }, count: 1, key: h.k('color:red-brick') } },
  ]
}

describe('N5 · 三句典型话可复算（操作序列 + 终态摘要固定）', () => {
  it('句① "屋顶改红"：换材质，范围 = 组合"屋顶"（含手工块烟囱）——只改该组合内的块', () => {
    const h = buildHouse()
    const wallBefore = resolveScope(h.volume, h.parts, h.comps, { kind: 'part', partId: h.wallPartId })
    const wallKeysBefore = wallBefore.map((c) => h.volume.getBlock(c.x, c.y, c.z))
    const patch = applyProgramOp(h.log, seqRoofRed(h)[0]!, h.comps)!
    expect(patch.label).toBe('换材质(组合#comp-1 → 键' + h.k('color:red') + ')')
    // 组合内的块全变红：屋顶 part 的每块 + 烟囱手工块
    for (const c of resolveScope(h.volume, h.parts, h.comps, { kind: 'composition', compositionId: h.roofCompId })) {
      expect(h.volume.getBlock(c.x, c.y, c.z)).toBe(h.k('color:red'))
    }
    expect(h.volume.getBlock(5, 5, 5)).toBe(h.k('color:red')) // 烟囱（手工块成员）也被改
    // 墙体一块未动
    const wallAfter = wallBefore.map((c) => h.volume.getBlock(c.x, c.y, c.z))
    expect(wallAfter).toEqual(wallKeysBefore)
  })

  it('句② "再加一层"：抬屋顶 + 墙体加层（两步序列）——屋顶上移一层、墙体多一层、互不覆盖', () => {
    const h = buildHouse()
    for (const op of seqAddFloor(h)) expect(applyProgramOp(h.log, op, h.comps)).not.toBeNull()
    // 屋顶整体上移到 y=5（原 y=4）
    expect(h.volume.getBlock(-1, 5, -1)).toBe(h.k('color:blue'))
    expect(h.volume.getBlock(-1, 4, -1)).toBe(0)
    // 墙体顶面（y=3）之上多一层红砖（y=4）——正好填进屋顶让出的位置
    expect(h.volume.getBlock(0, 4, 0)).toBe(h.k('color:red-brick'))
    expect(h.volume.nonEmptyCount).toBe(112 + 64 + 1 + 36) // 墙(空心 6×4×6=144−32) + 屋顶 64 + 烟囱 1 + 新顶面 36
  })

  it('句③ "把它缩小一圈"：多步拆解（清除 + 重生成）——终态 = 缩小一号的房子', () => {
    const h = buildHouse()
    const seq: ProgramOp[] = [
      { type: 'program', name: 'clearScope', params: { scope: { kind: 'all' } } },
      { type: 'program', name: 'presetShape', params: { shape: 'box', origin: { x: 1, y: 0, z: 1 }, size: { x: 4, y: 4, z: 4 }, key: h.k('color:red-brick'), hollow: true } },
      { type: 'program', name: 'presetShape', params: { shape: 'box', origin: { x: 0, y: 4, z: 0 }, size: { x: 6, y: 1, z: 6 }, key: h.k('color:blue') } },
    ]
    for (const op of seq) expect(applyProgramOp(h.log, op, h.comps)).not.toBeNull()
    expect(h.volume.nonEmptyCount).toBe((64 - 8) + 36) // 空心 4³ = 56 + 屋顶板 36
    expect(h.volume.getBlock(1, 0, 1)).not.toBe(0) // 新墙脚在 (1,·,1)——比原来的 (0,·,0) 内缩一圈
    expect(h.volume.getBlock(0, 0, 0)).toBe(0)
    // 旧构件空了、组合"屋顶"解析为空（语义视图跟着模型走）
    expect(h.parts.blockCount(h.roofPartId)).toBe(0)
    expect(resolveScope(h.volume, h.parts, h.comps, { kind: 'composition', compositionId: h.roofCompId })).toEqual([])
  })

  it('可复算：三句各自在两份独立实例上跑同一序列 ⇒ 终态摘要相等（L2 口径）', () => {
    const cases: Array<[string, (h: ReturnType<typeof buildHouse>) => ProgramOp[]]> = [
      ['屋顶改红', seqRoofRed],
      ['再加一层', seqAddFloor],
      [
        '把它缩小一圈',
        (h) => [
          { type: 'program', name: 'clearScope', params: { scope: { kind: 'all' } } },
          { type: 'program', name: 'presetShape', params: { shape: 'box', origin: { x: 1, y: 0, z: 1 }, size: { x: 4, y: 4, z: 4 }, key: h.k('color:red-brick'), hollow: true } },
          { type: 'program', name: 'presetShape', params: { shape: 'box', origin: { x: 0, y: 4, z: 0 }, size: { x: 6, y: 1, z: 6 }, key: h.k('color:blue') } },
        ],
      ],
    ]
    // golden 摘要（2026-10-03 定版）：调色板键序 = internBuiltin 固定顺序 ⇒ 摘要跨实例稳定
    const GOLDEN: Record<string, { digest: string; nonEmpty: number }> = {
      屋顶改红: { digest: '17d74c25', nonEmpty: 177 }, // 墙 112 + 屋顶 64 + 烟囱 1（组合内全红、墙体未动）
      再加一层: { digest: 'c8214970', nonEmpty: 213 }, // 112 + 64 + 1 + 新顶面 36
      把它缩小一圈: { digest: 'a02b9ea5', nonEmpty: 92 }, // 空心 4³=56 + 屋顶板 36（多步拆解）
    }
    for (const [name, makeSeq] of cases) {
      const run = (): { digest: string; nonEmpty: number } => {
        const h = buildHouse()
        for (const op of makeSeq(h)) applyProgramOp(h.log, op, h.comps)
        return { digest: h.volume.digest().coordHash, nonEmpty: h.volume.nonEmptyCount }
      }
      const a = run()
      const b = run()
      expect(b, `${name} 两份实例摘要相等`).toEqual(a)
      expect(a, `${name} golden 摘要固定`).toEqual(GOLDEN[name])
      console.info(`[N5] "${name}" 终态摘要 = ${a.digest}（${a.nonEmpty} 块）`)
    }
  })
})

describe('plan §6 例外 · 批量操作耗时（只记录、不计门槛）', () => {
  it('一次 ≥1000 块的程序化操作：打印耗时', () => {
    const volume = new Volume()
    const keys = internBuiltin(volume.palette)
    const parts = new PartRegistry()
    const comps = new CompositionRegistry()
    const log = new PatchLog(volume, parts)
    const t0 = performance.now()
    applyProgramOp(log, 
      { type: 'program', name: 'presetShape', params: { shape: 'box', origin: { x: 0, y: 0, z: 0 }, size: { x: 12, y: 12, z: 12 }, key: keys.get('color:teal')! } },
      comps,
    )
    const dt = performance.now() - t0
    expect(volume.nonEmptyCount).toBe(1728)
    console.info(`[耗时记录] 12×12×12 实心盒（1728 块）applyOp = ${dt.toFixed(2)} ms（只记录、不设门槛）`)
  })
})
