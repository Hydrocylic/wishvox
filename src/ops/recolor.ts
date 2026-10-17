import type { CompositionRegistry } from '../core/composition'
import type { PartRegistry } from '../core/parts'
import { resolveScope } from '../core/scope'
import type { RecolorParams } from '../core/types'
import type { Volume } from '../core/volume'
import { TargetMap, diffTargets } from './targets'

// 换材质（绝对类）：范围内（可选：仅这些键）改用 toKey——"屋顶改红"的手动版。
// 只读现块（resolveScope 只返回现存块）⇒ fromKeys 命中后已换过的键第二次不再命中 ⇒ 幂等。
export function recolor(
  params: RecolorParams,
  ctx: { volume: Volume; parts: PartRegistry; compositions: CompositionRegistry },
): ReturnType<typeof diffTargets> {
  const coords = resolveScope(ctx.volume, ctx.parts, ctx.compositions, params.scope)
  const targets = new TargetMap()
  for (const c of coords) {
    const key = ctx.volume.getBlock(c.x, c.y, c.z)
    if (params.fromKeys && !params.fromKeys.includes(key)) continue
    targets.set(c.x, c.y, c.z, params.toKey)
  }
  return diffTargets(ctx.volume, targets)
}
