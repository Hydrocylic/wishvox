import { MAX_PALETTE_KEY } from './color'
import type { PaletteEntry } from './types'

// 键 0 保留给"空"；intern 保证同 (identity, state, color) 只占一个键 ⇒ 序列化往返逐字段相等的前提。
// `REQ-027`（门四）：键容量 = 65535（16 位体素存储）。**intern 只在真正成功写入前调用**；
// 耗尽时抛错且**零修改**（不写 entries/index、不动 nextKey）——溢出成别的颜色是本门最忌讳的形态。
// 键稳定：既有条目的键永不因排序 / 隐藏 / 删块 / 加载而重编号（nextKey 只增）。
export class Palette {
  private nextKey = 1
  private readonly entries = new Map<number, PaletteEntry>()
  private readonly index = new Map<string, number>()

  /** 键容量是否已满（新增条目会超限）——调用方据此先给可读回执，零修改退出 */
  get full(): boolean {
    return this.nextKey > MAX_PALETTE_KEY
  }

  intern(identity: string, state: Record<string, unknown>, color?: string): number {
    const id = `${identity}|${stableStringify(state)}|${color ?? ''}`
    const existing = this.index.get(id)
    if (existing !== undefined) return existing
    if (this.nextKey > MAX_PALETTE_KEY) {
      throw new Error(`palette: 颜色键容量已满（上限 ${MAX_PALETTE_KEY}，REQ-027）——本次未分配新键、色板未改动`)
    }
    const key = this.nextKey++
    const entry: PaletteEntry = { key, identity, state, color }
    this.entries.set(key, entry)
    this.index.set(id, key)
    return key
  }

  /**
   * `REQ-027`（门四）：收回**从未落账**的键（失败写入 / 取消的笔 / 被回滚的 AI 请求）。
   * 调用方必须先保证该键既无模型引用也无历史引用（见 `edit/color.ts#releaseIfUnreferenced`）；
   * 本方法只做删除，不判断引用。键不会被重编号（`nextKey` 不回退）⇒ 既有键的稳定性不受影响。
   */
  release(key: number): boolean {
    const entry = this.entries.get(key)
    if (!entry) return false
    this.entries.delete(key)
    this.index.delete(`${entry.identity}|${stableStringify(entry.state)}|${entry.color ?? ''}`)
    return true
  }

  has(key: number): boolean {
    return key === 0 || this.entries.has(key)
  }

  get(key: number): PaletteEntry | undefined {
    return this.entries.get(key)
  }

  list(): PaletteEntry[] {
    return [...this.entries.values()].sort((a, b) => a.key - b.key)
  }

  get size(): number {
    return this.entries.size
  }

  reset(): void {
    this.nextKey = 1
    this.entries.clear()
    this.index.clear()
  }

  restore(entries: PaletteEntry[]): void {
    this.reset()
    for (const e of entries) {
      if (!Number.isInteger(e.key) || e.key <= 0) throw new Error(`palette: bad key ${e.key}`)
      if (e.key > MAX_PALETTE_KEY) throw new Error(`palette: 键 ${e.key} 超出容量上限 ${MAX_PALETTE_KEY}（REQ-027）`)
      if (this.entries.has(e.key)) throw new Error(`palette: duplicate key ${e.key}`)
      this.entries.set(e.key, e)
      this.index.set(`${e.identity}|${stableStringify(e.state)}|${e.color ?? ''}`, e.key)
      if (e.key >= this.nextKey) this.nextKey = e.key + 1
    }
  }
}

// 键排序的稳定序列化：state 的键序不影响 intern 结果 ⇒ 往返不臆造新条目
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(',')}}`
}
