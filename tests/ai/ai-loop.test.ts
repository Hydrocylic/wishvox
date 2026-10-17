// r03 · T4/T9 会话循环（L4 脚本化重放）：
// V1 主链路对拍三句（AI 终态 = 人手同一串操作 逐块相等 + 每写调用恰 1 条补丁）·
// V3 闸门 12 格矩阵（3 档 × wide/narrow × 计划闸门开/关，每格 1 例事件对账）+ callApproved 2 例 ·
// V4 续跑（未答闸门重入而非重问）· 轮预算 24 / 剩 3 警告 / capped · 半截重发 · 一键重试。
import { describe, expect, it } from 'vitest'
import { AgentSession } from '../../src/ai/agent'
import type { GateAnswer } from '../../src/ai/session-log'
import { MemorySessionStore } from '../../src/ai/session-log'
import type { SessionEvent } from '../../src/ai/session-log'
import { compactMessages, deriveMessages, systemPromptOf } from '../../src/ai/messages'
import { MemorySessionStore as MemStore } from '../../src/ai/session-log'
import { halfJsonStep, makeScriptedAdapter, roundStep } from '../../src/ai/scripted-provider'
import type { WireStep } from '../../src/ai/scripted-provider'
import type { ProgramOp } from '../../src/core/types'
import { Editor } from '../../src/edit/editor'
import { applyProgramOp } from '../../src/ops/apply'
import { setUi } from '../../src/state/editor-store'

/** 房子夹具（与 ai-executor.test.ts 同型；组合「屋顶」= comp-1 = 屋顶 part-2 + 手工烟囱） */
function house(): Editor {
  const editor = new Editor()
  setUi({ mode: 'edit' })
  const k = (i: string): number => editor.volume.palette.list().find((e) => e.identity === i)!.key
  const wall = applyProgramOp(editor.log, 
    { type: 'program', name: 'presetShape', params: { shape: 'box', origin: { x: 0, y: 0, z: 0 }, size: { x: 6, y: 4, z: 6 }, key: k('color:red-brick'), hollow: true } },
    editor.compositions,
  )!
  editor.renamePart(wall.partId!, '墙体')
  const roof = applyProgramOp(editor.log, 
    { type: 'program', name: 'presetShape', params: { shape: 'box', origin: { x: -1, y: 4, z: -1 }, size: { x: 8, y: 1, z: 8 }, key: k('color:blue') } },
    editor.compositions,
  )!
  editor.renamePart(roof.partId!, '屋顶')
  setUi({ currentIdentity: 'color:dark-gray' })
  editor.place(5, 5, 5)
  setUi({ currentIdentity: 'color:red' })
  const comp = editor.compositions.create('屋顶')
  editor.compositions.addPart(comp.id, roof.partId!)
  editor.compositions.addManualBlock(comp.id, 5, 5, 5)
  return editor
}

function blocksOf(editor: Editor): string[] {
  return [...editor.volume.iterBlocks()].map((b) => `${b.x},${b.y},${b.z}=${b.key}`).sort()
}

interface Harness {
  editor: Editor
  session: AgentSession
  store: MemorySessionStore
}

function makeHarness(script: readonly WireStep[], oversight: 'strict' | 'checkpoint' | 'yolo' = 'strict'): Harness {
  const editor = house()
  const store = new MemorySessionStore()
  const { adapter } = makeScriptedAdapter(script)
  const session = new AgentSession(editor, {
    adapter,
    sessionStore: store,
    sleep: async () => {}, // 测试：重试梯零等待
  })
  session.setSettings({ oversight })
  return { editor, session, store }
}

/** 驱动：runJob 挂起等闸时轮询作答（模拟用户点「批准」）；macrotask 泵让微任务全跑完 */
async function drive(promise: Promise<unknown>, h: Harness, answer: GateAnswer | (() => GateAnswer) = 'allow'): Promise<void> {
  let settled = false
  void promise.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    },
  )
  while (!settled) {
    await new Promise((r) => setTimeout(r, 0))
    const pending = h.session.log.view().pendingGate
    if (pending) h.session.answerGate(pending.gateId, typeof answer === 'function' ? answer() : answer)
  }
  await promise
}

