// r03 · T2 会话事件日志（REQ-015 / N6）：**追加式事件 = 唯一会话状态**——
// UI 面板与供给商消息都是同一日志的投影（"THE LOG IS THE STATE"，PetitMaker ①-1 采纳）。
// 事件族 = 口径卡 §四的 9 种（最小面）；模型账 = PatchLog、会话账 = SessionLog，两者不混。
// 会话工具的 assistant 伴随文本挂在 toolCall.assistantText（字段级补充，记于轮次 log）。
import type { OrderSnapshot } from './view'

export type GateAnswer = 'allow' | 'allow-always' | 'skip' | 'words'

export interface ToolResultDetail {
  /** 改了多少格（绝发模型的 detail 通道——口径卡 §三） */
  readonly cells?: number
  readonly objects?: number
  readonly reverted?: boolean
  readonly violations?: readonly string[]
  readonly outOfBounds?: number
  readonly skipped?: number
  readonly patchSeq?: number
  readonly undoDepth?: number
  /** `A-09`（design §A4）：人工一笔进行中 ⇒ 本次 AI 写入未执行（零修改）。AI 可重试。 */
  readonly busy?: boolean
}

interface EventBase {
  readonly seq: number
  readonly ts: number
  readonly jobId: string
}

export type SessionEvent =
  | (EventBase & { type: 'order'; text: string; snapshot: OrderSnapshot })
  | (EventBase & { type: 'plan'; stages: readonly string[]; attempt: number })
  | (EventBase & {
      type: 'gateAsked'
      gateId: string
      scope: 'tool' | 'plan'
      callId: string | null
      tool?: string
      summary: string
      quickAnswers?: readonly string[]
    })
  | (EventBase & { type: 'gateAnswered'; gateId: string; answer: GateAnswer; words?: string })
  | (EventBase & { type: 'toolCall'; callId: string; tool: string; args: Record<string, unknown>; wide: boolean; assistantText?: string })
  | (EventBase & { type: 'toolResult'; callId: string; ok: boolean; content: string; detail?: ToolResultDetail })
  | (EventBase & { type: 'incident'; errorClass: string; message: string; retryable?: boolean; attempt?: number })
  | (EventBase & { type: 'usage'; round: number; roundsLeft: number; warned?: boolean; promptTokens?: number; completionTokens?: number })
  | (EventBase & { type: 'jobEnd'; outcome: 'done' | 'capped' | 'aborted' | 'incident'; summary: string; askedQuestion?: boolean; finalText?: string })

/** 分配式 Omit：联合类型逐成员去掉 seq/ts/jobId（jobId 可选——缺省 = 当前 job） */
type Without<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
type AppendableEvent = Without<SessionEvent, 'seq' | 'ts' | 'jobId'> & { readonly jobId?: string }

// ── 持久化（D-B：独立持久化会话日志，浏览器本地、单库单记录，不进项目文件 v2）──

interface SessionStore {
  load(): string | null
  save(text: string): void
  clear(): void
}

/** 内存实现（tests / harness 用；也是无 localStorage 环境的兜底） */
export class MemorySessionStore implements SessionStore {
  private value: string | null = null
  load(): string | null {
    return this.value
  }
  save(text: string): void {
    this.value = text
  }
  clear(): void {
    this.value = null
  }
}

// 2026-10-17 品牌改名（`voxel-ai-editor` → `wishvox`）：键名直改、不做迁移（旧键孤儿化）。
const SESSION_KEY = 'wishvox/ai-session/v1'

class LocalSessionStore implements SessionStore {
  load(): string | null {
    try {
      return localStorage.getItem(SESSION_KEY)
    } catch {
      return null
    }
  }
  save(text: string): void {
    try {
      localStorage.setItem(SESSION_KEY, text)
    } catch {
      // 存不下（隐私模式 / 超限）：会话只活在内存，不崩
    }
  }
  clear(): void {
    try {
      localStorage.removeItem(SESSION_KEY)
    } catch {
      // ignore
    }
  }
}

export function createSessionStore(): SessionStore {
  try {
    if (typeof localStorage !== 'undefined') return new LocalSessionStore()
  } catch {
    // fallthrough
  }
  return new MemorySessionStore()
}

// ── 会话视图（N6 判据：replay(event log) = 会话视图）──

interface JobView {
  readonly jobId: string
  readonly orderText: string
  readonly stages: readonly string[] | null
  readonly rows: ReadonlyArray<{ callId: string; tool: string; ok: boolean; content: string; detail?: ToolResultDetail }>
  readonly outcome: SessionEvent & { type: 'jobEnd' } | null
}

