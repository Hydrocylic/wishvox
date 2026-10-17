// r05 收尾 · 件四（`REQ-064`）· **笔刷尺寸（W·H·L）按工具各存一份**。
//
// 判据正本 = `discovery/requirements.md` 的 `REQ-064`（五条）+ `REQ-055`（每轴 1–8 / 替换开关 / 体积 / 锚点 = 不动项）。
// 语义：放置 / 擦除 / 上色**各持一份**尺寸；**切换工具读回该工具自己上次的尺寸**（记住、不重置、不跨工具污染，会话态）；
// 新会话初值三工具各 `{1,1,1}`；**项目文件 / 补丁日志不含尺寸**；撤销 / 重做不回退尺寸；`overridePlace` 仍全局单份。
//
// 读回面：`state/editor-store.ts` 的 `brushSizes`（按工具）+ `brushSize`（**当前工具那份的镜像**，`REQ-055` 的既有读点）。
import { beforeEach, describe, expect, it } from 'vitest'
import { BRUSH_MAX_AXIS } from '../../src/core/brush/types'
import type { Coord, StrokeOp } from '../../src/core/types'
import type { EditorRenderer } from '../../src/edit/render-port'
import { Editor } from '../../src/edit/editor'
import { MemoryProjectStore } from '../../src/io/project-store'
import { setUi, useEditorUi } from '../../src/state/editor-store'

/** 渲染层假件：记录预览集合（用于"预览体积与补丁 size 同源"的读回） */
class FakeRenderer implements EditorRenderer {
  cells: readonly Coord[] = []
  applyChanges(): void {}
  rebuildAll(): void {}
  setAppearance(): void {}
  setHighlightedPart(): void {}
  frameModel(): void {}
  setPreview(cells: readonly Coord[] | null): void {
    this.cells = cells ?? []
  }
}
const at = (x: number, y: number, z: number): Coord => ({ x, y, z })
/** 读回面：按工具那份 + 当前工具的镜像（缺字段 ⇒ 报错，避免"静默当默认值"掩盖未实现） */
function sizes(): { place: Coord; erase: Coord; paint: Coord; mirror: Coord; overridePlace: boolean } {
  const s = useEditorUi.getState() as unknown as {
    brushSizes?: { place: Coord; erase: Coord; paint: Coord }
    brushSize: Coord
    overridePlace: boolean
  }
  if (!s.brushSizes) throw new Error('store 无 brushSizes（按工具一份尺寸）⇒ REQ-064 未实现')
  return { place: s.brushSizes.place, erase: s.brushSizes.erase, paint: s.brushSizes.paint, mirror: s.brushSize, overridePlace: s.overridePlace }
}

/** 单测试起点：把**三份**尺寸与会话态复位成"新会话"（store 跨用例共享 ⇒ 必须显式回初值） */
function makeEditor(): { editor: Editor; fake: FakeRenderer } {
  const unit = { x: 1, y: 1, z: 1 }
  setUi({
    mode: 'edit',
    tool: 'place',
    brushSize: { ...unit },
    brushSizes: { place: { ...unit }, erase: { ...unit }, paint: { ...unit } },
    overridePlace: false,
    currentIdentity: 'color:red',
    layerMode: 'below',
    layerY: 3,
    previewReadout: null,
  })
  const editor = new Editor(new MemoryProjectStore())
  const fake = new FakeRenderer()
  editor.attachRenderer(fake)
  return { editor, fake }
}

