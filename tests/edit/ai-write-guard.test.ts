// 交互编辑 P1 · `A-09`（活动笔与 AI 写入守卫）：AI 不得写进人工半笔，返回明确 busy。
// 契约（design §A4 / §A5 A-09）："活动人工笔刷不被 AI 静默取消、不允许 AI 写进半笔。推荐返回 busy"；
// "旧版本写入零修改并给 stale/busy 原因"。**注**：本条只实现 busy 面；
// "笔刷结束后先核版本再重试"里的**模型/项目版本契约由 P0 任务 1 定**，未交付前不在本文件发明口径。
// 缺陷（PA-08）：拖动期间是旁路直写（不进日志），AI 补丁插进中间后 `commitStroke` 记的是落笔前 `before`
// ⇒ `PatchLog.replay(log) ≠ 当前模型`（I2 破），且撤销那一笔会覆盖 AI 改动；
// 另两条路径原先是 `stroke.cancel()` **静默吃掉**人工半笔（无回执）。
import { beforeEach, describe, expect, it } from 'vitest'
import { PatchLog } from '../../src/core/patch-log'
import { MemoryProjectStore } from '../../src/io/project-store'
import { Editor } from '../../src/edit/editor'
import { useEditorUi, setUi } from '../../src/state/editor-store'

function makeEditor(): Editor {
  const editor = new Editor(new MemoryProjectStore())
  editor.setMode('edit')
  setUi({ brushSize: { x: 1, y: 1, z: 1 }, brushSizes: { place: { x: 1, y: 1, z: 1 }, erase: { x: 1, y: 1, z: 1 }, paint: { x: 1, y: 1, z: 1 } } })
  setUi({ tool: 'place', overridePlace: false, currentIdentity: 'color:red' })
  return editor
}

const at = (x: number, y: number, z: number) => ({ x, y, z })

function blocksOf(editor: Editor): string[] {
  const out: string[] = []
  for (const b of editor.volume.iterBlocks()) out.push(`${b.x},${b.y},${b.z}=${b.key}`)
  return out.sort()
}

/** 日志重放 = 当前模型（I2）：A-09 的正本就是它 */
function replayMatches(editor: Editor): boolean {
  const r = PatchLog.replay(editor.log.patches, editor.volume.palette.list(), editor.log.partCreations)
  const replayed: string[] = []
  for (const b of r.volume.iterBlocks()) replayed.push(`${b.x},${b.y},${b.z}=${b.key}`)
  return replayed.sort().join('|') === blocksOf(editor).join('|')
}

beforeEach(() => {
  setUi({ mode: 'edit', tool: 'place', overridePlace: false, message: null })
})