export interface SessionView {
  readonly jobs: readonly JobView[]
  /** 未答闸门（跨刷新重入的锚点；已被后续 order / jobEnd / incident 作废 ⇒ null） */
  readonly pendingGate: (SessionEvent & { type: 'gateAsked' }) | null
  /** 会话级放行（allow-always 一次即开） */
  readonly allowAlways: boolean
}

/** 从事件流水重建会话视图（与实时构建同一函数 ⇒ N6"重放 = 视图重建"天然成立） */
export function replayView(events: readonly SessionEvent[]): SessionView {
  const jobs: JobView[] = []
  let pendingGate: (SessionEvent & { type: 'gateAsked' }) | null = null
  let allowAlways = false
  const answered = new Set<string>()
  for (const e of events) {
    if (e.type === 'gateAnswered') {
      answered.add(e.gateId)
      if (e.answer === 'allow-always') allowAlways = true
      if (pendingGate?.gateId === e.gateId) pendingGate = null
    }
    // 作废口径（口径卡 §二）：用户新指令（order）/ jobEnd / incident 使未答闸门作废
    if (pendingGate && (e.type === 'order' || e.type === 'jobEnd' || e.type === 'incident')) pendingGate = null
    switch (e.type) {
      case 'order':
        jobs.push({ jobId: e.jobId, orderText: e.text, stages: null, rows: [], outcome: null })
        break
      case 'plan': {
        const last = jobs[jobs.length - 1]
        if (last) jobs[jobs.length - 1] = { ...last, stages: e.stages }
        break
      }
      case 'toolResult': {
        const last = jobs[jobs.length - 1]
        if (last) {
          const tool = [...events].reverse().find((c) => c.type === 'toolCall' && c.callId === e.callId)
          const row = { callId: e.callId, tool: tool?.type === 'toolCall' ? tool.tool : '?', ok: e.ok, content: e.content, detail: e.detail }
          jobs[jobs.length - 1] = { ...last, rows: [...last.rows.filter((r) => r.callId !== e.callId), row] }
        }
        break
      }
      case 'jobEnd': {
        const last = jobs[jobs.length - 1]
        if (last) jobs[jobs.length - 1] = { ...last, outcome: e }
        break
      }
      case 'gateAsked':
        if (!answered.has(e.gateId)) pendingGate = e
        break
      default:
        break
    }
  }
  return { jobs, pendingGate, allowAlways }
}

/** 持久化前的结构校验（①-36 validate-log：重放前校验事件结构与顺序）。
 *  对畸形事件（缺字段 / 非法形状）防御：记错误不抛——restore 截断逻辑依赖"坏即不通过"。 */
export function validateLog(events: readonly SessionEvent[]): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = []
  let expectedSeq = 0
  const gateIds = new Set<string>()
  const callIds = new Set<string>()
  let openJobId: string | null = null
  let lastJobIndex = -1
  let jobCounter = 0
  for (const e of events) {
    if (e === null || typeof e !== 'object' || typeof e.type !== 'string') {
      errors.push(`事件 #${expectedSeq} 不是合法事件对象`)
      expectedSeq++
      continue
    }
    if (e.seq !== expectedSeq) errors.push(`事件 ${e.type}#${String(e.seq)} 序号不连续（期望 ${expectedSeq}）`)
    expectedSeq = (typeof e.seq === 'number' ? e.seq : expectedSeq) + 1
    if (typeof e.jobId !== 'string') {
      errors.push(`事件 ${e.type}#${String(e.seq)} 缺 jobId`)
      continue
    }
    const jobNum = Number(e.jobId.slice('job-'.length))
    if (!Number.isInteger(jobNum)) errors.push(`事件 ${e.type} 的 jobId 形状不对：${e.jobId}`)
    if (e.type === 'order') {
      jobCounter++
      if (jobNum !== jobCounter) errors.push(`order 的 jobId 应为 job-${jobCounter}（收到 ${e.jobId}）`)
      if (openJobId !== null) errors.push(`order ${e.jobId} 出现时上一 job ${openJobId} 未收口`)
      openJobId = e.jobId
      lastJobIndex = jobNum
    } else {
      if (jobNum !== lastJobIndex) errors.push(`事件 ${e.type}#${String(e.seq)} 不属于当前 job（${e.jobId} ≠ job-${lastJobIndex}）`)
      if (e.type === 'jobEnd') openJobId = null
      if (e.type === 'gateAsked') gateIds.add(e.gateId)
      if (e.type === 'gateAnswered' && !gateIds.has(e.gateId)) errors.push(`gateAnswered 引用不存在的闸门 ${String(e.gateId)}`)
      if (e.type === 'toolCall') callIds.add(e.callId)
      if (e.type === 'toolResult' && !callIds.has(e.callId)) errors.push(`toolResult 引用不存在的调用 ${String(e.callId)}`)
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true }
}

