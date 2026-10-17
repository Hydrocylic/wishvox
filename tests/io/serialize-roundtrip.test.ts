// I3 · 序列化往返：save→load 逐块相等（含 parts 归属与 identity/state 字段）；版本字段在位；
// 坏文件 ⇒ 明确报错且当前场景不变（REQ-001/003 · NFR-006 · REQ-046/023）
// r02 扩展：v2（+ compositions + 补丁 label/ownersBefore）往返；**v1 老样本 ⇒ 迁移导入**（组合空数组、label 缺省、一个块不少）
import pkg from '../../package.json'
import { describe, expect, it } from 'vitest'
import { internBuiltin } from '../../src/core/builtin-palette'
import { CompositionRegistry } from '../../src/core/composition'
import { PatchLog } from '../../src/core/patch-log'
import { applyProgramOp } from '../../src/ops/apply'
import { PartRegistry } from '../../src/core/parts'
import { APP_VERSION } from '../../src/io/version'
import { decodeProject, encodeProject, loadProjectFile } from '../../src/io/serialize'
import { LEGACY_PROJECT_FORMAT, PROJECT_FORMAT } from '../../src/core/types'
import type { ProjectMeta } from '../../src/core/types'
import { Volume } from '../../src/core/volume'

function buildSampleProject(): {
  volume: Volume
  parts: PartRegistry
  compositions: CompositionRegistry
  log: PatchLog
  keys: Map<string, number>
  meta: ProjectMeta
} {
  const volume = new Volume()
  const keys = internBuiltin(volume.palette)
  // 一个带状态的调色板条目（REQ-046：state 非空的往返）
  const rotatedKey = volume.palette.intern('color:red', { rotation: 90 }, '#c0392b')
  const parts = new PartRegistry()
  const compositions = new CompositionRegistry()
  const log = new PatchLog(volume, parts)
  const main = log.createPart('主楼')
  const side = log.createPart('副楼')
  const cells: Array<[number, number, number, string | number]> = [
    [0, 0, 0, 'color:red-brick'],
    [1, 0, 0, 'color:red-brick'],
    [0, 0, 1, 'color:white'],
    [-3, 2, -4, 'color:blue'],
    [18, 0, 0, 'color:yellow'],
    [33, 17, -20, 'color:teal'],
    [5, 1, 5, rotatedKey],
  ]
  for (const [x, y, z, id] of cells) {
    const key = typeof id === 'number' ? id : keys.get(id)!
    log.apply({ type: 'set', x, y, z, key, partId: (x + y + z) % 2 === 0 ? main.id : side.id })
  }
  // r02：一个程序化操作补丁（label + ownersBefore 进日志）+ 一个组合（成员 part + 手工块）
  applyProgramOp(log, 
    {
      type: 'program',
      name: 'recolor',
      params: { scope: { kind: 'part', partId: main.id }, toKey: keys.get('color:orange')! },
    },
    compositions,
  )
  const comp = compositions.create('屋顶')
  compositions.addPart(comp.id, main.id)
  compositions.addManualBlock(comp.id, -3, 2, -4)
  // 撤销重做各一，日志里留下交错痕迹
  log.undo()
  log.redo()
  const meta: ProjectMeta = {
    id: 'proj-test-1',
    title: '往返测试',
    createdAt: '2026-09-30T00:00:00.000Z',
    updatedAt: '2026-09-30T01:00:00.000Z',
  }
  return { volume, parts, compositions, log, keys, meta }
}

function encodeSample(s: ReturnType<typeof buildSampleProject>): string {
  return JSON.stringify(
    encodeProject({
      volume: s.volume,
      parts: s.parts,
      patches: s.log.patches,
      partCreations: s.log.partCreations,
      compositions: s.compositions,
      blockStyle: 'color',
      meta: s.meta,
    }),
  )
}

