// S8 · M1 左栏：工具 / 笔刷 / 替换 / 调色板 / 取色器。
// 内容直接复用浮块壳的 `ToolPanel`（M1 下它经 `PanelFrame` 落成 `Pane`）——两壳同一份实现，
// 不复制一套工具逻辑（merge-plan S8「两壳共享面板内容」）。
import { ToolPanel } from '../Panels'
import { UI_BOUNDARY_ATTR } from '../UiInputBoundary'

export function LeftRail(): JSX.Element {
  return (
    <aside className="left-rail" {...{ [UI_BOUNDARY_ATTR]: 'left-rail' }}>
      <ToolPanel />
    </aside>
  )
}
