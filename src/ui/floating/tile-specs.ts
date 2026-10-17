// `D1`（design §7.2 · 2026-10-16）：九个悬浮方块的**静态表**——ID、标题、图标、首屏展开态的唯一出处。
// 这里是"仅结构"的文件：不含几何（几何在 tile-layout.ts）、不含业务（业务在各自面板的 `*Content`）。
// 为什么把 ID 单独定义：`TileId` 被布局、外壳、装配三处引用，放在外壳里会形成"外壳 ↔ 布局"互相 import。
export type TileId = 'tools' | 'ai' | 'parts' | 'ops' | 'noise' | 'history' | 'style' | 'camera' | 'layers'

export interface TileSpec {
  readonly id: TileId
  /** 展开态标题（也与图标一起构成可访问名） */
  readonly title: string
  /** 折叠态字形（沿用既有 emoji 口径：不做 icon 资产，中文进 title / aria-label） */
  readonly icon: string
  /** 首屏是否展开。`D1` 未规定默认集合 ⇒ 沿用迁移前各面板的可见性（左工具与 AI 原本常开，其余原本收起） */
  readonly defaultOpen: boolean
}

export const TILE_SPECS: readonly TileSpec[] = [
  { id: 'tools', title: '工具与颜色', icon: '🧰', defaultOpen: true },
  { id: 'ai', title: 'AI 编辑', icon: '🤖', defaultOpen: true },
  { id: 'parts', title: '结构树', icon: '🌳', defaultOpen: false },
  { id: 'ops', title: '程序化操作', icon: '⚙️', defaultOpen: false },
  { id: 'noise', title: '噪声', icon: '🎲', defaultOpen: false },
  { id: 'history', title: '撤销历史', icon: '🕘', defaultOpen: false },
  { id: 'style', title: '外观', icon: '🎭', defaultOpen: false },
  { id: 'camera', title: '相机', icon: '📷', defaultOpen: false },
  { id: 'layers', title: '层次（y 轴）', icon: '▤', defaultOpen: true },
]

const BY_ID = new Map<TileId, TileSpec>(TILE_SPECS.map((s) => [s.id, s]))

export function tileSpec(id: TileId): TileSpec {
  const s = BY_ID.get(id)
  if (!s) throw new Error(`未知方块 ID：${id}`)
  return s
}

/** 首屏展开集合（`D1` ⑤：九块都在，只是折叠态不同） */
export function defaultOpenMap(): Record<TileId, boolean> {
  return Object.fromEntries(TILE_SPECS.map((s) => [s.id, s.defaultOpen])) as Record<TileId, boolean>
}
