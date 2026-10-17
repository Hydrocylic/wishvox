import type { Coord } from '../types'
import { BRUSH_MAX_AXIS, BRUSH_MAX_CELLS } from './types'

/**
 * 方形笔刷的体积集合（Q1 拍板 · 角对齐）：**锚点格为最小角**，体积向 +x/+y/+z 延伸。
 * "点面 → 1 块"（1×1×1 = 锚点格本身）与"点面 → 3×3×3"（锚点为最小角向外扩）是同一套规则。
 * 锚点语义由调用方决定：放置 = 被点面的相邻格；擦除 / 上色 = 被点方块本体。
 * 面对齐 / 体心对齐 / 用户自定义新格位置归"笔刷升级环节"（以后层，不做）。
 * 输出按 (x, y, z) 字典序排序 ⇒ 与遍历顺序无关（N3 同口径）。
 */
export function brushVolume(size: Coord, anchor: Coord): Coord[] {
  validateBrushSize(size)
  const cells: Coord[] = []
  for (let dx = 0; dx < size.x; dx++) {
    for (let dy = 0; dy < size.y; dy++) {
      for (let dz = 0; dz < size.z; dz++) {
        cells.push({ x: anchor.x + dx, y: anchor.y + dy, z: anchor.z + dz })
      }
    }
  }
  return cells
}

/** 校验笔刷尺寸（参数面四原则：每调用上限 + 教学式报错带最小合法示例） */
export function validateBrushSize(size: Coord): void {
  const axes: Array<[string, number]> = [
    ['x', size?.x],
    ['y', size?.y],
    ['z', size?.z],
  ]
  for (const [axis, v] of axes) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > BRUSH_MAX_AXIS) {
      throw new Error(`笔刷尺寸每轴须为 1–${BRUSH_MAX_AXIS} 的整数（${axis} 轴收到 ${String(v)}）。最小合法示例：{ "x": 1, "y": 1, "z": 1 }`)
    }
  }
  if (size.x * size.y * size.z > BRUSH_MAX_CELLS) {
    throw new Error(`笔刷体积超过单次上限 ${BRUSH_MAX_CELLS} 格（收到 ${size.x}×${size.y}×${size.z}）。例：3×3×3 = 27 格`)
  }
}
