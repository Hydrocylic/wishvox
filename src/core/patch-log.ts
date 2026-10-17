import { invertChanges } from './patch'
import type { CompositionRegistry } from './composition'
import { coordKey, isCoordTripleDomain } from './coords'
import { PartRegistry } from './parts'
import type { Part, PartData } from './parts'
import { formatOpLabel, getOpSpec } from './op-spec'
import { resolveScope } from './scope'
import type {
  DeleteOp,
  PaletteEntry,
  Patch,
  ProgramOp,
  RaiseByLayersParams,
  ScopeRef,
  SetOp,
  StrokeOp,
  VoxelChange,
} from './types'
import { Volume } from './volume'

export interface PartCreation {
  seq: number
  id: string
  name: string
  /** D3（debug-261004）：创建与同 seq 的补丁**捆绑**（newProject 坯料 / applyPlanned 内建构件）——
   *  撤销那笔且构件已退空 ⇒ 构件随之剪掉；缺省（含旧存档）= 不捆绑，撤销不剪（newPart 的有意空构件）。 */
  bundled?: boolean
}

interface Snapshot {
  chunks: Array<{ cx: number; cy: number; cz: number; data: Uint16Array }>
  palette: PaletteEntry[]
  parts: PartData[]
}

interface UndoRedoResult {
  patch: Patch
  /** 实际落到模型上的那组变更（undo = 逆补丁；redo = 原补丁）——渲染层增量重建的输入 */
  appliedChanges: VoxelChange[]
}

/** `REQ-065`（A-08）：记账层拿到非法坐标 = 上游漏判。**抛错而不是静默**——静默正是本缺陷的形态
 *  （越界坐标被 `>>4`/`&15` 写到另一格，账实两散且无人发现）。各入口（手动 / AI / 导入）已先判并给回执。 */
function requireCoordDomain(x: number, y: number, z: number, where: string): void {
  if (!isCoordTripleDomain(x, y, z)) {
    throw new Error(`patch-log: ${where} 收到非法坐标（须为 ±4096 内的整数，REQ-065）：(${String(x)}, ${String(y)}, ${String(z)})`)
  }
}

function captureState(volume: Volume, parts: PartRegistry): Snapshot {
  const chunks: Snapshot['chunks'] = []
  for (const ch of volume.iterChunks()) {
    chunks.push({ cx: ch.cx, cy: ch.cy, cz: ch.cz, data: ch.data.slice() })
  }
  return { chunks, palette: volume.palette.list(), parts: parts.serialize() }
}

function restoreState(volume: Volume, parts: PartRegistry, snap: Snapshot): void {
  volume.reset()
  volume.palette.restore(snap.palette)
  volume.loadChunkData(snap.chunks)
  parts.restore(snap.parts)
}

/**
 * 补丁日志：一切写操作的唯一记账（REQ-017）。
 * 一次操作 = 恰好 1 条补丁（含 before==after 的无变化补丁——I1 的幂等口径）；
 * undo = 应用逆补丁；redo = 重放原补丁；快照按 seq 存（周期 + 构件创建锚点）。
 */
export class PatchLog {
  readonly patches: Patch[] = []
  readonly partCreations: PartCreation[] = []
  private readonly undone: Patch[] = []
  /** D3：undo 剪掉的捆绑构件（原下标 + 创建记录），redo 放回；与 undone 同生命周期（新补丁入栈即作废） */
  private readonly revivable: Array<{ index: number; creation: PartCreation }> = []
  private readonly snapshots = new Map<number, Snapshot>()

  constructor(
    readonly volume: Volume,
    readonly parts: PartRegistry,
    /** r03（ADR-19）：undo / redo 还原组合直属键要用；applyPlanned 的入参优先（同一注册表） */
    compositions?: CompositionRegistry,
    private readonly snapshotEvery = 25,
  ) {
    this.comps = compositions ?? null
  }

  /** 最近一次 applyPlanned 收到的组合注册表（undo / redo 的直属键镜像用） */
  private comps: CompositionRegistry | null

  get canUndo(): boolean {
    return this.patches.length > 0
  }

  get canRedo(): boolean {
    return this.undone.length > 0
  }

  /** F12 撤销历史：redo 侧补丁（只读；顺序 = 最早可重做到最近） */
  get undonePatches(): readonly Patch[] {
    return this.undone
  }

  /** 创建构件并把创建事件记进日志（seq = 即将应用的下一条补丁的序号） */
  createPart(name: string, bundled = false): Part {
    const part = this.parts.create(name, this.patches.length)
    this.partCreations.push({ seq: this.patches.length, id: part.id, name, ...(bundled ? { bundled: true } : {}) })
    return part
  }

