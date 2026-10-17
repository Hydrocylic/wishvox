// 交互编辑 P1 · `A-07`（笔刷中断收尾）：编辑态一笔的收尾与取消出口。
// 本文件是 `PA-49`（一笔卡住 ⇒ 此后写入与撤销全被拒）在**无头面**的回归：
// `Viewport.tsx` 的本地 `strokeActive` 副本已删除、改读 `Editor.stroke.active`（单一权威状态），
// 并补了窗口级兜底 + Esc；这里锁定"遗留活动态必须有取消出口、且取消后模型与撤销都恢复可用"。
// 浏览器面的真实手势（拖出窗口松手 / 失焦）见人工单，不在本文件断言。
import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryProjectStore } from '../../src/io/project-store'
import { Editor } from '../../src/edit/editor'
import { setUi, useEditorUi } from '../../src/state/editor-store'

function makeEditor(): Editor {
  const editor = new Editor(new MemoryProjectStore())
  editor.setMode('edit')
  // 会话态是全局 store：显式摆好本文件依赖的默认值，避免用例间串味
  setUi({ brushSize: { x: 1, y: 1, z: 1 }, brushSizes: { place: { x: 1, y: 1, z: 1 }, erase: { x: 1, y: 1, z: 1 }, paint: { x: 1, y: 1, z: 1 } } })
  setUi({ tool: 'place', overridePlace: false, currentIdentity: 'color:red' })
  return editor
}

const at = (x: number, y: number, z: number) => ({ x, y, z })

beforeEach(() => {
  setUi({ mode: 'edit', tool: 'place', overridePlace: false, message: null })
})

describe('A-07 · 一笔的收尾语义（编辑态）', () => {
  it('按下→松手恰一笔：拖动 3 锚点只留 1 条补丁，一次撤销全退', () => {
    const editor = makeEditor()
    editor.newProject()
    setUi({ currentIdentity: 'color:red', brushSize: { x: 1, y: 1, z: 1 }, tool: 'place', overridePlace: false })
    const patchesBefore = editor.log.patches.length
    const nonEmptyBefore = editor.volume.nonEmptyCount

    expect(editor.stroke.active).toBe(false)
    expect(editor.strokeBegin()).toBe(true)
    expect(editor.stroke.active).toBe(true) // 权威状态就在 StrokeSession
    editor.strokeApply(at(3, 0, 0))
    editor.strokeApply(at(3, 0, 1))
    editor.strokeApply(at(3, 0, 2))
    editor.strokeCommit()

    expect(editor.stroke.active).toBe(false)
    expect(editor.log.patches).toHaveLength(patchesBefore + 1)
    expect(editor.log.patches[patchesBefore]!.changes).toHaveLength(3)
    editor.undo()
    expect(editor.volume.nonEmptyCount).toBe(nonEmptyBefore)
  })

  it('零变化不新增历史：同色上色一笔 ⇒ 补丁数不变且反馈可区分', () => {
    const editor = makeEditor()
    editor.newProject()
    setUi({ currentIdentity: 'color:light-gray', brushSize: { x: 1, y: 1, z: 1 }, tool: 'paint', overridePlace: false })
    const before = editor.log.patches.length
    editor.strokeBegin()
    editor.strokeApply(at(1, 1, 1))
    editor.strokeCommit()
    expect(editor.log.patches).toHaveLength(before)
    expect(useEditorUi.getState().message).toMatch(/零变化，不记账/)
  })

  it('取消（pointercancel / 失焦 / Esc 的公共出口）⇒ 体素与归属完整还原、不记账', () => {
    const editor = makeEditor()
    editor.newProject()
    const blank = editor.parts.list().find((p) => p.name === '坯料')!
    setUi({ brushSize: { x: 1, y: 1, z: 1 }, tool: 'erase', overridePlace: false })
    const nonEmptyBefore = editor.volume.nonEmptyCount
    const patchesBefore = editor.log.patches.length
    const ownerBefore = editor.parts.partIdOf(0, 0, 0)

    editor.strokeBegin()
    editor.strokeApply(at(0, 0, 0))
    editor.strokeApply(at(1, 0, 0))
    expect(editor.volume.nonEmptyCount).toBe(nonEmptyBefore - 2) // 旁路已写（所见即所得）
    editor.strokeCancel()

    expect(editor.stroke.active).toBe(false)
    expect(editor.volume.nonEmptyCount).toBe(nonEmptyBefore)
    expect(editor.volume.getBlock(0, 0, 0)).not.toBe(0)
    expect(editor.parts.partIdOf(0, 0, 0)).toBe(blank.id)
    expect(editor.parts.partIdOf(0, 0, 0)).toBe(ownerBefore)
    expect(editor.log.patches).toHaveLength(patchesBefore)
    expect(useEditorUi.getState().message).toMatch(/已取消/)
  })

  it('取消后下一笔立即可用、撤销不被遗留活动态挡住', () => {
    const editor = makeEditor()
    editor.newProject()
    setUi({ brushSize: { x: 1, y: 1, z: 1 }, tool: 'place', overridePlace: false })
    const base = editor.volume.nonEmptyCount

    editor.strokeBegin()
    editor.strokeApply(at(5, 0, 0))
    editor.strokeCancel()
    expect(editor.strokeBegin()).toBe(true) // 立即开新一笔
    editor.strokeApply(at(6, 0, 0))
    editor.strokeCommit()
    expect(editor.volume.nonEmptyCount).toBe(base + 1)
    editor.undo() // 撤销不被遗留活动态挡住
    expect(editor.volume.nonEmptyCount).toBe(base)
  })
})

