import type { WireState } from '../ai/provider'
import { useAiUi } from '../state/ai-store'

// r05 T4（规格 §2.2「状态实例归类表」· REQ-060 验收①/③）：**线级状态**（provider / 重试梯上报）
// 的四态归类与文案句式的唯一出处——设置区标题行（`AiSettings`）与会话区相位行（`AiSession`）共用。
//
// 归类（`Q1`–`Q5` 已裁 + `E3′` 状态重归类，2026-10-08）：
//   connecting / streaming / idle-wait / retrying → **忙**（绿 `--ok`）——`idle-wait` 等的是**外部响应**
//   不是用户动作（规格 §2.2 明写"改绿"）；`retrying` 同理（现状红 → 绿 + 第 n 次尝试）。
//   done → **可操作**（中性 `--mute`，完成态不保持常亮绿，§2.1 补充口径）；error → **错**（红 `--err`）。
export const WIRE_DOT: Record<WireState['phase'], string> = {
  connecting: 'var(--ok)',
  streaming: 'var(--ok)',
  'idle-wait': 'var(--ok)',
  retrying: 'var(--ok)',
  done: 'var(--mute)',
  error: 'var(--err)',
}

/** 线级状态 → 一行文本（"同一态同一文案句式"，§2.1）。`secs` = 已持续秒数（由调用方定时重算）。 */
export function wireText(w: WireState, secs = Math.floor(w.elapsedMs / 1000)): string {
  const attempt = w.attempt !== undefined ? `（第 ${w.attempt} 次尝试）` : ''
  switch (w.phase) {
    case 'connecting':
      return `正在连接…${attempt}`
    case 'streaming':
      return `正在流式接收…${attempt}`
    case 'idle-wait':
      return `等待模型响应 ${secs}s` // 「等」的是外部响应 ⇒ 不必写用户动作；归「忙」（§2.2）
    case 'retrying':
      return `正在重试${attempt}`
    case 'done':
      return '本轮已收束'
    case 'error':
      return '请求失败'
  }
}

/**
 * 设置区标题行的状态点 + 一行文本（也是「AI 连接」二级折叠的折叠态摘要，§1.2）。
 * 「未配置」= **等**（黄）：等用户填 baseUrl + API Key——文案写明等什么，并给一句动作提示（§2.2 / §2.3-2）。
 */
export function WireLine(): JSX.Element {
  const wire = useAiUi((s) => s.wire)
  if (!wire) {
    return <span style={{ color: 'var(--warn)', fontSize: 11 }}>未连接 · 先连上再聊</span>
  }
  return (
    <span style={{ fontSize: 11, color: 'var(--mute)' }}>
      <span style={{ color: WIRE_DOT[wire.phase] }}>●</span> {wireText(wire)}
    </span>
  )
}

/** 未配置连接（REQ-004/013：BYOK 首次使用引导位）——「AI 连接」默认展开的判据（§1.2）。 */
export function isUnconfigured(settings: { baseUrl: string; apiKey: string } | null): boolean {
  return settings === null || settings.baseUrl.trim() === '' || settings.apiKey.trim() === ''
}
