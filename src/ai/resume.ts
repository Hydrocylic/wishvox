// r04 T8：刷新续跑的"已批未执行"扫描——自 ai/loop.ts 抽出。T8 给 loop 加相位/线级上报后逼近
// G2③ 的 400 行上限；本函数是**纯日志扫描**（无循环私有状态），抽出行为不变——仍由 V4 用例锁。
import type { SessionEvent, SessionLog } from './session-log'
import { answerAllowsExecution } from './gates'

/** "已批未执行"扫描：最后一个 gateAnswered=allow/allow-always、其 callId 尚无 toolResult 的闸门 */
export function findAnsweredUnexecuted(log: SessionLog, jobId: string): { gate: SessionEvent & { type: 'gateAsked' } } | null {
  const executed = new Set<string>()
  for (const e of log.events) if (e.type === 'toolResult') executed.add(e.callId)
  for (let i = log.events.length - 1; i >= 0; i--) {
    const e = log.events[i]
    if (e.type !== 'gateAnswered' || !answerAllowsExecution(e.answer)) continue
    const gateIdx = log.events.findIndex((g) => g.type === 'gateAsked' && g.gateId === e.gateId)
    const gate = gateIdx >= 0 ? log.events[gateIdx] : undefined
    if (gate && gate.type === 'gateAsked' && gate.jobId === jobId && gate.callId !== null && !executed.has(gate.callId)) {
      return { gate }
    }
  }
  return null
}
