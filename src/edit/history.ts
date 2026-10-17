// r04 T6（A8 超线兜底之二）：撤销历史族——自 edit/editor.ts 迁出。
// F12：跳转 = 逐步 undo/redo 的循环 ⇒ 与单步路径天然等价（V13）；条目投影在 state/projections.ts。
import type { Editor } from './editor'

/** 点击历史某行 = 跳到该笔应用后的状态（undo(n) / redo(n)） */
export function historyJump(ed: Editor, seq: number): void {
  if (ed.stroke.active) return
  const applied = ed.log.patches.length
  if (seq < applied - 1) {
    for (let i = 0; i < applied - 1 - seq; i++) undo(ed)
  } else if (seq >= applied) {
    for (let i = 0; i < seq - applied + 1; i++) redo(ed)
  }
}

export function undo(ed: Editor): void {
  if (ed.stroke.active) return // 一笔进行中不允许（指针按住时也无入口可触发）
  const r = ed.log.undo()
  if (!r) return
  if (ed.selectedPartId && !ed.parts.get(ed.selectedPartId)) ed.selectedPartId = null // D3：undo 剪掉的构件 ⇒ 清悬挂选中
  ed.renderer?.applyChanges(r.appliedChanges)
  ed.updateAppearance()
  ed.autosave.notifyChange()
  ed.syncUi()
}

export function redo(ed: Editor): void {
  if (ed.stroke.active) return
  const r = ed.log.redo()
  if (!r) return
  if (ed.selectedPartId && !ed.parts.get(ed.selectedPartId)) ed.selectedPartId = null
  ed.renderer?.applyChanges(r.appliedChanges)
  ed.updateAppearance()
  ed.autosave.notifyChange()
  ed.syncUi()
}
