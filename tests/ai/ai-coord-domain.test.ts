// A-08 数域收尾（AI 解析面）——`REQ-065`（三轴整数 ±2¹²）取代 `REQ-059`（y≥0 下界）后的 AI 面判据。
//
// 背景：P1 已把**执行面**（`core/coords#isCoordDomain`、`volume`、`patch-log`、`ai-write`）统一到 ±4096，
// 但 AI **解析面**仍留 REQ-059 旧口径：`set_cells` 用 `y<0` 丢弃、`preset_shape` 把 `origin.y` 下限锁 0。
// 本文件的用例先红后绿，判据全部取自 `REQ-065` 与 design §A1，不自行发明数域。
//
// 与既有 `tests/ai/ai-executor.test.ts` 的分工：那里是工具语义/回执通道的回归；这里只测**数域**——
// 哪些坐标算合法、非法的落点如何丢弃计数、回执怎么表述。
import { beforeEach, describe, expect, it } from 'vitest'
import { executeTool } from '../../src/ai/executor'
import { parseWriteArgs } from '../../src/ai/args'
import { getAiTool } from '../../src/ai/tools'
import { Editor } from '../../src/edit/editor'
import { applyProgramOp } from '../../src/ops/apply'
import { setUi } from '../../src/state/editor-store'
import { COORD_LIMIT } from '../../src/core/coords'

const DOMAIN = COORD_LIMIT // 4096（`REQ-065` 上界；负向下界 = -DOMAIN）
const FLOOR = 0

/** 地面板夹具：4×1×4 @ y=0（AABB = x 0..3 / y 0 / z 0..3）——负 y 目标紧邻下便于验证"曾不许、现许"。 */
function floorFixture(): { editor: Editor; k: (i: string) => number } {
  const editor = new Editor()
  setUi({ mode: 'edit' })
  const k = (i: string): number => editor.volume.palette.list().find((e) => e.identity === i)!.key
  applyProgramOp(
    editor.log,
    { type: 'program', name: 'presetShape', params: { shape: 'box', origin: { x: 0, y: 0, z: 0 }, size: { x: 4, y: 1, z: 4 }, key: k('color:red-brick') } },
    editor.compositions,
  )
  return { editor, k }
}

let h: { editor: Editor; k: (i: string) => number }

beforeEach(() => {
  h = floorFixture()
})

describe('A-08 · AI 解析面数域：set_cells', () => {
  it('y<0 是合法目标 ⇒ 照常写入（REQ-065 取代 REQ-059 的下界）', () => {
    const patchesBefore = h.editor.log.patches.length
    const r = executeTool(h.editor, 'set_cells', { cells: [[1, -1, 1, 'color:red']] }, { jobFloor: FLOOR })

    expect(r.ok).toBe(true)
    expect(r.detail?.outOfBounds ?? 0).toBe(0)
    expect(h.editor.volume.getBlock(1, -1, 1)).not.toBe(0)
    expect(h.editor.log.patches.length).toBe(patchesBefore + 1)
  })

  it('域外坐标先于 AABB 邻近度被丢弃并计数（数域判定优先，不被当成"离模型太远"）', () => {
    // 全域只有一条域外坐标 ⇒ 丢弃计数后无合法格，回执应走"数域"文案而非 AABB 文案。
    // （set_cells 的 AABB ±16 邻近度守卫仍在：它是工具语义，本批不改 ⇒ 3 格外的域内坐标仍整笔拒。）
    const r = executeTool(h.editor, 'set_cells', { cells: [[1, DOMAIN + 1, 1, 'color:red']] }, { jobFloor: FLOOR })
    expect(r.ok).toBe(false)
    expect(r.detail?.outOfBounds).toBe(1)
    expect(r.content).toContain('±4096')
    expect(r.content).not.toContain('AABB')
  })

  it('下界端点本身合法：±4096 由共享域谓词判定（边界已由 core/coord-domain 覆盖）', () => {
    // set_cells 的 E2E 下界不可直接就位（AABB ±16 守卫会先拦）⇒ 边界在解析面按"域判定"验证：
    // -4096 通过域判、-4097 被计为域外；两者都**不**因 y 为负而被拒。
    const down = executeTool(h.editor, 'set_cells', { cells: [[1, -DOMAIN, 1, 'color:red']] }, { jobFloor: FLOOR })
    const beyond = executeTool(h.editor, 'set_cells', { cells: [[1, -DOMAIN - 1, 1, 'color:red']] }, { jobFloor: FLOOR })

    expect(down.content).not.toContain('±4096') // 落在域内 ⇒ 不是数域问题（此处整笔拒来自 AABB 守卫）
    expect(down.content).toContain('AABB')
    expect(beyond.detail?.outOfBounds).toBe(1) // 落在域外 ⇒ 丢弃并计数
    expect(beyond.content).toContain('±4096')
  })

  it('非法坐标丢弃并计数、不拒整笔：同调用的合法格照常落账', () => {
    const r = executeTool(
      h.editor,
      'set_cells',
      {
        cells: [
          [1, 0, 1, 'color:red'], // 合法
          [2, DOMAIN + 1, 1, 'color:red'], // 越界（上界外）
          [2.5, 0, 1, 'color:red'], // 非整数
          [Number.NaN, 0, 1, 'color:red'], // 非有限
          [2, 0, 1, 'color:red'], // 合法
        ],
      },
      { jobFloor: FLOOR },
    )

    expect(r.ok).toBe(true) // 不拒整笔
    expect(r.detail?.outOfBounds).toBe(3)
    expect(r.detail?.cells).toBe(2) // 两个合法格进同一条补丁
    expect(h.editor.volume.getBlock(1, 0, 1)).not.toBe(0)
    expect(h.editor.volume.getBlock(2, 0, 1)).not.toBe(0)
    expect(h.editor.volume.getBlock(2, DOMAIN + 1, 1)).toBe(0)
  })

  it('回执不再用「y<0」表述越界（REQ-065 口径）', () => {
    const r = executeTool(h.editor, 'set_cells', { cells: [[1, DOMAIN + 1, 1, 'color:red'], [1, 0, 1, 'color:red']] }, { jobFloor: FLOOR })
    expect(r.ok).toBe(true)
    expect(r.content).not.toContain('y<0')
    expect(r.content).toContain('超出')
  })

  it('结构错误仍拒整笔（形状问题不是数域问题）', () => {
    const r = executeTool(h.editor, 'set_cells', { cells: [[1, 0, 1]] }, { jobFloor: FLOOR })
    expect(r.ok).toBe(false)
  })
})