  apply(op: SetOp | DeleteOp): Patch {
    requireCoordDomain(op.x, op.y, op.z, `apply(${op.type})`)
    const seq = this.patches.length
    const before = this.volume.getBlock(op.x, op.y, op.z)
    const after = op.type === 'set' ? op.key : 0
    const changes: VoxelChange[] = [{ x: op.x, y: op.y, z: op.z, before, after }]
    this.applyChangesWithMembership(changes, op.partId ?? null)
    const patch: Patch = { seq, op, changes, partId: op.partId ?? null, createdAt: Date.now() }
    this.patches.push(patch)
    this.undone.length = 0
    this.revivable.length = 0
    if (seq % this.snapshotEvery === 0) this.snapshots.set(seq, captureState(this.volume, this.parts))
    return patch
  }

  /**
   * r02 批量写入路径（plan §2 接口 1）：一次程序化操作 = **恰好 1 条补丁**（REQ-016 的 1 次撤销由此保持）。
   * r03 归属口径（ADR-19，取代 r02 的"有新块必建构件"）：产出块归**范围管辖单位**——
   * · scope = part ⇒ 归该 part（不新建）；scope = composition ⇒ 归**组合直属块**（manualBlocks 吸收）；
   * · scope = all / manual / 无范围（绝对放置）⇒ 维持新建 `${label} N`（捆绑）；
   * · **移动类**（raiseByLayers）归属**随块走**：新位格继承源格的操作前归属（ownersAfter 记账），不建构件；
   * · 零新格（覆写 / 删除）⇒ 不产出构件（ADR-18 原口径保留）。
   * D-B ②：覆写已有块不改原归属。空范围 / 无可命中 ⇒ 返回 null（不记账）。
   * r04 T5（C3 分发改道）：变更集改由调用方传入（ops/runProgramOp 算好）——记账层不再 import 操作层；
   * 旧 `applyOp(op, compositions)` 的合体形态 = `ops/apply.ts#applyProgramOp`。
   */
  applyPlanned(op: ProgramOp, changes: readonly VoxelChange[], compositions: CompositionRegistry): Patch | null {
    this.comps = compositions
    if (changes.length === 0) return null
    const seq = this.patches.length
    const spec = getOpSpec(op.name)
    if (!spec) throw new Error(`applyOp: 未知操作 ${op.name}`)

    const scopeRef = (op.params as { scope?: ScopeRef }).scope
    const isMove = op.name === 'raiseByLayers'
    const scopePartId = scopeRef?.kind === 'part' ? scopeRef.partId : null
    const scopeCompId = scopeRef?.kind === 'composition' ? scopeRef.compositionId : null

    const ownersBefore = changes.map((c) => this.parts.partIdOf(c.x, c.y, c.z) ?? null)
    const comp = scopeCompId !== null ? compositions.get(scopeCompId) : undefined
    const compMembersBefore = comp ? changes.map((c) => comp.manualBlocks.has(coordKey(c.x, c.y, c.z))) : undefined

    let partId: string | null = null
    if (!isMove) {
      if (scopePartId !== null && this.parts.get(scopePartId)) partId = scopePartId
      else if (!comp && changes.some((c) => c.before === 0)) {
        partId = this.createPart(`${spec.label} ${this.parts.list().length + 1}`, true).id // D3：捆绑——撤销那笔即剪掉空构件
      }
    }

    // 移动类的源格归属快照：必须在应用前取——resolveScope 只返回现存块，应用后源格已清空。
    // 同键平移像（before==after）不进 changes ⇒ 不能只按 changes 建表（实测教训：y6 像变手工块）。
    const moveOwnerAt = isMove && scopeRef
      ? new Map<string, string | null>(
          resolveScope(this.volume, this.parts, compositions, scopeRef).map((c) => [
            coordKey(c.x, c.y, c.z),
            this.parts.partIdOf(c.x, c.y, c.z) ?? null,
          ]),
        )
      : null

    this.applyChangesWithMembership(changes, partId)

    // 移动类：新位格（before===0）继承源格 (x, y−layers, z) 的操作前归属（随块走）
    let ownersAfter: ReadonlyArray<string | null> | undefined
    if (moveOwnerAt) {
      const layers = (op.params as RaiseByLayersParams).layers
      ownersAfter = changes.map((c) => {
        if (c.before !== 0) return null
        const src = moveOwnerAt.get(coordKey(c.x, c.y - layers, c.z)) ?? null
        if (src !== null && this.parts.get(src)) this.parts.assign(c.x, c.y, c.z, src)
        return src
      })
    }

    const patch: Patch = {
      seq,
      op,
      changes,
      partId,
      createdAt: Date.now(),
      label: formatOpLabel(op.name, op.params as unknown as Record<string, unknown>),
      ownersBefore,
      ...(scopeCompId !== null ? { compositionId: scopeCompId } : {}),
      ...(compMembersBefore !== undefined ? { compMembersBefore } : {}),
      ...(ownersAfter !== undefined ? { ownersAfter } : {}),
    }
    this.applyCompKeysForward(patch, compositions)
    this.patches.push(patch)
    this.undone.length = 0
    this.revivable.length = 0
    this.ensureSnapshot(seq) // D-E 构件创建锚点（rollbackToPart 的回退目标）
    return patch
  }

