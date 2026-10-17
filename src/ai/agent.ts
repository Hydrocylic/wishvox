// r03 · AgentSession 门面：Editor + SessionLog + GateBroker + provider 装配（UI / harness 的唯一入口）。
// BYOK：adapter 由设置（浏览器本地 key）构造；未填 key ⇒ 本地报错，不出网。
import { Editor } from '../edit/editor'
import { useAiUi } from '../state/ai-store'
import { GateBroker } from './gates'
import type { Oversight } from './gates'
import { AgentLoop } from './loop'
import type { LoopPhase, RunJobOptions } from './loop'
import { OpenAiCompatAdapter } from './provider'
import type { ProviderAdapter, WireState } from './provider'
import { SessionLog } from './session-log'
import type { GateAnswer, SessionEvent } from './session-log'
import { DEFAULT_AI_SETTINGS } from './settings'
import type { AiSettings, AiSettingsStore } from './settings'
import { createSettingsStore } from './settings'
import { createSessionStore } from './session-log'

interface AgentSessionDeps {
  readonly settingsStore?: AiSettingsStore
  readonly sessionStore?: Parameters<SessionLog['append']> extends never ? never : ConstructorParameters<typeof SessionLog>[0]
  readonly adapter?: ProviderAdapter
  readonly sleep?: (ms: number) => Promise<void>
}

export class AgentSession {
  readonly log: SessionLog
  readonly broker: GateBroker
  private settings: AiSettings
  private settingsStore: AiSettingsStore
  private customAdapter: ProviderAdapter | null
  private depsSleep: ((ms: number) => Promise<void>) | undefined
  private running = false

  constructor(
    private readonly editor: Editor,
    deps: AgentSessionDeps = {},
  ) {
    this.settingsStore = deps.settingsStore ?? createSettingsStore()
    this.settings = this.settingsStore.load()
    this.log = new SessionLog(deps.sessionStore ?? createSessionStore())
    this.broker = new GateBroker(this.log)
    this.customAdapter = deps.adapter ?? null
    this.depsSleep = deps.sleep
    this.pushView()
  }

  getSettings(): AiSettings {
    return { ...this.settings }
  }

  setSettings(patch: Partial<AiSettings>): AiSettings {
    this.settings = { ...this.settings, ...patch }
    this.settingsStore.save(this.settings)
    this.pushView()
    return { ...this.settings }
  }

  private adapter(): ProviderAdapter {
    if (this.customAdapter) return this.customAdapter // tests / harness 注入
    // T8（§4 件一）：真适配器把流内空闲/流式翻转接到 store；注入适配器由 loop 的重试梯上报
    return new OpenAiCompatAdapter({
      baseUrl: this.settings.baseUrl,
      apiKey: this.settings.apiKey,
      model: this.settings.model,
      onWireState: (s) => this.setWire(s),
    })
  }

  private options(): RunJobOptions {
    return { oversight: this.settings.oversight as Oversight, language: this.settings.language }
  }

  private makeLoop(): AgentLoop {
    return new AgentLoop(this.editor, this.log, this.broker, this.adapter(), {
      ...(this.depsSleep ? { sleep: this.depsSleep } : {}),
      onEvent: (e: SessionEvent) => {
        this.pushView(e)
      },
      onPhase: (p) => this.setPhase(p),
      onWire: (s) => this.setWire(s),
    })
  }

  /** 发一句话（新 job；若有挂起 job 先作废收口） */
  async sendOrder(text: string): Promise<void> {
    if (this.running) return
    this.running = true
    useAiUi.setState({ running: true, error: null })
    try {
      await this.makeLoop().runJob(text, this.options())
    } catch (e) {
      // 循环外的意外异常：降级为 incident + jobEnd（REQ-011：必有产物，不空手）
      const jobId = this.log.currentJobId()
      if (jobId !== null) {
        this.log.append({ type: 'incident', jobId, errorClass: 'unexpected', message: (e as Error).message })
        this.log.append({ type: 'jobEnd', jobId, outcome: 'incident', summary: `意外错误：${(e as Error).message}——可一键重试` })
      }
      useAiUi.setState({ error: (e as Error).message })
    } finally {
      this.running = false
      useAiUi.setState({ running: false })
      this.setPhase({ kind: 'idle' })
      this.pushView()
    }
  }

  /** 闸门答案（UI 问答件入口） */
  answerGate(gateId: string, answer: GateAnswer, words?: string): void {
    this.broker.answer(gateId, answer, words)
    this.pushView()
  }

  /** 一键重试（最近一条 order 重跑） */
  async retryLast(): Promise<void> {
    if (this.running) return
    this.running = true
    useAiUi.setState({ running: true, error: null })
    try {
      await this.makeLoop().retryLast(this.options())
    } catch (e) {
      useAiUi.setState({ error: (e as Error).message })
    } finally {
      this.running = false
      useAiUi.setState({ running: false })
      this.setPhase({ kind: 'idle' })
      this.pushView()
    }
  }

  /** 刷新后启动：重入未答闸门或补执行"已批未执行"的调用（V4：重入而非重问）。
   *  有未收口的 job 即续跑——只认 pendingGate 会漏掉"刷新窗口内已作答"的形态（V4 实测教训）。 */
  async resumeIfPending(): Promise<boolean> {
    if (this.running) return false
    if (this.log.currentJobId() === null) return false
    this.running = true
    useAiUi.setState({ running: true })
    try {
      return await this.makeLoop().resume(this.options())
    } catch (e) {
      useAiUi.setState({ error: (e as Error).message })
      return false
    } finally {
      this.running = false
      useAiUi.setState({ running: false })
      this.setPhase({ kind: 'idle' })
      this.pushView()
    }
  }

  canRetry(): boolean {
    return this.log.events.some((e) => e.type === 'order')
  }

  clearSession(): void {
    this.log.clear()
    this.pushView()
  }

  /** T8（§4 件一）：线级状态 → UI store（provider 与重试梯同一 sink） */
  private setWire(s: WireState): void {
    useAiUi.setState({ wire: s })
  }

  /** T8（§4 件二）：相位 → UI store（同 kind 保留计时起点，换 kind 重置） */
  private setPhase(p: LoopPhase): void {
    const cur = useAiUi.getState().phase
    const since = cur !== null && cur.kind === p.kind ? cur.since : Date.now()
    useAiUi.setState({ phase: { ...p, since } })
  }

  /** 会话视图 → UI store（面板渲染的唯一来源） */
  pushView(_e?: SessionEvent): void {
    const view = this.log.view()
    useAiUi.setState({
      view: {
        jobs: view.jobs,
        pendingGate: view.pendingGate,
        allowAlways: view.allowAlways,
      },
      settings: { ...this.settings },
      roundsUsed: this.log.currentJobId() !== null ? this.log.roundsUsed(this.log.currentJobId()!) : 0,
    })
  }
}

export { DEFAULT_AI_SETTINGS }
