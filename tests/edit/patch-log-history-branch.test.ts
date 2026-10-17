// 交互编辑 P1 · `A-11`（连续编辑与历史分支）：撤销后另画再回退，**不能恢复废弃分支的快照**。
// 判据（design §A5 A-11）："比较逐块及归属，而非仅哈希" ⇒ 本文件同时断言逐块坐标 + 构件归属。
// 缺陷（PA-50）：`patches.pop()` 后新补丁复用同一 seq（`seq = patches.length`），而 `ensureSnapshot(seq)`
// 见"已有该 seq 的快照"就早返 ⇒ `rollbackToSeq` 拿到的是**旧链**的状态（块凭空回来 / 消失）。
// 修法 = `PatchLog.undo` / `rollbackToSeq` 在链截断处清掉 `seq >= patches.length` 的旧快照。
import { beforeEach, describe, expect, it } from 'vitest'
import { PatchLog } from '../../src/core/patch-log'
import { MemoryProjectStore } from '../../src/io/project-store'
import { Editor } from '../../src/edit/editor'
import { setUi, useEditorUi } from '../../src/state/editor-store'

function makeEditor(): Editor {
  const editor = new Editor(new MemoryProjectStore())
  editor.setMode('edit')
  setUi({ brushSize: { x: 1, y: 1, z: 1 }, brushSizes: { place: { x: 1, y: 1, z: 1 }, erase: { x: 1, y: 1, z: 1 }, paint: { x: 1, y: 1, z: 1 } } })
  setUi({ tool: 'place', overridePlace: false, currentIdentity: 'color:red' })
  return editor
}

const at = (x: number, y: number, z: number) => ({ x, y, z })

/** 逐块列表（坐标 + 调色板键，按坐标序）——"逐块"判据，不用哈希代替 */
function blocksOf(editor: Editor): string[] {
  const out: string[] = []
  for (const b of editor.volume.iterBlocks()) out.push(`${b.x},${b.y},${b.z}=${b.key}`)
  return out.sort()
}

/** 归属列表（构件 id → 有序块坐标）——A-11 明确要求比对归属 */
function partsOf(editor: Editor): Array<[string, string[]]> {
  return editor.parts
    .list()
    .filter((p) => p.blocks.size > 0)
    .map((p) => [p.id, [...p.blocks].sort()] as [string, string[]])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
}

/** 日志重放 = 当前模型（I2）——本单的历史正确性正本 */
function replayed(editor: Editor): { volume: string[]; parts: Array<[string, string[]]> } {
  const r = PatchLog.replay(editor.log.patches, editor.volume.palette.list(), editor.log.partCreations)
  const volume: string[] = []
  for (const b of r.volume.iterBlocks()) volume.push(`${b.x},${b.y},${b.z}=${b.key}`)
  const parts = r.parts
    .list()
    .filter((p) => p.blocks.size > 0)
    .map((p) => [p.id, [...p.blocks].sort()] as [string, string[]])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
  return { volume: volume.sort(), parts }
}

beforeEach(() => {
  setUi({ mode: 'edit', tool: 'place', overridePlace: false, message: null })
})

