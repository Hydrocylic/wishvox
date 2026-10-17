// r02 前半 · F12 可点击撤销历史（V13 · 尽力层）：跳转后摘要 = 逐步 undo/redo 到同点（等价性）。
// 实现上 historyJump = 单步 undo/redo 的循环 ⇒ 等价由构造保证；这里对独立实例逐步验证（L2 摘要口径）。
import { describe, expect, it } from 'vitest'
import { MemoryProjectStore } from '../../src/io/project-store'
import { Editor } from '../../src/edit/editor'
import { setUi } from '../../src/state/editor-store'

function makeEditor(): Editor {
  const editor = new Editor(new MemoryProjectStore())
  editor.setMode('edit')
  return editor
}

describe('V13 · 撤销历史跳转（列表只读 + 点击 = undo(n)/redo(n)）', () => {
  it('历史条目带操作名（label）：坯料 / 放置笔刷 / 单块放置可读', () => {
    const editor = makeEditor()
    editor.newProject()
    setUi({ brushSize: { x: 2, y: 1, z: 1 }, tool: 'place', overridePlace: false })
    editor.strokeBegin()
    editor.strokeApply({ x: 3, y: 0, z: 0 })
    editor.strokeCommit()
    editor.place(6, 0, 0)
    const items = editor.historyItems()
    expect(items.map((i) => i.label)).toEqual(['初始化·坯料 3×3×3', '放置 2×1×1（增量）', '补丁 2'])
    expect(items.every((i) => i.state === 'applied')).toBe(true)
  })

  it('跳回 = 逐步 undo 到同点（digest 相等）；跳前 = 逐步 redo 到同点', () => {
    const editor = makeEditor()
    editor.newProject()
    setUi({ brushSize: { x: 1, y: 1, z: 1 }, tool: 'place', overridePlace: false })
    const digests: string[] = [editor.volume.digest().coordHash]
    for (const p of [{ x: 3, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }]) {
      editor.strokeBegin()
      editor.strokeApply(p)
      editor.strokeCommit()
      digests.push(editor.volume.digest().coordHash)
    }
    // undo 后：undone 的条目出现在历史里（state = 'undone'）
    editor.undo()
    let items = editor.historyItems()
    expect(items.filter((i) => i.state === 'undone')).toHaveLength(1)
    // 跳回 seq 1 ⇒ digest = 补丁 1 之后
    editor.historyJump(1)
    expect(editor.volume.digest().coordHash).toBe(digests[1])
    // 独立实例逐步 undo 到同点 ⇒ 相等（等价性）
    const other = makeEditor()
    other.newProject()
    for (const p of [{ x: 3, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }]) {
      other.strokeBegin()
      other.strokeApply(p)
      other.strokeCommit()
    }
    other.undo()
    other.undo()
    expect(other.volume.digest().coordHash).toBe(digests[1])
    // 向前跳（redo 侧）：跳到 seq 3 ⇒ digest = 最后
    editor.historyJump(3)
    expect(editor.volume.digest().coordHash).toBe(digests[3])
    // 再跳回 0（坯料）⇒ 27 块
    editor.historyJump(0)
    expect(editor.volume.nonEmptyCount).toBe(27)
    // 历史条目状态标记随跳转刷新：跳回 0 ⇒ seq 0 已应用、其余在撤销侧
    items = editor.historyItems()
    expect(items.find((i) => i.seq === 0)!.state).toBe('applied')
    expect(items.filter((i) => i.seq > 0).every((i) => i.state === 'undone')).toBe(true)
  })

  it('连点后模型摘要与直接 undo/redo 一致（V13 判据原文）', () => {
    const a = makeEditor()
    a.newProject()
    setUi({ brushSize: { x: 1, y: 1, z: 1 }, tool: 'place', overridePlace: false })
    for (const p of [{ x: 3, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }]) {
      a.strokeBegin()
      a.strokeApply(p)
      a.strokeCommit()
    }
    const b = makeEditor()
    b.newProject()
    for (const p of [{ x: 3, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }]) {
      b.strokeBegin()
      b.strokeApply(p)
      b.strokeCommit()
    }
    a.historyJump(0) // 连点到底
    b.undo()
    b.undo() // 逐步同点
    expect(a.volume.digest()).toEqual(b.volume.digest())
    expect(a.parts.serialize()).toEqual(b.parts.serialize()) // 归属也一致
  })
})
