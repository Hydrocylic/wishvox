// 坐标与 chunk 布局：16³ 稀疏 chunk；调色板键 0 = 空（一处约定，两处收益：置空即无残留 + 文件不写空 chunk）。
export const CHUNK_SIZE = 16
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE // 4096

// ── 坐标合法性（`REQ-065` 的唯一判定点）──
//
// 契约（用户 2026-10-13 裁定「数域取小值」；正式条文 `REQ-065`，取代 `REQ-059`/`D6-ADR-20` 的 y≥0 部分）：
// 三轴格坐标 = **整数且 |coord| ≤ 2¹²**；非有限值 / 非整数 / 越界**一律拒绝**，**不位运算截断、不写到另一格**；
// 手动 / AI / 导入 / 重放**共用同一判定**（就是本文件的 `isCoordDomain`，导入面另有 `chunkInDomain`）。
//
// 为什么必须挡在位运算之前：`chunkOf`/`localOf`/`localIndex` 走 32 位位运算，`0.5 >> 4 = 0`、`0.5 & 15 = 0`、
// `NaN >> 4 = 0` ⇒ 小数被截断进邻居格、非有限值折叠进 0 号 chunk、越界静默改格。这三个函数因此只保证
// "**输入已过判定**时的 chunk/局部下标换算"（与渲染层 instanceId 解码互为逆运算），判定责任在本节。
export const COORD_LIMIT = 4096 // 2¹²

/** `REQ-065` 合法格坐标：有限、整数、`|v| ≤ COORD_LIMIT`（三轴同界） */
export function isCoordDomain(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && Math.abs(v) <= COORD_LIMIT
}

/** 三轴一并判定（`REQ-065` 的"一个坐标"就是三元组） */
export function isCoordTripleDomain(x: unknown, y: unknown, z: unknown): x is number {
  return isCoordDomain(x) && isCoordDomain(y) && isCoordDomain(z)
}

/**
 * 该 chunk 的 16³ 格位能否全部落在合法域内（导入/恢复前的整块判定）。
 * 判据 = 本块**最小/最大**世界坐标（`c*16` / `c*16+15`）都在域内（中间值必在域内）；
 * 三轴整数性一并查（小数 chunk 坐标在 `>>4` 下同样会静默改格）。
 */
export function chunkInDomain(cx: number, cy: number, cz: number): boolean {
  for (const c of [cx, cy, cz]) {
    if (!Number.isInteger(c)) return false
    if (!isCoordDomain(c * CHUNK_SIZE) || !isCoordDomain(c * CHUNK_SIZE + CHUNK_SIZE - 1)) return false
  }
  return true
}

export interface ChunkCoord {
  readonly cx: number
  readonly cy: number
  readonly cz: number
}

interface LocalCoord {
  readonly lx: number
  readonly ly: number
  readonly lz: number
}

export function chunkOf(x: number, y: number, z: number): ChunkCoord {
  return { cx: x >> 4, cy: y >> 4, cz: z >> 4 }
}

export function localOf(x: number, y: number, z: number): LocalCoord {
  return { lx: x & 15, ly: y & 15, lz: z & 15 }
}

// 局部下标编码 lx | ly<<4 | lz<<8 —— 与渲染层 instanceId→cell 的解码互为逆运算。
export function localIndex(lx: number, ly: number, lz: number): number {
  return (lx & 15) | ((ly & 15) << 4) | ((lz & 15) << 8)
}

export function decodeLocalIndex(idx: number): LocalCoord {
  return { lx: idx & 15, ly: (idx >> 4) & 15, lz: (idx >> 8) & 15 }
}

export function chunkKey(cx: number, cy: number, cz: number): string {
  return `${cx},${cy},${cz}`
}

export function coordKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`
}

export function compareChunkCoord(a: ChunkCoord, b: ChunkCoord): number {
  return a.cx - b.cx || a.cy - b.cy || a.cz - b.cz
}
