// `REQ-022` ③（2026-10-17 去贴图化）· 旧外观档降级——**只读兼容，写侧恒为 color-only**。
//
// 旧档 `blockStyle:'minecraft'` ⇒ 载入为 `'color'`，调色板里 `minecraft:*` 的身份按条目自带 `color`
// 重写为 `color:#rrggbb`（**不丢块、不整档拒绝**）；缺可用 color hex ⇒ 明确报错，绝不静默降级。
// 映射表（跨体系映射与贴图体系）已存档：lab `proposals/minecraft-texture-system-archive-2026-10-17.md`。
import { canonicalHex } from '../core/color'
import type { PaletteEntry } from '../core/types'

/** 旧档唯一被识别的历史 `blockStyle` 值（全仓唯一一处该字面量；写侧从不产生） */
export const LEGACY_STYLE_VALUE = 'minecraft'

/** 降级回执（仅旧档出现；恢复 / 导入消息据此说明，不静默） */
export interface StyleDowngrade {
  /** `minecraft:*` → `color:#rrggbb` 重写的调色板身份条数 */
  readonly rewrites: number
}

export type StyleNormalizeResult =
  | { ok: true; blockStyle: 'color'; palette: PaletteEntry[]; downgrade?: StyleDowngrade }
  | { ok: false; error: string }

/** 归一化方块体系：`'color'` 原样；旧外观档 ⇒ 降级 + 身份重写（键不变 ⇒ 块与历史不动） */
export function normalizeBlockStyle(blockStyle: unknown, palette: PaletteEntry[]): StyleNormalizeResult {
  if (blockStyle !== LEGACY_STYLE_VALUE) return { ok: true, blockStyle: 'color', palette }
  const rewritten: PaletteEntry[] = []
  let rewrites = 0
  for (let i = 0; i < palette.length; i++) {
    const entry = palette[i]!
    if (!entry.identity.startsWith('minecraft:')) {
      rewritten.push(entry)
      continue
    }
    const hex = canonicalHex(entry.color ?? '')
    if (hex === null) {
      return { ok: false, error: `palette[${i}] 旧外观身份 ${entry.identity} 缺少可用 color hex（REQ-022 ③：降级不得静默）` }
    }
    rewritten.push({ ...entry, identity: `color:${hex}` })
    rewrites++
  }
  return { ok: true, blockStyle: 'color', palette: rewritten, downgrade: { rewrites } }
}
