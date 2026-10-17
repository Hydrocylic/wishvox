// `D1`（architect §5.2 `FloatingTiles` / `useTileLayout`）：**九个固定实例的装配** + 视图量测。
// 三条纪律：
//   ① 九块**常驻挂载**（业务适配器与草稿的拥有者不随开关销毁）：这里只切 `openById`，
//      面板组件始终在树上，收起仅让外壳不渲染正文；
//   ② 开关态**只在 React 会话里**：不进 Editor、不进项目文件、不进撤销日志、不进 localStorage（`D1` ②⑦）；
//   ③ 量测只读 DOM 几何（工作区矩形 + HUD 矩形），不读相机 / 模型 / 存档（architect §5.4）。
import { useEffect, useMemo, useState } from 'react'
import type { RefObject } from 'react'
import { AiPanel } from '../AiPanel'
import { CameraPanel } from '../CameraPanel'
import { HistoryPanel } from '../HistoryPanel'
import { LayerPanel } from '../LayerPanel'
import { NoisePanel } from '../NoisePanel'
import { OpsPanel } from '../OpsPanel'
import { PartTree } from '../PartTree'
import { StylePanel, ToolPanel } from '../Panels'
import { computeTileLayout } from './tile-layout'
import type { TileLayoutResult } from './tile-layout'
import { defaultOpenMap } from './tile-specs'
import type { TileId } from './tile-specs'
import { TileHostContext } from './tile-host'
import type { TileHost } from './tile-host'

interface Measured {
  readonly width: number
  readonly height: number
  readonly hudHeight: number
}

/** 量测工作区与 HUD 占用，随视口变化重算布局。无 `ResizeObserver`（无头垫片 / 老浏览器）时只用首帧量测。 */
export function useTileLayout(hostRef: RefObject<HTMLElement>, hudRef: RefObject<HTMLElement>): TileLayoutResult {
  const [m, setM] = useState<Measured>({ width: 0, height: 0, hudHeight: 0 })
  useEffect(() => {
    const read = (): Measured => {
      const host = hostRef.current?.getBoundingClientRect()
      const hud = hudRef.current?.getBoundingClientRect()
      return { width: host?.width ?? 0, height: host?.height ?? 0, hudHeight: hud?.height ?? 0 }
    }
    const measure = (): void => {
      const next = read()
      setM((prev) => (prev.width === next.width && prev.height === next.height && prev.hudHeight === next.hudHeight ? prev : next))
    }
    measure()
    const RO = (globalThis as { ResizeObserver?: new (cb: () => void) => { observe: (el: unknown) => void; disconnect: () => void } })
      .ResizeObserver
    if (typeof RO !== 'function') return
    const ro = new RO(measure)
    if (hostRef.current) ro.observe(hostRef.current)
    if (hudRef.current) ro.observe(hudRef.current)
    return () => ro.disconnect()
  }, [hostRef, hudRef])
  return useMemo(() => computeTileLayout(m), [m])
}

/** 九块装配：持 `openById`（唯一开关态正本）并把布局送进 context（外壳按 ID 自取锚点） */
export function FloatingTiles(props: { readonly layout: TileLayoutResult }): JSX.Element {
  const [openById, setOpenById] = useState<Record<TileId, boolean>>(() => defaultOpenMap())
  const host = useMemo<TileHost>(
    () => ({
      layout: props.layout,
      isOpen: (id) => openById[id],
      setOpen: (id, open) => setOpenById((s) => (s[id] === open ? s : { ...s, [id]: open })),
      defaultOpenOf: (id) => defaultOpenMap()[id],
    }),
    [openById, props.layout],
  )
  // 九块都在这里、各自只出现一次（`D1` ⑤：展开/收起不增删方块；AI 与层次各持独立开关）
  return (
    <TileHostContext.Provider value={host}>
      <ToolPanel />
      <AiPanel />
      <PartTree />
      <OpsPanel />
      <NoisePanel />
      <HistoryPanel />
      <StylePanel />
      <CameraPanel />
      <LayerPanel />
    </TileHostContext.Provider>
  )
}
