// 笔刷框架（r02 前半 F7 · REQ-055）：类型定义独立成模块，不绑 UI——
// 它以后是后半程序化操作的参数面（E9 拍板：方向已定、落地待调查），这是"前半不返工"的关键约束。
// 首版只有方形笔刷；非方形形状归"以后层"（plan §1.1）。

/** 笔刷动作（Q2 拍板；命名对齐成熟编辑器的 Place / Erase / Paint，editor-management-survey §三） */
export type BrushAction = 'place' | 'erase' | 'paint'

/**
 * 放置的布尔模式（Q2 拍板）：
 * additive = 增量添加（默认，只写空气，跳过已有块）；override = 替换添加（显式开关，逐块覆盖）。
 * 擦除 / 上色没有布尔开关（擦除 = 体积内全清；上色 = 只改已有块）。
 */
export type BrushMode = 'additive' | 'override'

/** 每调用上限：单轴尺寸与单笔体积上限（教学式报错用，例：{ x: 3, y: 3, z: 3 }） */
export const BRUSH_MAX_AXIS = 8
export const BRUSH_MAX_CELLS = 512
