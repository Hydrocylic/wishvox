// r03 · 读面数据（ai-flow-research §③-1 五件读工具的实现面）：
// 状态快照（order 每轮重建，①-2——"地图事实不靠历史记忆"）+ y-slice 一字一格文本（A2-3 同型）。
import { countByLayer, modelBounds } from '../core/model-info'
import { resolveScope } from '../core/scope'
import type { Volume } from '../core/volume'
import type { Editor } from '../edit/editor'
import { AI_LIMITS } from './tools'
import { useEditorUi } from '../state/editor-store'
import { usedColorsOf } from '../state/projections'

/** 每轮重建的状态快照（plan §2.2 的字段：模型摘要 / 选中构件·组合 / 当前范围 / 每层计数 / AABB） */
export interface OrderSnapshot {
  readonly nonEmpty: number
  readonly bounds: { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] } | null
  readonly perLayer: ReadonlyArray<{ readonly y: number; readonly count: number }>
  readonly palette: ReadonlyArray<{ readonly identity: string; readonly key: number; readonly color?: string }>
  /** `REQ-027`（门四）：模型**实际使用**的颜色（项目键 + 规范色值 + 块数）——自建色按这两个值寻址 */
  readonly usedColors: ReadonlyArray<{ readonly identity: string; readonly key: number; readonly color: string; readonly count: number }>
  readonly partsCount: number
  readonly compositionsCount: number
  readonly selectedPartId: string | null
  readonly selectedCompositionId: string | null
}

export function buildSnapshot(editor: Editor): OrderSnapshot {
  const bounds = modelBounds(editor.volume)
  const ui = useEditorUi.getState()
  return {
    nonEmpty: editor.volume.nonEmptyCount,
    bounds: bounds ? { min: [bounds.minX, bounds.minY, bounds.minZ], max: [bounds.maxX, bounds.maxY, bounds.maxZ] } : null,
    perLayer: countByLayer(editor.volume),
    palette: editor.volume.palette.list().slice(0, AI_LIMITS.summaryPaletteRowsMax).map((e) => ({ identity: e.identity, key: e.key, ...(e.color !== undefined ? { color: e.color } : {}) })),
    usedColors: usedColorsOf(editor).slice(0, AI_LIMITS.summaryPaletteRowsMax),
    partsCount: editor.parts.list().length,
    compositionsCount: editor.compositions.list().length,
    selectedPartId: ui.selectedPartId,
    selectedCompositionId: ui.selectedCompositionId,
  }
}

/** 快照 → 给模型的文本（mapContext 常驻每轮，tools.ts:1321 同型） */
export function renderSnapshot(s: OrderSnapshot): string {
  const lines: string[] = []
  lines.push(`[模型] ${s.nonEmpty} 块；构件 ${s.partsCount} · 组合 ${s.compositionsCount}`)
  if (s.bounds) {
    const [ax, ay, az] = s.bounds.min
    const [bx, by, bz] = s.bounds.max
    lines.push(`[AABB] min(${ax},${ay},${az}) max(${bx},${by},${bz}) = ${bx - ax + 1}×${by - ay + 1}×${bz - az + 1}`)
  } else {
    lines.push('[AABB]（空模型）')
  }
  const layers = s.perLayer.map((l) => `y${l.y}:${l.count}`).join(' ')
  lines.push(`[每层块数] ${layers || '（无块）'}`)
  // `D6`（design §8，2026-10-16）：读面按**三字段**逐项给值，**不再**排 `identity#key(color)` 拼接形式——
  // 拼接串会被误当成一个可回填的值（`color:pink#14`），而它既不合法也不唯一。这里同时给出字段说明。
  const palette = s.palette.map((p) => `key=${p.key} color=${p.color ?? '（无）'} identity=${p.identity}`).join(' | ')
  lines.push(`[调色板] ${s.palette.length} 条（三字段：identity 身份串 · key 项目内数字键 1..65535 · color 规范色值；改色直接用 key 或 color，勿拼接 identity#key）`)
  lines.push(`[调色板表] ${palette}`)
  // `REQ-027`（B-07）/`D6`：自建色按"项目键 + 规范色值"寻址 ⇒ 这一行给出两个**可直接回填**的值
  const used = s.usedColors.map((u) => `key=${u.key} color=${u.color} identity=${u.identity} ×${u.count}`).join(' | ')
  lines.push(`[已用色] ${s.usedColors.length} 种（模型实际用到；字段同上，可直接回填 key 或 color）`)
  lines.push(`[已用色表] ${used || '（无）'}`)
  if (s.palette.length >= AI_LIMITS.summaryPaletteRowsMax) lines.push(`（调色板截断到 ${AI_LIMITS.summaryPaletteRowsMax} 行，完整表用 get_model_summary）`)
  const sel = s.selectedPartId ? `选中构件 ${s.selectedPartId}` : s.selectedCompositionId ? `选中组合 ${s.selectedCompositionId}` : '无选中'
  lines.push(`[选中] ${sel}`)
  return lines.join('\n')
}

