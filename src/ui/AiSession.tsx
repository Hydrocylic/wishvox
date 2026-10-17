import { useEffect, useState } from 'react'
import { getAiSession } from '../app/runtime'
import type { SessionView } from '../ai/session-log'
import { AI_LIMITS } from '../ai/tools'
import { downloadSessionLog } from '../io/export-log'
import { useAiUi } from '../state/ai-store'
import { wireText } from './AiWire'

// r05 T4 件二 · 会话块（规格 §1.4-2 的三段之一 / §1.2「AI 工作台」行）：
// 轮次行 + 相位行 + 会话流（JobBlock 时间线）+ 错态出口（一键重试）+ 输入框与「发送」。
// 与真源的关系不变（"THE LOG IS THE STATE"：会话视图的唯一来源 = SessionLog 的 `view` 投影）。
// 四态归类（REQ-060 验收①，对照规格 §2.2）：相位行——awaiting-provider / executing-tool → **忙**（绿）；
// awaiting-gate → **等**（黄，"等待闸门批准…"与闸门卡同屏不重复摘要）；轮次行 `capped` → 等（黄）。
const rowStyle: React.CSSProperties = { display: 'flex', gap: 6, alignItems: 'center', margin: '4px 0', fontSize: 12 }
const inputStyle: React.CSSProperties = { flex: 1 }

/** §2.2 会话相位 3 类的四态色：忙 → `--ok` · 等 → `--warn`（§2.1 同一语义同一 token）。 */
const PHASE_COLOR: Record<string, string> = {
  'awaiting-provider': 'var(--ok)',
  'executing-tool': 'var(--ok)',
  'awaiting-gate': 'var(--warn)',
}

/** 会话区顶行：相位 + 已持续秒数（awaiting-gate 与闸门卡同屏不重复摘要——现状口径保留）。 */
function PhaseLine(): JSX.Element {
  const phase = useAiUi((s) => s.phase)
  const wire = useAiUi((s) => s.wire)
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  if (!phase || phase.kind === 'idle') return <></>
  const secs = Math.max(0, Math.floor((Date.now() - phase.since) / 1000))
  // 合并口径：awaiting-provider 的 detail 直接引用件一的 wire 快照，不各画各的
  const detail = phase.kind === 'awaiting-provider' && wire !== null ? wireText(wire, secs) : phase.detail
  const label = phase.kind === 'awaiting-provider' ? '正在等待模型响应…' : phase.kind === 'executing-tool' ? '正在执行工具' : '等待闸门批准…'
  return (
    <div style={{ fontSize: 12, color: 'var(--fg-dim)', margin: '4px 0' }}>
      <span style={{ color: PHASE_COLOR[phase.kind] }}>●</span> {label}
      {detail ? ` · ${detail}` : ''} <span style={{ color: 'var(--mute)' }}>{secs}s</span>
    </div>
  )
}

/** 会话流内的结果徽标 = **时间线记录**（§2.1 补充口径：不参与"回到中性"规则，保留绿 ✓ 红 ✗）。 */
function outcomeBadge(outcome: string): { text: string; color: string } {
  switch (outcome) {
    case 'done':
      return { text: '完成', color: 'var(--ok)' }
    case 'capped':
      return { text: '轮预算到顶', color: 'var(--warn)' } // 等用户开新指令
    case 'aborted':
      return { text: '中止', color: 'var(--mute)' }
    default:
      return { text: '故障', color: 'var(--err)' } // 错 + 一键重试出口
  }
}

