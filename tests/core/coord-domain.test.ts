// 交互编辑 P1 · `A-08`（坐标合法性统一）的无头复现与防线。
// 契约 `REQ-065`（2026-10-15 回流；`design` §A1）：三轴格坐标 = **整数且 |coord| ≤ 2¹²（4 096）**；
// 非有限值 / 非整数 / 越界**一律拒绝**，**不位运算截断、不写到另一格**；手动 / AI / 导入 / 重放
// **共用同一判定**；旧档越界坐标**拒绝并保留原状态**（不迁移、不裁剪）。
//
// 现状缺陷（`design` §5 `PA-22` 线索 + 本文件实测）：`core/coords.ts` 的 `chunkOf` = `x >> 4`、
// `localOf`/`localIndex` = `x & 15`（32 位位运算）⇒ 小数截断、超界静默改格、非有限值折叠到 0 号 chunk；
// `volume.setBlock` / `io/serialize.ts#isInt` 均无上下限与整数后置检查。
import { beforeEach, describe, expect, it } from 'vitest'
import { Volume } from '../../src/core/volume'
import { internBuiltin } from '../../src/core/builtin-palette'
import { PatchLog } from '../../src/core/patch-log'
import { PartRegistry } from '../../src/core/parts'
import { PROJECT_FORMAT } from '../../src/core/types'
import { MemoryProjectStore } from '../../src/io/project-store'
import { Editor } from '../../src/edit/editor'
import { decodeProject } from '../../src/io/serialize'
import { setUi, useEditorUi } from '../../src/state/editor-store'

const DOMAIN = 4096 // REQ-065：±2¹²

function freshVolume(): { volume: Volume; key: number } {
  const volume = new Volume()
  const keys = internBuiltin(volume.palette)
  return { volume, key: keys.get('color:red')! }
}

function makeEditor(): Editor {
  const editor = new Editor(new MemoryProjectStore())
  editor.setMode('edit')
  setUi({ brushSize: { x: 1, y: 1, z: 1 }, brushSizes: { place: { x: 1, y: 1, z: 1 }, erase: { x: 1, y: 1, z: 1 }, paint: { x: 1, y: 1, z: 1 } } })
  setUi({ tool: 'place', overridePlace: false, currentIdentity: 'color:red' })
  editor.newProject()
  return editor
}

const blocks = (ed: Editor): string[] => {
  const out: string[] = []
  for (const b of ed.volume.iterBlocks()) out.push(`${b.x},${b.y},${b.z}=${b.key}`)
  return out.sort()
}

/** 一份形状最小合法、但坐标越界的 v2 存档（`REQ-065`：导入必须拒绝且保留原状态） */
function outOfDomainProject(): string {
  const chunkX = Math.floor((DOMAIN + 1) / 16) // 4097 落在 chunk 256
  const lx = (DOMAIN + 1) % 16
  const data = new Array<number>(4096).fill(0)
  data[lx] = 1
  return JSON.stringify({
    format: PROJECT_FORMAT,
    formatVersion: 2,
    appVersion: '0.1.0',
    meta: { id: 'proj-x', title: '越界旧档', createdAt: '2026-10-15T00:00:00.000Z', updatedAt: '2026-10-15T00:00:00.000Z' },
    blockStyle: 'color',
    palette: [{ key: 1, identity: 'color:red', state: {}, color: '#ff0000' }],
    chunks: [{ x: chunkX, y: 0, z: 0, size: 16, data }],
    parts: [],
    compositions: [],
    log: { snapshotAt: 0, patches: [], partCreations: [] },
  })
}

beforeEach(() => {
  setUi({ mode: 'edit', tool: 'place', overridePlace: false, message: null })
})

describe('A-08 · 手动入口（模型级 place/erase/paint）', () => {
  it('小数坐标被拒绝：不截断后写到另一格，模型与历史不变', () => {
    const editor = makeEditor()
    const before = blocks(editor)
    const patchesBefore = editor.log.patches.length

    // (4.5, 0.5, 0.5) 落在空位 (4,0,0)（坯料只占 (0..2)³）——旧实现 `>>4`/`&15` 截断后真会落块
    editor.place(4.5, 0.5, 0.5)

    expect(editor.volume.getBlock(4, 0, 0)).toBe(0)
    expect(editor.volume.getBlock(5, 0, 0)).toBe(0)
    expect(blocks(editor)).toEqual(before)
    expect(editor.log.patches).toHaveLength(patchesBefore) // 非法输入不改变历史
    expect(useEditorUi.getState().message).toMatch(/坐标非法/)
  })

  it('越界与非有限坐标被拒绝：模型与历史不变', () => {
    const editor = makeEditor()
    const before = blocks(editor)
    const patchesBefore = editor.log.patches.length

    editor.place(DOMAIN + 1, 0, 0)
    editor.place(0, 0, -(DOMAIN + 1))
    editor.place(4.5, 0, 0)
    editor.place(Number.NaN, 0, 0)
    editor.place(Number.POSITIVE_INFINITY, 0, 0)

    expect(blocks(editor)).toEqual(before)
    expect(editor.log.patches).toHaveLength(patchesBefore)
    expect(useEditorUi.getState().message).toMatch(/坐标非法/)
  })

  it('边界内合法坐标照常写入（含负值，U2）', () => {
    const editor = makeEditor()
    setUi({ currentIdentity: 'color:red' })
    const patchesBefore = editor.log.patches.length

    editor.place(DOMAIN, 5, 0)
    editor.place(-DOMAIN, 5, 0)

    expect(editor.volume.getBlock(DOMAIN, 5, 0)).not.toBe(0)
    expect(editor.volume.getBlock(-DOMAIN, 5, 0)).not.toBe(0)
    expect(editor.log.patches).toHaveLength(patchesBefore + 2)
  })
})

