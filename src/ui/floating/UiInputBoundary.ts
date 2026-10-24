// `D1`（architect §5.4 `UiInputBoundary`）：UI 覆盖层的**可识别 DOM 标记**与边界查询——
// React 事件与**原生**监听（Viewport 的 canvas 指针族、App 的窗口快捷键）共用同一份判据。
// 为什么必须是"标记 + 查询"而不是各处 `stopPropagation`：canvas 上有 pointer capture，
// 且 App 的 Ctrl+Z 挂在 window（捕获阶段之外）——只拦 React 冒泡拦不住这两条路径（architect §5.5）。
export const UI_BOUNDARY_ATTR = 'data-ui-boundary'

interface BoundaryNode {
  getAttribute?: (name: string) => string | null
  parentNode?: unknown
}

/** 事件目标是否落在 UI 边界内（含边界根本身）。垫片 DOM 无 `closest` ⇒ 手工向上走 parentNode。 */
export function isUiEventTarget(target: unknown): boolean {
  let node = target as BoundaryNode | null | undefined
  let guard = 0
  while (node && guard++ < 64) {
    if (typeof node.getAttribute === 'function' && node.getAttribute(UI_BOUNDARY_ATTR) !== null) return true
    node = node.parentNode as BoundaryNode | null | undefined
  }
  return false
}

/** 文本类 `input` 的 type（HTML 规范里吃文本输入的几种）；`number` 也算——笔刷 W·H·L 是数字框，
 *  焦点在框里时 Ctrl+Z 应留给输入框自己的本地撤销，不动模型。 */
const TEXT_INPUT_TYPES: ReadonlySet<string> = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number'])

interface EntryNode extends BoundaryNode {
  tagName?: unknown
  /** 真实 DOM 的只读属性（`contenteditable` 宿主的后代也为 true）；垫片没有它 */
  isContentEditable?: unknown
}

function attrOf(node: BoundaryNode, name: string): string | null {
  if (typeof node.getAttribute !== 'function') return null
  const value: unknown = node.getAttribute(name)
  return typeof value === 'string' ? value : null
}

/** `input` 是否文本类：缺 `type` 属性、`type=""`、纯空白都 = 浏览器默认 `text`（宁可按文本拦，不误放）。 */
function isTextInput(node: BoundaryNode): boolean {
  const type = attrOf(node, 'type')
  if (type === null) return true
  const normalized = type.trim().toLowerCase()
  return normalized === '' || TEXT_INPUT_TYPES.has(normalized)
}

/** 宿主是否可编辑：`contenteditable` 属性（`""` / `true` / `plaintext-only`）或真实 DOM 的 `isContentEditable`。 */
function isEditableHost(node: EntryNode): boolean {
  if (node.isContentEditable === true) return true
  const flag = attrOf(node, 'contenteditable')
  return flag !== null && flag.trim().toLowerCase() !== 'false'
}

/** `R-14`（debug-261018，用户 2026-10-18 口径 A）：事件目标是否是**文本输入面**——
 *  `textarea` / `contenteditable`（含其子节点）/ 文本类 `input`（含 `number`）。
 *  这就是窗口快捷键（`Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y`）的闸门：只有文本输入面保留自己的本地撤销，
 *  按钮（色板色块、工具键、收起键…）不再吞掉模型撤销——点过色板后 `Ctrl+Z` 必须能撤掉上一笔放置。
 *  非文本 `input`（checkbox / radio / range / button…）、`button`、`select`、`body`、canvas ⇒ 不拦。
 *  **不是** `isUiEventTarget` 的替代：指针隔离（Viewport / `pointOverUi`）仍按 UI 边界判，不得放宽。
 *  垫片 DOM 无 `closest` ⇒ 与另一边同样手工沿 `parentNode` 向上走，并对 `null` / 缺字段稳健。 */
export function isTextEntryTarget(target: unknown): boolean {
  let node = target as EntryNode | null | undefined
  let guard = 0
  while (node && guard++ < 64) {
    const tag = typeof node.tagName === 'string' ? node.tagName.toUpperCase() : ''
    if (tag === 'TEXTAREA') return true
    if (tag === 'INPUT' && isTextInput(node)) return true
    if (isEditableHost(node)) return true
    node = node.parentNode as EntryNode | null | undefined
  }
  return false
}

/** 屏幕点是否落在某个 UI 边界之上（活动笔经过覆盖区时用）。
 *  环境无 `elementFromPoint`（无头垫片 / 老浏览器）⇒ 返回 false，退化为既有"只看坐标出界"的收尾判据，
 *  **不新增**一条会让无头回归抖动的隐式分支。 */
export function pointOverUi(clientX: number, clientY: number): boolean {
  const doc = (globalThis as { document?: { elementFromPoint?: (x: number, y: number) => unknown } }).document
  if (!doc || typeof doc.elementFromPoint !== 'function') return false
  return isUiEventTarget(doc.elementFromPoint(clientX, clientY))
}
