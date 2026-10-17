// r03 · T4 会话循环（plan §2.2 的主干实现）：order → screen → 计划 → 工具批（闸门）→ 执行/回执 →
// 治理（轮预算 24 / 剩 3 警告 / 到顶 capped）→ jobEnd。全程事件进 SessionLog ⇒ 刷新后 resume() 续跑。
// 派生口径（PetitMaker deriveMessages 同型）：只有**有回执的**调用进供给商历史——
// 未答闸门 / 被跳过的调用不执行也不回执（N7），派生时成对丢弃（协议不悬挂 tool_call id）。
// r04 T6（I2）：消息面（systemPromptOf / deriveMessages / compactMessages）拆至 ai/messages.ts
// （A1：提示词规则句由 rules/{pre,post} 派生）；本文件只剩 AgentLoop 主干。
import type { Editor } from '../edit/editor'
import type { SessionEvent, SessionLog } from './session-log'
import type { GateAnswer } from './session-log'
import { executeTool } from './executor'
import { parseWriteArgs } from './args'
import type { WriteParseResult } from './args'
import { systemPromptOf, deriveMessages } from './messages'
import { GateBroker, answerAllowsExecution, shouldGate } from './gates'
import type { Oversight } from './gates'
import type { ChatRequest, ChatResult, ProviderAdapter, WireState } from './provider'
import { chatWithRetry, screen } from './provider'
import { AI_TOOLS, AI_LIMITS, isReadTool } from './tools'
import { buildSnapshot } from './view'
import { findAnsweredUnexecuted } from './resume'

/** T8（§4 件二）：当前步骤相位——三个等待点各上报一次（发请求前 / 执行工具前 / gateAsked 之后） */
export interface LoopPhase {
  readonly kind: 'idle' | 'awaiting-provider' | 'executing-tool' | 'awaiting-gate'
  readonly detail?: string
}

interface LoopDeps {
  readonly sleep?: (ms: number) => Promise<void>
  readonly language?: 'zh' | 'en'
  /** 每个事件落地后回调（UI 刷新钩子；不抛错） */
  readonly onEvent?: (e: SessionEvent) => void
  /** 测试 / harness 的假睡眠（默认 setTimeout） */
  readonly random?: () => number
  readonly onPhase?: (p: LoopPhase) => void // T8 件二：相位上报（"卡在哪一步"）
  readonly onWire?: (s: WireState) => void // T8 件一：线级状态（转交重试梯）
}

export interface RunJobOptions {
  readonly oversight: Oversight
  readonly language: 'zh' | 'en'
  readonly signal?: AbortSignal
}

export class AgentLoop {
  /** T8 阻尼最小面（弱化面，内存态不进日志）：本 job 内失败过的调用签名——逐字重发先拒一次并教"先读再改" */
  private readonly failedSigs = new Map<string, number>()

  constructor(
    private readonly editor: Editor,
    private readonly log: SessionLog,
    private readonly broker: GateBroker,
    private readonly adapter: ProviderAdapter,
    private readonly deps: LoopDeps = {},
  ) {}

  private emit(e: SessionEvent): void {
    this.deps.onEvent?.(e)
  }

  /** T8（§4 件二）：相位上报（detail 有值才携带） */
  private phase(kind: LoopPhase['kind'], detail?: string): void {
    this.deps.onPhase?.({ kind, ...(detail !== undefined ? { detail } : {}) })
  }

  private append(e: Parameters<SessionLog['append']>[0]): SessionEvent {
    const full = this.log.append(e)
    this.emit(full)
    return full
  }

