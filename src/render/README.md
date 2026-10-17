# render — 渲染层

<!-- 位置: src/render/README.md（本层随 r01 落最小版）-->

把体素画出来：**实例化立方体**起步，风格化与渲染增强后置。

- **`r01` 的最小版**：实例化立方体 + 相机 + 一个样例建筑。
- **先不做**：greedy meshing / 纹理图集——增强由 `r01` 立项时**定死的性能阈值**触发，不靠临场感觉。
- **验证**：`../../harness/`（浏览器内）。
- **依据**：纲要 §七.3 · §八 两条执行口径。
- **`r04` 结构重整**：只管画——相机 / 拾取 / 网格引导拆至 `interaction/`（编排壳 = VoxelView），
  本层只剩画核 `voxel-renderer.ts`（场景/灯/材质/预览/帧循环）+ `chunks.ts`（增量重建内核）+
  `appearance.ts`（外观解析纯函数）。本层不 import interaction 与 OrbitControls（structure 断言⑥）。
