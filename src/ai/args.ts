// r04 T6（I1 · ai 四拆之一）：参数解析族——自 ai/executor.ts 迁出。
// 教学式报错 + identity↔键 + target_kind/target_id 解析（①-19 名称→id，不做自然语言匹配）+
// 标量/坐标解析 + 写工具解析（OP_SPECS 派生面：parseWriteArgs / parseBrushArgs / parseSetCellsArgs）。
// D4 收严（r04 T6）：parseSetCellsArgs 的解析产物**携带 cells**（原版只留计数、执行面重解析且
// `?? 0` 放宽——一致性缺口）；executeTool 使用解析产物 ⇒ 对账面/执行面同源，未知身份沿用解析期拒绝。
import type { NoiseDirs, OpName } from '../core/types'
import { COORD_LIMIT, isCoordTripleDomain } from '../core/coords'
import type { KeyRef } from '../edit/color'
import type { Editor } from '../edit/editor'
import type { OpKeySlot, WriteParseResult } from './parse-types'
import { teachingError } from './receipt'
import { requireKeyRef, parseScopeRef, scopeCellsOf } from './scope-args'
import { AI_LIMITS, isDynamicWide, toolOpName } from './tools'

// 解析产物类型（含 `REQ-027` 的颜色引用槽）在 parse-types.ts：args.ts 已逼近 400 行，类型面按"文件 + 符号"分家。
export type { ParsedWrite, WriteParseResult } from './parse-types'

// teachingError / argError 正本在 receipt.ts（回执面）；identity↔键与 ScopeRef 解析族在 scope-args.ts。

// ── 标量与坐标解析 ──

function intArg(args: Record<string, unknown>, field: string, opts: { min?: number; max?: number; required?: boolean; default?: number }): { ok: true; value: number } | { ok: false; message: string } {
  const raw = args[field]
  const v = raw === undefined ? opts.default : raw
  if (v === undefined) return { ok: false, message: teachingError(`缺参数 ${field}`, `{ "${field}": ${opts.min ?? 0} }`) }
  if (typeof v !== 'number' || !Number.isInteger(v)) return { ok: false, message: teachingError(`参数 ${field} 必须是整数（收到 ${String(raw)}）`, `{ "${field}": ${opts.min ?? 1} }`) }
  if (opts.min !== undefined && v < opts.min) return { ok: false, message: teachingError(`参数 ${field} ≥${opts.min}（收到 ${v}）`, `{ "${field}": ${opts.min} }`) }
  if (opts.max !== undefined && v > opts.max) return { ok: false, message: teachingError(`参数 ${field} ≤${opts.max}（AI 面上限，收到 ${v}）`, `{ "${field}": ${opts.max} }`) }
  return { ok: true, value: v }
}

function floatArg(args: Record<string, unknown>, field: string, opts: { min: number; max: number }): { ok: true; value: number } | { ok: false; message: string } {
  const v = args[field]
  if (typeof v !== 'number') return { ok: false, message: teachingError(`参数 ${field} 必须是数字（收到 ${String(v)}）`, `{ "${field}": 0.5 }`) }
  if (v < opts.min || v > opts.max) return { ok: false, message: teachingError(`参数 ${field} 须在 [${opts.min}, ${opts.max}]（收到 ${v}）`, `{ "${field}": 0.5 }`) }
  return { ok: true, value: v }
}

/** 三轴格坐标（`REQ-065`）：整数且 |coord| ≤ 2¹²，**三轴同域**。
 *  原 `minY` 选项 = `REQ-059` 的 y≥0 下界，已被 `REQ-065` 取代 ⇒ 删除；域谓词与执行面同源（`core/coords`）。 */
function coordArg(args: Record<string, unknown>, field: string): { ok: true; value: { x: number; y: number; z: number } } | { ok: false; message: string } {
  const parts: Array<[number, number]> = []
  for (const axis of ['x', 'y', 'z'] as const) {
    const r = intArg(args, `${field}_${axis}`, { min: -COORD_LIMIT, max: COORD_LIMIT })
    if (!r.ok) return r
    parts.push([axis === 'x' ? 0 : axis === 'y' ? 1 : 2, r.value])
  }
  const out = { x: 0, y: 0, z: 0 }
  for (const [i, v] of parts) {
    if (i === 0) out.x = v
    else if (i === 1) out.y = v
    else out.z = v
  }
  return { ok: true, value: out }
}

