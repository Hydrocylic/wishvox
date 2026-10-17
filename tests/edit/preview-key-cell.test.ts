// r05 收尾 · 件三（`REQ-063`）· **笔刷预览的"关键块"标识**（关键块 = 半透明红 · 附属块 = 绿）。
//
// 判据正本 = `discovery/requirements.md` 的 `REQ-063`（五条）+ `REQ-055`（体积 / 锚点 / 四则 = 不动项）。
// 语义（用户 2026-10-08 口径，人工单「实测回报」逐字）：多方块笔刷的预览里**"指针确认落点"的那一格 = 关键块**
// （= 笔刷体积的**锚点格 = 最小角格**；放置 = `hit.adjacent` / 擦除·上色 = `hit.cell`；1×1×1 ⇒ 该唯一格即关键块），
// 其余 = **附属块**；关键块红、附属块绿；**红 / 绿是笔刷语义色，不得借用四态 token**。
//
// 本文件断言的是**读回面**（不靠肉眼）：`Editor.previewAt()` 的集合分类 + `EditorRenderer` 收到的两组格子
// + store 的 `previewReadout`；**预览集合本身 = 笔刷体积 ∩ 既有单一谓词**这一条与改动前逐坐标对拍。
import { beforeEach, describe, expect, it } from 'vitest'
import { brushVolume } from '../../src/core/brush/volume'
import type { Coord, VoxelChange } from '../../src/core/types'
import type { EditorRenderer } from '../../src/edit/render-port'
import { Editor } from '../../src/edit/editor'
import { MemoryProjectStore } from '../../src/io/project-store'
import { setUi, useEditorUi } from '../../src/state/editor-store'

/** 渲染层假件：只记录预览两组格子（关键 / 附属）与其它接口的空实现 */
class FakeRenderer implements EditorRenderer {
  cells: readonly Coord[] = []
  keyCells: readonly Coord[] = []

  applyChanges(_changes: readonly VoxelChange[]): void {}
  rebuildAll(): void {}
  setAppearance(): void {}
  setHighlightedPart(): void {}
  frameModel(): void {}
  setPreview(cells: readonly Coord[] | null, keyCells?: readonly Coord[] | null): void {
    this.cells = cells ?? []
    this.keyCells = keyCells ?? []
  }
}

const at = (x: number, y: number, z: number): Coord => ({ x, y, z })
const kk = (c: Coord): string => `${c.x},${c.y},${c.z}`
const sorted = (cells: readonly Coord[]): string[] => cells.map(kk).sort()
/** 同一集合的逐坐标相等（与顺序无关） */
const sameSet = (a: readonly Coord[], b: readonly Coord[]): boolean => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b))

/** 单测试起点：清空会话态（store 跨用例共享）⇒ 编辑态 + 放置工具 + 1×1×1 + 全层可见（below y=3 覆盖 y=0..3） */
function makeEditor(): { editor: Editor; fake: FakeRenderer } {
  setUi({
    mode: 'edit',
    tool: 'place',
    brushSize: { x: 1, y: 1, z: 1 },
    overridePlace: false,
    currentIdentity: 'color:red',
    layerMode: 'below',
    layerY: 3,
    layerMinY: 0,
    layerMaxY: 3,
    previewReadout: null,
  })
  const editor = new Editor(new MemoryProjectStore())
  const fake = new FakeRenderer()
  editor.attachRenderer(fake)
  return { editor, fake }
}