  /** ADR-19 组合直属键的前向应用（applyPlanned 与 redo 共用）：
   *  非移动 ⇒ 吸收产出（before===0 入直属）；移动 ⇒ 直属键随块平移（源格是直属成员才入）；
   *  被本补丁删掉的直属成员键清掉（陈旧键清理）。 */
  private applyCompKeysForward(patch: Patch, compositions: CompositionRegistry | null): void {
    const compId = patch.compositionId
    if (compId === null || compId === undefined || !compositions) return
    const comp = compositions.get(compId)
    if (!comp) return
    const layers = patch.op.type === 'program' && patch.op.name === 'raiseByLayers' ? patch.op.params.layers : null
    const memberAt = new Map<string, boolean>()
    if (patch.compMembersBefore) {
      for (let i = 0; i < patch.changes.length; i++) {
        memberAt.set(coordKey(patch.changes[i]!.x, patch.changes[i]!.y, patch.changes[i]!.z), patch.compMembersBefore[i] === true)
      }
    }
    for (let i = 0; i < patch.changes.length; i++) {
      const c = patch.changes[i]!
      if (c.before === 0) {
        if (layers === null) compositions.addManualBlock(compId, c.x, c.y, c.z)
        else if (memberAt.get(coordKey(c.x, c.y - layers, c.z)) === true) {
          compositions.addManualBlock(compId, c.x, c.y, c.z)
        }
      } else if (c.after === 0 && patch.compMembersBefore?.[i] === true) {
        compositions.removeManualBlock(compId, c.x, c.y, c.z)
      }
    }
  }

  /** ADR-19 组合直属键的撤销镜像（前向吸收的键撤掉、前向清掉的键放回） */
  private applyCompKeysInverse(patch: Patch, compositions: CompositionRegistry | null): void {
    const compId = patch.compositionId
    if (compId === null || compId === undefined || !compositions) return
    const comp = compositions.get(compId)
    if (!comp) return
    for (let i = 0; i < patch.changes.length; i++) {
      const c = patch.changes[i]!
      if (c.before === 0) compositions.removeManualBlock(compId, c.x, c.y, c.z)
      else if (c.after === 0 && patch.compMembersBefore?.[i] === true) compositions.addManualBlock(compId, c.x, c.y, c.z)
    }
  }

  /**
   * r02 前半 F7：笔刷一笔的记账入口。按下→松开 = **恰好 1 条补丁**（V8）；
   * 拖动期间调用方已**旁路**把 changes 直写到 volume / parts（所见即所得），这里只补记账。
   * ownersBefore 必须是**落笔前**的归属快照（调用方在首次触碰每格时捕获）——undo 据此精确还原归属。
   * changes 为空 = 零变化 ⇒ 返回 null 不入栈（V8 ②）。
   */
  commitStroke(args: {
    changes: readonly VoxelChange[]
    ownersBefore: ReadonlyArray<string | null>
    op: StrokeOp
    label: string
    partId: string | null
  }): Patch | null {
    if (args.changes.length === 0) return null
    if (args.ownersBefore.length !== args.changes.length) {
      throw new Error('commitStroke: ownersBefore 必须与 changes 等长（落笔前归属快照）')
    }
    const seq = this.patches.length
    const patch: Patch = {
      seq,
      op: args.op,
      changes: [...args.changes],
      partId: args.partId,
      createdAt: Date.now(),
      label: args.label, // 补丁带操作名（纪律 ③：F12 历史面板与 r03 回执都读它）
      ownersBefore: [...args.ownersBefore],
    }
    this.patches.push(patch)
    this.undone.length = 0
    this.revivable.length = 0
    this.ensureSnapshot(seq)
    return patch
  }

