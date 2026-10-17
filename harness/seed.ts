// harness 种子生成器（plan §7 ② 第 1 条）：产出**恰好**目标块数的确定性场景，
// 并把实际非空块数打印在页面上——"标注的 S* = 实际的 S*"，不等即采集作废。
import { internBuiltin } from '../src/core/builtin-palette'
import type { Volume } from '../src/core/volume'

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** PD1 样例小屋（≈16³ 包围盒内一座可辨认房子：地板 / 墙 / 门窗洞 / 人字顶 / 烟囱）。返回放置块数。 */
export function buildHouse(volume: Volume, ox: number, oy: number, oz: number): number {
  const keys = internBuiltin(volume.palette)
  const floorKey = keys.get('color:brown')!
  const wallKey = keys.get('color:red-brick')!
  const roofKey = keys.get('color:dark-gray')!
  const glassKey = keys.get('color:light-gray')!
  const W = 13 // x
  const D = 11 // z
  let placed = 0
  const put = (x: number, y: number, z: number, key: number): void => {
    if (volume.setBlock(x, y, z, key)) placed++
  }
  // 地板
  for (let x = 0; x < W; x++) {
    for (let z = 0; z < D; z++) put(ox + x, oy, oz + z, floorKey)
  }
  // 墙（y=1..4，周界）；门（x 中点，z=0，高 2）；窗（两侧 x=2/W-3，y=2..3，z=0）
  const doorX = Math.floor(W / 2)
  for (let y = 1; y <= 4; y++) {
    for (let x = 0; x < W; x++) {
      for (const z of [0, D - 1]) {
        const isDoor = z === 0 && x === doorX && y <= 2
        if (isDoor) continue
        const isWindow = z === 0 && (x === 2 || x === W - 3) && (y === 2 || y === 3)
        put(ox + x, oy + y, oz + z, isWindow ? glassKey : wallKey)
      }
    }
    for (let z = 1; z < D - 1; z++) {
      put(ox, oy + y, oz + z, wallKey)
      put(ox + W - 1, oy + y, oz + z, wallKey)
    }
  }
  // 人字顶（沿 z 方向收分，实心板）
  let inset = 0
  for (let y = 5; inset <= Math.floor(D / 2); y++, inset++) {
    for (let z = inset; z <= D - 1 - inset; z++) {
      for (let x = -1; x <= W; x++) put(ox + x, oy + y, oz + z, roofKey)
    }
  }
  // 烟囱
  for (let y = 5; y <= 10; y++) put(ox + W - 3, oy + y, oz + 2, roofKey)
  return placed
}

/**
 * `S*` 场景（plan §7 ② 第 1 条）：房子群 + 确定性填充，**恰好** target 个非空块。
 * 返回实际块数（调用方必须核对 === target，不等即作废）。
 */
export function buildSStarVolume(volume: Volume, target = 20000): number {
  const rng = mulberry32(20260930)
  const keys = internBuiltin(volume.palette)
  // 房子群：5×4 间，间距 24（x）/ 22（z），坐落在 [0..~130) 区域
  let houses = 0
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 4; j++) {
      houses += buildHouse(volume, i * 24, 0, j * 22)
    }
  }
  // 确定性填充到恰好 target：候选格 = 广场带（z 偏移到房子群后方），洗牌后逐个放
  const fillKey = keys.get('color:light-gray')!
  const candidates: Array<[number, number, number]> = []
  for (let x = -60; x < 200; x++) {
    for (let z = 90; z < 150; z++) {
      candidates.push([x, 0, z])
    }
  }
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = candidates[i]!
    candidates[i] = candidates[j]!
    candidates[j] = tmp
  }
  let index = 0
  while (volume.nonEmptyCount < target && index < candidates.length) {
    const [x, y, z] = candidates[index++]!
    volume.setBlock(x, y, z, fillKey)
  }
  return volume.nonEmptyCount
}
