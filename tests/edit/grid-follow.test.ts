// `D3`（design §8，2026-10-16）+ `D4` 默认档：参考网格独立 y 与两个「参数跟随」的判据面。
// 为什么用假渲染器：`effectiveGridY` 是唯一派生点，渲染层**实际收到**的高度就是它的取证——
// 假件记录每次 `setGrid(wanted)`，断言"跟随时实时等于 layerY、未勾选的一方不变、取消跟随恢复原值"。
import { beforeEach, describe, expect, it } from 'vitest'
import { COORD_LIMIT } from '../../src/core/coords'
import type { LayerFilter } from '../../src/core/brush/predicate'
import type { VoxelChange } from '../../src/core/types'
import { Editor } from '../../src/edit/editor'
import type { EditorRenderer } from '../../src/edit/render-port'
import { MemoryProjectStore } from '../../src/io/project-store'
import { effectiveGridY, setUi, useEditorUi } from '../../src/state/editor-store'

class GridSpy implements EditorRenderer {
  readonly calls: Array<{ base: boolean; layer: boolean; y?: number; refY?: number }> = []
  applyChanges(_c: readonly VoxelChange[]): void {}
  rebuildAll(): void {}
  setAppearance(): void {}
  setHighlightedPart(): void {}
  frameModel(): void {}
  setGrid(wanted: { base: boolean; layer: boolean; y?: number; refY?: number }): void {
    this.calls.push({ ...wanted })
  }
  last(): { base: boolean; layer: boolean; y?: number; refY?: number } {
    return this.calls[this.calls.length - 1]!
  }
}

function makeEditor(): { editor: Editor; spy: GridSpy } {
  setUi({
    layerMode: 'all',
    layerY: 3,
    layerMinY: 0,
    layerMaxY: 5,
    workGridY: 0,
    refGridY: 0,
    followLayerWork: false,
    followLayerRef: false,
    gridBase: false,
    gridLayer: false,
    message: null,
  })
  const editor = new Editor(new MemoryProjectStore())
  const spy = new GridSpy()
  editor.attachRenderer(spy)
  return { editor, spy }
}

describe('D3-① 参考网格 y：默认 0、域 ±4096（含负数）、非法拒绝且原值不变', () => {
  it('默认 0；可设为任意域内整数（含负数与边界），推给渲染层的 refY 同步', () => {
    const { editor, spy } = makeEditor()
    expect(useEditorUi.getState().refGridY).toBe(0)
    editor.setGridView(true, false)
    expect(spy.last()).toMatchObject({ base: true, refY: 0 })
    for (const y of [-4096, -7, 0, 12, COORD_LIMIT]) {
      editor.setRefGridY(y)
      expect(useEditorUi.getState().refGridY).toBe(y)
      expect(spy.last().refY).toBe(y)
    }
  })

  it('非整数 / 越界 / 空 ⇒ 拒绝并保留原值（REQ-065 数域）', () => {
    const { editor, spy } = makeEditor()
    editor.setRefGridY(-9)
    const before = spy.calls.length
    for (const bad of [0.5, COORD_LIMIT + 1, -COORD_LIMIT - 1, Number.NaN, Number.POSITIVE_INFINITY]) {
      editor.setRefGridY(bad)
      expect(useEditorUi.getState().refGridY).toBe(-9)
      expect(useEditorUi.getState().message).toContain('参考网格 y 须为 ±4096 内的整数')
    }
    expect(spy.calls.length).toBe(before) // 非法输入不推渲染层
  })

  it('参考网格不等于放置平面：只有工作网格开关进入 layer 标志（refY 不开启平面拾取）', () => {
    const { editor, spy } = makeEditor()
    editor.setRefGridY(5)
    editor.setGridView(true, false) // 只开参考网格
    expect(spy.last()).toMatchObject({ base: true, layer: false, refY: 5 })
    editor.setGridView(true, true)
    expect(spy.last()).toMatchObject({ base: true, layer: true })
  })
})