/** N7 对账断言：gateAnswered ≠ allow ⇒ 该调用无 toolResult（V3 通用判据） */
function assertGateAudit(events: readonly SessionEvent[]): void {
  const answered = new Map<string, GateAnswer>()
  const callsOfGate = new Map<string, string | null>()
  for (const e of events) {
    if (e.type === 'gateAnswered') answered.set(e.gateId, e.answer)
    if (e.type === 'gateAsked') callsOfGate.set(e.gateId, e.callId)
  }
  const executed = new Set(events.filter((e) => e.type === 'toolResult').map((e) => (e.type === 'toolResult' ? e.callId : '')))
  for (const [gateId, ans] of answered) {
    const callId = callsOfGate.get(gateId)
    if (ans !== 'allow' && ans !== 'allow-always' && callId !== null) {
      expect(executed.has(callId ?? ''), `N7：闸门 ${gateId} 答案 ${ans} ⇒ 不得有 toolResult(${callId})`).toBe(false)
    }
  }
}

const PLAN_STAGES = { stages: ['观察模型', '换屋顶材质', '复查收尾'] }
const FINAL_TEXT = { text: '已按要求完成。' }

describe('V3 · 闸门矩阵（3 档 × wide/narrow × 计划闸门开/关 = 12 格，每格 1 例事件对账）', () => {
  const matrix: Array<{ oversight: 'strict' | 'checkpoint' | 'yolo'; wide: boolean; plan: boolean }> = []
  for (const o of ['strict', 'checkpoint', 'yolo'] as const) {
    for (const wide of [false, true]) {
      for (const plan of [false, true]) matrix.push({ oversight: o, wide, plan })
    }
  }

  for (const cell of matrix) {
    const wideName = cell.wide ? 'wide' : 'narrow'
    const planName = cell.plan ? '带计划' : '无计划'
    it(`${cell.oversight} · ${wideName} 写 · ${planName}`, async () => {
      const writeCall = cell.wide
        ? { id: 'c-w', name: 'clear_scope', args: { target_kind: 'manual' } } // 静态 wide
        : { id: 'c-w', name: 'brush', args: { modifier: 'place', size_x: 1, size_y: 1, size_z: 1, key: 'color:red', anchors: [[9, 0, 9]] } } // 窄写
      const round1 = cell.plan
        ? { calls: [{ id: 'c-p', name: 'update_plan', args: PLAN_STAGES }, writeCall] }
        : { calls: [writeCall] }
      const h = makeHarness([{ ...roundStepSafe(round1) }, roundStep(FINAL_TEXT)], cell.oversight)
      await drive(h.session.sendOrder('测试句'), h)
      const events = h.session.log.events
      assertGateAudit(events)

      // 写工具闸门期望：strict ⇒ 闸；checkpoint ⇒ 只闸 wide；yolo ⇒ 不闸
      const toolGates = events.filter((e) => e.type === 'gateAsked' && e.scope === 'tool')
      const expectWriteGate = cell.oversight === 'strict' || (cell.oversight === 'checkpoint' && cell.wide)
      expect(toolGates, `${cell.oversight}/${wideName} 写工具闸门数`).toHaveLength(expectWriteGate ? 1 : 0)
      // 写执行结果必在（allow 自动作答）
      const writeResult = events.find((e) => e.type === 'toolResult' && e.callId === 'call-3' || (e.type === 'toolResult' && events.some((c) => c.type === 'toolCall' && c.callId === (e as { callId: string }).callId && c.tool === writeCall.name)))
      expect(writeResult, `${cell.oversight}/${wideName} 写调用应有回执`).toBeDefined()
      // 计划闸门与 plan 事件
      const planGates = events.filter((e) => e.type === 'gateAsked' && e.scope === 'plan')
      const planEvents = events.filter((e) => e.type === 'plan')
      if (!cell.plan) {
        expect(planEvents).toHaveLength(0)
        expect(planGates).toHaveLength(0)
      } else if (cell.oversight === 'yolo') {
        expect(planEvents).toHaveLength(1)
        expect(planGates).toHaveLength(0) // yolo：计划免闸直接落档
      } else {
        expect(planEvents).toHaveLength(1)
        expect(planGates).toHaveLength(1) // strict / checkpoint：计划也要批
      }
      // job 正常收口
      const view = h.session.log.view()
      expect(view.jobs[0]!.outcome?.outcome).toBe('done')
    })
  }

  it('callApproved 例 a：allow-always 之后的下一写调用免闸（provenance = 放行而非批准）', async () => {
    const h = makeHarness([
      roundStep({ calls: [{ id: 'c1', name: 'brush', args: { modifier: 'place', size_x: 1, size_y: 1, size_z: 1, key: 'color:red', anchors: [[9, 0, 9]] } }] }),
      roundStep({ calls: [{ id: 'c2', name: 'brush', args: { modifier: 'place', size_x: 1, size_y: 1, size_z: 1, key: 'color:red', anchors: [[10, 0, 9]] } }] }),
      roundStep(FINAL_TEXT),
    ], 'strict')
    let first = true
    await drive(h.session.sendOrder('放两块'), h, () => {
      if (first) {
        first = false
        return 'allow-always'
      }
      throw new Error('第二笔不应再问闸（allow-always 已放行）')
    })
    const events = h.session.log.events
    expect(events.filter((e) => e.type === 'gateAsked')).toHaveLength(1) // 只问了一次
    const toolResults = events.filter((e) => e.type === 'toolResult' && e.ok)
    expect(toolResults.length).toBeGreaterThanOrEqual(2) // 两笔都执行了
    // 第二笔的 toolCall 没有对应闸门 ⇒ 放行（非批准）
    const secondCall = events.filter((e) => e.type === 'toolCall')[1]!
    const hasGate = events.some((e) => e.type === 'gateAsked' && e.callId === secondCall.callId)
    expect(hasGate).toBe(false)
    expect(h.session.log.view().allowAlways).toBe(true)
  })

  it('callApproved 例 b：skip ⇒ 无 toolResult（N7 同型）+ 模型下一轮继续', async () => {
    const h = makeHarness([
      roundStep({ calls: [{ id: 'c1', name: 'brush', args: { modifier: 'place', size_x: 1, size_y: 1, size_z: 1, key: 'color:red', anchors: [[9, 0, 9]] } }] }),
      roundStep(FINAL_TEXT),
    ], 'strict')
    await drive(h.session.sendOrder('放一块'), h, 'skip')
    const events = h.session.log.events
    const skippedCall = events.find((e) => e.type === 'toolCall')!
    const hasResult = events.some((e) => e.type === 'toolResult' && e.callId === skippedCall.callId)
    expect(hasResult).toBe(false) // skip ⇒ 未执行、无回执
    expect(h.editor.volume.getBlock(9, 0, 9)).toBe(0) // 真的没写
    assertGateAudit(events)
    expect(h.session.log.view().jobs[0]!.outcome?.outcome).toBe('done') // 会话仍正常收口
  })
})

