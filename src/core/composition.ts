import { coordKey } from './coords'
import type { CompositionData } from './types'

// 组合层（REQ-051 / D6-ADR-12 / D-C）：语义分组 = 成员 part 引用 ∪ 手工块坐标。
// 它是**视图**：不改变 part 归属、不"拥有"块；首版不嵌套（组合不含组合）。
// 解析（成员 part 当前块 ∪ 仍存在的手工块）在 core/scope.ts 的 resolveScope——纯查询，不在本表里。
interface Composition {
  readonly id: string
  name: string
  readonly partIds: Set<string>
  /** 手工块坐标（coordKey）——组合自己记坐标，不经过 part 层 */
  readonly manualBlocks: Set<string>
}

export class CompositionRegistry {
  private readonly items = new Map<string, Composition>()
  private nextId = 1

  create(name: string): Composition {
    const id = `comp-${this.nextId++}`
    const comp: Composition = { id, name, partIds: new Set(), manualBlocks: new Set() }
    this.items.set(id, comp)
    return comp
  }

  get(id: string): Composition | undefined {
    return this.items.get(id)
  }

  list(): Composition[] {
    return [...this.items.values()]
  }

  rename(id: string, name: string): boolean {
    const comp = this.items.get(id)
    if (!comp) return false
    comp.name = name
    return true
  }

  addPart(id: string, partId: string): boolean {
    const comp = this.items.get(id)
    if (!comp) return false
    comp.partIds.add(partId)
    return true
  }

  removePart(id: string, partId: string): boolean {
    const comp = this.items.get(id)
    if (!comp) return false
    return comp.partIds.delete(partId)
  }

  addManualBlock(id: string, x: number, y: number, z: number): boolean {
    const comp = this.items.get(id)
    if (!comp) return false
    comp.manualBlocks.add(coordKey(x, y, z))
    return true
  }

  removeManualBlock(id: string, x: number, y: number, z: number): boolean {
    const comp = this.items.get(id)
    if (!comp) return false
    return comp.manualBlocks.delete(coordKey(x, y, z))
  }

  /** 拆除组合（视图消失；part 归属与块不变——与"删除构件 = 解除归属"同一家族的文案口径） */
  dissolve(id: string): boolean {
    return this.items.delete(id)
  }

  clear(): void {
    this.items.clear()
    this.nextId = 1
  }

  serialize(): CompositionData[] {
    return this.list().map((c) => ({
      id: c.id,
      name: c.name,
      partIds: [...c.partIds],
      blocks: [...c.manualBlocks].map((s): [number, number, number] => {
        const [x, y, z] = s.split(',').map(Number)
        return [x, y, z]
      }),
    }))
  }

  restore(data: CompositionData[]): void {
    this.clear()
    for (const c of data) {
      if (this.items.has(c.id)) throw new Error(`compositions: duplicate id ${c.id}`)
      const comp: Composition = { id: c.id, name: c.name, partIds: new Set(c.partIds), manualBlocks: new Set() }
      this.items.set(c.id, comp)
      const n = Number(c.id.slice('comp-'.length))
      if (Number.isInteger(n) && n >= this.nextId) this.nextId = n + 1
    }
    for (const c of data) {
      for (const [x, y, z] of c.blocks) this.addManualBlock(c.id, x, y, z)
    }
  }
}