  /** 一句话入口：screen → order 事件 → 轮循环 → jobEnd */
  async runJob(orderText: string, opts: RunJobOptions): Promise<void> {
    // 未收口的旧 job（挂起闸门 / 中断）先收口——用户新指令使未答闸门作废（口径卡 §二）
    if (this.log.currentJobId() !== null) {
      this.append({ type: 'jobEnd', outcome: 'aborted', summary: '用户发来新指令，上一任务作废（未答闸门作废）' })
    }
    const checked = screen(orderText)
    const jobId = `job-${this.log.nextJobNum()}`
    const orderEvt = this.append({
      type: 'order',
      jobId,
      text: orderText,
      snapshot: buildSnapshot(this.editor),
    })
    this.emit(orderEvt)
    if (!checked.pass) {
      this.append({ type: 'jobEnd', jobId, outcome: 'aborted', summary: `本地预检拒单（不过网）：${checked.reason}` })
      return
    }
    await this.roundLoop(jobId, opts)
  }

  /** 刷新续跑（V4：重入而非重问）。两种挂起形态都要接住：
   *  ① 闸门未答 → await（同一 gateId，不重问）→ 答后补执行；
   *  ② 刷新窗口内已答（gateAnswered 已在日志、循环栈已死）→ 找"已批未执行"的调用补执行——
   *    只认 pendingGate 会漏掉这一形态（V4 实测教训）。
   *  补执行后进 roundLoop 继续会话。 */
  async resume(opts: RunJobOptions): Promise<boolean> {
    const jobId = this.log.currentJobId()
    if (jobId === null) return false
    for (;;) {
      const pending = this.log.view().pendingGate
      if (pending) {
        this.phase('awaiting-gate', pending.tool)
        const answer = await this.broker.await(pending.gateId)
        if (answerAllowsExecution(answer)) this.completeGatedCall(jobId, pending, opts)
        if (this.log.view().pendingGate === null && findAnsweredUnexecuted(this.log, jobId) !== null) continue
        break
      }
      const answered = findAnsweredUnexecuted(this.log, jobId)
      if (!answered) break
      this.completeGatedCall(jobId, answered.gate, opts)
    }
    await this.roundLoop(jobId, opts)
    return true
  }

  /** 闸门已批 ⇒ 补完成该调用：计划闸门落 plan + toolResult；工具闸门直接执行 */
  private completeGatedCall(jobId: string, gate: SessionEvent & { type: 'gateAsked' }, opts: RunJobOptions): void {
    if (gate.callId === null) return
    const call = this.log.events.find((e) => e.type === 'toolCall' && e.callId === gate.callId)
    if (!call || call.type !== 'toolCall') return
    if (gate.scope === 'plan' && call.tool === 'update_plan') {
      this.completePlan(jobId, call.callId, call.args)
      return
    }
    this.executeAndReceipt(jobId, call.callId, call.tool, call.args, { ...opts, jobFloor: this.jobFloorOf(jobId) })
  }

  /** 计划闸门已批的补落档（重验阶段形状与 ≤2 次；批过闸 ⇒ 不再问） */
  private completePlan(jobId: string, callId: string, args: Record<string, unknown>): void {
    const stages = args.stages
    if (!Array.isArray(stages) || stages.length < AI_LIMITS.planStagesMin || stages.length > AI_LIMITS.planStagesMax) {
      this.append({ type: 'toolResult', jobId, callId, ok: false, content: teachingPlanError(stages) })
      return
    }
    const commits = this.log.planCommits(jobId)
    if (commits >= AI_LIMITS.planCommitsMax) {
      this.append({ type: 'toolResult', jobId, callId, ok: false, content: `计划已落档 ${commits} 次（上限 ${AI_LIMITS.planCommitsMax}）——继续执行工具` })
      return
    }
    this.append({ type: 'plan', jobId, stages: stages as string[], attempt: commits + 1 })
    this.append({ type: 'toolResult', jobId, callId, ok: true, content: `计划已落档（${(stages as string[]).join(' → ')}）；按阶段推进` })
  }

  /** 一键重试（REQ-011：空模型不是选项——重跑最近一条 order） */
  async retryLast(opts: RunJobOptions): Promise<boolean> {
    let lastOrder: (SessionEvent & { type: 'order' }) | null = null
    for (const e of this.log.events) if (e.type === 'order') lastOrder = e
    if (lastOrder === null) return false
    await this.runJob(lastOrder.text, opts)
    return true
  }

