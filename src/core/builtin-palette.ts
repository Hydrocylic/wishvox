import { Palette } from './palette'

// 彩色体系（REQ-027 ①：≥12 种方块身份 + ≥8 色主调色板——计数断言在 tests/block-style.test.ts）。
// 身份与色值即内置色板正本（色块 / UI 与 harness 种子共用；2026-10-17 去贴图化后不再有第二套映射）。
export const BUILTIN_COLOR_BLOCKS: ReadonlyArray<{ identity: string; color: string }> = [
  { identity: 'color:white', color: '#e8e6e3' },
  { identity: 'color:light-gray', color: '#b8b6b3' },
  { identity: 'color:dark-gray', color: '#6f6c6a' },
  { identity: 'color:black', color: '#2b2a28' },
  { identity: 'color:red', color: '#c0392b' },
  { identity: 'color:orange', color: '#d98324' },
  { identity: 'color:yellow', color: '#e8c547' },
  { identity: 'color:lime', color: '#9acd32' },
  { identity: 'color:green', color: '#2e8b57' },
  { identity: 'color:teal', color: '#2aa198' },
  { identity: 'color:cyan', color: '#4fc3f7' },
  { identity: 'color:blue', color: '#3b6ea5' },
  { identity: 'color:purple', color: '#7d5ba6' },
  { identity: 'color:pink', color: '#d4839b' },
  { identity: 'color:brown', color: '#8d6e63' },
  { identity: 'color:red-brick', color: '#a34b3a' },
]

/** 把内置色板 intern 进 palette，返回 identity → key（UI 色条与 harness 种子共用） */
export function internBuiltin(palette: Palette): Map<string, number> {
  const map = new Map<string, number>()
  for (const b of BUILTIN_COLOR_BLOCKS) map.set(b.identity, palette.intern(b.identity, {}, b.color))
  return map
}
