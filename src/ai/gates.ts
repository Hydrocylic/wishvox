// r03 · T4 闸门（REQ-010 / V3 / N7；口径卡 §二的唯一实现）：
// 三档 strict / checkpoint / yolo + wide/narrow 二分 + 计划闸门 + callApproved 只认逐次批准。
// 闸门状态**就是日志事件**（gateAsked / gateAnswered）——无需额外存储，刷新后重入而非重问（①-8/①-17）。
import type { SessionEvent, SessionLog } from './session-log'
import type { GateAnswer } from './session-log'
import { isReadTool, isWriteTool } from './tools'

export type Oversight = 'strict' | 'checkpoint' | 'yolo'

interface GateDecision {
  /** true = 需要过闸（askGate → awaitGate） */
  readonly gate: boolean
  /** 闸门的 scope 标记（tool / plan） */
  readonly scope: 'tool' | 'plan'
  readonly reason: string
}

/** shouldGate（gates.ts:8-14 同型）：
 * · yolo 或会话级 allow-always ⇒ 不闸（provenance 仍区分"放行"vs"批准"）
 * · 读工具 ⇒ 永不闸
 * · strict ⇒ 一切写 + 计划都闸
 * · checkpoint ⇒ 只闸 wide（静态标注 ∪ 动态阈值）与计划 */
export function shouldGate(
  oversight: Oversight,
  toolName: string,
  opts: { wide: boolean; allowAlways: boolean; isPlan?: boolean },
): GateDecision {
  if (opts.isPlan === true) {
    if (oversight === 'yolo' || opts.allowAlways) return { gate: false, scope: 'plan', reason: '计划闸门：yolo / allow-always 免闸' }
    return { gate: true, scope: 'plan', reason: '计划闸门（非 yolo 且无 allow-always）' }
  }
  if (oversight === 'yolo') return { gate: false, scope: 'tool', reason: 'yolo 不批' }
  if (opts.allowAlways) return { gate: false, scope: 'tool', reason: '会话级放行（allow-always）' }
  if (isReadTool(toolName)) return { gate: false, scope: 'tool', reason: '读工具免闸' }
  if (toolName === 'update_plan') return { gate: false, scope: 'plan', reason: '计划走计划闸门' }
  if (!isWriteTool(toolName)) return { gate: false, scope: 'tool', reason: '非写工具' }
  if (oversight === 'strict') return { gate: true, scope: 'tool', reason: 'strict：每个写都批' }
  // checkpoint：只批 wide
  if (opts.wide) return { gate: true, scope: 'tool', reason: 'checkpoint：宽操作（wide）' }
  return { gate: false, scope: 'tool', reason: 'checkpoint：窄写自动执行' }
}

/** callApproved（gates.ts:58-70 同型）：只认**在该次闸门上被显式批准**（answer === 'allow'）。
 *  allow-always 是会话级放行，不改变 provenance——下一次同会话调用记"放行"而非"批准"。 */
export function callApproved(log: SessionLog, gateId: string): boolean {
  return log.gateOutcome(gateId) === 'allow'
}

/** 答案语义：allow = 批准执行；allow-always = 批准且本会话后续写免闸；skip / words = 不执行该调用 */
export function answerAllowsExecution(answer: GateAnswer): boolean {
  return answer === 'allow' || answer === 'allow-always'
}

interface GateAskFields {
  readonly tool: string
  readonly callId: string | null
  readonly summary: string
  readonly quickAnswers?: readonly string[]
}

/** askGate：落 gateAsked 事件（持久化 ⇒ 可跨刷新）。
 *  `onAppended` = 事件**已经落地**后的回调（回调里读 `log.view()` 已含本条）——本函数直写 `log`，
 *  不经 `AgentLoop.append` ⇒ 调用方（会话循环）在这里补一次 `emit`，UI 的 `pendingGate` 才会同源更新
 *  （不回补的话：闸门已落日志、卡片却要整页刷新才出现 —— r05 debug-261008 件一）。 */
function askGate(log: SessionLog, jobId: string, scope: 'tool' | 'plan', fields: GateAskFields, onAppended?: (e: SessionEvent) => void): string {
  const gateId = log.nextGateId()
  const event = log.append({
    type: 'gateAsked',
    jobId,
    gateId,
    scope,
    callId: fields.callId,
    ...(fields.tool ? { tool: fields.tool } : {}),
    summary: fields.summary,
    ...(fields.quickAnswers ? { quickAnswers: fields.quickAnswers } : {}),
  })
  onAppended?.(event)
  return gateId
}

/** 闸门经纪：ask（落事件）→ await（挂起）→ answer（落事件 + 唤醒）。
 *  跨刷新重入不靠本类兜底：await 先查日志**已答即返**（重入而非重问，同一 gateId）；
 *  未答挂起等 answer()。刷新窗口内"已批未执行"的调用由 loop.resume 的 findAnsweredUnexecuted
 *  扫描补执行（V4 实测教训）——那是 AgentLoop 的职责，不是 broker 的。 */
export class GateBroker {
  private readonly resolvers = new Map<string, (a: GateAnswer) => void>()

  constructor(private readonly log: SessionLog) {}

  /** 落闸门问句事件；`onAppended` 见 askGate 注释（会话循环借它把事件补发到 emit ⇒ UI 刷新） */
  ask(jobId: string, scope: 'tool' | 'plan', fields: GateAskFields, onAppended?: (e: SessionEvent) => void): string {
    return askGate(this.log, jobId, scope, fields, onAppended)
  }

  /** 已答 ⇒ 立即返回（重入路径）；未答 ⇒ 挂起直到 answer() */
  await(gateId: string): Promise<GateAnswer> {
    const existing = this.log.gateOutcome(gateId)
    if (existing !== null) return Promise.resolve(existing)
    return new Promise((resolve) => {
      this.resolvers.set(gateId, resolve)
    })
  }

  answer(gateId: string, answer: GateAnswer, words?: string): void {
    if (this.log.gateOutcome(gateId) !== null) return // 已答：以第一次为准（resume 场景的最新答案在日志里）
    this.log.append({
      type: 'gateAnswered',
      jobId: this.log.currentJobId() ?? '',
      gateId,
      answer,
      ...(words !== undefined ? { words } : {}),
    })
    const resolve = this.resolvers.get(gateId)
    this.resolvers.delete(gateId)
    resolve?.(answer)
  }
}