  /** 轮循环：预算检查 → 派生消息 → 适配器（重试梯）→ 工具批 → 下一轮 / jobEnd */
  private async roundLoop(jobId: string, opts: RunJobOptions): Promise<void> {
    const jobFloor = this.jobFloorOf(jobId)
    for (;;) {
      if (opts.signal?.aborted) {
        this.append({ type: 'jobEnd', jobId, outcome: 'aborted', summary: '已中止' })
        return
      }
      const used = this.log.roundsUsed(jobId)
      if (used >= AI_LIMITS.roundBudget) {
        this.append({ type: 'jobEnd', jobId, outcome: 'capped', summary: `轮预算到顶（${AI_LIMITS.roundBudget}），任务收口——可发新指令继续` })
        return
      }
      const remaining = AI_LIMITS.roundBudget - used
      this.append({
        type: 'usage',
        jobId,
        round: used + 1,
        roundsLeft: remaining - 1,
        ...(remaining === AI_LIMITS.budgetWarnRemaining + 1 ? { warned: true } : {}),
      })

      const req: ChatRequest = {
        messages: [{ role: 'system', content: systemPromptOf(opts.language) }, ...deriveMessages(this.log)],
        tools: AI_TOOLS,
        ...(opts.signal ? { signal: opts.signal } : {}),
      }
      this.phase('awaiting-provider')
      const outcome = await chatWithRetry(this.adapter, req, {
        sleep: this.deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
        ...(this.deps.random ? { random: this.deps.random } : {}),
        ...(this.deps.onWire ? { onWireState: this.deps.onWire } : {}),
      })
      if (outcome.error !== undefined) {
        const err = outcome.error
        this.append({
          type: 'incident',
          jobId,
          errorClass: err.kind === 'overflow' ? 'overflow' : err.kind,
          message: err.message,
          retryable: err.kind === 'retryable',
          attempt: outcome.attempts,
        })
        const advice = err.kind === 'overflow' ? '（上下文超限——建议发一条更短的指令或拆小任务）' : '（一键重试可重跑本条指令）'
        this.append({ type: 'jobEnd', jobId, outcome: 'incident', summary: `${err.message}${advice}` })
        return
      }
      const result = outcome.result as ChatResult
      // 半截 / 畸形调用（①-34）：不执行，回"重发完整参数"
      if (result.badCalls && result.badCalls.length > 0) {
        for (const bad of result.badCalls) {
          const callId = this.log.nextCallId()
          this.append({ type: 'toolCall', jobId, callId, tool: bad.name, args: { malformed: true }, wide: false, ...(result.text ? { assistantText: result.text } : {}) })
          this.append({ type: 'toolResult', jobId, callId, ok: false, content: `收到不完整 / 畸形的调用参数（未执行）。请用完整参数重发这次调用（tool: ${bad.name}）` })
        }
      }

      const calls = result.calls
      if (calls.length === 0) {
        if (result.badCalls && result.badCalls.length > 0) continue // 已回"重发"，下一轮等模型补发
        const text = result.text.trim()
        if (text !== '') {
          this.append({
            type: 'jobEnd',
            jobId,
            outcome: 'done',
            summary: text,
            askedQuestion: /[?？]$/.test(text),
            finalText: text,
          })
        } else {
          this.append({ type: 'incident', jobId, errorClass: 'silent-round', message: '模型本轮既无文本也无调用' })
          this.append({ type: 'jobEnd', jobId, outcome: 'incident', summary: '模型本轮没有返回内容（空流收束）——可一键重试' })
        }
        return
      }

      // 工具批（①-6：一轮可多调用，顺序执行）
      for (const call of calls) {
        const callId = this.log.nextCallId()

        // T8 阻尼最小面：逐字重发**刚失败过**的调用 ⇒ 拒执行并教一次（改参数 / 先读模型即可脱出；
        // 轮预算兜底死循环）。弱化面：计数在内存，刷新清零（完整版归以后层）。
        const sig = JSON.stringify([call.name, call.args])
        if (this.failedSigs.has(sig)) {
          this.append({
            type: 'toolCall',
            jobId,
            callId,
            tool: call.name,
            args: call.args,
            wide: false,
            ...(result.text && call === calls[0] ? { assistantText: result.text } : {}),
          })
          this.append({
            type: 'toolResult',
            jobId,
            callId,
            ok: false,
            content: '（阻尼）这次调用与刚才失败的那次逐字相同——原样重发不会成功。先用 get_model_summary / list_* 核对现状，改参数后重发',
          })
          continue
        }

        const est = this.parseForGate(call.name, call.args)
        this.append({
          type: 'toolCall',
          jobId,
          callId,
          tool: call.name,
          args: call.args,
          wide: est.wide,
          ...(result.text && call === calls[0] ? { assistantText: result.text } : {}),
        })

        if (call.name === 'update_plan') {
          await this.handlePlan(jobId, callId, call.args, opts)
          continue
        }

        const decision = shouldGate(opts.oversight, call.name, { wide: est.wide, allowAlways: this.log.view().allowAlways })
        if (decision.gate) {
          const gateId = this.broker.ask(jobId, decision.scope, { // 闸门事件由 gates 直写日志 ⇒ 末参补发 emit（UI 的 pendingGate 才随闸门刷新）
            tool: call.name,
            callId,
            summary: this.gateSummary(call.name, call.args, est.wide),
            quickAnswers: ['批准', '本次会话都批准', '跳过'],
          }, (e) => this.emit(e))
          this.phase('awaiting-gate', call.name)
          const answer: GateAnswer = await this.broker.await(gateId)
          if (!answerAllowsExecution(answer)) {
            continue // skip / words ⇒ 不执行、不回执（N7）；words 已由 deriveMessages 注入下一轮
          }
        }
        this.executeAndReceipt(jobId, callId, call.name, call.args, { ...opts, jobFloor }, est.parsed)
      }
      // 批后继续下一轮（预算在循环顶检查）
    }
  }

