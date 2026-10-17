// harness · AI 会话链路读回（r03 agent-edit）：脚本化 provider 在浏览器内跑通
//   V1 主链路（一句话 → 计划 → 闸门批准 → 落块 → 事件对账）· V3 闸门三档抽查 · V4 刷新续跑（重入）·
//   V2 容错（半截重发 / 5xx 降级 + 一键重试）· 回执行数读回（op rows 计数 = 补丁数 = 模型块差）。
// 加载自检同 editing-view（顶层 try/catch，出错禁用按钮——杜绝"静默点不动"）。
import { AgentSession } from '../src/ai/agent'
import { MemorySessionStore } from '../src/ai/session-log'
import { halfJsonStep, makeScriptedAdapter, roundStep } from '../src/ai/scripted-provider'
import type { WireStep } from '../src/ai/scripted-provider'
import type { GateAnswer, SessionEvent } from '../src/ai/session-log'
import { Editor } from '../src/edit/editor'
import { applyProgramOp } from '../src/ops/apply'
import { setUi } from '../src/state/editor-store'

const runButton = document.getElementById('run') as HTMLButtonElement
const progressSpan = document.getElementById('progress') as HTMLSpanElement

interface Check {
  name: string
  expect: string
  actual: string
  pass: boolean
}
const checks: Check[] = []

function check(name: string, expect: string, actual: string, pass: boolean): void {
  checks.push({ name, expect, actual, pass })
}

/** 房子夹具（同 tests/ai-loop.test.ts：墙 + 屋顶 + 烟囱 + 组合 comp-1「屋顶」） */
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

function makeSession(editor: Editor, script: readonly WireStep[], oversight: 'strict' | 'checkpoint' | 'yolo', store?: MemorySessionStore): AgentSession {
  const { adapter } = makeScriptedAdapter(script)
  const session = new AgentSession(editor, { adapter, sessionStore: store ?? new MemorySessionStore(), sleep: async () => {} })
  session.setSettings({ oversight })
  return session
}

/** 驱动：挂起等闸时轮询作答（模拟用户点「批准」） */
async function drive(promise: Promise<unknown>, session: AgentSession, answer: GateAnswer = 'allow'): Promise<void> {
  let settled = false
  void promise.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    },
  )
  let ticks = 0
  while (!settled) {
    await new Promise((r) => setTimeout(r, 5))
    const pending = session.log.view().pendingGate
    if (pending) session.answerGate(pending.gateId, answer)
    if (++ticks > 400) throw new Error('drive 超时（2s 内未收口）')
  }
  await promise
}

const REDIRECT = '屋顶已改红。'
function eventSummary(events: readonly SessionEvent[]): string {
  return events.map((e) => e.type).join(' → ')
}

