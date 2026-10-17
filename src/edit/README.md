# edit — 命令层（编辑器的"动词"）

Editor 服务：UI 与模型之间的唯一通道。`editor.ts` = 类骨架 + 一行委托面（公共签名不变 ⇒ 239 例零改动），
实现分家：`render-port`（渲染端口）· `stroke`（笔刷一笔 + 预览 + applyBrushBatch/strokeLabel，D1/D2 合并）·
`session-view`（会话态 setter）· `model-api`（place/erase/paint/runOp）· `history`（undo/redo/跳转）·
`structure`（构件/组合）· `project`（新建/导入/导出）· `ai-write`（AI 模型级写路径）· `camera-sync`（相机三方法）。

- **做什么**：全部写路径与模型编排；对 AI 暴露的模型级 API（不属于 ai/ 层）。
- **不做什么**：不含应用单例（app/ 持有）；不 import three（经 render-port 端口）；相机实现在 interaction/camera。
- **依赖**：`core` · `ops` · `io` · `state` · `rules`（预览经 checkCellWrite 接缝）。
