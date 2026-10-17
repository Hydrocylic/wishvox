// r02 前半 · 编辑会话（Editor 级）：F5 双态门 / F6 坯料 / F8 一笔一补丁（旁路 + 零变化）/
// 撤销归属还原 / 会话态不进项目文件（V5/V8/V10/V11 的 L1 面；渲染读回归 harness/editing-view）。
import { describe, expect, it } from 'vitest'
import { MemoryProjectStore } from '../../src/io/project-store'
import { decodeProject } from '../../src/io/serialize'
import type { StrokeOp } from '../../src/core/types'
import { Editor } from '../../src/edit/editor'
import { setUi, useEditorUi } from '../../src/state/editor-store'

function makeEditor(): Editor {
  const editor = new Editor(new MemoryProjectStore())
  editor.setMode('edit')
  return editor
}

const at = (x: number, y: number, z: number) => ({ x, y, z })

describe('V5 · 初始状态（F6：新建 = 3³ 坯料）', () => {
  it('新建 ⇒ 27 块、坐标 0..2 逐格相等、归初始构件「坯料」、一次撤销清空', () => {
    const editor = makeEditor()
    editor.newProject()
    expect(editor.volume.nonEmptyCount).toBe(27)
    for (let x = 0; x <= 2; x++) {
      for (let y = 0; y <= 2; y++) {
        for (let z = 0; z <= 2; z++) expect(editor.volume.getBlock(x, y, z)).not.toBe(0)
      }
    }
    const part = editor.parts.list().find((p) => p.name === '坯料')
    expect(part).toBeDefined()
    expect(part!.blocks.size).toBe(27)
    expect(editor.parts.partIdOf(1, 1, 1)).toBe(part!.id) // 中心格 (1,1,1)
    // 一条补丁（V8 口径同源）⇒ 一次撤销清空
    expect(editor.log.patches).toHaveLength(1)
    const patch = editor.log.patches[0]!
    expect((patch.op as StrokeOp).type).toBe('stroke')
    expect(patch.changes).toHaveLength(27)
    editor.undo()
    expect(editor.volume.nonEmptyCount).toBe(0)
  })
})

describe('V8 · 一笔 = 1 条补丁（旁路累积 + 零变化不入栈）', () => {
  it('拖动涂抹跨 3 个锚点：期间模型变化但不记账，松手恰 1 条补丁、一次撤销全退', () => {
    const editor = makeEditor()
    editor.newProject()
    setUi({ brushSize: { x: 1, y: 1, z: 1 }, tool: 'place', overridePlace: false })
    const patchesBefore = editor.log.patches.length // = 1（坯料）
    const nonEmptyBefore = editor.volume.nonEmptyCount

    expect(editor.strokeBegin()).toBe(true)
    editor.strokeApply(at(3, 0, 0))
    editor.strokeApply(at(3, 0, 1))
    editor.strokeApply(at(3, 0, 2))
    // ① 旁路：模型已变（所见即所得），但补丁数不动（松手才提交）
    expect(editor.volume.nonEmptyCount).toBe(nonEmptyBefore + 3)
    expect(editor.log.patches).toHaveLength(patchesBefore)
    editor.strokeCommit()
    // ② 松手 ⇒ 恰 1 条补丁，3 格都在里面
    expect(editor.log.patches).toHaveLength(patchesBefore + 1)
    const stroke = editor.log.patches[patchesBefore]!
    expect((stroke.op as StrokeOp).type).toBe('stroke')
    expect(stroke.changes).toHaveLength(3)
    // ③ 一次撤销全退
    editor.undo()
    expect(editor.volume.nonEmptyCount).toBe(nonEmptyBefore)
  })

  it('同格重复涂抹只记一次（缓冲按坐标去重，before = 落笔前）', () => {
    const editor = makeEditor()
    editor.newProject()
    setUi({ brushSize: { x: 1, y: 1, z: 1 }, tool: 'place', overridePlace: false })
    editor.strokeBegin()
    editor.strokeApply(at(3, 0, 0))
    editor.strokeApply(at(3, 0, 0))
    editor.strokeCommit()
    expect(editor.log.patches[1]!.changes).toHaveLength(1)
  })

  it('零变化不入栈：同色上色一笔 ⇒ 不记账且反馈可区分（"零变化"vs"没有方块"）', () => {
    const editor = makeEditor()
    editor.newProject()
    setUi({ currentIdentity: 'color:light-gray' }) // 与坯料同色
    setUi({ brushSize: { x: 1, y: 1, z: 1 }, tool: 'paint', overridePlace: false })
    const before = editor.log.patches.length
    editor.strokeBegin()
    editor.strokeApply(at(1, 1, 1))
    editor.strokeCommit()
    expect(editor.log.patches).toHaveLength(before) // 不入栈
    expect(useEditorUi.getState().message).toMatch(/零变化，不记账/)
    // 对照：擦除可见的空气格 = "没有方块可作用"（不同文案，纪律 ④）
    setUi({ tool: 'erase' })
    editor.strokeBegin()
    editor.strokeApply(at(5, 0, 0))
    editor.strokeCommit()
    expect(editor.log.patches).toHaveLength(before)
    expect(useEditorUi.getState().message).toMatch(/没有方块可作用/)
  })

  it('增量放置不覆盖已有块；替换放置逐块覆盖（Editor 全链路）', () => {
    const editor = makeEditor()
    editor.newProject()
    setUi({ currentIdentity: 'color:red', brushSize: { x: 1, y: 1, z: 1 }, tool: 'place', overridePlace: false })
    editor.strokeBegin()
    editor.strokeApply(at(3, 0, 0)) // (3,0,0) ← red
    editor.strokeCommit()
    const red = editor.volume.getBlock(3, 0, 0)
    // 增量：再对 (3,0,0) 放 blue ⇒ 跳过
    setUi({ currentIdentity: 'color:blue' })
    editor.strokeBegin()
    editor.strokeApply(at(3, 0, 0))
    editor.strokeCommit()
    expect(editor.volume.getBlock(3, 0, 0)).toBe(red)
    expect(useEditorUi.getState().message).toMatch(/零变化，不记账/)
    // 替换：打开 Override ⇒ 覆盖
    setUi({ overridePlace: true })
    editor.strokeBegin()
    editor.strokeApply(at(3, 0, 0))
    editor.strokeCommit()
    expect(editor.volume.getBlock(3, 0, 0)).not.toBe(red)
  })

  it('擦除一笔的撤销 ⇒ 精确还原归属（ownersBefore 路径）', () => {
    const editor = makeEditor()
    editor.newProject()
    const blankPart = editor.parts.list().find((p) => p.name === '坯料')!
    setUi({ brushSize: { x: 1, y: 1, z: 1 }, tool: 'erase', overridePlace: false })
    editor.strokeBegin()
    editor.strokeApply(at(0, 0, 0))
    editor.strokeApply(at(1, 0, 0))
    editor.strokeCommit()
    expect(editor.volume.getBlock(0, 0, 0)).toBe(0)
    editor.undo()
    expect(editor.volume.getBlock(0, 0, 0)).not.toBe(0)
    expect(editor.parts.partIdOf(0, 0, 0)).toBe(blankPart.id) // 归属还原，不只是块回来
    expect(editor.parts.partIdOf(1, 0, 0)).toBe(blankPart.id)
  })

  it('stroke 打断（cancel）⇒ 回到落笔前状态且不记账', () => {
    const editor = makeEditor()
    editor.newProject()
    setUi({ brushSize: { x: 1, y: 1, z: 1 }, tool: 'place', overridePlace: false })
    const before = editor.volume.digest()
    const patches = editor.log.patches.length
    editor.strokeBegin()
    editor.strokeApply(at(5, 5, 5))
    editor.strokeCancel()
    expect(editor.volume.digest()).toEqual(before)
    expect(editor.log.patches).toHaveLength(patches)
  })
})