function JobBlock({ job }: { job: SessionView['jobs'][number] }): JSX.Element {
  return (
    <div style={{ borderBottom: '1px dashed var(--line)', padding: '6px 0' }}>
      <div style={{ fontSize: 13 }}>「{job.orderText}」</div>
      {job.stages && (
        <ol style={{ margin: '4px 0 4px 18px', padding: 0, fontSize: 12, color: 'var(--fg-dim)' }}>
          {job.stages.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
      {job.rows.map((r) => (
        <div key={r.callId} style={{ fontSize: 12, margin: '3px 0', display: 'flex', gap: 6 }}>
          <span style={{ color: r.ok ? 'var(--ok)' : 'var(--err)' }}>{r.ok ? '✓' : '✗'}</span>
          <span style={{ fontFamily: 'monospace' }}>{r.tool}</span>
          {r.detail?.cells !== undefined && <span style={{ color: 'var(--mute)' }}>{r.detail.cells} 格</span>}
          {r.detail?.reverted === true && <span style={{ color: 'var(--err)' }}>已回滚</span>}
          {r.detail?.outOfBounds !== undefined && r.detail.outOfBounds > 0 && <span style={{ color: 'var(--warn)' }}>{r.detail.outOfBounds} 格越界未放置</span>}
          {r.detail?.skipped !== undefined && r.detail.skipped > 0 && <span style={{ color: 'var(--mute)' }}>跳过 {r.detail.skipped}</span>}
          {r.detail?.undoDepth !== undefined && r.detail.undoDepth !== 0 && <span style={{ color: 'var(--mute)' }}>撤销深度 {r.detail.undoDepth}</span>}
        </div>
      ))}
      {job.outcome && (
        <div style={{ fontSize: 12, color: outcomeBadge(job.outcome.outcome).color }}>
          [{outcomeBadge(job.outcome.outcome).text}] {job.outcome.summary.slice(0, 120)}
        </div>
      )}
    </div>
  )
}

/** 会话块（AI 工作台正文）：折叠态只收本件；闸门卡不在此件内（§3.2 常显区）。 */
export function AiSession(props: {
  view: Pick<SessionView, 'jobs' | 'pendingGate' | 'allowAlways'> | null
  running: boolean
  roundsUsed: number
  error: string | null
  canRetry: boolean
  text: string
  setText: (t: string) => void
  send: () => void
}): JSX.Element {
  const { view, running, roundsUsed, error, canRetry, text, setText, send } = props
  const jobCount = view?.jobs.length ?? 0
  return (
    <>
      <div style={rowStyle}>
        <span style={{ color: 'var(--fg-mute)' }}>
          轮次 {roundsUsed}/{AI_LIMITS.roundBudget}
          {view?.allowAlways ? ' · 会话级放行中' : ''}
        </span>
        <span style={{ flex: 1 }} />
        <button
          title="导出会话日志（排查用；不含 API Key）"
          onClick={() => downloadSessionLog(getAiSession().log, getAiSession().getSettings())}
        >
          ⬇️ 日志
        </button>
        <button title="清空会话（模型与历史不动）" disabled={running} onClick={() => getAiSession().clearSession()}>
          ✨ 新会话
        </button>
      </div>
      <PhaseLine />
      <div style={{ maxHeight: 300, overflowY: 'auto' }}>
        {jobCount === 0 && <p className="note">还没有会话——输入一句话，例如「把屋顶改成红色」。</p>}
        {view?.jobs.map((job) => (
          <JobBlock key={job.jobId} job={job} />
        ))}
      </div>
      {error && <p style={{ color: 'var(--err)', fontSize: 12, margin: '4px 0' }}>{error}</p>}
      {canRetry && (
        <button style={{ width: '100%', marginBottom: 4 }} onClick={() => void getAiSession().retryLast()}>
          🔁 一键重试上一条指令
        </button>
      )}
      <div style={rowStyle}>
        <textarea
          style={{ ...inputStyle, minHeight: 44, resize: 'vertical' }}
          value={text}
          placeholder={running ? '任务进行中…（闸门待答时可先批准）' : '一句话改造模型，如：把屋顶改成红色'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send()
          }}
        />
      </div>
      <button style={{ width: '100%' }} disabled={running || text.trim() === ''} onClick={send}>
        ▶ 发送（Ctrl+Enter）
      </button>
    </>
  )
}
