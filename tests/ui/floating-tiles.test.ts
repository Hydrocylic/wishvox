// `D1`（design §7.2 / architect §5.2–5.7）验收设施：
//   A 段 = **纯几何与静态表**（九块拓扑、固定锚点、展开预算不交叠、小组件退化报告）；
//   B 段 = **外壳 DOM 契约**（折叠 = 图标方块、点击展开/收起、常显槽、焦点、无拖拽）；
//   C 段 = **输入边界与静态纪律**（UI 标记查询 / 无拖动·无持久化·不 import 业务）。
// 为什么这么切：几何能纯函数证明（不引 WebGL），DOM 契约能用既有 `tests/facilities/dom.ts` 垫片证明；
// 真实视口下的目视可达性（按钮不出屏、待批卡可读）仍归人工，见交付记录的待验清单。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { computeTileLayout, contentRect, MIN_WORKSPACE, RIGHT_COLUMN, TILE_SIZE } from '../../src/ui/floating/tile-layout'
import type { TileLayoutResult } from '../../src/ui/floating/tile-layout'
import { defaultOpenMap, TILE_SPECS, tileSpec } from '../../src/ui/floating/tile-specs'
import type { TileId } from '../../src/ui/floating/tile-specs'
import { isUiEventTarget, pointOverUi, UI_BOUNDARY_ATTR } from '../../src/ui/floating/UiInputBoundary'
import { FloatingTile } from '../../src/ui/floating/FloatingTile'
import { TileHostContext } from '../../src/ui/floating/tile-host'
import type { TileHost } from '../../src/ui/floating/tile-host'
import { installDom } from '../facilities/dom'
import type { DomHarness, ShimElement } from '../facilities/dom'

