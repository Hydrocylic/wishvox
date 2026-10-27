// 交互编辑 P1 · `A-07`（笔刷中断收尾）的**指针事件链**回归——`R-01` / `R-02` 的无头复现与防线。
//
// 为什么另立本文件：既有 `tests/interaction/stroke-interrupt.test.ts` 走的是 `Editor` 状态机直调，
// 覆盖不到 `src/ui/Viewport.tsx` 的**事件接线**（窗口级 `pointerup` / `Escape` / 指针捕获）。
// 用户 2026-10-13 人工面报出的两条缺陷正落在这条缺口上（`debug-261013` 交付件 §10 已声明）：
//   R-01 视窗外收尾仍落块（`onWindowUp` 无条件走 `onUp` = 提交）；`A-07` 新口径 = 视窗外收尾**取消**。
//   R-02 `Esc` 取消后模型 / 历史 / 页脚块数必须一起还原（`REQ-055` 补注：取消同时回滚三样）。
//
// 设施 = `tests/facilities/dom.ts` 的最小 DOM 垫片 + `interaction/view` 模块替身（本项目 `vitest`
// 为 `environment: 'node'`、不引 jsdom）。**不测 WebGL / 真实拾取**：`pick()` 由替身按坐标映射返回，
// 真实射线拾取仍归人工面与 `harness/`。
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'

const hoisted = vi.hoisted(() => ({ state: { cursor: { x: 0, y: 0, z: 0 } } }))

vi.mock('../../src/interaction/view', () => {
  // `Viewport` 只消费 `VoxelView` 的一小片面（见 src/interaction/view.ts 的 EditorRenderer 面）。
  // 替身在容器里挂一个 canvas 并当 `renderer.domElement`——真实 `VoxelRenderer` 的同一角色，
  // 事件目标判据（`onCanvas`）与 `setPointerCapture` 都落在它上面。
  class FakeVoxelView {
    readonly renderer: { domElement: MockCanvas; getContext: () => Record<string, unknown> }
    readonly rig = { getCameraState: () => ({ target: [0, 0, 0], distance: 10, fov: 50, rotateSpeed: 1, damping: 0.1 }) }
    onCameraChange: unknown = null
    constructor(el: MockCanvas) {
      const canvas = el.ownerDocument!.createElement('canvas')
      el.appendChild(canvas)
      this.renderer = { domElement: canvas, getContext: () => ({}) }
    }
    pick(): { cell: [number, number, number]; adjacent: [number, number, number]; key: number } {
      const c = hoisted.state.cursor
      const cell: [number, number, number] = [c.x, c.y, c.z]
      return { cell, adjacent: cell, key: 0 }
    }
    getCameraState(): unknown {
      return this.rig.getCameraState()
    }
    rebuildAll(): void {}
    applyChanges(): void {}
    onModelChanged(): void {}
    frameModel(): void {}
    resize(): void {}
    setLayerFilter(): void {}
    setGrid(): void {}
    setAppearance(): void {}
    setHighlightedPart(): void {}
    setHighlightedCoords(): void {}
    setPreview(): void {}
    setInteractionMode(): void {}
    dispose(): void {}
  }
  return { VoxelView: FakeVoxelView }
})

import { Viewport } from '../../src/ui/Viewport'
import { getEditor } from '../../src/app/runtime'
import type { Editor } from '../../src/edit/editor'
import { setUi, useEditorUi } from '../../src/state/editor-store'
import { installDom } from '../facilities/dom'
import type { DomHarness, ShimCanvas, ShimElement } from '../facilities/dom'

/** 替身里的 canvas 形参类型（`VoxelView` 构造入参就是容器本身） */
type MockCanvas = ShimElement

let dom: DomHarness
let root: Root | null = null
let editor: Editor
let canvas: ShimCanvas
/** 逻辑格 → client 坐标（1 格 = 10 px；画布 rect = (0,0,800,600)） */
const CELL_PX = 10
const cellAt = (x: number, z: number): { clientX: number; clientY: number } => ({ clientX: x * CELL_PX, clientY: z * CELL_PX })
/** 视窗外：x 超出画布右边界（rect 宽 800 ⇒ 800+ 即在外） */
const OUTSIDE = { clientX: 900, clientY: 300 }

