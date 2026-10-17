import {
  CHUNK_VOLUME,
  COORD_LIMIT,
  chunkInDomain,
  chunkKey,
  chunkOf,
  compareChunkCoord,
  coordKey,
  decodeLocalIndex,
  isCoordTripleDomain,
  localIndex,
  localOf,
} from './coords'
import type { ChunkCoord } from './coords'
import { Palette } from './palette'
import type { PaletteEntry } from './types'

export type { ChunkCoord }

class Chunk {
  readonly data = new Uint16Array(CHUNK_VOLUME)
  nonEmpty = 0
  constructor(readonly cx: number, readonly cy: number, readonly cz: number) {}
}

interface ModelDigest {
  nonEmpty: number
  coordHash: string
}

// 稀疏体素模型：非空 chunk 才驻留；块 = 调色板键（0 = 空）。
// 本类不做补丁记账（那是 PatchLog 的职责）——setBlock 是唯一的低层写入口。
// `REQ-065`：本类的三个坐标入口（getBlock / setBlock / loadChunkData）都先过 `chunkInDomain`
// ——判定必须挡在 `>>4`/`&15` 之前，否则小数被截断进邻居格、NaN 折叠进 0 号 chunk、越界静默改格。
export class Volume {
  readonly palette = new Palette()
  private readonly chunks = new Map<string, Chunk>()
  private total = 0

  get chunkCount(): number {
    return this.chunks.size
  }

  get nonEmptyCount(): number {
    return this.total
  }

