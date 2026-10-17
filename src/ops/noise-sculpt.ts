import type { CompositionRegistry } from '../core/composition'
import type { PartRegistry } from '../core/parts'
import { resolveScope } from '../core/scope'
import type { NoiseSculptParams } from '../core/types'
import type { Volume } from '../core/volume'
import { createRng } from './rng'
import { TargetMap, diffTargets } from './targets'

// 噪声雕塑（F8 · REQ-057 · Q3 拍板）：在范围内每个块的**表面位点**（该方向外侧是空气）上，
// 以种子伪随机决定"生长（向外放块）/ 侵蚀（删掉表面块）"，一次性产出终态差分（无动画；心跳动画记账）。
// 复用 ops/rng.ts（r04 T5 前位于 core/ops/） 与"终态差分"写法（TargetMap + diffTargets ⇒ 每坐标恰好一条 change）。
// 确定性（I4 同口径）：随机数序列只依赖 (种子, 范围坐标集, 方位勾选, 参数) ⇒ 同参数同结果。
export function noiseSculpt(
  params: NoiseSculptParams,
  ctx: { volume: Volume; parts: PartRegistry; compositions: CompositionRegistry },
): ReturnType<typeof diffTargets> {
  if (params.amplitude < 1 || params.amplitude > 4) {
    throw new Error(`噪声雕塑的幅度须为 1–4 的整数（收到 ${String(params.amplitude)}）。最小合法示例：{ "amplitude": 1, "density": 0.5, "seed": 1 }`)
  }
  if (params.density <= 0 || params.density > 1) {
    throw new Error(`噪声雕塑的密度须为 (0, 1]（收到 ${String(params.density)}）。最小合法示例：{ "amplitude": 1, "density": 0.5, "seed": 1 }`)
  }
  const dirs = params.dirs
  const active: Array<[number, number, number]> = []
  if (dirs.px) active.push([1, 0, 0])
  if (dirs.nx) active.push([-1, 0, 0])
  if (dirs.py) active.push([0, 1, 0])
  if (dirs.ny) active.push([0, -1, 0])
  if (dirs.pz) active.push([0, 0, 1])
  if (dirs.nz) active.push([0, 0, -1])
  if (active.length === 0) {
    throw new Error('噪声雕塑至少要勾选一个方位。最小合法示例：{ "dirs": { "px": true }, "amplitude": 1, "density": 0.5, "seed": 1 }')
  }
  const coords = resolveScope(ctx.volume, ctx.parts, ctx.compositions, params.scope)
  if (coords.length === 0) return []
  const rng = createRng(params.seed)
  const targets = new TargetMap()
  // 遍历序固定（coords 字典序 + 方位固定次序）⇒ 抽签序列确定 ⇒ 同参数同形（seed 全显式）
  for (const b of coords) {
    for (const [dx, dy, dz] of active) {
      const nx = b.x + dx
      const ny = b.y + dy
      const nz = b.z + dz
      if (ctx.volume.getBlock(nx, ny, nz) !== 0) continue // 该方向不是表面 ⇒ 跳过
      const r1 = rng()
      if (r1 >= params.density) continue // 该位点未被命中
      const r2 = rng()
      if (r2 < 0.5) {
        // 生长：紧邻格放一块，再按幅度逐层向外延伸（每层独立抽签，未中即停）。
        // REQ-059（ADR-20 ①）：−y 生长到 y=0 即止——越界目标**只丢弃不记账**，抽签照常消费
        // ⇒ 裁剪只移除地下目标，其余格子的随机序列与结果不变（I4 同参数同结果保持）。
        if (ny >= 0) targets.set(nx, ny, nz, params.key)
        for (let s = 2; s <= params.amplitude; s++) {
          if (rng() < params.density) {
            const gy = b.y + dy * s
            if (gy >= 0) targets.set(b.x + dx * s, gy, b.z + dz * s, params.key)
          } else break
        }
      } else {
        // 侵蚀：删掉该方向的表面块本身（表面块必在 y>=0 —— 空间不变量）
        targets.set(b.x, b.y, b.z, 0)
      }
    }
  }
  return diffTargets(ctx.volume, targets)
}
