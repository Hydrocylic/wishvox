// P2（`REQ-052` 门三）重写：本件原为 debug-261007 的 MT-04 复现回路（"模型长高后上层不被渲染"）。
// **新契约下"粘滞跟顶"已被取消**——过滤是纯视图态，新增更高/更低块**不隐式切层**；
// 但 MT-04 的**真正不变量**仍须常驻回归：`store 的层次会话态` 与 `渲染层实际持有的过滤` 必须一致，
// 否则被跳过的新层要"动一下滑块"才出现（原故障形态）。因此本件保留假渲染器与可见块数对拍，
// 把断言从"自动跟顶"改为"显式档位下二者恒等"，并补「显示全部 ⇒ null 唯一不裁剪档」。
import { beforeEach, describe, expect, it } from 'vitest'
import type { LayerFilter } from '../../src/core/brush/predicate'
import { isLayerVisible } from '../../src/core/brush/predicate'
import { visibleCountByFilter } from '../../src/core/model-info'
import type { Coord, VoxelChange } from '../../src/core/types'
import type { EditorRenderer } from '../../src/edit/render-port'
import { Editor } from '../../src/edit/editor'
import { MemoryProjectStore } from '../../src/io/project-store'
import { setUi, useEditorUi } from '../../src/state/editor-store'

/** 渲染层假件：只保一块**可读回的层次过滤**，并给出"照当前 filter 会挂几块"的可见实例计数。
 *  可见数 = 驻留格逐格过 isLayerVisible（与 ChunkLayer 重建时的过滤同一谓词与口径）。 */
class FakeRenderer implements EditorRenderer {
  private frame: LayerFilter | null = null
  readonly cells = new Map<string, number>()

  applyChanges(changes: readonly VoxelChange[]): void {
    for (const c of changes) this.cells.set(`${c.x},${c.y},${c.z}`, c.after)
  }
  rebuildAll(): void {}
  setAppearance(): void {}
  setHighlightedPart(): void {}
  frameModel(): void {}

  setLayerFilter(filter: LayerFilter | null): void {
    this.frame = filter
  }
  /** 读回面（本单新增的最小接缝）：渲染层当前持有的层次过滤 */
  layerFilterReadback(): LayerFilter | null {
    return this.frame
  }
  /** 可见实例数 = 驻留格逐格过当前过滤（T15 卸载语义对"重建时挂载"无影响） */
  get visibleInstanceCount(): number {
    let n = 1
    for (const k of this.cells.keys()) if (isLayerVisible(this.frame, Number(k.split(',')[1]))) n++
    return n - 1
  }
}

/** 单测试起点：清空 store 的层次会话态（store 跨用例共享），并返回新 editor + 假件 */
function makeEditor(): { editor: Editor; fake: FakeRenderer } {
  setUi({ layerMode: 'below', layerY: 3, layerMinY: 0, layerMaxY: 3 })
  const editor = new Editor(new MemoryProjectStore())
  const fake = new FakeRenderer()
  editor.attachRenderer(fake)
  return { editor, fake }
}

/** 铺"改动前"的模型：直接写 volume（不进历史、不触投影），并把驻留格喂给假件
 *  （applyChanges = "这批 chunk 已重建/驻留"；是否可见由 visibleInstanceCount 现算）。 */
function seed(editor: Editor, fake: FakeRenderer, cells: ReadonlyArray<Coord>): void {
  const changes: VoxelChange[] = []
  for (const c of cells) {
    editor.volume.setBlock(c.x, c.y, c.z, 1)
    changes.push({ x: c.x, y: c.y, z: c.z, before: 0, after: 1 })
  }
  fake.applyChanges(changes)
}

const at = (x: number, y: number, z: number): Coord => ({ x, y, z })

