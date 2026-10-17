// r04 T6（G1-G5 组合）：3D 视图编排壳——画核（render/VoxelRenderer）+ 相机（CameraRig）+
// 网格引导（GridGuides）+ 拾取（pickAt）在此装配。harness 四页与 ui/Viewport 用 VoxelView；
// 它实现 edit/render-port 的 EditorRenderer（editor.attachRenderer 的入参面）。
// 旧 VoxelRenderer 的公共读回面在此保留：`paint` = 画核，`renderer` = WebGLRenderer（harness
// 的 `renderer.renderer.domElement / getContext()` 语义不变）、`camera` / `controls` = CameraRig 的。
// 相机、拾取、网格逻辑都在 interaction 层 ⇒ render/** 不 import 本目录（structure 断言⑥）。
import type * as THREE from 'three'
import type { LayerFilter } from '../core/brush/predicate'
import { modelBounds } from '../core/model-info'
import type { ModelBounds } from '../core/model-info'
import type { PartRegistry } from '../core/parts'
import type { BlockStyle, Coord, VoxelChange } from '../core/types'
import type { Volume } from '../core/volume'
import type { EditorRenderer } from '../edit/render-port'
import { VoxelRenderer } from '../render/voxel-renderer'
import type { VoxelRendererStats } from '../render/voxel-renderer'
import { CameraRig } from './camera'
import type { CameraState, InteractionMode } from './camera'
import { GridGuides } from './grids'
import { pickAt } from './pick'
import type { PickResult } from './pick'

export class VoxelView implements EditorRenderer {
  readonly paint: VoxelRenderer
  readonly rig: CameraRig
  readonly grids: GridGuides
  private workGridY = 0
  private refGridY = 0
  private workGridEnabled = false

  constructor(
    container: HTMLElement,
    private readonly volume: Volume,
    parts: PartRegistry | null,
  ) {
    this.paint = new VoxelRenderer(container, volume, parts)
    this.grids = new GridGuides(this.paint.scene)
    this.rig = new CameraRig(container, this.paint.renderer.domElement, () => this.bounds())
    this.paint.attachCamera(this.rig.camera)
    this.paint.onFrame = () => this.rig.updateControls()
    this.grids.refreshBoundsGuide(this.bounds(), null) // F2：初始包围盒引导与网格落点
    this.rig.frameModel()
    this.paint.start()
  }

  private bounds(): ModelBounds | null {
    return modelBounds(this.volume)
  }

  // ── 拆分前 VoxelRenderer 的公共面（harness 与 Viewport 直用；语义与拆分前一致）──

  /** WebGLRenderer（旧 `renderer.renderer` 的直用面：domElement / getContext） */
  get renderer(): THREE.WebGLRenderer {
    return this.paint.renderer
  }

  get scene(): THREE.Scene {
    return this.paint.scene
  }

  get camera(): THREE.PerspectiveCamera {
    return this.rig.camera
  }

  get controls(): CameraRig['controls'] {
    return this.rig.controls
  }

  get devicePixelRatio(): number {
    return this.paint.devicePixelRatio
  }

  set onCameraChange(cb: ((s: CameraState) => void) | null) {
    this.rig.onCameraChange = cb
  }

  /** 拾取（放 / 删除的目标格）；未点中块 ⇒ y=0 地面落格（T14） */
  pick(clientX: number, clientY: number, allowPlane = false): PickResult | null {
    return pickAt(this.paint.renderer.domElement, this.rig.camera, this.paint.chunks.pickables(), this.volume, clientX, clientY,
      allowPlane && this.workGridEnabled ? this.workGridY : null)
  }

  stats(): VoxelRendererStats {
    return { ...this.paint.stats(), gridCount: this.grids.count() }
  }

  buildSeqSnapshot(): Map<string, number> {
    return this.paint.buildSeqSnapshot()
  }

  resize(cssWidth: number, cssHeight: number): void {
    this.paint.resize(cssWidth, cssHeight)
    this.rig.resizeAspect(cssWidth, cssHeight)
  }