const srcModules = import.meta.glob('../../src/ui/floating/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const srcText = Object.entries(srcModules).map(([k, v]) => [k.replace(/\\/g, '/').replace('../../src/ui/floating/', ''), v] as const)

const WORKSPACE = { width: 800, height: 600, hudHeight: 90 }
const layout: TileLayoutResult = computeTileLayout(WORKSPACE)
const IDS = TILE_SPECS.map((s) => s.id)

function rectOf(id: TileId, l: TileLayoutResult = layout): { left: number; top: number; right: number; bottom: number } {
  return contentRect(l.slots[id], WORKSPACE.width)
}
const intersects = (a: { left: number; top: number; right: number; bottom: number }, b: typeof a): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

describe('D1-A 九块静态拓扑（design §7.2 清单与方向）', () => {
  it('恰好九块、ID 唯一、含左工具栏 / AI / 层次卡', () => {
    expect(IDS).toHaveLength(9)
    expect(new Set(IDS).size).toBe(9)
    expect(IDS).toEqual(expect.arrayContaining(['tools', 'ai', 'parts', 'ops', 'noise', 'history', 'style', 'camera', 'layers']))
    // 右列顺序（design：结构树 → 程序化 → 噪声 → 历史 → 外观 → 相机）
    expect(RIGHT_COLUMN).toEqual(['parts', 'ops', 'noise', 'history', 'style', 'camera'])
    expect(defaultOpenMap().tools).toBe(true)
    expect(defaultOpenMap().ai).toBe(true)
    expect(defaultOpenMap().layers).toBe(true)
  })

  it('每块一个图标字形（折叠态 = 图标方块；无 icon 资产）', () => {
    for (const s of TILE_SPECS) {
      expect(s.icon.length).toBeGreaterThan(0)
      expect(s.title.length).toBeGreaterThan(0)
      expect(tileSpec(s.id)).toBe(s)
    }
  })

  it('锚点与方向固定：工具左上向下 · AI 右上向下 · 层次右下向上 · 右列六块右缘向左', () => {
    const s = layout.slots
    expect(s.tools.side).toBe('left')
    expect(s.tools.direction).toBe('down')
    expect(s.tools.anchorTop).toBeGreaterThanOrEqual(WORKSPACE.hudHeight) // HUD 之下
    expect(s.ai.anchorLeft).toBeCloseTo(WORKSPACE.width - TILE_SIZE - 8, 6)
    expect(s.ai.anchorTop).toBe(8)
    expect(s.ai.direction).toBe('down')
    expect(s.layers.anchorTop).toBeCloseTo(WORKSPACE.height - TILE_SIZE - 8, 6)
    expect(s.layers.direction).toBe('up')
    for (const id of RIGHT_COLUMN) {
      expect(s[id].side).toBe('right')
      expect(s[id].direction).toBe('left')
      expect(s[id].anchorLeft).toBe(s.ai.anchorLeft)
    }
  })

  it('避让：AI 展开体与层次展开体不相交，且六块内容体落在两者之间的区间里', () => {
    const ai = rectOf('ai')
    const layers = rectOf('layers')
    expect(intersects(ai, layers)).toBe(false)
    expect(ai.bottom).toBeLessThanOrEqual(layers.top) // AI 在上、层次在下，中间留出右列区间
    for (const id of RIGHT_COLUMN) {
      const r = rectOf(id)
      expect(intersects(r, ai)).toBe(false)
      expect(intersects(r, layers)).toBe(false)
      expect(r.top).toBeGreaterThanOrEqual(ai.bottom)
      expect(r.bottom).toBeLessThanOrEqual(layers.top)
    }
  })

  it('六块锚点自上而下等于右列顺序，且互不重叠', () => {
    const tops = RIGHT_COLUMN.map((id) => layout.slots[id].anchorTop)
    expect(tops).toEqual([...tops].sort((a, b) => a - b))
    expect(new Set(tops).size).toBe(tops.length)
    expect(layout.column.map((c) => c.id)).toEqual([...RIGHT_COLUMN])
  })

  it('锚点只由视口与 HUD 决定：同输入同结果，HUD 增高只下推工具块', () => {
    const again = computeTileLayout(WORKSPACE)
    expect(again.slots).toEqual(layout.slots)
    const taller = computeTileLayout({ ...WORKSPACE, hudHeight: 160 })
    expect(taller.slots.tools.anchorTop).toBe(layout.slots.tools.anchorTop + 70)
    for (const id of ['ai', 'layers', ...RIGHT_COLUMN] as TileId[]) {
      expect(taller.slots[id].anchorTop).toBe(layout.slots[id].anchorTop)
      expect(taller.slots[id].anchorLeft).toBe(layout.slots[id].anchorLeft)
    }
  })

  it('视口变小：报出最小可容纳尺寸，但九块触发器仍都在（不静默丢块）', () => {
    const tiny = computeTileLayout({ width: 300, height: 200, hudHeight: 90 })
    expect(tiny.ok).toBe(false)
    expect(tiny.required).toEqual(MIN_WORKSPACE)
    expect(tiny.note).toContain('最小')
    expect(Object.keys(tiny.slots)).toHaveLength(9)
    expect(computeTileLayout({ width: 1200, height: 800, hudHeight: 90 }).ok).toBe(true)
  })

  it('极小视口也保底：每块展开体不小于头部行（关闭入口与标题可达，F-04）', () => {
    for (const size of [{ width: 240, height: 180, hudHeight: 120 }, { width: 900, height: 200, hudHeight: 150 }]) {
      const l = computeTileLayout(size)
      expect(l.ok).toBe(false)
      for (const id of IDS) {
        expect(l.slots[id].bodyMaxHeight, `${id} @ ${size.width}×${size.height}`).toBeGreaterThanOrEqual(44)
        expect(l.slots[id].bodyMaxWidth).toBeGreaterThanOrEqual(180)
      }
    }
  })

  it('内容体宽度受限，始终给画布留出保护区', () => {
    for (const id of IDS) {
      const r = rectOf(id)
      expect(r.right - r.left).toBeLessThanOrEqual(336)
      expect(r.right - r.left).toBeGreaterThanOrEqual(180)
    }
    expect(rectOf('tools').left).toBe(8)
    expect(rectOf('ai').right).toBe(WORKSPACE.width - 8)
  })
})

// ── B 段：外壳 DOM 契约（React + 垫片 DOM）──

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

/** 受控宿主：布局固定，开关态自持（等价 `FloatingTiles` 的 openById 契约，但不装配九个业务面板） */
function Harness(props: { id: TileId; summary?: string }): JSX.Element {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const host: TileHost = {
    layout,
    isOpen: (id) => open[id] === true,
    setOpen: (id, v) => setOpen((s) => ({ ...s, [id]: v })),
    defaultOpenOf: () => false,
  }
  return createElement(
    TileHostContext.Provider,
    { value: host },
    createElement(FloatingTile, {
      id: props.id,
      summary: props.summary ?? '当前档：显示全部',
      accessory: createElement('span', { className: 'gate-mark' }, '待批卡'),
      children: createElement('span', { className: 'tile-marker' }, '内容体'),
    }),
  )
}

async function mount(el: React.ReactElement): Promise<ShimElement> {
  const container = dom.document.createElement('div')
  dom.document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container as unknown as HTMLElement)
    root.render(el)
    await settle()
  })
  return container
}