  undo(): UndoRedoResult | null {
    const patch = this.patches.pop()
    if (!patch) return null
    // `A-11`（PA-50）：链在此截断 ⇒ 本 seq 及其后的旧快照全部作废（见 dropSnapshotsFrom）
    this.dropSnapshotsFrom(this.patches.length)
    const inverse = invertChanges(patch.changes)
    this.applyChangesWithMembership(inverse, patch.partId)
    // r02：程序化操作补丁按 ownersBefore 精确还原归属（前向规则与 replay 一致，undo 才消费这份账）。
    // 操作前有块的格子：归属还原（含"原本无归属的手工块"）；操作前即空的格子：undo 后仍空，无需处理。
    // 归属的构件已被 dissolve ⇒ 无法复活，块保持无归属（不抛错——删除构件 = 解除归属，撤销不复活构件）。
    if (patch.ownersBefore && patch.ownersBefore.length === patch.changes.length) {
      for (let i = 0; i < patch.changes.length; i++) {
        const c = patch.changes[i]!
        if (c.before === 0) continue
        const owner = patch.ownersBefore[i] ?? null
        if (owner !== null && this.parts.get(owner)) this.parts.assign(c.x, c.y, c.z, owner)
        else this.parts.unassign(c.x, c.y, c.z)
      }
    }
    // D3（debug-261004）：撤销"捆绑创建"的补丁且该构件已被退空 ⇒ 剪掉（不留 0 块构件；redo 原样复活）。
    // 只动 bundled 构件（newPart 的有意空构件 / 有块构件不受影响）；creation 条目同步回收，
    // 否则 replay(log) 会复活幻影空构件、破坏 I2。
    if (patch.partId !== null) {
      const emptied = this.parts.get(patch.partId)
      if (emptied && emptied.blocks.size === 0) {
        const ci = this.partCreations.findIndex((c) => c.bundled === true && c.seq === patch.seq && c.id === patch.partId)
        if (ci >= 0) {
          this.parts.dissolve(patch.partId)
          this.revivable.push({ index: ci, creation: this.partCreations[ci]! })
          this.partCreations.splice(ci, 1)
        }
      }
    }
    // r03（ADR-19）：组合直属键镜像还原
    this.applyCompKeysInverse(patch, this.comps)
    this.undone.push(patch)
    return { patch, appliedChanges: inverse }
  }

  redo(): UndoRedoResult | null {
    const patch = this.undone.pop()
    if (!patch) return null
    // D3：undo 剪掉的捆绑构件先复活（原 id / 原名 / 原锚点），块由下方重放归位；
    // creation 条目按 undo 时记下的下标放回（redo 与 undo 严格 LIFO 镜像 ⇒ 数组序可原样还原）。
    if (patch.partId !== null) {
      const ri = this.revivable.findIndex((r) => r.creation.seq === patch.seq && r.creation.id === patch.partId)
      if (ri >= 0) {
        const { index, creation } = this.revivable.splice(ri, 1)[0]!
        this.parts.revive(creation.id, creation.name, creation.seq)
        this.partCreations.splice(Math.min(index, this.partCreations.length), 0, creation)
      }
    }
    const changes = patch.changes.map((c) => ({ ...c }))
    this.applyChangesWithMembership(changes, patch.partId)
    // r03（ADR-19 抬升随块走）：redo 按 ownersAfter 逐格还原归属（与 applyPlanned 前向一致）+ 直属键镜像
    if (patch.ownersAfter) {
      for (let i = 0; i < changes.length; i++) {
        const c = changes[i]!
        const owner = patch.ownersAfter[i] ?? null
        if (c.before === 0 && owner !== null && this.parts.get(owner)) this.parts.assign(c.x, c.y, c.z, owner)
      }
    }
    this.applyCompKeysForward(patch, this.comps)
    this.patches.push(patch)
    return { patch, appliedChanges: changes }
  }

  /** 保证 seq 处有快照（构件创建锚点 / 回退目标）；没有就现补一个（必要时走重放重建） */
  ensureSnapshot(seq: number): void {
    if (seq < 0 || seq >= this.patches.length) throw new Error(`snapshot: seq ${seq} out of range`)
    if (this.snapshots.has(seq)) return
    if (seq === this.patches.length - 1) {
      this.snapshots.set(seq, captureState(this.volume, this.parts))
      return
    }
    const replayed = PatchLog.replay(this.patches.slice(0, seq + 1), this.volume.palette.list(), this.partCreations)
    this.snapshots.set(seq, captureState(replayed.volume, replayed.parts))
  }

