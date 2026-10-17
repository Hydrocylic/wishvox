import type { CompositionRegistry } from '../core/composition'
import type { PartRegistry } from '../core/parts'
import { resolveScope } from '../core/scope'
import type { RaiseByLayersParams } from '../core/types'
import type { Volume } from '../core/volume'
import { TargetMap, diffTargets } from './targets'

// 按层抬升（相对类）：范围内所有块整体沿 +y 平移 N 层。平移是单射 ⇒ 目标互不冲突；
// 源格先全部置 0、再落目标（Map 后写覆盖 ⇒ 源格若同时是别块的目标则保留目标值）——终态差分一次算清。
// 目标格若压到范围外的块 ⇒ 覆写（归属按 D-B ② 不变）。
export function raiseByLayers(
  params: RaiseByLayersParams,
  ctx: { volume: Volume; parts: PartRegistry; compositions: CompositionRegistry },
): ReturnType<typeof diffTargets> {
  if (!Number.isInteger(params.layers) || params.layers < 1) {
    throw new Error(`raiseByLayers: layers 必须是 ≥1 的整数（收到 ${params.layers}）`)
  }
  const coords = resolveScope(ctx.volume, ctx.parts, ctx.compositions, params.scope)
  const targets = new TargetMap()
  for (const c of coords) targets.set(c.x, c.y, c.z, 0)
  for (const c of coords) {
    const key = ctx.volume.getBlock(c.x, c.y, c.z)
    targets.set(c.x, c.y + params.layers, c.z, key)
  }
  return diffTargets(ctx.volume, targets)
}
