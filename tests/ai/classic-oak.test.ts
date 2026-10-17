// r05 收尾 · 件二（跨轮测试资产）· **「造一棵树」脚本化用例**（2026-10-17 去贴图化：提示词改为通用口径）。
//
// 来源 = 用户 `MT-01` 实测回报（人工单 §实测回报）：原句含已移除的贴图体系关键词，去化后改为「造一棵树」；
// 脚本化 provider 只回放预设调用序列 ⇒ 提示词文字不影响本用例判据。用例化证据 = `verify-261008b` §A-④ / §C-④。
//
// 口径（与 `typical-utterances` / `ai-loop` 同形）：**一句话 → 脚本化 provider 的操作序列 → 终态摘要**。
// 断言 = ① 操作序列（`update_plan` 1 段 + 4 条 `preset_shape` 写）② 终态摘要（`digest` / `nonEmpty` /
// `patches` / `rows` / 逐层块数 / bbox / 构件表）固定 ③ **两条独立实例逐字相等**（L2 可复算口径）。
//
// 覆盖边界（必须与实现分寸一致，取自回执单）：脚本化 provider **只回放预设调用序列** ⇒ 本用例证明的是
// **"工具面表达得下 + 终态可复算 + 一次运行收口 `done`"**，**不证明**"真模型能把这句中文推成这个序列"
// （后者要真 provider，属人工面 `MT-*`）。
//
// 两条工具面事实（回执单已记，本用例按事实选型，不是绕开）：
//  ① `brush` 每维上限 = 4（`AI_LIMITS.brushMaxAxis`，设计值非缺陷）⇒ 5×5 树冠层用 `preset_shape` 的 `box` 铺；
//  ② `preset_shape` 的 `cylinder` 在 1×1 截面下退化（`debug-261008` 件二：现象不复现、零改动）⇒ 树干用 `box`。
import { describe, expect, it } from 'vitest'
import { AgentSession } from '../../src/ai/agent'
import { makeScriptedAdapter, roundStep } from '../../src/ai/scripted-provider'
import type { WireStep } from '../../src/ai/scripted-provider'
import { MemorySessionStore } from '../../src/ai/session-log'
import { Editor } from '../../src/edit/editor'
import { useEditorUi } from '../../src/state/editor-store'

/** prompt 字面（2026-10-17 去贴图化后的通用提示） */
const PROMPT = '造一棵树'

/** 脚本 = 操作序列（1 段计划 + 4 条 `preset_shape` 写）：树干 1×3×1 → 树冠 5×5 → 3×3 → 1×1 */
const OAK_SCRIPT: readonly WireStep[] = [
  roundStep({ calls: [{ id: 'p1', name: 'update_plan', args: { stages: ['立树干', '铺树冠', '收口'] } }] }),
  roundStep({ calls: [{ id: 'w1', name: 'preset_shape', args: { shape: 'box', origin_x: 0, origin_y: 0, origin_z: 0, size_x: 1, size_y: 3, size_z: 1, key: 'color:brown' } }] }),
  roundStep({ calls: [{ id: 'w2', name: 'preset_shape', args: { shape: 'box', origin_x: -2, origin_y: 3, origin_z: -2, size_x: 5, size_y: 1, size_z: 5, key: 'color:green' } }] }),
  roundStep({ calls: [{ id: 'w3', name: 'preset_shape', args: { shape: 'box', origin_x: -1, origin_y: 4, origin_z: -1, size_x: 3, size_y: 1, size_z: 3, key: 'color:green' } }] }),
  roundStep({ calls: [{ id: 'w4', name: 'preset_shape', args: { shape: 'box', origin_x: 0, origin_y: 5, origin_z: 0, size_x: 1, size_y: 1, size_z: 1, key: 'color:green' } }] }),
  roundStep({ text: '橡树已生成：树干 3 格（color:brown，x=z=0 · y=0..2），树冠三层 5×5 / 3×3 / 1×1（color:green，y=3..5）。' }),
]

