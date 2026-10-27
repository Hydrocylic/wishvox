// `R-14`（debug-261018）快捷键闸门的回归面。
// 用户序列「放蓝块 → 点左栏色板换红 → Ctrl+Z」撤不掉：`App.tsx` 的 window keydown 用
// `isUiEventTarget` 把悬浮方块内的一切按键都当成 UI 本地输入；色板色块是 `<button>`，点完焦点仍留在
// `tile:tools` 边界内 ⇒ `history.undo()` 根本没执行。用户 2026-10-18 选定口径 A：闸门收窄到
// **文本输入面**（textarea / contenteditable / 文本类 input，含 number），按钮不再拦截；
// 指针路径（`isUiEventTarget` / `pointOverUi`）不放宽。
// 三段切法：
//   A = 纯判定语义（鸭子类型，不依赖 `closest`，垫片 DOM 也没有它）；
//   B = 真实挂载的 `FloatingTile` 结构（色板按钮 / 笔刷数字框 / 文本框）；
//   C = App 接线（静态：onKey 用的是文本判定，不是边界判定）。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import type { ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { getAiSession } from '../../src/app/runtime'
import { GateDock } from '../../src/ui/GateDock'
import { isTextEntryTarget, isUiEventTarget, pointOverUi, UI_BOUNDARY_ATTR } from '../../src/ui/UiInputBoundary'
import { FloatingTile } from '../../src/ui/floating/FloatingTile'
import { installDom } from '../facilities/dom'
import type { DomHarness, ShimElement } from '../facilities/dom'

// ── A 段：纯判定语义 ──

interface FakeNode {
  tagName?: unknown
  getAttribute?: unknown
  parentNode?: FakeNode | null
  isContentEditable?: unknown
}

function fake(tag: unknown, attrs: Record<string, string> = {}, parent: FakeNode | null = null): FakeNode {
  const map = new Map(Object.entries(attrs))
  return { tagName: tag, parentNode: parent, getAttribute: (name: string): string | null => map.get(name) ?? null }
}

