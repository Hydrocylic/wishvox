// `D1`：九块装配所需的**共享会话态**（开关 + 布局）——放进 context 而不是逐块传 prop：
// 九个面板各自 `import` 自己的业务 store，如果再逐块透传 `open/onOpenChange/layout`，
// 装配处会出现 9×3 条同形样板，且"某个 shell 忘了接 open"这类错误无法在类型上避免。
// 无 Provider 时（harness 单挂某一块、目检页）外壳退化为**自持开关**的独立块，行为不变。
import { createContext, useContext } from 'react'
import type { TileLayoutResult } from './tile-layout'
import type { TileId } from './tile-specs'

export interface TileHost {
  /** null = 不在工作区里（独立挂载）：外壳用静态定位，不读锚点 */
  readonly layout: TileLayoutResult | null
  readonly isOpen: (id: TileId) => boolean
  readonly setOpen: (id: TileId, open: boolean) => void
  /** 首屏展开集合（独立挂载时用 `TileSpec.defaultOpen`） */
  readonly defaultOpenOf: (id: TileId) => boolean
}

export const TileHostContext = createContext<TileHost | null>(null)

export function useTileHost(): TileHost | null {
  return useContext(TileHostContext)
}
