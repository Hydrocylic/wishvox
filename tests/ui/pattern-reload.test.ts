import { beforeEach, expect, it } from 'vitest'
import { acceptPatternFile } from '../../src/ui/pattern-import-actions'
import { DEFAULT_PATTERN_OPTIONS, resetPatternDraft, setPatternOptions, usePatternStore } from '../../src/state/pattern-store'
import { sampleGrid } from '../../src/io/pattern/sample'

const rgba = { width: 20, height: 20, data: new Uint8ClampedArray(20 * 20 * 4).fill(255) }
const loaded = { rgba, previewDataUrl: '', visionDataUrl: '' }
const file = (name: string): File => ({ name }) as File
beforeEach(() => { resetPatternDraft(); setPatternOptions({ ...DEFAULT_PATTERN_OPTIONS, manualCols: 2, manualRows: 2 }) })

it('B3 换图成功：chart-01 ready → chart-02 loading 清旧网格 → ready 新网格', async () => {
  await acceptPatternFile(file('chart-01'), async () => loaded)
  expect(usePatternStore.getState().status).toBe('ready')
  const pending = acceptPatternFile(file('chart-02'), async () => loaded)
  expect(usePatternStore.getState().grid).toBeNull()
  expect(usePatternStore.getState().status).toBe('loading')
  await pending
  expect(usePatternStore.getState().status).toBe('ready')
  expect(usePatternStore.getState().grid?.cells).toHaveLength(4)
  expect(usePatternStore.getState().imageName).toBe('chart-02')
})
it('B3 换图失败：解码或识别失败清旧网格，保留错误且不滞留 loading/recognizing', async () => {
  await acceptPatternFile(file('chart-01'), async () => loaded)
  await acceptPatternFile(file('chart-02'), async () => { throw new Error('decode failed') })
  expect(usePatternStore.getState()).toMatchObject({ status: 'error', grid: null, message: '图片解码失败：decode failed' })
  setPatternOptions({ cropLeft: 10 })
  await acceptPatternFile(file('chart-02'), async () => loaded)
  expect(usePatternStore.getState()).toMatchObject({ status: 'error', grid: null })
  expect(usePatternStore.getState().message).toContain('本地识别失败')
})
it('B4 纯白格默认保留；显式置空报告来源与警告（含图例路径）', () => {
  const geometry = { cols: 2, rows: 2, left: 0, top: 0, cellW: 10, cellH: 10, confidence: 1, source: 'manual' as const }
  for (const palette of [undefined, ['#ffffff', '#ff0000', '#00ff00', '#0000ff']]) {
    const keep = sampleGrid(rgba, geometry, { background: { r: 255, g: 255, b: 255 }, palette })
    expect(keep.grid.cells).toEqual(Array(4).fill('#ffffff'))
    const empty = sampleGrid(rgba, geometry, { background: null, backgroundToEmpty: true, palette })
    expect(empty.emptySources).toEqual({ unsampled: 0, paperWhite: 4, backgroundMatch: 0 })
    expect(empty.warnings).toContain('4 格按背景置空（白色豆请关闭）')
  }
})
