// 颜色规范化与解析的唯一正本（`REQ-027` · 门四 · B-02 / B-08）。
//
// 口径：
// · **规范形式 = 不透明 sRGB 六位小写 HEX**（`#rrggbb`）。大小写、三位的等价写法、`rgb(r,g,b)` 都归一到它
//   ⇒ "输入等价色值后当前颜色一致、同色不因大小写产生重复色项"（B-02）在同一条解析路上天然成立。
// · **拒绝而不猜**（B-08）：非 HEX、通道越界、小数通道、带透明度（4/8 位或 rgba）一律返回原因，
//   调用方保留上次有效色 —— 绝不静默变成另一个颜色（这正是本门前缺陷的形态）。
// · 键容量 `MAX_PALETTE_KEY` = 65535（体素存储 16 位，`REQ-027` 门四：超限先报错、零修改、不溢出）。

/** 体素键上限：`Uint16Array` 单格可存 0..65535；0 保留给"空" ⇒ 可用键 1..65535 */
export const MAX_PALETTE_KEY = 65535

export interface Rgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

/** 色相 0–360、饱和度/明度 0–1（取色器色面用；不进持久数据） */
export interface Hsv {
  readonly h: number
  readonly s: number
  readonly v: number
}

export type ColorParse = { readonly ok: true; readonly hex: string } | { readonly ok: false; readonly reason: string }

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v)
}

export function rgbToHex(rgb: Rgb): string {
  const part = (v: number): string => clamp255(v).toString(16).padStart(2, '0')
  return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`
}

/** 六位（或三位等价写法）HEX → RGB；带透明度 / 非法字符 / 长度不对 ⇒ null */
export function hexToRgb(hex: string): Rgb | null {
  const c = canonicalHex(hex)
  if (c === null) return null
  return { r: parseInt(c.slice(1, 3), 16), g: parseInt(c.slice(3, 5), 16), b: parseInt(c.slice(5, 7), 16) }
}

/**
 * 规范化：接受 `#abc` / `abc` / `#aabbcc` / `AABBCC`（任意大小写）⇒ `#aabbcc` 小写；
 * 其它（含 4/8 位带 alpha、`rgba()`、空串、非法字符）⇒ null。**不做四舍五入、不做回退色**。
 */
export function canonicalHex(hex: string): string | null {
  if (typeof hex !== 'string') return null
  const body = hex.trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{3}$/.test(body)) {
    const [r, g, b] = body.toLowerCase().split('')
    return `#${r}${r}${g}${g}${b}${b}`
  }
  if (/^[0-9a-fA-F]{6}$/.test(body)) return `#${body.toLowerCase()}`
  return null
}

/** 规范色值 → 自定义色身份（项目内键的一部分：同色同身份 ⇒ intern 复用同一条目） */
export function colorIdentityOf(hex: string): string {
  const c = canonicalHex(hex)
  if (c === null) throw new Error(`color: 非法色值 ${hex}`)
  return `color:${c.slice(1)}`
}

