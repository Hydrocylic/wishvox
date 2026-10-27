// 图纸异步导入：清旧草稿、串号隔离迟到结果、失败回到可重试状态。
import { loadPatternImage, recognizePattern } from '../io/pattern'
import type { RgbaImage } from '../io/pattern/types'
import { patchPattern, resetPatternDraft, usePatternStore } from '../state/pattern-store'
import type { PatternOptions } from '../state/pattern-store'

export function recognizeLocal(rgba: RgbaImage, options: PatternOptions): void {
  patchPattern({ grid: null, status: 'recognizing', palette: [], warnings: [], emptyCells: 0, geometry: null, recognizedBy: null })
  try {
    const result = recognizePattern(rgba, {
      ...options,
      crop: { left: options.cropLeft, top: options.cropTop, right: options.cropRight, bottom: options.cropBottom },
      ...(options.manualCols !== null && options.manualRows !== null ? { manual: { cols: options.manualCols, rows: options.manualRows } } : {}),
    })
    if (!result.ok) throw new Error(result.reason)
    patchPattern({
      status: 'ready', grid: result.grid, geometry: result.geometry, palette: result.palette,
      warnings: result.warnings, emptyCells: result.emptyCells, recognizedBy: 'local',
      message: `本地识别：${result.grid.cols}×${result.grid.rows}（把握 ${Math.round(result.geometry.confidence * 100)}%）`,
    })
  } catch (e) {
    patchPattern({ status: 'error', grid: null, message: `本地识别失败：${String(e instanceof Error ? e.message : e)}` })
  }
}

let request = 0
export async function acceptPatternFile(file: File, decode = loadPatternImage): Promise<void> {
  const id = ++request
  resetPatternDraft()
  patchPattern({ status: 'loading', imageName: file.name, message: `解码「${file.name}」…` })
  try {
    const loaded = await decode(file)
    if (id !== request) return
    patchPattern({ rgba: loaded.rgba, previewDataUrl: loaded.previewDataUrl, imageWidth: loaded.rgba.width, imageHeight: loaded.rgba.height })
    recognizeLocal(loaded.rgba, usePatternStore.getState().options)
  } catch (e) {
    if (id !== request) return
    patchPattern({ status: 'error', grid: null, message: `图片解码失败：${String(e instanceof Error ? e.message : e)}` })
  }
}
