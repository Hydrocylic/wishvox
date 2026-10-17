import { coordKey } from './coords'

// 构件层（REQ-023 最小面）：命名 + 归属 + createdAtPatch（"回退到某构件"的锚点）。
// 一个块至多属于一个构件；归属随项目文件走（I3 的"含构件归属"）。
export interface Part {
  readonly id: string
  name: string
  readonly createdAtPatch: number
  readonly blocks: Set<string>
}

export interface PartData {
  id: string
  name: string
  createdAtPatch: number
  blocks: Array<[number, number, number]>
}

export class PartRegistry {
  private readonly parts = new Map<string, Part>()
  private readonly owner = new Map<string, string>() // coordKey → partId
  private nextId = 1

  create(name: string, createdAtPatch: number): Part {
    const id = `part-${this.nextId++}`
    const part: Part = { id, name, createdAtPatch, blocks: new Set() }
    this.parts.set(id, part)
    return part
  }

  get(id: string): Part | undefined {
    return this.parts.get(id)
  }

  /** D3（debug-261004）：按原 id 复活已 dissolve 的构件（undo 剪掉 ⇒ redo 还原用）——
   *  不重建归属；块由调用方重放补丁归位。id 与现存冲突 = 程序错误。 */
  revive(id: string, name: string, createdAtPatch: number): Part {
    if (this.parts.has(id)) throw new Error(`parts: revive id 已存在 ${id}`)
    const part: Part = { id, name, createdAtPatch, blocks: new Set() }
    this.parts.set(id, part)
    const n = Number(id.slice('part-'.length))
    if (Number.isInteger(n) && n >= this.nextId) this.nextId = n + 1
    return part
  }

  list(): Part[] {
    return [...this.parts.values()]
  }

  rename(id: string, name: string): boolean {
    const part = this.parts.get(id)
    if (!part) return false
    part.name = name
    return true
  }

  /** 归属变更：从旧构件移除、加入新构件 */
  assign(x: number, y: number, z: number, partId: string): void {
    const key = coordKey(x, y, z)
    const prev = this.owner.get(key)
    if (prev === partId) return
    if (prev !== undefined) this.parts.get(prev)?.blocks.delete(key)
    const part = this.parts.get(partId)
    if (!part) throw new Error(`parts: unknown part ${partId}`)
    part.blocks.add(key)
    this.owner.set(key, partId)
  }

  unassign(x: number, y: number, z: number): void {
    const key = coordKey(x, y, z)
    const prev = this.owner.get(key)
    if (prev === undefined) return
    this.parts.get(prev)?.blocks.delete(key)
    this.owner.delete(key)
  }

  partIdOf(x: number, y: number, z: number): string | undefined {
    return this.owner.get(coordKey(x, y, z))
  }

  /** D-D（r02）：删除构件 = **解除归属**——构件记录消失，其块留在模型里成为手工块；
   *  "连同块一起删"本轮不做（记账在轮次 plan）。返回被解除归属的坐标数。 */
  dissolve(id: string): number {
    const part = this.parts.get(id)
    if (!part) return -1
    for (const key of part.blocks) this.owner.delete(key)
    const freed = part.blocks.size
    part.blocks.clear()
    this.parts.delete(id)
    return freed
  }

  blockCount(id: string): number {
    return this.parts.get(id)?.blocks.size ?? 0
  }

  clear(): void {
    this.parts.clear()
    this.owner.clear()
    this.nextId = 1
  }

  serialize(): PartData[] {
    return this.list().map((p) => ({
      id: p.id,
      name: p.name,
      createdAtPatch: p.createdAtPatch,
      blocks: [...p.blocks].map((s): [number, number, number] => {
        const [x, y, z] = s.split(',').map(Number)
        return [x, y, z]
      }),
    }))
  }

  restore(data: PartData[]): void {
    this.clear()
    for (const p of data) {
      if (this.parts.has(p.id)) throw new Error(`parts: duplicate id ${p.id}`)
      const part: Part = { id: p.id, name: p.name, createdAtPatch: p.createdAtPatch, blocks: new Set() }
      this.parts.set(p.id, part)
      const n = Number(p.id.slice('part-'.length))
      if (Number.isInteger(n) && n >= this.nextId) this.nextId = n + 1
    }
    for (const p of data) {
      for (const [x, y, z] of p.blocks) {
        this.assign(x, y, z, p.id)
      }
    }
  }
}
