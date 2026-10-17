// `D1`（architect §5.2 `EditorWorkspace`）：**画布与覆盖层的共同定位根**——顶替原 `App` 里
// 「左 `.toolbar` + 中 Viewport + 右 `.rail`」的三栏装配（design §7.2：侧边栏改为悬浮小方块）。
// 结构：`Viewport`（渲染器宿主）与 HUD / 九个方块是**兄弟**；布局由 `useTileLayout` 量测本容器与 HUD。
// 本组件不持模型 / AI / 笔刷状态（只读 DOM 几何与 store 投影），也不建通用窗口系统：
// 没有拖拽、缩放、位置持久化（`D1` ②⑦）。
import { useRef } from 'react'
import { FLOATING_CSS } from './floating/floating-styles'
import { FloatingTiles, useTileLayout } from './floating/FloatingTiles'
import { Viewport } from './Viewport'
import { ViewportHud } from './ViewportHud'

export function EditorWorkspace(): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const hudRef = useRef<HTMLDivElement>(null)
  const layout = useTileLayout(hostRef, hudRef)
  return (
    <main className="workspace workspace-host" ref={hostRef}>
      <style>{FLOATING_CSS}</style>
      <Viewport />
      <div className="hud-slot" ref={hudRef}>
        <ViewportHud />
      </div>
      <FloatingTiles layout={layout} />
    </main>
  )
}
