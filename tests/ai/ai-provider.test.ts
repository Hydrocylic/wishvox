// r03 · T3/V2 provider 容错（L1）：注入 ≥4 类坏输入（半截 JSON / 畸形行 / 空流超时 / 5xx）⇒
// 不崩 + 有降级产物（badCalls / malformedLines 计数 / 错误三态）+ 重试梯照抄数字。
// 全部走**线级**脚本化 fetch——打的是 OpenAiCompatAdapter 的真 SSE 解析器。
import { describe, expect, it } from 'vitest'
import {
  IDLE_TIMEOUTS,
  OpenAiCompatAdapter,
  RETRY_LADDER,
  StreamAccumulator,
  chatWithRetry,
  classifyHttpError,
  screen,
} from '../../src/ai/provider'
import type { FetchLike, ProviderError } from '../../src/ai/provider'
import { emptyStreamStep, halfJsonStep, makeScriptedFetch, malformedLineStep, roundStep } from '../../src/ai/scripted-provider'

const ADAPTER_OPTS = { baseUrl: 'http://scripted.local', apiKey: 'k', model: 'm' }

describe('V2 · SSE 解析（合法路径）', () => {
  it('文本 + 工具调用批 + usage 全解析；参数是对象', async () => {
    const fetch = makeScriptedFetch([
      roundStep({ text: '好的，先看模型。', calls: [{ id: 'c1', name: 'recolor', args: { target_kind: 'all', to: 'color:red' } }] }),
    ])
    const adapter = new OpenAiCompatAdapter({ ...ADAPTER_OPTS, fetchImpl: fetch })
    const r = await adapter.chat({ messages: [{ role: 'user', content: 'hi' }], tools: [] })
    expect(r.text).toBe('好的，先看模型。')
    expect(r.calls).toEqual([{ id: 'c1', name: 'recolor', args: { target_kind: 'all', to: 'color:red' } }])
    expect(r.usage).toEqual({ promptTokens: 100, completionTokens: 20 })
    expect(r.finishReason).toBe('tool_calls')
  })

  it('工具调用参数跨流分片（arguments 逐段拼接）', () => {
    const acc = new StreamAccumulator()
    const arg = JSON.stringify({ target_kind: 'composition', target_id: 'comp-1', to: 'color:red' })
    const mid = Math.floor(arg.length / 2)
    acc.feed(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'recolor', arguments: arg.slice(0, mid) } }] } }] })}\n\n`)
    acc.feed(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: arg.slice(mid) } }] } }] })}\n\n`)
    acc.feed('data: [DONE]\n\n')
    const r = acc.result()
    expect(r.calls[0]!.args).toEqual({ target_kind: 'composition', target_id: 'comp-1', to: 'color:red' })
    expect(r.badCalls).toHaveLength(0)
  })
})

describe('V2 · 半截 JSON（注入 ①）', () => {
  it('截断的 arguments ⇒ badCalls（不执行、可辨认）', async () => {
    const fetch = makeScriptedFetch([halfJsonStep('c1', 'recolor', JSON.stringify({ target_kind: 'all', to: 'color:red', from: ['color:blue'] }))])
    const adapter = new OpenAiCompatAdapter({ ...ADAPTER_OPTS, fetchImpl: fetch })
    const r = await adapter.chat({ messages: [{ role: 'user', content: 'hi' }], tools: [] })
    expect(r.badCalls ?? []).toHaveLength(1)
    expect(r.badCalls?.[0]?.name).toBe('recolor')
    expect(r.calls).toHaveLength(0) // 坏调用不混进合法列表
  })

  it('半截事件行（行在包尾断开）⇒ 下一包续上（buffer 语义）', () => {
    const acc = new StreamAccumulator()
    const line = `data: ${JSON.stringify({ choices: [{ delta: { content: '你好' } }] })}\n\n`
    acc.feed(line.slice(0, 20)) // 包尾断行
    acc.feed(line.slice(20))
    acc.feed('data: [DONE]\n\n')
    expect(acc.text).toBe('你好')
    expect(acc.stats.malformedLines).toBe(0)
  })
})

describe('V2 · 畸形行（注入 ②）', () => {
  it('坏 JSON 行跳过计数、不崩，前后事件完好（降级产物 = 计数 + 存活文本）', async () => {
    const fetch = makeScriptedFetch([malformedLineStep()])
    const adapter = new OpenAiCompatAdapter({ ...ADAPTER_OPTS, fetchImpl: fetch })
    const r = await adapter.chat({ messages: [{ role: 'user', content: 'hi' }], tools: [] })
    expect(r.text).toBe('前后')
  })

  it('SSE 注释行 / 非 data 行忽略', () => {
    const acc = new StreamAccumulator()
    acc.feed(': keep-alive\n\nevent: ping\ndata: {not-json\n\n')
    acc.feed(`data: ${JSON.stringify({ choices: [{ delta: { content: 'x' } }] })}\n\n`)
    acc.feed('data: [DONE]\n\n')
    expect(acc.text).toBe('x')
    expect(acc.stats.malformedLines).toBe(1)
    expect(acc.stats.events).toBe(1)
  })
})