  start(): void {
    this.paint.start()
  }

  stop(): void {
    this.paint.stop()
  }

  // ── EditorRenderer 面（editor.attachRenderer(view)）──

  applyChanges(changes: readonly VoxelChange[]): void {
    this.paint.applyChanges(changes)
    this.grids.refreshBoundsGuide(this.bounds(), this.workGridY) // F2：包围盒随模型变化
  }

  rebuildAll(): void {
    this.paint.rebuildAll()
    this.grids.refreshBoundsGuide(this.bounds(), this.workGridY)
  }

  onModelChanged(): void {
    this.grids.refreshBoundsGuide(this.bounds(), this.workGridY)
    this.rig.onModelChanged() // Q4：拖动中目标点冻结、松手后重算
  }

  frameModel(): void {
    this.rig.frameModel()
  }

  /** F3/REQ-052：层次过滤 = 纯视图态（只影响渲染可见集），不再驱动网格落点或工作平面 */
  setLayerFilter(filter: LayerFilter | null): void {
    this.paint.setLayerFilter(filter)
  }

  /** F3 读回面（debug-261007）：当前实际持有的层次过滤 */
  layerFilterReadback(): LayerFilter | null {
    return this.paint.layerFilterReadback()
  }

  /** F4/REQ-048：参考网格 + **独立工作网格**（高度 = `y`，与过滤层解耦）；默认关。
   *  `D3`（2026-10-16）：`refY` = 参考网格自己的高度（缺省沿用上次值）——参考网格只读，**不参与命中**；
   *  只有 `layer`（工作网格）同时是"允许平面拾取"的闸门（`pick(..., allowPlane)`）与其平面高度。 */
  setGrid(wanted: { base: boolean; layer: boolean; y?: number; refY?: number }): void {
    this.workGridY = wanted.y ?? this.workGridY
    this.refGridY = wanted.refY ?? this.refGridY
    this.workGridEnabled = wanted.layer
    this.grids.setWanted({ base: wanted.base, layer: wanted.layer, refY: this.refGridY }, this.bounds(), this.workGridY)
  }

  setAppearance(app: { style: BlockStyle; missing: ReadonlySet<string> }): void {
    this.paint.setAppearance(app)
  }

  setHighlightedPart(partId: string | null): void {
    this.paint.setHighlightedPart(partId)
  }

  setHighlightedCoords(coordKeys: ReadonlySet<string> | null): void {
    this.paint.setHighlightedCoords(coordKeys)
  }

  /** `REQ-063`（r05 件三）：第二参 `keyCells` = 关键块（锚点格）——透传给画核的两组填充 */
  setPreview(cells: readonly Coord[] | null, keyCells?: readonly Coord[] | null): void {
    this.paint.setPreview(cells, keyCells ?? null)
  }

  getPreviewCells(): readonly Coord[] {
    return this.paint.getPreviewCells()
  }

  /** `REQ-063` 读回（r05 件三）：关键块（锚点格）格集合——`setPreview` 的第二参透传后由此读出 */
  getPreviewKeyCells(): readonly Coord[] {
    return this.paint.getPreviewKeyCells()
  }

  /** `REQ-063` 读回（harness）：两组预览网格的实例数（附属 / 关键），证明"关键那格真的走了另一份材质" */
  previewMeshCounts(): { secondary: number; key: number } {
    return this.paint.previewMeshCounts()
  }

  getCameraState(): CameraState {
    return this.rig.getCameraState()
  }

  setCameraParams(p: Partial<{ fov: number; rotateSpeed: number; damping: number; distance: number }>): void {
    this.rig.setCameraParams(p)
  }

  /** F5：双态的交互面——检视态同时收掉笔刷预览 */
  setInteractionMode(mode: InteractionMode): void {
    this.rig.setInteractionMode(mode)
    if (mode === 'inspect') this.paint.setPreview(null)
  }

  dispose(): void {
    this.paint.dispose()
    this.rig.dispose()
    this.grids.dispose()
  }
}