const textOf = (els: ShimElement[]): string => els.map((e) => String(e.textContent ?? '')).join('')

beforeEach(() => {
  dom = installDom()
})
afterEach(() => {
  act(() => {
    root?.unmount()
  })
  root = null
  dom.restore()
})

describe('D1-B 外壳：折叠 = 图标方块、点击展开/收起、常显槽仍在', () => {
  it('初始折叠：aria-expanded=false · 只渲染图标（无 panel-body）· 摘要进 panel-hint', async () => {
    const c = await mount(createElement(Harness, { id: 'layers' }))
    const head = findAll(c, 'panel-head')
    expect(head).toHaveLength(1)
    expect(head[0]!.getAttribute('aria-expanded')).toBe('false')
    expect(findAll(c, 'panel-body')).toHaveLength(0)
    expect(textOf(findAll(c, 'panel-emoji'))).toContain(tileSpec('layers').icon)
    // D4②：收起态摘要仍可辨当前档
    expect(textOf(findAll(c, 'panel-hint'))).toContain('显示全部')
    expect(String(head[0]!.getAttribute('title'))).toContain('显示全部')
    expect(String(head[0]!.getAttribute('title'))).toContain('不可拖动')
  })

  it('点击方块展开（面板体出现），点收起入口再折叠（开关注入宿主，不自己持第二份状态）', async () => {
    const c = await mount(createElement(Harness, { id: 'tools' }))
    const head = () => findAll(c, 'panel-head')[0]!
    await act(async () => {
      dom.firePointer(head(), 'click')
      await settle()
    })
    expect(findAll(c, 'panel-body')).toHaveLength(1)
    expect(textOf(findAll(c, 'tile-marker'))).toContain('内容体')
    expect(findAll(c, 'panel-head')[0]!.getAttribute('aria-expanded')).toBe('true')

    const close = findAll(c, 'tile-close')[0]!
    await act(async () => {
      dom.firePointer(close, 'click')
      await settle()
    })
    expect(findAll(c, 'panel-body')).toHaveLength(0)
    expect(findAll(c, 'panel-head')[0]!.getAttribute('aria-expanded')).toBe('false')
  })

  it('常显槽：收起态与展开态都只有一个 panel-pinned，且内容（待批卡）都在', async () => {
    const c = await mount(createElement(Harness, { id: 'ai' }))
    expect(findAll(c, 'panel-pinned')).toHaveLength(1)
    expect(textOf(findAll(c, 'gate-mark'))).toContain('待批卡')
    await act(async () => {
      dom.firePointer(findAll(c, 'panel-head')[0]!, 'click')
      await settle()
    })
    expect(findAll(c, 'panel-pinned')).toHaveLength(1) // 不重复挂两份
    expect(textOf(findAll(c, 'gate-mark'))).toContain('待批卡')
  })

  it('展开/收起不增删方块：两次切换后触发方块仍是一个，且 UI 侧不碰模型（无 Editor 实例参与）', async () => {
    const c = await mount(createElement(Harness, { id: 'parts' }))
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        dom.firePointer(findAll(c, 'panel-head')[0]!, 'click')
        await settle()
      })
    }
    expect(findAll(c, 'panel-head')).toHaveLength(1) // 仍然一块，没有多开实例
    expect(findAll(c, 'panel-body')).toHaveLength(0)
  })

  it('锚点来自布局（inline left/top），不是拖拽产生的坐标', async () => {
    const c = await mount(createElement(Harness, { id: 'camera' }))
    const anchor = findAll(c, 'tile-anchor')[0]!
    expect(Number.parseFloat(String(anchor.style.left))).toBeCloseTo(layout.slots.camera.anchorLeft, 3)
    expect(Number.parseFloat(String(anchor.style.top))).toBeCloseTo(layout.slots.camera.anchorTop, 3)
    // 无自由缩放：外壳不写 width/height 内联值（尺寸由 CSS 固定为方块边长）
    expect(anchor.style.width).toBeUndefined()
    expect(anchor.style.height).toBeUndefined()
  })
})

