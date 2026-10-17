# state — 会话状态与投影

两个 zustand store（`editor-store` = 编辑器 UI 会话态唯一状态源；`ai-store` = AI 面板投影，真源在 SessionLog）
与模型投影（`projections.ts` 的 `syncUi(editor)` / `historyItemsOf(log)`——每次写操作后全量推送，Q5 已裁本轮不增量）。

- **做什么**：会话态 + "模型在 UI 上的投影"。
- **不做什么**：不装配（组合根在 app/）；不复制默认值（D7——AI 设置首值由 bootstrap 种入）；对 ai 只留 type-only 引用。
- **依赖**：`core`（类型/纯函数）+ ai 的 type-only 类型。
