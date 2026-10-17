// P3（`REQ-027` · B-01–B-06 / 门四）：颜色闭环的判据面——选色不落库、写入才 intern、键稳定、
// 历史引用保留、已用色统计、项目往返、吸管只读。
import { beforeEach, describe, expect, it } from 'vitest'
import { Editor } from '../../src/edit/editor'
import { MemoryProjectStore } from '../../src/io/project-store'
import { setUi, useEditorUi } from '../../src/state/editor-store'
import { BUILTIN_COLOR_BLOCKS } from '../../src/core/builtin-palette'
import { MAX_PALETTE_KEY } from '../../src/core/color'

const RED = '#c0392b' // color:red 的规范值
const NEW_COLOR = '#12ab34' // 内置色板里没有的颜色 ⇒ 只有真正写入才该获得键

function freshEditor(): Editor {
  const ed = new Editor(new MemoryProjectStore())
  ed.place(0, 0, 0) // 起始一块（color:red 身份，规范值 #c0392b）
  return ed
}

function paletteSize(ed: Editor): number {
  return ed.volume.palette.size
}

function hasColorEntry(ed: Editor, hex: string): boolean {
  return ed.volume.palette.list().some((e) => e.color === hex)
}

beforeEach(() =>
  setUi({
    mode: 'edit',
    tool: 'place',
    layerMode: 'all',
    layerY: 0,
    currentIdentity: 'color:red',
    currentColor: RED,
    brushSize: { x: 1, y: 1, z: 1 },
    overridePlace: false,
    message: null,
  }),
)

describe('P3 · B-01 选色未使用：试选不改变模型、历史与项目持久用色', () => {
  it('连续试选多个颜色（含 HEX/RGB 与吸管）⇒ 模型摘要、补丁数、色板条目数全不变', () => {
    const ed = freshEditor()
    const digest = ed.volume.digest()
    const patches = ed.log.patches.length
    const size = paletteSize(ed)
    for (const hex of [NEW_COLOR, '#ff00ff', '#000000', '#ffffff', '#123456']) {
      expect(ed.setCurrentColor(hex)).toBe(true)
      expect(useEditorUi.getState().currentColor).toBe(hex)
    }
    ed.eyedrop(0, 0, 0) // 吸管也是只读路径
    expect(ed.volume.digest()).toEqual(digest)
    expect(ed.log.patches.length).toBe(patches)
    expect(paletteSize(ed)).toBe(size) // 试色 / 吸管不产生持久键
    expect(hasColorEntry(ed, NEW_COLOR)).toBe(false)
    // 刷新（重新投影）不需要恢复试色：模型与色板里没有它的痕迹
    ed.syncUi()
    expect(useEditorUi.getState().usedColors.map((u) => u.color)).toEqual([RED])
  })

  it('非法输入保留上次有效色并给原因（B-08 的会话面）', () => {
    const ed = freshEditor()
    ed.setCurrentColor(NEW_COLOR)
    for (const bad of ['#12345', '#gggggg', 'rgba(1,2,3,0.5)', '']) {
      expect(ed.setCurrentColor(bad), bad).toBe(false)
      expect(useEditorUi.getState().currentColor).toBe(NEW_COLOR)
      expect(useEditorUi.getState().message).toContain('无效')
    }
    expect(paletteSize(ed)).toBe(BUILTIN_COLOR_BLOCKS.length)
  })
})