describe('D3-② 参数跟随：勾选后实时 = 当前层实际 y，未勾选一方不受影响', () => {
  it('参考网格跟随 ⇒ 拖层次滑块带动 refY；工作网格独立值不变', () => {
    const { editor, spy } = makeEditor()
    editor.setWorkGridY(2)
    editor.setRefGridY(-4)
    editor.setGridFollow('ref', true)
    expect(useEditorUi.getState().followLayerRef).toBe(true)
    expect(spy.last()).toMatchObject({ refY: 3, y: 2 }) // 生效 = layerY=3；工作网格仍是独立 2
    editor.setLayerView('below', 5)
    expect(spy.last()).toMatchObject({ refY: 5, y: 2 })
    expect(useEditorUi.getState().refGridY).toBe(-4) // 独立值全程未被跟随值覆盖
    expect(effectiveGridY(useEditorUi.getState())).toEqual({ ref: 5, work: 2 })
  })

  it('工作网格跟随 ⇒ 拖层次滑块带动 workY；参考网格独立值不变', () => {
    const { editor, spy } = makeEditor()
    editor.setRefGridY(6)
    editor.setWorkGridY(1)
    editor.setGridFollow('work', true)
    expect(spy.last()).toMatchObject({ y: 3, refY: 6 })
    editor.setLayerView('single', 4)
    expect(spy.last()).toMatchObject({ y: 4, refY: 6 })
    expect(useEditorUi.getState().workGridY).toBe(1)
  })

  it('两个跟随互不影响：只勾一个时另一个不跟随滑块', () => {
    const { editor, spy } = makeEditor()
    editor.setWorkGridY(0)
    editor.setRefGridY(0)
    editor.setGridFollow('work', true)
    editor.setLayerView('below', 5)
    expect(spy.last()).toMatchObject({ y: 5, refY: 0 })
    editor.setGridFollow('ref', true)
    editor.setLayerView('below', 2)
    expect(spy.last()).toMatchObject({ y: 2, refY: 2 })
    editor.setGridFollow('work', false)
    editor.setLayerView('below', 5)
    expect(spy.last()).toMatchObject({ y: 0, refY: 5 }) // 工作恢复勾选前的 0
  })

  it('未勾选任何跟随时，拖层次滑块不推网格（网格高度独立于过滤层，A1）', () => {
    const { editor, spy } = makeEditor()
    editor.setWorkGridY(3)
    editor.setRefGridY(1)
    const before = spy.calls.length
    editor.setLayerView('below', 4)
    editor.setLayerView('all', 0)
    expect(spy.calls.length).toBe(before)
  })
})

describe('D3-③ 取消跟随恢复勾选前的独立 y（不把跟随值写回独立值）', () => {
  it('跟随期间改独立值（手动输入被禁用但 API 仍可写）→ 取消跟随用该值', () => {
    const { editor, spy } = makeEditor()
    editor.setWorkGridY(7)
    editor.setGridFollow('work', true)
    expect(spy.last().y).toBe(3) // 生效 = layerY
    editor.setLayerView('below', 1)
    expect(spy.last().y).toBe(1)
    editor.setGridFollow('work', false)
    expect(spy.last().y).toBe(7) // 恢复勾选前的独立值
    expect(useEditorUi.getState().workGridY).toBe(7)
  })

  it('取消跟随的消息给出恢复值（用户可读回执）', () => {
    const { editor } = makeEditor()
    editor.setRefGridY(4)
    editor.setGridFollow('ref', true)
    expect(useEditorUi.getState().message).toContain('参考网格跟随层次滑块')
    editor.setGridFollow('ref', false)
    expect(useEditorUi.getState().message).toContain('独立 y=4')
  })
})

describe('D4-③ 默认档 = 显示全部（纯呈现口径下的会话默认）', () => {
  beforeEach(() => {
    // 直接读模块默认值（不经过本文件 beforeEach 的 setUi 覆写）
    expect(useEditorUi.getInitialState().layerMode).toBe('all')
  })

  it('初始 layerMode = all ⇒ 过滤 = null（唯一不裁剪拾取的档）', () => {
    const editor = new Editor(new MemoryProjectStore())
    setUi({ layerMode: 'all', layerY: 3 })
    expect(editor.currentLayerFilter()).toBeNull()
  })

  it('三档互斥：切到 below / single 后语义不变（强调只改呈现，不动过滤语义以外的行为）', () => {
    const { editor } = makeEditor()
    const filter = (m: LayerFilter['mode'] | 'all', y: number): LayerFilter | null => {
      editor.setLayerView(m, y)
      return editor.currentLayerFilter()
    }
    expect(filter('below', 2)).toEqual({ mode: 'below', y: 2 })
    expect(filter('single', 4)).toEqual({ mode: 'single', y: 4 })
    expect(filter('all', 4)).toBeNull()
  })
})