/** 让 React 的被动 effect（宏任务里 flush）真正跑完——`await act()` 只等到微任务，实测不够 */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

async function mountViewport(): Promise<ShimElement> {
  const container = dom.document.createElement('div')
  dom.document.appendChild(container)
  let r: Root | null = null
  await act(async () => {
    r = createRoot(container as unknown as HTMLElement)
    r.render(createElement(Viewport))
    await settle()
  })
  root = r
  return container
}

// 事件目标必须是 canvas 本身：`Viewport#onCanvas` 判据 = `e.target === renderer.renderer.domElement`
function down(target: ShimElement, x: number, z: number): void {
  hoisted.state.cursor = { x, y: 0, z }
  dom.firePointer(target, 'pointerdown', { ...cellAt(x, z), button: 0, buttons: 1, pointerId: 1 })
}

function move(target: ShimElement, x: number, z: number): void {
  hoisted.state.cursor = { x, y: 0, z }
  dom.firePointer(target, 'pointermove', { ...cellAt(x, z), button: -1, buttons: 1, pointerId: 1 })
}

function up(target: ShimElement, client = OUTSIDE): void {
  dom.firePointer(target, 'pointerup', { ...client, button: 0, buttons: 0, pointerId: 1 })
}

const blocks = (): string[] => {
  const out: string[] = []
  for (const b of editor.volume.iterBlocks()) out.push(`${b.x},${b.y},${b.z}=${b.key}`)
  return out.sort()
}

/** 页脚块数读数的无头代理：与 `Viewport` 同源（`editor.syncUi()` → `state/projections` → store 的 `nonEmpty`） */
const pageCount = (): number => {
  editor.syncUi()
  return useEditorUi.getState().nonEmpty
}

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

beforeEach(async () => {
  dom = installDom()
  setUi({
    mode: 'edit',
    tool: 'place',
    overridePlace: false,
    message: null,
    brushSize: { x: 1, y: 1, z: 1 },
    brushSizes: { place: { x: 1, y: 1, z: 1 }, erase: { x: 1, y: 1, z: 1 }, paint: { x: 1, y: 1, z: 1 } },
    currentIdentity: 'color:red',
  })
  // `Viewport` 经 `getEditor()` 拿单例 ⇒ 用例必须驱动**同一个**实例
  editor = getEditor()
  editor.setMode('edit')
  editor.newProject() // 3×3×3 坯料
  const container = await mountViewport()
  canvas = dom.firstCanvas()
  expect(container.contains(canvas)).toBe(true)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  root = null
  dom.restore()
})

describe('R-01 · 视窗外收尾 = 取消（A-07 2026-10-13 口径）', () => {
  it('按住拖出两格后在视窗外松开 ⇒ 不落块、不记账，模型与历史都回到落笔前', () => {
    const before = blocks()
    const nonEmptyBefore = editor.volume.nonEmptyCount
    const patchesBefore = editor.log.patches.length

    down(canvas, 4, 0)
    move(canvas, 5, 0)
    // 半笔已经旁路写进模型（所见即所得），这是取消要还原的对象
    expect(editor.volume.getBlock(4, 0, 0)).not.toBe(0)
    expect(editor.volume.getBlock(5, 0, 0)).not.toBe(0)
    expect(editor.stroke.active).toBe(true)

    up(canvas) // 视窗外松手

    expect(editor.stroke.active).toBe(false)
    expect(editor.volume.nonEmptyCount).toBe(nonEmptyBefore)
    expect(blocks()).toEqual(before) // 逐块比对，不只看计数
    expect(editor.log.patches).toHaveLength(patchesBefore) // 不记账
    expect(useEditorUi.getState().message).toMatch(/已取消/) // 与 Esc / pointercancel 同一收尾语义
  })

  it('对照：视窗内正常松开恰好提交一笔（同一条事件链，唯一差别是收尾位置）', () => {
    const nonEmptyBefore = editor.volume.nonEmptyCount
    const patchesBefore = editor.log.patches.length

    down(canvas, 4, 0)
    move(canvas, 5, 0)
    up(canvas, cellAt(5, 0)) // 视窗内松手

    expect(editor.stroke.active).toBe(false)
    expect(editor.log.patches).toHaveLength(patchesBefore + 1)
    expect(editor.log.patches[patchesBefore]!.changes).toHaveLength(2)
    expect(editor.volume.nonEmptyCount).toBe(nonEmptyBefore + 2)
    editor.undo() // 一笔一次撤销全退
    expect(editor.volume.nonEmptyCount).toBe(nonEmptyBefore)
  })
})