/**
 * 会话日志（内存态 + 持久化）。append 是唯一写入口：编号（job/gate/call）从既有事件派生 ⇒
 * 刷新重建后续号正确（"重试计数 / 预算读日志，重载不清零"的地基）。
 */
export class SessionLog {
  readonly events: SessionEvent[] = []
  private store: SessionStore

  constructor(store: SessionStore = new MemorySessionStore()) {
    this.store = store
    this.restore()
  }

  /** 从持久化恢复（结构校验失败 ⇒ 从最后一个合法前缀截断，坏尾巴丢弃——容错不崩） */
  restore(): { restored: number; droppedBadTail: boolean } {
    const raw = this.store.load()
    this.events.length = 0
    if (!raw) return { restored: 0, droppedBadTail: false }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { restored: 0, droppedBadTail: true }
    }
    if (!Array.isArray(parsed)) return { restored: 0, droppedBadTail: true }
    const events = parsed as SessionEvent[]
    // 找最长合法前缀
    let good = events.length
    for (let n = events.length; n >= 0; n--) {
      const check = validateLog(events.slice(0, n))
      if (check.ok) {
        good = n
        break
      }
    }
    this.events.push(...events.slice(0, good))
    return { restored: good, droppedBadTail: good < events.length }
  }

  append(e: AppendableEvent): SessionEvent {
    const jobId = e.jobId ?? this.currentJobId() ?? `job-${this.nextJobNum()}`
    const full = { ...e, jobId, seq: this.events.length, ts: Date.now() } as SessionEvent
    this.events.push(full)
    this.persist()
    return full
  }

  private persist(): void {
    try {
      this.store.save(JSON.stringify(this.events))
    } catch {
      // 序列化失败（理论不可达）：保持内存态
    }
  }

  // ── 编号派生 ──

  nextJobNum(): number {
    let max = 0
    for (const e of this.events) {
      const n = Number(e.jobId.slice('job-'.length))
      if (Number.isInteger(n) && n > max) max = n
    }
    return max + 1
  }

  nextGateId(): string {
    return `gate-${this.countType('gateAsked') + 1}`
  }

  nextCallId(): string {
    return `call-${this.countType('toolCall') + 1}`
  }

  private countType(type: SessionEvent['type']): number {
    let n = 0
    for (const e of this.events) if (e.type === type) n++
    return n
  }

  /** 当前未收口的 job（最后一条 order 之后没有 jobEnd） */
  currentJobId(): string | null {
    let current: string | null = null
    for (const e of this.events) {
      if (e.type === 'order') current = e.jobId
      if (e.type === 'jobEnd' && e.jobId === current) current = null
    }
    return current
  }

  /** 当前 job 的 order 事件（挂起闸门续跑时重建消息用） */
  currentOrder(): (SessionEvent & { type: 'order' }) | null {
    const jobId = this.currentJobId()
    if (jobId === null) return null
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i]
      if (e.type === 'order' && e.jobId === jobId) return e
    }
    return null
  }

  /** 会话视图（实时构建 = replayView 同函数 ⇒ N6） */
  view(): SessionView {
    return replayView(this.events)
  }

  /** gateAnswered ≠ allow ⇒ 该调用在日志里不得有 toolResult（V3 / N7 对账断言的读数面） */
  gateOutcome(gateId: string): GateAnswer | null {
    for (const e of this.events) {
      if (e.type === 'gateAnswered' && e.gateId === gateId) return e.answer
    }
    return null
  }

  /** 某 job 已落档的计划次数（≤2 防计划空转，①-4） */
  planCommits(jobId: string): number {
    return this.events.filter((e) => e.type === 'plan' && e.jobId === jobId).length
  }

  /** 某 job 已消耗的轮次（usage 事件数；轮预算 24 的读数） */
  roundsUsed(jobId: string): number {
    return this.events.filter((e) => e.type === 'usage' && e.jobId === jobId).length
  }

  /** 某 job 的可重试 incident 次数（重试计数读日志——重载不清零，①-17） */
  retryableIncidents(jobId: string): number {
    return this.events.filter((e) => e.type === 'incident' && e.jobId === jobId && e.retryable === true).length
  }

  /** 清空会话（面板「新会话」入口；项目文件不受影响） */
  clear(): void {
    this.events.length = 0
    this.store.clear()
  }
}