describe('A-08 · preset_shape origin：解析面三轴域 + 执行面端到端', () => {
  // 解析面（`src/ai/args.ts`）：origin 三轴须放行 ±4096（含 y<0）、拒绝 ±4097。
  // 执行面（`src/ops/preset-shape.ts`，D 项）：同样按 `REQ-065` 三轴域放行，并把负 y 真写进模型；
  // 端到端断言见本 describe 后半（`origin_y = -1 / -4096`）与「extent 越界不得部分写入」。
  const originOf = (originY: number, originX = 0, originZ = 0) => {
    const r = parseWriteArgs(h.editor, 'preset_shape', {
      shape: 'box', origin_x: originX, origin_y: originY, origin_z: originZ, size_x: 2, size_y: 2, size_z: 2, key: 'color:green',
    })
    if (!r.ok) throw new Error(`解析被拒：${r.message}`)
    const op = r.parsed.op!
    return (op.params as { origin: { x: number; y: number; z: number } }).origin
  }

  it('origin_y = -1 解析通过并原样进 op（REQ-065 取代 REQ-059 的下界）', () => {
    expect(originOf(-1)).toEqual({ x: 0, y: -1, z: 0 })
  })

  it('下界端点 -4096 通过；-4097 拒绝', () => {
    expect(originOf(-DOMAIN).y).toBe(-DOMAIN)
    const bad = parseWriteArgs(h.editor, 'preset_shape', {
      shape: 'box', origin_x: 0, origin_y: -DOMAIN - 1, origin_z: 0, size_x: 1, size_y: 1, size_z: 1, key: 'color:green',
    })
    expect(bad.ok).toBe(false)
  })

  it('origin 三轴同域：x / z 越界与 y 同判', () => {
    for (const [ax, az] of [[DOMAIN + 1, 0], [0, DOMAIN + 1], [-DOMAIN - 1, 0], [0, -DOMAIN - 1]] as const) {
      const r = parseWriteArgs(h.editor, 'preset_shape', {
        shape: 'box', origin_x: ax, origin_y: 0, origin_z: az, size_x: 1, size_y: 1, size_z: 1, key: 'color:green',
      })
      expect(r.ok, `origin_x=${ax} origin_z=${az}`).toBe(false)
    }
    expect(originOf(0, DOMAIN, -DOMAIN)).toEqual({ x: DOMAIN, y: 0, z: -DOMAIN }) // 端点合法
  })

  it('origin_y 非整数 / 非有限被拒绝', () => {
    for (const v of [0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = parseWriteArgs(h.editor, 'preset_shape', {
        shape: 'box', origin_x: 0, origin_y: v, origin_z: 0, size_x: 1, size_y: 1, size_z: 1, key: 'color:green',
      })
      expect(r.ok, `origin_y=${String(v)}`).toBe(false)
    }
  })

  it('工具 schema：origin 三轴下限 = -4096（不再是 y 锁 0）', () => {
    const preset = getAiTool('preset_shape')!
    for (const f of ['origin_x', 'origin_y', 'origin_z'] as const) {
      expect(preset.parameters.properties[f]).toMatchObject({ minimum: -DOMAIN, maximum: DOMAIN })
    }
    expect(preset.parameters.properties.origin_y.description).not.toContain('不得 <0')
  })

  it('工具 schema：brush 锚点与 set_cells 描述不再声明 y 不得 <0', () => {
    expect(getAiTool('brush')!.parameters.properties.anchors.description).not.toContain('不得 <0')
    expect(getAiTool('set_cells')!.description).not.toContain('不得 <0')
    expect(getAiTool('set_cells')!.description).toContain('±4096')
  })

  // D 项（执行面）：解析面已放行 origin 三轴 ±4096（含 y<0）⇒ 执行面必须同样放行，端到端可达。
  it('origin_y = -1 端到端可写到 y<0（D 项）', () => {
    const r = executeTool(
      h.editor,
      'preset_shape',
      { shape: 'box', origin_x: 0, origin_y: -1, origin_z: 4, size_x: 2, size_y: 2, size_z: 2, key: 'color:green' },
      { jobFloor: FLOOR },
    )
    expect(r.ok).toBe(true)
    expect(h.editor.volume.getBlock(0, -1, 4)).not.toBe(0)
    expect(h.editor.volume.getBlock(1, 0, 5)).not.toBe(0)
  })

  it('origin_y = -4096 端到端可写；-4097 在执行面被拒且零写入', () => {
    const ok = executeTool(
      h.editor,
      'preset_shape',
      { shape: 'box', origin_x: 0, origin_y: -DOMAIN, origin_z: 0, size_x: 1, size_y: 1, size_z: 1, key: 'color:green' },
      { jobFloor: FLOOR },
    )
    expect(ok.ok).toBe(true)
    expect(h.editor.volume.getBlock(0, -DOMAIN, 0)).not.toBe(0)

    const before = h.editor.volume.digest()
    const bad = executeTool(
      h.editor,
      'preset_shape',
      { shape: 'box', origin_x: 0, origin_y: -DOMAIN - 1, origin_z: 0, size_x: 1, size_y: 1, size_z: 1, key: 'color:green' },
      { jobFloor: FLOOR },
    )
    expect(bad.ok).toBe(false)
    expect(h.editor.volume.digest()).toEqual(before) // 零执行
  })

  // 越界 extent 不得**部分写入**：`log.applyChangesWithMembership` 逐格校验，若放到记账循环里才抛错，
  // 排序在前的合法格已经落盘而整笔无补丁 = 写了一半又没记账（P1 明确要避免的状态）。
  // 故执行面必须校**整个包围盒**（origin..origin+size-1），而不是只校 origin。
  it('origin 在域内但 extent 越界 ⇒ 整笔拒绝且零写入（不得部分写入）', () => {
    const before = h.editor.volume.digest()
    const nonEmptyBefore = h.editor.volume.nonEmptyCount
    const patchesBefore = h.editor.log.patches.length

    const r = executeTool(
      h.editor,
      'preset_shape',
      { shape: 'box', origin_x: DOMAIN, origin_y: 0, origin_z: 0, size_x: 4, size_y: 1, size_z: 1, key: 'color:green' },
      { jobFloor: FLOOR },
    )

    expect(r.ok).toBe(false)
    expect(h.editor.volume.digest()).toEqual(before) // 逐块比对：4096 格的"合法前半"也不得留下
    expect(h.editor.volume.nonEmptyCount).toBe(nonEmptyBefore)
    expect(h.editor.log.patches).toHaveLength(patchesBefore)
  })
})

describe('A-08 · 不改工具语义：数域外的其它守卫保持原样', () => {
  it('AABB 邻近度（±16 格）仍是拒整笔的守卫：域内但离模型太远 ⇒ 整笔拒绝', () => {
    // 本条是**反证**：数域统一不等于放开邻近度守卫。-200 在 ±4096 域内，但超出 AABB ±16 ⇒ 仍整笔拒。
    const before = h.editor.volume.digest()
    const r = executeTool(
      h.editor,
      'set_cells',
      { cells: [[0, 0, 0, 'color:green'], [0, -200, 0, 'color:green']] },
      { jobFloor: FLOOR },
    )
    expect(r.ok).toBe(false)
    expect(r.content).toContain('16')
    expect(h.editor.volume.digest()).toEqual(before) // 零执行
  })
})
