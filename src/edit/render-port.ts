import type { LayerFilter } from '../core/brush/predicate'
import type { BlockStyle, Coord, VoxelChange } from '../core/types'
import type { EditorMode } from '../state/editor-store'

/** 渲染层接口（结构性）——editor 不 import three ⇒ L1 测试可无头实例化 Editor。
 *  r04 T6（A1）：自 ui/editor.ts（现 edit/editor.ts）整段迁出；编辑器对渲染层的全部依赖走这个端口。 */
export interface EditorRenderer {
  applyChanges(changes: readonly VoxelChange[]): void
  rebuildAll(): void
  setAppearance(app: { style: BlockStyle; missing: ReadonlySet<string> }): void
  setHighlightedPart(partId: string | null): void
  /** r02：组合高亮（坐标集合；组合不是 part ⇒ 走坐标键集合而非 partId） */
  setHighlightedCoords?(coordKeys: ReadonlySet<string> | null): void
  frameModel(): void
  // ── r02 前半（全部可选 ⇒ 测试的假渲染器与旧用法不受影响）──
  /** F1/Q4：模型有方块更新 ⇒ 目标点重算入口（渲染层内部处理"拖动中冻结"） */
  onModelChanged?(): void
  /** F3：层次 = 视图过滤（隐藏层不进实例缓冲 ⇒ 不可拾取） */
  setLayerFilter?(filter: LayerFilter | null): void
  /** F3 读回面（debug-261007）：渲染层**当前实际持有**的层次过滤（null = 不过滤）。
   *  与 store 的 layerMode/layerY 对拍用——"模型长高后渲染层是否已被通知"的可测面。 */
  layerFilterReadback?(): LayerFilter | null
  /** F4：网格开关。`D3`（2026-10-16）：`y` = **工作网格**生效高度（放置平面），
   *  `refY` = **参考网格**生效高度（只读参考平面，不参与命中）——两者各持独立值，缺省沿用上一值。 */
  setGrid?(wanted: { base: boolean; layer: boolean; y?: number; refY?: number }): void
  /** F7：虚方块预览。`REQ-063`（r05 件三）：第二参 `keyCells` = **关键块**（锚点格；≤1）
   *  ——关键块半透明红、其余（`cells`）绿。缺省 ⇒ 全部按附属色（旧调用面不变）。 */
  setPreview?(cells: readonly Coord[] | null, keyCells?: readonly Coord[] | null): void
  /** F5：双态的交互面（检视 = 左转；编辑 = 左笔刷 / 右转） */
  setInteractionMode?(mode: EditorMode): void
  /** F9：相机参数读写 */
  getCameraState?(): {
    target: [number, number, number]
    distance: number
    fov: number
    rotateSpeed: number
    damping: number
    position: [number, number, number]
  }
  setCameraParams?(p: Partial<{ fov: number; rotateSpeed: number; damping: number; distance: number }>): void
  /** S9b：恢复完整机位（切壳重挂时用） */
  setCameraPose?(pose: { position: [number, number, number]; target: [number, number, number] }): void
}
