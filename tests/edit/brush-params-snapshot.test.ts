// 交互编辑 P1 · `A-07`（design §A4 笔刷事务）：**一笔的参数快照不被中途变更污染**。
// 契约（design §A4）："笔刷中途工具、颜色、尺寸、范围及过滤使用落笔快照；变更设置先结束/取消当前笔再启用"。
// 现状缺陷：`stroke.apply` 每步读实时 store，而 `StrokeOp`（action/mode/size）与 commit 的 label 在 begin 时定下
// ⇒ 一笔内改尺寸/工具会把同一补丁混成两套参数。修法 = `session-view.ts` 三个设置 setter 先取消当前笔。
import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryProjectStore } from '../../src/io/project-store'
import type { StrokeOp } from '../../src/core/types'
import { Editor } from '../../src/edit/editor'
import { setUi, useEditorUi } from '../../src/state/editor-store'

function makeEditor(): Editor {
  const editor = new Editor(new MemoryProjectStore())
  editor.setMode('edit')
  setUi({ brushSize: { x: 1, y: 1, z: 1 }, brushSizes: { place: { x: 1, y: 1, z: 1 }, erase: { x: 1, y: 1, z: 1 }, paint: { x: 1, y: 1, z: 1 } } })
  setUi({ tool: 'place', overridePlace: false, currentIdentity: 'color:red' })
  return editor
}

const at = (x: number, y: number, z: number) => ({ x, y, z })

beforeEach(() => {
  setUi({ mode: 'edit', tool: 'place', overridePlace: false, message: null })
})

describe('A-07 · 一笔进行中变更笔刷设置', () => {
  it('中途改尺寸 ⇒ 先取消当前笔（还原 + 不记账），不把两套尺寸混进同一条补丁', () => {
    const editor = makeEditor()
    editor.newProject()
    setUi({ brushSize: { x: 1, y: 1, z: 1 }, tool: 'place', overridePlace: false })
    const base = editor.volume.nonEmptyCount
    const patchesBefore = editor.log.patches.length

    expect(editor.strokeBegin()).toBe(true)
    editor.strokeApply(at(3, 0, 0))
    expect(editor.stroke.active).toBe(true)

    editor.setBrushSize({ x: 2, y: 1, z: 1 }) // 面板数字输入 / 快捷键都走这里

    expect(editor.stroke.active).toBe(false) // 当前笔先结束
    expect(useEditorUi.getState().brushSize).toEqual({ x: 2, y: 1, z: 1 }) // 新设置已生效
    expect(editor.volume.nonEmptyCount).toBe(base) // 半笔已完整还原
    expect(editor.log.patches).toHaveLength(patchesBefore) // 不记账
    expect(useEditorUi.getState().message).toMatch(/已取消/)

    // 下一笔用新尺寸；若半笔仍在，这里会写成 2 格且 op.size = {2,1,1}
    expect(editor.strokeBegin()).toBe(true)
    editor.strokeApply(at(3, 0, 0))
    editor.strokeCommit()
    const stroke = editor.log.patches[patchesBefore]!
    expect((stroke.op as StrokeOp).size).toEqual({ x: 2, y: 1, z: 1 })
    expect(stroke.changes).toHaveLength(2)
    expect(editor.volume.nonEmptyCount).toBe(base + 2)
  })

  it('中途切工具 ⇒ 先取消当前笔；下一笔才是新工具', () => {
    const editor = makeEditor()
    editor.newProject()
    setUi({ brushSize: { x: 1, y: 1, z: 1 }, tool: 'place', overridePlace: false })
    const base = editor.volume.nonEmptyCount
    const patchesBefore = editor.log.patches.length

    editor.strokeBegin()
    editor.strokeApply(at(5, 0, 0))
    editor.setTool('erase')

    expect(editor.stroke.active).toBe(false)
    expect(editor.volume.getBlock(5, 0, 0)).toBe(0) // 半个放置块已还原
    expect(editor.log.patches).toHaveLength(patchesBefore)

    editor.strokeBegin()
    editor.strokeApply(at(1, 1, 1)) // 坯料本体：擦除命中
    editor.strokeCommit()
    const stroke = editor.log.patches[patchesBefore]!
    expect((stroke.op as StrokeOp).action).toBe('erase')
    expect(editor.volume.getBlock(1, 1, 1)).toBe(0)
    expect(editor.volume.nonEmptyCount).toBe(base - 1)
  })

  it('中途改替换开关 ⇒ 先取消当前笔（增量/替换不混在同一笔）', () => {
    const editor = makeEditor()
    editor.newProject()
    setUi({ currentIdentity: 'color:red', brushSize: { x: 1, y: 1, z: 1 }, tool: 'place', overridePlace: false })

    editor.strokeBegin()
    editor.strokeApply(at(3, 0, 0))
    editor.setOverridePlace(true)

    expect(editor.stroke.active).toBe(false)
    expect(editor.volume.getBlock(3, 0, 0)).toBe(0)
    expect(useEditorUi.getState().overridePlace).toBe(true)
  })

  it('无活动笔时三个 setter 不改变行为（不丢设置、不误取消）', () => {
    const editor = makeEditor()
    editor.newProject()
    const patchesBefore = editor.log.patches.length
    editor.setBrushSize({ x: 3, y: 1, z: 1 }) // 当前工具 = place ⇒ 存进 place 那一份
    editor.setOverridePlace(true)
    // `REQ-064`：切工具会读回**该工具自己**那一份（镜像随之变）——这是既有口径，不是本次改动
    editor.setTool('paint')
    expect(useEditorUi.getState().tool).toBe('paint')
    expect(useEditorUi.getState().brushSizes.place).toEqual({ x: 3, y: 1, z: 1 })
    expect(useEditorUi.getState().brushSize).toEqual({ x: 1, y: 1, z: 1 }) // paint 那份的初值
    editor.setBrushSize({ x: 2, y: 2, z: 2 })
    expect(useEditorUi.getState().brushSizes.paint).toEqual({ x: 2, y: 2, z: 2 })
    expect(useEditorUi.getState().brushSize).toEqual({ x: 2, y: 2, z: 2 })
    expect(useEditorUi.getState().overridePlace).toBe(true)
    // 三次设置调用都不该取消任何东西、也不该新增补丁
    expect(editor.stroke.active).toBe(false)
    expect(editor.log.patches).toHaveLength(patchesBefore)
  })
})
