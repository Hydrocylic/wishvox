// r04 T6（A3）：构件与组合的生命周期命令——自 edit/editor.ts 迁出（函数文件）。
// Editor 的同名公共方法是一行委托（facade 不变）；REQ-018 / REQ-023 / REQ-050（D-B / D-D / D-C）。
import { coordKey } from '../core/coords'
import { resolveScope } from '../core/scope'
import { setUi } from '../state/editor-store'
import type { Editor } from './editor'

// ── 构件（REQ-018 / REQ-023 · D-B / D-D）──

export function selectPart(ed: Editor, partId: string | null): void {
  ed.selectedPartId = partId
  ed.selectedCompositionId = null // 选中互斥：构件与组合不同时高亮
  ed.renderer?.setHighlightedCoords?.(null)
  ed.renderer?.setHighlightedPart(partId)
  ed.syncUi()
}

/** 新建**空构件**并选中（后续手工放置归它；D-B ③——不再"首次放置隐式建构件"） */
export function newPart(ed: Editor): void {
  const part = ed.log.createPart(`构件 ${ed.parts.list().length + 1}`)
  ed.selectedPartId = part.id
  ed.selectedCompositionId = null
  ed.renderer?.setHighlightedCoords?.(null)
  ed.renderer?.setHighlightedPart(part.id)
  ed.syncUi()
}

export function renamePart(ed: Editor, partId: string, name: string): void {
  ed.parts.rename(partId, name)
  ed.autosave.notifyChange()
  ed.syncUi()
}

/** D-D：删除构件 = **解除归属**（块留下、成为手工块）；"连同块一起删"本轮不做。 */
export function dissolvePart(ed: Editor, partId: string): void {
  const part = ed.parts.get(partId)
  if (!part) return
  const freed = ed.parts.dissolve(partId)
  if (ed.selectedPartId === partId) ed.selectedPartId = null
  ed.autosave.notifyChange()
  ed.syncUi()
  setUi({ message: `已删除构件「${part.name}」：解除归属 ${freed} 块（方块保留，成为手工块）` })
}

/** 回退到某构件（REQ-023 ②）：模型 = 该构件创建补丁应用后的快照。
 *  `A-11`（与 `history.ts#undo/redo` 同口径）：一笔进行中不允许——回退会整体重置体素与归属，
 *  而活动笔的旁路缓冲仍持有落笔前的 `before`，随后 commit 会把已废弃的旧值写回模型。 */
export function rollbackToPart(ed: Editor, partId: string): void {
  const part = ed.parts.get(partId)
  if (!part) return
  if (ed.stroke.active) {
    setUi({ message: '一笔进行中，不能回退构件：先松开鼠标或取消该笔' })
    return
  }
  ed.log.rollbackToSeq(part.createdAtPatch)
  ed.selectedPartId = partId
  ed.updateAppearance()
  ed.renderer?.rebuildAll()
  ed.renderer?.setHighlightedPart(partId)
  ed.autosave.notifyChange()
  ed.syncUi()
  setUi({ message: `已回退到「${part.name}」创建时` })
}

// ── 组合（REQ-051 · D-C：语义分组视图，不改 part 归属；首版不嵌套）──

export function createComposition(ed: Editor, name?: string): void {
  const comp = ed.compositions.create(name?.trim() || `组合 ${ed.compositions.list().length + 1}`)
  selectComposition(ed, comp.id)
  ed.autosave.notifyChange()
}

export function renameComposition(ed: Editor, id: string, name: string): void {
  ed.compositions.rename(id, name)
  ed.autosave.notifyChange()
  ed.syncUi()
}

export function addPartToComposition(ed: Editor, compId: string, partId: string): void {
  ed.compositions.addPart(compId, partId)
  ed.autosave.notifyChange()
  ed.syncUi()
}

export function removePartFromComposition(ed: Editor, compId: string, partId: string): void {
  ed.compositions.removePart(compId, partId)
  ed.autosave.notifyChange()
  ed.syncUi()
}

/** 把**当前全部手工块**并入组合（UI 的最小入口：无归属块逐个点选归框选工具 r05，不做） */
export function addManualBlocksToComposition(ed: Editor, compId: string): void {
  const comp = ed.compositions.get(compId)
  if (!comp) return
  let added = 0
  for (const c of resolveScope(ed.volume, ed.parts, ed.compositions, { kind: 'manual' })) {
    if (ed.compositions.addManualBlock(compId, c.x, c.y, c.z)) added++
  }
  ed.autosave.notifyChange()
  ed.syncUi()
  setUi({ message: added > 0 ? `已把 ${added} 块手工块并入「${comp.name}」` : '没有手工块可并入' })
}

/** 拆除组合（视图消失；块与 part 归属不变——D-C ②） */
export function dissolveComposition(ed: Editor, id: string): void {
  const comp = ed.compositions.get(id)
  if (!comp) return
  ed.compositions.dissolve(id)
  if (ed.selectedCompositionId === id) {
    ed.selectedCompositionId = null
    ed.renderer?.setHighlightedCoords?.(null)
  }
  ed.autosave.notifyChange()
  ed.syncUi()
  setUi({ message: `已拆除组合「${comp.name}」（方块与构件归属不变）` })
}

/** 选中组合 ⇒ 视口高亮其块集合（REQ-051 ②：高亮集合 = resolveScope 解析集合） */
export function selectComposition(ed: Editor, id: string | null): void {
  ed.selectedPartId = null
  ed.selectedCompositionId = id
  ed.renderer?.setHighlightedPart(null)
  if (id === null) {
    ed.renderer?.setHighlightedCoords?.(null)
  } else {
    const coords = resolveScope(ed.volume, ed.parts, ed.compositions, { kind: 'composition', compositionId: id })
    ed.renderer?.setHighlightedCoords?.(new Set(coords.map((c) => coordKey(c.x, c.y, c.z))))
  }
  ed.syncUi()
}