function roundStepSafe(r: { calls: ReadonlyArray<{ id: string; name: string; args: Record<string, unknown> }> }): WireStep {
  return roundStep({ calls: r.calls.map((c) => ({ ...c })) })
}

describe('V1 · 主链路对拍三句（L4：脚本化 adapter 重放 = 人手同一串操作 逐块相等）', () => {
  it('句① 单步收束「把屋顶改成红色」：recolor + 组合宾语', async () => {
    const script: WireStep[] = [
      roundStep({ calls: [{ id: 'r1', name: 'list_compositions', args: {} }] }), // 先观察
      roundStep({
        calls: [
          { id: 'w1', name: 'recolor', args: { target_kind: 'composition', target_id: 'comp-1', to: 'color:red', from: ['color:blue', 'color:dark-gray'] } },
        ],
      }),
      roundStep({ text: '屋顶已改红。' }),
    ]
    const h = makeHarness(script, 'strict')
    const patchesBefore = h.editor.log.patches.length
    await drive(h.session.sendOrder('把屋顶改成红色'), h)
    // 人手对拍：同一 ProgramOp
    const manual = house()
    applyProgramOp(manual.log, 
      { type: 'program', name: 'recolor', params: { scope: { kind: 'composition', compositionId: 'comp-1' }, toKey: manual.volume.palette.list().find((e) => e.identity === 'color:red')!.key, fromKeys: [manual.volume.palette.list().find((e) => e.identity === 'color:blue')!.key, manual.volume.palette.list().find((e) => e.identity === 'color:dark-gray')!.key] } },
      manual.compositions,
    )
    expect(blocksOf(h.editor)).toEqual(blocksOf(manual)) // 逐块相等
    expect(h.editor.log.patches.length).toBe(patchesBefore + 1) // 恰好 1 条补丁（undo 深度 = 1）
    h.editor.undo() // 一次撤销 ⇒ 回到改红前
    const virgin = house()
    expect(blocksOf(h.editor)).toEqual(blocksOf(virgin))
  })

  it('句② 单步扩张「在旁边放一个 8×8×8 的空心红盒」：preset_shape', async () => {
    const h = makeHarness([
      roundStep({ calls: [{ id: 'w1', name: 'preset_shape', args: { shape: 'box', origin_x: 8, origin_y: 0, origin_z: 8, size_x: 8, size_y: 8, size_z: 8, key: 'color:red', hollow: true } }] }),
      roundStep({ text: '红盒已放好。' }),
    ], 'strict')
    const patchesBefore = h.editor.log.patches.length
    await drive(h.session.sendOrder('在旁边放一个 8×8×8 的空心红盒'), h)
    const manual = house()
    applyProgramOp(manual.log, 
      { type: 'program', name: 'presetShape', params: { shape: 'box', origin: { x: 8, y: 0, z: 8 }, size: { x: 8, y: 8, z: 8 }, key: manual.volume.palette.list().find((e) => e.identity === 'color:red')!.key, hollow: true } },
      manual.compositions,
    )
    expect(blocksOf(h.editor)).toEqual(blocksOf(manual))
    expect(h.editor.log.patches.length).toBe(patchesBefore + 1)
  })

  it('句③ 多步拆解「把这栋房子做旧」：计划闸门 + 噪声雕塑 → 抹角 → 抬两层 连续执行', async () => {
    const sculptArgs = { target_kind: 'all', amplitude: 2, density: 0.6, seed: 7, px: true, nx: true, py: true, ny: false, pz: true, nz: true, key: 'color:dark-gray' }
    const bevelArgs = { target_kind: 'all', radius: 1, passes: 1 }
    const raiseArgs = { target_kind: 'all', layers: 2 }
    const h = makeHarness([
      roundStep({ calls: [{ id: 'p1', name: 'update_plan', args: { stages: ['噪声做旧表面', '抹角修边', '整体抬两层'] } }] }),
      roundStep({ calls: [
        { id: 'w1', name: 'noise_sculpt', args: sculptArgs },
        { id: 'w2', name: 'bevel_edges', args: bevelArgs },
        { id: 'w3', name: 'raise_layers', args: raiseArgs },
      ] }),
      roundStep({ text: '做旧完成：雕塑、抹角、抬升都已应用。' }),
    ], 'strict')
    const patchesBefore = h.editor.log.patches.length
    await drive(h.session.sendOrder('把这栋房子做旧：噪声雕塑 + 抹角 + 抬两层'), h)
    // 计划事件在（计划闸门被批准）
    expect(h.session.log.events.filter((e) => e.type === 'plan')).toHaveLength(1)
    // 人手对拍：同一串 ProgramOp
    const manual = house()
    const kM = (i: string): number => manual.volume.palette.list().find((e) => e.identity === i)!.key
    const ops: ProgramOp[] = [
      { type: 'program', name: 'noiseSculpt', params: { scope: { kind: 'all' }, amplitude: 2, density: 0.6, seed: 7, dirs: { px: true, nx: true, py: true, ny: false, pz: true, nz: true }, key: kM('color:dark-gray') } },
      { type: 'program', name: 'bevelEdges', params: { scope: { kind: 'all' }, radius: 1, passes: 1 } },
      { type: 'program', name: 'raiseByLayers', params: { scope: { kind: 'all' }, layers: 2 } },
    ]
    for (const op of ops) applyProgramOp(manual.log, op, manual.compositions)
    expect(blocksOf(h.editor)).toEqual(blocksOf(manual))
    expect(h.editor.log.patches.length).toBe(patchesBefore + 3) // 三个写 = 三条补丁
    assertGateAudit(h.session.log.events)
  })
})

