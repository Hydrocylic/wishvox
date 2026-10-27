// S2 · wire 形状（G3a）：把 ProviderMessage / AiToolSchema 转成 Chat Completions 数组。
// 覆盖：单模态原样（不改变既有 wire 形状）、assistant 工具调用、tool 回包、
// user 多模态 content parts、空 tools 不发送、非空 tools 保留。
import { describe, expect, it } from 'vitest'
import { toWireMessages, toWireTools } from '../../src/ai/wire'
import { OpenAiCompatAdapter } from '../../src/ai/provider'
import type { AiToolSchema } from '../../src/ai/tools'
import { makeScriptedFetch, roundStep } from '../../src/ai/scripted-provider'

const TOOL: AiToolSchema = {
  name: 'undo',
  description: '撤销最近的 AI 写',
  parameters: { type: 'object', properties: {}, required: [] },
  readOnly: false,
  wideStatic: true,
}

describe('wire · toWireMessages', () => {
  it('system / user 纯文本保持单模态形状（无 images 时与既有完全一致）', () => {
    expect(
      toWireMessages([
        { role: 'system', content: 's' },
        { role: 'user', content: 'u' },
      ]),
    ).toEqual([
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
    ])
  })

  it('user content=null ⇒ 空串（不发 null）', () => {
    expect(toWireMessages([{ role: 'user', content: null }])).toEqual([{ role: 'user', content: '' }])
  })

  it('assistant 带工具调用 ⇒ tool_calls 数组 + arguments 为 JSON 字符串', () => {
    const wire = toWireMessages([
      { role: 'assistant', content: null, toolCalls: [{ id: 'c1', name: 'undo', args: { steps: 1 } }] },
    ])
    expect(wire[0]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'undo', arguments: '{"steps":1}' } }],
    })
  })

  it('assistant 无工具调用 ⇒ 不带空 tool_calls 键', () => {
    const wire = toWireMessages([{ role: 'assistant', content: '好' }])
    expect(wire[0]).toEqual({ role: 'assistant', content: '好' })
    expect('tool_calls' in (wire[0] as object)).toBe(false)
  })

  it('tool 回包 ⇒ tool_call_id + content（null ⇒ 空串）', () => {
    expect(toWireMessages([{ role: 'tool', content: null, toolCallId: 'c1' }])).toEqual([
      { role: 'tool', tool_call_id: 'c1', content: '' },
    ])
  })

  it('user 带 images + 文本 ⇒ text 段 + image_url 段', () => {
    expect(toWireMessages([{ role: 'user', content: '看图', images: ['data:image/png;base64,AAA'] }])).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: '看图' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
        ],
      },
    ])
  })

  it('user 带 images 且文本为空 ⇒ 只出 image_url 段', () => {
    expect(toWireMessages([{ role: 'user', content: '', images: ['https://x/y.png'] }])).toEqual([
      { role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://x/y.png' } }] },
    ])
  })

  it('user 的 images=[] ⇒ 回退纯文本（不产生空 parts）', () => {
    expect(toWireMessages([{ role: 'user', content: 'hi', images: [] }])).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('非 user 角色带 images ⇒ 不拼 parts（只 user 走多模态）', () => {
    expect(toWireMessages([{ role: 'assistant', content: 'a', images: ['data:x'] }])).toEqual([
      { role: 'assistant', content: 'a' },
    ])
  })
})

describe('wire · toWireTools', () => {
  it('空工具面 ⇒ []', () => {
    expect(toWireTools([])).toEqual([])
  })

  it('字段映射：name / description / parameters 原样', () => {
    expect(toWireTools([TOOL])).toEqual([
      { type: 'function', function: { name: 'undo', description: '撤销最近的 AI 写', parameters: TOOL.parameters } },
    ])
  })
})

describe('wire · 适配器请求体', () => {
  it('空 tools ⇒ 请求体不带 "tools" 键', async () => {
    const captured: { body: Record<string, unknown> | null } = { body: null }
    const fetch = makeScriptedFetch([roundStep({ text: 'ok' })], {
      onRequest: (b) => {
        captured.body = b as Record<string, unknown>
      },
    })
    const adapter = new OpenAiCompatAdapter({ baseUrl: 'http://scripted.local', apiKey: 'k', model: 'm', fetchImpl: fetch })
    await adapter.chat({ messages: [{ role: 'user', content: 'hi' }], tools: [] })
    expect(captured.body).not.toBeNull()
    expect(Object.prototype.hasOwnProperty.call(captured.body, 'tools')).toBe(false)
  })

  it('非空 tools ⇒ 请求体保留 tools 数组', async () => {
    const captured: { body: Record<string, unknown> | null } = { body: null }
    const fetch = makeScriptedFetch([roundStep({ text: 'ok' })], {
      onRequest: (b) => {
        captured.body = b as Record<string, unknown>
      },
    })
    const adapter = new OpenAiCompatAdapter({ baseUrl: 'http://scripted.local', apiKey: 'k', model: 'm', fetchImpl: fetch })
    await adapter.chat({ messages: [{ role: 'user', content: 'hi' }], tools: [TOOL] })
    const tools = captured.body!.tools as unknown[]
    expect(Array.isArray(tools)).toBe(true)
    expect(tools).toHaveLength(1)
  })

  it('user 带图 ⇒ 请求体 messages[0].content 为 parts', async () => {
    const captured: { body: Record<string, unknown> | null } = { body: null }
    const fetch = makeScriptedFetch([roundStep({ text: 'ok' })], {
      onRequest: (b) => {
        captured.body = b as Record<string, unknown>
      },
    })
    const adapter = new OpenAiCompatAdapter({ baseUrl: 'http://scripted.local', apiKey: 'k', model: 'm', fetchImpl: fetch })
    await adapter.chat({
      messages: [{ role: 'user', content: '看图', images: ['data:image/png;base64,AAA'] }],
      tools: [],
    })
    const messages = captured.body!.messages as Array<Record<string, unknown>>
    expect(Array.isArray(messages[0]!.content)).toBe(true)
    expect((messages[0]!.content as unknown[])[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,AAA' },
    })
  })
})