  /** 计划闸门（①-4）：3–6 阶段名词短语；非 yolo 且无 allow-always 时过闸；至多 2 次落档 */
  private async handlePlan(jobId: string, callId: string, args: Record<string, unknown>, opts: RunJobOptions): Promise<void> {
    const stages = args.stages
    if (!Array.isArray(stages) || stages.length < AI_LIMITS.planStagesMin || stages.length > AI_LIMITS.planStagesMax || !stages.every((s) => typeof s === 'string' && s.trim().length > 0 && s.length <= 30)) {
      this.append({
        type: 'toolResult',
        jobId,
        callId,
        ok: false,
        content: teachingPlanError(stages),
      })
      return
    }
    const commits = this.log.planCommits(jobId)
    if (commits >= AI_LIMITS.planCommitsMax) {
      this.append({ type: 'toolResult', jobId, callId, ok: false, content: `计划已落档 ${commits} 次（上限 ${AI_LIMITS.planCommitsMax}）——阶段表是对用户的承诺，不是草稿；继续执行工具` })
      return
    }
    const decision = shouldGate(opts.oversight, 'update_plan', { wide: false, allowAlways: this.log.view().allowAlways, isPlan: true })
    if (decision.gate) {
      const gateId = this.broker.ask(jobId, 'plan', { // 同上一处：计划闸门（用户实报的那一处）也要补发 emit
        tool: 'update_plan',
        callId,
        summary: `计划（${(stages as string[]).join(' → ')}）`,
        quickAnswers: ['批准', '本次会话都批准', '跳过'],
      }, (e) => this.emit(e))
      this.phase('awaiting-gate', 'update_plan')
      const answer = await this.broker.await(gateId)
      if (!answerAllowsExecution(answer)) {
        return // 未批准 ⇒ 无 plan 事件、无 toolResult（N7 同型）
      }
    }
    this.append({ type: 'plan', jobId, stages: stages as string[], attempt: commits + 1 })
    this.append({ type: 'toolResult', jobId, callId, ok: true, content: `计划已落档（${(stages as string[]).join(' → ')}）；按阶段推进，每步一个工具调用` })
  }