describe('第三轮 C1 · 每笔提交后历史面板立即刷新', () => {
  it('视窗内正常松手后 store.history 立即含新条目，不等下一笔刷新', () => {
    const patchesBefore = editor.log.patches.length
    const historyBefore = useEditorUi.getState().history.length
    expect(historyBefore).toBe(patchesBefore)

    down(canvas, 4, 0)
    move(canvas, 5, 0)
    up(canvas, cellAt(5, 0))

    expect(editor.log.patches).toHaveLength(patchesBefore + 1) // 数据层已经有新条目
    expect(useEditorUi.getState().history).toHaveLength(historyBefore + 1) // HistoryPanel 的直接数据源须同拍刷新
    expect(useEditorUi.getState().history.at(-1)?.cells).toBe(2)
  })
})

describe('第三轮 C2 · 一笔轨迹曾离开画布即取消（REQ-055）', () => {
  it.each([
    ['pointerleave', (): void => { dom.firePointer(canvas, 'pointerleave', { ...OUTSIDE, button: -1, buttons: 1, pointerId: 1 }) }],
    // 浏览器指针捕获可能让画布外 move 仍以 canvas 为 target、不额外派发 leave；坐标出界也必须被记住。
    ['captured outside move', (): void => { dom.firePointer(canvas, 'pointermove', { ...OUTSIDE, button: -1, buttons: 1, pointerId: 1 }) }],
  ])('%s：拖出画布后回到画布内松手 ⇒ 仍取消、完整还原、不记账', (_kind, leaveCanvas) => {
    const before = blocks()
    const nonEmptyBefore = editor.volume.nonEmptyCount
    const patchesBefore = editor.log.patches.length

    down(canvas, 4, 0)
    move(canvas, 5, 0)
    leaveCanvas()
    move(canvas, 6, 0) // 指针捕获下回到画布内；最终松手位置也在画布内
    up(canvas, cellAt(6, 0))

    expect(editor.stroke.active).toBe(false)
    expect(blocks()).toEqual(before)
    expect(editor.volume.nonEmptyCount).toBe(nonEmptyBefore)
    expect(editor.log.patches).toHaveLength(patchesBefore)
    expect(useEditorUi.getState().message).toMatch(/已取消/)

    // 离开标记只属于刚结束的那一笔；下一笔若全程在画布内应立即恢复正常提交。
    down(canvas, 7, 0)
    up(canvas, cellAt(7, 0))
    expect(editor.stroke.active).toBe(false)
    expect(editor.log.patches).toHaveLength(patchesBefore + 1)
    expect(editor.volume.getBlock(7, 0, 0)).not.toBe(0)
  })
})