describe('V4 · 续跑（刷新后未答闸门重入而非重问）', () => {
  it('挂起的 wide 闸门跨"刷新"：重入执行 + 会话视图重建一致', async () => {
    const store = new MemorySessionStore()
    const editorA = house()
    const { adapter } = makeScriptedAdapter([
      roundStep({ calls: [{ id: 'w1', name: 'brush', args: { modifier: 'place', size_x: 1, size_y: 1, size_z: 1, key: 'color:red', anchors: [[9, 0, 9]] } }] }),
      roundStep({ text: '完成。' }),
    ])
    const s1 = new AgentSession(editorA, { adapter, sessionStore: store, sleep: async () => {} })
    s1.setSettings({ oversight: 'strict' })
    const p = s1.sendOrder('在旁边放一块红砖')
    await new Promise((r) => setTimeout(r, 2)) // 等第一轮跑完、闸门挂起
    const pending = s1.log.view().pendingGate
    expect(pending).not.toBeNull() // 闸门真的挂着（job 未收口）
    expect(s1.log.currentJobId()).not.toBeNull()
    const viewBefore = s1.log.view()

    // ── "刷新"：同 editor、同 store，新 AgentSession（模拟重载后重建） ──
    const s2 = new AgentSession(editorA, { adapter, sessionStore: store, sleep: async () => {} })
    s2.setSettings({ oversight: 'strict' })
    expect(s2.log.events).toEqual(s1.log.events) // 日志恢复
    expect(s2.log.view().pendingGate?.gateId).toBe(pending!.gateId) // 重入同一闸门，不重问
    expect(s2.log.view()).toEqual(viewBefore) // 视图重建一致（N6）

    // 答闸（重入后的会话上答）⇒ 执行 + 会话继续到收口
    s2.answerGate(pending!.gateId, 'allow')
    await drive(s2.resumeIfPending(), { editor: editorA, session: s2, store })
    expect(editorA.volume.getBlock(9, 0, 9)).not.toBe(0) // 挂起的那笔真的执行了
    expect(s2.log.view().jobs[0]!.outcome?.outcome).toBe('done')
    expect(s2.log.events.filter((e) => e.type === 'gateAsked')).toHaveLength(1) // 没有重问
    // 旧会话 s1 的 promise 永不 settle——现实中整个 JS 上下文随刷新销毁，这里只挂 catch 防未处理拒绝、
    // **不可 await**（await 会把测试挂死；V4 实测教训之一）。
    void p.catch(() => undefined)
  })
})

