import { APP_VERSION } from './version'
import { MAX_PALETTE_KEY } from '../core/color'
import { chunkInDomain, isCoordDomain, isCoordTripleDomain } from '../core/coords'
import { LEGACY_PROJECT_FORMAT, PROJECT_FORMAT } from '../core/types'
import { LEGACY_STYLE_VALUE, normalizeBlockStyle } from './legacy-style'
import type { StyleDowngrade } from './legacy-style'
import type { CompositionRegistry } from '../core/composition'
import type { PartCreation } from '../core/patch-log'
import type { PartRegistry } from '../core/parts'
import type {
  BlockStyle,
  ChunkFile,
  CompositionData,
  Op,
  PaletteEntry,
  PartCreationFile,
  Patch,
  ProjectFileV1,
  ProjectFileV2,
  ProjectMeta,
  SerializedPatch,
  VoxelChange,
} from '../core/types'
import type { Volume } from '../core/volume'

// r04 T6（D2）：APP_VERSION 的正本在 io/version.ts（本文件只消费）

/** v2：补丁带上操作标签与"操作前归属"（undo 精确还原需要）；v1 样本缺省两者 */
function serializePatch(p: Patch): SerializedPatch {
  const out: SerializedPatch = {
    seq: p.seq,
    op: p.op,
    changes: p.changes.map((c) => ({ ...c })),
    partId: p.partId,
    createdAt: p.createdAt,
  }
  if (p.label !== undefined) out.label = p.label
  if (p.ownersBefore !== undefined) out.ownersBefore = [...p.ownersBefore]
  // r03（ADR-19）：组合直属块账 + 抬升随块走账（v2 透传；旧档缺省）
  if (p.compositionId !== undefined && p.compositionId !== null) out.compositionId = p.compositionId
  if (p.compMembersBefore !== undefined) out.compMembersBefore = [...p.compMembersBefore]
  if (p.ownersAfter !== undefined) out.ownersAfter = [...p.ownersAfter]
  return out
}

export function encodeProject(args: {
  volume: Volume
  parts: PartRegistry
  patches: readonly Patch[]
  partCreations: readonly PartCreation[]
  compositions: CompositionRegistry
  blockStyle: BlockStyle
  meta: ProjectMeta
}): ProjectFileV2 {
  const chunks: ChunkFile[] = []
  for (const ch of args.volume.iterChunks()) {
    chunks.push({ x: ch.cx, y: ch.cy, z: ch.cz, size: 16, data: Array.from(ch.data) })
  }
  const partCreations: PartCreationFile[] = args.partCreations.map((c) => ({ ...c }))
  return {
    format: PROJECT_FORMAT,
    formatVersion: 2,
    appVersion: APP_VERSION,
    meta: { ...args.meta },
    blockStyle: args.blockStyle,
    palette: args.volume.palette.list().map((e) => ({ ...e, state: { ...e.state } })),
    chunks,
    parts: args.parts.serialize(),
    compositions: args.compositions.serialize(),
    // 快照即当前状态：snapshotAt = 补丁总数；重放路径 = 全量 patches（r04 时间轴读这份）
    log: {
      snapshotAt: args.patches.length,
      patches: args.patches.map(serializePatch),
      partCreations,
    },
  }
}

type DecodeResult =
  | { ok: true; file: ProjectFileV2; downgrade?: StyleDowngrade }
  | { ok: false; error: string }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * `REQ-065`：整数**且** `|v| ≤ 2¹²`。全文件唯一的坐标整型判定——chunk 布局、块坐标、补丁 changes、
 * 构件/组合块表都走它，因此"手动 / AI / 导入 / 重放共用同一判定"在导入面上天然成立。
 * 旧档越界 ⇒ 判定失败 ⇒ `decodeProject` 返回 `{ok:false}` ⇒ 调用方保留原状态（不迁移、不裁剪）。
 */
function isInt(v: unknown): v is number {
  return isCoordDomain(v)
}

function isCoord3(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && isCoordTripleDomain(v[0], v[1], v[2])
}

