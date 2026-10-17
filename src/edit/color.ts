// 颜色键的项目侧正本（`REQ-027` 门四）：当前色 → 键的解析、**写入时 intern**、未落账键的回收、AI 键寻址。
//
// 三条不变式（本文件是它们的唯一实现处）：
// 1. **选色 / 吸管不产生持久键**：会话颜色只是 store 里的字符串（`currentColor`）；键只在真正写入前分配。
// 2. **键稳定**：内置身份走固定键；自定义色以「规范 HEX」为身份（`color:rrggbb`）⇒ 同色同键、跨项目不通用、
//    不因排序 / 隐藏 / 删最后一块 / 加载而重编号（`Palette.nextKey` 只增）。
// 3. **不留下半完成色板**：失败写入 / 取消的笔 / 被回滚的 AI 请求收回本次新建且**无任何引用**的键
//    （模型引用 + 历史引用都算引用）。仍被有效历史引用的颜色必须保留（B-06）。
import { BUILTIN_COLOR_BLOCKS } from '../core/builtin-palette'
import { canonicalHex, colorIdentityOf, MAX_PALETTE_KEY } from '../core/color'
import type { PatchLog } from '../core/patch-log'
import type { Volume } from '../core/volume'
import { useEditorUi } from '../state/editor-store'

/** 颜色键面只需要"色板 + 模型"；历史引用判定还需补丁日志（结构匹配 ⇒ Editor / StrokeHost 都满足） */
interface PaletteHost {
  readonly volume: Volume
}
interface ColorRefHost extends PaletteHost {
  readonly log: PatchLog
}

/** 内置身份 → 规范色值（16 色恒定；`currentIdentity` 命中内置时以它为当前色） */
const BUILTIN_COLOR_BY_IDENTITY = new Map<string, string>(
  BUILTIN_COLOR_BLOCKS.map((b) => [b.identity, canonicalHex(b.color) ?? b.color]),
)

/** 规范色值 → 内置身份：HEX 输入命中内置色值时复用内置条目，不为同一颜色造第二个条目（B-02） */
const BUILTIN_IDENTITY_BY_COLOR = new Map<string, string>(
  BUILTIN_COLOR_BLOCKS.map((b) => [canonicalHex(b.color) ?? b.color, b.identity]),
)

/** 预览用哨兵键：模型里的键必来自色板，故它不可能与任何现存块相等 ⇒ 预览集合与实际写入一致 */
const PREVIEW_SENTINEL_KEY = -1

/**
 * 当前会话颜色（规范 HEX）。口径：`currentIdentity` 命中内置身份 ⇒ 以内置色值为准（既有调色板语义不变）；
 * 否则以 `currentColor` 为准（HEX/RGB 输入、吸管、已用色点选都写它）。两者只有一个正本。
 */
export function currentColorHex(): string {
  const s = useEditorUi.getState()
  const builtin = BUILTIN_COLOR_BY_IDENTITY.get(s.currentIdentity)
  return builtin ?? (canonicalHex(s.currentColor) ?? s.currentColor)
}

/** 查找已存在同色的调色板条目（不分配键） */
function findKeyByColor(ed: PaletteHost, hex: string): number | undefined {
  const want = canonicalHex(hex)
  if (want === null) return undefined
  for (const e of ed.volume.palette.list()) {
    if (e.color !== undefined && canonicalHex(e.color) === want) return e.key
  }
  return undefined
}

/** 预览/读值用键：已存在则复用，否则给哨兵（**不分配持久键**） */
export function previewColorKey(ed: PaletteHost): number {
  return findKeyByColor(ed, currentColorHex()) ?? PREVIEW_SENTINEL_KEY
}

export type InternResult =
  | { readonly ok: true; readonly key: number; readonly created: boolean }
  | { readonly ok: false; readonly message: string }

/** 键容量已满时的统一回执（零修改） */
const CAPACITY_MESSAGE = `颜色键容量已满（上限 ${MAX_PALETTE_KEY}，REQ-027）：本次未写入、色板未改动`

