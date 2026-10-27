// S8 · 面板容器选择器：同一份面板内容按壳形态落进不同容器。
//   floating ⇒ `FloatingTile`（旧浮块壳，行为不变）
//   m1       ⇒ `Pane`（固定栏位，不折叠）
// 9 个面板只改 import 与标签名，内容与业务不动；App 一次只渲染一个壳树 ⇒ 不会出现两套实例。
import type { ReactNode } from 'react'
import { FloatingTile } from './floating/FloatingTile'
import type { TileId } from './floating/tile-specs'
import { Pane } from './Pane'
import { useShell } from './ShellContext'

export interface PanelFrameProps {
  readonly id: TileId
  readonly summary?: ReactNode
  readonly accessory?: ReactNode
  readonly children: ReactNode
}

export function PanelFrame(props: PanelFrameProps): JSX.Element {
  const shell = useShell()
  if (shell === 'm1') {
    return (
      <Pane id={props.id} summary={props.summary} accessory={props.accessory}>
        {props.children}
      </Pane>
    )
  }
  return (
    <FloatingTile id={props.id} summary={props.summary} accessory={props.accessory}>
      {props.children}
    </FloatingTile>
  )
}
