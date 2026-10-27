// S8 · 固定栏位容器（M1 三栏壳用）。与浮块 `FloatingTile` 的差别：
// **不折叠、不定位、不量测**——开合与位置由所在栏（左栏 / 右栏 Dock 标签）统一负责。
// `summary` / `accessory` 两个参数与浮块同形，面板组件因此可以两壳共用（`PanelFrame` 选容器）。
import type { ReactNode } from 'react'
import { UI_BOUNDARY_ATTR } from './UiInputBoundary'

export interface PaneProps {
  readonly id: string
  /** 面板当前状态的一行弱化读数 */
  readonly summary?: ReactNode
  /** 面板顶部常显附件 */
  readonly accessory?: ReactNode
  readonly children: ReactNode
}

export function Pane(props: PaneProps): JSX.Element {
  return (
    <section className="pane" data-pane={props.id} {...{ [UI_BOUNDARY_ATTR]: `pane:${props.id}` }}>
      {props.accessory !== undefined && props.accessory !== null && <div className="pane-accessory">{props.accessory}</div>}
      {props.summary !== undefined && props.summary !== null && props.summary !== '' && <div className="pane-summary">{props.summary}</div>}
      {props.children}
    </section>
  )
}