/** 非坐标的普通整数（调色板键 / 尺寸 / 序号 / 快照位点）——受各自的值域约束，不受坐标域约束 */
function isSmallInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v)
}

const PROGRAM_OP_NAMES = new Set([
  'noiseFill',
  'noiseSculpt',
  'presetShape',
  'raiseByLayers',
  'addLayer',
  'recolor',
  'clearScope',
  'mirrorArray',
  'bevelEdges',
])

const STROKE_ACTIONS = new Set(['place', 'erase', 'paint'])
const STROKE_MODES = new Set(['additive', 'override'])

/** 单块 op（set/delete）、程序化 op（program）或笔刷一笔（stroke，r02 前半）的形状校验 */
function checkPatchOp(path: string, op: Record<string, unknown>): string | null {
  if (op.type === 'set' || op.type === 'delete') {
    if (!isInt(op.x) || !isInt(op.y) || !isInt(op.z)) return `${path} coordinates must be integers within ±2¹² (REQ-065)`
    if (op.type === 'set' && !isSmallInt(op.key)) return `${path}.key must be an integer`
    return null
  }
  if (op.type === 'stroke') {
    if (typeof op.action !== 'string' || !STROKE_ACTIONS.has(op.action)) {
      return `${path}.action must be one of "place" | "erase" | "paint"`
    }
    if (typeof op.mode !== 'string' || !STROKE_MODES.has(op.mode)) {
      return `${path}.mode must be "additive" | "override"`
    }
    if (
      !isRecord(op.size) ||
      !isSmallInt(op.size.x) || !isSmallInt(op.size.y) || !isSmallInt(op.size.z) ||
      op.size.x < 1 || op.size.y < 1 || op.size.z < 1
    ) {
      return `${path}.size must be positive-integer x/y/z (brush volume)`
    }
    return null
  }
  if (op.type === 'program') {
    if (typeof op.name !== 'string' || !PROGRAM_OP_NAMES.has(op.name)) {
      return `${path}.name must be one of the program ops`
    }
    if (!isRecord(op.params)) return `${path}.params must be an object`
    return null
  }
  return `${path}.type must be "set" | "delete" | "program" | "stroke"`
}

/**
 * 导入校验（REQ-003 / NFR-006）：要么完整成功、要么明确失败。
 * 任何一处不合 ⇒ 返回 { ok:false, error }，调用方保持当前场景不变——绝不产出空场景。
 * v1（formatVersion 1）⇒ 迁移为 v2 形状：compositions = 空数组、补丁 label/ownersBefore 缺省（NFR-006 的迁移口径）。
 */
