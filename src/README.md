# src — 产品源码

<!--
  位置: src/README.md
  用途: 目录结构总览（r04 结构重整后 = 纲要 §7.3 骨架 + 五新层）
  依据: 纲要 §7.3 + r04 restructure-design.md §1.0（层序与唯一上行边）
-->

## 层（自下而上；每层可 import 自己与更下层）

| 层 | 放什么 | README |
|---|---|---|
| `core/` | 体素内核：模型 / 补丁日志 / 构件 / 笔刷纯函数 / op-spec（数据契约） | core/README.md |
| `ops/` | 程序化操作族（runProgramOp + 9 实现 + apply 助手） | ops/README.md |
| `rules/` | 前置谓词 + 后验对账两处接缝（D-K；A1 hint 同源） | rules/README.md |
| `io/` | 存档 / 持久化 / 导入导出传输 | io/README.md |
| `state/` | 两个 zustand store + 模型投影 | state/README.md |
| `edit/` | 命令层：Editor 服务与全部写路径 | edit/README.md |
| `render/` | 只管画（画核 + chunk 增量重建 + 外观解析） | render/README.md |
| `interaction/` | 相机 / 拾取 / 网格引导 / VoxelView 编排壳 | interaction/README.md |
| `ai/` | agent 会话循环 / 工具面 / provider / 会话日志 / 设置 | ai/README.md |
| `ui/` | React 壳与面板 + 具名命令表（不含装配与 store） | ui/README.md |
| `app/` | 组合根：惰性单例 + bootstrap（`ui → app` = 全图唯一上行边） | app/README.md |

层序由 `tests/structure.test.ts` 自动判定（层序 / 无环 / ≤400 行 / 无 ai→ui / 组合根词法 / render 只管画）。

## 不预建

`stage/`（演出层）→ `P3`（时间轴 / 装置演出 / 一级导出）。

## 约定

- **路径即配置**：笔记里用显式路径定位代码（`../voxel-ai-editor/src/core/…`），不靠环境变量。
- **可无头验证的部分**（纯函数 / 数据契约 / 确定性）尽量留在能被 `tests/` 覆盖的形态里。
