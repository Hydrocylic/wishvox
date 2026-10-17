// D3 · 撤销后不留 0 块构件（debug-261004，2026-10-04；MT-E1「坯料」/ MT-E12「噪声雕塑」）。
// 缺陷：PatchLog.undo() 只 parts.unassign，PartRegistry 记录保留 ⇒ 新建→撤销留 0 块「坯料」、
// 噪声生长→撤销留 0 块「噪声雕塑」。修法口径（先红后绿）：
//   撤销「与补丁**捆绑**创建」的构件（newProject 坯料 / applyOp 内建构件）且该构件已被退空 ⇒ 剪掉；
//   newPart() 的**有意空构件**（创建无补丁跟随）不误删；redo 原样复活（同 id 同名）；replay 仍 = 当前（I2）。
import { describe, expect, it } from 'vitest'
import { internBuiltin } from '../../src/core/builtin-palette'
import { CompositionRegistry } from '../../src/core/composition'
import { PatchLog } from '../../src/core/patch-log'
import { applyProgramOp } from '../../src/ops/apply'
import { PartRegistry } from '../../src/core/parts'
import type { Part } from '../../src/core/parts'
import { MemoryProjectStore } from '../../src/io/project-store'
import type { NoiseDirs, NoiseSculptParams } from '../../src/core/types'
import { Volume } from '../../src/core/volume'
import { Editor } from '../../src/edit/editor'
import { setUi } from '../../src/state/editor-store'

const emptyParts = (parts: PartRegistry): Part[] => parts.list().filter((p) => p.blocks.size === 0)

function makeEditor(): Editor {
  const editor = new Editor(new MemoryProjectStore())
  editor.setMode('edit')
  return editor
}

// 噪声夹具（同 noise-sculpt.test.ts 口径：3³ 实心 + noiseSculpt 程序操作）
const ALL_DIRS: NoiseDirs = { px: true, nx: true, py: true, ny: true, pz: true, nz: true }

function blankVolume(): { volume: Volume; parts: PartRegistry; log: PatchLog; compositions: CompositionRegistry; key: number } {
  const volume = new Volume()
  const key = internBuiltin(volume.palette).get('color:red')!
  for (let x = 0; x <= 2; x++) {
    for (let y = 0; y <= 2; y++) {
      for (let z = 0; z <= 2; z++) volume.setBlock(x, y, z, key)
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

describe('D3 · 撤销后清理 0 块构件（先红后绿）', () => {
  it('新建 → 撤销一次 ⇒ parts.list() 不留 0 块「坯料」（MT-E1 用户复现路径）', () => {
    const editor = makeEditor()
    editor.newProject()
    expect(editor.volume.nonEmptyCount).toBe(27)
    editor.undo()
    expect(editor.volume.nonEmptyCount).toBe(0)
    expect(emptyParts(editor.parts)).toEqual([])
  })

  it('噪声生长 → 撤销 ⇒ 不留 0 块「噪声雕塑」（MT-E12；块数回到 27）', () => {
    const f = blankVolume()
    const patch = applyProgramOp(f.log, opOf({ key: f.key }), f.compositions)
    expect(patch).not.toBeNull()
    expect(f.parts.list().some((p) => p.name.startsWith('噪声雕塑') && p.blocks.size > 0)).toBe(true)
    f.log.undo()
    expect(f.volume.nonEmptyCount).toBe(27)
    expect(emptyParts(f.parts)).toEqual([])
  })

  it('不误删：newPart 的有意空构件（创建无补丁跟随）落笔→撤销 ⇒ 保留为空', () => {
    const editor = makeEditor()
    editor.newProject()
    editor.newPart() // 空构件 + 选中；后续落笔归它（D-B ③）
    setUi({ brushSize: { x: 1, y: 1, z: 1 }, tool: 'place', overridePlace: false })
    editor.strokeBegin()
    editor.strokeApply({ x: 5, y: 0, z: 0 })
    editor.strokeCommit() // 该笔 seq 与构件创建 seq 巧合相同——判定不得只看 seq
    editor.undo()
    const manual = editor.parts.list().find((p) => p.name.startsWith('构件'))
    expect(manual).toBeDefined()
    expect(manual!.blocks.size).toBe(0)
  })

  it('不误删：仍有块的构件在撤销后保留（自己的块未被退光）', () => {
    const f = blankVolume()
    const part = f.parts.create('保留件', f.log.patches.length)
    f.log.apply({ type: 'set', x: 9, y: 0, z: 9, key: f.key, partId: part.id })
    f.log.apply({ type: 'set', x: 8, y: 0, z: 8, key: f.key, partId: part.id })
    f.log.undo()
    expect(f.parts.get(part.id)?.blocks.size).toBe(1)
    expect(f.parts.list().some((p) => p.id === part.id)).toBe(true)
  })

  it('redo 复活捆绑构件：同 id · 同名 · 27 块归位；再 undo 仍剪掉', () => {
    const editor = makeEditor()
    editor.newProject()
    const id = editor.parts.list().find((p) => p.name === '坯料')!.id
    editor.undo()
    expect(editor.parts.list().some((p) => p.id === id)).toBe(false)
    editor.redo()
    const revived = editor.parts.list().find((p) => p.name === '坯料')
    expect(revived).toBeDefined()
    expect(revived!.id).toBe(id)
    expect(revived!.blocks.size).toBe(27)
    expect(editor.volume.nonEmptyCount).toBe(27)
    editor.undo()
    expect(editor.parts.list().some((p) => p.id === id)).toBe(false)
  })

  it('撤销后 replay(log) = 当前模型（I2 保持：creation 条目同步回收）', () => {
    // 夹具走 Editor 全记账路径（newProject + place 都进日志）⇒ replay 才完整描述体积
    const editor = makeEditor()
    editor.newProject()
    editor.place(5, 0, 0)
    editor.undo() // 撤掉放置：坯料仍有 27 块（有块构件不剪）
    let replayed = PatchLog.replay(editor.log.patches, editor.volume.palette.list(), editor.log.partCreations)
    expect(replayed.parts.serialize()).toEqual(editor.parts.serialize())
    editor.undo() // 撤掉初始化：坯料被剪
    replayed = PatchLog.replay(editor.log.patches, editor.volume.palette.list(), editor.log.partCreations)
    expect(replayed.volume.digest()).toEqual(editor.volume.digest())
    expect(replayed.parts.serialize()).toEqual(editor.parts.serialize())
  })

  it('bundled 标记随项目文件往返：存档→读档→撤销 ⇒ 仍不留 0 块构件', () => {
    const editor = makeEditor()
    editor.newProject()
    const text = editor.exportFile()
    const fresh = makeEditor()
    const res = fresh.importFile(text)
    expect(res.ok).toBe(true)
    fresh.undo()
    expect(fresh.volume.nonEmptyCount).toBe(0)
    expect(emptyParts(fresh.parts)).toEqual([])
  })
})
