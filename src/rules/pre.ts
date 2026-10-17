// rules/pre.ts —— 前置谓词接缝（写路径"这格能不能写"的唯一正本）
//
// 纪律（文件头，逐条）：
// 1. D-K：本文件只立接缝——现状转发 core/brush/predicate 的 canWriteCell，行为零变化；
//    手动 / AI 两路同源（同一函数），不得在 edit/ 或 ai/ 内另写第二份判定。
//    （core/brush/apply 的 applyBrush 内部谓词 = 内核基础不变式，与接缝同源、最终同为 canWriteCell。）
// 2. A1（同源纪律）：本文件每条规则的 agentHint 与判定同居此文件；
//    ai/messages.ts 的 systemPromptOf 从 PRE_RULE_HINTS 派生规则句——提示词文本与迁移前逐字相同
//    （快照用例锁定），改规则必同步改 hint，反之亦然。
// 3. 双语：hint 各带 zh / en 两份（REQ-004 语言偏好；PetitMaker 单语，我方双份）。
// 4. D-G 导出纪律：本文件导出面 = checkCellWrite + PRE_RULE_HINTS + preAgentHints——各有消费者
//    （edit/stroke.ts / ai/messages.ts），不得新增无消费导出。
// 5. 将来加规则：在本文件内组合新谓词（可包一层 layerVisible/lock 判定），
//    并同步补 hint；超过 3 条前置规则时再议是否引入注册表（届时另立 ADR）。
import { canWriteCell } from '../core/brush/predicate'
import type { CellWriteQuery } from '../core/brush/predicate'

export interface PreRuleHint {
  readonly id: string
  readonly zh: string
  readonly en: string
}

/** 现状唯一前置规则的 hint：坐标数域 ±2¹²（`REQ-065`，取代 `REQ-059` / ADR-20 的 y≥0 下界）。
 *  文本同步进 `ai/messages.ts` 的 SYSTEM_PROMPT_ZH 第 5 条 / EN 对应分句——逐字相同。 */
export const PRE_RULE_HINTS: readonly PreRuleHint[] = [
  {
    id: 'pre.coord-domain',
    zh: '坐标域 ±4096：目标坐标须是 ±4096 内的整数（含负值 y）；非整数 / 非有限 / 越界会被丢弃或拒绝。',
    en: 'coord domain ±4096 (integer coords in [-4096, 4096], negative y included; non-integer, non-finite or out-of-range targets are dropped)',
  },
]

export function preAgentHints(language: 'zh' | 'en'): string[] {
  return PRE_RULE_HINTS.map((h) => h[language])
}

/** 接缝正本：转发 core/brush/predicate 的 canWriteCell（D-K：行为不变）。 */
export function checkCellWrite(query: CellWriteQuery): boolean {
  return canWriteCell(query)
}