describe('D1-C 输入边界与静态纪律', () => {
  it('UI 标记查询：边界内（含子节点）为 true，外部为 false', async () => {
    const c = await mount(createElement(Harness, { id: 'ops' }))
    const anchor = findAll(c, 'tile-anchor')[0]!
    expect(anchor.getAttribute(UI_BOUNDARY_ATTR)).toBe('tile:ops')
    expect(isUiEventTarget(findAll(c, 'panel-emoji')[0]!)).toBe(true) // 子节点沿 parentNode 命中边界
    expect(isUiEventTarget(c)).toBe(false)
    expect(isUiEventTarget(dom.document.body)).toBe(false)
    expect(pointOverUi(1, 1)).toBe(false) // 垫片无 elementFromPoint ⇒ 显式退化为 false，不抛
  })

  it('静态检查：外壳与布局不 import 业务、无拖动/缩放/位置持久化（D1 ②⑦）', () => {
    const shell = ['FloatingTile.tsx', 'FloatingTiles.tsx', 'tile-layout.ts', 'tile-specs.ts', 'tile-host.ts']
    /** 词法判据只看**代码行**：注释里正当地写着"不进 localStorage""没有 onDrag" */
    const code = (text: string): string =>
      text
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n')
    for (const [name, text] of srcText) {
      if (!shell.includes(name)) continue
      const body = code(text)
      expect(body, name).not.toMatch(/from '\.\.\/app\/runtime'/)
      expect(body, name).not.toMatch(/from '\.\.\/state\//)
      expect(body, name).not.toMatch(/\bgetEditor\b/)
      expect(body, name).not.toMatch(/localStorage|sessionStorage|indexedDB/i)
      expect(body, name).not.toMatch(/onDrag|draggable|onPointerDown|onMouseDown/)
      expect(body, name).not.toMatch(/transform:/)
    }
    // 位置只来自布局：tile-layout 是纯函数——只 import 同目录的静态表，不读 store / 相机 / 模型
    const layoutSrc = code(srcText.find(([n]) => n === 'tile-layout.ts')![1])
    expect(layoutSrc).not.toMatch(/useEditorUi|getCameraState|modelBounds|readFile/)
    expect(layoutSrc.match(/from '\.\.\//g) ?? []).toEqual([])
  })

  it('开关态不进模型存档：store 里没有方块开关 / 锚点字段', async () => {
    const { useEditorUi } = await import('../../src/state/editor-store')
    const keys = Object.keys(useEditorUi.getState())
    expect(keys.filter((k) => /tile|anchor|float/i.test(k))).toEqual([])
  })
})
