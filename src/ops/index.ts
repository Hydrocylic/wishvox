// 程序化操作族分发器（REQ-014）：ProgramOp → 变更集。实现在各单文件，规格表在 core/op-spec.ts。
// 返回终态差分（每个受影响坐标恰好一条 change）；空数组 = 范围无块 / 无可命中 ⇒ 调用方不记账。
// r04 T5（C3 分发改道）：本目录从 core/ops/ 顶层化迁来；"算变更集"归这里，"记账"归 core/patch-log
// 的 applyPlanned——两步的合体助手见 ./apply.ts（= 旧 PatchLog.applyOp 全行为）。
import type { CompositionRegistry } from '../core/composition'
import type { PartRegistry } from '../core/parts'
import type { ProgramOp, VoxelChange } from '../core/types'
import type { Volume } from '../core/volume'
import { addLayer } from './add-layer'
import { bevelEdges } from './bevel-edges'
import { clearScope } from './clear-scope'
import { mirrorArray } from './mirror-array'
import { noiseFill } from './noise-fill'
import { noiseSculpt } from './noise-sculpt'
import { presetShape } from './preset-shape'
import { raiseByLayers } from './raise-by-layers'
import { recolor } from './recolor'

interface OpContext {
  readonly volume: Volume
  readonly parts: PartRegistry
  readonly compositions: CompositionRegistry
}

export function runProgramOp(op: ProgramOp, ctx: OpContext): VoxelChange[] {
  switch (op.name) {
    case 'noiseFill':
      return noiseFill(op.params, ctx)
    case 'noiseSculpt':
      return noiseSculpt(op.params, ctx)
    case 'presetShape':
      return presetShape(op.params, ctx)
    case 'raiseByLayers':
      return raiseByLayers(op.params, ctx)
    case 'addLayer':
      return addLayer(op.params, ctx)
    case 'recolor':
      return recolor(op.params, ctx)
    case 'clearScope':
      return clearScope(op.params, ctx)
    case 'mirrorArray':
      return mirrorArray(op.params, ctx)
    case 'bevelEdges':
      return bevelEdges(op.params, ctx)
    default:
      // r04 T5（C3）：未知操作校验从 PatchLog.applyOp 移入（文案保持原样——editor.runOp 的 catch 会转成界面反馈）
      throw new Error(`applyOp: 未知操作 ${(op as ProgramOp).name}`)
  }
}

export * from './rng'
export * from '../core/op-spec'
