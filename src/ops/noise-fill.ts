import type { CompositionRegistry } from '../core/composition'
import type { PartRegistry } from '../core/parts'
import { resolveScope } from '../core/scope'
import type { NoiseFillParams } from '../core/types'
import type { Volume } from '../core/volume'
import { createRng, rngInt } from './rng'
import { TargetMap, boundsOf, diffTargets } from './targets'

// 噪声填充（绝对类）：范围坐标集的**包围盒**内，每个空位按密度以种子伪随机填块；已有块不动。
// I4 + I1 的关键约束：随机数序列只依赖 (种子, 包围盒, 密度)——占中的格子即使已被占也照样抽键（只不写），
// ⇒ 第二次应用抽到同一序列、命中同一批格子（已填）⇒ 终态不变（幂等）。
export function noiseFill(
  params: NoiseFillParams,
  ctx: { volume: Volume; parts: PartRegistry; compositions: CompositionRegistry },
): ReturnType<typeof diffTargets> {
  const coords = resolveScope(ctx.volume, ctx.parts, ctx.compositions, params.scope)
  const bbox = boundsOf(coords)
  if (!bbox || params.keys.length === 0 || params.density <= 0) return []
  const rng = createRng(params.seed)
  const targets = new TargetMap()
  for (let x = bbox.minX; x <= bbox.maxX; x++) {
    for (let y = bbox.minY; y <= bbox.maxY; y++) {
      for (let z = bbox.minZ; z <= bbox.maxZ; z++) {
        if (rng() >= params.density) continue
        const key = params.keys[rngInt(rng, params.keys.length)]!
        if (ctx.volume.getBlock(x, y, z) === 0) targets.set(x, y, z, key)
      }
    }
  }
  return diffTargets(ctx.volume, targets)
}
