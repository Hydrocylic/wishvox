// r03 · T2/N6 会话事件日志（L1）：追加式事件 = 唯一会话状态——重放 = 视图重建（摘要相等）、
// 持久化恢复（含坏尾巴截断）、结构校验（①-36 validate-log）、未答闸门跨刷新保持与作废。
import { describe, expect, it } from 'vitest'
import { MemorySessionStore, SessionLog, replayView, validateLog } from '../../src/ai/session-log'
import type { SessionEvent } from '../../src/ai/session-log'

function miniSnapshot(): import('../../src/ai/view').OrderSnapshot {
  return { nonEmpty: 0, bounds: null, perLayer: [], palette: [], usedColors: [], partsCount: 0, compositionsCount: 0, selectedPartId: null, selectedCompositionId: null }
}

describe('N6 · 会话日志：追加 / 编号 / 持久化', () => {
  it('append 派生 seq / ts / jobId；同一 store 重建 ⇒ 事件逐条相等', () => {
    const store = new MemorySessionStore()
    const a = new SessionLog(store)
    a.append({ type: 'order', text: '把屋顶改红', snapshot: miniSnapshot() })
    a.append({ type: 'plan', stages: ['看模型', '换色', '复查'], attempt: 1 })
    a.append({ type: 'gateAsked', gateId: 'gate-1', scope: 'tool', callId: 'call-1', tool: 'recolor', summary: '换色' })
    a.append({ type: 'gateAnswered', gateId: 'gate-1', answer: 'allow' })
    a.append({ type: 'toolCall', callId: 'call-1', tool: 'recolor', args: {}, wide: false })
    a.append({ type: 'toolResult', callId: 'call-1', ok: true, content: '改了 5 格' })
    a.append({ type: 'jobEnd', outcome: 'done', summary: '完成' })

    const b = new SessionLog(store) // "刷新"
    expect(b.events).toEqual(a.events)
    expect(b.view()).toEqual(a.view()) // 重放 = 视图重建（N6 判据）
  })

  it('编号从既有事件派生：gate-2 / call-2 / job-2（刷新后不重号）', () => {
    const store = new MemorySessionStore()
    const a = new SessionLog(store)
    a.append({ type: 'order', text: '一', snapshot: miniSnapshot() })
    expect(a.nextGateId()).toBe('gate-1')
    expect(a.nextCallId()).toBe('call-1')
    a.append({ type: 'gateAsked', gateId: 'gate-1', scope: 'tool', callId: null, summary: 's' })
    a.append({ type: 'toolCall', callId: 'call-1', tool: 'undo', args: {}, wide: true })
    a.append({ type: 'jobEnd', outcome: 'done', summary: '' })
    const b = new SessionLog(store)
    expect(b.nextGateId()).toBe('gate-2')
    expect(b.nextCallId()).toBe('call-2')
    expect(b.nextJobNum()).toBe(2)
  })

  it('坏 JSON 尾巴 ⇒ 截断到最后一个合法前缀（容错不崩）', () => {
    const store = new MemorySessionStore()
    const good = new SessionLog(store)
    good.append({ type: 'order', text: 'ok', snapshot: miniSnapshot() })
    good.append({ type: 'jobEnd', outcome: 'done', summary: '' })
    // 合法 JSON 数组内混入结构坏元素（部分写 / 手改的形态）⇒ 截断到最后一个合法前缀
    const raw = store.load()!
    const events = JSON.parse(raw) as unknown[]
    events.push({ type: 'order' }) // 缺 seq / jobId / text 等必要字段
    store.save(JSON.stringify(events))
    const restored = new SessionLog(store)
    expect(restored.events).toHaveLength(2)
    expect(restored.events[1]!.type).toBe('jobEnd')
    expect(restored.events[0]!.type).toBe('order')
  })
})

describe('N6 · validate-log（结构 / 顺序校验，①-36）', () => {
  it('合法序列通过；序号断裂 / 孤儿 gateAnswered / 孤儿 toolResult / 双开 job 各自被抓', () => {
    const ok: SessionEvent[] = [
      { seq: 0, ts: 1, jobId: 'job-1', type: 'order', text: 'a', snapshot: miniSnapshot() },
      { seq: 1, ts: 2, jobId: 'job-1', type: 'gateAsked', gateId: 'gate-1', scope: 'tool', callId: 'call-1', summary: 's' },
      { seq: 2, ts: 3, jobId: 'job-1', type: 'gateAnswered', gateId: 'gate-1', answer: 'allow' },
      { seq: 3, ts: 4, jobId: 'job-1', type: 'toolCall', callId: 'call-1', tool: 'recolor', args: {}, wide: false },
      { seq: 4, ts: 5, jobId: 'job-1', type: 'toolResult', callId: 'call-1', ok: true, content: '' },
      { seq: 5, ts: 6, jobId: 'job-1', type: 'jobEnd', outcome: 'done', summary: '' },
    ]
    expect(validateLog(ok)).toEqual({ ok: true })

    const badSeq = [...ok]
    badSeq[3] = { ...ok[3]!, seq: 9 }
    expect(validateLog(badSeq).ok).toBe(false)

    const orphanAnswer = [...ok.slice(0, 1), { seq: 1, ts: 2, jobId: 'job-1', type: 'gateAnswered', gateId: 'gate-9', answer: 'allow' } as SessionEvent]
    expect(validateLog(orphanAnswer).ok).toBe(false)

    const orphanResult = [...ok.slice(0, 1), { seq: 1, ts: 2, jobId: 'job-1', type: 'toolResult', callId: 'call-9', ok: true, content: '' } as SessionEvent]
    expect(validateLog(orphanResult).ok).toBe(false)

    const doubleOpen = [...ok.slice(0, 5), { seq: 5, ts: 6, jobId: 'job-2', type: 'order', text: 'b', snapshot: miniSnapshot() } as SessionEvent]
    expect(validateLog(doubleOpen).ok).toBe(false)
  })
})

