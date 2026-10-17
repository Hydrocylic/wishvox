import type { CompositionRegistry } from '../core/composition'
import { coordKey } from '../core/coords'
import type { PartRegistry } from '../core/parts'
import { resolveScope } from '../core/scope'
import type { BevelEdgesParams } from '../core/types'
import type { Volume } from '../core/volume'
import { TargetMap, diffTargets } from './targets'

// 抹角修边（首版 = 参数化最小面，plan §5.2 的降级口径；归**相对类**——逐次侵蚀 ⇒ 不幂等但一步可逆）。
// 判据：块的 26 邻域"实心邻居数"（含范围外的块；范围类操作只删范围内的）——
// 实心盒的角 = 7、棱 = 11、面 = 17、内 = 26。radius：1 削角(≤7)、2 加削棱(≤11)、3 连面(≤17)；>3 按 3。
// passes 轮迭代，每轮按"上一轮删完后"的实心度重判（轮内批量判定，轮末统一记删 ⇒ 与遍历顺序无关）。
export function bevelEdges(
  params: BevelEdgesParams,
  ctx: { volume: Volume; parts: PartRegistry; compositions: CompositionRegistry },
): ReturnType<typeof diffTargets> {
  if (!Number.isInteger(params.radius) || params.radius < 1) {
    throw new Error(`bevelEdges: radius 必须是 ≥1 的整数（收到 ${params.radius}）`)
  }
  if (!Number.isInteger(params.passes) || params.passes < 1) {
    throw new Error(`bevelEdges: passes 必须是 ≥1 的整数（收到 ${params.passes}）`)
  }
  const threshold = params.radius >= 3 ? 17 : params.radius === 2 ? 11 : 7
  const coords = resolveScope(ctx.volume, ctx.parts, ctx.compositions, params.scope)
  if (coords.length === 0) return []
  const removed = new Set<string>()
  const isSolid = (x: number, y: number, z: number): boolean =>
    ctx.volume.getBlock(x, y, z) !== 0 && !removed.has(coordKey(x, y, z))
  for (let pass = 0; pass < params.passes; pass++) {
    const toRemove: string[] = []
    for (const c of coords) {
      const k = coordKey(c.x, c.y, c.z)
      if (removed.has(k)) continue
      let filled = 0
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            if (dx === 0 && dy === 0 && dz === 0) continue
            if (isSolid(c.x + dx, c.y + dy, c.z + dz)) filled++
          }
        }
      }
      if (filled <= threshold) toRemove.push(k)
    }
    if (toRemove.length === 0) break
    for (const k of toRemove) removed.add(k)
  }
  const targets = new TargetMap()
  for (const k of removed) {
    const [x, y, z] = k.split(',').map(Number)
    targets.set(x, y, z, 0)
  }
  return diffTargets(ctx.volume, targets)
}