describe('R-14-A 文本输入面判定（鸭子类型，不依赖 closest）', () => {
  it('textarea / 文本类 input（含 number、缺省 text、大小写）⇒ 拦截', () => {
    expect(isTextEntryTarget(fake('textarea'))).toBe(true)
    expect(isTextEntryTarget(fake('TEXTAREA'))).toBe(true)
    for (const t of ['text', 'search', 'url', 'tel', 'email', 'password', 'number']) {
      expect(isTextEntryTarget(fake('input', { type: t })), t).toBe(true)
    }
    expect(isTextEntryTarget(fake('input', { type: 'TEXT' }))).toBe(true) // 属性大小写不敏感
    expect(isTextEntryTarget(fake('input'))).toBe(true) // 缺 type = 浏览器默认 text
  })

  it('input 的 type 为空串 / 纯空白 ⇒ 也等同缺省 = 默认 text（不是"非文本"）', () => {
    for (const t of ['', '   ', '\t\n ']) {
      expect(isTextEntryTarget(fake('input', { type: t })), JSON.stringify(t)).toBe(true)
    }
  })

  it('contenteditable（含其子节点，沿 parentNode 向上查）；=false 不拦', () => {
    for (const v of ['', 'true', 'plaintext-only']) {
      const host = fake('div', { contenteditable: v })
      expect(isTextEntryTarget(host), `contenteditable=${v}`).toBe(true)
      expect(isTextEntryTarget(fake('span', {}, host)), `子节点 @=${v}`).toBe(true)
      expect(isTextEntryTarget(fake('span', {}, fake('b', {}, host))), `孙节点 @=${v}`).toBe(true)
    }
    expect(isTextEntryTarget(fake('div', { contenteditable: 'false' }))).toBe(false)
    // 真实 DOM 还有只读属性 `isContentEditable`（垫片没有）——鸭子类型也认
    const viaProp: FakeNode = { tagName: 'div', getAttribute: () => null, parentNode: null, isContentEditable: true }
    expect(isTextEntryTarget(viaProp)).toBe(true)
    expect(isTextEntryTarget({ ...viaProp, isContentEditable: false })).toBe(false)
  })

  it('非文本 input / button / select / body / canvas ⇒ 不拦（口径 A 的核心）', () => {
    for (const t of ['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'file', 'hidden', 'color', 'date']) {
      expect(isTextEntryTarget(fake('input', { type: t })), t).toBe(false)
    }
    for (const tag of ['button', 'select', 'body', 'canvas', 'div', 'a']) {
      expect(isTextEntryTarget(fake(tag)), tag).toBe(false)
    }
  })

  it('null / 缺字段 / 环状 parentNode 稳健：不抛、不误拦', () => {
    expect(isTextEntryTarget(null)).toBe(false)
    expect(isTextEntryTarget(undefined)).toBe(false)
    expect(isTextEntryTarget({})).toBe(false)
    expect(isTextEntryTarget({ parentNode: null })).toBe(false)
    // 缺 `getAttribute` 的 input 仍按"默认 text"处理（宁可拦住，不误放）
    expect(isTextEntryTarget({ tagName: 'input' })).toBe(true)
    expect(isTextEntryTarget({ tagName: 'input', getAttribute: 42 })).toBe(true)
    // 非字符串标签名 / 属性值不参与判定
    expect(isTextEntryTarget({ tagName: 7, getAttribute: () => 42 })).toBe(false)
    // 环状 parentNode 不死循环（内部有 guard）
    const loop: FakeNode = { tagName: 'div', getAttribute: () => null, parentNode: null }
    loop.parentNode = loop
    expect(isTextEntryTarget(loop)).toBe(false)
  })
})

// ── B 段：真实挂载的外壳结构（React + 垫片 DOM）──

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

/** 数某标签的节点数（垫片没有 `querySelectorAll`，按树走） */
function countTag(node: ShimElement, tag: string): number {
  return (node.tagName === tag ? 1 : 0) + node.childNodes.reduce((sum, child) => sum + countTag(child, tag), 0)
}

async function mountToolsTile(children: ReactElement[]): Promise<ShimElement> {
  const container = dom.document.createElement('div')
  dom.document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container as unknown as HTMLElement)
    root.render(createElement(FloatingTile, { id: 'tools', summary: '放置 · 1×1×1', children }))
    await settle()
  })
  return container
}

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