describe('R-02 · Esc / pointercancel 后无幽灵数据（模型 + 历史 + 页脚计数一起还原）', () => {
  it('按住拖出两格时按 Esc ⇒ 三样一起回滚，且下一笔立即可用', () => {
    const nonEmptyBefore = editor.volume.nonEmptyCount
    const patchesBefore = editor.log.patches.length
    const digestBefore = editor.volume.digest()
    const countBefore = pageCount()

    down(canvas, 4, 0)
    move(canvas, 5, 0)
    expect(editor.volume.nonEmptyCount).toBe(nonEmptyBefore + 2)
    expect(pageCount()).toBe(29) // 页脚读数代理（半笔旁路已写入 27+2）

    dom.fireKey(dom.window, 'keydown', { key: 'Escape' })

    expect(editor.stroke.active).toBe(false)
    expect(editor.volume.digest()).toEqual(digestBefore) // 体素
    expect(editor.volume.nonEmptyCount).toBe(nonEmptyBefore)
    expect(editor.log.patches).toHaveLength(patchesBefore) // 历史条目
    expect(pageCount()).toBe(27) // 页脚块数跟着回落
    expect(countBefore).toBe(27) // 前提：取消前页脚里没有半笔
    expect(useEditorUi.getState().message).toMatch(/已取消/)

    // 取消后松手不得补记（Esc 已收尾 ⇒ 窗口级 pointerup 无活动态）
    up(canvas, cellAt(5, 0))
    expect(editor.log.patches).toHaveLength(patchesBefore)

    // 下一笔立即可用
    down(canvas, 6, 0)
    up(canvas, cellAt(6, 0))
    expect(editor.stroke.active).toBe(false)
    expect(editor.log.patches).toHaveLength(patchesBefore + 1)
  })

  it('pointercancel 与 Esc 同一收尾语义（取消并完整还原，不记账）', () => {
    const before = blocks()
    const nonEmptyBefore = editor.volume.nonEmptyCount
    const patchesBefore = editor.log.patches.length

    down(canvas, 4, 0)
    move(canvas, 5, 0)
    dom.firePointer(canvas, 'pointercancel', { pointerId: 1, button: -1, buttons: 0 })

    expect(editor.stroke.active).toBe(false)
    expect(blocks()).toEqual(before)
    expect(editor.volume.nonEmptyCount).toBe(nonEmptyBefore)
    expect(editor.log.patches).toHaveLength(patchesBefore)
  })
})

// ── `D1`（P4 · design §7.2 ④ / §4 `F-03`）：**活动笔进入 UI 覆盖区 = 中断** ──
// 覆盖层在画布矩形**内**（悬浮方块压在视口上），所以"坐标是否出界"看不出差别；判据必须是
// `ui/UiInputBoundary` 的边界命中。本件用垫片 DOM 给 `elementFromPoint` 装一个覆盖区
// （无头垫片默认没有该方法 ⇒ 产品侧显式退化为 false，不新增隐式分支）。
describe('D1 · 活动笔进入 UI 覆盖区即取消（覆盖层压在画布矩形内）', () => {
  const installOverlay = (): (() => void) => {
    const tile = dom.document.createElement('div')
    tile.setAttribute('data-ui-boundary', 'tile:tools')
    const doc = dom.document as unknown as { elementFromPoint?: (x: number, y: number) => unknown }
    doc.elementFromPoint = () => tile
    return () => {
      delete doc.elementFromPoint
    }
  }

  it('拖到覆盖区后回到画布内松手 ⇒ 取消、完整还原、不记账', () => {
    const uninstall = installOverlay()
    try {
      const before = blocks()
      const nonEmptyBefore = editor.volume.nonEmptyCount
      const patchesBefore = editor.log.patches.length

      down(canvas, 4, 0)
      move(canvas, 5, 0)
      // 收尾点仍在画布矩形内（与"甩出视窗"不同），但轨迹经过了覆盖区
      up(canvas, cellAt(5, 0))

      expect(editor.stroke.active).toBe(false)
      expect(blocks()).toEqual(before)
      expect(editor.volume.nonEmptyCount).toBe(nonEmptyBefore)
      expect(editor.log.patches).toHaveLength(patchesBefore)
      expect(useEditorUi.getState().message).toMatch(/已取消/)
    } finally {
      uninstall()
    }
  })

  it('对照：没有覆盖区命中时同一串事件照常提交（隔离只针对覆盖区，不误伤画布雕刻）', () => {
    const patchesBefore = editor.log.patches.length
    down(canvas, 4, 0)
    move(canvas, 5, 0)
    up(canvas, cellAt(5, 0))
    expect(editor.stroke.active).toBe(false)
    expect(editor.log.patches).toHaveLength(patchesBefore + 1)
    expect(editor.volume.getBlock(5, 0, 0)).not.toBe(0)
  })
})
