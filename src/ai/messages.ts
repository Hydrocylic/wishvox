// r04 T6（I2 · loop 二拆之一）：消息面——systemPromptOf / deriveMessages / compactMessages。
// A1 同源纪律（2026-10-06 拍板）：系统提示词的**规则句**从 rules/{pre,post} 的 agentHint 派生
// （文案与判定同居规则文件——改规则必同步改 hint）；本文件只持纪律骨架。
// 拼装结果与迁移前的字面量**逐字相同**（tests 快照用例锁定 = "派生不漂移"的常驻守卫）。
// 拼装分形：zh 是 7 条编号列表——hints 落第 3（宾语口径，rules/post）/ 5（y=0 下界，rules/pre）
// 号条目；en 是一整句——hints 落对应**分句位置**（不按编号找插槽）。
import { preAgentHints } from '../rules/pre'
import { postAgentHints } from '../rules/post'
import type { SessionEvent, SessionLog } from './session-log'
import type { ProviderMessage } from './provider'
import { renderSnapshot } from './view'

/** zh 纪律骨架（第 3 / 5 号条目 = hints 派生句，见 systemPromptOf） */
const ZH_SKELETON_ITEMS = [
  '先观察再动手——改前用 get_model_summary / list_parts / list_compositions / read_map_full 看清现状，不要凭记忆猜。',
  '一次只做一小步；大改动拆成多步，每步一个工具调用。',
  null, // 3 号插槽：宾语口径（rules/post 的 POST_RULE_HINTS）
  '参数全部平铺；随机操作必须显式给 seed。',
  null, // 5 号插槽：y=0 下界（rules/pre 的 PRE_RULE_HINTS）
  '写完看回执：回执带编辑区快照，确认无误再继续；有疑问先读模型再改。',
  '完成后用一句中文总结改了什么；若必须问用户，以问号结尾。',
] as const

/** en 纪律骨架的三段包夹（两处 hints 分句位 = rules 的 en hint） */
const EN_BEFORE =
  'You are an editing agent inside a 16^3 voxel editor. The user gives one sentence; you reshape the existing model via tool calls.\n\n' +
  'Discipline: observe before editing (get_model_summary / list_parts / list_compositions / read_map_full); small steps; '
const EN_MID = '; flat scalar params; explicit seed for randomness; '
const EN_AFTER =
  '; read the receipt (it embeds an edited-region snapshot) before continuing; end with a one-sentence summary, or a question mark if you must ask.'

export function systemPromptOf(language: 'zh' | 'en'): string {
  if (language === 'en') {
    return EN_BEFORE + postAgentHints('en')[0]! + EN_MID + preAgentHints('en')[0]! + EN_AFTER
  }
  const items = ZH_SKELETON_ITEMS.map((t, i) => t ?? (i === 2 ? postAgentHints('zh')[0]! : preAgentHints('zh')[0]!))
  const numbered = items.map((t, i) => `${i + 1}. ${t}`).join('\n')
  return `你是一个 16³ 体素编辑器里的编辑代理。用户给你一句话，你通过**工具调用**改造既有体素模型。\n\n纪律：\n${numbered}`
}

/** 从会话日志派生供给商消息（当前 job；地图事实每轮由 order 快照重建——①-2 / ①-33 第三重） */
export function deriveMessages(log: SessionLog): ProviderMessage[] {
  const jobId = log.currentJobId()
  const order = log.currentOrder()
  if (jobId === null || order === null) return []
  const events = log.events.filter((e) => e.jobId === jobId && e.seq >= order.seq)
  const messages: ProviderMessage[] = [
    { role: 'user', content: `${order.text}\n\n[当前状态快照]\n${renderSnapshot(order.snapshot)}` },
  ]
  let batch: Array<SessionEvent & { type: 'toolCall' }> = []
  const results = new Map<string, SessionEvent & { type: 'toolResult' }>()
  for (const e of events) if (e.type === 'toolResult') results.set(e.callId, e)
  const flush = (): void => {
    if (batch.length === 0) return
    const withResults = batch.filter((c) => results.has(c.callId))
    if (withResults.length > 0) {
      messages.push({
        role: 'assistant',
        content: withResults[0]?.assistantText ?? null,
        toolCalls: withResults.map((c) => ({ id: c.callId, name: c.tool, args: c.args })),
      })
      for (const c of withResults) messages.push({ role: 'tool', toolCallId: c.callId, content: results.get(c.callId)!.content })
    }
    batch = []
  }
  for (const e of events) {
    if (e.type === 'toolCall') {
      batch.push(e)
    } else {
      flush()
      if (e.type === 'gateAnswered' && e.answer === 'words' && e.words) {
        messages.push({ role: 'user', content: `（用户对刚才那步的意见）${e.words}` })
      }
    }
  }
  flush()
  return compactMessages(messages)
}

/** T8 压缩弱化版（①-33 弱化面）：供给商消息总量超 COMPACT_KEEP_CHARS 时，从最旧的 tool 回执开始折叠成
 *  首行 + 标记（尾部逐字保留）；状态事实不受影响——order 快照每轮重建（第三重保证天然成立）。 */
export function compactMessages(messages: readonly ProviderMessage[]): ProviderMessage[] {
  const sizeOf = (m: ProviderMessage): number => (m.content?.length ?? 0)
  let total = messages.reduce((n, m) => n + sizeOf(m), 0)
  if (total <= COMPACT_KEEP_CHARS) return [...messages]
  const out = [...messages]
  for (let i = 0; i < out.length && total > COMPACT_KEEP_CHARS; i++) {
    const m = out[i]
    if (m.role !== 'tool' || m.content === null || !m.content.includes('\n')) continue
    const firstLine = m.content.split('\n')[0]!
    const folded = `${firstLine}\n（已折叠：原 ${m.content.length} 字符——需要细节请重新调用读工具）`
    total += folded.length - m.content.length
    out[i] = { ...m, content: folded }
  }
  return out
}

/** T8 压缩弱化版的数字（①-33 弱化面）：尾部保留 ≈ PetitMaker KEEP_RECENT=8000（按字符近似 token） */
const COMPACT_KEEP_CHARS = 8000
