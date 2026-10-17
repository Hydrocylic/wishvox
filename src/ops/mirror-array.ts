import type { CompositionRegistry } from '../core/composition'
import type { PartRegistry } from '../core/parts'
import { resolveScope } from '../core/scope'
import type { MirrorArrayParams } from '../core/types'
import type { Volume } from '../core/volume'
import { TargetMap, boundsOf, diffTargets } from './targets'

// 镜像阵列（绝对类）：沿轴在范围包围盒外侧生成 copies 份镜像（翻转）副本，相邻副本间恰好空 `spacing` 格。
// 第 i 份（i 从 1 数）的轴坐标 = (2·max + 1 − c[轴]) + (i−1)·(跨度+1+spacing) + spacing——
// spacing=0 时第一份与原件紧贴。幂等口径（r03 · ADR-19 修订）：副本归**范围管辖单位** ⇒
// part / composition / all 范围引用会吸收副本（bbox 外移 ⇒ 落点变化，不再幂等）；
// manual 范围（副本维持新建构件 ⇒ 手工块集合不变）与无吸收的范围仍"同参数 ⇒ 落点相同"。
export function mirrorArray(
  params: MirrorArrayParams,
  ctx: { volume: Volume; parts: PartRegistry; compositions: CompositionRegistry },
): ReturnType<typeof diffTargets> {
  if (params.axis !== 'x' && params.axis !== 'z') throw new Error(`mirrorArray: axis 只能是 x|z（收到 ${params.axis}）`)
  if (!Number.isInteger(params.copies) || params.copies < 1) {
    throw new Error(`mirrorArray: copies 必须是 ≥1 的整数（收到 ${params.copies}）`)
  }
  if (!Number.isInteger(params.spacing) || params.spacing < 0) {
    throw new Error(`mirrorArray: spacing 必须是 ≥0 的整数（收到 ${params.spacing}）`)
  }
  const coords = resolveScope(ctx.volume, ctx.parts, ctx.compositions, params.scope)
  const bbox = boundsOf(coords)
  if (!bbox) return []
  const axis = params.axis
  const min = axis === 'x' ? bbox.minX : bbox.minZ
  const max = axis === 'x' ? bbox.maxX : bbox.maxZ
  const step = max - min + 1 + params.spacing
  const targets = new TargetMap()
  for (let i = 1; i <= params.copies; i++) {
    const shift = (i - 1) * step + params.spacing
    for (const c of coords) {
      const key = ctx.volume.getBlock(c.x, c.y, c.z)
      if (axis === 'x') targets.set(2 * max + 1 - c.x + shift, c.y, c.z, key)
      else targets.set(c.x, c.y, 2 * max + 1 - c.z + shift, key)
    }
  }
  return diffTargets(ctx.volume, targets)
}