/** 规范色值 → 项目键：同色复用；不存在则 intern（**只应在真正写入前调用**） */
function internColorKey(ed: PaletteHost, hex: string): InternResult {
  const c = canonicalHex(hex)
  if (c === null) return { ok: false, message: `颜色值无效（须为不透明 HEX）：${hex}` }
  const identity = BUILTIN_IDENTITY_BY_COLOR.get(c) ?? colorIdentityOf(c)
  const existing = findKeyByColor(ed, c)
  if (existing !== undefined) return { ok: true, key: existing, created: false }
  if (ed.volume.palette.full) return { ok: false, message: CAPACITY_MESSAGE }
  try {
    return { ok: true, key: ed.volume.palette.intern(identity, {}, c), created: true }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

/** 会话当前色 → 项目键（写入前调用；选色本身不调用） */
export function internCurrentColor(ed: PaletteHost): InternResult {
  return internColorKey(ed, currentColorHex())
}

/** 同上的抛错版本（模型级写 API 的既有读点；容量耗尽即抛，界面路径请用可判失败版本） */
export function internCurrentColorOrThrow(ed: PaletteHost): number {
  const r = internCurrentColor(ed)
  if (!r.ok) throw new Error(r.message)
  return r.key
}

// ── 未落账键的回收（失败写入 / 取消的笔 / 回滚的 AI 请求）──

function modelUsesKey(ed: PaletteHost, key: number): boolean {
  for (const b of ed.volume.iterBlocks()) {
    if (b.key === key) return true
  }
  return false
}

/** 历史（含 undo 栈：undo 栈里的补丁仍是"有效历史引用"，撤销后必须还能找回该颜色） */
function historyUsesKey(ed: ColorRefHost, key: number): boolean {
  const patches = [...ed.log.patches, ...ed.log.undonePatches]
  for (const p of patches) {
    for (const c of p.changes) {
      if (c.before === key || c.after === key) return true
    }
  }
  return false
}

/** 该键是否仍被引用（模型或历史）——回收的唯一判据 */
function keyReferenced(ed: ColorRefHost, key: number): boolean {
  if (key <= 0) return true
  return modelUsesKey(ed, key) || historyUsesKey(ed, key)
}

/** 收回本次新建且无引用的键（有引用 = 颜色必须保留，直接跳过） */
function releaseIfUnreferenced(ed: ColorRefHost, key: number | null): boolean {
  if (key === null || key <= 0) return false
  if (keyReferenced(ed, key)) return false
  return ed.volume.palette.release(key)
}

/**
 * 一次写入的颜色事务：记录**本次**新建的键，失败路径统一回收。
 * 人工笔（落笔到松手/取消）与 AI 单次调用各持一个 —— "一次操作成功边界"由此落到键上。
 */
export interface ColorTx {
  readonly created: number[]
}

export function newColorTx(): ColorTx {
  return { created: [] }
}

/** 事务内取键（可能 intern）；新键记入事务 */
export function txKeyForColor(ed: PaletteHost, tx: ColorTx, hex: string): InternResult {
  const r = internColorKey(ed, hex)
  if (r.ok && r.created) tx.created.push(r.key)
  return r
}

/** 事务失败收尾：无引用的新键全部收回（有引用的保留——历史/模型仍在用它） */
export function rollbackColorTx(ed: ColorRefHost, tx: ColorTx): void {
  for (const key of tx.created) releaseIfUnreferenced(ed, key)
  tx.created.length = 0
}

/** 事务成功收尾：新键已被本次补丁引用，不再回收 */
export function commitColorTx(tx: ColorTx): void {
  tx.created.length = 0
}

// ── AI 键寻址（`REQ-027`：按项目键 + 规范色值；跨项目旧键 / 未知键 / 超容量一律零修改报错）──

export type KeyRef =
  /** 项目键（AI 从 get_model_summary 读回的那一列） */
  | { readonly kind: 'key'; readonly key: number }
  /** 规范色值（HEX / rgb()）：按色值寻址，写入时才 intern */
  | { readonly kind: 'color'; readonly hex: string }
  /** 调色板身份串（既有面，保持兼容） */
  | { readonly kind: 'identity'; readonly identity: string }
  /** 空（"air"）：擦除笔刷 / set_cells 的删除目标——键 0 保留给"空"，不是颜色键 */
  | { readonly kind: 'air' }

/** 身份串 → 键（既有口径：只认同色板里现存的身份） */
export function keyOfIdentity(ed: PaletteHost, identity: string): number | undefined {
  for (const e of ed.volume.palette.list()) {
    if (e.identity === identity) return e.key
  }
  return undefined
}

export function resolveKeyRef(ed: PaletteHost, tx: ColorTx, ref: KeyRef): InternResult {
  if (ref.kind === 'air') return { ok: true, key: 0, created: false }
  if (ref.kind === 'key') {
    if (!Number.isInteger(ref.key) || ref.key <= 0 || ref.key > MAX_PALETTE_KEY) {
      return { ok: false, message: `键 ${String(ref.key)} 不是合法的项目颜色键（1..${MAX_PALETTE_KEY}）` }
    }
    // 跨项目旧键 / 未知键：本项目色板里没有它 ⇒ 零修改报错（不复用、不新建、不当作 0）
    if (!ed.volume.palette.has(ref.key)) {
      return { ok: false, message: `本项目色板里没有键 ${ref.key}（跨项目键无效，REQ-027）：请用 get_model_summary 读回的键或规范色值` }
    }
    return { ok: true, key: ref.key, created: false }
  }
  if (ref.kind === 'color') return txKeyForColor(ed, tx, ref.hex)
  const key = keyOfIdentity(ed, ref.identity)
  if (key === undefined) return { ok: false, message: `调色板里没有身份 "${ref.identity}"` }
  return { ok: true, key, created: false }
}
