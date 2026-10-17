import type { CompositionRegistry } from '../core/composition'
import type { PartRegistry } from '../core/parts'
import { resolveScope } from '../core/scope'
import type { AddLayerParams } from '../core/types'
import type { Volume } from '../core/volume'
import { TargetMap, diffTargets } from './targets'

// 加层（相对类）：范围顶面轮廓（每个 (x,z) 列的最高块）向上复制 count 层，材质统一为 key。
// 新层若压到范围外的块（例：墙体加层压到屋顶）⇒ 覆写（归属按 D-B ② 不变）。
export function addLayer(
  params: AddLayerParams,
  ctx: { volume: Volume; parts: PartRegistry; compositions: CompositionRegistry },
): ReturnType<typeof diffTargets> {
  if (!Number.isInteger(params.count) || params.count < 1) {
    throw new Error(`addLayer: count 必须是 ≥1 的整数（收到 ${params.count}）`)
  }
  const coords = resolveScope(ctx.volume, ctx.parts, ctx.compositions, params.scope)
  // 每列最高块（coords 已按 (x,y,z) 排序 ⇒ 列内最后一个 y 即最高）
  const topOfColumn = new Map<string, number>()
  for (const c of coords) topOfColumn.set(`${c.x},${c.z}`, c.y)
  const targets = new TargetMap()
  for (const [col, topY] of topOfColumn) {
    const [x, z] = col.split(',').map(Number)
    for (let i = 1; i <= params.count; i++) targets.set(x, topY + i, z, params.key)
  }
  return diffTargets(ctx.volume, targets)
}
