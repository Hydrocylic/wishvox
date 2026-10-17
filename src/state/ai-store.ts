// r03 · AI 面板的 UI 状态（会话视图的投影——真源在 SessionLog，这里只放渲染面）。
// r04 T5（D7 消重）：默认设置的正本 = ai/settings 的 DEFAULT_AI_SETTINGS——state 层不复制一份
// （旧版手抄默认值是漂移点）。层序上 state < ai ⇒ 这里对 ai 只留 type-only 引用；
// 首值由组合根 app/runtime 的 bootstrap() 经 AgentSession.pushView() 种入（main.tsx 在 render 前调用，
// 首绘即真实设置），null = 尚未 bootstrap。
import { create } from 'zustand'
import type { LoopPhase } from '../ai/loop'
import type { WireState } from '../ai/provider'
import type { AiSettings } from '../ai/settings'
import type { SessionView } from '../ai/session-log'

/** T8（§4 件二）：相位 + 起始时刻（UI 算"已持续秒数"；同 kind 不重置 since） */
interface AiPhase extends LoopPhase {
  readonly since: number
}

interface AiUiState {
  /** 会话视图（SessionLog.view() 的快照；每个事件落地后刷新） */
  view: Pick<SessionView, 'jobs' | 'pendingGate' | 'allowAlways'> | null
  settings: AiSettings | null
  running: boolean
  error: string | null
  roundsUsed: number
  /** T8（§4 件一）：线级状态快照（provider / 重试梯上报；null = 本轮尚无请求） */
  wire: WireState | null
  /** T8（§4 件二）：当前相位（null = 未开始 / 已收口） */
  phase: AiPhase | null
}

export const useAiUi = create<AiUiState>(() => ({
  view: null,
  settings: null,
  running: false,
  error: null,
  roundsUsed: 0,
  wire: null,
  phase: null,
}))
