// r05 · debug-261008 件二（复核用例）：`preset_shape` 的 `cylinder` / `sphere` 在 **1×1 截面 / 单体** 下
// 是否退化为 0 块。
//
// **本件实测结论：现象不复现（首跑即绿）** —— 派工单 §2 与 `verify-261008b` §A-④ 的读码推导都漏了
// `src/ops/preset-shape.ts` L23–25：`insideShape` 的采样点是**格心中点** `px = dx + 0.5`（不是 0-based 偏移 `dx`）。
// 故 `size.x = 1` 时 `cx = 0.5`、`(px-cx)/cx = 0/0.5 = 0`（非 NaN、非 −1）⇒ 判在形内。
// ⇒ **`src/ops/preset-shape.ts` 未改动**（派工单硬约束：没有红例不得进假设阶段、没有 seam 记为发现、不硬改实现）。
//
// 本文件的作用因此改为「**守值 + 不退化不变量**」：
//   ① 派工单 §3 验收 3 的两条读数（`cylinder 1×5×1 ≥5` · `sphere 1×1×1 ≥1`）逐条锁住（ops 直调 + AI 工具面真路径）；
//   ② `box` 与同族行为不变（对照）；
//   ③ 不退化不变量：size 各维 ≥1 ⇒ 4 形状 × hollow 开/关 全部 ≥1 块（穷举扫描，0 块 ⇒ 测试红）。
import { describe, expect, it } from 'vitest'
import { executeTool } from '../../src/ai/executor'
import { internBuiltin } from '../../src/core/builtin-palette'
import { CompositionRegistry } from '../../src/core/composition'
import { PatchLog } from '../../src/core/patch-log'
import { PartRegistry } from '../../src/core/parts'
import type { PresetShapeParams } from '../../src/core/types'
import { Volume } from '../../src/core/volume'
import { Editor } from '../../src/edit/editor'
import { applyProgramOp } from '../../src/ops/apply'

interface Fixture {
  volume: Volume
  k: (identity: string) => number
  run: (params: PresetShapeParams) => ReturnType<typeof applyProgramOp>
}

function makeFixture(): Fixture {
  const volume = new Volume()
  const keys = internBuiltin(volume.palette)
  const parts = new PartRegistry()
  const compositions = new CompositionRegistry()
  const log = new PatchLog(volume, parts)
  return {
    volume,
    k: (identity) => keys.get(identity)!,
    run: (params) => applyProgramOp(log, { type: 'program', name: 'presetShape', params }, compositions),
  }
}

function cells(params: Partial<PresetShapeParams>): { n: number; coords: string[] } {
  const f = makeFixture()
  const full = { shape: 'box', origin: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 }, key: f.k('color:red'), ...params } as PresetShapeParams
  f.run(full)
  const coords = [...f.volume.iterBlocks()].map((b) => `${b.x},${b.y},${b.z}`).sort()
  return { n: f.volume.nonEmptyCount, coords }
}

describe('件二 · preset_shape 的 cylinder / sphere 在 1×1 截面 / 单体下**不退化**（现象不复现）', () => {
  it('cylinder 1×5×1 ⇒ 5 块（≥5），占满 (0, 0..4, 0) 一列（一格粗的"柱"）', () => {
    const r = cells({ shape: 'cylinder', size: { x: 1, y: 5, z: 1 } })
    console.info('[件二 ① cylinder 1×5×1] ' + JSON.stringify(r))
    expect(r.n).toBeGreaterThanOrEqual(5)
    expect(r.n).toBe(5)
    expect(r.coords).toEqual(['0,0,0', '0,1,0', '0,2,0', '0,3,0', '0,4,0'])
  })

  it('sphere 1×1×1 ⇒ 1 块（≥1）；10×1×10 薄柱 / 1×1×1 盒 对照', () => {
    const sphere = cells({ shape: 'sphere', size: { x: 1, y: 1, z: 1 } })
    console.info('[件二 ② sphere 1×1×1] ' + JSON.stringify(sphere))
    expect(sphere.n).toBeGreaterThanOrEqual(1)
    expect(sphere.n).toBe(1)
    const box = cells({ shape: 'box', size: { x: 1, y: 5, z: 1 } })
    console.info('[件二 ② 对照 box 1×5×1] ' + JSON.stringify(box))
    expect(box.n).toBe(5) // 对照：同尺寸的盒行为不变
  })

  it('AI 工具面真路径：preset_shape cylinder 1×5×1 ⇒ 回执"放置 5"、模型 5 块；sphere 1×1×1 ⇒ 1 块', () => {
    const editor = new Editor()
    const cyl = executeTool(editor, 'preset_shape', {
      shape: 'cylinder', origin_x: 0, origin_y: 0, origin_z: 0, size_x: 1, size_y: 5, size_z: 1, key: 'color:brown',
    }, { jobFloor: 0 })
    console.info('[件二 ③ 工具面 cylinder 1×5×1] ' + `${cyl.ok} · ${cyl.content} · nonEmpty=${editor.volume.nonEmptyCount}`)
    expect(cyl.ok).toBe(true)
    expect(cyl.content).toContain('放置 5')
    expect(editor.volume.nonEmptyCount).toBe(5)

    const sph = executeTool(editor, 'preset_shape', {
      shape: 'sphere', origin_x: 8, origin_y: 0, origin_z: 0, size_x: 1, size_y: 1, size_z: 1, key: 'color:green',
    }, { jobFloor: 0 })
    console.info('[件二 ③ 工具面 sphere 1×1×1] ' + `${sph.ok} · ${sph.content} · nonEmpty=${editor.volume.nonEmptyCount}`)
    expect(sph.ok).toBe(true)
    expect(sph.content).toContain('放置 1')
    expect(editor.volume.nonEmptyCount).toBe(6)
  })

  it('不退化不变量：size 各维 1..6 × 4 形状 × hollow 开/关（1728 组）⇒ 无 0 块组', () => {
    const shapes: PresetShapeParams['shape'][] = ['box', 'cylinder', 'cone', 'sphere']
    const zeros: string[] = []
    let total = 0
    for (const shape of shapes) {
      for (let x = 1; x <= 6; x++) {
        for (let y = 1; y <= 6; y++) {
          for (let z = 1; z <= 6; z++) {
            for (const hollow of [false, true]) {
              total++
              if (cells({ shape, size: { x, y, z }, hollow }).n === 0) zeros.push(`${shape} ${x}×${y}×${z} hollow=${String(hollow)}`)
            }
          }
        }
      }
    }
    console.info(`[件二 ④ 穷举扫描] 共 ${total} 组（1..6 各维 × 4 形状 × hollow 开/关）⇒ 0 块组 = ${zeros.length} ${JSON.stringify(zeros)}`)
    expect(total).toBe(1728)
    expect(zeros).toEqual([])
  })
})