/** identity → 颜色首字符（图例稳定：按调色板键序分配，"." = 空） */
export function sliceLegend(volume: Volume): { charOfKey: (key: number) => string; legend: string[] } {
  const chars = '0123456789abcdefgijklmopqrstuvwxyz' // 32 个可用字符（≤32 行调色板口径）
  const entries = volume.palette.list()
  const map = new Map<number, string>()
  entries.forEach((e, i) => {
    map.set(e.key, chars[i % chars.length])
  })
  const legend = entries.map((e, i) => `${chars[i % chars.length]}=${e.identity}`)
  return { charOfKey: (key) => map.get(key) ?? '?', legend }
}

function pad(n: number, w: number): string {
  return String(n).padStart(w, ' ')
}

/** 单层 y-slice 文本（一字一格 + 列标尺；A2-3 列对齐口径——"grids stay column-aligned"） */
export function renderYSlice(volume: Volume, y: number, bounds: NonNullable<OrderSnapshot['bounds']>, charOfKey: (key: number) => string): string {
  const [minX, , minZ] = bounds.min
  const [maxX, , maxZ] = bounds.max
  const w = Math.max(String(maxX).length, String(maxZ).length, 1)
  const rows: string[] = []
  // 列标尺（每 5 列标一次，其余打点）
  const ruler = ' '.repeat(w + 2) + Array.from({ length: maxX - minX + 1 }, (_, i) => ((minX + i) % 5 === 0 ? String((minX + i) % 10) : '·')).join('')
  rows.push(ruler)
  for (let z = minZ; z <= maxZ; z++) {
    let row = ''
    for (let x = minX; x <= maxX; x++) {
      const key = volume.getBlock(x, y, z)
      row += key === 0 ? '.' : charOfKey(key)
    }
    rows.push(`${pad(z, w)}| ${row}`)
  }
  return rows.join('\n')
}