describe('T4 · 治理最小面（轮预算 24 / 剩 3 警告一次 / 到顶 capped）', () => {
  it('24 轮耗尽 ⇒ jobEnd=capped；剩 3 时警告恰好一次', async () => {
    const readRound = roundStep({ calls: [{ id: 'r', name: 'get_model_summary', args: {} }] })
    const h = makeHarness(Array.from({ length: 24 }, () => readRound), 'yolo')
    await drive(h.session.sendOrder('反复观察'), h)
    const events = h.session.log.events
    const usage = events.filter((e) => e.type === 'usage')
    expect(usage).toHaveLength(24)
    expect(usage.filter((e) => e.type === 'usage' && e.warned === true)).toHaveLength(1)
    const warned = usage.find((e) => e.type === 'usage' && e.warned === true) as Extract<SessionEvent, { type: 'usage' }>
    expect(warned.roundsLeft).toBe(3) // 剩 3 警告
    expect(h.session.log.view().jobs[0]!.outcome?.outcome).toBe('capped')
  })
})

describe('I5/V2 · 循环级容错（半截重发 / 5xx 降级 + 一键重试）', () => {
  it('半截 JSON 调用 ⇒ 不执行 + 回"请重发完整参数"；下一轮补发后成功', async () => {
    const h = makeHarness([
      halfJsonStep('c-bad', 'recolor', JSON.stringify({ target_kind: 'all', to: 'color:red' })),
      roundStep({ calls: [{ id: 'w1', name: 'recolor', args: { target_kind: 'composition', target_id: 'comp-1', to: 'color:red' } }] }),
      roundStep({ text: '补发完成。' }),
    ], 'yolo')
    await drive(h.session.sendOrder('把屋顶改红'), h)
    const events = h.session.log.events
    const badResult = events.find((e) => e.type === 'toolResult' && e.content.includes('不完整'))
    expect(badResult).toBeDefined()
    expect(events.some((e) => e.type === 'toolResult' && e.content.includes('recolor 完成'))).toBe(true)
  })

  it('连续 5xx ⇒ 重试梯耗尽 → incident + jobEnd=incident + 一键重试成功（REQ-011：不空手）', async () => {
    const h = makeHarness([
      { status: 500 }, { status: 500 }, { status: 500 }, { status: 500 }, { status: 500 },
    ], 'yolo')
    await drive(h.session.sendOrder('把屋顶改红'), h)
    const view = h.session.log.view()
    expect(view.jobs[0]!.outcome?.outcome).toBe('incident')
    expect(h.session.log.events.some((e) => e.type === 'incident' && e.errorClass === 'retryable')).toBe(true)
    expect(h.session.canRetry()).toBe(true)
    // 一键重试：同一句话重跑，换一个能成功的脚本（新 adapter）
    const { adapter: okAdapter } = makeScriptedAdapter([
      roundStep({ calls: [{ id: 'w1', name: 'recolor', args: { target_kind: 'composition', target_id: 'comp-1', to: 'color:red' } }] }),
      roundStep({ text: '这次成功了。' }),
    ])
    const s2 = new AgentSession(h.editor, { adapter: okAdapter, sessionStore: h.store, sleep: async () => {} })
    s2.setSettings({ oversight: 'yolo' })
    await drive(s2.retryLast(), { editor: h.editor, session: s2, store: h.store })
    expect(s2.log.view().jobs[s2.log.view().jobs.length - 1]!.outcome?.outcome).toBe('done')
    expect(s2.log.view().jobs).toHaveLength(2) // 原 incident job + 重试 job 都在账上
  })
})

