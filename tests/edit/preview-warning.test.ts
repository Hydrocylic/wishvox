// `D5`（design §8，2026-10-16）：预览**全无效**时的左上黄字短原因 + 与 `message` 通道的分工。
// 两条判据面：① 纯投影（原因序、短原因文案、短闪序号语义）；② 走真实笔刷路径的 `previewAt`
// （有有效格 ⇒ 清提示；全无效 ⇒ 按拒绝计数给类别；取消 ⇒ 消失）。
import { describe, expect, it } from 'vitest'
import type { BrushRejections } from '../../src/core/brush/apply'
import { Editor } from '../../src/edit/editor'
import { MemoryProjectStore } from '../../src/io/project-store'
import { setUi, useEditorUi } from '../../src/state/editor-store'
import { nextPreviewReject, PREVIEW_REJECT_TEXT, rejectKindOf } from '../../src/state/preview-warning'

const rejects = (p: Partial<BrushRejections>): BrushRejections => ({
  hidden: 0,
  occupied: 0,
  empty: 0,
  unchanged: 0,
  outOfBounds: 0,
  ...p,
})

function makeEditor(): Editor {
  setUi({
    mode: 'edit',
    tool: 'place',
    layerMode: 'all',
    layerY: 0,
    currentIdentity: 'color:red',
    currentColor: '#c0392b',
    brushSize: { x: 1, y: 1, z: 1 },
    overridePlace: false,
    message: null,
    previewReject: null,
    previewReadout: null,
  })
  const ed = new Editor(new MemoryProjectStore())
  ed.place(0, 0, 0) // 起点一块
  return ed
}

describe('D5-纯投影：原因序与短原因文案（design 逐字）', () => {
  it('取首个：hidden > outOfBounds > occupied > empty > unchanged', () => {
    expect(rejectKindOf(rejects({ hidden: 1, outOfBounds: 2, occupied: 3, empty: 4 }))).toBe('hidden')
    expect(rejectKindOf(rejects({ outOfBounds: 1, occupied: 1, empty: 1 }))).toBe('outOfBounds')
    expect(rejectKindOf(rejects({ occupied: 1, empty: 1 }))).toBe('occupied')
    expect(rejectKindOf(rejects({ empty: 1 }))).toBe('noTarget') // 命中空气 = 没有方块可作用（不是"没命中"）
    expect(rejectKindOf(rejects({ unchanged: 2 }))).toBe('unchanged')
    expect(rejectKindOf(rejects({}))).toBeNull()
  })

  it('短原因文案 = design §8 D5 的指定句（四条逐字）', () => {
    expect(PREVIEW_REJECT_TEXT.hidden).toBe('目标层被隐藏：选择显示全部或调整过滤层')
    expect(PREVIEW_REJECT_TEXT.outOfBounds).toBe('目标超出 ±4096 整数坐标域')
    expect(PREVIEW_REJECT_TEXT.occupied).toBe('增量放置目标已占用')
    expect(PREVIEW_REJECT_TEXT.empty).toBe('无落点：开启工作网格或对准模型')
  })

  it('短闪序号：同类延续不重放闪；换类别 / 从无到有 ⇒ +1', () => {
    const a = nextPreviewReject(null, 'occupied')
    expect(a.seq).toBe(1)
    expect(nextPreviewReject(a, 'occupied')).toBe(a) // 同一对象 ⇒ HUD 不重放动画
    const b = nextPreviewReject(a, 'hidden')
    expect(b.seq).toBe(2)
    expect(b.text).toBe(PREVIEW_REJECT_TEXT.hidden)
    expect(nextPreviewReject(b, 'hidden').seq).toBe(2)
  })
})

