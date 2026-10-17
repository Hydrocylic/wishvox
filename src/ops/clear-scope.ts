import type { CompositionRegistry } from '../core/composition'
import type { PartRegistry } from '../core/parts'
import { resolveScope } from '../core/scope'
import type { ClearScopeParams } from '../core/types'
import type { Volume } from '../core/volume'
import { TargetMap, diffTargets } from './targets'

// 范围清除（绝对类）：范围内全部置空。幂等：第二次解析到的范围为空 ⇒ 无补丁。
export function clearScope(
  params: ClearScopeParams,
  ctx: { volume: Volume; parts: PartRegistry; compositions: CompositionRegistry },
): ReturnType<typeof diffTargets> {
  const coords = resolveScope(ctx.volume, ctx.parts, ctx.compositions, params.scope)
  const targets = new TargetMap()
  for (const c of coords) targets.set(c.x, c.y, c.z, 0)
  return diffTargets(ctx.volume, targets)
}