describe('N6 · replayView：视图重建 / 未答闸门 / 作废', () => {
  it('未答闸门在视图里挂着；order / jobEnd / incident 使其作废（口径卡 §二）', () => {
    const store = new MemorySessionStore()
    const log = new SessionLog(store)
    log.append({ type: 'order', text: 'a', snapshot: miniSnapshot() })
    log.append({ type: 'toolCall', callId: 'call-1', tool: 'clear_scope', args: {}, wide: true })
    log.append({ type: 'gateAsked', gateId: 'gate-1', scope: 'tool', callId: 'call-1', summary: '清空' })
    expect(log.view().pendingGate?.gateId).toBe('gate-1')
    // "刷新"重建 ⇒ 闸门仍在（重入而非重问的地基）
    expect(new SessionLog(store).view().pendingGate?.gateId).toBe('gate-1')
    // 新 order ⇒ 作废
    log.append({ type: 'jobEnd', outcome: 'aborted', summary: '用户插话' })
    expect(log.view().pendingGate).toBeNull()
  })

  it('gateAnswered=allow-always ⇒ 会话级放行标记', () => {
    const log = new SessionLog(new MemorySessionStore())
    log.append({ type: 'order', text: 'a', snapshot: miniSnapshot() })
    log.append({ type: 'gateAsked', gateId: 'gate-1', scope: 'tool', callId: 'call-1', summary: 's' })
    log.append({ type: 'gateAnswered', gateId: 'gate-1', answer: 'allow-always' })
    expect(log.view().allowAlways).toBe(true)
  })

  it('视图：jobs（order / plan / rows / outcome）与实时一致；skip 的调用不产生 row', () => {
    const log = new SessionLog(new MemorySessionStore())
    log.append({ type: 'order', text: '做旧', snapshot: miniSnapshot() })
    log.append({ type: 'plan', stages: ['噪声', '抹角', '抬升'], attempt: 1 })
    log.append({ type: 'toolCall', callId: 'call-1', tool: 'recolor', args: {}, wide: false })
    log.append({ type: 'toolResult', callId: 'call-1', ok: true, content: 'ok', detail: { cells: 5 } })
    // call-2 被 skip：有 toolCall、无 toolResult ⇒ 无 row（N7 面板面）
    log.append({ type: 'toolCall', callId: 'call-2', tool: 'clear_scope', args: {}, wide: true })
    log.append({ type: 'gateAsked', gateId: 'gate-1', scope: 'tool', callId: 'call-2', summary: '清空' })
    log.append({ type: 'gateAnswered', gateId: 'gate-1', answer: 'skip' })
    log.append({ type: 'jobEnd', outcome: 'done', summary: '完成' })
    const view = log.view()
    expect(view.jobs).toHaveLength(1)
    expect(view.jobs[0]!.stages).toEqual(['噪声', '抹角', '抬升'])
    expect(view.jobs[0]!.rows).toHaveLength(1)
    expect(view.jobs[0]!.rows[0]!.tool).toBe('recolor')
    expect(view.jobs[0]!.outcome?.outcome).toBe('done')
    // replayView 是纯函数：同一事件序列重建两次相等
    expect(replayView(log.events)).toEqual(view)
  })

  it('轮次 / 计划落档 / 可重试 incident 的读数（治理最小面从日志读）', () => {
    const log = new SessionLog(new MemorySessionStore())
    log.append({ type: 'order', text: 'a', snapshot: miniSnapshot() })
    log.append({ type: 'usage', round: 1, roundsLeft: 23 })
    log.append({ type: 'usage', round: 2, roundsLeft: 22 })
    log.append({ type: 'incident', errorClass: 'retryable', message: '5xx', retryable: true })
    log.append({ type: 'plan', stages: ['a', 'b', 'c'], attempt: 1 })
    const jobId = log.currentJobId()!
    expect(log.roundsUsed(jobId)).toBe(2)
    expect(log.retryableIncidents(jobId)).toBe(1)
    expect(log.planCommits(jobId)).toBe(1)
  })
})