describe('A-07 · 遗留活动态必须有出口（PA-49 的无头面）', () => {
  it('人为留下一笔（模拟窗口外收尾事件没到）⇒ 写入被拒 + 撤销零效果；取消后两者都恢复', () => {
    const editor = makeEditor()
    editor.newProject()
    setUi({ brushSize: { x: 1, y: 1, z: 1 }, tool: 'place', overridePlace: false })
    const base = editor.volume.nonEmptyCount
    const patchesBefore = editor.log.patches.length
    const before = editor.volume.digest()

    // 模拟"按下并涂抹后，pointerup / blur 一个都没到"
    expect(editor.strokeBegin()).toBe(true)
    editor.strokeApply(at(4, 0, 0))
    expect(editor.stroke.active).toBe(true)

    // 卡住期间的表现（这不是缺陷本身，而是缺陷的可观测后果）
    editor.place(9, 0, 0)
    expect(useEditorUi.getState().message).toMatch(/一笔进行中/)
    expect(editor.volume.getBlock(9, 0, 0)).toBe(0)

    // 缺陷核心：硬撤销被提前 return —— 调用成功、模型却不动
    editor.undo()
    expect(editor.volume.getBlock(4, 0, 0)).not.toBe(0)

    // 修后出口：Esc / pointercancel / 窗口失焦（同一 cancel 路径）清掉遗留态
    editor.strokeCancel()
    expect(editor.stroke.active).toBe(false)
    expect(editor.volume.digest()).toEqual(before)
    expect(editor.log.patches).toHaveLength(patchesBefore)

    // 出口之后：写入与撤销都恢复可用（且不重复记账）
    editor.place(9, 0, 0)
    expect(editor.volume.getBlock(9, 0, 0)).not.toBe(0)
    editor.undo()
    expect(editor.volume.nonEmptyCount).toBe(base)
  })

  it('缺陷复现对照：活动笔中既不收尾也不放行下一笔（begin 返回 false）', () => {
    const editor = makeEditor()
    editor.newProject()
    setUi({ brushSize: { x: 1, y: 1, z: 1 }, tool: 'place', overridePlace: false })
    editor.strokeBegin()
    editor.strokeApply(at(4, 0, 0))
    // 这正是 Viewport 删除本地副本后要避免的状态：残留活动笔会拒绝并发起笔
    expect(editor.strokeBegin()).toBe(false)
    editor.strokeCancel()
    expect(editor.strokeBegin()).toBe(true)
    editor.strokeCancel()
  })
})