describe('A-11 · 撤销后的分支不得复活', () => {
  it('撤销一笔 → 在**同一格**另画一笔 → 回退到该构件创建时：不出现废弃分支的颜色', () => {
    const editor = makeEditor()
    editor.newProject()
    setUi({ currentIdentity: 'color:red', brushSize: { x: 1, y: 1, z: 1 }, tool: 'place', overridePlace: false })

    editor.newPart() // 构件锚点：createdAtPatch = 1（0 号是坯料补丁）
    const part = editor.parts.list().find((p) => p.name === '构件 2')!
    expect(part.createdAtPatch).toBe(1)

    // 补丁 1：蓝块（seq 1 的快照在此诞生：ensureSnapshot(1) 时链上只有 0..1）
    setUi({ currentIdentity: 'color:blue' })
    editor.strokeBegin()
    editor.strokeApply(at(5, 0, 0))
    editor.strokeCommit()
    const blueKey = editor.volume.getBlock(5, 0, 0)
    expect(blueKey).not.toBe(0)

    // 撤销补丁 1（链长回到 1），再用同号补丁改为**同格红块**
    editor.undo()
    expect(editor.volume.getBlock(5, 0, 0)).toBe(0)
    expect(editor.log.patches).toHaveLength(1)

    setUi({ currentIdentity: 'color:red' })
    editor.strokeBegin()
    editor.strokeApply(at(5, 0, 0))
    editor.strokeCommit()
    const redKey = editor.volume.getBlock(5, 0, 0)
    expect(redKey).not.toBe(0)
    expect(redKey).not.toBe(blueKey) // 红 ≠ 蓝，本用例才可判定
    const redBlocks = blocksOf(editor)
    const redParts = partsOf(editor)

    // 回退到该构件创建时（= 补丁 1 应用后）：链上 1 号补丁是"红"，
    // 旧快照（蓝）若未被作废，这里就会把蓝色恢复出来
    editor.rollbackToPart(part.id)

    expect(editor.volume.getBlock(5, 0, 0)).toBe(redKey)
    expect(editor.volume.getBlock(5, 0, 0)).not.toBe(blueKey)
    expect(blocksOf(editor)).toEqual(redBlocks)
    expect(partsOf(editor)).toEqual(redParts) // 归属同样不能回退到废弃分支
    expect(editor.log.patches).toHaveLength(2)

    // 重放 = 当前模型（撤销 → 另画 → 回退之后仍成立）
    const rep = replayed(editor)
    expect(rep.volume).toEqual(blocksOf(editor))
    expect(rep.parts).toEqual(partsOf(editor))
  })

  it('每条有效笔一次撤销可全退（含归属还原），且撤销后另画清空 redo 分支', () => {
    const editor = makeEditor()
    editor.newProject()
    const blank = editor.parts.list().find((p) => p.name === '坯料')!
    setUi({ currentIdentity: 'color:red', brushSize: { x: 1, y: 1, z: 1 }, tool: 'place', overridePlace: false })

    // 有效笔①：放置 2 格
    editor.strokeBegin()
    editor.strokeApply(at(4, 0, 0))
    editor.strokeApply(at(4, 0, 1))
    editor.strokeCommit()
    const afterFirst = blocksOf(editor)

    // 有效笔②：擦除坯料 2 格（归属也要还原）
    setUi({ tool: 'erase' })
    editor.strokeBegin()
    editor.strokeApply(at(0, 0, 0))
    editor.strokeApply(at(0, 0, 1))
    editor.strokeCommit()
    expect(editor.volume.getBlock(0, 0, 0)).toBe(0)

    // 一次撤销全退笔②，且归属回到坯料
    editor.undo()
    expect(blocksOf(editor)).toEqual(afterFirst)
    expect(editor.parts.partIdOf(0, 0, 0)).toBe(blank.id)
    expect(editor.parts.partIdOf(0, 0, 1)).toBe(blank.id)

    // 撤销后另画 ⇒ redo 分支作废，回退不恢复废弃快照
    editor.undo()
    expect(editor.log.canRedo).toBe(true)
    setUi({ currentIdentity: 'color:green', tool: 'place' })
    editor.strokeBegin()
    editor.strokeApply(at(7, 0, 0))
    editor.strokeCommit()
    expect(editor.log.canRedo).toBe(false)

    const rep = replayed(editor)
    expect(rep.volume).toEqual(blocksOf(editor))
    expect(rep.parts).toEqual(partsOf(editor))
  })

  it('回退到构件后继续编辑：新补丁与回退后的链一致（快照作废后可重建）', () => {
    const editor = makeEditor()
    editor.newProject()
    setUi({ currentIdentity: 'color:red', brushSize: { x: 1, y: 1, z: 1 }, tool: 'place', overridePlace: false })
    editor.newPart()
    const part = editor.parts.list().find((p) => p.name === '构件 2')!

    editor.strokeBegin()
    editor.strokeApply(at(4, 0, 0))
    editor.strokeCommit()
    const anchorBlocks = blocksOf(editor)

    editor.strokeBegin()
    editor.strokeApply(at(6, 0, 0))
    editor.strokeCommit()
    expect(blocksOf(editor)).not.toEqual(anchorBlocks)

    editor.rollbackToPart(part.id) // 回退 = 截断链 + 作废其后快照
    expect(blocksOf(editor)).toEqual(anchorBlocks)

    // 回退后再画：新补丁沿用被截断后的 seq，快照按当前链重建
    setUi({ currentIdentity: 'color:blue' })
    editor.strokeBegin()
    editor.strokeApply(at(8, 0, 0))
    editor.strokeCommit()
    expect(editor.volume.getBlock(8, 0, 0)).not.toBe(0)
    const rep = replayed(editor)
    expect(rep.volume).toEqual(blocksOf(editor))
    expect(rep.parts).toEqual(partsOf(editor))
  })

  it('一笔进行中不允许回退构件（与 undo/redo 同口径，A-11）', () => {
    const editor = makeEditor()
    editor.newProject()
    setUi({ currentIdentity: 'color:red', brushSize: { x: 1, y: 1, z: 1 }, tool: 'place', overridePlace: false })
    editor.newPart()
    const part = editor.parts.list().find((p) => p.name === '构件 2')!
    const patchesBefore = editor.log.patches.length

    editor.strokeBegin()
    editor.strokeApply(at(4, 0, 0))
    editor.rollbackToPart(part.id)

    expect(editor.stroke.active).toBe(true) // 半笔未被回退动过
    expect(editor.log.patches).toHaveLength(patchesBefore)
    expect(useEditorUi.getState().message).toMatch(/一笔进行中，不能回退构件/)
    editor.strokeCancel()
  })
})
