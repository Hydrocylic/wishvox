// r05 · debug-261008 件一（红例）：**闸门到达时 UI store 不刷新** —— 须整页刷新才出现闸门卡。
//
// 判据（派工单 §3 红例）：「store 的 `view.pendingGate` 与会话日志 `log.view().pendingGate` 同源」，
// 且**全程不做任何手写 `pushView()`**（= 不整页刷新；`pushView` 只在 AgentSession 构造 / job 收口 /
// answerGate 时被调）。
//
// 覆盖两处闸门落点（两处都从 `loop.ts` 的 `broker.ask(...)` 出口过）：
//   ① 计划闸门 —— `loop.ts#handlePlan` 的 `broker.ask(jobId, 'plan', …)`（用户实报的那一处）
//   ② 工具闸门 —— `loop.ts#roundLoop` 的 `broker.ask(jobId, decision.scope, …)`
//
// 修复前（`HEAD = c2c5794`）：`broker.ask` → `gates.ts#askGate` **直写 `this.log`**，而
// `loop.ts#append`（L66–70）才是唯一调 `emit()` 的地方 ⇒ `onEvent` 不触发 ⇒
// `AgentSession.pushView()` 不被调 ⇒ store 的 `pendingGate` 停在 null（本文件首跑 = 2 红）。
import { describe, expect, it } from 'vitest'
import { AgentSession } from '../../src/ai/agent'
import { makeScriptedAdapter, roundStep } from '../../src/ai/scripted-provider'
import type { WireStep } from '../../src/ai/scripted-provider'
import type { SessionEvent } from '../../src/ai/session-log'
import { MemorySessionStore } from '../../src/ai/session-log'
import { Editor } from '../../src/edit/editor'
import { useAiUi } from '../../src/state/ai-store'

/** strict 档脚本：第一轮就落闸门；answer 后第二轮收口 */
function script(round1: WireStep): readonly WireStep[] {
  return [round1, roundStep({ text: '已按指令完成。' })]
}

/** 跑到"闸门已落日志"为止（**不做任何 pushView**），返回挂起的 sendOrder 与日志侧闸门 */
async function untilGate(session: AgentSession, order: string): Promise<{
  run: Promise<void>
  logPending: SessionEvent & { type: 'gateAsked' }
}> {
  const run = session.sendOrder(order)
  let settled = false
  void run.then(
    () => { settled = true },
    () => { settled = true },
  )
  let pending: (SessionEvent & { type: 'gateAsked' }) | null = null
  const deadline = Date.now() + 5_000
  while (!settled && pending === null && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 0))
    pending = session.log.view().pendingGate
  }
  if (pending === null) throw new Error('未在 5s 内到达闸门（用例前提不成立）')
  return { run, logPending: pending }
}

/** 读回（修复前的红例断言面；原始输出走 console.info） */
function readBack(session: AgentSession, logPending: SessionEvent & { type: 'gateAsked' }): Record<string, unknown> {
  const storeView = useAiUi.getState().view
  const storePending = storeView?.pendingGate ?? null
  return {
    会话日志事件序列: session.log.events.map((e) => e.type),
    '会话日志 pendingGate': logPending.gateId,
    '会话日志闸门 scope': logPending.scope,
    'UI store view 是否已种入': storeView !== null,
    'UI store pendingGate（面板渲染源）': storePending?.gateId ?? null,
    '同源（store === log 同一事件对象）': storePending === logPending,
  }
}

describe('件一 · 闸门到达时 UI store 与会话日志同源（不整页刷新）', () => {
  it('① 计划闸门（strict · update_plan）：store.view.pendingGate === log.view().pendingGate', async () => {
    const editor = new Editor()
    const { adapter } = makeScriptedAdapter(
      script(roundStep({ calls: [{ id: 'p1', name: 'update_plan', args: { stages: ['立树干', '铺树冠', '收口'] } }] })),
    )
    const session = new AgentSession(editor, { adapter, sessionStore: new MemorySessionStore(), sleep: async () => {} })
    session.setSettings({ oversight: 'strict' })

    const { run, logPending } = await untilGate(session, '造一棵树')
    await new Promise((r) => setTimeout(r, 0)) // 不再有任何 pushView；只让同步 emit 链落地
    const storePending = useAiUi.getState().view?.pendingGate ?? null
    console.info('[件一-① 计划闸门 · 不刷新读回] ' + JSON.stringify(readBack(session, logPending)))

    expect(logPending.scope).toBe('plan')
    expect(storePending, '闸门已落会话日志，但 UI store 的 pendingGate 仍为 null（须整页刷新）').not.toBeNull()
    expect(storePending?.gateId).toBe(logPending.gateId)
    expect(storePending).toBe(logPending)

    session.answerGate(logPending.gateId, 'skip') // 收口：skip 让挂起的 sendOrder 落地
    await run
    expect(session.log.events.some((e) => e.type === 'jobEnd')).toBe(true)
  })

  it('② 工具闸门（strict · 窄写 brush）：store.view.pendingGate === log.view().pendingGate', async () => {
    const editor = new Editor()
    const { adapter } = makeScriptedAdapter(
      script(roundStep({ calls: [{ id: 'c1', name: 'brush', args: { modifier: 'place', size_x: 1, size_y: 1, size_z: 1, key: 'color:red', anchors: [[9, 0, 9]] } }] })),
    )
    const session = new AgentSession(editor, { adapter, sessionStore: new MemorySessionStore(), sleep: async () => {} })
    session.setSettings({ oversight: 'strict' })

    const { run, logPending } = await untilGate(session, '在旁边放一块红砖')
    await new Promise((r) => setTimeout(r, 0))
    const storePending = useAiUi.getState().view?.pendingGate ?? null
    console.info('[件一-② 工具闸门 · 不刷新读回] ' + JSON.stringify(readBack(session, logPending)))

    expect(logPending.scope).toBe('tool')
    expect(storePending, '闸门已落会话日志，但 UI store 的 pendingGate 仍为 null（须整页刷新）').not.toBeNull()
    expect(storePending?.gateId).toBe(logPending.gateId)
    expect(storePending).toBe(logPending)

    session.answerGate(logPending.gateId, 'skip')
    await run
    expect(session.log.events.some((e) => e.type === 'jobEnd')).toBe(true)
  })
})
