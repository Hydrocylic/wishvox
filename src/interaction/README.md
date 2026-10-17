# interaction — 交互层（从 render 拆出的"非画"半）

`camera.ts`（CameraRig：PerspectiveCamera + OrbitControls，取景/目标点/参数/双态鼠标面/两档缩放）·
`grids.ts`（GridGuides + gridPlacement 纯函数——网格与包围盒引导）· `pick.ts` + `ground-pick.ts`
（拾取编排与地面落格规则）· `view.ts`（**VoxelView 编排壳**：装配画核 + 相机 + 网格 + 拾取，
实现 EditorRenderer——harness 与 Viewport 用它）。

- **做什么**：相机 / 拾取 / 视图引导 / 3D 视图组合。
- **不做什么**：不画（render/ 只管画，且不 import 本目录——structure 断言⑥）；不碰模型写路径。
- **依赖**：`render`（同层：VoxelView 组合画核）· `state`（相机读回）· `edit`/`core` 仅 type-only。
