# ops — 程序化操作族

ProgramOp → 变更集：`index.ts` 分发器（`runProgramOp`，未知操作在此 throw）· 9 个实现 ·
`rng`（mulberry32，I4 唯一随机源）· `targets`（终态差分基建）· `apply.ts`（`applyProgramOp` =
旧 PatchLog.applyOp 全行为助手，测试/harness 直调用它）。规格表在 `core/op-spec.ts`（数据契约留 core）。

- **做什么**："算变更集"；与 core 的纯函数共担全部程序化操作语义（REQ-014）。
- **不做什么**：不记账（PatchLog.applyPlanned 才是记账入口）；不碰 UI/AI。
- **依赖**：`core`（types/volume/parts/composition/scope/coords/op-spec）。
