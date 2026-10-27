// S8 · 右栏 Dock 标签（M1 三栏壳）：标签集合 / 默认 AI / 常驻挂载 / 面板落成 Pane。
// 用 SSR 静态渲染读 DOM 形状（不引 DOM 垫片）；壳由 `ShellContext.Provider` 指定，
// 切标签的交互由 `hidden` 语义 + 浏览器目检覆盖。S10 起多一个「图纸」标签（本地通道）。
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ShellContext } from '../../src/ui/ShellContext'
import type { Shell } from '../../src/ui/shell-mode'
import { RightDock } from '../../src/ui/shell/RightDock'
import { initialShell, readShellEnv } from '../../src/ui/shell-mode'
import { vi } from 'vitest'

const html = (shell: Shell): string =>
  renderToStaticMarkup(createElement(ShellContext.Provider, { value: shell }, createElement(RightDock)))
const count = (s: string, needle: string): number => s.split(needle).length - 1

describe('S8 · RightDock 标签', () => {
  it('七个标签（AI/图纸/结构/操作/噪声/历史/显示），默认 AI 选中', () => {
    const s = html('m1')
    expect(count(s, 'role="tab"')).toBe(7)
    expect(s).toContain('>AI<')
    expect(s).toContain('>图纸<')
    expect(s).toContain('>结构<')
    expect(s).toContain('>操作<')
    expect(s).toContain('>噪声<')
    expect(s).toContain('>历史<')
    expect(s).toContain('>显示<')
    expect(count(s, 'aria-selected="true"')).toBe(1)
    expect(count(s, 'aria-selected="false"')).toBe(6)
  })

  it('全部面板常驻挂载：7 个 tabpanel、6 个 hidden，Pane 数 = 9（每个面板都经 PanelFrame）', () => {
    const s = html('m1')
    expect(count(s, 'role="tabpanel"')).toBe(7)
    expect(count(s, ' hidden=""')).toBe(6)
    expect(count(s, 'class="pane"')).toBe(9)
    expect(count(s, 'data-pane=')).toBe(9)
    expect(s).toContain('data-pane="pattern"')
    // Pane 不重复渲染标题头；标题由 Dock 标签提供，摘要仍在正文前。
    expect(s).toContain('role="tabpanel" aria-label="图纸"')
    expect(s).toContain('<div class="pane-summary">未选图纸</div>')
  })

  it('浮块壳上下文下同一批面板落成浮块（不是 Pane）', () => {
    const s = html('floating')
    expect(count(s, 'class="pane"')).toBe(0)
    expect(s).toContain('tile-anchor')
  })

  it('首帧壳在入口 render 前确定：桌面三栏、手机浮块', () => {
    const src = Object.values(
      import.meta.glob('../../src/main.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
    )[0] ?? ''
    const init = src.indexOf('setUi({ shell: initialShell(readShellEnv()) })')
    expect(init).toBeGreaterThanOrEqual(0)
    expect(src.indexOf('createRoot(rootEl).render(')).toBeGreaterThan(init)
    try {
      for (const [innerWidth, innerHeight, expected] of [[1440, 900, 'm1'], [390, 844, 'floating']] as const) {
        vi.stubGlobal('window', {
          innerWidth, innerHeight,
          localStorage: { getItem: () => null },
          matchMedia: () => ({ matches: false }),
        })
        expect(initialShell(readShellEnv())).toBe(expected)
      }
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('静态防回归：图纸面板必须经 PanelFrame 落容器（不得裸 Section）', () => {
    const src =
      Object.values(
        import.meta.glob('../../src/ui/PatternImport.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
      )[0] ?? ''
    expect(src).toContain('<PanelFrame')
    expect(src).not.toMatch(/return\s*\(\s*<Section/)
  })
})
