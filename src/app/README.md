# app — 组合根

装配的唯一正本：`runtime.ts` 的 `getEditor()` / `getAiSession()`（惰性 memoize 单例）与 `bootstrap()`
（存档恢复 + AI 面板投影种入，main.tsx 在 render 前调用）。

- **做什么**：装配与启动序列——全图唯一"全知"层。
- **不做什么**：不含业务逻辑；不持状态。ui 经它做服务定位（`ui → app` = 全图唯一上行边，Q2 已裁）。
- **依赖**：`edit/editor` · `ai/agent`（可向下全知）。
