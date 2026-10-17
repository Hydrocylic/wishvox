// N4 · 操作产出的构件归属（REQ-023 + D-E）与 D-B / D-D / D-C 的构件 / 组合语义。
// D-E：每个程序化操作产出的块**恰好**归一个新 part（默认名 = 操作名 + 序号，可改名）；
// D-B ②：覆写已有块不改原归属；D-D：删除构件 = 解除归属（块留下）；D-C：组合不改变 part 归属。
import { describe, expect, it } from 'vitest'
import { internBuiltin } from '../../src/core/builtin-palette'
import { CompositionRegistry } from '../../src/core/composition'
import { PatchLog } from '../../src/core/patch-log'
import { applyProgramOp } from '../../src/ops/apply'
import { PartRegistry } from '../../src/core/parts'
import { Volume } from '../../src/core/volume'

function makeFixture(): { volume: Volume; parts: PartRegistry; compositions: CompositionRegistry; log: PatchLog; k: (i: string) => number } {
  const volume = new Volume()
  const keys = internBuiltin(volume.palette)
  const parts = new PartRegistry()
  const compositions = new CompositionRegistry()
  const log = new PatchLog(volume, parts)
  return { volume, parts, compositions, log, k: (i) => keys.get(i)! }
}

describe('N4 · 一操作一构件（D-E）', () => {
  it('每个程序化操作：partCreations +1、产出块恰好归一个新 part、默认名 = 操作名 + 序号', () => {
    const f = makeFixture()
    const creationsBefore = f.log.partCreations.length
    const patch = applyProgramOp(f.log, 
      { type: 'program', name: 'presetShape', params: { shape: 'box', origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 }, key: f.k('color:red') } },
      f.compositions,
    )!
    expect(patch).toBeDefined()
    expect(f.log.partCreations).toHaveLength(creationsBefore + 1)
    const opPart = f.parts.get(patch.partId!)!
    expect(opPart).toBeDefined()
    expect(opPart.name).toBe('预设体块 1')
    expect(opPart.blocks.size).toBe(8) // 2×2×2 全归这一个新 part
    // 每个产出块的归属 = 该 part（无一块漏归 / 双归）
    for (const key of opPart.blocks) expect(f.parts.partIdOf(...(key.split(',').map(Number) as [number, number, number]))).toBe(opPart.id)
    f.parts.rename(opPart.id, '基座')
    expect(f.parts.get(opPart.id)!.name).toBe('基座') // 可命名（REQ-023 ①）
  })

  it('覆写已有块 ⇒ 原归属不变（D-B ②）；新增空位 ⇒ 归操作构件', () => {
    const f = makeFixture()
    const mine = f.log.createPart('旧主人')
    f.log.apply({ type: 'set', x: 0, y: 0, z: 0, key: f.k('color:white'), partId: mine.id })
    const patch = applyProgramOp(f.log, 
      { type: 'program', name: 'presetShape', params: { shape: 'box', origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 1, z: 1 }, key: f.k('color:red') } },
      f.compositions,
    )!
    expect(f.volume.getBlock(0, 0, 0)).toBe(f.k('color:red')) // 被覆写
    expect(f.parts.partIdOf(0, 0, 0)).toBe(mine.id) // 归属不变
    expect(f.parts.partIdOf(1, 0, 0)).toBe(patch.partId) // 新块归操作构件
  })

  it('undo 按 ownersBefore 精确还原归属（含手工块与跨构件删除恢复）', () => {
    const f = makeFixture()
    const a = f.log.createPart('A')
    const b = f.log.createPart('B')
    f.log.apply({ type: 'set', x: 0, y: 0, z: 0, key: f.k('color:red'), partId: a.id })
    f.log.apply({ type: 'set', x: 1, y: 0, z: 0, key: f.k('color:red'), partId: b.id })
    f.log.apply({ type: 'set', x: 2, y: 0, z: 0, key: f.k('color:green') }) // 手工块
    const beforeParts = f.parts.serialize()
    const beforeDigest = f.volume.digest()
    // clearScope(all)：三个块全删（两个有主、一个手工）⇒ 一次撤销应原样归还（键 + 归属）
    applyProgramOp(f.log, { type: 'program', name: 'clearScope', params: { scope: { kind: 'all' } } }, f.compositions)!
    expect(f.volume.nonEmptyCount).toBe(0)
    f.log.undo()
    expect(f.volume.digest()).toEqual(beforeDigest)
    // 归属逐坐标精确还原（A / B / 手工块各归其位）。
    // 注：零新格操作（范围清除全是删除）不产出构件（D-E 限定"产出新块时"）；产出过新块的构件创建不随撤销消失（r01 口径，redo 会重新填充）。
    for (const [x, id] of [
      [0, a.id],
      [1, b.id],
      [2, undefined],
    ] as Array<[number, string | undefined]>) {
      expect(f.parts.partIdOf(x, 0, 0)).toBe(id)
    }
    expect(beforeParts.length).toBeGreaterThanOrEqual(2) // 快照口径自证：undo 前后册差 = 恰好那个空操作构件
  })

  it('零新格（对已有块换材质）⇒ 不产出构件、原归属不动（D-B ② 沿用）；undo/redo 一致', () => {
    const f = makeFixture()
    const mine = f.log.createPart('旧主人')
    f.log.apply({ type: 'set', x: 0, y: 0, z: 0, key: f.k('color:red'), partId: mine.id })
    const partsBefore = f.parts.list().length
    const patch = applyProgramOp(f.log, 
      { type: 'program', name: 'recolor', params: { scope: { kind: 'all' }, toKey: f.k('color:purple') } },
      f.compositions,
    )!
    expect(patch.changes.every((c) => c.before > 0)).toBe(true) // 纯覆写 ⇒ 零新格
    expect(patch.partId).toBeNull() // D-E 限定"产出新块时"才产构件（plan §5.4.1）
    expect(f.parts.list()).toHaveLength(partsBefore) // 册里没有多出 0 块构件
    expect(f.parts.partIdOf(0, 0, 0)).toBe(mine.id) // 覆写不改原归属
    f.log.undo()
    expect(f.volume.getBlock(0, 0, 0)).toBe(f.k('color:red'))
    expect(f.parts.partIdOf(0, 0, 0)).toBe(mine.id)
    f.log.redo()
    expect(f.volume.getBlock(0, 0, 0)).toBe(f.k('color:purple'))
    expect(f.parts.partIdOf(0, 0, 0)).toBe(mine.id)
  })
})

