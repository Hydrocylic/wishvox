// P3（`REQ-027` · B-02 / B-08）：颜色输入解析与规范化的判据面。
// 本文件只测 core/color.ts 的纯函数——"拒绝而不猜"与"等价输入归一"是这一层的两条硬判据。
import { describe, expect, it } from 'vitest'
import { adjustColor, canonicalHex, hexToRgb, hsvToRgb, MAX_PALETTE_KEY, parseColorInput, parseHexInput, parseRgbInput, rgbToHex, rgbToHsv } from '../../src/core/color'

describe('P3 · B-02 等价色值归一（大小写 / 三位写法 / rgb() 都归一到 §rrggbb）', () => {
  it('大小写与 # 前缀不影响结果', () => {
    for (const v of ['#3B6EA5', '#3b6ea5', '3B6EA5', '3b6ea5', '  #3b6ea5  ']) {
      expect(canonicalHex(v), v).toBe('#3b6ea5')
    }
  })

  it('三位缩写展开成六位（等价写法，不是"另一个颜色"）', () => {
    expect(canonicalHex('#39f')).toBe('#3399ff')
    expect(canonicalHex('ABC')).toBe('#aabbcc')
    expect(parseHexInput('#39f')).toEqual({ ok: true, hex: '#3399ff' })
  })

  it('rgb() 与 HEX 等价输入收敛到同一规范值（同色不产生重复色项的前提）', () => {
    const a = parseColorInput('#3b6ea5')
    const b = parseColorInput('rgb(59, 110, 165)')
    const c = parseRgbInput(59, 110, 165)
    expect(a).toEqual({ ok: true, hex: '#3b6ea5' })
    expect(b).toEqual(a)
    expect(c).toEqual(a)
  })

  it('RGB ↔ HEX 往返逐通道相等', () => {
    expect(rgbToHex({ r: 255, g: 0, b: 16 })).toBe('#ff0010')
    expect(hexToRgb('#ff0010')).toEqual({ r: 255, g: 0, b: 16 })
  })
})

describe('P3 · B-08 非法输入：拒绝并给原因，绝不悄悄变成另一个颜色', () => {
  it('非 HEX / 位数不对 ⇒ 拒绝并说明位数', () => {
    expect(parseHexInput('#12345').ok).toBe(false)
    expect(parseHexInput('#12345')).toMatchObject({ ok: false })
    expect((parseHexInput('#gggggg') as { reason: string }).reason).toContain('HEX')
    expect(canonicalHex('')).toBeNull()
    expect(canonicalHex('#12')).toBeNull()
    expect(canonicalHex('not-a-color')).toBeNull()
  })

  it('带透明度（4 / 8 位、rgba）⇒ 明确拒绝，不退化成不透明色', () => {
    for (const v of ['#abcd', '#aabbccdd', 'rgba(1, 2, 3, 0.5)']) {
      const r = parseColorInput(v)
      expect(r.ok, v).toBe(false)
      expect((r as { reason: string }).reason).toContain('透明')
    }
    expect(canonicalHex('#abcd')).toBeNull()
    expect(canonicalHex('#aabbccdd')).toBeNull()
  })

  it('通道越界 / 小数 / 非数 ⇒ 逐条拒绝（保留上次有效色由调用方负责）', () => {
    expect(parseRgbInput(256, 0, 0)).toMatchObject({ ok: false })
    expect(parseRgbInput(-1, 0, 0)).toMatchObject({ ok: false })
    expect(parseRgbInput(1.5, 0, 0)).toMatchObject({ ok: false })
    expect(parseRgbInput(Number.NaN, 0, 0)).toMatchObject({ ok: false })
    expect(parseRgbInput(0, 0, 255)).toEqual({ ok: true, hex: '#0000ff' })
    expect((parseRgbInput(1.5, 0, 0) as { reason: string }).reason).toContain('整数')
    expect((parseRgbInput(300, 0, 0) as { reason: string }).reason).toContain('0..255')
  })

  it('色值域常量 = 16 位存储上限（门四容量判据的另一半）', () => {
    expect(MAX_PALETTE_KEY).toBe(65535)
  })
})

describe('P3 · 取色器色面用到的 HSV 往返', () => {
  it('纯色与灰色往返稳定（色相在灰色下无意义，由调用方保留）', () => {
    expect(hsvToRgb(rgbToHsv({ r: 255, g: 0, b: 0 }))).toEqual({ r: 255, g: 0, b: 0 })
    expect(rgbToHsv({ r: 128, g: 128, b: 128 })).toEqual({ h: 0, s: 0, v: 128 / 255 })
    expect(rgbToHsv({ r: 0, g: 0, b: 255 }).h).toBe(240)
  })
})

describe('高亮提亮用 adjustColor（2026-10-17 自 texture-source 移入 core/color）', () => {
  it('提亮 ≠ 基色，输出规范小写 hex', () => {
    const lifted = adjustColor('#3b6ea5', 1.15, 0.35)
    expect(lifted).toMatch(/^#[0-9a-f]{6}$/)
    expect(lifted).not.toBe('#3b6ea5')
  })

  it('灰色只加亮度（无色相可用）', () => {
    const lifted = adjustColor('#808080', 1, 0.1)
    const rgb = hexToRgb(lifted)!
    expect(rgb.r).toBe(rgb.g)
    expect(rgb.g).toBe(rgb.b)
    expect(rgb.r).toBeGreaterThan(128)
  })

  it('非法 hex ⇒ 原样返回（不猜颜色、不崩溃）', () => {
    expect(adjustColor('not-a-color', 1.15, 0.35)).toBe('not-a-color')
    expect(adjustColor('', 1, 1)).toBe('')
  })

  it('确定性：同输入同输出', () => {
    expect(adjustColor('#c0392b', 1.15, 0.35)).toBe(adjustColor('#c0392b', 1.15, 0.35))
  })
})
