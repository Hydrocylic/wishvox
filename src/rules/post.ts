// rules/post.ts —— 后验校验接缝（写完成后的"变更 ⊆ 宾语"对账正本）
//
// 纪律（文件头，逐条）：
// 1. 内容 = ai/executor.ts 的 reconcileNarrow / reconcileExpand 整段迁入（纯函数搬家，行为不变）；
//    现状只有 AI 路径调用（经 ai/executor.ts）。
// 2. D-K：手动路径【不】调用本接缝——手动获得后验 = 行为变更，已裁另排线；
//    将来接线点 = edit/stroke.ts 的 strokeCommit 之后（见 rules/README.md 的"手动接入"节）。
// 3. A1：两条对账规则（收束 / 扩张）共享一条宾语口径 hint——它们是同一规则的收束/扩张两半，
//    对 AI 的表述无差别；文本搬运自 SYSTEM_PROMPT 第 3 条（宾语口径）——逐字相同，快照用例锁定。
//    将来若两类对账的劝导口径分叉，再拆两条——hint 跟对 AI 的表述走，不跟函数个数走。
// 4. D-G：导出面 = ReconcileFail（类型）+ reconcileNarrow + reconcileExpand + NARROW_OPS +
//    EXPAND_OPS + POST_RULE_HINTS + postAgentHints——消费者 = ai/executor.ts / ai/messages.ts。
// 5. 不抄 RuleRegistry/appliesTo 注册表（1 前置 + 1 条宾语口径的规模撑不起聚合根；规则数涨过 5 条再议）。
import { coordKey } from '../core/coords'
import type { ProgramOp, VoxelChange } from '../core/types'
import type { Volume } from '../core/volume'

interface PostRuleHint {
  readonly id: string
  readonly zh: string
  readonly en: string
}

/** 宾语口径 hint（收束 / 扩张两半共享）——文本 = loop.ts SYSTEM_PROMPT_ZH 第 3 条 / EN 对应分句，逐字相同。 */
export const POST_RULE_HINTS: readonly PostRuleHint[] = [
  { id: 'post.object-scope', zh: '宾语用 id：构件 / 组合先 list_* 拿 id，再传 target_kind + target_id；不做名字猜测。', en: 'address parts/compositions by id (list_* first, then target_kind + target_id)' },
]

export function postAgentHints(language: 'zh' | 'en'): string[] {
  return POST_RULE_HINTS.map((h) => h[language])
}

export interface ReconcileFail {
  readonly violations: string[]
}

/** 收束类：变更集 ⊆ 宾语集合（recolor / clearScope / bevelEdges——操作只碰范围块）；noiseFill ⊆ bbox(范围) */
export function reconcileNarrow(op: ProgramOp, scopeCoords: ReadonlyArray<{ x: number; y: number; z: number }>, changes: readonly VoxelChange[]): ReconcileFail | null {
  const scopeSet = new Set(scopeCoords.map((c) => coordKey(c.x, c.y, c.z)))
  if (op.name === 'noiseFill') {
    // bbox 判据：noiseFill 语义 = 填范围包围盒内的空位（包围盒本身不是块集合）
    let minX = Infinity
    let minY = Infinity
    let minZ = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let maxZ = -Infinity
    for (const c of scopeCoords) {
      minX = Math.min(minX, c.x)
      minY = Math.min(minY, c.y)
      minZ = Math.min(minZ, c.z)
      maxX = Math.max(maxX, c.x)
      maxY = Math.max(maxY, c.y)
      maxZ = Math.max(maxZ, c.z)
    }
    const outside = changes.filter((c) => c.x < minX || c.x > maxX || c.y < minY || c.y > maxY || c.z < minZ || c.z > maxZ)
    return outside.length > 0 ? { violations: [`${outside.length} 格改动落在范围包围盒之外`] } : null
  }
  const outside = changes.filter((c) => !scopeSet.has(coordKey(c.x, c.y, c.z)))
  return outside.length > 0 ? { violations: [`${outside.length} 格改动越出宾语集合`] } : null
}

/** 扩张类：删除 ⊆ 宾语集 且 新增 = 声明扩张（noiseSculpt 生长壳 / raiseByLayers 平移像 / mirrorArray 镜像像）。
 *  keyAt = 操作前宾语块的键（像保形判据）；volume = 执行后的活模型（同材质平移像不进 diff，须活读）。 */