describe('V9 · 行为回归集（≥5 条固定脚本重放：终态摘要相等 + 闸门事件序列符合预期）', () => {
  const cases: Array<{ name: string; makeScript: () => WireStep[]; oversight: 'strict' | 'checkpoint' | 'yolo'; expectGateCount: number }> = [
    {
      name: '①屋顶改红（recolor·组合宾语）',
      oversight: 'strict',
      expectGateCount: 1,
      makeScript: () => [
        roundStep({ calls: [{ id: 'w1', name: 'recolor', args: { target_kind: 'composition', target_id: 'comp-1', to: 'color:red' } }] }),
        roundStep({ text: '完成。' }),
      ],
    },
    {
      name: '②空心红盒（preset_shape）',
      oversight: 'checkpoint', // 动态 wide（512 格 > 1024? 8³=512 hollow≈<512…静态不 wide；此处验证 checkpoint 窄写自动跑）
      expectGateCount: 0,
      makeScript: () => [
        roundStep({ calls: [{ id: 'w1', name: 'preset_shape', args: { shape: 'box', origin_x: 8, origin_y: 0, origin_z: 8, size_x: 4, size_y: 4, size_z: 4, key: 'color:red', hollow: true } }] }),
        roundStep({ text: '完成。' }),
      ],
    },
    {
      name: '③做旧三步（计划+雕塑+抹角+抬升）',
      oversight: 'strict',
      expectGateCount: 4, // 计划闸 + 3 个写闸（noise_sculpt 窄、bevel 窄、raise 静态 wide）
      makeScript: () => [
        roundStep({ calls: [{ id: 'p1', name: 'update_plan', args: { stages: ['a', 'b', 'c'] } }] }),
        roundStep({ calls: [
          { id: 'w1', name: 'noise_sculpt', args: { target_kind: 'manual', amplitude: 1, density: 0.5, seed: 3, px: true, nx: true, py: true, ny: false, pz: true, nz: true, key: 'color:dark-gray' } },
          { id: 'w2', name: 'bevel_edges', args: { target_kind: 'all', radius: 1, passes: 1 } },
          { id: 'w3', name: 'raise_layers', args: { target_kind: 'all', layers: 1 } },
        ] }),
        roundStep({ text: '完成。' }),
      ],
    },
    {
      name: '④笔刷修补（brush place）',
      oversight: 'strict',
      expectGateCount: 1,
      makeScript: () => [
        roundStep({ calls: [{ id: 'w1', name: 'brush', args: { modifier: 'place', size_x: 2, size_y: 1, size_z: 2, key: 'color:red', anchors: [[9, 0, 9], [11, 0, 9]] } }] }),
        roundStep({ text: '完成。' }),
      ],
    },
    {
      name: '⑤逐块兜底（set_cells 含越界丢弃）',
      oversight: 'strict',
      expectGateCount: 1,
      makeScript: () => [
        roundStep({ calls: [{ id: 'w1', name: 'set_cells', args: { cells: [[9, 0, 0, 'color:red'], [9, -1, 0, 'color:red'], [9, 1, 0, 'air']] } }] }),
        roundStep({ text: '完成。' }),
      ],
    },
    {
      name: '⑥AI 回退（undo 带地板）',
      oversight: 'strict',
      expectGateCount: 2, // 先写一笔（闸）再撤（静态 wide 闸）
      makeScript: () => [
        roundStep({ calls: [{ id: 'w1', name: 'brush', args: { modifier: 'place', size_x: 1, size_y: 1, size_z: 1, key: 'color:red', anchors: [[9, 0, 9]] } }] }),
        roundStep({ calls: [{ id: 'u1', name: 'undo', args: { steps: 1 } }] }),
        roundStep({ text: '已回退。' }),
      ],
    },
  ]

  for (const c of cases) {
    it(`${c.name}：两份独立实例终态摘要相等 + 闸门序列`, async () => {
      const run = async (): Promise<{ digest: string; blocks: string[]; gates: number }> => {
        const h = makeHarness(c.makeScript(), c.oversight)
        await drive(h.session.sendOrder('回归句'), h)
        return {
          digest: h.editor.volume.digest().coordHash,
          blocks: blocksOf(h.editor),
          gates: h.session.log.events.filter((e) => e.type === 'gateAsked').length,
        }
      }
      const a = await run()
      const b = await run()
      expect(b.blocks, `${c.name} 两份实例逐块相等`).toEqual(a.blocks)
      expect(b.digest).toBe(a.digest)
      expect(a.gates, `${c.name} 闸门数`).toBe(c.expectGateCount)
    })
  }
})


