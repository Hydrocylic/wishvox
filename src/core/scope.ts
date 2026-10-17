import type { CompositionRegistry } from './composition'
import { coordKey } from './coords'
import type { PartRegistry } from './parts'
import type { Coord, ScopeRef } from './types'
import type { Volume } from './volume'

// 范围 / 宾语语义（REQ-014 的宾语面 · REQ-051）：ScopeRef → 坐标集合的**纯函数**。
// r03 的 AI 指令宾语（"把屋顶改红"的"屋顶"）读同一条——这是本轮给下游立的接口（plan §2 接口 2）。
// 输出恒按 (x, y, z) 字典序排序 ⇒ 与遍历顺序无关（N3）；只含**现存**块。
// 组合 = 成员 part 当前块 ∪ 仍存在的手工块坐标（语义视图：part 后来新增的块也进来，被删的手工块退场）。

function parseKey(key: string): Coord {
  const [x, y, z] = key.split(',').map(Number)
  return { x, y, z }
}

function sortCoords(coords: Coord[]): Coord[] {
  return coords.sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z)
}

export function resolveScope(
  volume: Volume,
  parts: PartRegistry,
  compositions: CompositionRegistry,
  ref: ScopeRef,
): Coord[] {
  const out: Coord[] = []
  const seen = new Set<string>()
  const push = (x: number, y: number, z: number): void => {
    const k = coordKey(x, y, z)
    if (seen.has(k)) return
    seen.add(k)
    out.push({ x, y, z })
  }

  if (ref.kind === 'all') {
    for (const b of volume.iterBlocks()) push(b.x, b.y, b.z)
  } else if (ref.kind === 'manual') {
    for (const b of volume.iterBlocks()) {
      if (parts.partIdOf(b.x, b.y, b.z) === undefined) push(b.x, b.y, b.z)
    }
  } else if (ref.kind === 'part') {
    const part = parts.get(ref.partId)
    if (part) {
      for (const key of part.blocks) {
        const c = parseKey(key)
        if (volume.getBlock(c.x, c.y, c.z) !== 0) push(c.x, c.y, c.z)
      }
    }
  } else {
    const comp = compositions.get(ref.compositionId)
    if (comp) {
      for (const partId of comp.partIds) {
        const part = parts.get(partId)
        if (!part) continue
        for (const key of part.blocks) {
          const c = parseKey(key)
          if (volume.getBlock(c.x, c.y, c.z) !== 0) push(c.x, c.y, c.z)
        }
      }
      for (const key of comp.manualBlocks) {
        const c = parseKey(key)
        if (volume.getBlock(c.x, c.y, c.z) !== 0) push(c.x, c.y, c.z)
      }
    }
  }
  return sortCoords(out)
}
