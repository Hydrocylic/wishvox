// r03 · 脚本化 provider（T9 验证设施 / L4 行为回归集的驱动器）：
// 在**线级**（SSE 字节流）注入预设响应——半截 JSON / 畸形行 / 空流 / 5xx / 网络错误都从这进，
// 打的是 OpenAiCompatAdapter 的真解析器（不是绕过它另写一个假适配器）。
import type { FetchLike, ProviderAdapter } from './provider'
import { OpenAiCompatAdapter } from './provider'

export type WireStep =
  | { readonly ok: readonly string[] } // 逐段 SSE 文本（每段可含多行；'data: {...}\n\n'）
  | { readonly status: number; readonly body?: string } // HTTP 错误（5xx / 429 / 401 …）
  | { readonly networkError: string } // fetch 直接抛（网络层）
  | { readonly hang: true } // 挂住不回（空流超时注入）
  | { readonly then: readonly WireStep[] } // 序列展开（一步内多段）

interface ScriptedFetchDeps {
  /** 拿到请求体（测试断言 messages / tools 用） */
  readonly onRequest?: (body: unknown) => void
}

function sseData(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`
}

function textDelta(content: string): string {
  return sseData({ choices: [{ delta: { content } }] })
}

/** 一次 assistant 回合的合法 wire 段：文本 + 工具调用批（arguments 整段一次给足） */
export function roundStep(opts: {
  text?: string
  calls?: ReadonlyArray<{ id: string; name: string; args: Record<string, unknown> }>
  finishReason?: string
}): WireStep {
  const parts: string[] = []
  if (opts.text) parts.push(textDelta(opts.text))
  if (opts.calls && opts.calls.length > 0) {
    parts.push(
      sseData({
        choices: [
          {
            delta: {
              tool_calls: opts.calls.map((c, i) => ({
                index: i,
                id: c.id,
                function: { name: c.name, arguments: JSON.stringify(c.args) },
              })),
            },
          },
        ],
      }),
    )
  }
  parts.push(sseData({ choices: [{ delta: {}, finish_reason: opts.finishReason ?? (opts.calls?.length ? 'tool_calls' : 'stop') }] }))
  parts.push(sseData({ choices: [{ delta: {} }], usage: { prompt_tokens: 100, completion_tokens: 20 } }))
  parts.push('data: [DONE]\n\n')
  return { ok: parts }
}

/** 半截 JSON 注入（V2 ①）：工具调用参数截断在任意字节 */
export function halfJsonStep(callId: string, name: string, argsJson: string): WireStep {
  const cut = argsJson.slice(0, Math.max(1, Math.floor(argsJson.length / 2)))
  return {
    ok: [
      sseData({ choices: [{ delta: { tool_calls: [{ index: 0, id: callId, function: { name, arguments: cut } }] } }] }),
      'data: [DONE]\n\n',
    ],
  }
}

/** 畸形行注入（V2 ②）：夹在两段合法事件中间的坏 JSON / 坏 UTF-8 形状 */
export function malformedLineStep(): WireStep {
  return { ok: [textDelta('前'), 'data: {not-json\n\n', 'data: [garbage]]\n\n', textDelta('后'), 'data: [DONE]\n\n'] }
}

/** 空流注入（V2 ③）：连接成功但零事件即 [DONE]（触发"空流"分类） */
export function emptyStreamStep(): WireStep {
  return { ok: ['data: [DONE]\n\n'] }
}

function makeResponse(steps: readonly string[], init?: ResponseInit): Response {
  const encoder = new TextEncoder()
  const chunks = steps.map((s) => encoder.encode(s))
  let i = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      // §7.2 主因修复：游标必须前进，读尽即 close——否则同一段被无限重放、流永不 done，
      // 与 readStreamWithIdleTimeout 的 for(;;) 组成微任务自锁（ai-loop 27 例进程级挂起的根因）。
      if (i < chunks.length) controller.enqueue(chunks[i++]!)
      else controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' }, ...init })
}

/** 脚本化 fetch：按脚本逐请求消费（第 n 次请求吃第 n 步）；越界 ⇒ 报错 */
export function makeScriptedFetch(script: readonly WireStep[], deps: ScriptedFetchDeps = {}): FetchLike & { calls: number } {
  let used = 0
  const fn = async (_input: string, init: RequestInit): Promise<Response> => {
    const step = script[used]
    used++
    if (step === undefined) throw new Error(`scripted-fetch: 脚本用尽（第 ${used} 次请求没有预设步骤）`)
    try {
      deps.onRequest?.(init.body ? JSON.parse(String(init.body)) : null)
    } catch {
      deps.onRequest?.(null)
    }
    if ('networkError' in step) throw new TypeError(step.networkError)
    if ('status' in step) return new Response(step.body ?? `{"error":{"message":"scripted ${step.status}"}}`, { status: step.status })
    if ('hang' in step) {
      return new Response(
        new ReadableStream<Uint8Array>({
          start() {
            // 永不 enqueue：读者将等到超时（注入空流超时的理想形状）
          },
        }),
        { status: 200 },
      )
    }
    if ('then' in step) {
      const merged = step.then.flatMap((s) => ('ok' in s ? s.ok : []))
      return makeResponse(merged)
    }
    return makeResponse(step.ok)
  }
  return Object.assign(fn, { get calls() { return used } })
}

/** 脚本化适配器 = 真 OpenAiCompatAdapter + 脚本化 fetch（L4 重放全用它） */
export function makeScriptedAdapter(script: readonly WireStep[], opts: { onRequest?: (body: unknown) => void } = {}): {
  adapter: ProviderAdapter
  fetch: ReturnType<typeof makeScriptedFetch>
} {
  const fetch = makeScriptedFetch(script, { onRequest: opts.onRequest })
  const adapter = new OpenAiCompatAdapter({ baseUrl: 'http://scripted.local', apiKey: 'test-key', model: 'scripted-model', fetchImpl: fetch })
  return { adapter, fetch }
}

// r04 T7（§3.1 #1-#3）：DirectAdapter / wireMessagesSummary / toolCallOf 三个零引用成员已删
// （实现可从 cb04a0b 取回；连带删除 5 个 provider 类型的再导出行——同样零外部消费者）。
// 连带勘正：DirectAdapter 的原注释自称"不走向线——纯函数级测试与 harness 的轻量路径"，与实况不符——
// 测试与 harness 三处（tests/ai-provider · tests/ai-loop · harness/agent-loop）全部走
// makeScriptedFetch / makeScriptedAdapter，打的是 OpenAiCompatAdapter 的真解析器，从未用过直答适配器。

