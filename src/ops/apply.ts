// r04 T5（C3 分发改道）：旧 `PatchLog.applyOp(op, compositions)` 的全行为助手——
// "runProgramOp 算变更集 + log.applyPlanned 记账"一步到位。测试与 harness 的直调点用它
// 一行式替换 `log.applyOp(op, comps)`；生产路径（edit/editor 的 runOp / aiProgramOp）
// 走显式两步（变更集可先于记账被消费）。
import type { CompositionRegistry } from '../core/composition'
import type { PatchLog } from '../core/patch-log'
import type { Patch, ProgramOp } from '../core/types'
import { runProgramOp } from './index'

export function applyProgramOp(
  log: PatchLog,
  op: ProgramOp,
  compositions: CompositionRegistry,
): Patch | null {
  const changes = runProgramOp(op, { volume: log.volume, parts: log.parts, compositions })
  return log.applyPlanned(op, changes, compositions)
}
