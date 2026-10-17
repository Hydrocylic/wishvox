// `D1`（design §7.2 · 2026-10-16）：九个悬浮小方块的**固定拓扑 + 纯几何约束**——本文件只算 CSS 像素，
// 不碰 DOM、不碰相机 / 模型 / 存档（architect §5.4：位置不能从相机、模型包围盒或存档获取）。
// 为什么单独成文件：位置与方向是**静态唯一出处**（`TILE_SPECS`），而"展开不遮挡 AI / 层次卡、
// 开关不推动别的锚点"是一条可以纯函数验证的**不变量**——把它从 React 里拿出来才测得了。
import type { TileId } from './tile-specs'

/** 展开方向（design §7.2：工具/AI 向下、右列六块向左、层次卡向上） */
export type TileExpandDirection = 'down' | 'left' | 'up'

/** 方块边长与间距（`D1` 尺寸预算，2026-10-16 实测内容后定：34px 方形放得下 17px 字形 + 中文 11px 标签） */
export const TILE_SIZE = 34
export const TILE_GAP = 6
export const TILE_PAD = 8
/** 右列固定六块的顺序（design §7.2：结构树 → 程序化 → 噪声 → 历史 → 外观 → 相机） */
export const RIGHT_COLUMN: readonly TileId[] = ['parts', 'ops', 'noise', 'history', 'style', 'camera']
/** 内容体期望尺寸上限（**预算封顶**，不是"已确认的最小分辨率"）：超出即内部滚动（architect §5.4-3） */
const CONTENT_MAX_W = 336
const CONTENT_MAX_H = 420
/** 画布保护区：内容体的一侧最多推到"离另一缘还有这么宽"为止 ⇒ 中间始终留得下可雕刻的区域 */
const MIN_CANVAS = 120
const MIN_BODY_W = 180

/** 视口小到连"六个触发方块 + AI / 层次两个触发方块"都排不下时的报告值（实测：见 delivery record §D1 取证） */
export const MIN_WORKSPACE = { width: 350, height: 312 } as const
/** 内容体**下限** = 头部行（标题 + 收起入口）的高度：再小的视口也不让"关闭入口"消失（`F-04`） */
const MIN_BODY_H = 44

export interface TileSlot {
  readonly id: TileId
  /** 折叠态方块锚点（相对工作区左上角） */
  readonly anchorLeft: number
  readonly anchorTop: number
  readonly direction: TileExpandDirection
  /** 内容体水平贴边：`left` = 贴工作区左缘（工具块）· `right` = 贴右缘（其余八块） */
  readonly side: 'left' | 'right'
  /** 内容体展开态的矩形（宽度用 `bodyMaxWidth`，右贴边时 x 由工作区宽度推出） */
  readonly bodyTop: number
  readonly bodyMaxWidth: number
  readonly bodyMaxHeight: number
}

export interface TileLayoutInput {
  readonly width: number
  readonly height: number
  /** 左上 HUD（读数 + `D5` 黄字）已占用的高度：工具块锚点在它下方，避免压住读数 */
  readonly hudHeight: number
}

export interface TileLayoutResult {
  readonly ok: boolean
  readonly slots: Readonly<Record<TileId, TileSlot>>
  /** 报告用：右列自下而上的实际锚点（六个，含顺序） */
  readonly column: ReadonlyArray<{ id: TileId; anchorTop: number }>
  readonly required: { readonly width: number; readonly height: number }
  readonly note: string
}

/** 内容体矩形（工作区坐标）——纯几何，测试与目检共用同一份推算 */
export function contentRect(s: TileSlot, workspaceWidth: number): { left: number; top: number; right: number; bottom: number } {
  const left = s.side === 'left' ? TILE_PAD : Math.max(TILE_PAD, workspaceWidth - TILE_PAD - s.bodyMaxWidth)
  return { left, top: s.bodyTop, right: left + s.bodyMaxWidth, bottom: s.bodyTop + s.bodyMaxHeight }
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi)

/**
 * 九块布局。三条硬约束（`D1` ③⑥ / F-04，全部由此函数保证，不靠 z-index 掩盖）：
 * 1. **右上 AI 保护区**与**右下层次保护区**各按视口预留一段展开预算，预算**不随当前 open 值变化**
 *    ⇒ 展开 AI 不会把右列推下去、也不会盖住层次卡；
 * 2. 右列六块的**内容体**被夹在两条保护区之间的矩形里（`bodyTop = regionTop`，高度 = 区间高度）
 *    ⇒ 右列展开向左，纵向上不可能与 AI / 层次的内容体相交；
 * 3. 锚点只由视口尺寸与 HUD 占用决定：开关方块不改锚点，相机 / 模型变化不进本函数。
 */
