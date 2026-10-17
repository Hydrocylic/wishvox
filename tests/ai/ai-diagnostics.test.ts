// r04 T8（§4 可诊断性三件）：件三 会话导出 / 件二 相位序列 / 件一 线级状态——各 1 例。
// 纯增量：不动既有断言（证据作废域 = 三个新字段 / 两个新文件 / 一个按钮 + 3 个新用例）。
import { describe, expect, it } from 'vitest'
import { GateBroker } from '../../src/ai/gates'
import { AgentLoop } from '../../src/ai/loop'
import { OpenAiCompatAdapter, chatWithRetry } from '../../src/ai/provider'
import { makeScriptedAdapter, makeScriptedFetch, roundStep } from '../../src/ai/scripted-provider'
import { MemorySessionStore, SessionLog, validateLog } from '../../src/ai/session-log'
import type { SessionEvent } from '../../src/ai/session-log'
import { DEFAULT_AI_SETTINGS } from '../../src/ai/settings'
import { buildSnapshot } from '../../src/ai/view'
import { Editor } from '../../src/edit/editor'
import { SESSION_FORMAT, sessionExportText } from '../../src/io/export-log'
import { setUi } from '../../src/state/editor-store'

function emptyEditor(): Editor {
  const editor = new Editor()
  setUi({ mode: 'edit' })
  return editor
}

describe('T8 · 件三 卡死可导出会话事件（io/export-log）', () => {
  it('信封含 gate / toolResult；validateLog 通过；串内不含 apiKey（红线）', () => {
    const log = new SessionLog(new MemorySessionStore())
    log.append({ type: 'order', jobId: 'job-1', text: '把屋顶改红', snapshot: buildSnapshot(emptyEditor()) })
    log.append({ type: 'gateAsked', jobId: 'job-1', gateId: 'gate-1', scope: 'tool', callId: 'call-1', tool: 'recolor', summary: '换色' })
    log.append({ type: 'gateAnswered', jobId: 'job-1', gateId: 'gate-1', answer: 'allow' })
    log.append({ type: 'toolCall', jobId: 'job-1', callId: 'call-1', tool: 'recolor', args: {}, wide: false })
    log.append({ type: 'toolResult', jobId: 'job-1', callId: 'call-1', ok: true, content: '改了 5 格' })
    log.append({ type: 'jobEnd', jobId: 'job-1', outcome: 'done', summary: '完成' })

    const apiKey = 'sk-red-line-DO-NOT-EXPORT-9f3a'
    const settings = { ...DEFAULT_AI_SETTINGS, apiKey, baseUrl: 'https://api.example.com', model: 'test-model' }
    const text = sessionExportText(log, settings, new Date('2026-10-07T00:00:00.000Z'))
    expect(text.includes(apiKey)).toBe(false) // 红线：宁红不放行

    const parsed = JSON.parse(text) as {
      format: string
      version: number
      exportedAt: string
      appVersion: string
      settings: Record<string, unknown>
      events: SessionEvent[]
    }
    expect(parsed.format).toBe(SESSION_FORMAT)
    expect(parsed.version).toBe(1)
    expect(parsed.exportedAt).toBe('2026-10-07T00:00:00.000Z')
    expect(typeof parsed.appVersion).toBe('string')
    expect(parsed.settings.apiKey).toBeUndefined()
    expect(parsed.settings.baseUrl).toBe('https://api.example.com')
    expect(validateLog(parsed.events)).toEqual({ ok: true })
    const types = parsed.events.map((e) => e.type)
    expect(types).toContain('gateAsked')
    expect(types).toContain('toolResult')
  })
})

describe('T8 · 件二 当前步骤可见（ai/loop onPhase）', () => {
  it('相位序列 = awaiting-provider → awaiting-gate → executing-tool → awaiting-provider', async () => {
    const editor = emptyEditor()
    const log = new SessionLog(new MemorySessionStore())
    const broker = new GateBroker(log)
    const { adapter } = makeScriptedAdapter([
      roundStep({ calls: [{ id: 'c1', name: 'brush', args: { modifier: 'place', size_x: 1, size_y: 1, size_z: 1, key: 'color:red', anchors: [[9, 0, 9]] } }] }),
      roundStep({ text: '完成。' }),
    ])
    const phases: string[] = []
    const loop = new AgentLoop(editor, log, broker, adapter, { sleep: async () => {}, onPhase: (p) => phases.push(p.kind) })
    const run = loop.runJob('在旁边放一块红砖', { oversight: 'strict', language: 'zh' })
    let settled = false
    void run.then(() => { settled = true }, () => { settled = true })
    while (!settled) {
      await new Promise((r) => setTimeout(r, 0))
      const pending = log.view().pendingGate
      if (pending) broker.answer(pending.gateId, 'allow')
    }
    await run
    expect(phases).toEqual(['awaiting-provider', 'awaiting-gate', 'executing-tool', 'awaiting-provider'])
    expect(log.view().jobs[0]?.rows[0]?.ok).toBe(true)
  })
})

describe('T8 · 件一 连接 / 请求状态可见（provider onWireState）', () => {
  it('线级序列：connecting →（5xx）retrying → 空闲/流式翻转 → done', async () => {
    const phases: string[] = []
    const adapter = new OpenAiCompatAdapter({
      baseUrl: 'http://scripted.local',
      apiKey: 'k',
      model: 'm',
      fetchImpl: makeScriptedFetch([{ status: 500 }, roundStep({ text: 'ok' })]),
      onWireState: (s) => phases.push(s.phase),
    })
    const outcome = await chatWithRetry(
      adapter,
      { messages: [{ role: 'user', content: 'hi' }], tools: [] },
      { sleep: async () => {}, random: () => 1, onWireState: (s) => phases.push(s.phase) },
    )
    expect(outcome.result?.text).toBe('ok')
    expect(outcome.attempts).toBe(2)
    expect(phases[0]).toBe('connecting')
    expect(phases[phases.length - 1]).toBe('done')
    expect(phases.filter((p) => p === 'retrying')).toHaveLength(1) // 重试梯每级上报
    const i = phases.indexOf('idle-wait')
    expect(i).toBeGreaterThan(-1)
    expect(phases[i + 1]).toBe('streaming') // 首字节到达 ⇒ idle-wait → streaming 翻转
  })
})