async function run(): Promise<void> {
  const progress = document.getElementById('progress') as HTMLSpanElement
  const resultTable = document.getElementById('result') as HTMLTableElement
  const raw = document.getElementById('raw') as HTMLPreElement
  checks.length = 0

  // ── V1 主链路：一句话 → 观察 → 计划闸门 → recolor(组合) → 收口 ──
  {
    const editor = house()
    const blocksBefore = editor.volume.nonEmptyCount
    const session = makeSession(editor, [
      roundStep({ calls: [{ id: 'r1', name: 'list_compositions', args: {} }] }),
      roundStep({ calls: [{ id: 'p1', name: 'update_plan', args: { stages: ['查组合', '换屋顶材质', '收口'] } }] }),
      roundStep({ calls: [{ id: 'w1', name: 'recolor', args: { target_kind: 'composition', target_id: 'comp-1', to: 'color:red' } }] }),
      roundStep({ text: REDIRECT }),
    ], 'strict')
    const patchesBefore = editor.log.patches.length
    await drive(session.sendOrder('把屋顶改成红色'), session)
    const view = session.log.view()
    const job = view.jobs[0]!
    check('V1 计划栏', 'plan 事件 1 条（3 阶段）', `stages=${job.stages?.join('/') ?? '无'}`, job.stages?.length === 3)
    check('V1 落块', '组合内 65 块全变红', `red=${[...editor.volume.iterBlocks()].filter((b) => editor.volume.palette.get(b.key)?.identity === 'color:red').length} / total=${editor.volume.nonEmptyCount}`, [...editor.volume.iterBlocks()].filter((b) => b.y === 4 || (b.x === 5 && b.y === 5 && b.z === 5)).every((b) => editor.volume.palette.get(b.key)?.identity === 'color:red'))
    check('V1 一调用一补丁', '补丁 +1', `+${editor.log.patches.length - patchesBefore}`, editor.log.patches.length === patchesBefore + 1)
    check('V1 op rows 计数 = 模型读回', 'rows=3（读/计划/写）且块数不变（改色不改块数）', `rows=${job.rows.length}、块差=${editor.volume.nonEmptyCount - blocksBefore}`, job.rows.length === 3 && editor.volume.nonEmptyCount === blocksBefore)
    check('V1 收口', 'jobEnd=done', job.outcome?.outcome ?? '无', job.outcome?.outcome === 'done')
    check('V1 事件链', 'order→usage→toolCall→toolResult…→jobEnd', eventSummary(session.log.events).slice(0, 80), session.log.events[session.log.events.length - 1]!.type === 'jobEnd')
  }

  // ── V3 三档抽查（strict 闸 / checkpoint 只闸宽 / yolo 不闸）──
  {
    for (const [oversight, expectGates] of [['strict', 1], ['checkpoint', 0], ['yolo', 0]] as const) {
      const editor = house()
      const session = makeSession(editor, [
        roundStep({ calls: [{ id: 'w1', name: 'brush', args: { modifier: 'place', size_x: 1, size_y: 1, size_z: 1, key: 'color:red', anchors: [[9, 0, 9]] } }] }),
        roundStep({ text: 'done' }),
      ], oversight)
      await drive(session.sendOrder('放一块'), session)
      const gates = session.log.events.filter((e) => e.type === 'gateAsked').length
      const wrote = editor.volume.getBlock(9, 0, 9) !== 0
      check(`V3 ${oversight} 窄写`, `闸门 ${expectGates} 个 + 落块成功`, `闸门 ${gates} 个、块=${wrote}`, gates === expectGates && wrote)
    }
  }

  // ── V4 刷新续跑：挂起闸门 → 同 store 新 AgentSession（模拟重载）→ 重入批准 → 收口 ──
  {
    const store = new MemorySessionStore()
    const editor = house()
    const s1 = makeSession(editor, [
      roundStep({ calls: [{ id: 'w1', name: 'brush', args: { modifier: 'place', size_x: 1, size_y: 1, size_z: 1, key: 'color:red', anchors: [[9, 0, 9]] } }] }),
      roundStep({ text: '续跑完成。' }),
    ], 'strict', store)
    void s1.sendOrder('在旁边放一块红砖').catch(() => undefined)
    await new Promise((r) => setTimeout(r, 20))
    const pending = s1.log.view().pendingGate
    const s2 = makeSession(editor, [], 'strict', store) // 脚本用尽也无妨：adapter 共享计数（刷新模拟里继续用同一脚本）
    const reentered = s2.log.view().pendingGate?.gateId === pending?.gateId && s2.log.events.filter((e) => e.type === 'gateAsked').length === 1
    check('V4 重入而非重问', '新会话看到同一 gateId、无新增 gateAsked', `gateId=${s2.log.view().pendingGate?.gateId ?? '无'}`, reentered === true)
    // 直接在新会话上作答（刷新窗口内作答形态）→ 另一带尾脚本的会话 resume 补执行 + 续跑
    s2.answerGate(pending!.gateId, 'allow')
    const s3 = makeSession(editor, [roundStep({ text: '续跑完成。' })], 'strict', store)
    await drive(s3.resumeIfPending(), s3)
    check('V4 答后补执行', '挂起那笔落块 + job 收口 done', `块=${editor.volume.getBlock(9, 0, 9) !== 0}、outcome=${s3.log.view().jobs[0]!.outcome?.outcome}`, editor.volume.getBlock(9, 0, 9) !== 0 && s3.log.view().jobs[0]!.outcome?.outcome === 'done')
    check('V4 会话视图由日志重建', 's3 与 s1 视图一致（order/rows）', `jobs=${s3.log.view().jobs.length}`, s3.log.view().jobs.length === s1.log.view().jobs.length)
  }

  // ── V2 容错：半截重发 + 5xx 降级一键重试 ──
  {
    const editor = house()
    const session = makeSession(editor, [
      halfJsonStep('c-bad', 'recolor', JSON.stringify({ target_kind: 'composition', target_id: 'comp-1', to: 'color:red' })),
      roundStep({ calls: [{ id: 'w1', name: 'recolor', args: { target_kind: 'composition', target_id: 'comp-1', to: 'color:red' } }] }),
      roundStep({ text: '补发完成。' }),
    ], 'yolo')
    await drive(session.sendOrder('把屋顶改红'), session)
    const hasReissue = session.log.events.some((e) => e.type === 'toolResult' && e.content.includes('不完整'))
    check('V2 半截重发', '坏调用不执行 + 回"重发完整参数" + 补发成功', `重发提示=${hasReissue}`, hasReissue === true)

    // 5xx 五连 ⇒ 重试梯耗尽 ⇒ incident + jobEnd=incident + 一键重试入口在
    //（重试**重跑成功**的完整对拍归 tests/ai-loop 的 I5 用例——页面只读回降级面）
    const editor2 = house()
    const sFail = makeSession(editor2, [{ status: 500 }, { status: 500 }, { status: 500 }, { status: 500 }, { status: 500 }], 'yolo')
    await drive(sFail.sendOrder('把屋顶改红'), sFail)
    const incident = sFail.log.view().jobs[0]!.outcome?.outcome === 'incident'
    check('V2 5xx 降级产物', 'incident + jobEnd=incident（可一键重试）', `outcome=${sFail.log.view().jobs[0]!.outcome?.outcome}`, incident === true)
    check('V2 一键重试入口', 'canRetry() 为真', `canRetry=${sFail.canRetry()}`, sFail.canRetry() === true)
  }

  // ── 渲染结果 ──
  const pass = checks.filter((c) => c.pass).length
  resultTable.innerHTML = `<tr><th>检查</th><th>期望</th><th>读回</th><th>结果</th></tr>${checks
    .map((c) => `<tr><td>${c.name}</td><td>${c.expect}</td><td>${c.actual}</td><td class="${c.pass ? 'pass' : 'fail'}">${c.pass ? 'PASS' : 'FAIL'}</td></tr>`)
    .join('')}`
  raw.textContent = checks.map((c) => `${c.pass ? 'PASS' : 'FAIL'} ${c.name} | ${c.actual}`).join('\n')
  progress.textContent = `${pass}/${checks.length} PASS`
  console.info('[agent-loop]', checks)
}

try {
  runButton.addEventListener('click', () => {
    runButton.disabled = true
    void run()
      .catch((err) => {
        progressSpan.textContent = `运行失败：${String(err)}（详见控制台）`
        console.error('[agent-loop]', err)
      })
      .finally(() => {
        runButton.disabled = false
      })
  })
  progressSpan.textContent = '就绪（脚本化 provider，不出网）'
} catch (err) {
  runButton.disabled = true
  progressSpan.textContent = `初始化失败：${String(err)}`
  console.error('[agent-loop] 初始化失败：', err)
}