export function reconcileExpand(
  op: ProgramOp,
  scopeCoords: ReadonlyArray<{ x: number; y: number; z: number }>,
  keyAt: ReadonlyMap<string, number>,
  changes: readonly VoxelChange[],
  volume: Volume,
): ReconcileFail | null {
  const scopeSet = new Set(scopeCoords.map((c) => coordKey(c.x, c.y, c.z)))
  const violations: string[] = []
  if (op.name === 'noiseSculpt') {
    const p = op.params
    // 预计算声明的生长壳（b + d·s，s ≤ amplitude）——O(范围×方位×幅度)，判据 O(1)
    const growthShell = new Set<string>()
    const active: Array<[number, number, number]> = []
    if (p.dirs.px) active.push([1, 0, 0])
    if (p.dirs.nx) active.push([-1, 0, 0])
    if (p.dirs.py) active.push([0, 1, 0])
    if (p.dirs.ny) active.push([0, -1, 0])
    if (p.dirs.pz) active.push([0, 0, 1])
    if (p.dirs.nz) active.push([0, 0, -1])
    for (const c of scopeCoords) {
      for (const [dx, dy, dz] of active) {
        for (let s = 1; s <= p.amplitude; s++) growthShell.add(coordKey(c.x + dx * s, c.y + dy * s, c.z + dz * s))
      }
    }
    for (const c of changes) {
      if (c.after === 0 && !scopeSet.has(coordKey(c.x, c.y, c.z))) violations.push(`删除越出宾语：(${c.x},${c.y},${c.z})`)
      if (c.before === 0 && !growthShell.has(coordKey(c.x, c.y, c.z))) violations.push(`新增不在声明生长壳内：(${c.x},${c.y},${c.z})`)
    }
  } else if (op.name === 'raiseByLayers') {
    const L = op.params.layers
    // 删除 ⊆ 宾语；新增 = 平移像（(x, y−L, z) ∈ 宾语）；像保形（活读——同材质像不进 diff）
    for (const c of changes) {
      if (c.after === 0 && !scopeSet.has(coordKey(c.x, c.y, c.z))) violations.push(`删除越出宾语：(${c.x},${c.y},${c.z})`)
      if (c.before === 0 && !scopeSet.has(coordKey(c.x, c.y - L, c.z))) violations.push(`新增不是平移像：(${c.x},${c.y},${c.z})`)
    }
    for (const c of scopeCoords) {
      const expect = keyAt.get(coordKey(c.x, c.y, c.z))
      const got = volume.getBlock(c.x, c.y + L, c.z)
      if (expect !== undefined && got !== expect) violations.push(`平移像缺失或形变：(${c.x},${c.y + L},${c.z}) 应为键 ${expect}（实得 ${got}）`)
    }
  } else if (op.name === 'mirrorArray') {
    const p = op.params
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (const c of scopeCoords) {
      minX = Math.min(minX, c.x)
      maxX = Math.max(maxX, c.x)
      minZ = Math.min(minZ, c.z)
      maxZ = Math.max(maxZ, c.z)
    }
    const step = (p.axis === 'x' ? maxX - minX : maxZ - minZ) + 1 + p.spacing
    const imageSet = new Set<string>()
    for (let i = 1; i <= p.copies; i++) {
      const shift = (i - 1) * step + p.spacing
      for (const c of scopeCoords) {
        imageSet.add(p.axis === 'x' ? coordKey(2 * maxX + 1 - c.x + shift, c.y, c.z) : coordKey(c.x, c.y, 2 * maxZ + 1 - c.z + shift))
      }
    }
    for (const c of changes) {
      if (c.after === 0 && !scopeSet.has(coordKey(c.x, c.y, c.z))) violations.push(`删除越出宾语：(${c.x},${c.y},${c.z})`)
      if (c.before === 0 && !imageSet.has(coordKey(c.x, c.y, c.z))) violations.push(`新增不是声明的镜像位：(${c.x},${c.y},${c.z})`)
    }
  }
  return violations.length > 0 ? { violations: violations.slice(0, 4) } : null
}

export const NARROW_OPS = new Set(['recolor', 'clearScope', 'bevelEdges', 'noiseFill'])
export const EXPAND_OPS = new Set(['noiseSculpt', 'raiseByLayers', 'mirrorArray'])
