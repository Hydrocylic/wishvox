// 可复现伪随机（I4 的唯一随机源）：mulberry32——整数种子、无 Date / Math.random、
// 跨进程跨实例同序列（r01 的 tests/patch-log.test.ts 用过同一算法，这里立为产品内正本）。
type Rng = () => number

export function createRng(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** [0, n) 均匀整数（供"keys 里按种子选一"一类消费） */
export function rngInt(rng: Rng, n: number): number {
  return Math.min(n - 1, Math.floor(rng() * n))
}