describe('REQ-063 · 关键块预览（关键 = 锚点格 = 最小角格 · 附属 = 其余）', () => {
  let editor: Editor
  let fake: FakeRenderer

  beforeEach(() => {
    const made = makeEditor()
    editor = made.editor
    fake = made.fake
  })

  it('① 2×2×2 悬停 ⇒ 恰 1 格关键（锚点格）+ 其余 7 格附属；两组并集 = 笔刷体积逐坐标相等', () => {
    editor.previewAt(at(0, 0, 0)) // 先落一个 1×1×1 预览（定锚点）
    editor.setBrushSize({ x: 2, y: 2, z: 2 }) // 尺寸经会话态 setter ⇒ updatePreview 重算（锚点不变）
    const preview = editor.previewAt(at(0, 0, 0)) // 8 格全通过过滤（空体素 + 层可见 + 增量放置）
    const view = useEditorUi.getState().previewReadout!
    console.info('[件三-① 2×2×2] ' + JSON.stringify({ preview: preview.length, rendererCells: fake.cells.length, keyCells: fake.keyCells.length, readout: view }))

    expect(preview).toHaveLength(8)
    expect(sameSet(preview, brushVolume({ x: 2, y: 2, z: 2 }, at(0, 0, 0))), '预览集合 = 笔刷体积（REQ-055 不动项）').toBe(true)
    // ① 读回面：恰 1 格关键色，其余 7 格附属色
    expect(fake.keyCells).toHaveLength(1)
    expect(fake.keyCells[0]).toEqual(at(0, 0, 0))
    expect(fake.cells).toHaveLength(8)
    expect(sameSet(fake.cells, preview), '附属组 = 完整预览集合').toBe(true)
    expect(view.cells).toBe(8)
  })

  it('①b 锚点不在原点：关键格 = 传入锚点（覆盖「最小角 = 锚点」非"世界原点"）', () => {
    editor.setBrushSize({ x: 3, y: 1, z: 1 })
    editor.previewAt(at(5, 0, 7))
    console.info('[件三-①b 锚点 (5,0,7) · 3×1×1] ' + JSON.stringify({ cells: fake.cells.length, key: fake.keyCells }))
    expect(fake.cells).toHaveLength(3)
    expect(fake.keyCells).toEqual([at(5, 0, 7)])
  })

  it('② 1×1×1 ⇒ 该唯一格为关键色、附属格 0 格；擦除 / 上色同口径（有块可比）', () => {
    const place = editor.previewAt(at(0, 0, 0)) // 空体素 · place 增量
    console.info('[件三-② 1×1×1 place] ' + JSON.stringify({ preview: place.length, key: fake.keyCells.length, renderer: fake.cells.length }))
    expect(place).toEqual([at(0, 0, 0)])
    expect(fake.keyCells).toEqual([at(0, 0, 0)])
    expect(fake.cells).toHaveLength(1)

    // 擦除：锚点本体为已有块（擦除 = hit.cell）⇒ 关键格仍在
    editor.place(0, 0, 0)
    editor.setTool('erase')
    const erase = editor.previewAt(at(0, 0, 0))
    console.info('[件三-② 1×1×1 erase] ' + JSON.stringify({ preview: erase.length, key: fake.keyCells.length, renderer: fake.cells.length }))
    expect(erase).toEqual([at(0, 0, 0)])
    expect(fake.keyCells).toEqual([at(0, 0, 0)])

    // 上色：4×1×4 里锚点本体为块、其余为空 ⇒ 只有关键格通过（上色只改已有块）
    // P2（A-02 同源预览）：先把当前色换成**与已有块不同**的颜色——同色上色 before==after（零差分）不再进预览，
    // 这与落笔路径逐格一致（"预览 = 实际差分"）；旧断言依赖"同色也算可写"，已随新契约废止。
    editor.setTool('paint')
    editor.setCurrentIdentity('color:blue')
    editor.setBrushSize({ x: 4, y: 1, z: 4 })
    const paint = editor.previewAt(at(0, 0, 0))
    console.info('[件三-② paint 4×1×4] ' + JSON.stringify({ preview: paint.length, key: fake.keyCells.length, renderer: fake.cells.length }))
    expect(paint).toEqual([at(0, 0, 0)])
    expect(fake.keyCells).toEqual([at(0, 0, 0)])
    expect(fake.cells).toHaveLength(1)

    // P2 补：同色上色 ⇒ 零差分 ⇒ 无预览（旧断言的反面，逐格与落笔一致）
    editor.setCurrentIdentity('color:red')
    expect(editor.previewAt(at(0, 0, 0))).toEqual([])
    expect(fake.keyCells).toHaveLength(0)
  })

  it('③ 被过滤后 ⇒ 关键色格数 ≤ 1；锚点自身被过滤 ⇒ 0 格关键色、只剩附属色（Q7 不动）', () => {
    editor.previewAt(at(0, 0, 0))
    editor.setBrushSize({ x: 2, y: 1, z: 1 })
    const occupied = [at(1, 0, 0), at(5, 5, 5)]

    // ③a 隐藏层：用**跨层**的 1×3×1（锚点 y=0）——锚点格所在层被隐藏 ⇒ 0 格关键色；附属只剩可见层那格
    editor.setBrushSize({ x: 1, y: 3, z: 1 })
    editor.setLayerView('single', 1)
    const hidden = editor.previewAt(at(0, 0, 0))
    console.info('[件三-③a 隐藏层] ' + JSON.stringify({ preview: hidden, key: fake.keyCells }))
    expect(hidden).toEqual([at(0, 1, 0)])
    expect(fake.keyCells).toHaveLength(0)

    // ③b 已占用 + 增量放置（默认）：预览集合由既有谓词冻结（REQ-063 ⑤ 不动项）——
    //     锚点 (0,0,0) 空、邻格 (1,0,0) 已占用 ⇒ 通过者恰为锚点那一格（已占用格被 occupied 过滤）。
    //     断言：附属 1 格 · 关键色 1 格（= 锚点）；**邻格不在任何一组** ⇒ "已占用增量"的过滤没被改动。
    editor.setLayerView('below', 3)
    editor.place(occupied[0]!.x, occupied[0]!.y, occupied[0]!.z)
    editor.setTool('place')
    editor.setOverridePlace(false)
    editor.setBrushSize({ x: 2, y: 1, z: 1 })
    const occ = editor.previewAt(at(0, 0, 0))
    console.info('[件三-③b 已占用·增量] ' + JSON.stringify({ preview: occ, key: fake.keyCells, b1: editor.volume.getBlock(1, 0, 0) }))
    expect(occ).toEqual([at(0, 0, 0)]) // 已占用的邻格 (1,0,0) 不通过谓词
    expect(fake.keyCells).toEqual([at(0, 0, 0)])

    // ③b′ 锚点格**自身**已占用（锚点落在块上）⇒ 锚点被过滤 ⇒ 0 格关键色，只剩附属（这正是"锚点自身被过滤"那一侧）
    const occAnchor = editor.previewAt(at(occupied[0]!.x, occupied[0]!.y, occupied[0]!.z))
    console.info('[件三-③b′ 锚点自身已占用] ' + JSON.stringify({ preview: occAnchor, key: fake.keyCells }))
    expect(occAnchor).toEqual([at(2, 0, 0)])
    expect(fake.keyCells).toHaveLength(0)

    // ③c 替换模式（override）：锚点落在块上也可写 ⇒ 2×1×1 两格都通过 ⇒ 恰 1 格关键（锚点）
    // P2（A-02 同源预览）：当前色须**不同于**已有块色，替换才产生逐格差分（同色 ⇒ before==after 被零差分过滤）。
    editor.setOverridePlace(true)
    editor.setCurrentIdentity('color:blue')
    const over = editor.previewAt(at(occupied[0]!.x, occupied[0]!.y, occupied[0]!.z))
    console.info('[件三-③c 已占用·替换] ' + JSON.stringify({ preview: over, key: fake.keyCells }))
    expect(over).toEqual([at(1, 0, 0), at(2, 0, 0)])
    expect(fake.keyCells).toEqual([at(1, 0, 0)])

    // ③d 空格擦除 ⇒ 锚点被过滤（empty）⇒ 0 格关键色
    editor.setTool('erase')
    const empty = editor.previewAt(at(9, 0, 9))
    console.info('[件三-③d 空格·擦除] ' + JSON.stringify({ preview: empty, key: fake.keyCells }))
    expect(empty).toEqual([])
    expect(fake.keyCells).toHaveLength(0)
  })

  it('④ 检视态无预览 ⇒ 关键色 / 附属色格数均为 0（setInteractionMode(' + "'inspect'" + ') 不变）', () => {
    editor.previewAt(at(0, 0, 0))
    editor.setMode('inspect')
    console.info('[件三-④ 检视态] ' + JSON.stringify({ rendererCells: fake.cells.length, keyCells: fake.keyCells.length, readout: useEditorUi.getState().previewReadout }))
    expect(fake.cells).toHaveLength(0)
    expect(fake.keyCells).toHaveLength(0)
    expect(useEditorUi.getState().previewReadout).toBeNull()
  })

  it('⑤ 预览集合不变（= 笔刷体积逐坐标）×5 组；且与独立算的「体积 ∩ 谓词」逐坐标相等', () => {
    const cases: Array<{ tool: 'place' | 'erase' | 'paint'; size: Coord; anchor: Coord; occupied: readonly Coord[] }> = [
      { tool: 'place', size: at(2, 2, 2), anchor: at(0, 0, 0), occupied: [] },
      { tool: 'place', size: at(3, 1, 2), anchor: at(4, 0, 4), occupied: [at(4, 0, 4)] },
      { tool: 'erase', size: at(2, 2, 2), anchor: at(0, 0, 0), occupied: [at(1, 1, 1), at(2, 2, 2)] },
      { tool: 'paint', size: at(1, 3, 1), anchor: at(6, 0, 6), occupied: [at(6, 0, 6)] },
      { tool: 'paint', size: at(2, 1, 2), anchor: at(8, 0, 8), occupied: [] },
    ]
    for (const c of cases) {
      // 每例独立起点（同一 editor 上换工具/尺寸/占用：断言用集合等式，不依赖干净模型）
      editor.setTool(c.tool)
      editor.setOverridePlace(false)
      editor.setBrushSize(c.size)
      editor.previewAt(c.anchor)
      const got = fake.cells
      const expected = brushVolume(c.size, c.anchor).filter((cell) => {
        const current = editor.volume.getBlock(cell.x, cell.y, cell.z)
        if (cell.y > 3) return false // 层可见（below y=3）——与 store 会话态一致
        return c.tool === 'place' ? current === 0 : current !== 0
      })
      console.info(`[件三-⑤ ${c.tool} ${c.size.x}×${c.size.y}×${c.size.z} @${c.anchor.x},${c.anchor.y},${c.anchor.z}] ` + JSON.stringify({ got: got.length, volume: brushVolume(c.size, c.anchor).length, expected: expected.length }))
      expect(sameSet(got, expected), `${c.tool} 的预览集合 = 体积 ∩ 谓词（REQ-055 不动项）`).toBe(true)
      expect(fake.keyCells.length, '关键色格数 ≤ 1').toBeLessThanOrEqual(1)
      if (fake.keyCells.length === 1) expect(fake.keyCells[0]).toEqual(c.anchor)
    }
  })
})