describe('A-09 · 人工一笔进行中的三条 AI 写路径', () => {
  it('aiProgramOp：零修改 + busy；人工半笔不被取消', () => {
    const editor = makeEditor()
    editor.newProject()
    setUi({ brushSize: { x: 1, y: 1, z: 1 }, tool: 'place', overridePlace: false })
    const patchesBefore = editor.log.patches.length
    const blocksBefore = blocksOf(editor)

    editor.strokeBegin()
    editor.strokeApply(at(5, 0, 0))
    const afterStrokeApply = blocksOf(editor)
    expect(editor.stroke.active).toBe(true)

    const r = editor.aiProgramOp({ type: 'program', name: 'presetShape', params: { shape: 'box', origin: { x: 8, y: 0, z: 8 }, size: { x: 2, y: 2, z: 2 }, key: editor.currentKey() } })

    expect(r).toEqual({ busy: true }) // 明确 busy，不是 null（null = 零变化）
    expect(editor.volume.getBlock(8, 0, 0)).toBe(0) // 零修改
    expect(editor.log.patches).toHaveLength(patchesBefore)
    expect(blocksOf(editor)).toEqual(afterStrokeApply)
    expect(editor.stroke.active).toBe(true) // **不静默取消人工半笔**
    expect(useEditorUi.getState().message).toMatch(/一笔进行中/)

    // 人工笔照常收尾 ⇒ 1 条补丁，且 replay = 模型
    editor.strokeCommit()
    expect(editor.log.patches).toHaveLength(patchesBefore + 1)
    expect(editor.volume.getBlock(5, 0, 0)).not.toBe(0)
    expect(replayMatches(editor)).toBe(true)
    expect(blocksOf(editor)).not.toEqual(blocksBefore)
  })

  it('aiBrush：零修改 + busy；人工半笔保留，收尾后 replay 仍等于模型', () => {
    const editor = makeEditor()
    editor.newProject()
    setUi({ brushSize: { x: 1, y: 1, z: 1 }, tool: 'place', overridePlace: false })
    const patchesBefore = editor.log.patches.length

    editor.strokeBegin()
    editor.strokeApply(at(5, 0, 0))
    const afterStrokeApply = blocksOf(editor)

    const r = editor.aiBrush({ anchors: [at(6, 0, 0)], size: at(1, 1, 1), action: 'place', mode: 'additive', key: editor.currentKey() })

    expect(r.busy).toBe(true)
    expect(r.patch).toBeNull()
    expect(editor.volume.getBlock(6, 0, 0)).toBe(0)
    expect(blocksOf(editor)).toEqual(afterStrokeApply)
    expect(editor.stroke.active).toBe(true)

    editor.strokeCommit()
    expect(editor.log.patches).toHaveLength(patchesBefore + 1)
    expect(editor.volume.getBlock(5, 0, 0)).not.toBe(0)
    expect(replayMatches(editor)).toBe(true)
  })

  it('aiSetCells：零修改 + busy；人工半笔保留', () => {
    const editor = makeEditor()
    editor.newProject()
    setUi({ brushSize: { x: 1, y: 1, z: 1 }, tool: 'place', overridePlace: false })
    const patchesBefore = editor.log.patches.length

    editor.strokeBegin()
    editor.strokeApply(at(5, 0, 0))
    const afterStrokeApply = blocksOf(editor)

    const r = editor.aiSetCells({ cells: [{ x: 6, y: 0, z: 0, key: editor.currentKey() }] })

    expect(r).toEqual({ busy: true })
    expect(editor.volume.getBlock(6, 0, 0)).toBe(0)
    expect(blocksOf(editor)).toEqual(afterStrokeApply)
    expect(editor.stroke.active).toBe(true)

    editor.strokeCommit()
    expect(editor.log.patches).toHaveLength(patchesBefore + 1)
    expect(replayMatches(editor)).toBe(true)
  })

  it('人工笔结束后重试 ⇒ 正常写入（busy 不是永久拒绝，也不是锁）', () => {
    const editor = makeEditor()
    editor.newProject()
    setUi({ brushSize: { x: 1, y: 1, z: 1 }, tool: 'place', overridePlace: false })
    const patchesBefore = editor.log.patches.length

    editor.strokeBegin()
    editor.strokeApply(at(5, 0, 0))
    expect(editor.aiBrush({ anchors: [at(6, 0, 0)], size: at(1, 1, 1), action: 'place', mode: 'additive', key: editor.currentKey() }).busy).toBe(true)
    editor.strokeCommit()

    const r = editor.aiBrush({ anchors: [at(6, 0, 0)], size: at(1, 1, 1), action: 'place', mode: 'additive', key: editor.currentKey() })
    expect(r.busy).toBeUndefined()
    expect(r.patch).not.toBeNull()
    expect(editor.volume.getBlock(6, 0, 0)).not.toBe(0)
    expect(editor.log.patches).toHaveLength(patchesBefore + 2) // 人工一笔 + AI 一笔
    expect(replayMatches(editor)).toBe(true)
  })
})

describe('A-09 · 无活动笔时的既有行为不变（对照）', () => {
  it('无人工笔：aiProgramOp 返回补丁、aiBrush/aiSetCells 不 busy、replay = 模型', () => {
    const editor = makeEditor()
    editor.newProject()
    const patchesBefore = editor.log.patches.length

    const patch = editor.aiProgramOp({ type: 'program', name: 'presetShape', params: { shape: 'box', origin: { x: 8, y: 0, z: 8 }, size: { x: 2, y: 2, z: 2 }, key: editor.currentKey() } })
    expect(patch).not.toBeNull()
    expect(patch && 'busy' in patch).toBe(false)
    expect(editor.log.patches).toHaveLength(patchesBefore + 1)

    const b = editor.aiBrush({ anchors: [at(20, 0, 0)], size: at(1, 1, 1), action: 'place', mode: 'additive', key: editor.currentKey() })
    expect(b.busy).toBeUndefined()
    expect(b.patch).not.toBeNull()

    const s = editor.aiSetCells({ cells: [{ x: 30, y: 0, z: 0, key: editor.currentKey() }] })
    expect(s).not.toBeNull()
    expect(s && 'busy' in s).toBe(false)

    expect(replayMatches(editor)).toBe(true)
    expect(editor.stroke.active).toBe(false)
  })
})
