// 笔刷框架模块（F7）：类型 / 单一谓词 / 体积 / 应用——全部纯函数、不依赖 three 与 DOM，
// 是 UI（Viewport / BrushPanel）与后半程序化操作（r02 后半 · 参数面待调查）共用的唯一出处。
export type { BrushAction, BrushMode } from './types'
export { BRUSH_MAX_AXIS, BRUSH_MAX_CELLS } from './types'
export type { CellWriteQuery, LayerFilter } from './predicate'
export { canWriteCell, isLayerVisible, writeKeyFor } from './predicate'
export { brushVolume, validateBrushSize } from './volume'
export type { BrushRejections } from './apply'
export { applyBrush } from './apply'
