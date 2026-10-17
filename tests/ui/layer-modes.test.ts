// `D4`（design §8，2026-10-16）：三档互斥单选 + 当前档 accent 填充强调 + 默认「显示全部」+
// 收起态摘要仍可辨当前档。走**真实 `LayerPanel`**（不是复刻一段逻辑）：强调是呈现判据，只能在 DOM 上读。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { getEditor } from '../../src/app/runtime'
import { LayerPanel } from '../../src/ui/LayerPanel'
import { PartTree } from '../../src/ui/PartTree'
import { setUi, useEditorUi } from '../../src/state/editor-store'
import { TileHostContext } from '../../src/ui/floating/tile-host'
import type { TileHost } from '../../src/ui/floating/tile-host'
import { installDom } from '../facilities/dom'
import type { DomHarness, ShimElement } from '../facilities/dom'

let dom: DomHarness
let root: Root | null = null

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function findAll(node: ShimElement, cls: string): ShimElement[] {
  const out: ShimElement[] = []
  const walk = (n: ShimElement): void => {
    if (String(n.className ?? '').split(/\s+/).includes(cls)) out.push(n)
    for (const c of n.childNodes) walk(c)
  }
  walk(node)
  return out
}

function findByRole(node: ShimElement): ShimElement[] {
  const out: ShimElement[] = []
  const walk = (n: ShimElement): void => {
    if (n.getAttribute('role') === 'radio') out.push(n)
    for (const c of n.childNodes) walk(c)
  }
  walk(node)
  return out
}

/** 递归取文本：垫片里"单文本子节点"由 React 写成 `textContent`，多子节点则没有 ⇒ 两种都要收 */
function allText(node: ShimElement): string {
  const own = node.textContent === null || node.textContent === undefined ? '' : String(node.textContent)
  if (own !== '') return own
  let s = ''
  for (const c of node.childNodes) s += allText(c)
  return s
}

/** 按 `title` 找控件（垫片无 querySelector ⇒ 手工遍历） */
function findByTitle(node: ShimElement, title: string): ShimElement | undefined {
  let found: ShimElement | undefined
  const walk = (n: ShimElement): void => {
    if (found) return
    if (n.getAttribute('title') === title) found = n
    for (const c of n.childNodes) walk(c)
  }
  walk(node)
  return found
}

const text = (els: ShimElement[]): string => els.map((e) => String(e.textContent ?? '')).join('')

/** 展开态的层次块（受控宿主：布局为 null ⇒ 独立挂载，几何归 D1 的用例管） */
const openHost: TileHost = {
  layout: null,
  isOpen: () => true,
  setOpen: () => {},
  defaultOpenOf: () => true,
}
/** 收起态（`D4②` 的摘要判据面：折叠成图标方块后摘要仍要能读出来） */
const closedHost: TileHost = { ...openHost, isOpen: () => false }

async function mountPanel(host: TileHost = openHost): Promise<ShimElement> {
  const container = dom.document.createElement('div')
  dom.document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container as unknown as HTMLElement)
    root.render(createElement(TileHostContext.Provider, { value: host }, createElement(LayerPanel)))
    await settle()
  })
  return container
}

beforeEach(() => {
  dom = installDom()
  setUi({
    layerMode: 'all',
    layerY: 2,
    layerMinY: 0,
    layerMaxY: 4,
    perLayerCounts: [
      { y: 0, count: 3 },
      { y: 2, count: 2 },
      { y: 4, count: 1 },
    ],
    nonEmpty: 6,
    gridBase: false,
    gridLayer: false,
    workGridY: 0,
    refGridY: 0,
    followLayerWork: false,
    followLayerRef: false,
    mode: 'edit',
    message: null,
  })
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  root = null
  dom.restore()
})

describe('D4-① 三档互斥单选 + accent 填充强调', () => {
  it('三档都在、恰一个 aria-checked=true，且当前档用 accent 填充 + 深色文字', async () => {
    const c = await mountPanel()
    const radios = findByRole(c)
    expect(radios).toHaveLength(3)
    expect(text(radios)).toContain('显示全部')
    expect(text(radios)).toContain('渲染以下')
    expect(text(radios)).toContain('渲染单层')
    const checked = radios.filter((r) => r.getAttribute('aria-checked') === 'true')
    expect(checked).toHaveLength(1)
    expect(String(checked[0]!.textContent)).toContain('显示全部') // 默认档 = 显示全部（D4 用户确认）
    expect(String(checked[0]!.style.background)).toContain('--accent')
    expect(String(checked[0]!.style.color)).toBe('#0f1218')
    // 非当前档弱化：不设 accent 背景（走普通灰底按钮）
    for (const r of radios) {
      if (r.getAttribute('aria-checked') === 'true') continue
      expect(String(r.style.background ?? '')).not.toContain('--accent')
    }
  })

  it('点「渲染以下」⇒ 强调转移、store 切档、非当前档不再填充（互斥）', async () => {
    const c = await mountPanel()
    const below = findByRole(c).find((r) => String(r.textContent).includes('渲染以下'))!
    await act(async () => {
      dom.firePointer(below, 'click')
      await settle()
    })
    expect(useEditorUi.getState().layerMode).toBe('below')
    const checked = findByRole(c).filter((r) => r.getAttribute('aria-checked') === 'true')
    expect(checked).toHaveLength(1)
    expect(String(checked[0]!.textContent)).toContain('渲染以下')
    expect(String(checked[0]!.style.background)).toContain('--accent')
  })

  it('强调只改呈现：切档不改模型块数与历史长度', async () => {
    const ed = getEditor()
    const before = ed.volume.nonEmptyCount
    const patches = ed.log.patches.length
    const c = await mountPanel()
    const single = findByRole(c).find((r) => String(r.textContent).includes('渲染单层'))!
    await act(async () => {
      dom.firePointer(single, 'click')
      await settle()
    })
    expect(ed.volume.nonEmptyCount).toBe(before)
    expect(ed.log.patches.length).toBe(patches)
    expect(useEditorUi.getState().layerMode).toBe('single')
  })
})

