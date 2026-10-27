// S8 · 右栏 Dock 标签（M1 三栏壳）：标签集合 / 默认 AI / 常驻挂载 / 面板落成 Pane。
// 用 SSR 静态渲染读 DOM 形状（不引 DOM 垫片）；壳由 `ShellContext.Provider` 指定，
// 切标签的交互由 `hidden` 语义 + 浏览器目检覆盖。
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ShellContext } from '../../src/ui/ShellContext'
import type { Shell } from '../../src/ui/shell-mode'
import { RightDock } from '../../src/ui/shell/RightDock'

const html = (shell: Shell): string =>
  renderToStaticMarkup(createElement(ShellContext.Provider, { value: shell }, createElement(RightDock)))
const count = (s: string, needle: string): number => s.split(needle).length - 1

describe('S8 · RightDock 标签', () => {
  it('六个标签（AI/结构/操作/噪声/历史/显示），默认 AI 选中，无图纸标签（S10 才接）', () => {
    const s = html('m1')
    expect(count(s, 'role="tab"')).toBe(6)
    expect(s).toContain('>AI<')
    expect(s).toContain('>结构<')
    expect(s).toContain('>操作<')
    expect(s).toContain('>噪声<')
    expect(s).toContain('>历史<')
    expect(s).toContain('>显示<')
    expect(s).not.toContain('图纸')
    expect(count(s, 'aria-selected="true"')).toBe(1)
    expect(count(s, 'aria-selected="false"')).toBe(5)
  })

  it('全部面板常驻挂载：6 个 tabpanel、5 个 hidden，Pane 数 = 8（显示页 3 块）', () => {
    const s = html('m1')
    expect(count(s, 'role="tabpanel"')).toBe(6)
    expect(count(s, ' hidden=""')).toBe(5)
    expect(count(s, 'class="pane"')).toBe(8)
    expect(count(s, 'data-pane=')).toBe(8)
  })

  it('浮块壳上下文下同一批面板落成浮块（不是 Pane）', () => {
    const s = html('floating')
    expect(count(s, 'class="pane"')).toBe(0)
    expect(s).toContain('tile-anchor')
  })
})
