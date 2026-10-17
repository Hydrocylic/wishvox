# tests — 无头单元测试

<!-- 位置: tests/README.md -->

**可无头运行**的验证：纯函数 · 数据契约 · 确定性。不吃外部资产、不依赖 GPU / 浏览器；
判据用解析值或明确的不变量，不靠肉眼。

> **判据目录（不变量 `I#` / 层 `L#` / 采集协议）= 笔记库 [`../voxel-ai-editor-lab/curriculum/testing-plan.md`](../voxel-ai-editor-lab/curriculum/testing-plan.md)**
> —— `r01`：`I1`/`I2`/`I3`/`N1`/`N2`（本目录）· `I8`/`I9`（`../harness/`）；`r02` 增 `I4`（操作族确定性）+ `I2` 批量扩展 + `I1` 绝对/相对两类 + `I3` v2/v1 迁移 + 新探 `N3`/`N4`/`N5`（本目录 `ops-*` / `scope` / `composition` / `typical-utterances`）。
> **`r02` 前半判据指针**（2026-10-04）：`V1`–`V13` 的 L1 面 = 本目录 `brush`（V6 体积 / V7 布尔四则 / Q7 谓词）· `model-info`（V2 AABB / V3 按层计数）· `editing-session`（V5 坯料 / V8 一笔一补丁 / V10 双态门 / V11 会话态）· `noise-sculpt`（V9 确定性 · 六向 · 零新块不建构件）· `history-jump`（V13 跳转等价）；判据正本 = 笔记库 `../voxel-ai-editor-lab/curriculum/r02-procedural-ops/editing-system-plan.md` §4。
> **`r03` 判据指针**（2026-10-05）：`V8` 工具面同源 + 类型映射表 = `ai-tools`（19 件 / 读 5 写 13 会话 1 / wide 静态 5 件）· `N6` 会话日志重放 = `ai-session-log`（追加 / 编号 / 校验 / 坏尾巴截断 / 未答闸门）· `V2`+`I5` provider 容错 = `ai-provider`（线级 SSE 注入：半截 / 畸形 / 空流 / 5xx + 重试梯照抄数字 + `screen()`；含脚本化流设施的**有界红例**——续单 §7.3A）· `V6`/`V7`/ADR-19 守卫与归属 = `ai-executor`（y=0 四路 · 组合宾语三正例一负例 · undo 地板 · v2 透传）· `V1`/`V3`/`V4`/`V9`+`N7` 循环级 = `ai-loop`（12 格闸门矩阵 + callApproved 2 例 · 三句对拍 · 刷新续跑重入 · 轮预算 24 · 半截重发 · 5xx 一键重试 · 六条回归集；T8 弱化版：阻尼 + 折叠）。判据正本 = 笔记库 `../voxel-ai-editor-lab/curriculum/r03-agent-edit/agent-edit-plan.md` §4/§5 + 口径卡。
> **`r05` 判据指针**（2026-10-08）：**`REQ-062` 首运行坯料** = `io/blank-first-run`（无存档 + `init()` ⇒ 27 块 `(0..2)³` / 构件「坯料」/ 恰 1 条补丁 · 一次撤销 ⇒ 0 块 · 再次 `init()` 不叠加 · **有存档行为不变**）· **闸门到达 ⇒ UI store 与日志同源** = `ai/ai-gate-view-sync`（计划 / 工具两处闸门落点；`debug-261008` 件一）· **「造一颗 minecraft 中的经典橡树」脚本化用例** = `ai/classic-oak`（操作序列 + 终态 `digest 014f5312` / `nonEmpty 38` / `patches 4` / `done`，两实例逐字相等）· **`REQ-063` 关键块预览** = `edit/preview-key-cell`（关键 = 锚点格 = 最小角格 · `2×2×2` 恰 1 格关键 / `1×1×1` 关键 1 附属 0 / 过滤后关键 ≤1 / 检视态双 0 / **预览集合 = 笔刷体积 ∩ 既有谓词**）· **`REQ-064` 每工具笔刷尺寸** = `edit/brush-size-per-tool`（`brushSizes` 按工具 + 镜像 `brushSize` · 来回切换各自保持 · 预览与补丁 `size` 同源 · 初值 `{1,1,1}` · 每轴 1–8 报错不变 · 项目文件不含尺寸）。判据正本 = `discovery/requirements.md` 的 `REQ-055`/`REQ-056`/`REQ-062`/`REQ-063`/`REQ-064` 与笔记库 `curriculum/r05-ui-redesign/ui-redesign-log.md`（`verify-261008b` 回执单）。

- **首件随 `r01` 落**（体素模型的行为）。
- **运行**：`npm run test`（Vitest）。
- **依据**：`../voxel-ai-editor-lab/_framework/project-types/reconstruction/SKELETON.md` §验证设施
  ——"重建项目的价值在于把参考实现的隐式知识变成可测的显式规格"。
