# rules — 两层接缝（前置谓词 / 后验校验）

## 两层接缝是什么

- **`pre.ts`（写前谓词）**：`checkCellWrite` 转发 core/brush/predicate 的 `canWriteCell`——"这格能不能写"
  的唯一正本，手动 / AI 两路同源。现状消费方 = `edit/stroke` 的预览检查（`applyBrush` 内部谓词 = 内核
  基础不变式，与接缝同源）。
- **`post.ts`（写后对账）**：`reconcileNarrow` / `reconcileExpand`（V7 宾语对账）自 ai/executor 整段迁入。
  现状消费方 = `ai/executor`（仅 AI 路径）。

## D-K 边界：手动路径不接后验

手动笔刷**不**调用 post 接缝——手动获得后验 = 行为变更，已裁另排线。
将来接线点 = `edit/stroke` 的 `strokeCommit` 之后；接线即行为变更，需另立线索拍板。

## A1 同源纪律

每条规则自带 `agentHint`（双语）——`ai/messages.ts` 的 systemPromptOf 从 `PRE_RULE_HINTS` /
`POST_RULE_HINTS` 派生规则句，拼装结果与拆分前逐字相同（`tests/ai-loop` 快照用例常驻守卫）。
**改规则必同步改 hint，反之亦然。**

## 扩展路径

新规则在 pre/post 内组合（锁定层 / 越域 / 限额……）并同步补 hint；前置超 3 条、合计超 5 条时再议注册表
（届时另立 ADR）——现在不建 RuleRegistry（PetitMaker 的 16 条 × 两注册表规模才需要它）。