/** 全图精读（read_map_full）：≤4096 块且 AABB 各维 ≤16 才可全读；超限教学式拒绝（§③-1） */
export function renderMapFull(volume: Volume): { ok: true; text: string } | { ok: false; error: string } {
  const bounds = modelBounds(volume)
  if (!bounds) return { ok: true, text: '（空模型——没有任何块）' }
  const w = bounds.maxX - bounds.minX + 1
  const h = bounds.maxY - bounds.minY + 1
  const l = bounds.maxZ - bounds.minZ + 1
  if (volume.nonEmptyCount > AI_LIMITS.fullReadMaxCells || w > AI_LIMITS.fullReadMaxAxis || h > AI_LIMITS.fullReadMaxAxis || l > AI_LIMITS.fullReadMaxAxis) {
    return {
      ok: false,
      error: `全图精读超限（${volume.nonEmptyCount} 块 / AABB ${w}×${h}×${l}；上限 ${AI_LIMITS.fullReadMaxCells} 块且各维 ≤${AI_LIMITS.fullReadMaxAxis}）。先 get_model_summary 看全貌，再按构件（list_parts）/组合（list_compositions）为范围分步操作`,
    }
  }
  const { charOfKey, legend } = sliceLegend(volume)
  const out: string[] = []
  out.push(`[全图] ${volume.nonEmptyCount} 块 · AABB ${w}×${h}×${l}（"."=空）`)
  for (let y = bounds.minY; y <= Math.min(bounds.maxY, bounds.minY + AI_LIMITS.snapshotMaxRows - 1); y++) {
    out.push(`── y=${y} ──`)
    out.push(renderYSlice(volume, y, { min: [bounds.minX, bounds.minY, bounds.minZ], max: [bounds.maxX, bounds.maxY, bounds.maxZ] }, charOfKey))
  }
  if (h > AI_LIMITS.snapshotMaxRows) out.push(`（层截断：共 ${h} 层，只显示底部 ${AI_LIMITS.snapshotMaxRows} 层）`)
  out.push(`[图例] ${legend.join(' ')}`)
  return { ok: true, text: out.join('\n') }
}

/** 构件目录行（list_parts） */
export function renderPartsList(editor: Editor, nameContains?: string): string {
  const list = editor.parts.list().filter((p) => !nameContains || p.name.includes(nameContains))
  const rows = list.slice(0, AI_LIMITS.listRowsMax).map((p) => `${p.id}  ${p.name}  ${p.blocks.size} 块  createdAtPatch=${p.createdAtPatch}`)
  if (list.length > AI_LIMITS.listRowsMax) rows.push(`（共 ${list.length} 个构件，截断到 ${AI_LIMITS.listRowsMax} 行——用 name_contains 过滤）`)
  return rows.length > 0 ? rows.join('\n') : '（没有构件）'
}

/** 组合目录行（list_compositions） */
export function renderCompositionsList(editor: Editor, nameContains?: string): string {
  const list = editor.compositions.list().filter((c) => !nameContains || c.name.includes(nameContains))
  const rows = list.slice(0, AI_LIMITS.listRowsMax).map((c) => {
    const coords = resolveScope(editor.volume, editor.parts, editor.compositions, { kind: 'composition', compositionId: c.id })
    const members = `${c.partIds.size} 构件 + ${c.manualBlocks.size} 直属块`
    return coords.length > 0
      ? `${c.id}  ${c.name}  ${members}  解析 ${coords.length} 块`
      : `${c.id}  ${c.name}  ${members}  （当前解析为空）`
  })
  if (list.length > AI_LIMITS.listRowsMax) rows.push(`（共 ${list.length} 个组合，截断到 ${AI_LIMITS.listRowsMax} 行——用 name_contains 过滤）`)
  return rows.length > 0 ? rows.join('\n') : '（没有组合）'
}

/** 选中读回（get_selection） */
export function renderSelection(editor: Editor): string {
  const ui = useEditorUi.getState()
  if (ui.selectedPartId) {
    const p = editor.parts.get(ui.selectedPartId)
    return p ? `选中构件 ${p.id}「${p.name}」（${p.blocks.size} 块）——写它：target_kind="part", target_id="${p.id}"` : `选中构件 ${ui.selectedPartId}（已不存在）`
  }
  if (ui.selectedCompositionId) {
    const c = editor.compositions.get(ui.selectedCompositionId)
    return c ? `选中组合 ${c.id}「${c.name}」——写它：target_kind="composition", target_id="${c.id}"` : `选中组合 ${ui.selectedCompositionId}（已不存在）`
  }
  return '当前无选中（构件树可选中构件/组合；无选中时写操作用 target_kind="all"/"manual" 或显式坐标）'
}