/** 一次完整运行 ⇒ 读回「操作序列 + 终态摘要」（两条独立实例各跑一次） */
async function runOak(): Promise<{
  calls: string[]
  outcomes: string[]
  rows: number
  patches: number
  nonEmpty: number
  digest: string
  parts: Array<{ id: string; name: string; blocks: number }>
  bbox: string
  layerSummary: string
  projectedNonEmpty: number
  projectedHint: string
}> {
  const editor = new Editor()
  const { adapter } = makeScriptedAdapter(OAK_SCRIPT)
  const session = new AgentSession(editor, { adapter, sessionStore: new MemorySessionStore(), sleep: async () => {} })
  session.setSettings({ oversight: 'yolo' }) // 不设闸门：本用例只锁"操作序列 + 终态"
  await session.sendOrder(PROMPT)

  const view = session.log.view()
  const job = view.jobs[0]!
  const s = useEditorUi.getState()
  const layerSummary = s.perLayerCounts.map((l) => `y=${l.y}:${l.count}`).join(' · ')
  const bbox = s.boundsReadout
    ? `${s.boundsReadout.min[0]}..${s.boundsReadout.max[0]} / ${s.boundsReadout.min[1]}..${s.boundsReadout.max[1]} / ${s.boundsReadout.min[2]}..${s.boundsReadout.max[2]}`
    : '无'
  return {
    calls: session.log.events
      .filter((e) => e.type === 'toolCall')
      .map((e) => (e.type === 'toolCall' ? `${e.tool}(${JSON.stringify(e.args)})` : '')),
    outcomes: view.jobs.map((j) => j.outcome?.outcome ?? '未收口'),
    rows: job.rows.length,
    patches: editor.log.patches.length,
    nonEmpty: editor.volume.nonEmptyCount,
    digest: editor.volume.digest().coordHash,
    parts: editor.parts.list().map((p) => ({ id: p.id, name: p.name, blocks: editor.parts.blockCount(p.id) })),
    bbox,
    layerSummary,
    projectedNonEmpty: s.nonEmpty,
    projectedHint: `构件 ${s.parts.length} · 组合 ${s.compositions.length} · 手工块 ${s.manualBlockCount}`,
  }
}

describe('④ 「造一棵树」脚本化用例（操作序列 + 终态摘要固定）', () => {
  it('操作序列可读回 + 终态摘要固定，且两份独立实例逐字相等', async () => {
    const a = await runOak()
    const b = await runOak()
    console.info('[④ A 操作序列] ' + JSON.stringify(a.calls))
    console.info('[④ A 终态摘要] ' + JSON.stringify({ ...a, calls: undefined }))
    console.info('[④ 可复算] A.digest === B.digest → ' + String(a.digest === b.digest))

    // 操作序列：1 段计划 + 4 条写（每步一个工具调用）
    expect(a.calls[0]!.startsWith('update_plan(')).toBe(true)
    expect(a.calls.slice(1).map((c) => c.split('(')[0])).toEqual(['preset_shape', 'preset_shape', 'preset_shape', 'preset_shape'])
    expect(a.rows).toBe(5)

    // 终态摘要（金牌值 = verify-261008b 回执单 §A-④ 的实测读数）
    expect(a.nonEmpty).toBe(38)
    expect(a.digest).toBe('014f5312')
    expect(a.patches).toBe(4)
    expect(a.outcomes).toEqual(['done'])
    expect(a.parts.map((p) => p.blocks)).toEqual([3, 25, 9, 1])
    expect(a.layerSummary).toBe('y=0:1 · y=1:1 · y=2:1 · y=3:25 · y=4:9 · y=5:1')
    expect(a.bbox).toBe('-2..2 / 0..5 / -2..2')
    expect(a.projectedNonEmpty).toBe(38)
    expect(a.projectedHint).toBe('构件 4 · 组合 0 · 手工块 0')

    // L2 可复算：两条独立实例逐字相等
    expect(b).toEqual(a)
  })
})