describe('V2 · 空流（注入 ③）', () => {
  it('零事件即 [DONE] ⇒ retryable ProviderError（"空流"）', async () => {
    const fetch = makeScriptedFetch([emptyStreamStep()])
    const adapter = new OpenAiCompatAdapter({ ...ADAPTER_OPTS, fetchImpl: fetch })
    await expect(adapter.chat({ messages: [{ role: 'user', content: 'hi' }], tools: [] })).rejects.toThrow(/空流/)
  })

  it('挂住的流（永不 enqueue）⇒ 空流超时 ⇒ retryable', async () => {
    // 手工构造永不完成的 reader，注入极小的首事件超时
    const never = new ReadableStream<Uint8Array>({ start() {} })
    const fake: FetchLike = async () => new Response(never, { status: 200 })
    const adapter = new OpenAiCompatAdapter({
      ...ADAPTER_OPTS,
      fetchImpl: fake,
      timeouts: { firstEventMs: 30, betweenEventsMs: 30 },
    })
    await expect(adapter.chat({ messages: [{ role: 'user', content: 'hi' }], tools: [] })).rejects.toThrow(/空流/) // 超时取消 ⇒ 0 事件 ⇒ retryable「空流」
  })
})

describe('V2 · HTTP 5xx / 鉴权（注入 ④）与三态分诊', () => {
  it('5xx ⇒ retryable；401 ⇒ fatal；404 ⇒ fatal；429 ⇒ retryable', () => {
    expect(classifyHttpError(503, 'oops').kind).toBe('retryable')
    expect(classifyHttpError(500, 'oops').kind).toBe('retryable')
    expect(classifyHttpError(401, 'bad key').kind).toBe('fatal')
    expect(classifyHttpError(404, 'no model').kind).toBe('fatal')
    expect(classifyHttpError(429, 'slow down').kind).toBe('retryable')
  })

  it('5xx 响应抛 retryable ProviderError（带状态码）', async () => {
    const fetch = makeScriptedFetch([{ status: 503, body: 'unavailable' }])
    const adapter = new OpenAiCompatAdapter({ ...ADAPTER_OPTS, fetchImpl: fetch })
    const caught = await adapter.chat({ messages: [{ role: 'user', content: 'hi' }], tools: [] }).catch((e: unknown) => e)
    const err = caught as ProviderError
    expect(err.kind).toBe('retryable')
    expect(err.message).toContain('503')
  })

  it('网络错误（fetch 抛）⇒ retryable', async () => {
    const fetch = makeScriptedFetch([{ networkError: 'connection refused' }])
    const adapter = new OpenAiCompatAdapter({ ...ADAPTER_OPTS, fetchImpl: fetch })
    const caught = await adapter.chat({ messages: [{ role: 'user', content: 'hi' }], tools: [] }).catch((e: unknown) => e)
    expect((caught as ProviderError).kind).toBe('retryable')
  })
})

describe('V2 · 重试梯（照抄数字：≤5 次 / 退避 1000×2^n 封顶 30s / 抖动 [0.75,1]）', () => {
  it('两次 5xx 后成功 ⇒ 共 3 次尝试，退避序列 = 1000、2000（抖动固定 1）', async () => {
    const sleeps: number[] = []
    const fetch = makeScriptedFetch([{ status: 500 }, { status: 500 }, roundStep({ text: 'done' })])
    const adapter = new OpenAiCompatAdapter({ ...ADAPTER_OPTS, fetchImpl: fetch })
    const outcome = await chatWithRetry(adapter, { messages: [{ role: 'user', content: 'hi' }], tools: [] }, {
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      random: () => 1, // 抖动上界 ⇒ 退避 = 名义值
    })
    expect(outcome.result?.text).toBe('done')
    expect(outcome.attempts).toBe(3)
    expect(sleeps).toEqual([1000, 2000])
  })

  it('连续 5 次失败 ⇒ 出梯（attempts=5），错误可重试类', async () => {
    const fetch = makeScriptedFetch([{ status: 500 }, { status: 500 }, { status: 500 }, { status: 500 }, { status: 500 }])
    const adapter = new OpenAiCompatAdapter({ ...ADAPTER_OPTS, fetchImpl: fetch })
    const outcome = await chatWithRetry(adapter, { messages: [{ role: 'user', content: 'hi' }], tools: [] }, {
      sleep: async () => {},
      random: () => 0.75,
    })
    expect(outcome.error?.kind).toBe('retryable')
    expect(outcome.attempts).toBe(RETRY_LADDER.maxAttempts)
  })

  it('fatal（401）不走梯——第一次尝试就出', async () => {
    const fetch = makeScriptedFetch([{ status: 401, body: 'bad key' }])
    const adapter = new OpenAiCompatAdapter({ ...ADAPTER_OPTS, fetchImpl: fetch })
    let slept = 0
    const outcome = await chatWithRetry(adapter, { messages: [{ role: 'user', content: 'hi' }], tools: [] }, {
      sleep: async () => {
        slept++
      },
    })
    expect(outcome.error?.kind).toBe('fatal')
    expect(outcome.attempts).toBe(1)
    expect(slept).toBe(0)
  })
})