describe('V10 · 双态门（检视态 = 任何界面编辑入口不可触发）', () => {
  it('检视态：strokeBegin 拒绝 + runOp 拒绝（读回断言）；切回编辑可继续', () => {
    const editor = makeEditor()
    editor.newProject()
    editor.setMode('inspect')
    expect(useEditorUi.getState().mode).toBe('inspect')
    expect(editor.strokeBegin()).toBe(false)
    expect(useEditorUi.getState().message).toMatch(/检视态不可编辑/)
    expect(
      editor.runOp({ type: 'program', name: 'clearScope', params: { scope: { kind: 'all' } } }),
    ).toBe(false)
    expect(editor.volume.nonEmptyCount).toBe(27) // 模型未被碰
    editor.setMode('edit')
    setUi({ brushSize: { x: 1, y: 1, z: 1 }, tool: 'place', overridePlace: false })
    expect(editor.strokeBegin()).toBe(true)
    editor.strokeApply(at(3, 0, 0))
    editor.strokeCommit()
    expect(editor.volume.nonEmptyCount).toBe(28)
  })
})

describe('V11 · 会话态不进项目文件（相机 / 层次 / 网格 / 目标点）', () => {
  it('导出 JSON 不含相机与视图字段；stroke 补丁可往返（v2 校验通过）', () => {
    const editor = makeEditor()
    editor.newProject()
    setUi({ brushSize: { x: 2, y: 1, z: 1 }, tool: 'place', overridePlace: false })
    editor.strokeBegin()
    editor.strokeApply(at(3, 0, 0))
    editor.strokeCommit()
    setUi({ layerMode: 'single', layerY: 1, gridBase: true, fov: 90 } as never)
    const text = editor.exportFile()
    for (const forbidden of ['"fov"', '"camera"', '"layerMode"', '"gridBase"', '"target"', '"rotateSpeed"', '"damping"']) {
      expect(text).not.toContain(forbidden)
    }
    const decoded = decodeProject(text)
    expect(decoded.ok).toBe(true)
    // stroke 补丁过形状校验且标签在
    if (decoded.ok) {
      expect(decoded.file.log.patches.some((p) => p.op.type === 'stroke' && p.label === '放置 2×1×1（增量）')).toBe(true)
    }
  })
})

describe('导入导出 · 坯料与笔刷补丁往返', () => {
  it('导出 → 新实例导入 ⇒ 摘要相等 + 构件「坯料」与归属在', () => {
    const a = makeEditor()
    a.newProject()
    setUi({ brushSize: { x: 1, y: 1, z: 1 }, tool: 'place', overridePlace: false })
    a.strokeBegin()
    a.strokeApply(at(3, 1, 1))
    a.strokeCommit()
    const text = a.exportFile()
    const b = makeEditor()
    const r = b.importFile(text)
    expect(r.ok).toBe(true)
    expect(b.volume.digest()).toEqual(a.volume.digest())
    expect(b.parts.list().some((p) => p.name === '坯料')).toBe(true)
    expect(b.parts.partIdOf(3, 1, 1)).toBeUndefined() // 未选中构件 ⇒ 手工块
    // 导入后可继续撤销历史跳转（F12 面读同一份补丁）
    expect(b.log.patches).toHaveLength(2)
  })
})