describe('T8 · 尽力层弱化版：阻尼（逐字重试拒执行）+ 压缩（旧回执折叠、尾部逐字）', () => {
  it('阻尼：失败调用的逐字重发 ⇒ 拒执行并教一次；改参数后放行', async () => {
    const badCall = { id: 'c1', name: 'recolor', args: { target_kind: 'all', to: 'color:not-exist' } }
    const h = makeHarness([
      roundStep({ calls: [badCall] }), // 失败（教学式报错）
      roundStep({ calls: [badCall] }), // 逐字重发 ⇒ 阻尼拒执行
      roundStep({ calls: [{ id: 'c2', name: 'recolor', args: { target_kind: 'composition', target_id: 'comp-1', to: 'color:red' } }] }), // 改参数 ⇒ 放行
      roundStep({ text: '完成。' }),
    ], 'yolo')
    await drive(h.session.sendOrder('把屋顶改红'), h)
    const events = h.session.log.events
    const results = events.filter((e) => e.type === 'toolResult')
    expect(results).toHaveLength(3)
    expect(results[0]!.content).toContain('调色板里没有身份') // 第一次：执行失败（教学式）
    expect(results[1]!.content).toContain('阻尼') // 第二次：逐字重发被拒、未执行
    expect(results[2]!.content).toContain('recolor 完成') // 第三次：改参数后放行
  })

  it('压缩弱化版：总量超 8000 字符 ⇒ 最旧的 tool 回执折叠成首行 + 标记；尾部逐字保留', async () => {
    const { SessionLog } = await import('../../src/ai/session-log')
    const log = new SessionLog(new MemStore())
    const big = (n: number): string => `结果#${n}：
` + 'x'.repeat(3000) // 每条约 3005 字符
    log.append({ type: 'order', text: '反复读', snapshot: { nonEmpty: 0, bounds: null, perLayer: [], palette: [], usedColors: [], partsCount: 0, compositionsCount: 0, selectedPartId: null, selectedCompositionId: null } })
    for (let i = 1; i <= 4; i++) {
      const callId = `call-${i}`
      log.append({ type: 'toolCall', callId, tool: 'get_model_summary', args: {}, wide: false })
      log.append({ type: 'toolResult', callId, ok: true, content: big(i) })
    }
    const messages = deriveMessages(log)
    const toolMsgs = messages.filter((m) => m.role === 'tool') as Array<{ content: string | null }>
    const folded = toolMsgs.filter((m) => (m.content ?? '').includes('已折叠'))
    const intact = toolMsgs.filter((m) => (m.content ?? '').includes('x'.repeat(100)))
    expect(folded.length).toBeGreaterThanOrEqual(1) // 最旧的被折叠
    expect(intact.length).toBeGreaterThanOrEqual(1) // 尾部逐字保留
    expect(messages.filter((m) => m.role === 'assistant').length).toBe(4) // 协议形状不变（4 组 assistant+tool）
    // 纯函数自证：同输入两次折叠结果一致
    expect(compactMessages(messages)).toEqual(messages.length > 0 ? compactMessages(messages) : messages)
  })
})