function dirsArg(args: Record<string, unknown>): { ok: true; value: NoiseDirs } | { ok: false; message: string } {
  const dirs = { px: false, nx: false, py: false, ny: false, pz: false, nz: false }
  for (const k of Object.keys(dirs) as Array<keyof NoiseDirs>) {
    const v = args[k]
    if (typeof v === 'boolean') dirs[k] = v
  }
  if (!Object.values(dirs).some(Boolean)) {
    return { ok: false, message: teachingError('方位至少勾一个', `{ "px": true, "nx": false, "py": false, "ny": false, "pz": false, "nz": false }`) }
  }
  return { ok: true, value: dirs }
}

// ── 写工具解析（OP_SPECS 派生面）──

/** 把 AI 平铺参数解析成 ProgramOp（flat-first 的逆映射；参数名 = tools.ts mapParam 的镜像） */
export function parseWriteArgs(editor: Editor, toolName: string, args: Record<string, unknown>): WriteParseResult {
  if (toolName === 'brush') return parseBrushArgs(editor, args)
  if (toolName === 'set_cells') return parseSetCellsArgs(editor, args)
  if (toolName === 'undo' || toolName === 'redo') {
    const r = intArg(args, 'steps', { min: 1, max: AI_LIMITS.undoStepsMax, default: 1 })
    if (!r.ok) return r
    return { ok: true, parsed: { kind: toolName, wide: true, estimatedCells: r.value } }
  }
  const opName = toolOpName(toolName)
  if (!opName) return { ok: false, message: `未知工具 ${toolName}` }
  const scopeCells = args.target_kind !== undefined ? parseScopeRef(editor, args) : { ok: true as const, ref: null }
  if (!scopeCells.ok) return scopeCells
  const ref = scopeCells.ref

  const scopeCount = ref ? scopeCellsOf(editor, ref) : null
  if (scopeCount && 'error' in scopeCount) return { ok: false, message: scopeCount.error }
  const scopeIsAll = ref?.kind === 'all'
  const baseCells = ref ? (scopeCount && 'cells' in scopeCount ? scopeCount.cells : 0) : 0

  switch (opName as OpName) {
    case 'noiseFill': {
      const density = floatArg(args, 'density', { min: 0, max: 1 })
      if (!density.ok) return density
      const seed = intArg(args, 'seed', { min: 0 })
      if (!seed.ok) return seed
      const rawKeys = args.keys
      if (!Array.isArray(rawKeys) || rawKeys.length === 0) {
        return { ok: false, message: teachingError('keys 至少一个身份串 / 规范色值', `{ "keys": ["color:red"] }`) }
      }
      const keys: KeyRef[] = []
      for (const id of rawKeys) {
        const k = requireKeyRef(editor, id, 'keys[]')
        if (!k.ok) return k
        keys.push(k.ref)
      }
      return {
        ok: true,
        parsed: {
          kind: 'program',
          op: { type: 'program', name: 'noiseFill', params: { scope: ref!, density: density.value, keys: keys.map(() => 0), seed: seed.value } },
          opKeyRefs: [{ field: 'keys', refs: keys, many: true }],
          estimatedCells: Math.ceil(baseCells * 1.5),
          wide: isDynamicWide(baseCells, scopeIsAll),
        },
      }
    }
    case 'noiseSculpt': {
      const amplitude = intArg(args, 'amplitude', { min: 1, max: 4 })
      if (!amplitude.ok) return amplitude
      const density = floatArg(args, 'density', { min: 0.01, max: 1 })
      if (!density.ok) return density
      const seed = intArg(args, 'seed', { min: 0 })
      if (!seed.ok) return seed
      const dirs = dirsArg(args)
      if (!dirs.ok) return dirs
      const key = requireKeyRef(editor, args.key, 'key')
      if (!key.ok) return key
      return {
        ok: true,
        parsed: {
          kind: 'program',
          op: { type: 'program', name: 'noiseSculpt', params: { scope: ref!, amplitude: amplitude.value, density: density.value, seed: seed.value, dirs: dirs.value, key: 0 } },
          opKeyRefs: [{ field: 'key', refs: [key.ref] }],
          estimatedCells: baseCells * (1 + amplitude.value),
          wide: isDynamicWide(baseCells * (1 + amplitude.value), scopeIsAll),
        },
      }
    }
    case 'presetShape': {
      const shape = args.shape
      if (shape !== 'box' && shape !== 'cylinder' && shape !== 'cone' && shape !== 'sphere') {
        return { ok: false, message: teachingError('shape 必须是 box / cylinder / cone / sphere', `{ "shape": "box" }`) }
      }
      const origin = coordArg(args, 'origin') // `REQ-065`：三轴 ±2¹²（含 y<0）；原 REQ-059 的 origin.y ≥0 已废止
      if (!origin.ok) return origin
      const size = coordArg(args, 'size')
      if (!size.ok) return size
      for (const axis of ['x', 'y', 'z'] as const) {
        const v = size.value[axis]
        if (v < 1 || v > AI_LIMITS.presetSizeMaxAxis) {
          return { ok: false, message: teachingError(`size_${axis} 须在 1–${AI_LIMITS.presetSizeMaxAxis}（收到 ${v}）`, `{ "size_x": 4, "size_y": 4, "size_z": 4 }`) }
        }
      }
      const key = requireKeyRef(editor, args.key, 'key')
      if (!key.ok) return key
      const hollow = args.hollow === true
      const cells = size.value.x * size.value.y * size.value.z
      return {
        ok: true,
        parsed: {
          kind: 'program',
          op: { type: 'program', name: 'presetShape', params: { shape, origin: origin.value, size: size.value, key: 0, ...(hollow ? { hollow: true } : {}) } },
          opKeyRefs: [{ field: 'key', refs: [key.ref] }],
          estimatedCells: cells,
          wide: isDynamicWide(cells, false),
        },
      }
    }
    case 'raiseByLayers': {
      const layers = intArg(args, 'layers', { min: 1, max: AI_LIMITS.raiseLayersMax })
      if (!layers.ok) return layers
      return {
        ok: true,
        parsed: {
          kind: 'program',
          op: { type: 'program', name: 'raiseByLayers', params: { scope: ref!, layers: layers.value } },
          estimatedCells: baseCells,
          wide: true, // 静态 wide（口径卡 §二）
        },
      }
    }
    case 'addLayer': {
      const count = intArg(args, 'count', { min: 1, max: AI_LIMITS.addLayerCountMax })
      if (!count.ok) return count
      const key = requireKeyRef(editor, args.key, 'key')
      if (!key.ok) return key
      const cells = baseCells * count.value
      return {
        ok: true,
        parsed: {
          kind: 'program',
          op: { type: 'program', name: 'addLayer', params: { scope: ref!, count: count.value, key: 0 } },
          opKeyRefs: [{ field: 'key', refs: [key.ref] }],
          estimatedCells: cells,
          wide: isDynamicWide(cells, scopeIsAll),
        },
      }
    }
    case 'recolor': {
      const to = requireKeyRef(editor, args.to, 'to')
      if (!to.ok) return to
      const slots: OpKeySlot[] = [{ field: 'toKey', refs: [to.ref] }]
      let fromKeys: number[] | undefined
      if (args.from !== undefined) {
        if (!Array.isArray(args.from)) return { ok: false, message: teachingError('from 必须是身份串 / 规范色值数组', `{ "from": ["color:blue"] }`) }
        if (args.from.length > AI_LIMITS.recolorFromKeysMax) {
          return { ok: false, message: teachingError(`from ≤${AI_LIMITS.recolorFromKeysMax} 个（收到 ${args.from.length}）`, `{ "from": ["color:blue"] }`) }
        }
        const refs: KeyRef[] = []
        for (const id of args.from) {
          const k = requireKeyRef(editor, id, 'from[]')
          if (!k.ok) return k
          refs.push(k.ref)
        }
        fromKeys = refs.map(() => 0)
        slots.push({ field: 'fromKeys', refs, many: true })
      }
      return {
        ok: true,
        parsed: {
          kind: 'program',
          op: { type: 'program', name: 'recolor', params: { scope: ref!, toKey: 0, ...(fromKeys ? { fromKeys } : {}) } },
          opKeyRefs: slots,
          estimatedCells: baseCells,
          wide: isDynamicWide(baseCells, scopeIsAll),
        },
      }
    }
    case 'clearScope':
      return {
        ok: true,
        parsed: {
          kind: 'program',
          op: { type: 'program', name: 'clearScope', params: { scope: ref! } },
          estimatedCells: baseCells,
          wide: true, // 静态 wide；scope=all 时摘要里写明"清空全体"
        },
      }
    case 'mirrorArray': {
      const axis = args.axis
      if (axis !== 'x' && axis !== 'z') return { ok: false, message: teachingError('axis 只能是 x 或 z', `{ "axis": "x" }`) }
      const copies = intArg(args, 'copies', { min: 1, max: AI_LIMITS.mirrorCopiesMax })
      if (!copies.ok) return copies
      const spacing = intArg(args, 'spacing', { min: 0, max: 64 })
      if (!spacing.ok) return spacing
      const cells = baseCells * copies.value
      return {
        ok: true,
        parsed: {
          kind: 'program',
          op: { type: 'program', name: 'mirrorArray', params: { scope: ref!, axis, copies: copies.value, spacing: spacing.value } },
          estimatedCells: cells,
          wide: true, // 静态 wide
        },
      }
    }
    case 'bevelEdges': {
      const radius = intArg(args, 'radius', { min: 1, max: 3 })
      if (!radius.ok) return radius
      const passes = intArg(args, 'passes', { min: 1, max: AI_LIMITS.bevelPassesMax })
      if (!passes.ok) return passes
      return {
        ok: true,
        parsed: {
          kind: 'program',
          op: { type: 'program', name: 'bevelEdges', params: { scope: ref!, radius: radius.value, passes: passes.value } },
          estimatedCells: baseCells,
          wide: isDynamicWide(baseCells, scopeIsAll),
        },
      }
    }
  }
}

