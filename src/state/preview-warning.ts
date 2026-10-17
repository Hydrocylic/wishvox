// `D5`（design §8 · 2026-10-16 裁定）：**预览全无效**时的左上黄字短原因 —— 纯投影层。
// 为什么单列一个模块：黄字（短原因）与状态栏 `message`（诊断明细）是**两条通道**，design 要求
// "共存不重复堆叠"（一处短原因 + 一处细节）⇒ 短原因文案与"取哪一个原因"的判据必须有唯一正本，
// 不能散在 `stroke.ts` 与 HUD 两处各写一遍（措辞漂移会让判据无法抽查）。
import type { BrushRejections } from '../core/brush/apply'

/** 原因类别。序 = design §8 D5 的判据序 `hidden > outOfBounds > occupied > empty`（`unchanged` 排最后）。
 *  `noTarget`（有命中但擦除/上色没有方块可作用）与 `empty`（**完全没命中**）分开：两者在既有
 *  `previewAt` 口径里本就不是一回事（`empty` 计数 = 命中空气格），且 design 给 `empty` 的文案
 *  「无落点：开启工作网格或对准模型」只对"没命中"成立。 */
export type PreviewRejectKind = 'hidden' | 'outOfBounds' | 'occupied' | 'empty' | 'noTarget' | 'unchanged'

/** 短原因文案（design §8 D5 指定的四句逐字沿用；`noTarget` / `unchanged` 沿用既有 `previewAt` 口径） */
export const PREVIEW_REJECT_TEXT: Readonly<Record<PreviewRejectKind, string>> = {
  hidden: '目标层被隐藏：选择显示全部或调整过滤层',
  outOfBounds: '目标超出 ±4096 整数坐标域',
  occupied: '增量放置目标已占用',
  empty: '无落点：开启工作网格或对准模型',
  noTarget: '此处没有方块可作用（擦除与上色只作用于已有块）',
  unchanged: '目标颜色与现状一致，无有效变化',
}

export interface PreviewReject {
  readonly kind: PreviewRejectKind
  readonly text: string
  /** 出现序号：每**新出现一次**（或类别变化）递增 ⇒ HUD 用它重放"出现瞬间短闪"（同类不重复闪） */
  readonly seq: number
}

/** 「完全没命中」那一类的类别名（design §8 D5 的 `empty` 文案只对"没命中"成立，见 `empty` 与 `noTarget` 的分工） */
export const NO_HIT_KIND: PreviewRejectKind = 'empty'

/** 笔刷谓词的拒绝计数 → 原因类别（取首个；`null` = 没有任何拒绝计数，调用方按 `noTarget` 兜底）。
 *  序 = design §8 D5：`hidden > outOfBounds > occupied > empty`（`unchanged` 排最后）。
 *  注意 `empty` 计数（命中格是空气）映射到 `noTarget`——它不是"没命中"，文案不许串（见本文件顶部注释）。 */
export function rejectKindOf(r: BrushRejections): PreviewRejectKind | null {
  if (r.hidden > 0) return 'hidden'
  if (r.outOfBounds > 0) return 'outOfBounds'
  if (r.occupied > 0) return 'occupied'
  if (r.empty > 0) return 'noTarget'
  if (r.unchanged > 0) return 'unchanged'
  return null
}

/** 下一个黄字状态：同类别**延续**（seq 不变 ⇒ 不重放短闪）；换类别或从无到有 ⇒ seq+1 */
export function nextPreviewReject(cur: PreviewReject | null, kind: PreviewRejectKind): PreviewReject {
  if (cur !== null && cur.kind === kind) return cur
  return { kind, text: PREVIEW_REJECT_TEXT[kind], seq: (cur?.seq ?? 0) + 1 }
}