describe('D5-笔刷路径：全无效才提示，两条通道不重复', () => {
  it('增量放置命中已占用块 ⇒ occupied 黄字 + message 只留明细', () => {
    const ed = makeEditor()
    setUi({ tool: 'place', overridePlace: false, brushSize: { x: 1, y: 1, z: 1 } })
    expect(ed.previewAt({ x: 0, y: 0, z: 0 })).toEqual([])
    const s = useEditorUi.getState()
    expect(s.previewReject).toMatchObject({ kind: 'occupied', text: PREVIEW_REJECT_TEXT.occupied, seq: 1 })
    expect(s.message).toContain('预览全无效')
    expect(s.message).toContain('已占用 1')
    expect(s.message).not.toContain(PREVIEW_REJECT_TEXT.occupied) // 同句不在两处堆叠
  })

  it('有效预览 ⇒ 不显示黄字（部分裁剪也不算全无效）', () => {
    const ed = makeEditor()
    ed.previewAt({ x: 5, y: 0, z: 0 })
    expect(useEditorUi.getState().previewReject).toBeNull()
    expect(useEditorUi.getState().previewReadout?.cells).toBe(1)
  })

  it('有提示后再出现有效命中 ⇒ 提示消失（design：消失条件之一）', () => {
    const ed = makeEditor()
    ed.previewAt({ x: 0, y: 0, z: 0 }) // 占用 ⇒ 提示
    expect(useEditorUi.getState().previewReject).not.toBeNull()
    ed.previewAt({ x: 6, y: 0, z: 0 }) // 空格可放 ⇒ 有效
    expect(useEditorUi.getState().previewReject).toBeNull()
  })

  it('隐藏层 ⇒ hidden 黄字（含设计文案里的"显示全部"指引）', () => {
    const ed = makeEditor()
    ed.setLayerView('single', 0)
    ed.previewAt({ x: 0, y: 3, z: 0 }) // y=3 被隐藏
    const s = useEditorUi.getState()
    expect(s.previewReject).toMatchObject({ kind: 'hidden', text: PREVIEW_REJECT_TEXT.hidden })
    expect(s.message).toContain('隐藏 1')
  })

  it('越界 ⇒ outOfBounds 黄字；**部分**越界（还有有效格）不算全无效、不提示', () => {
    const ed = makeEditor()
    setUi({ brushSize: { x: 1, y: 2, z: 1 } })
    ed.previewAt({ x: 0, y: 4097, z: 0 }) // 两格全部出域（> ±4096）
    expect(useEditorUi.getState().previewReject).toMatchObject({ kind: 'outOfBounds' })
    // 对照：锚点 y=4096 + 高度 2 ⇒ 一格有效、一格越界（集合裁剪）⇒ 不提示失败原因
    ed.previewAt({ x: 0, y: 4096, z: 0 })
    expect(useEditorUi.getState().previewReject).toBeNull()
    expect(useEditorUi.getState().previewReadout?.cells).toBe(1)
  })

  it('上色同色 ⇒ unchanged 黄字（沿用既有 previewAt 拒绝口径）', () => {
    const ed = makeEditor()
    ed.setTool('paint')
    const key = ed.volume.getBlock(0, 0, 0)
    expect(ed.volume.palette.get(key)?.color).toBe('#c0392b')
    ed.previewAt({ x: 0, y: 0, z: 0 }) // 当前色 = #c0392b ⇒ 零变化
    expect(useEditorUi.getState().previewReject).toMatchObject({ kind: 'unchanged' })
  })

  it('没命中（视口路径显式告知）⇒ empty「无落点…」；擦除没命中 ⇒ noTarget', () => {
    const ed = makeEditor()
    ed.previewMiss('empty')
    expect(useEditorUi.getState().previewReject).toMatchObject({ kind: 'empty', text: PREVIEW_REJECT_TEXT.empty })
    expect(useEditorUi.getState().previewReadout).toBeNull()
    ed.previewMiss('noTarget')
    expect(useEditorUi.getState().previewReject).toMatchObject({ kind: 'noTarget' })
  })

  it('D5 只管编辑/放置：吸管与检视态下 previewMiss 不留黄字', () => {
    const ed = makeEditor()
    ed.previewMiss('empty')
    expect(useEditorUi.getState().previewReject).not.toBeNull()
    ed.setTool('pick')
    ed.previewMiss('empty')
    expect(useEditorUi.getState().previewReject).toBeNull()
    ed.setTool('place')
    ed.previewMiss('empty')
    expect(useEditorUi.getState().previewReject).not.toBeNull()
    ed.setMode('inspect')
    ed.previewMiss('empty')
    expect(useEditorUi.getState().previewReject).toBeNull()
  })

  it('一笔取消 ⇒ 黄字消失（design：消失条件之一）', () => {
    const ed = makeEditor()
    ed.previewAt({ x: 0, y: 0, z: 0 })
    expect(useEditorUi.getState().previewReject).not.toBeNull()
    ed.strokeBegin()
    ed.strokeApply({ x: 9, y: 0, z: 0 })
    ed.strokeCancel()
    expect(useEditorUi.getState().previewReject).toBeNull()
  })

  it('吸管无笔刷预览 ⇒ 也不留黄字', () => {
    const ed = makeEditor()
    ed.previewAt({ x: 0, y: 0, z: 0 })
    ed.setTool('pick')
    expect(useEditorUi.getState().previewReject).toBeNull()
  })
})
