// 方块外观解析（纯函数，不 import three）⇒ tests/ 可无头引用。
// `REQ-022` / `REQ-027`（2026-10-17 去贴图化）：**color-only**——无第二套体系 / 无跨体系映射 /
// **无贴图源 / 无材质**；显示色 = 调色板条目色（缺省占位灰），高亮用 `core/color` 的 `adjustColor` 提亮。
import { adjustColor } from '../core/color'
import type { BlockStyle } from '../core/types'

export interface Appearance {
  style: BlockStyle
  /** 缺项身份集合（color-only 下恒空；字段保留以稳住渲染层读回形状） */
  missing: ReadonlySet<string>
}

/** 单块显示色：identity（模型原身份）+ 条目色 → hex（undefined identity ⇒ 占位灰） */
export function resolveBlockColor(
  identity: string | undefined,
  baseColor: string | undefined,
  _app: Appearance,
  highlighted: boolean,
): string {
  const hex = identity === undefined ? '#9aa0a6' : (baseColor ?? '#9aa0a6')
  return highlighted ? adjustColor(hex, 1.15, 0.35) : hex
}