describe('REQ-064 · 笔刷尺寸按工具各持一份（切工具记住上次 · 会话态）', () => {
  let editor: Editor
  let fake: FakeRenderer

  beforeEach(() => {
    const made = makeEditor()
    editor = made.editor
    fake = made.fake
  })

  it('① 放置 2×2×2 · 擦除 1×1×1 · 上色 3×1×1 ⇒ 来回切换各自保持', () => {
    editor.setBrushSize({ x: 2, y: 2, z: 2 })
    editor.setTool('erase')
    editor.setBrushSize({ x: 1, y: 1, z: 1 })
    editor.setTool('paint')
    editor.setBrushSize({ x: 3, y: 1, z: 1 })
    console.info('[件四-① 设定后] ' + JSON.stringify(sizes()))
    expect(useEditorUi.getState().brushSizes).toEqual({ place: at(2, 2, 2), erase: at(1, 1, 1), paint: at(3, 1, 1) })

    // 来回切换：每次切到某工具，镜像 = 该工具自己那份（记住、不重置、不跨工具污染）
    for (const [tool, expected] of [['place', at(2, 2, 2)], ['erase', at(1, 1, 1)], ['paint', at(3, 1, 1)], ['erase', at(1, 1, 1)], ['place', at(2, 2, 2)], ['paint', at(3, 1, 1)]] as const) {
      editor.setTool(tool)
      const s = sizes()
      console.info(`[件四-① 切到 ${tool}] ` + JSON.stringify({ mirror: s.mirror, perTool: s[tool] }))
      expect(s.mirror, `切到 ${tool} 后镜像 = 该工具上次那份`).toEqual(expected)
      expect(s[tool]).toEqual(expected)
    }
    // 只切工具不动尺寸 ⇒ 三份都不变
    expect(useEditorUi.getState().brushSizes).toEqual({ place: at(2, 2, 2), erase: at(1, 1, 1), paint: at(3, 1, 1) })
  })

  it('② 切到任一工具：预览体积与补丁 size 都用该工具那一份', () => {
    // 放置 2×1×1 / 上色 1×3×1：预览格数应各按自己那份算（上色空模型上无可改块 ⇒ 0 格）
    editor.setBrushSize({ x: 2, y: 1, z: 1 })
    const previewPlace = editor.previewAt(at(0, 0, 0))
    const rendererPlace = fake.cells.length
    editor.setTool('paint')
    editor.setBrushSize({ x: 1, y: 3, z: 1 })
    const previewPaint = editor.previewAt(at(0, 0, 0))
    console.info('[件四-② 预览体积] ' + JSON.stringify({ place: previewPlace.length, rendererPlace, paint: previewPaint.length, placeSize: sizes().place, paintSize: sizes().paint }))
    expect(previewPlace).toHaveLength(2)
    expect(rendererPlace).toBe(2)
    expect(previewPaint).toHaveLength(0) // 空模型：上色只改已有块 ⇒ 体积 ∩ 谓词 = 空

    // 补丁 size = 该工具那一份：切到 place 打一笔 ⇒ op.size = place 那份
    editor.setTool('place')
    expect(editor.strokeBegin()).toBe(true)
    editor.strokeApply(at(5, 0, 5))
    editor.strokeCommit()
    const patchPlace = editor.log.patches[editor.log.patches.length - 1]!
    console.info('[件四-② place 补丁] ' + JSON.stringify({ op: patchPlace.op, label: patchPlace.label }))
    expect((patchPlace.op as StrokeOp).size).toEqual(at(2, 1, 1))

    // 擦除：设 1×3×1 ⇒ 打一笔 ⇒ op.size = erase 那份；且 place 那份不受影响
    editor.setTool('erase')
    editor.setBrushSize({ x: 1, y: 3, z: 1 })
    expect(editor.strokeBegin()).toBe(true)
    editor.strokeApply(at(5, 0, 5))
    editor.strokeCommit()
    const patchErase = editor.log.patches[editor.log.patches.length - 1]!
    console.info('[件四-② erase 补丁] ' + JSON.stringify({ op: patchErase.op, label: patchErase.label }))
    expect((patchErase.op as StrokeOp).size).toEqual(at(1, 3, 1))
    expect(sizes().place).toEqual(at(2, 1, 1))
    expect(sizes().paint).toEqual(at(1, 3, 1))
  })

  it('③ 新会话初值三工具均 {1,1,1}（与改动前的单份默认同值）', () => {
    const fresh = useEditorUi.getState().brushSizes
    const mirror = useEditorUi.getState().brushSize
    console.info('[件四-③ 初值] ' + JSON.stringify({ fresh, mirror, tool: useEditorUi.getState().tool }))
    expect(fresh).toEqual({ place: at(1, 1, 1), erase: at(1, 1, 1), paint: at(1, 1, 1) })
    expect(mirror).toEqual(at(1, 1, 1))
  })

  it('④ 每轴 1–8 与越界报错口径不变（validateBrushSize 原样，走笔刷路径抛出）', () => {
    const bad = [
      { x: 0, y: 1, z: 1 },
      { x: 1, y: 9, z: 1 },
      { x: 1, y: 1, z: 1.5 },
    ]
    for (const size of bad) {
      editor.setBrushSize(size) // 会话态 setter 只存值（与改动前同：校验在体积计算处）
      let msg = ''
      try {
        editor.previewAt(at(0, 0, 0)) // 体积计算 = validateBrushSize 的既有抛出点
      } catch (e) {
        msg = (e as Error).message
      }
      console.info(`[件四-④ 越界 ${size.x}×${size.y}×${size.z}] ` + JSON.stringify({ msg }))
      expect(msg, `每轴 1–${BRUSH_MAX_AXIS} 的越界必须抛教学式报错`).toContain(`1–${BRUSH_MAX_AXIS}`)
    }
    // 合法边界：8 与 1 都收，并按工具各存一份
    editor.setTool('erase')
    editor.setBrushSize({ x: 8, y: 1, z: 1 })
    editor.setTool('paint')
    editor.setBrushSize({ x: 1, y: 1, z: 8 })
    console.info('[件四-④ 边界合法] ' + JSON.stringify(sizes()))
    expect(sizes().erase).toEqual(at(8, 1, 1))
    expect(sizes().paint).toEqual(at(1, 1, 8))
  })

  it('⑤ 项目文件 / 补丁日志不含尺寸表；撤销 / 重做不回退尺寸；overridePlace 仍全局单份只对放置有意义', () => {
    editor.setTool('erase')
    editor.setBrushSize({ x: 2, y: 1, z: 1 })
    editor.place(3, 0, 3)
    editor.setTool('place')
    editor.setBrushSize({ x: 2, y: 1, z: 1 })
    editor.strokeBegin()
    editor.strokeApply(at(5, 0, 5))
    editor.strokeCommit()
    const strokePatch = editor.log.patches[editor.log.patches.length - 1]!
    const file = editor.exportFile()
    console.info('[件四-⑤ 项目文件含尺寸表?] ' + JSON.stringify({ brushSizesInFile: /brushSizes/i.test(file), brushSizeInFile: /brushSize/i.test(file), len: file.length }))
    expect(/brushSize|brushSizes/i.test(file), '项目文件不得含笔刷尺寸（REQ-058 会话态口径）').toBe(false)

    // 补丁日志：笔刷一笔的 op 只有 action / mode / size（体积本身），没有"按工具的尺寸表"
    const opKeys = Object.keys(strokePatch.op).sort()
    console.info('[件四-⑤ 笔刷一笔 op 字段] ' + JSON.stringify({ opKeys, op: strokePatch.op }))
    expect(opKeys).toEqual(['action', 'mode', 'size', 'type'])
    expect((strokePatch.op as StrokeOp).size).toEqual(at(2, 1, 1))
    expect(JSON.stringify(editor.log.patches)).not.toMatch(/brushSizes/)

    // 撤销 / 重做不回退尺寸
    editor.undo()
    const afterUndo = sizes()
    editor.redo()
    const afterRedo = sizes()
    console.info('[件四-⑤ 撤销/重做后] ' + JSON.stringify({ erase: afterUndo.erase, place: afterRedo.place }))
    expect(afterUndo.erase).toEqual(at(2, 1, 1))
    expect(afterRedo.place).toEqual(at(2, 1, 1))

    // overridePlace：全局单份、只对放置有意义（擦除 / 上色下置 true 不改变它们的语义读回）
    editor.setTool('paint')
    editor.setBrushSize({ x: 1, y: 1, z: 8 })
    editor.setOverridePlace(true)
    const s = sizes()
    console.info('[件四-⑤ overridePlace] ' + JSON.stringify({ overridePlace: s.overridePlace, tool: useEditorUi.getState().tool, paint: s.paint }))
    expect(s.overridePlace).toBe(true)
    expect(typeof s.overridePlace).toBe('boolean') // 单布尔、非按工具表
    expect(s.paint).toEqual(at(1, 1, 8))
    // 切回放置：overridePlace 仍为同一份（不被切工具重置）
    editor.setTool('place')
    console.info('[件四-⑤ 切回放置] ' + JSON.stringify({ overridePlace: sizes().overridePlace, place: sizes().place }))
    expect(sizes().overridePlace).toBe(true)
  })
})