function parseBrushArgs(editor: Editor, args: Record<string, unknown>): WriteParseResult {
  const modifier = args.modifier
  if (modifier !== 'place' && modifier !== 'erase' && modifier !== 'paint' && modifier !== 'override') {
    return { ok: false, message: teachingError('modifier 必须是 place / erase / paint / override', `{ "modifier": "place" }`) }
  }
  const sizeParts: number[] = []
  for (const axis of ['x', 'y', 'z'] as const) {
    const r = intArg(args, `size_${axis}`, { min: 1, max: AI_LIMITS.brushMaxAxis })
    if (!r.ok) return r
    sizeParts.push(r.value)
  }
  const size = { x: sizeParts[0]!, y: sizeParts[1]!, z: sizeParts[2]! }
  const vol = size.x * size.y * size.z
  const anchorsRaw = args.anchors
  if (!Array.isArray(anchorsRaw) || anchorsRaw.length === 0) {
    return { ok: false, message: teachingError('anchors 至少一个 [x, y, z]', `{ "anchors": [[0, 0, 0]] }`) }
  }
  if (anchorsRaw.length > AI_LIMITS.brushMaxAnchors) {
    return { ok: false, message: teachingError(`anchors ≤${AI_LIMITS.brushMaxAnchors} 个（收到 ${anchorsRaw.length}）`, `{ "anchors": [[0, 0, 0]] }`) }
  }
  const anchors: Array<{ x: number; y: number; z: number }> = []
  for (const a of anchorsRaw) {
    if (!Array.isArray(a) || a.length !== 3 || !a.every((n) => typeof n === 'number' && Number.isInteger(n))) {
      return { ok: false, message: teachingError('每个锚点必须是 [x, y, z] 整数三元组', `[[0, 0, 0]]`) }
    }
    anchors.push({ x: a[0] as number, y: a[1] as number, z: a[2] as number })
  }
  let key: KeyRef = { kind: 'air' } // 擦除不写色（键 0 = 空），无需颜色引用
  if (modifier !== 'erase') {
    const k = requireKeyRef(editor, args.key, 'key')
    if (!k.ok) return k
    key = k.ref
  }
  const union = anchors.length * vol
  if (union > AI_LIMITS.brushUnionMax) {
    return {
      ok: false,
      message: teachingError(`笔刷并集 ${union} 格超上限 ${AI_LIMITS.brushUnionMax}（${anchors.length} 锚 × ${vol} 格）`, '减小 size 或拆多笔（每笔一次调用一条补丁）'),
    }
  }
  return {
    ok: true,
    parsed: {
      kind: 'brush',
      wide: isDynamicWide(union, false),
      estimatedCells: union,
      brush: {
        modifier,
        action: modifier === 'override' ? 'place' : modifier,
        mode: modifier === 'override' ? 'override' : 'additive',
        size,
        anchors,
        key,
      },
    },
  }
}