export function decodeProject(text: string): DecodeResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return { ok: false, error: `not valid JSON: ${(e as Error).message}` }
  }
  if (!isRecord(raw)) return { ok: false, error: 'root must be an object' }
  // 品牌改名（2026-10-17）：**新旧项目格式串双读**——旧档 / 展示件仍是旧串；解码后统一归一化为新串。
  if (raw.format !== PROJECT_FORMAT && raw.format !== LEGACY_PROJECT_FORMAT) {
    return { ok: false, error: `unsupported format: ${String(raw.format)}` }
  }
  if (raw.formatVersion !== 1 && raw.formatVersion !== 2) {
    return { ok: false, error: `unsupported formatVersion: ${String(raw.formatVersion)}` }
  }
  const isV1 = raw.formatVersion === 1
  if (typeof raw.appVersion !== 'string') return { ok: false, error: 'field appVersion must be a string' }
  if (!isRecord(raw.meta)) return { ok: false, error: 'field meta must be an object' }
  for (const k of ['id', 'title', 'createdAt', 'updatedAt'] as const) {
    if (typeof raw.meta[k] !== 'string') return { ok: false, error: `field meta.${k} must be a string` }
  }
  if (raw.blockStyle !== 'color' && raw.blockStyle !== LEGACY_STYLE_VALUE) {
    return { ok: false, error: `field blockStyle must be "color": ${String(raw.blockStyle)}` }
  }
  if (!Array.isArray(raw.palette)) return { ok: false, error: 'field palette must be an array' }
  const paletteKeys = new Set<number>()
  for (let i = 0; i < raw.palette.length; i++) {
    const e = raw.palette[i]
    if (!isRecord(e)) return { ok: false, error: `palette[${i}] must be an object` }
    if (!isSmallInt(e.key) || e.key <= 0 || e.key > MAX_PALETTE_KEY) {
      return { ok: false, error: `palette[${i}].key must be a positive integer ≤ ${MAX_PALETTE_KEY} (REQ-027 键容量)` }
    }
    if (paletteKeys.has(e.key)) return { ok: false, error: `palette[${i}].key duplicate: ${e.key}` }
    paletteKeys.add(e.key)
    if (typeof e.identity !== 'string') return { ok: false, error: `palette[${i}].identity must be a string` }
    // REQ-046：state 允许为空对象，但字段必须在
    if (!isRecord(e.state)) return { ok: false, error: `palette[${i}].state must be an object (REQ-046)` }
    if (e.color !== undefined && typeof e.color !== 'string') {
      return { ok: false, error: `palette[${i}].color must be a string` }
    }
  }
  // `REQ-022` ③：旧外观档降级（不丢块、不整档拒绝；缺 color ⇒ 明确报错，见 `io/legacy-style`）
  const style = normalizeBlockStyle(raw.blockStyle, raw.palette as PaletteEntry[])
  if (!style.ok) return style
  if (!Array.isArray(raw.chunks)) return { ok: false, error: 'field chunks must be an array' }
  for (let i = 0; i < raw.chunks.length; i++) {
    const c = raw.chunks[i]
    if (!isRecord(c)) return { ok: false, error: `chunks[${i}] must be an object` }
    if (!isInt(c.x) || !isInt(c.y) || !isInt(c.z)) return { ok: false, error: `chunks[${i}].x/y/z must be integers` }
    // `REQ-065`：chunk 坐标合法 ≠ 其格位合法。本块任一格位越界 ⇒ 整档拒绝（保留原状态，不裁剪）。
    if (!chunkInDomain(c.x as number, c.y as number, c.z as number)) {
      return { ok: false, error: `chunks[${i}] 的格位超出坐标域 ±2¹²（REQ-065）` }
    }
    if (c.size !== 16) return { ok: false, error: `chunks[${i}].size must be 16` }
    if (!Array.isArray(c.data)) return { ok: false, error: `chunks[${i}].data must be an array` }
    if (c.data.length !== 4096) {
      return { ok: false, error: `chunks[${i}].data length must be 4096, got ${c.data.length}` }
    }
    // 域内块的格位必在域内 ⇒ 只查数组元素本身（0..65535），不必逐格推世界坐标
    for (let j = 0; j < c.data.length; j++) {
      const k = c.data[j]
      if (!Number.isInteger(k) || (k as number) < 0 || (k as number) > 65535) {
        return { ok: false, error: `chunks[${i}].data[${j}] must be an integer in [0, 65535]` }
      }
      if (k !== 0 && !paletteKeys.has(k as number)) {
        return { ok: false, error: `chunks[${i}].data[${j}] references unknown palette key ${k}` }
      }
    }
  }
  if (!Array.isArray(raw.parts)) return { ok: false, error: 'field parts must be an array' }
  for (let i = 0; i < raw.parts.length; i++) {
    const p = raw.parts[i]
    if (!isRecord(p)) return { ok: false, error: `parts[${i}] must be an object` }
    if (typeof p.id !== 'string' || typeof p.name !== 'string') {
      return { ok: false, error: `parts[${i}].id/name must be strings` }
    }
    if (!isSmallInt(p.createdAtPatch)) return { ok: false, error: `parts[${i}].createdAtPatch must be an integer` }
    if (!Array.isArray(p.blocks)) return { ok: false, error: `parts[${i}].blocks must be an array` }
    for (let j = 0; j < p.blocks.length; j++) {
      if (!isCoord3(p.blocks[j])) {
        return { ok: false, error: `parts[${i}].blocks[${j}] must be [x, y, z] integers within ±2¹² (REQ-065)` }
      }
    }
  }
  // v2 新面：compositions（v1 没有 ⇒ 迁移成空数组，绝不因缺字段报错）
  const compositions: CompositionData[] = []
  if (!isV1) {
    if (raw.compositions !== undefined && !Array.isArray(raw.compositions)) {
      return { ok: false, error: 'field compositions must be an array' }
    }
    const list = (raw.compositions as unknown[] | undefined) ?? []
    for (let i = 0; i < list.length; i++) {
      const c = list[i]
      if (!isRecord(c) || typeof c.id !== 'string' || typeof c.name !== 'string') {
        return { ok: false, error: `compositions[${i}] must be an object with id/name strings` }
      }
      if (!Array.isArray(c.partIds) || c.partIds.some((id) => typeof id !== 'string')) {
        return { ok: false, error: `compositions[${i}].partIds must be an array of strings` }
      }
      if (!Array.isArray(c.blocks)) return { ok: false, error: `compositions[${i}].blocks must be an array` }
      for (let j = 0; j < c.blocks.length; j++) {
        if (!isCoord3(c.blocks[j])) {
          return { ok: false, error: `compositions[${i}].blocks[${j}] must be [x, y, z] integers within ±2¹² (REQ-065)` }
        }
      }
      compositions.push({ id: c.id, name: c.name, partIds: [...c.partIds], blocks: [...c.blocks] })
    }
  }
  if (!isRecord(raw.log)) return { ok: false, error: 'field log must be an object' }
  if (!isSmallInt(raw.log.snapshotAt) || raw.log.snapshotAt < 0) {
    return { ok: false, error: 'field log.snapshotAt must be a non-negative integer' }
  }
  if (!Array.isArray(raw.log.patches)) return { ok: false, error: 'field log.patches must be an array' }
  for (let i = 0; i < raw.log.patches.length; i++) {
    const p = raw.log.patches[i]
    if (!isRecord(p)) return { ok: false, error: `log.patches[${i}] must be an object` }
    if (!isSmallInt(p.seq) || !isRecord(p.op) || !Array.isArray(p.changes)) {
      return { ok: false, error: `log.patches[${i}] has bad shape` }
    }
    const opError = checkPatchOp(`log.patches[${i}].op`, p.op)
    if (opError) return { ok: false, error: opError }
    for (let j = 0; j < (p.changes as unknown[]).length; j++) {
      const c = (p.changes as unknown[])[j]
      if (!isRecord(c) || !isInt(c.x) || !isInt(c.y) || !isInt(c.z) || !isSmallInt(c.before) || !isSmallInt(c.after)) {
        return { ok: false, error: `log.patches[${i}].changes[${j}] has bad shape` }
      }
      // `REQ-065`：changes 的键同样不得指向不存在的调色板项（否则恢复后 `setBlock` 抛出，留下半个场景）
      for (const k of [c.before as number, c.after as number]) {
        if (k !== 0 && !paletteKeys.has(k)) {
          return { ok: false, error: `log.patches[${i}].changes[${j}] references unknown palette key ${k}` }
        }
      }
    }
    if (p.partId !== null && p.partId !== undefined && typeof p.partId !== 'string') {
      return { ok: false, error: `log.patches[${i}].partId must be a string or null` }
    }
    if (p.label !== undefined && typeof p.label !== 'string') {
      return { ok: false, error: `log.patches[${i}].label must be a string` }
    }
    if (p.ownersBefore !== undefined) {
      if (
        !Array.isArray(p.ownersBefore) ||
        p.ownersBefore.some((o) => o !== null && typeof o !== 'string') ||
        (p.ownersBefore as unknown[]).length !== (p.changes as unknown[]).length
      ) {
        return { ok: false, error: `log.patches[${i}].ownersBefore must be (string|null)[] aligned with changes` }
      }
    }
    // r03（ADR-19）：新账字段校验（缺省兼容旧档）
    if (p.compositionId !== undefined && p.compositionId !== null && typeof p.compositionId !== 'string') {
      return { ok: false, error: `log.patches[${i}].compositionId must be a string or null` }
    }
    if (p.compMembersBefore !== undefined) {
      if (
        !Array.isArray(p.compMembersBefore) ||
        p.compMembersBefore.some((m) => typeof m !== 'boolean') ||
        (p.compMembersBefore as unknown[]).length !== (p.changes as unknown[]).length
      ) {
        return { ok: false, error: `log.patches[${i}].compMembersBefore must be boolean[] aligned with changes` }
      }
    }
    if (p.ownersAfter !== undefined) {
      if (
        !Array.isArray(p.ownersAfter) ||
        p.ownersAfter.some((o) => o !== null && typeof o !== 'string') ||
        (p.ownersAfter as unknown[]).length !== (p.changes as unknown[]).length
      ) {
        return { ok: false, error: `log.patches[${i}].ownersAfter must be (string|null)[] aligned with changes` }
      }
    }
  }
  const partCreations: PartCreationFile[] = []
  if (raw.log.partCreations !== undefined) {
    if (!Array.isArray(raw.log.partCreations)) {
      return { ok: false, error: 'field log.partCreations must be an array' }
    }
    for (let i = 0; i < raw.log.partCreations.length; i++) {
      const c = raw.log.partCreations[i]
      if (!isRecord(c) || !isSmallInt(c.seq) || typeof c.id !== 'string' || typeof c.name !== 'string') {
        return { ok: false, error: `log.partCreations[${i}] has bad shape` }
      }
      // D3（debug-261004）：bundled 透传（旧档缺省 = 不捆绑）；其余未知字段仍剥掉
      partCreations.push(c.bundled === true ? { seq: c.seq, id: c.id, name: c.name, bundled: true } : { seq: c.seq, id: c.id, name: c.name })
    }
  }
  const file: ProjectFileV2 = {
    format: PROJECT_FORMAT,
    formatVersion: 2,
    appVersion: raw.appVersion,
    meta: {
      id: raw.meta.id as string,
      title: raw.meta.title as string,
      createdAt: raw.meta.createdAt as string,
      updatedAt: raw.meta.updatedAt as string,
    },
    blockStyle: 'color',
    palette: style.palette,
    chunks: raw.chunks as ChunkFile[],
    parts: raw.parts as ProjectFileV1['parts'],
    compositions,
    log: {
      snapshotAt: raw.log.snapshotAt as number,
      patches: raw.log.patches as SerializedPatch[],
      partCreations,
    },
  }
  return { ok: true, file, ...(style.downgrade !== undefined ? { downgrade: style.downgrade } : {}) }
}

