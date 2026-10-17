// r04 T6（I1 超线兜底，方案 §1.1-I1 预案）：identity↔调色板键 + ScopeRef 解析族——
// 自 ai/args.ts 拆出（args.ts 实测超 400 行 ⇒ 启用兜底；预案给的拆分面 = parseScopeRef + scopeCellsOf，
// 这里连同 requireKey 一族（identity 查键）一并迁入——同一群"查编辑器状态"的解析）。
import { parseColorInput } from '../core/color'
import { resolveScope } from '../core/scope'
import type { ScopeRef } from '../core/types'
import type { KeyRef } from '../edit/color'
import { keyOfIdentity } from '../edit/color'
import type { Editor } from '../edit/editor'
import { AI_LIMITS } from './tools'
import { teachingError } from './receipt'

function paletteExamples(editor: Editor): string {
  return editor.volume.palette
    .list()
    .slice(0, 3)
    .map((e) => `"${e.identity}"`)
    .join('、')
}

/** 是否像"规范色值"（HEX / rgb()）：与身份串（`color:red`）不冲突 */
function looksLikeColorValue(text: string): boolean {
  return text.startsWith('#') || /^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(text) || /^rgba?\(/i.test(text)
}

/**
 * `REQ-027`（门四）AI 颜色寻址：**项目键 + 规范色值**（身份串保持兼容）。
 * · 数字 ⇒ 项目键（执行期核对"本项目色板是否存在"，跨项目旧键 / 未知键 ⇒ 零修改报错）；
 * · `#rrggbb` / `rgb(...)` ⇒ 规范色值（写入时才 intern；非法色值在此拒绝，B-08）；
 * · 身份串 ⇒ 既有口径（必须是色板里现存的身份）。
 * 本函数**不分配键、不改色板**——只产出引用，由执行面在写入边界内物化（失败可整体回收）。
 */
export function requireKeyRef(
  editor: Editor,
  raw: unknown,
  field: string,
): { ok: true; ref: KeyRef } | { ok: false; message: string } {
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw) || raw <= 0) {
      return {
        ok: false,
        message: teachingError(
          `${field} 的项目键须是 1..65535 的整数（收到 ${String(raw)}；键 0 = 空，删除请用 erase / clear_scope / "air"）`,
          `{ "${field}": 5 }`,
        ),
      }
    }
    return { ok: true, ref: { kind: 'key', key: raw } }
  }
  if (typeof raw !== 'string') {
    return {
      ok: false,
      message: teachingError(
        `${field} 需要调色板身份串 / 项目键 / 规范色值（如 "color:red"、"#3b6ea5"、5）`,
        `{ "${field}": "#3b6ea5" }`,
      ),
    }
  }
  const text = raw.trim()
  if (text === 'air' || text === '') {
    return { ok: false, message: teachingError(`${field} 不接受空值（删除请用 erase / clear_scope）`, `{ "${field}": "color:red" }`) }
  }
  // `D6`（design §8）：**拼接 `identity#key`** 是最容易被读面误导出来的写法（旧读面就印 `color:pink#14`），
  // 它既不是身份串也不是键 ⇒ 明确拒绝并给两个**可直接回填**的示例（不静默当身份串处理）。
  // 判据覆盖两种拼接形态：`color:pink#14`（身份#键）与 `#c0392b#2`（HEX#键）；
  // 合法的三位 HEX `#123` 只有**一个** `#` ⇒ 不会被本判据吃掉。
  if (/^#?([^\s#]+|[0-9a-fA-F]{3,8})#\d+$/.test(text)) {
    return {
      ok: false,
      message: teachingError(
        `${field} 不接受 "identity#key" 拼接（收到 "${text}"）：请直接用项目键数字（如 14）或规范 HEX 色值（如 "#e91e63"）`,
        `{ "${field}": 14 } 或 { "${field}": "#e91e63" }`,
      ),
    }
  }
  // `D6` ①：读面给的是 `key=14` ⇒ 回填成字符串 "14" 也必须等价于数字 14（否则"用 key 改色"会时灵时不灵）。
  // 纯数字串一律按**项目键**解（规范色值一律带 `#` 或写成 `rgb(...)`，两者不冲突）。
  if (/^\d+$/.test(text)) {
    const n = Number(text)
    if (!Number.isInteger(n) || n <= 0) {
      return { ok: false, message: teachingError(`${field} 的项目键须是 1..65535 的整数（收到 "${text}"）`, `{ "${field}": 5 }`) }
    }
    return { ok: true, ref: { kind: 'key', key: n } }
  }
  if (looksLikeColorValue(text)) {
    const parsed = parseColorInput(text)
    if (!parsed.ok) {
      return { ok: false, message: teachingError(`${field} 的色值无效：${parsed.reason}`, `{ "${field}": "#3b6ea5" }`) }
    }
    return { ok: true, ref: { kind: 'color', hex: parsed.hex } }
  }
  if (keyOfIdentity(editor, text) === undefined) {
    return {
      ok: false,
      message: teachingError(
        `调色板里没有身份 "${text}"（${field}）`,
        `{ "${field}": ${paletteExamples(editor)} }；也可直接用规范色值 { "${field}": "#3b6ea5" }，或 get_model_summary 读回的键`,
      ),
    }
  }
  return { ok: true, ref: { kind: 'identity', identity: text } }
}

// ── target_kind / target_id → ScopeRef（名称→id，不做自然语言匹配，①-19）──

export function parseScopeRef(
  editor: Editor,
  args: Record<string, unknown>,
): { ok: true; ref: ScopeRef } | { ok: false; message: string } {
  const kind = args.target_kind
  if (kind === 'all') return { ok: true, ref: { kind: 'all' } }
  if (kind === 'manual') return { ok: true, ref: { kind: 'manual' } }
  if (kind === 'part') {
    const id = args.target_id
    if (typeof id !== 'string' || !editor.parts.get(id)) {
      return {
        ok: false,
        message: teachingError(
          `target_id 不是现存构件（收到 ${String(id)}）`,
          `先用 list_parts 查 id，再传 { "target_kind": "part", "target_id": "${editor.parts.list()[0]?.id ?? 'part-1'}" }`,
        ),
      }
    }
    return { ok: true, ref: { kind: 'part', partId: id } }
  }
  if (kind === 'composition') {
    const id = args.target_id
    if (typeof id !== 'string' || !editor.compositions.get(id)) {
      return {
        ok: false,
        message: teachingError(
          `target_id 不是现存组合（收到 ${String(id)}）`,
          `先用 list_compositions 查 id，再传 { "target_kind": "composition", "target_id": "${editor.compositions.list()[0]?.id ?? 'comp-1'}" }`,
        ),
      }
    }
    return { ok: true, ref: { kind: 'composition', compositionId: id } }
  }
  return { ok: false, message: teachingError('target_kind 必须是 all / manual / part / composition', `{ "target_kind": "all" }`) }
}

export function scopeCellsOf(editor: Editor, ref: ScopeRef): { cells: number } | { error: string } {
  const coords = resolveScope(editor.volume, editor.parts, editor.compositions, ref)
  if (coords.length > AI_LIMITS.cellsPerCall) {
    return { error: teachingError(`范围块数 ${coords.length} 超单调用上限 ${AI_LIMITS.cellsPerCall}`, '拆成多个小范围（按构件/组合分步）') }
  }
  return { cells: coords.length }
}