describe('P3 · B-02 等价色值 ⇒ 同一当前色、同一色项（不因大小写重复）', () => {
  it('大小写 / 三位写法 / rgb() 输入后当前色一致', () => {
    const ed = freshEditor()
    for (const v of ['#12AB34', '12ab34', 'rgb(18, 171, 52)', '#1a3' /* = #11aa33，另一色 */]) {
      ed.setCurrentColor(v)
    }
    ed.setCurrentColor('#12AB34')
    expect(useEditorUi.getState().currentColor).toBe(NEW_COLOR)
    ed.setCurrentColor('rgb(18, 171, 52)')
    expect(useEditorUi.getState().currentColor).toBe(NEW_COLOR)
  })

  it('同一自定义色写两次 ⇒ 只产生一个色项（键复用，不重复登记）', () => {
    const ed = freshEditor()
    ed.setCurrentColor(NEW_COLOR)
    ed.place(1, 0, 0)
    const sizeAfterFirst = paletteSize(ed)
    expect(hasColorEntry(ed, NEW_COLOR)).toBe(true)
    ed.place(2, 0, 0)
    ed.setCurrentColor('#12AB34') // 大写等价写法
    ed.place(3, 0, 0)
    expect(paletteSize(ed)).toBe(sizeAfterFirst) // 没有第二个 #12ab34 条目
    const keys = [ed.volume.getBlock(1, 0, 0), ed.volume.getBlock(2, 0, 0), ed.volume.getBlock(3, 0, 0)]
    expect(new Set(keys).size).toBe(1)
  })

  it('HEX 命中内置色值 ⇒ 复用内置条目（不为同一颜色造第二个条目）', () => {
    const ed = freshEditor()
    const redKey = ed.volume.getBlock(0, 0, 0)
    ed.setCurrentColor('#C0392B', 'color:red')
    ed.place(1, 0, 0)
    expect(ed.volume.getBlock(1, 0, 0)).toBe(redKey)
    expect(paletteSize(ed)).toBe(BUILTIN_COLOR_BLOCKS.length)
  })
})

describe('P3 · B-03 吸管：读原始体素色，只读（不改模型 / 不加历史）', () => {
  it('取到该方块原始色；光照 / 高亮不进色值（色值直接来自调色板条目）', () => {
    const ed = freshEditor()
    ed.setCurrentColor(NEW_COLOR)
    ed.place(3, 2, 1)
    ed.setCurrentColor('#000000')
    expect(ed.eyedrop(3, 2, 1)).toBe(true)
    expect(useEditorUi.getState().currentColor).toBe(NEW_COLOR)
    expect(useEditorUi.getState().currentIdentity).toBe(`color:${NEW_COLOR.slice(1)}`)
  })

  it('空格 / 越界取色无效：当前色保持不变（网格与背景不取色）', () => {
    const ed = freshEditor()
    ed.setCurrentColor(NEW_COLOR)
    const digest = ed.volume.digest()
    const patches = ed.log.patches.length
    for (const cell of [
      [9, 9, 9],
      [0, -1, 0],
      [MAX_PALETTE_KEY, 0, 0],
    ] as const) {
      expect(ed.eyedrop(cell[0], cell[1], cell[2])).toBe(false)
    }
    expect(useEditorUi.getState().currentColor).toBe(NEW_COLOR)
    expect(ed.volume.digest()).toEqual(digest)
    expect(ed.log.patches.length).toBe(patches)
  })
})