interface LoadedLog {
  patches: Patch[]
  partCreations: PartCreation[]
}

/** 校验通过后的装配：恢复 volume + parts（+ 可选 compositions），返回日志尾巴供 PatchLog.adopt */
export function loadProjectFile(
  file: ProjectFileV2,
  volume: Volume,
  parts: PartRegistry,
  compositions?: CompositionRegistry,
): LoadedLog {
  volume.reset()
  volume.palette.restore(file.palette)
  volume.loadChunkData(
    file.chunks.map((c) => ({ cx: c.x, cy: c.y, cz: c.z, data: c.data })),
  )
  parts.restore(file.parts)
  compositions?.restore(file.compositions)
  const patches: Patch[] = file.log.patches.map((p) => ({
    seq: p.seq,
    op: p.op as Op,
    changes: p.changes as VoxelChange[],
    partId: p.partId,
    createdAt: p.createdAt,
    ...(p.label !== undefined ? { label: p.label } : {}),
    ...(p.ownersBefore !== undefined ? { ownersBefore: p.ownersBefore } : {}),
    ...(p.compositionId !== undefined ? { compositionId: p.compositionId } : {}),
    ...(p.compMembersBefore !== undefined ? { compMembersBefore: p.compMembersBefore } : {}),
    ...(p.ownersAfter !== undefined ? { ownersAfter: p.ownersAfter } : {}),
  }))
  const partCreations: PartCreation[] = file.log.partCreations ?? []
  return { patches, partCreations }
}
