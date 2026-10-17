// P3（`REQ-027` 门四 · B-07）：AI 颜色引用——按**项目键 + 规范色值**寻址；跨项目旧键 / 未知键 /
// 超容量请求一律零修改并报错；air 仍是删除（回归）。
import { beforeEach, describe, expect, it } from 'vitest'
import { executeTool } from '../../src/ai/executor'
import { Editor } from '../../src/edit/editor'
import { MemoryProjectStore } from '../../src/io/project-store'
import { setUi } from '../../src/state/editor-store'
import { MAX_PALETTE_KEY } from '../../src/core/color'

const NEW_COLOR = '#12ab34'
const FLOOR = 0

function house(): Editor {
  const ed = new Editor(new MemoryProjectStore())
  ed.place(0, 0, 0)
  ed.place(1, 0, 0)
  ed.place(2, 0, 0)
  return ed
}

function keysOf(ed: Editor): number[] {
  return [...ed.volume.iterBlocks()].map((b) => b.key)
}

beforeEach(() =>
  setUi({
    mode: 'edit',
    tool: 'place',
    layerMode: 'all',
    layerY: 0,
    currentIdentity: 'color:red',
    currentColor: '#c0392b',
    brushSize: { x: 1, y: 1, z: 1 },
    overridePlace: false,
    message: null,
  }),
)

describe('P3 · B-07 按规范色值寻址（自建色按值创建，与人工结果一致）', () => {
  it('recolor(to = "#12ab34") 与人工上色结果逐块一致', () => {
    const viaAi = house()
    const r = executeTool(viaAi, 'recolor', { target_kind: 'all', to: NEW_COLOR }, { jobFloor: FLOOR })
    expect(r.ok).toBe(true)
    expect(viaAi.volume.palette.list().some((e) => e.color === NEW_COLOR)).toBe(true)

    const viaHuman = house()
    viaHuman.setCurrentColor(NEW_COLOR)
    viaHuman.setTool('paint')
    for (const x of [0, 1, 2]) {
      viaHuman.strokeBegin()
      viaHuman.strokeApply({ x, y: 0, z: 0 })
      viaHuman.strokeCommit()
    }
    expect(keysOf(viaAi)).toEqual(keysOf(viaHuman)) // 同一规范色 ⇒ 同一色项 ⇒ 同一键
  })

  it('颜色大小写 / rgb() 等价写法 ⇒ 复用同一条目（不产生第二个色项）', () => {
    const ed = house()
    executeTool(ed, 'recolor', { target_kind: 'all', to: '#12AB34' }, { jobFloor: FLOOR })
    const size = ed.volume.palette.size
    const keys = keysOf(ed)
    const r2 = executeTool(ed, 'recolor', { target_kind: 'all', to: 'rgb(18, 171, 52)' }, { jobFloor: FLOOR })
    // 已经是该颜色 ⇒ 零变化（不记账），但绝不允许新增条目
    expect(r2.ok).toBe(false)
    expect(ed.volume.palette.size).toBe(size)
    expect(keysOf(ed)).toEqual(keys)
  })
})

describe('P3 · B-07 按项目键寻址（读回键即可改色）', () => {
  it('get_model_summary 读回的键可直接作为 to 提交（不必再给身份串）', () => {
    const ed = house()
    executeTool(ed, 'set_cells', { cells: [[5, 0, 0, NEW_COLOR]] }, { jobFloor: FLOOR })
    const custom = ed.volume.palette.list().find((e) => e.color === NEW_COLOR)!
    expect(custom.key).toBeGreaterThan(0)
    const r = executeTool(ed, 'recolor', { target_kind: 'all', to: custom.key }, { jobFloor: FLOOR })
    expect(r.ok).toBe(true)
    expect(keysOf(ed).every((k) => k === custom.key)).toBe(true)
    expect(ed.volume.getEntry(0, 0, 0)?.color).toBe(NEW_COLOR)
  })

  it('汇总里同时给出项目键与规范色值（AI 可读到自建色的两个寻址值）', () => {
    const ed = house()
    executeTool(ed, 'set_cells', { cells: [[5, 0, 0, NEW_COLOR]] }, { jobFloor: FLOOR })
    const r = executeTool(ed, 'get_model_summary', {}, { jobFloor: FLOOR })
    expect(r.content).toContain('[已用色]')
    expect(r.content).toContain(NEW_COLOR)
    const custom = ed.volume.palette.list().find((e) => e.color === NEW_COLOR)!
    // `D6`（design §8）：读面按三字段给值，**不再**输出 `identity#key(color)` 拼接形式
    expect(r.content).toContain(`key=${custom.key}`)
    expect(r.content).toContain(`color=${NEW_COLOR}`)
    expect(r.content).toContain(`identity=${custom.identity}`)
    expect(r.content).not.toMatch(new RegExp(`identity#\\d`))
  })
})

