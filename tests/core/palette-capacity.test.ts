// P3（`REQ-027` 门四 · 键容量）：色板容量耗尽必须**先报错、零修改**，绝不溢出成别的颜色。
// 判据面：Palette.intern / restore 的容量边界 + 序列化导入侧的同一道闸。
import { describe, expect, it } from 'vitest'
import { Palette } from '../../src/core/palette'
import { MAX_PALETTE_KEY } from '../../src/core/color'
import { PROJECT_FORMAT } from '../../src/core/types'
import { decodeProject } from '../../src/io/serialize'

/** 填满到容量上限（键 1..65535，容许调用前已有条目）；返回最后一次分配的键 */
function fill(p: Palette): number {
  let last = 0
  for (let i = 1; !p.full; i++) last = p.intern(`color:c${i}`, {}, '#010203')
  return last
}

describe('P3 · 门四：键 0 = 空，可用键 1..65535', () => {
  it('满员后再要新键 ⇒ 抛错且**零修改**（条目数、既有键、去重索引都不变）', () => {
    const p = new Palette()
    const last = fill(p)
    expect(last).toBe(MAX_PALETTE_KEY)
    expect(p.size).toBe(MAX_PALETTE_KEY)
    expect(p.full).toBe(true)
    const snapshot = p.list()
    expect(() => p.intern('color:overflow', {}, '#ffffff')).toThrow(/容量已满/)
    expect(p.size).toBe(MAX_PALETTE_KEY)
    expect(p.list()).toEqual(snapshot) // 零修改：没有多出条目，也没有把新颜色塞进旧键
    expect(p.get(1)).toMatchObject({ key: 1 })
  })

  it('满员后**复用**既有条目仍然可用（容量只挡新键，不挡同色复用）', () => {
    const p = new Palette()
    const first = p.intern('color:white', {}, '#e8e6e3')
    fill(p)
    expect(p.intern('color:white', {}, '#e8e6e3')).toBe(first)
  })

  it('restore 拒绝超容量键与重复键（导入面同一道闸）', () => {
    const p = new Palette()
    expect(() => p.restore([{ key: MAX_PALETTE_KEY + 1, identity: 'color:x', state: {} }])).toThrow(/容量上限/)
    expect(() => p.restore([{ key: 0, identity: 'color:x', state: {} }])).toThrow(/bad key/)
    expect(() =>
      p.restore([
        { key: 1, identity: 'color:a', state: {} },
        { key: 1, identity: 'color:b', state: {} },
      ]),
    ).toThrow(/duplicate/)
  })

  it('release 只删指定键（键不重编号 ⇒ 既有键稳定性不受影响）', () => {
    const p = new Palette()
    const a = p.intern('color:a', {}, '#111111')
    const b = p.intern('color:b', {}, '#222222')
    expect(p.release(a)).toBe(true)
    expect(p.has(a)).toBe(false)
    expect(p.get(b)).toMatchObject({ key: b })
    expect(p.intern('color:c', {}, '#333333')).toBeGreaterThan(b) // nextKey 只增，不回填空号
  })

  it('导入档里的超容量调色板键 ⇒ 整档拒绝（不裁剪、不迁移）', () => {
    const file = {
      format: PROJECT_FORMAT,
      formatVersion: 2,
      appVersion: '0.0.0',
      meta: { id: 'p', title: 't', createdAt: 'c', updatedAt: 'u' },
      blockStyle: 'color',
      palette: [{ key: MAX_PALETTE_KEY + 1, identity: 'color:x', state: {}, color: '#ffffff' }],
      chunks: [],
      parts: [],
      compositions: [],
      log: { snapshotAt: 0, patches: [], partCreations: [] },
    }
    const r = decodeProject(JSON.stringify(file))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.error).toContain('REQ-027')
  })
})
