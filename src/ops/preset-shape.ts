import type { PresetShapeParams } from '../core/types'
import { COORD_LIMIT, isCoordTripleDomain } from '../core/coords'
import type { Volume } from '../core/volume'
import { TargetMap, diffTargets } from './targets'

// 预设体块（绝对类）：盒 / 柱（y 轴，x z 为直径）/ 锥（底在下尖在上）/ 球（三轴直径）。
// 采样口径：格心中点（cell+0.5）落在连续几何体内 ⇒ 计入；掏空 = 外形 minus 各维缩 2 的内形（内形任一维 ≤ 0 时等同实心）。
// 拍板 2026-10-03：盒·柱·锥·球（屋脊移除）。

/** 包围盒总体积上限（设施保护：防 UI 传大尺寸把浏览器 / 测试挂死；越界明确报错好过静默空转） */
const PRESET_SHAPE_MAX_CELLS = 1_000_000

/** 局部坐标 dx,dy,dz 是否落在形状内（size = 三维尺寸；负坐标一律在外——掏空时内形以 dx-1 传入，需要这条守卫） */
function insideShape(
  shape: PresetShapeParams['shape'],
  size: { x: number; y: number; z: number },
  dx: number,
  dy: number,
  dz: number,
): boolean {
  const cx = size.x / 2
  const cy = size.y / 2
  const cz = size.z / 2
  const px = dx + 0.5
  const py = dy + 0.5
  const pz = dz + 0.5
  if (px < 0 || py < 0 || pz < 0 || px > size.x || py > size.y || pz > size.z) return false
  switch (shape) {
    case 'box':
      return true
    case 'cylinder':
      return ((px - cx) / cx) ** 2 + ((pz - cz) / cz) ** 2 <= 1
    case 'cone': {
      const t = size.y <= 1 ? 0 : dy / (size.y - 1)
      const rx = Math.max((size.x / 2) * (1 - t), 0.5)
      const rz = Math.max((size.z / 2) * (1 - t), 0.5)
      return ((px - cx) / rx) ** 2 + ((pz - cz) / rz) ** 2 <= 1
    }
    case 'sphere':
      return ((px - cx) / cx) ** 2 + ((py - cy) / cy) ** 2 + ((pz - cz) / cz) ** 2 <= 1
  }
}

export function presetShape(params: PresetShapeParams, ctx: { volume: Volume }): ReturnType<typeof diffTargets> {
  const { shape, origin, size, key, hollow } = params
  const sx = Math.floor(size.x)
  const sy = Math.floor(size.y)
  const sz = Math.floor(size.z)
  if (sx < 0 || sy < 0 || sz < 0) throw new Error(`presetShape: 尺寸不能为负（${sx}×${sy}×${sz}）`)
  if (sx * sy * sz > PRESET_SHAPE_MAX_CELLS) {
    throw new Error(`presetShape: 包围盒 ${sx}×${sy}×${sz} 超上限 ${PRESET_SHAPE_MAX_CELLS} 格`)
  }
  // `REQ-065`：origin 与**整个包围盒**都须落在 ±2¹² 整数域内（原 REQ-059 / ADR-20 的 y≥0 下界已废止）。
  // 为什么查上角而不只查 origin：`PatchLog.applyChangesWithMembership` 是逐格校验后再写，
  // changes 按 x→y→z 升序（ops/targets#diffTargets）⇒ 越界格若排在合法格之后，合法前半已落盘而整笔
  // 无补丁（部分写入）。块坐标 = origin + 各维偏移（偏移 ∈ [0, size-1]）⇒ 两角在域内即整盒在域内。
  const last = { x: origin.x + sx - 1, y: origin.y + sy - 1, z: origin.z + sz - 1 }
  // 教学式报错（口径卡 §一）：给最小合法示例，不是只说"参数非法"。
  if (!isCoordTripleDomain(origin.x, origin.y, origin.z) || !isCoordTripleDomain(last.x, last.y, last.z)) {
    throw new Error(
      `presetShape: origin 与包围盒须在 ±${COORD_LIMIT} 整数域内（REQ-065，收到 origin (${String(origin.x)}, ${String(origin.y)}, ${String(origin.z)})、size ${sx}×${sy}×${sz}）。最小合法示例：{ "origin": { "x": 0, "y": 0, "z": 0 }, "size": { "x": 4, "y": 4, "z": 4 } }`,
    )
  }
  const hx = Math.max(sx - 2, 0)
  const hy = Math.max(sy - 2, 0)
  const hz = Math.max(sz - 2, 0)
  const hollowable = hollow === true && hx > 0 && hy > 0 && hz > 0
  const targets = new TargetMap()
  for (let dx = 0; dx < sx; dx++) {
    for (let dy = 0; dy < sy; dy++) {
      for (let dz = 0; dz < sz; dz++) {
        if (!insideShape(shape, { x: sx, y: sy, z: sz }, dx, dy, dz)) continue
        if (hollowable && insideShape(shape, { x: hx, y: hy, z: hz }, dx - 1, dy - 1, dz - 1)) continue
        targets.set(origin.x + dx, origin.y + dy, origin.z + dz, key)
      }
    }
  }
  return diffTargets(ctx.volume, targets)
}
