// `D6`（design §8，2026-10-16）：AI 读面与工具 schema 的**寻址引导**判据。
// 三条：① 读面给 identity/key/color 三字段且 key 与 color 可直接回填（同色同键）；② `identity#key`
// 拼接**被拒并给引导**（不静默误写）；③ 未知键 / 跨项目键 / 超容量沿用 B-07 的零修改报错。
import { beforeEach, describe, expect, it } from 'vitest'
import { executeTool } from '../../src/ai/executor'
import { getAiTool } from '../../src/ai/tools'
import { Editor } from '../../src/edit/editor'
import { MemoryProjectStore } from '../../src/io/project-store'
import { setUi } from '../../src/state/editor-store'

const NEW_COLOR = '#12ab34'
const FLOOR = 0

function house(): Editor {
  const ed = new Editor(new MemoryProjectStore())
  ed.place(0, 0, 0)
  ed.place(1, 0, 0)
  return ed
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

describe('D6-① 读面三字段：identity / key / color 逐项可回填', () => {
  it('调色板与已用色两行都按三字段给值，且不再出现 identity#key 拼接', () => {
    const ed = house()
    executeTool(ed, 'set_cells', { cells: [[5, 0, 0, NEW_COLOR]] }, { jobFloor: FLOOR })
    const r = executeTool(ed, 'get_model_summary', {}, { jobFloor: FLOOR })
    const custom = ed.volume.palette.list().find((e) => e.color === NEW_COLOR)!
    expect(r.content).toContain('key=')
    expect(r.content).toContain('color=')
    expect(r.content).toContain('identity=')
    expect(r.content).toContain(`key=${custom.key}`)
    expect(r.content).toContain(`identity=${custom.identity}`)
    expect(r.content).toContain('勿拼接 identity#key')
    expect(r.content).not.toMatch(/identity#\d/)
  })

  it('用 key 数字改色与用规范色值改色结果一致（同色同键）', () => {
    // 两个项目起点完全相同（含一个自建色块）⇒ 才能逐块比"改色结果"
    const seed = (ed: Editor): number => {
      executeTool(ed, 'set_cells', { cells: [[5, 0, 0, NEW_COLOR]] }, { jobFloor: FLOOR })
      return ed.volume.palette.list().find((e) => e.color === NEW_COLOR)!.key
    }
    const viaKey = house()
    const key = seed(viaKey)
    expect(executeTool(viaKey, 'recolor', { target_kind: 'all', to: key }, { jobFloor: FLOOR }).ok).toBe(true)

    const viaColor = house()
    seed(viaColor)
    expect(executeTool(viaColor, 'recolor', { target_kind: 'all', to: NEW_COLOR }, { jobFloor: FLOOR }).ok).toBe(true)
    expect([...viaKey.volume.iterBlocks()].map((x) => x.key)).toEqual([...viaColor.volume.iterBlocks()].map((x) => x.key))
    expect(viaKey.volume.palette.size).toBe(viaColor.volume.palette.size)
  })

  it('读面给的是 `key=N` ⇒ 回填成字符串 "N" 也要等价于数字 N', () => {
    const ed = house()
    executeTool(ed, 'set_cells', { cells: [[5, 0, 0, NEW_COLOR]] }, { jobFloor: FLOOR })
    const key = ed.volume.palette.list().find((e) => e.color === NEW_COLOR)!.key
    const r = executeTool(ed, 'recolor', { target_kind: 'all', to: String(key) }, { jobFloor: FLOOR })
    expect(r.ok).toBe(true)
    expect(ed.volume.getEntry(0, 0, 0)?.color).toBe(NEW_COLOR)
  })
})

describe('D6-② identity#key 拼接：拒绝 + 引导（不静默误写、不重试）', () => {
  it.each([
    ['color:pink#14', 'recolor'],
    ['color:red#1', 'recolor'],
    ['#c0392b#2', 'recolor'],
  ])('to="%s" ⇒ 报错并给出 key 数字 / 规范色值两个正确示例', (bad, tool) => {
    const ed = house()
    const digest = ed.volume.digest()
    const patches = ed.log.patches.length
    const r = executeTool(ed, tool, { target_kind: 'all', to: bad }, { jobFloor: FLOOR })
    expect(r.ok).toBe(false)
    expect(r.content).toContain('不接受 "identity#key" 拼接')
    expect(r.content).toContain('14 } 或') // 正确示例 = key 数字或规范 HEX
    expect(ed.volume.digest()).toEqual(digest)
    expect(ed.log.patches.length).toBe(patches)
  })

  it('set_cells 里的拼接同样被拒（同一校验面，不是只在 recolor 上拦）', () => {
    const ed = house()
    const r = executeTool(ed, 'set_cells', { cells: [[9, 0, 0, 'color:pink#14']] }, { jobFloor: FLOOR })
    expect(r.ok).toBe(false)
    expect(r.content).toContain('identity#key')
    expect(ed.volume.getBlock(9, 0, 0)).toBe(0)
  })
})

describe('D6-③ 工具 schema 措辞也写明寻址口径（B-07 沿用）', () => {
  it('recolor / set_cells / brush 的颜色参数说明含 key 与规范 HEX，并写明勿拼接', () => {
    for (const name of ['recolor', 'set_cells', 'brush']) {
      const schema = getAiTool(name)
      expect(schema, name).toBeDefined()
      const text = JSON.stringify(schema)
      expect(text, name).toContain('key')
      expect(text, name).toContain('HEX')
      expect(text, name).toContain('identity#key')
    }
    expect(JSON.stringify(getAiTool('get_model_summary'))).toContain('identity#key')
  })

  it('未知键 / 跨项目键仍零修改并报错（B-07 判据不因引导措辞松动）', () => {
    const a = house()
    executeTool(a, 'set_cells', { cells: [[5, 0, 0, NEW_COLOR]] }, { jobFloor: FLOOR })
    const foreign = a.volume.palette.list().find((e) => e.color === NEW_COLOR)!.key
    const b = house()
    const digest = b.volume.digest()
    expect(executeTool(b, 'recolor', { target_kind: 'all', to: foreign }, { jobFloor: FLOOR }).ok).toBe(false)
    expect(b.volume.digest()).toEqual(digest)
    expect(executeTool(b, 'recolor', { target_kind: 'all', to: 9999 }, { jobFloor: FLOOR }).ok).toBe(false)
    expect(b.volume.digest()).toEqual(digest)
  })
})