describe('REQ-052 · 层次过滤 = 纯视图态（渲染层持有值必须与 store 一致）', () => {
  beforeEach(() => {
    setUi({ layerMode: 'below', layerY: 3, layerMinY: 0, layerMaxY: 3 })
  })

  it('模型长高（AI 逐块写入）不隐式切层：过滤仍是用户选的 y，且渲染层持有值与 store 一致', () => {
    const { editor, fake } = makeEditor()
    seed(editor, fake, [at(0, 0, 0), at(0, 1, 0), at(0, 2, 0), at(0, 3, 0), at(0, 4, 0)])
    const patch = editor.aiSetCells({ cells: [at(0, 5, 0), at(0, 6, 0)].map((c) => ({ ...c, key: 2 })) })
    expect(patch).not.toBeNull()

    // 层范围读数 = 模型实际占用（不再有"+1 建造余量"冒充模型层）
    expect(useEditorUi.getState().layerMaxY).toBe(6)
    expect(useEditorUi.getState().layerY).toBe(3)
    // MT-04 不变量：渲染层持有 = store 会话态推导出的过滤
    expect(fake.layerFilterReadback()).toEqual(editor.currentLayerFilter())
    expect(fake.layerFilterReadback()).toEqual({ mode: 'below', y: 3 })
    // 被过滤的新层确实不可见（7 块里只有 y=0..3 的 4 块）
    expect(fake.visibleInstanceCount).toBe(4)
    expect(fake.visibleInstanceCount).toBe(visibleCountByFilter(editor.volume, fake.layerFilterReadback()))
  })

  it('AI 笔刷（aiBrush）长高：同上（不切层）', () => {
    const { editor, fake } = makeEditor()
    seed(editor, fake, [at(0, 0, 0), at(0, 1, 0), at(0, 2, 0), at(0, 3, 0), at(0, 4, 0)])
    const res = editor.aiBrush({
      anchors: [at(0, 5, 0), at(0, 6, 0)],
      size: { x: 1, y: 1, z: 1 },
      action: 'place',
      mode: 'additive',
      key: 2,
    })
    expect(res.patch).not.toBeNull()
    expect(useEditorUi.getState().layerY).toBe(3)
    expect(fake.layerFilterReadback()).toEqual({ mode: 'below', y: 3 })
    expect(fake.visibleInstanceCount).toBe(4)
  })

  it('AI 程序化操作（aiProgramOp · 走 afterChange）：同上（不切层）', () => {
    const { editor, fake } = makeEditor()
    seed(editor, fake, [at(0, 0, 0), at(0, 1, 0), at(0, 2, 0), at(0, 3, 0), at(0, 4, 0)])
    const patch = editor.aiProgramOp({
      type: 'program',
      name: 'addLayer',
      params: { scope: { kind: 'all' }, count: 2, key: 2 },
    })
    expect(patch).not.toBeNull()
    expect(useEditorUi.getState().layerMaxY).toBe(6)
    expect(useEditorUi.getState().layerY).toBe(3)
    expect(fake.layerFilterReadback()).toEqual({ mode: 'below', y: 3 })
  })

  it('门三：显示全部 = 唯一不裁剪拾取档（推 null），新增更高/更低块继续可见', () => {
    const { editor, fake } = makeEditor()
    seed(editor, fake, [at(0, 0, 0), at(0, 1, 0), at(0, 2, 0), at(0, 3, 0), at(0, 4, 0)])
    editor.refreshViews()
    editor.setLayerView('all', 0)
    expect(editor.currentLayerFilter()).toBeNull()
    expect(fake.layerFilterReadback()).toBeNull()

    editor.aiSetCells({ cells: [at(0, -3, 0), at(0, 5, 0)].map((c) => ({ ...c, key: 2 })) })
    expect(fake.layerFilterReadback()).toBeNull() // 新层不触发隐式切层
    expect(fake.visibleInstanceCount).toBe(7)
    expect(fake.visibleInstanceCount).toBe(visibleCountByFilter(editor.volume, null))
  })

  it('撤销不回退视图（V11）：收缩不改过滤，滑块值也不被回写', () => {
    const { editor, fake } = makeEditor()
    seed(editor, fake, [at(0, 0, 0), at(0, 1, 0), at(0, 2, 0), at(0, 3, 0), at(0, 4, 0)])
    editor.refreshViews()
    editor.aiSetCells({ cells: [at(0, 5, 0), at(0, 6, 0)].map((c) => ({ ...c, key: 2 })) })
    editor.undo()
    expect(useEditorUi.getState().layerY).toBe(3)
    expect(fake.layerFilterReadback()).toEqual({ mode: 'below', y: 3 })
  })

  it('滑块路径（REQ-052）：不再夹取到模型顶；非法 y 拒绝并保留原状态', () => {
    const { editor, fake } = makeEditor()
    for (let y = 0; y <= 4; y++) editor.place(0, y, 0) // 走正常写路径落 5 层
    editor.refreshViews()
    editor.setLayerView('below', 2)
    expect(fake.layerFilterReadback()).toEqual({ mode: 'below', y: 2 })
    editor.setLayerView('single', 1)
    expect(fake.layerFilterReadback()).toEqual({ mode: 'single', y: 1 })
    expect(fake.visibleInstanceCount).toBe(1)

    // 越界/小数（REQ-065）⇒ 拒绝，渲染层与 store 都保持上一步的 single y=1
    editor.setLayerView('single', 0.5)
    editor.setLayerView('single', 4097)
    expect(useEditorUi.getState().layerY).toBe(1)
    expect(useEditorUi.getState().layerMode).toBe('single')
    expect(fake.layerFilterReadback()).toEqual({ mode: 'single', y: 1 })
  })
})