describe('A-08 · 低层写入口（volume）', () => {
  it('小数 / 越界 / 非有限坐标一律抛错且零落格（不截断到邻居格，不落进别的 chunk）', () => {
    const { volume, key } = freshVolume()

    for (const c of [
      [0.5, 0, 0],
      [DOMAIN + 1, 0, 0],
      [Number.NaN, 0, 0],
      [Number.POSITIVE_INFINITY, 0, 0],
      [0, -0.5, 0],
    ] as const) {
      expect(() => volume.setBlock(c[0], c[1], c[2], key)).toThrow(/坐标非法|REQ-065/)
    }
    expect(volume.nonEmptyCount).toBe(0)
    expect(volume.chunkCount).toBe(0)
  })

  it('读侧同判：非法坐标读到 0，不会读到被截断后的邻居格', () => {
    const { volume, key } = freshVolume()
    volume.setBlock(0, 0, 0, key)
    expect(volume.getBlock(0, 0, 0)).not.toBe(0)
    expect(volume.getBlock(0.5, 0, 0)).toBe(0)
    expect(volume.getBlock(Number.NaN, 0, 0)).toBe(0)
  })
})

describe('A-08 · AI 入口（`args` 解析）', () => {
  it('越界 / 小数 / 非有限坐标一律拒绝（有界范围提示），模型与历史不变', () => {
    const editor = makeEditor()
    const before = blocks(editor)
    const patchesBefore = editor.log.patches.length

    const tooBig = editor.runOp({ type: 'program', name: 'presetShape', params: { shape: 'box', origin: { x: DOMAIN + 1, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 }, key: editor.currentKey() } })
    const fractional = editor.runOp({ type: 'program', name: 'presetShape', params: { shape: 'box', origin: { x: 0.5, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 }, key: editor.currentKey() } })

    expect(tooBig).toBe(false)
    expect(fractional).toBe(false)
    expect(blocks(editor)).toEqual(before)
    expect(editor.log.patches).toHaveLength(patchesBefore)
  })

  it('set_cells：非法坐标先滤掉（零写入），合法格照常一条补丁落账', () => {
    const editor = makeEditor()
    const patchesBefore = editor.log.patches.length
    const key = editor.currentKey()

    const patch = editor.aiSetCells({
      cells: [
        { x: 4, y: 0, z: 0, key },
        { x: 4.5, y: 0, z: 0, key }, // 小数 ⇒ 滤掉（旧实现会截断写到 (4,0,0)）
        { x: DOMAIN + 1, y: 0, z: 0, key }, // 越界 ⇒ 滤掉
        { x: Number.NaN, y: 0, z: 0, key }, // 非有限 ⇒ 滤掉
        { x: 5, y: 0, z: 0, key },
      ],
    })

    expect(patch && 'busy' in patch).toBe(false)
    expect(patch).not.toBeNull()
    expect(editor.log.patches).toHaveLength(patchesBefore + 1)
    expect(editor.log.patches[patchesBefore]!.changes).toHaveLength(2) // 只有两个合法格
    expect(editor.volume.getBlock(4, 0, 0)).toBe(key)
    expect(editor.volume.getBlock(5, 0, 0)).toBe(key)
  })
})

describe('A-08 · 导入入口（旧档越界拒绝并保留原状态）', () => {
  it('含越界坐标的存档被拒绝，当前模型与历史不变', () => {
    const editor = makeEditor()
    const before = blocks(editor)
    const patchesBefore = editor.log.patches.length

    const r = editor.importFile(outOfDomainProject())

    expect(r.ok).toBe(false)
    expect(blocks(editor)).toEqual(before)
    expect(editor.log.patches).toHaveLength(patchesBefore)
    expect(useEditorUi.getState().message).toMatch(/导入失败/)
  })

  it('低层解码同样拒绝（`decodeProject` 是导入的判定点）', () => {
    expect(decodeProject(outOfDomainProject()).ok).toBe(false)
  })
})

describe('A-08 · 重放入口（补丁日志）', () => {
  it('越界坐标的补丁重放抛错且不产出错格（不静默写到别的格）', () => {
    const { volume, key } = freshVolume()
    const patches = [
      {
        seq: 0,
        op: { type: 'set' as const, x: DOMAIN + 1, y: 0, z: 0, key },
        changes: [{ x: DOMAIN + 1, y: 0, z: 0, before: 0, after: key }],
        partId: null,
        createdAt: 0,
      },
    ]

    expect(() => PatchLog.replay(patches, volume.palette.list(), [])).toThrow(/REQ-065/)
  })

  it('越界坐标的记账入口零修改（`apply` 抛错且模型与历史不变）', () => {
    const { volume, key } = freshVolume()
    const parts = new PartRegistry()
    const log = new PatchLog(volume, parts)
    const before = volume.nonEmptyCount

    expect(() => log.apply({ type: 'set', x: DOMAIN + 1, y: 0, z: 0, key })).toThrow(/REQ-065/)
    expect(volume.nonEmptyCount).toBe(before)
    expect(log.patches).toHaveLength(0)
  })
})