describe('T3 · 本地预检 screen()（①-3：不过网即可拒单）', () => {
  it('空 / 太短 / 纯寒暄拒单；正常编辑指令放行', () => {
    expect(screen('')).toEqual({ pass: false, reason: expect.stringContaining('空') })
    expect(screen('   ')).toEqual({ pass: false, reason: expect.stringContaining('空') })
    expect(screen('好')).toEqual({ pass: false, reason: expect.stringContaining('短') })
    expect(screen('你好')).toEqual({ pass: false, reason: expect.stringContaining('纯聊天') })
    expect(screen('hello!')).toEqual({ pass: false, reason: expect.stringContaining('纯聊天') })
    expect(screen('把屋顶改成红色')).toEqual({ pass: true })
    expect(screen('在旁边放一个 8×8×8 的空心红盒')).toEqual({ pass: true })
  })
})

describe('T3 · 常量照抄检查（先例数字，不发明）', () => {
  it('空流超时 300s/120s；重试梯 5 次 / 30s 封顶', () => {
    expect(IDLE_TIMEOUTS).toEqual({ firstEventMs: 300_000, betweenEventsMs: 120_000 })
    expect(RETRY_LADDER.maxAttempts).toBe(5)
    expect(RETRY_LADDER.maxDelayMs).toBe(30_000)
    expect(RETRY_LADDER.baseDelayMs).toBe(1000)
  })
})

// ── 续单 §7.3A：脚本化流设施的有界红例（先 FAIL 后绿）──
// 边界教训：微任务自锁下（每次 read() 立刻在微任务里 resolve）**计时器永远得不到调度**——
// 用 Promise.race + setTimeout 判红会先 OOM 崩进程。因此红界用**读段计数**（同步判定，不依赖宏任务）。

describe('T9 · 脚本化 SSE 流设施（续单 §7.3A 红例 → 绿）', () => {
  it('脚本化流在 ≤64 段内读尽并 done——不许无限重放同一段（曾致 ai-loop 27 例进程级挂起）', async () => {
    const fetch = makeScriptedFetch([roundStep({ text: 'x' })])
    const res = await fetch('http://scripted.local/chat/completions', { method: 'POST' })
    expect(res.body).not.toBeNull()
    const reader = res.body!.getReader()
    let bytes = 0
    let chunks = 0
    for (;;) {
      if (chunks > 64) {
        throw new Error(`红例：读了 ${chunks} 段仍未 done（${bytes} 字节）——疑似同一段无限重放（makeResponse 的游标不自增）`)
      }
      const r = await reader.read()
      if (r.done) break
      bytes += r.value?.length ?? 0
      chunks++
    }
    expect(bytes).toBeGreaterThan(0)
    expect(chunks).toBeLessThanOrEqual(8) // roundStep 正常 ≤6 段；修复后远小于计数红界
  })

  it('真解析器在 [DONE] 处收手（续单 §7.2 次要加固）——即使底层流在 [DONE] 后还有数据且不 close', async () => {
    // 注入式计数假计时器：第 8 次设置时同步触发 cancel ⇒ 即使读流不终止，也在 ≤8 段内有界收束（防 OOM）
    let sets = 0
    const fireAt = 8
    const fakeTimer = (fn: () => void, _ms: number): { cancel: () => void } => {
      sets++
      if (sets >= fireAt) {
        fn()
        return { cancel: () => {} }
      }
      return { cancel: () => {} }
    }
    const encoder = new TextEncoder()
    const fetchWithDone = async (): Promise<Response> =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: '好' } }] })}\n\n`))
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            // [DONE] 之后仍有数据、且本流不 close（模拟代理不断流）——解析器应在 [DONE] 收手
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: '多余的' } }] })}\n\n`))
          },
        }),
        { status: 200 },
      )
    const adapter = new OpenAiCompatAdapter({
      ...ADAPTER_OPTS,
      fetchImpl: fetchWithDone,
      timeouts: { firstEventMs: 60_000, betweenEventsMs: 60_000 },
      timeoutDeps: { setTimeoutFn: fakeTimer },
    })
    const r = await adapter.chat({ messages: [{ role: 'user', content: 'hi' }], tools: [] })
    expect(r.text).toBe('好') // 红态：无 [DONE] 收手 ⇒ '多余的' 也会进结果（有界失败而非挂起）
  })
})