/** 三位 / 六位 HEX 输入（B-08 的判据面：拒绝而非猜） */
export function parseHexInput(text: string): ColorParse {
  const raw = text.trim()
  if (raw === '') return { ok: false, reason: '色值为空（请输入 #rrggbb）' }
  const body = raw.replace(/^#/, '')
  if (/^[0-9a-fA-F]{4}$/.test(body) || /^[0-9a-fA-F]{8}$/.test(body)) {
    return { ok: false, reason: '首版不做透明度：请输入 6 位不透明 HEX（#rrggbb）' }
  }
  if (/^[0-9a-fA-F]{3}$/.test(body) || /^[0-9a-fA-F]{6}$/.test(body)) {
    const hex = canonicalHex(body)
    return hex === null ? { ok: false, reason: `不是合法的 HEX 色值：${raw}` } : { ok: true, hex }
  }
  if (/^[0-9a-fA-F]+$/.test(body)) return { ok: false, reason: `HEX 位数须为 3 或 6（收到 ${body.length} 位）` }
  return { ok: false, reason: `不是合法的 HEX 色值（示例 #3b6ea5 或 #39f）：${raw}` }
}

/** R/G/B 三通道输入（整数 0..255；小数 / 越界 / 非数一律拒绝） */
export function parseRgbInput(r: unknown, g: unknown, b: unknown): ColorParse {
  const chans: Array<[string, unknown]> = [
    ['R', r],
    ['G', g],
    ['B', b],
  ]
  for (const [name, v] of chans) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false, reason: `${name} 通道必须是数字（收到 ${String(v)}）` }
    if (!Number.isInteger(v)) return { ok: false, reason: `${name} 通道必须是整数（收到 ${String(v)}）` }
    if (v < 0 || v > 255) return { ok: false, reason: `${name} 通道须在 0..255（收到 ${String(v)}）` }
  }
  return { ok: true, hex: rgbToHex({ r: r as number, g: g as number, b: b as number }) }
}

/** HEX / `rgb(r,g,b)` 两种输入形态合一（面板的 HEX 输入框与 AI 的规范色值寻址共用） */
export function parseColorInput(text: string): ColorParse {
  const raw = text.trim()
  const m = /^rgba?\(\s*([^)]*)\)$/i.exec(raw)
  if (m) {
    const parts = m[1]!.split(',').map((s) => s.trim())
    if (parts.length === 4) return { ok: false, reason: '首版不做透明度：请去掉第 4 个 alpha 通道' }
    if (parts.length !== 3) return { ok: false, reason: `rgb() 需要 3 个通道（收到 ${parts.length} 个）` }
    const nums = parts.map((p) => (p === '' ? Number.NaN : Number(p)))
    return parseRgbInput(nums[0], nums[1], nums[2])
  }
  return parseHexInput(raw)
}

export function rgbToHsv(rgb: Rgb): Hsv {
  const r = rgb.r / 255
  const g = rgb.g / 255
  const b = rgb.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

export function hsvToRgb(hsv: Hsv): Rgb {
  const h = ((hsv.h % 360) + 360) % 360
  const s = hsv.s < 0 ? 0 : hsv.s > 1 ? 1 : hsv.s
  const v = hsv.v < 0 ? 0 : hsv.v > 1 ? 1 : hsv.v
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  const seg = Math.floor(h / 60) % 6
  const table: ReadonlyArray<readonly [number, number, number]> = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ]
  const [r, g, b] = table[seg]!
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 }
}

/**
 * HSL 提亮 / 饱和度调整（确定性，无随机）——高亮块显示色用它（原在 `core/texture-source`，
 * 2026-10-17 移除贴图源体系后移入本层）。
 * 输入非法 hex ⇒ **原样返回**（不猜颜色、不崩溃）；合法值输出规范 `#rrggbb` 小写。
 */
export function adjustColor(hex: string, satK: number, lightAdd: number): string {
  const rgb = hexToRgb(hex)
  if (rgb === null) return hex
  const r = rgb.r / 255
  const g = rgb.g / 255
  const b = rgb.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) {
    const v = Math.min(1, l + lightAdd)
    return rgbToHex({ r: v * 255, g: v * 255, b: v * 255 })
  }
  let h = 0
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  h *= 60
  if (h < 0) h += 360
  const s = d / (1 - Math.abs(2 * l - 1))
  const s2 = Math.min(1, s * satK)
  const l2 = Math.min(1, Math.max(0, l + lightAdd))
  const c = (1 - Math.abs(2 * l2 - 1)) * s2
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l2 - c / 2
  const seg = Math.floor(h / 60) % 6
  const table: ReadonlyArray<readonly [number, number, number]> = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ]
  const [r1, g1, b1] = table[seg]!
  return rgbToHex({ r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 })
}
