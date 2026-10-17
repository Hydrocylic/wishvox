import { COORD_LIMIT, isCoordTripleDomain } from '../core/coords'

/** 兼容旧读回名称；工作平面沿用 REQ-065，不另设地面数域。 */
export const GROUND_HALF_EXTENT = COORD_LIMIT

/** 工作平面落格结果 + **射线到平面的距离**（`D2` 最近者优先要比较两个命中谁更近）。
 *  `distance` 与方向向量的模无关（按欧氏距离折算）⇒ 归一化与非归一化方向都可直接比较。 */
export interface GroundHit {
  readonly cell: [number, number, number]
  readonly distance: number
}

/** 双向射线与独立工作平面 y=height 求交；上下观察均落到 y=height 格。
 * 平行、背向、非有限或非法格坐标返回 null。命中优先级（模型 / 网格谁更近）及模式闸门由调用方负责。
 */
export function pickGroundCellWithDistance(
  origin: [number, number, number],
  dir: [number, number, number],
  height = 0,
): GroundHit | null {
  if (!origin.every(Number.isFinite) || !dir.every(Number.isFinite) || !isCoordTripleDomain(0, height, 0)) return null
  const [ox, oy, oz] = origin
  const [dx, dy, dz] = dir
  if (dy === 0) return null
  const t = (height - oy) / dy
  if (t < 0) return null
  const x = Math.floor(ox + t * dx)
  const z = Math.floor(oz + t * dz)
  if (!isCoordTripleDomain(x, height, z)) return null
  return { cell: [x, height, z], distance: t * Math.hypot(dx, dy, dz) }
}

/** 只取落格（既有读点：`tests/interaction/ground-pick.test.ts` 与本函数的旧调用面）。 */
export function pickGroundCell(
  origin: [number, number, number],
  dir: [number, number, number],
  height = 0,
): [number, number, number] | null {
  return pickGroundCellWithDistance(origin, dir, height)?.cell ?? null
}