describe('R-14-B 真实方块结构：色板按钮不拦、文本框仍拦', () => {
  it('色板 <button>（工具块边界内）⇒ 快捷键不拦；text / number / textarea ⇒ 拦；checkbox ⇒ 不拦', async () => {
    const c = await mountToolsTile([
      createElement('button', { key: 'swatch', className: 'swatch', title: 'color:blue', 'aria-label': 'blue' }, '蓝色'),
      createElement('input', { key: 'hex', type: 'text', className: 'hex' }),
      createElement('input', { key: 'brush-w', type: 'number', className: 'brush-w' }),
      createElement('input', { key: 'replace', type: 'checkbox', className: 'replace' }),
      createElement('textarea', { key: 'notes', className: 'notes' }),
    ])
    // 边界标记挂在展开体（`.tile-body`）上，内层 `.panel-body` 是其子节点
    const tileBody = findAll(c, 'tile-body')[0]!
    expect(tileBody.getAttribute(UI_BOUNDARY_ATTR)).toBe('tile:tools') // 整块展开体都在边界内

    const swatch = findAll(c, 'swatch')[0]!
    // 指针隔离不变：按钮仍在边界内
    expect(isUiEventTarget(swatch)).toBe(true)
    // 修复前这一行为 true ⇒ 快捷键被闸门吞掉；口径 A 要求 false
    expect(isTextEntryTarget(swatch)).toBe(false)

    expect(isTextEntryTarget(findAll(c, 'hex')[0]!)).toBe(true)
    expect(isTextEntryTarget(findAll(c, 'brush-w')[0]!)).toBe(true)
    expect(isTextEntryTarget(findAll(c, 'replace')[0]!)).toBe(false) // 勾选框保留模型快捷键
    expect(isTextEntryTarget(findAll(c, 'notes')[0]!)).toBe(true)
  })

  it('点落在边界内色板按钮上：pointOverUi 仍为 true（指针隔离不随快捷键收窄）', async () => {
    const container = await mountToolsTile([createElement('button', { key: 'swatch', className: 'swatch' }, '色块')])
    const swatch = findAll(container, 'swatch')[0]!
    ;(dom.document as unknown as { elementFromPoint: (x: number, y: number) => unknown }).elementFromPoint = () => swatch
    expect(pointOverUi(12, 34)).toBe(true)
    const outside = dom.document.createElement('div')
    dom.document.body.appendChild(outside)
    ;(dom.document as unknown as { elementFromPoint: (x: number, y: number) => unknown }).elementFromPoint = () => outside
    expect(pointOverUi(12, 34)).toBe(false)
  })

  it('闸门卡只挂一份：GateDock 一份 + AiPanel 不再自带（闸门按钮总数 = 4，不是 8）', async () => {
    const session = getAiSession()
    session.clearSession()
    session.log.append({
      type: 'gateAsked',
      gateId: 'gate-s7-probe',
      scope: 'plan',
      callId: null,
      summary: '计划：S7 只挂一份探针',
    })
    session.pushView()

    const container = dom.document.createElement('div')
    dom.document.body.appendChild(container)
    await act(async () => {
      root = createRoot(container as unknown as HTMLElement)
      root.render(createElement(GateDock))
      await settle()
    })

    const docks = findAll(container, 'gate-dock')
    expect(docks).toHaveLength(1) // 壳级只挂一份
    expect(countTag(docks[0]!, 'BUTTON')).toBe(4) // 批准 / 本次会话都批准 / 跳过 / 回复
    expect(countTag(container, 'BUTTON')).toBe(4) // 面板不在这棵树里，也没有第二份闸门
    // 静态侧证：AiPanel 源码里不再出现闸门卡（挂载位只剩 GateDock）
    const panelSrc =
      Object.values(import.meta.glob('../../src/ui/AiPanel.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0] ?? ''
    expect(panelSrc).not.toMatch(/import \{[^}]*AiGateCard[^}]*\}/)
    expect(panelSrc).not.toContain('<AiGateCard')
    expect(panelSrc).not.toContain('accessory')

    session.clearSession()
  })
})

// ── C 段：App 接线（静态纪律）──

const appSrc = Object.values(import.meta.glob('../../src/ui/App.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0] ?? ''

describe('R-14-C App 的 window keydown 闸门', () => {
  /** 词法判据只看**代码行**：注释里正当地写着"原判据是 isUiEventTarget，已收窄" */
  const codeOnly = (text: string): string =>
    text
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n')

  it('闸门用文本输入面判定，不再用 UI 边界判定；撤销/重做动作仍在', () => {
    expect(appSrc).not.toBe('')
    const start = appSrc.indexOf('const onKey')
    const end = appSrc.indexOf('window.addEventListener', start)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const gate = codeOnly(appSrc.slice(start, end))
    expect(gate).toContain('isTextEntryTarget(e.target)')
    expect(gate).not.toContain('isUiEventTarget')
    expect(gate).toContain('getEditor().undo()')
    expect(gate).toContain('getEditor().redo()')
    expect(appSrc).toMatch(/import \{[^}]*\bisTextEntryTarget\b[^}]*\} from '\.\/UiInputBoundary'/)
    expect(appSrc).toMatch(/import \{ GateDock \} from '\.\/GateDock'/)
    expect((appSrc.match(/<GateDock\s*\/>/g) ?? []).length).toBe(1)
  })
})