  getChunk(cx: number, cy: number, cz: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cy, cz))
  }

  getBlock(x: number, y: number, z: number): number {
    // `REQ-065`：读侧同判——否则 `getBlock(0.5, …)` 会读到邻居格，让"拒绝"看上去像"该格本来就是空的"
    if (!isCoordTripleDomain(x, y, z)) return 0
    const chunk = this.chunks.get(chunkKey(x >> 4, y >> 4, z >> 4))
    if (!chunk) return 0
    return chunk.data[localIndex(x & 15, y & 15, z & 15)]
  }

  getEntry(x: number, y: number, z: number): PaletteEntry | undefined {
    return this.palette.get(this.getBlock(x, y, z))
  }

  /**
   * 低层写。返回是否有实际变化；键不存在则抛错（replay/导入的调色板缺项属于程序错误）。
   * `REQ-065`：坐标不合法 ⇒ **抛错且零改动**（调用方必须先判定并给可读回执，见 `core/coords#isCoordDomain`）；
   * 抛错而不是静默忽略，是为了让"上游漏判"立刻暴露，而不是变成一处看不见的数据错位。
   */
  setBlock(x: number, y: number, z: number, key: number): boolean {
    if (!isCoordTripleDomain(x, y, z)) {
      throw new Error(`volume: 坐标非法（须为 ±${COORD_LIMIT} 内的整数，REQ-065）：(${String(x)}, ${String(y)}, ${String(z)})`)
    }
    if (key !== 0 && !this.palette.has(key)) throw new Error(`volume: unknown palette key ${key}`)
    const cx = x >> 4
    const cy = y >> 4
    const cz = z >> 4
    const idx = localIndex(x & 15, y & 15, z & 15)
    const ck = chunkKey(cx, cy, cz)
    let chunk = this.chunks.get(ck)
    if (!chunk) {
      if (key === 0) return false
      chunk = new Chunk(cx, cy, cz)
      this.chunks.set(ck, chunk)
    }
    const before = chunk.data[idx]
    if (before === key) return false
    chunk.data[idx] = key
    if (key === 0) {
      chunk.nonEmpty -= 1
      if (chunk.nonEmpty === 0) this.chunks.delete(ck) // 空 chunk 回收（I1 计数断言）
      this.total -= 1
    } else if (before === 0) {
      chunk.nonEmpty += 1
      this.total += 1
    }
    // before>0 且 key>0：替换（改色）——块数不变
    return true
  }

  *iterBlocks(): Generator<{ x: number; y: number; z: number; key: number }> {
    const ordered = [...this.chunks.values()].sort(compareChunkCoord)
    for (const chunk of ordered) {
      for (let idx = 0; idx < CHUNK_VOLUME; idx++) {
        const key = chunk.data[idx]
        if (key === 0) continue
        const { lx, ly, lz } = decodeLocalIndex(idx)
        yield { x: chunk.cx * 16 + lx, y: chunk.cy * 16 + ly, z: chunk.cz * 16 + lz, key }
      }
    }
  }

  /**
   * I9 的分母（由模型层给出）：单块改动的"受影响 chunk" =
   * 该块所在 chunk + 跨 chunk 边界时**面相邻**的 chunk，取其中**改动后仍驻留**（有实例数据要建）的。
   * 渲染层的重建数必须恰好等于它——含跨边界邻域规则，为 P5 的隐藏面剔除预留。
   */
  affectedResidentChunks(x: number, y: number, z: number): ChunkCoord[] {
    const { cx, cy, cz } = chunkOf(x, y, z)
    const { lx, ly, lz } = localOf(x, y, z)
    const result: ChunkCoord[] = []
    const pushIfResident = (ncx: number, ncy: number, ncz: number): void => {
      if (this.chunks.has(chunkKey(ncx, ncy, ncz))) result.push({ cx: ncx, cy: ncy, cz: ncz })
    }
    if (this.chunks.has(chunkKey(cx, cy, cz))) result.push({ cx, cy, cz })
    if (lx === 0) pushIfResident(cx - 1, cy, cz)
    else if (lx === 15) pushIfResident(cx + 1, cy, cz)
    if (ly === 0) pushIfResident(cx, cy - 1, cz)
    else if (ly === 15) pushIfResident(cx, cy + 1, cz)
    if (lz === 0) pushIfResident(cx, cy, cz - 1)
    else if (lz === 15) pushIfResident(cx, cy, cz + 1)
    return result
  }

  /** 模型摘要（N1/N2 共用口径）：块数 + 坐标-键哈希（chunk 与下标都排序 ⇒ 与写入顺序无关） */
  digest(): ModelDigest {
    let h = 0x811c9dc5
    const mixInt = (v: number): void => {
      const u = v >>> 0
      for (let s = 0; s < 4; s++) {
        h ^= (u >>> (s * 8)) & 0xff
        h = Math.imul(h, 0x01000193) >>> 0
      }
    }
    for (const b of this.iterBlocks()) {
      mixInt(b.x)
      mixInt(b.y)
      mixInt(b.z)
      mixInt(b.key)
    }
    return { nonEmpty: this.total, coordHash: h.toString(16).padStart(8, '0') }
  }

  /** 与 iterBlocks 同序的坐标键列表（测试比对用） */
  blockCoordKeys(): string[] {
    const keys: string[] = []
    for (const b of this.iterBlocks()) keys.push(coordKey(b.x, b.y, b.z))
    return keys
  }

  /**
   * 模型中**实际用到**的方块身份（去重、排序）——REQ-022 缺项清单的口径（T13 收窄）：
   * 未使用的调色板身份不计，否则"内置 16 − 映射 12 = 恒显 4 条红牌"会把常态当缺项。
   */
  usedIdentities(): string[] {
    const used = new Set<string>()
    for (const b of this.iterBlocks()) {
      const entry = this.palette.get(b.key)
      if (entry) used.add(entry.identity)
    }
    return [...used].sort()
  }

  reset(): void {
    this.chunks.clear()
    this.total = 0
    this.palette.reset()
  }

  /** 有序（按 chunk 坐标）遍历驻留 chunk —— 快照与序列化共用 */
  *iterChunks(): Generator<Chunk> {
    const ordered = [...this.chunks.values()].sort(compareChunkCoord)
    for (const chunk of ordered) yield chunk
  }

  /** 从快照数据恢复（palette 须已 restore 且键校验已过）。
   *  `REQ-065`：chunk 坐标越界 ⇒ 抛错（不建半个 chunk）；导入侧由 `io/serialize` 先整档判定后拒绝。 */
  loadChunkData(list: ReadonlyArray<{ cx: number; cy: number; cz: number; data: ArrayLike<number> }>): void {
    for (const item of list) {
      if (!chunkInDomain(item.cx, item.cy, item.cz)) {
        throw new Error(`volume: chunk 坐标越界（REQ-065）：(${String(item.cx)}, ${String(item.cy)}, ${String(item.cz)})`)
      }
      const chunk = new Chunk(item.cx, item.cy, item.cz)
      let n = 0
      for (let i = 0; i < CHUNK_VOLUME; i++) {
        const key = item.data[i]
        if (key !== 0) {
          chunk.data[i] = key
          n++
        }
      }
      if (n > 0) {
        chunk.nonEmpty = n
        this.total += n
        this.chunks.set(chunkKey(item.cx, item.cy, item.cz), chunk)
      }
    }
  }
}