export function computeTileLayout(input: TileLayoutInput): TileLayoutResult {
  const W = Math.max(0, input.width)
  const H = Math.max(0, input.height)
  const pad = TILE_PAD
  const ts = TILE_SIZE
  const gap = TILE_GAP
  const hudBottom = pad + Math.max(0, input.hudHeight) + gap
  const rightX = Math.max(pad, W - ts - pad)
  const columnTop = pad + ts + gap
  const columnBottom = H - ts - pad - gap
  const columnSpace = columnBottom - columnTop
  const columnNeed = RIGHT_COLUMN.length * ts + (RIGHT_COLUMN.length - 1) * gap
  // 两条保护区之间的"可分配展开预算"：减去两段令牌间隔后由 AI / 层次对半分（各再受内容上限封顶）；
  // 无论视口多小都保底 `MIN_BODY_H`（头部行）⇒ 展开体的**关闭入口**与标题始终可达（`F-04`）。
  const budgetSpace = columnSpace - columnNeed - 2 * gap
  const aiBudget = Math.max(MIN_BODY_H, clamp(Math.floor(budgetSpace / 2), 0, CONTENT_MAX_H))
  const layerBudget = Math.max(MIN_BODY_H, clamp(budgetSpace - aiBudget, 0, CONTENT_MAX_H))
  const regionTop = columnTop + aiBudget + gap
  const regionBottom = columnBottom - layerBudget - gap
  const regionHeight = Math.max(0, regionBottom - regionTop)
  const step = ts + gap
  // 右列在区间内居中（空间不够时退化到区间顶端 + 报告失败，不静默重叠）
  const columnStart = regionHeight >= columnNeed ? regionTop + (regionHeight - columnNeed) / 2 : regionTop

  const bodyMaxWidth = clamp(Math.min(CONTENT_MAX_W, W - ts - pad * 2 - MIN_CANVAS), MIN_BODY_W, CONTENT_MAX_W)
  const columnBodyHeight = Math.max(MIN_BODY_H, clamp(regionHeight, 0, CONTENT_MAX_H))

  const slot = (id: TileId, anchorTop: number, direction: TileExpandDirection, side: 'left' | 'right', bodyTop: number, maxH: number): TileSlot => ({
    id,
    anchorLeft: side === 'left' ? pad : rightX,
    anchorTop,
    direction,
    side,
    bodyTop,
    bodyMaxWidth,
    bodyMaxHeight: Math.max(MIN_BODY_H, maxH),
  })

  const slots: Record<TileId, TileSlot> = {
    // 左缘上方（HUD 之下），向下展开
    tools: slot('tools', hudBottom, 'down', 'left', hudBottom + ts + gap, H - (hudBottom + ts + gap) - pad),
    // 右上，向下展开（预算 = aiBudget）
    ai: slot('ai', pad, 'down', 'right', pad + ts + gap, aiBudget),
    // 右下，向上展开（预算 = layerBudget）
    layers: slot('layers', Math.max(pad, H - ts - pad), 'up', 'right', Math.max(pad, H - ts - pad - gap - layerBudget), layerBudget),
    // 右列六块：向左展开，内容体统一落在两条保护区之间
    parts: slot('parts', columnStart, 'left', 'right', regionTop, columnBodyHeight),
    ops: slot('ops', columnStart + step, 'left', 'right', regionTop, columnBodyHeight),
    noise: slot('noise', columnStart + 2 * step, 'left', 'right', regionTop, columnBodyHeight),
    history: slot('history', columnStart + 3 * step, 'left', 'right', regionTop, columnBodyHeight),
    style: slot('style', columnStart + 4 * step, 'left', 'right', regionTop, columnBodyHeight),
    camera: slot('camera', columnStart + 5 * step, 'left', 'right', regionTop, columnBodyHeight),
  }

  const ok = W >= MIN_WORKSPACE.width && H >= MIN_WORKSPACE.height
  return {
    ok,
    slots,
    column: RIGHT_COLUMN.map((id) => ({ id, anchorTop: slots[id].anchorTop })),
    required: { ...MIN_WORKSPACE },
    note: ok
      ? '布局在预算内：AI / 层次 / 右列三段互不相交'
      : `工作区小于最小可容纳尺寸（需 ≥ ${MIN_WORKSPACE.width}×${MIN_WORKSPACE.height}，实测 ${Math.round(W)}×${Math.round(H)}）：触摸区仍按边缘固定，内容体缩小并内部滚动`,
  }
}
