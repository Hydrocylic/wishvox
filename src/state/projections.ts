// r04 T6（A6）：模型 → store 的投影——自 edit/editor.ts 的 syncUi / historyItems 迁出。
// 会话状态（两个 store）与"模型在 UI 上的投影"同居 state 层（edit → state 向下）。
// 本批只搬家不重构：推送时机与字段不变（Q5 已裁——O(全块) 手工块计数的增量重算不在本轮）。
import { BUILTIN_COLOR_BLOCKS } from '../core/builtin-palette'
import { canonicalHex } from '../core/color'
import { countByLayer, modelBounds } from '../core/model-info'
import { resolveScope } from '../core/scope'
import type { PatchLog } from '../core/patch-log'
import type { HistoryItem } from './editor-store'
import { setUi, useEditorUi } from './editor-store'
import type { Editor } from '../edit/editor'

/** F12 撤销历史条目（label = 补丁的操作名字段；state 区分已应用 / 已撤销） */
export function historyItemsOf(log: PatchLog): HistoryItem[] {
  const actionOf = (p: { op: { type: string; name?: string; action?: string } }): string => {
    if (p.op.type === 'program') return p.op.name ?? 'program'
    if (p.op.type === 'stroke') return p.op.action ?? 'stroke'
    return p.op.type
  }
  return [
    ...log.patches.map((p) => ({ seq: p.seq, label: p.label ?? `补丁 ${p.seq}`, cells: p.changes.length, action: actionOf(p), state: 'applied' as const })),
    ...log.undonePatches.map((p) => ({ seq: p.seq, label: p.label ?? `补丁 ${p.seq}`, cells: p.changes.length, action: actionOf(p), state: 'undone' as const })),
  ].sort((a, b) => a.seq - b.seq)
}

/** P3（B-05）：模型已用颜色 = **全模型**非空块按规范色值去重统计。
 *  口径：从 volume 直接统计 ⇒ 隐藏层的颜色仍在（不读层次过滤、不读选中范围）；
 *  去重按规范化 RGB（大小写/三位写法不产生重复项）；不合并不同方块身份/状态的块（各自计数相加）。
 *  改块即重算 ⇒ 最后同色块删除即从列表消失，撤销后模型复原、列表自然恢复。 */
export function usedColorsOf(ed: Editor): Array<{ identity: string; color: string; key: number; count: number }> {
  const countByKey = new Map<number, number>()
  for (const b of ed.volume.iterBlocks()) {
    if (b.key === 0) continue
    countByKey.set(b.key, (countByKey.get(b.key) ?? 0) + 1)
  }
  const byColor = new Map<string, { identity: string; color: string; key: number; count: number }>()
  for (const e of ed.volume.palette.list()) {
    const n = countByKey.get(e.key)
    if (!n) continue
    const color = canonicalHex(e.color ?? '')
    if (color === null) continue // 无原始色值的条目（贴图/身份占位）不进颜色列表
    const hit = byColor.get(color)
    if (hit) hit.count += n
    else byColor.set(color, { identity: e.identity, color, key: e.key, count: n })
  }
  return [...byColor.values()].sort((a, b) => a.key - b.key)
}

/** 模型 → editor store 的全量投影（20+ 字段；每次写操作后由 Editor.syncUi 调用）。 */
export function syncUi(ed: Editor): void {
  const prev = useEditorUi.getState()
  let manualCount = 0
  for (const b of ed.volume.iterBlocks()) {
    if (ed.parts.partIdOf(b.x, b.y, b.z) === undefined) manualCount++
  }
  const bounds = modelBounds(ed.volume)
  // REQ-052：范围只描述模型层；新增/撤销不隐式切换过滤层或工作平面。
  const minNext = bounds ? bounds.minY : 0
  const maxNext = bounds ? bounds.maxY : 0
  const layerY = prev.layerY
  setUi({
    blockStyle: ed.blockStyle,
    selectedPartId: ed.selectedPartId,
    selectedCompositionId: ed.selectedCompositionId,
    missingIdentities: ed.missing,
    usedColors: usedColorsOf(ed),
    paletteItems: BUILTIN_COLOR_BLOCKS.map((b) => ({
      identity: b.identity,
      color: b.color,
      key: ed.builtinKeys.get(b.identity) ?? 0,
    })),
    parts: ed.parts.list().map((p) => ({
      id: p.id,
      name: p.name,
      count: p.blocks.size,
      createdAtPatch: p.createdAtPatch,
    })),
    compositions: ed.compositions.list().map((c) => ({
      id: c.id,
      name: c.name,
      memberPartIds: [...c.partIds],
      manualBlockCount: c.manualBlocks.size,
      blockCount:
        resolveScope(ed.volume, ed.parts, ed.compositions, {
          kind: 'composition',
          compositionId: c.id,
        }).length,
    })),
    manualBlockCount: manualCount,
    canUndo: ed.log.canUndo,
    canRedo: ed.log.canRedo,
    nonEmpty: ed.volume.nonEmptyCount,
    chunkCount: ed.volume.chunkCount,
    layerMinY: minNext,
    layerMaxY: maxNext,
    layerY,
    perLayerCounts: countByLayer(ed.volume),
    boundsReadout: bounds
      ? {
          min: [bounds.minX, bounds.minY, bounds.minZ],
          max: [bounds.maxX, bounds.maxY, bounds.maxZ],
          w: bounds.w,
          h: bounds.h,
          l: bounds.l,
          center: [bounds.centerX, bounds.centerY, bounds.centerZ],
        }
      : null,
    history: historyItemsOf(ed.log),
    version: prev.version + 1,
  })
}