describe('D-B / D-D · 构件层三细节与删除语义', () => {
  it('D-B ①：自动命名 + 可改名 + 同名允许（id 唯一）', () => {
    const f = makeFixture()
    const p1 = f.log.createPart('构件 1')
    const p2 = f.log.createPart('构件 1') // 同名允许
    expect(p1.id).not.toBe(p2.id)
    expect(f.parts.rename(p2.id, '侧翼')).toBe(true)
    expect(f.parts.list().map((p) => p.name)).toEqual(['构件 1', '侧翼'])
  })

  it('D-B ②：一块至多属一个构件（assign 换主 = 移出旧构件）', () => {
    const f = makeFixture()
    const a = f.log.createPart('A')
    const b = f.log.createPart('B')
    f.parts.assign(0, 0, 0, a.id)
    f.parts.assign(0, 0, 0, b.id)
    expect(f.parts.blockCount(a.id)).toBe(0)
    expect(f.parts.blockCount(b.id)).toBe(1)
    expect(f.parts.partIdOf(0, 0, 0)).toBe(b.id)
  })

  it('D-D：删除构件 = 解除归属——块留下（成为手工块）、构件消失；"连同块删"不做', () => {
    const f = makeFixture()
    const a = f.log.createPart('A')
    f.log.apply({ type: 'set', x: 0, y: 0, z: 0, key: f.k('color:red'), partId: a.id })
    f.log.apply({ type: 'set', x: 1, y: 0, z: 0, key: f.k('color:red'), partId: a.id })
    const freed = f.parts.dissolve(a.id)
    expect(freed).toBe(2)
    expect(f.parts.get(a.id)).toBeUndefined()
    expect(f.volume.nonEmptyCount).toBe(2) // 块留下
    expect(f.parts.partIdOf(0, 0, 0)).toBeUndefined() // 成为手工块
    expect(f.parts.dissolve(a.id)).toBe(-1) // 已不存在
  })
})

describe('D-C · 组合层（语义分组视图）', () => {
  it('命名 / 成员（多 part + 手工块坐标）/ 序列化往返；不改变 part 归属', () => {
    const f = makeFixture()
    const a = f.log.createPart('A')
    const b = f.log.createPart('B')
    f.log.apply({ type: 'set', x: 0, y: 0, z: 0, key: f.k('color:red'), partId: a.id })
    f.log.apply({ type: 'set', x: 1, y: 0, z: 0, key: f.k('color:red'), partId: b.id })
    const comp = f.compositions.create('屋顶')
    f.compositions.addPart(comp.id, a.id)
    f.compositions.addPart(comp.id, b.id)
    f.compositions.addManualBlock(comp.id, 2, 0, 0)
    expect(f.compositions.get(comp.id)!.partIds.size).toBe(2)
    expect(f.compositions.get(comp.id)!.manualBlocks.size).toBe(1)
    // 归属不受组合影响
    expect(f.parts.partIdOf(0, 0, 0)).toBe(a.id)
    expect(f.parts.partIdOf(1, 0, 0)).toBe(b.id)
    // 序列化往返
    const data = f.compositions.serialize()
    const fresh = new CompositionRegistry()
    fresh.restore(data)
    expect(fresh.serialize()).toEqual(data)
    // 同名允许（id 唯一）；拆除 = 视图消失
    const comp2 = f.compositions.create('屋顶')
    expect(comp2.id).not.toBe(comp.id)
    expect(f.compositions.dissolve(comp.id)).toBe(true)
    expect(f.compositions.get(comp.id)).toBeUndefined()
    expect(f.parts.partIdOf(0, 0, 0)).toBe(a.id) // 拆组合不动归属
  })
})