describe('P3 · B-07 零修改与报错：跨项目旧键 / 未知键 / 超容量', () => {
  it('未知键 ⇒ 教学式报错且零修改', () => {
    const ed = house()
    const digest = ed.volume.digest()
    const before = ed.log.patches.length
    const r = executeTool(ed, 'recolor', { target_kind: 'all', to: 9999 }, { jobFloor: FLOOR })
    expect(r.ok).toBe(false)
    expect(r.content).toContain('9999')
    expect(ed.volume.digest()).toEqual(digest)
    expect(ed.log.patches.length).toBe(before)
  })

  it('跨项目旧键 ⇒ 拒绝（键只在本项目作用域内有效）', () => {
    const projectA = house()
    executeTool(projectA, 'set_cells', { cells: [[5, 0, 0, NEW_COLOR]] }, { jobFloor: FLOOR })
    const foreignKey = projectA.volume.palette.list().find((e) => e.color === NEW_COLOR)!.key

    const projectB = house() // 新项目：色板只有内置 16 色 ⇒ 没有那个键
    const digest = projectB.volume.digest()
    const r = executeTool(projectB, 'recolor', { target_kind: 'all', to: foreignKey }, { jobFloor: FLOOR })
    expect(r.ok).toBe(false)
    expect(r.content).toContain('跨项目键无效')
    expect(projectB.volume.digest()).toEqual(digest)
    expect(projectB.volume.palette.size).toBe(16)
  })

  it('超容量请求 ⇒ 先报错、模型与色板零修改（不溢出成别的颜色）', () => {
    const ed = house()
    const palette = ed.volume.palette
    for (let i = 1; !palette.full; i++) palette.intern(`color:fill-${i}`, {}, '#010203')
    expect(palette.size).toBe(MAX_PALETTE_KEY)
    const digest = ed.volume.digest()
    const before = ed.log.patches.length
    const r = executeTool(ed, 'recolor', { target_kind: 'all', to: '#abcdef' }, { jobFloor: FLOOR })
    expect(r.ok).toBe(false)
    expect(r.content).toContain('容量已满')
    expect(ed.volume.digest()).toEqual(digest)
    expect(ed.log.patches.length).toBe(before)
    expect(palette.size).toBe(MAX_PALETTE_KEY)
  })

  it('非法色值 ⇒ 解析期整笔拒绝（不是"悄悄当另一个颜色"）', () => {
    const ed = house()
    const digest = ed.volume.digest()
    for (const bad of ['#12345', '#gggggg', 'rgba(1,2,3,0.5)', 0, -3, 1.5]) {
      const r = executeTool(ed, 'recolor', { target_kind: 'all', to: bad }, { jobFloor: FLOOR })
      expect(r.ok, String(bad)).toBe(false)
    }
    expect(ed.volume.digest()).toEqual(digest)
    expect(ed.log.patches.length).toBe(3)
  })
})

describe('P3 · 回归：air / 擦除仍不涉及颜色键', () => {
  it('set_cells 的 "air" 照常删除（键 0 = 空，不是颜色引用）', () => {
    const ed = house()
    const r = executeTool(ed, 'set_cells', { cells: [[0, 0, 0, 'air']] }, { jobFloor: FLOOR })
    expect(r.ok).toBe(true)
    expect(ed.volume.getBlock(0, 0, 0)).toBe(0)
    expect(ed.volume.nonEmptyCount).toBe(2)
  })

  it('擦除笔刷不产生色项（擦除不写色 ⇒ 不需要键）', () => {
    const ed = house()
    const size = ed.volume.palette.size
    const r = executeTool(ed, 'brush', { modifier: 'erase', size_x: 1, size_y: 1, size_z: 1, anchors: [[1, 0, 0]] }, { jobFloor: FLOOR })
    expect(r.ok).toBe(true)
    expect(ed.volume.getBlock(1, 0, 0)).toBe(0)
    expect(ed.volume.palette.size).toBe(size)
  })
})