// r04 T6（B-3）· A1 同源纪律：systemPromptOf 由 rules/{pre,post} 的 agentHint 派生
// （zh 第 3/5 号条目 / en 两处分句），拼装结果与拆分前（cb04a0b 的 loop.ts 字面量）**逐字全等**——
// 改 hint 或骨架必先红这里（"改规则必同步改 hint"的常驻守卫）。
describe('r04 T6 · A1 系统提示词派生不漂移（快照 = cb04a0b 字面量）', () => {
  it('zh：7 条编号列表，第 3/5 条 = rules 的 hints', () => {
    expect(systemPromptOf('zh')).toBe(`你是一个 16³ 体素编辑器里的编辑代理。用户给你一句话，你通过**工具调用**改造既有体素模型。

纪律：
1. 先观察再动手——改前用 get_model_summary / list_parts / list_compositions / read_map_full 看清现状，不要凭记忆猜。
2. 一次只做一小步；大改动拆成多步，每步一个工具调用。
3. 宾语用 id：构件 / 组合先 list_* 拿 id，再传 target_kind + target_id；不做名字猜测。
4. 参数全部平铺；随机操作必须显式给 seed。
5. 坐标域 ±4096：目标坐标须是 ±4096 内的整数（含负值 y）；非整数 / 非有限 / 越界会被丢弃或拒绝。
6. 写完看回执：回执带编辑区快照，确认无误再继续；有疑问先读模型再改。
7. 完成后用一句中文总结改了什么；若必须问用户，以问号结尾。`)
  })

  it('en：一整句，两处分句 = rules 的 hints', () => {
    expect(systemPromptOf('en')).toBe(
      'You are an editing agent inside a 16^3 voxel editor. The user gives one sentence; you reshape the existing model via tool calls.\n\n' +
        'Discipline: observe before editing (get_model_summary / list_parts / list_compositions / read_map_full); small steps; ' +
        'address parts/compositions by id (list_* first, then target_kind + target_id); ' +
        'flat scalar params; explicit seed for randomness; ' +
        'coord domain ±4096 (integer coords in [-4096, 4096], negative y included; non-integer, non-finite or out-of-range targets are dropped); ' +
        'read the receipt (it embeds an edited-region snapshot) before continuing; end with a one-sentence summary, or a question mark if you must ask.',
    )
  })
})
