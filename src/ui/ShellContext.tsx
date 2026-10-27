// S8 · 壳上下文：面板容器（`PanelFrame`）据此选 FloatingTile / Pane。
// 由壳装配方提供（M1Workspace ⇒ 'm1'；浮块壳不提供 ⇒ 默认 'floating'），面板不直接读 store——
// 这样同一份面板内容不绑死某个壳，也便于无头测试（SSR 可用 Provider 指定）。
import { createContext, useContext } from 'react'
import type { Shell } from './shell-mode'

export const ShellContext = createContext<Shell>('floating')

export function useShell(): Shell {
  return useContext(ShellContext)
}