function parseSetCellsArgs(editor: Editor, args: Record<string, unknown>): WriteParseResult {
  const raw = args.cells
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, message: teachingError('cells 至少一条 [x, y, z, key]', `[[0, 0, 0, "color:red"]]`) }
  if (raw.length > AI_LIMITS.setCellsMax) {
    return { ok: false, message: teachingError(`cells ≤${AI_LIMITS.setCellsMax} 条（收到 ${raw.length}）`, '拆成多次调用，或改用 brush / 程序化操作') }
  }
  const bounds = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity }
  let any = false
  for (const b of editor.volume.iterBlocks()) {
    any = true
    bounds.minX = Math.min(bounds.minX, b.x)
    bounds.minY = Math.min(bounds.minY, b.y)
    bounds.minZ = Math.min(bounds.minZ, b.z)
    bounds.maxX = Math.max(bounds.maxX, b.x)
    bounds.maxY = Math.max(bounds.maxY, b.y)
    bounds.maxZ = Math.max(bounds.maxZ, b.z)
  }
  const cells: Array<{ x: number; y: number; z: number; key: KeyRef }> = []
  let outOfBounds = 0
  for (const c of raw) {
    // 结构错误（不是 [x, y, z, key] 四元组）仍拒整笔——形状问题不是数域问题
    if (!Array.isArray(c) || c.length !== 4) {
      return { ok: false, message: teachingError('每条 cell 是 [x, y, z, key]（key = 身份串或 "air"）', `[[0, 0, 0, "color:red"]]`) }
    }
    const [x, y, z] = c as [number, number, number, unknown]
    // `REQ-065`（取代 `REQ-059` 的 y≥0 下界）：三轴统一按 ±2¹² 整数域判定。
    // 非法（非整数 / 非有限 / 越界）⇒ **丢弃并计数**，不拒整笔——回执里"N 格超出 ±4096 整数域未放置"。
    // 判定必须排在 AABB 邻近度之前：域外坐标属于数域问题，不该被当成"离模型太远"整笔打回。
    if (!isCoordTripleDomain(x, y, z)) {
      outOfBounds++
      continue
    }
    if (any && (x < bounds.minX - AI_LIMITS.setCellsCoordRange || x > bounds.maxX + AI_LIMITS.setCellsCoordRange || y < bounds.minY - AI_LIMITS.setCellsCoordRange || (bounds.maxY !== -Infinity && y > bounds.maxY + AI_LIMITS.setCellsCoordRange) || z < bounds.minZ - AI_LIMITS.setCellsCoordRange || z > bounds.maxZ + AI_LIMITS.setCellsCoordRange)) {
      return { ok: false, message: teachingError(`坐标 (${x},${y},${z}) 离模型 AABB 超过 ${AI_LIMITS.setCellsCoordRange} 格`, '在模型附近逐块修补；大范围改动用程序化操作') }
    }
    const keyId = c[3]
    let key: KeyRef
    if (keyId === 'air') key = { kind: 'air' }
    else {
      const k = requireKeyRef(editor, keyId, 'cells[].key')
      if (!k.ok) return k
      key = k.ref
    }
    cells.push({ x, y, z, key })
  }
  return {
    ok: true,
    parsed: {
      kind: 'setCells',
      wide: isDynamicWide(cells.length, false),
      estimatedCells: cells.length,
      cells, // D4 收严：解析产物随行（执行面不再重解析）
      outOfBounds,
      op: undefined,
    },
  }
}