describe('P3 · B-04 上色与撤销：只改有效已有块，一笔一次撤销精确还原颜色与归属', () => {
  it('paint 不创建空格方块；一笔撤销还原改色前的键与归属', () => {
    const ed = freshEditor()
    const beforeKey = ed.volume.getBlock(0, 0, 0)
    const beforeOwner = ed.parts.partIdOf(0, 0, 0) ?? null
    setUi({ tool: 'paint', currentIdentity: 'color:red', currentColor: RED })
    ed.setCurrentColor(NEW_COLOR)
    expect(ed.strokeBegin()).toBe(true)
    expect(ed.strokeApply({ x: 0, y: 0, z: 0 })).toBe(1)
    expect(ed.strokeApply({ x: 5, y: 5, z: 5 })).toBe(0) // 空格：上色不新增
    ed.strokeCommit()
    expect(ed.volume.getBlock(0, 0, 0)).not.toBe(beforeKey)
    expect(ed.volume.getBlock(5, 5, 5)).toBe(0)
    expect(ed.log.patches.length).toBe(2)
    ed.undo()
    expect(ed.volume.getBlock(0, 0, 0)).toBe(beforeKey) // 颜色精确还原
    expect(ed.parts.partIdOf(0, 0, 0) ?? null).toBe(beforeOwner) // 归属精确还原
  })

  it('取消的笔不留半完成色板：从未落账的键被收回', () => {
    const ed = freshEditor()
    const size = paletteSize(ed)
    ed.setCurrentColor(NEW_COLOR)
    expect(ed.strokeBegin()).toBe(true)
    ed.strokeApply({ x: 1, y: 0, z: 0 })
    expect(paletteSize(ed)).toBe(size + 1) // 落笔即写模型，键已分配
    ed.strokeCancel()
    expect(ed.volume.getBlock(1, 0, 0)).toBe(0)
    expect(paletteSize(ed)).toBe(size) // 取消后色板回到落笔前
    expect(hasColorEntry(ed, NEW_COLOR)).toBe(false)
  })

  it('零变化的笔（增量放置到已占用格）同样不留新键', () => {
    const ed = freshEditor()
    const size = paletteSize(ed)
    ed.setCurrentColor(NEW_COLOR)
    expect(ed.strokeBegin()).toBe(true)
    expect(ed.strokeApply({ x: 0, y: 0, z: 0 })).toBe(0) // 已占用 + 增量 ⇒ 零变化
    ed.strokeCommit()
    expect(ed.log.patches.length).toBe(1)
    expect(paletteSize(ed)).toBe(size)
  })
})

describe('P3 · B-05 已用列表：全模型统计（隐藏层仍在），删最后同色块即消失、撤销即恢复', () => {
  it('隐藏层的颜色仍在；最后同色块删除后消失；撤销恢复', () => {
    const ed = freshEditor()
    ed.setCurrentColor(NEW_COLOR)
    ed.place(0, 5, 0)
    const usedBefore = useEditorUi.getState().usedColors
    expect(usedBefore.map((u) => u.color).sort()).toEqual([NEW_COLOR, RED].sort())
    expect(usedBefore.find((u) => u.color === NEW_COLOR)?.count).toBe(1)
    // 单层显示 y=0（隐藏 y=5 的块）⇒ 已用色仍包含它（统计不看层次过滤、不看选中）
    ed.setLayerView('single', 0)
    ed.syncUi()
    expect(useEditorUi.getState().usedColors.map((u) => u.color)).toContain(NEW_COLOR)
    ed.setLayerView('all', 0)
    ed.erase(0, 5, 0) // 删掉最后一个该色块
    expect(useEditorUi.getState().usedColors.map((u) => u.color)).not.toContain(NEW_COLOR)
    ed.undo()
    expect(useEditorUi.getState().usedColors.map((u) => u.color)).toContain(NEW_COLOR)
  })
})