  /**
   * `A-11`（PA-50）：撤销后**当前链从此处截断** ⇒ 对应 seq 的旧快照作废（`rollbackToSeq` 不能拿它当链上状态）。
   * 快照有效性判据 = "该 seq 仍在本条链上"；判据一破就删，需要时由 `ensureSnapshot` 按当前链重算。
   * 不删的后果：撤销 k 笔后用新补丁复用这些 seq 号（`seq = patches.length`），再回退到该 seq
   * 会恢复**已放弃分支**的体素（块凭空回来 / 消失），而补丁日志说该 seq 是另一条补丁。
   */
  private dropSnapshotsFrom(seq: number): void {
    for (const key of [...this.snapshots.keys()]) {
      if (key >= seq) this.snapshots.delete(key)
    }
  }

  /** 回退到某条补丁应用后的状态（REQ-023 ②：rollbackToPart 的实现底座）；redo 栈清空 */
  rollbackToSeq(seq: number): void {
    if (seq < 0 || seq >= this.patches.length) throw new Error(`rollback: seq ${seq} out of range`)
    this.ensureSnapshot(seq)
    const snap = this.snapshots.get(seq)
    if (!snap) throw new Error(`rollback: snapshot ${seq} missing`)
    restoreState(this.volume, this.parts, snap)
    this.dropSnapshotsFrom(seq + 1) // `A-11`：回退也截断链 ⇒ 其后旧快照作废
    this.patches.length = seq + 1
    for (let i = this.partCreations.length - 1; i >= 0; i--) {
      if (this.partCreations[i].seq > seq) this.partCreations.splice(i, 1)
    }
    this.undone.length = 0
    this.revivable.length = 0
  }

  /** 空状态（新建项目） */
  reset(): void {
    this.patches.length = 0
    this.partCreations.length = 0
    this.undone.length = 0
    this.revivable.length = 0
    this.snapshots.clear()
  }

  /** 从文件载入历史（redo 为空） */
  adopt(patches: readonly Patch[], creations: readonly PartCreation[]): void {
    this.reset()
    for (const p of patches) this.patches.push(p)
    for (const c of creations) this.partCreations.push(c)
  }

  /**
   * 归属语义（r01 最小口径）：
   * 放置到空格（before===0）→ 归操作时的构件；改色（before>0）不改归属；删除 → 解除归属。
   * 撤销走同一规则（逆补丁的 before/after 已交换，天然对称）。
   * r02 补充：partId 指向已 dissolve 的构件时跳过归属（删除构件 = 解除归属，撤销/重放不复活构件）。
   */
  private applyChangesWithMembership(changes: readonly VoxelChange[], partId: string | null): void {
    for (const c of changes) {
      requireCoordDomain(c.x, c.y, c.z, 'applyChangesWithMembership')
      this.volume.setBlock(c.x, c.y, c.z, c.after)
      if (c.after === 0) this.parts.unassign(c.x, c.y, c.z)
      else if (c.before === 0 && partId && this.parts.get(partId)) this.parts.assign(c.x, c.y, c.z, partId)
    }
  }

  /** I2 第二条：replay(log) = 当前模型。静态、纯函数式——r04 时间轴复用同一条路径。 */
  static replay(
    patches: readonly Patch[],
    paletteEntries: PaletteEntry[],
    creations: readonly PartCreation[],
  ): { volume: Volume; parts: PartRegistry } {
    const volume = new Volume()
    volume.palette.restore(paletteEntries)
    const parts = new PartRegistry()
    let ci = 0
    const drainCreations = (upToSeq: number): void => {
      while (ci < creations.length && creations[ci].seq <= upToSeq) {
        const creation = creations[ci]
        parts.create(creation.name, creation.seq)
        ci++
      }
    }
    for (let i = 0; i < patches.length; i++) {
      drainCreations(i)
      const p = patches[i]
      for (let j = 0; j < p.changes.length; j++) {
        const c = p.changes[j]
        requireCoordDomain(c.x, c.y, c.z, 'replay')
        volume.setBlock(c.x, c.y, c.z, c.after)
        if (c.after === 0) parts.unassign(c.x, c.y, c.z)
        else if (c.before === 0) {
          // r03（ADR-19）：移动类补丁按 ownersAfter 逐格归属（随块走）；其余按 partId（与前向规则一致）。
          // 注：replay 只重建 volume + parts——组合直属键随文件快照恢复，不走重放。
          const owner = p.ownersAfter?.[j] ?? null
          if (owner !== null && parts.get(owner)) parts.assign(c.x, c.y, c.z, owner)
          else if (p.partId && parts.get(p.partId)) parts.assign(c.x, c.y, c.z, p.partId)
        }
      }
    }
    drainCreations(Number.MAX_SAFE_INTEGER)
    return { volume, parts }
  }
}