describe('I3 · 序列化往返', () => {
  it('save→load：逐块相等（含构件归属与 identity/state 逐字段相等）', () => {
    const s = buildSampleProject()
    const decoded = decodeProject(encodeSample(s))
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return

    const freshVolume = new Volume()
    const freshParts = new PartRegistry()
    const freshCompositions = new CompositionRegistry()
    const freshLog = new PatchLog(freshVolume, freshParts)
    const loaded = loadProjectFile(decoded.file, freshVolume, freshParts, freshCompositions)
    freshLog.adopt(loaded.patches, loaded.partCreations)

    expect(freshVolume.digest()).toEqual(s.volume.digest())
    expect(freshParts.serialize()).toEqual(s.parts.serialize())
    // 调色板逐字段（identity / state / color）
    expect(freshVolume.palette.list()).toEqual(s.volume.palette.list())
    const rotatedEntry = freshVolume.palette.list().find((e) => e.identity === 'color:red' && e.state.rotation === 90)
    expect(rotatedEntry).toBeDefined()
    expect(rotatedEntry!.state).toEqual({ rotation: 90 })
    // REQ-046：空 state 的条目字段仍在（结构存在，值可为空对象）
    const plainEntry = freshVolume.palette.list().find((e) => e.identity === 'color:blue')!
    expect(plainEntry.state).toEqual({})
    // 日志尾巴完整带走
    expect(loaded.patches).toHaveLength(s.log.patches.length)
    expect(loaded.partCreations).toHaveLength(s.log.partCreations.length)
  })

  it('v2 面：compositions 往返相等；程序化补丁的 label / ownersBefore 完整带走', () => {
    const s = buildSampleProject()
    const decoded = decodeProject(encodeSample(s))
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.file.compositions).toEqual(s.compositions.serialize())
    const programPatch = decoded.file.log.patches.find((p) => p.op.type === 'program')!
    expect(programPatch.label).toBe(s.log.patches.find((p) => p.op.type === 'program')!.label)
    expect(programPatch.ownersBefore).toBeDefined()
  })

  it('formatVersion 在位 = 2（NFR-006：格式由 r01–r02 定稿）；appVersion 派生自 package.json（单一来源）', () => {
    const s = buildSampleProject()
    const file = JSON.parse(encodeSample(s)) as { format: string; formatVersion: number; appVersion: string }
    expect(file.format).toBe(PROJECT_FORMAT)
    expect(file.formatVersion).toBe(2)
    expect(file.appVersion).toBe(pkg.version)
    expect(APP_VERSION).toBe(pkg.version)
  })

  it('品牌改名兼容：旧格式串仍可解码（展示件是旧串）；解码归一化为新串，逐块不丢', () => {
    const s = buildSampleProject()
    const v2 = JSON.parse(encodeSample(s)) as Record<string, unknown>
    const decoded = decodeProject(JSON.stringify({ ...v2, format: LEGACY_PROJECT_FORMAT }))
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.file.format).toBe(PROJECT_FORMAT) // 读旧写新：旧串解码后归一化为新串
    const freshVolume = new Volume()
    const freshParts = new PartRegistry()
    loadProjectFile(decoded.file, freshVolume, freshParts)
    expect(freshVolume.digest()).toEqual(s.volume.digest()) // 旧串档逐块不丢
  })

  it('空 chunk 不写、data 定长 4096、0 = 空', () => {
    const s = buildSampleProject()
    const file = JSON.parse(encodeSample(s)) as { chunks: Array<{ data: number[] }> }
    const nonEmptyChunks = new Set(
      [...s.volume.iterBlocks()].map((b) => `${b.x >> 4},${b.y >> 4},${b.z >> 4}`),
    )
    expect(file.chunks.length).toBe(nonEmptyChunks.size)
    for (const c of file.chunks) expect(c.data).toHaveLength(4096)
  })

  it('v1 老样本能导入：迁移为 v2（组合 = 空数组、label 缺省）且一个块不少', () => {
    const s = buildSampleProject()
    const v2 = JSON.parse(encodeSample(s)) as Record<string, unknown>
    // 造一个"像 r01 时代"的 v1 样本：无 compositions、补丁无 label/ownersBefore、formatVersion = 1
    const patches = (v2.log as { patches: Array<Record<string, unknown>> }).patches.map((p) => {
      const out: Record<string, unknown> = { ...p }
      delete out.label
      delete out.ownersBefore
      return out
    })
    const v1 = { ...v2, formatVersion: 1, log: { ...(v2.log as object), patches } }
    delete (v1 as { compositions?: unknown }).compositions
    const decoded = decodeProject(JSON.stringify(v1))
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.file.formatVersion).toBe(2) // 迁移后的内存形状
    expect(decoded.file.compositions).toEqual([]) // 组合 = 空数组而非报错
    const freshVolume = new Volume()
    const freshParts = new PartRegistry()
    loadProjectFile(decoded.file, freshVolume, freshParts)
    expect(freshVolume.digest()).toEqual(s.volume.digest()) // 逐块不丢
    expect(freshParts.serialize()).toEqual(s.parts.serialize())
  })

  it('坏文件 ⇒ 明确报错（REQ-003 / NFR-006：七类坏法逐个判 + v2 新面三类）', () => {
    const s = buildSampleProject()
    const good = JSON.parse(encodeSample(s)) as Record<string, unknown> & {
      chunks: Array<{ data: number[] }>
      palette: unknown[]
    }
    const bad: Array<[string, string]> = [
      ['非法 JSON', '{"format": '],
      ['format 不符', JSON.stringify({ ...good, format: 'other/tool' })],
      ['formatVersion 不符', JSON.stringify({ ...good, formatVersion: 99 })],
      ['缺 chunks 字段', JSON.stringify({ ...good, chunks: undefined })],
      ['data 长度不对', JSON.stringify({ ...good, chunks: [{ ...good.chunks[0]!, data: good.chunks[0]!.data.slice(0, 4095) }] })],
      ['palette 缺 state 字段（REQ-046）', JSON.stringify({ ...good, palette: good.palette.map((e) => ({ ...(e as object), state: undefined })) })],
      ['data 引用未知调色板键', JSON.stringify({ ...good, chunks: [{ ...good.chunks[0]!, data: good.chunks[0]!.data.map((k, i) => (i === 0 ? 9999 : k)) }] })],
      ['v2：compositions 形状不对', JSON.stringify({ ...good, compositions: [{ id: 'comp-1' }] })],
      ['v2：补丁 label 类型不对', JSON.stringify({ ...good, log: { ...(good.log as object), patches: [{ ...(good.log as { patches: object[] }).patches[0], label: 42 }] } })],
      ['v2：ownersBefore 与 changes 不对齐', JSON.stringify({ ...good, log: { ...(good.log as object), patches: [{ ...(good.log as { patches: object[] }).patches[0], ownersBefore: [] }] } })],
    ]
    for (const [label, text] of bad) {
      const result = decodeProject(text)
      expect(result.ok, label).toBe(false)
      if (!result.ok) expect(result.error.length, label).toBeGreaterThan(0)
    }
  })

  it('导入失败保持当前场景不变（模拟 importFile 流程：decode 失败 ⇒ 不触碰模型）', () => {
    const s = buildSampleProject()
    const before = s.volume.digest()
    const result = decodeProject('{"format": "other/tool", "formatVersion": 2}')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      // editor 的 importFile 在这里直接 return error，loadProjectFile 不会被调用
      expect(s.volume.digest()).toEqual(before)
    }
  })

  it('文件往返后 replay 日志 = 载入后的模型（日志尾巴可重放）', () => {
    const s = buildSampleProject()
    const decoded = decodeProject(encodeSample(s))
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    const freshVolume = new Volume()
    const freshParts = new PartRegistry()
    const loaded = loadProjectFile(decoded.file, freshVolume, freshParts)
    const replayed = PatchLog.replay(loaded.patches, freshVolume.palette.list(), loaded.partCreations)
    expect(replayed.volume.digest()).toEqual(freshVolume.digest())
    expect(replayed.parts.serialize()).toEqual(freshParts.serialize())
  })
})