describe('P3 · B-06 / 门四 项目往返：自定义色读写一致、键稳定、历史引用色保留', () => {
  it('写入 → 导出 → 导入后逐块键与调色板条目一致', () => {
    const ed = freshEditor()
    ed.setCurrentColor(NEW_COLOR)
    ed.place(1, 0, 0)
    ed.place(2, 0, 0)
    const before = [...ed.volume.iterBlocks()].map((b) => [b.x, b.y, b.z, b.key])
    const text = ed.exportFile()
    const other = new Editor(new MemoryProjectStore())
    expect(other.importFile(text).ok).toBe(true)
    expect([...other.volume.iterBlocks()].map((b) => [b.x, b.y, b.z, b.key])).toEqual(before)
    expect(other.volume.palette.list()).toEqual(ed.volume.palette.list())
    expect(other.volume.getEntry(1, 0, 0)?.color).toBe(NEW_COLOR)
  })

  it('键稳定：隐藏 / 删最后一块 / 导出加载都不重编号', () => {
    const ed = freshEditor()
    ed.setCurrentColor(NEW_COLOR)
    ed.place(1, 0, 0)
    const key = ed.volume.getBlock(1, 0, 0)
    ed.setLayerView('single', 0)
    ed.setLayerView('all', 0)
    expect(ed.volume.getBlock(1, 0, 0)).toBe(key)
    ed.erase(1, 0, 0)
    ed.undo()
    expect(ed.volume.getBlock(1, 0, 0)).toBe(key)
    const text = ed.exportFile()
    const other = new Editor(new MemoryProjectStore())
    other.importFile(text)
    expect(other.volume.getEntry(1, 0, 0)?.key).toBe(key)
    // 加载后新色仍按既有键复用（不重编号、不新增）
    const size = other.volume.palette.size
    other.setCurrentColor(NEW_COLOR)
    other.place(4, 0, 0)
    expect(other.volume.getBlock(4, 0, 0)).toBe(key)
    expect(other.volume.palette.size).toBe(size)
  })

  it('历史引用色保留：撤销蓝色修改后仍能取回原红色（不因"试色不保存"被清掉）', () => {
    const ed = freshEditor()
    const redKey = ed.volume.getBlock(0, 0, 0)
    ed.setCurrentColor(NEW_COLOR)
    ed.paint(0, 0, 0)
    const customKey = ed.volume.getBlock(0, 0, 0)
    expect(customKey).not.toBe(redKey)
    ed.undo()
    expect(ed.volume.getBlock(0, 0, 0)).toBe(redKey) // 历史引用色可撤销恢复
    expect(ed.volume.palette.get(redKey)?.color).toBe(RED)
    expect(ed.volume.palette.get(customKey)).toBeDefined() // 自定义键仍在（undo 栈引用它，重做要还原）
  })

  it('无独立试色收藏：导出的调色板里只有真正用过的颜色', () => {
    const ed = freshEditor()
    ed.setCurrentColor('#abcdef')
    ed.setCurrentColor('#fedcba')
    const file = JSON.parse(ed.exportFile()) as { palette: Array<{ color?: string }> }
    const colors = file.palette.map((e) => e.color)
    expect(colors).not.toContain('#abcdef')
    expect(colors).not.toContain('#fedcba')
    expect(colors).toContain(RED)
  })
})

describe('P3 · 门四 容量耗尽：写入路径先报错、零修改（不溢出成别的颜色）', () => {
  it('色板满 + 新自定义色 ⇒ 落笔被拒、模型与历史不变、色板不变', () => {
    const ed = freshEditor()
    const palette = ed.volume.palette
    for (let i = 1; !palette.full; i++) palette.intern(`color:fill-${i}`, {}, '#010203')
    expect(palette.size).toBe(MAX_PALETTE_KEY)
    const digest = ed.volume.digest()
    const patches = ed.log.patches.length
    ed.setCurrentColor(NEW_COLOR)
    expect(ed.strokeBegin()).toBe(false) // 容量耗尽：不落笔
    expect(useEditorUi.getState().message).toContain('容量已满')
    expect(ed.volume.digest()).toEqual(digest)
    expect(ed.log.patches.length).toBe(patches)
    expect(palette.size).toBe(MAX_PALETTE_KEY)
    expect(hasColorEntry(ed, NEW_COLOR)).toBe(false)
    // 模型级 API 同口径：明确拒绝且零写入
    ed.place(7, 0, 0)
    expect(ed.volume.getBlock(7, 0, 0)).toBe(0)
    expect(ed.log.patches.length).toBe(patches)
    // 满员时既有颜色仍可复用（容量只挡新键）
    const redKey = ed.volume.getBlock(0, 0, 0)
    ed.setCurrentColor(RED, 'color:red')
    ed.place(7, 0, 0)
    expect(ed.volume.getBlock(7, 0, 0)).toBe(redKey)
    expect(ed.log.patches.length).toBe(patches + 1)
  })
})