  private executeAndReceipt(
    jobId: string,
    callId: string,
    tool: string,
    args: Record<string, unknown>,
    opts: RunJobOptions & { jobFloor: number },
    preparsed?: WriteParseResult,
  ): void {
    this.phase('executing-tool', tool)
    let outcome
    try {
      outcome = executeTool(this.editor, tool, args, { jobFloor: opts.jobFloor, ...(preparsed ? { preparsed } : {}) })
    } catch (e) {
      outcome = { ok: false, content: `工具执行异常（已拦截，模型未崩）：${(e as Error).message}`, wide: false }
    }
    // T8 阻尼记账：失败签名入册（同签名成功 ⇒ 出册）
    const sig = JSON.stringify([tool, args])
    if (outcome.ok) this.failedSigs.delete(sig)
    else this.failedSigs.set(sig, (this.failedSigs.get(sig) ?? 0) + 1)
    this.append({
      type: 'toolResult',
      jobId,
      callId,
      ok: outcome.ok,
      content: outcome.content,
      ...(outcome.detail ? { detail: outcome.detail } : {}),
    })
  }

  /** 动态 wide 估算（执行前）+ 解析产物（D5 单解析：一调用一解析，产物直传执行器）。
   *  读工具恒 false、无产物；写工具解析一次——失败也按宽处理（闸门兜底）且**失败产物直传**
   *  （执行器取同一份教学报错，不再二次解析）。 */
  private parseForGate(toolName: string, args: Record<string, unknown>): { wide: boolean; parsed?: WriteParseResult } {
    if (isReadTool(toolName) || toolName === 'update_plan') return { wide: false }
    const parsed = parseWriteArgs(this.editor, toolName, args)
    return { wide: parsed.ok ? parsed.parsed.wide : true, parsed }
  }

  private gateSummary(toolName: string, args: Record<string, unknown>, wide: boolean): string {
    const scope = args.target_kind ? `宾语=${String(args.target_kind)}${args.target_id ? `#${String(args.target_id)}` : ''}` : '绝对坐标'
    const wideNote = wide ? '【宽操作】' : ''
    const words = Object.entries(args)
      .filter(([, v]) => typeof v === 'number' || typeof v === 'string')
      .slice(0, 4)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(' ')
    return `${wideNote}${toolName}（${scope} ${words}）`
  }

  /** job 的 undo 地板（PetitMaker ①-23 同口径）：AI 的 undo 退不穿任务开始前用户的编辑。
   *  本 job 首个 AI 补丁的 seq 即地板（seq = 入栈前长度 ⇒ 可退到恰好保留用户的历史）；还没有 AI 补丁 ⇒ 当前长度。 */
  private jobFloorOf(jobId: string): number {
    let minPatchSeq: number | null = null
    for (const e of this.log.events) {
      if (e.type === 'toolResult' && e.jobId === jobId && e.detail?.patchSeq !== undefined) {
        if (minPatchSeq === null || e.detail.patchSeq < minPatchSeq) minPatchSeq = e.detail.patchSeq
      }
    }
    if (minPatchSeq !== null) return Math.max(0, minPatchSeq)
    return this.editor.log.patches.length
  }
}

function teachingPlanError(stages: unknown): string {
  return `计划须为 ${AI_LIMITS.planStagesMin}–${AI_LIMITS.planStagesMax} 个非空短语（每条 ≤30 字）。最小合法示例：{ "stages": ["观察模型", "换屋顶材质", "复查收尾"] }（收到 ${JSON.stringify(stages)?.slice(0, 80)}）`
}