describe('D4-② 收起态摘要仍可辨当前档', () => {
  it('摘要在 panel-hint（视觉隐藏但 DOM 可读）与 title 里都含「显示全部」', async () => {
    const c = await mountPanel(closedHost)
    expect(text(findAll(c, 'panel-hint'))).toContain('显示全部')
    const head = findAll(c, 'panel-head')[0]!
    expect(String(head.getAttribute('title'))).toContain('显示全部')
    expect(String(head.getAttribute('aria-label'))).toContain('显示全部')
  })

  it('切到「以下 / 单层」后摘要随之改口径（含档位字样与实际 y）', async () => {
    const c = await mountPanel(closedHost)
    await act(async () => {
      setUi({ layerMode: 'below' })
      await settle()
    })
    expect(text(findAll(c, 'panel-hint'))).toContain('以下')
    await act(async () => {
      setUi({ layerMode: 'single' })
      await settle()
    })
    expect(text(findAll(c, 'panel-hint'))).toContain('单层')
    expect(text(findAll(c, 'panel-hint'))).toContain('y=2')
  })
})

describe('D4-③ 默认档 = 显示全部（初始进入即当前档填充强调可见）', () => {
  it('store 模块默认值 = all（不是 below）', () => {
    expect(useEditorUi.getInitialState().layerMode).toBe('all')
  })
})

// `D1`（architect §5.5/§5.7）：**内容拥有者常驻**——收起只卸正文，不卸状态拥有者。
// 判据 = 一个**纯本地面板态**（`PartTree` 的组合展开符 `expandedComp`，由点击驱动）：收起再展开后
// 仍保持展开 ⇒ 拥有者没被随正文一起卸掉（若卸掉，它会回到初始收起态）。
describe('D1 · 收起/展开循环后本地面板态保留（拥有者常驻）', () => {
  function PanelHarness(props: { panel: 'layers' | 'parts' }): JSX.Element {
    const [open, setOpen] = useState(true)
    const host: TileHost = { layout: null, isOpen: () => open, setOpen: (_id, v) => setOpen(v), defaultOpenOf: () => true }
    return createElement(
      TileHostContext.Provider,
      { value: host },
      props.panel === 'parts' ? createElement(PartTree) : createElement(LayerPanel),
    )
  }

  it('组合展开态在收起后重新展开仍在，且正文确实被卸过', async () => {
    setUi({
      parts: [{ id: 'p1', name: '构件甲', count: 2, createdAtPatch: 0 }],
      compositions: [{ id: 'c1', name: '组合甲', memberPartIds: ['p1'], manualBlockCount: 0, blockCount: 2 }],
      selectedPartId: null,
      selectedCompositionId: null,
    })
    const container = dom.document.createElement('div')
    dom.document.body.appendChild(container)
    await act(async () => {
      root = createRoot(container as unknown as HTMLElement)
      root.render(createElement(PanelHarness, { panel: 'parts' }))
      await settle()
    })
    const toggle = (): ShimElement | undefined => findByTitle(container, '展开到成员构件')
    expect(toggle()).toBeDefined()
    expect(allText(container)).not.toContain('成员构件 1 个') // 初始收起

    await act(async () => {
      dom.firePointer(toggle()!, 'click')
      await settle()
    })
    expect(allText(container)).toContain('成员构件 1 个') // 已展开

    await act(async () => {
      dom.firePointer(findAll(container, 'tile-close')[0]!, 'click')
      await settle()
    })
    expect(findAll(container, 'panel-body')).toHaveLength(0) // 正文已卸（收起 = 不渲染正文）
    await act(async () => {
      dom.firePointer(findAll(container, 'panel-head')[0]!, 'click')
      await settle()
    })
    expect(allText(container)).toContain('成员构件 1 个') // 本地态仍在 ⇒ 拥有者没被卸掉
  })
})
