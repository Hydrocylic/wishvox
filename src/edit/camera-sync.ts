// r04 T6（A7）：相机面板的写入 / 复位 / 读回——自 edit/editor.ts 迁出（**移出 Editor 类**：
// 相机是交互关注点，REQ-049/058）。Editor 的三个同名方法是一行委托（facade 不变）；
// ui/commands.ts 与 ui/Viewport.tsx 直接调用本文件（不绕 Editor）。
import { setUi, useEditorUi } from '../state/editor-store'
import type { EditorRenderer } from '../edit/render-port'

/** F9：相机面板写入（会话态——不进项目文件 / 补丁日志，REQ-058） */
export function applyCameraParams(
  renderer: EditorRenderer | null,
  p: { fov?: number; rotateSpeed?: number; damping?: number; distance?: number },
): void {
  renderer?.setCameraParams?.(p)
  const read = renderer?.getCameraState?.()
  if (read) {
    setUi({
      cameraPanel: {
        fov: p.fov ?? read.fov,
        distance: p.distance ?? read.distance,
        rotateSpeed: p.rotateSpeed ?? read.rotateSpeed,
        damping: p.damping ?? read.damping,
        target: read.target,
      },
    })
  }
}

/** F9：复位视角（回到"对准模型 AABB 中心的初始机位"） */
export function resetCameraView(renderer: EditorRenderer | null): void {
  renderer?.frameModel()
  const read = renderer?.getCameraState?.()
  if (read) setUi({ cameraPanel: { fov: read.fov, distance: read.distance, rotateSpeed: read.rotateSpeed, damping: read.damping, target: read.target } })
}

/** 渲染层 → store 的相机读回（Viewport 挂接 renderer.onCameraChange 时调用） */
export function syncCameraReadout(read: {
  target: [number, number, number]
  distance: number
  fov: number
  rotateSpeed: number
  damping: number
}): void {
  const cur = useEditorUi.getState().cameraPanel
  setUi({ cameraPanel: { ...cur, distance: read.distance, target: read.target } })
}
