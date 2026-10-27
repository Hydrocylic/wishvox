// S8 · M1 三栏主体：左栏 / 舞台（Viewport + HUD）/ 右栏 Dock。
// 与浮块壳共用同一个 `Viewport`（白底渲染宿主）与 `ViewportHud`；不挂 `FloatingTiles`。
// 闸门卡仍由 App 壳级 `GateDock` 挂，这里不重复。
import { FLOATING_CSS } from './floating/floating-styles'
import { ShellContext } from './ShellContext'
import { Viewport } from './Viewport'
import { ViewportHud } from './ViewportHud'
import { LeftRail } from './shell/LeftRail'
import { RightDock } from './shell/RightDock'

export function M1Workspace(): JSX.Element {
  return (
    <ShellContext.Provider value="m1">
      <div className="shell-body">
        <style>{FLOATING_CSS}</style>
        <LeftRail />
        <main className="m1-stage">
          <Viewport />
          <div className="hud-slot">
            <ViewportHud />
          </div>
        </main>
        <RightDock />
      </div>
    </ShellContext.Provider>
  )
}
