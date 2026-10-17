// r04 T6（A8 兜底）：会话态视图 setter——自 edit/editor.ts 迁出（r02 前半的 F3/F4/F5/F7 面）。
// 单一状态源 = UI store（state/editor-store）；渲染层只是执行器。Editor 的同名方法是一行委托。
import type { LayerFilter } from '../core/brush/predicate'
import { canonicalHex, colorIdentityOf } from '../core/color'
import { isCoordDomain } from '../core/coords'
import { effectiveGridY, setUi, useEditorUi } from '../state/editor-store'
import type { BrushTool, EditorMode, Tool } from '../state/editor-store'
import type { Editor } from './editor'

/** F3 / `REQ-052`（P2）：模型 → 视图的投影把渲染层层次过滤对齐到 store。
 *  为什么仍需这层对账：切「显示全部」时 filter = null（不裁剪拾取），渲染层必须真收到 null，
 *  否则被过滤跳过的层（render/chunks.ts 的 isLayerVisible）会一直不可见。
 *  store 仍是单一真源；本函数只推"与渲染层实际持有值不同"的情形 ⇒ 不引入任何隐式切层或粘滞。 */
export function syncLayerView(ed: Editor): void {
  const next = ed.currentLayerFilter()
  const held = ed.renderer?.layerFilterReadback?.() ?? null
  if (held === next || (held !== null && next !== null && held.mode === next.mode && held.y === next.y)) return
  ed.renderer?.setLayerFilter?.(next)
}

/** F3 / `REQ-052`（P2 三档）：层次视图 = **纯视图态**（`all` = 显示全部，唯一不裁剪拾取的档；
 *  `below` = 从最低占用层到 y；`single` = 仅 y 这一层）。只改可见/可拾取集合与撤销历史无关的会话态：
 *  **不移动模型、不改工作网格高度、不写撤销历史**；新增更高/更低块也**不隐式切层**（全显下继续可见）。
 *  非法 y（非整数 / 越界，`REQ-065`）拒绝并保留原状态。 */
export function setLayerView(ed: Editor, mode: LayerFilter['mode'] | 'all', y: number): void {
  if (!isCoordDomain(y)) {
    setUi({ message: '过滤高度须为 ±4096 内的整数' })
    return
  }
  cancelStrokeForSettingChange(ed)
  setUi({ layerMode: mode, layerY: y })
  ed.renderer?.setLayerFilter?.(ed.currentLayerFilter())
  // `D3`：任一方勾选了「参数跟随」⇒ 拖动层次滑块必须实时带动该网格（未勾选的一方不受影响）。
  const s = useEditorUi.getState()
  if (s.followLayerWork || s.followLayerRef) pushGrid(ed)
  ed.stroke.updatePreview()
}

/** `D3`/`F4`：把**生效**网格高度推给渲染层——唯一推送点（`effectiveGridY` 是唯一派生点）。
 *  参考网格只改呈现，**不参与拾取**；工作网格的生效 y 同时是放置平面高度（`VoxelView.setGrid` 内）。 */
export function pushGrid(ed: Editor): void {
  const s = useEditorUi.getState()
  const y = effectiveGridY(s)
  ed.renderer?.setGrid?.({ base: s.gridBase, layer: s.gridLayer, y: y.work, refY: y.ref })
}

/** F4（`REQ-048`）：两个网格开关（默认全关）。切换先结束当前一笔（参数快照纪律，`REQ-055`）；
 *  网格高度取**独立工作 y**，切换开关不改变它。 */
export function setGridView(ed: Editor, base: boolean, layer: boolean): void {
  cancelStrokeForSettingChange(ed)
  setUi({ gridBase: base, gridLayer: layer })
  pushGrid(ed)
  ed.stroke.clearPreview()
}

/** `REQ-048`（P2）：独立工作网格高度——只改工作平面（放置落点），
 *  **不移动模型、不重定位、不自动改过滤层、不进撤销历史**。非法 y（`REQ-065`）拒绝并保留原状态。
 *  `D3`：勾选「参数跟随」时该输入被界面禁用；这里仍只写**独立值**（生效 y 由 `effectiveGridY` 派生）。 */
export function setWorkGridY(ed: Editor, y: number): void {
  if (!isCoordDomain(y)) {
    setUi({ message: '工作网格 y 须为 ±4096 内的整数' })
    return
  }
  cancelStrokeForSettingChange(ed)
  setUi({ workGridY: y })
  pushGrid(ed)
  ed.stroke.clearPreview()
}

/** `D3`（2026-10-16）：**参考网格**独立高度（默认 0、域 ±4096，含负数）——只改参考平面呈现，
 *  **不提供放置 / 不参与命中、不改模型、不改过滤层、不进撤销历史**（`REQ-058` 会话态）。
 *  非法（非整数 / 越界）拒绝且**原值不变**（`REQ-065`）。 */
export function setRefGridY(ed: Editor, y: number): void {
  if (!isCoordDomain(y)) {
    setUi({ message: '参考网格 y 须为 ±4096 内的整数' })
    return
  }
  cancelStrokeForSettingChange(ed)
  setUi({ refGridY: y })
  pushGrid(ed)
  ed.stroke.clearPreview()
}

/** `D3`：网格「参数跟随」开关（默认关）。勾选 ⇒ 该网格生效 y 实时 = 当前层实际 y；
 *  取消 ⇒ 恢复**勾选前**的独立值（独立值全程未被覆盖，故无需回写）。
 *  为何要先结束当前一笔：改变生效 y 会改变放置平面，与"笔中途改参数"同一条纪律（`REQ-055`）。 */
export function setGridFollow(ed: Editor, which: 'work' | 'ref', on: boolean): void {
  cancelStrokeForSettingChange(ed)
  setUi(which === 'work' ? { followLayerWork: on } : { followLayerRef: on })
  pushGrid(ed)
  ed.stroke.clearPreview()
  const s = useEditorUi.getState()
  setUi({
    message:
      which === 'work'
        ? on
          ? `工作网格跟随层次滑块（当前 y=${s.layerY}）；取消勾选恢复 y=${s.workGridY}`
          : `工作网格已取消跟随，独立 y=${s.workGridY}`
        : on
          ? `参考网格跟随层次滑块（当前 y=${s.layerY}）；取消勾选恢复 y=${s.refGridY}`
          : `参考网格已取消跟随，独立 y=${s.refGridY}`,
  })
}

/** F5：双态（REQ-054：单布尔回同一状态源；检视态拾取同步降级） */
export function setMode(ed: Editor, mode: EditorMode): void {
  if (ed.stroke.active) ed.strokeCancel() // 切态打断未落账的一笔
  setUi({ mode })
  ed.renderer?.setInteractionMode?.(mode)
  if (mode === 'inspect') ed.stroke.clearPreview()
  ed.syncUi()
  setUi({ message: mode === 'edit' ? '已切换到编辑态（左键 = 笔刷）' : '已切换到检视态（编辑工具已灰掉）' })
}

/** `REQ-064`（r05 件四）：读回某工具的尺寸那份；store 缺该面（旧存档 / 直接 setUi 的旧用法）
 *  按 `brushSize` 镜像兜底 ⇒ 不因缺字段崩，也不另立第二份默认值。 */
function sizeOfTool(s: ReturnType<typeof useEditorUi.getState>, tool: BrushTool): { x: number; y: number; z: number } {
  return s.brushSizes?.[tool] ?? s.brushSize
}

/** `A-07`（design §A4）：笔刷设置（尺寸 / 工具 / 替换开关）变更前必须先结束当前一笔——
 *  一笔的落笔快照（`StrokeOp` 的 action/mode/size、commit 的 label）在 `stroke.begin()` 时定下，
 *  而拖动中每次 `apply` 读的是**实时** store ⇒ 中途改设置会让同一条补丁混入两套参数。
 *  这里统一取消（还原 + 不记账），下一次按下才是新参数的一笔。 */
function cancelStrokeForSettingChange(ed: Editor): void {
  if (!ed.stroke.active) return
  ed.strokeCancel()
  setUi({ message: '笔刷设置已变更：当前一笔已取消（未记账），新设置从下一笔生效' })
}

/** F7：笔刷参数（尺寸 / 替换开关）——**尺寸按工具各存一份**（`REQ-064`），同时刷新镜像与预览。
 *  镜像 `brushSize` 是既有读点（面板 / 快捷键 / stroke）：写入后恒等于"当前工具那一份"。 */
export function setBrushSize(ed: Editor, size: { x: number; y: number; z: number }): void {
  cancelStrokeForSettingChange(ed)
  const s = useEditorUi.getState()
  setUi({ brushSize: size, brushSizes: { ...s.brushSizes, [s.tool]: size } })
  ed.stroke.updatePreview()
}

export function setOverridePlace(ed: Editor, on: boolean): void {
  cancelStrokeForSettingChange(ed)
  setUi({ overridePlace: on })
  ed.stroke.updatePreview()
}

/** F7：切工具——`REQ-064`：**读回该工具自己上次的尺寸**（记住、不重置、不跨工具污染）。
 *  P3：`pick`（吸管）也是枚举里的工具（`REQ-037`），但不是笔刷动作——切到它只收起预览。 */
export function setTool(ed: Editor, tool: Tool): void {
  cancelStrokeForSettingChange(ed)
  const s = useEditorUi.getState()
  setUi({ tool, brushSize: sizeOfTool(s, tool) })
  if (tool === 'pick') ed.stroke.clearPreview()
  else ed.stroke.updatePreview()
}

export function setCurrentIdentity(identity: string): void {
  setUi({ currentIdentity: identity })
}

/** P3（`REQ-037` · B-03）：吸管取色——读该格**原始体素色**（调色板条目色值，不含光照 / 阴影 / 描边 /
 *  选择高亮），只更新当前色：不写模型、不进撤销历史、不分配持久键（门四）。
 *  无方块（网格 / 背景）或该方块没有原始色值（贴图体系）⇒ 保持当前色并给原因。 */
export function eyedrop(ed: Editor, x: number, y: number, z: number): boolean {
  const entry = ed.volume.getEntry(x, y, z)
  if (entry === undefined || entry.key === 0) {
    setUi({ message: '此处没有可见方块可取色（网格与背景不取色）——当前色保持不变' })
    return false
  }
  const hex = canonicalHex(entry.color ?? '')
  if (hex === null) {
    setUi({ message: `方块「${entry.identity}」没有原始色值（贴图体系）——当前色保持不变` })
    return false
  }
  if (!setCurrentColor(ed, hex, entry.identity)) return false
  setUi({ message: `已吸取原始色 ${hex}（方块「${entry.identity}」，未改动模型与历史）` })
  return true
}

/** P3（`REQ-027` 门四 · B-01/B-08）：会话当前色——**纯会话态**：
 *  · 不写模型、不进撤销历史、**不分配持久键**（键只在真正写入前 intern）；
 *  · 非法值（非 HEX / 通道越界 / 小数 / 带透明度）**保留上次有效色**并给原因（B-08）；
 *  · 与笔刷参数同级：改色先结束当前一笔（`REQ-055` 的落笔快照纪律），否则一笔会混入两套颜色。 */
export function setCurrentColor(ed: Editor, hex: string, identity?: string): boolean {
  const c = canonicalHex(hex)
  if (c === null) {
    setUi({ message: `颜色值无效（须为不透明 HEX 如 #3b6ea5，或 0..255 的整数 RGB）：${hex}——已保留上次有效色` })
    return false
  }
  cancelStrokeForSettingChange(ed)
  setUi({ currentColor: c, currentIdentity: identity ?? colorIdentityOf(c) })
  ed.stroke.updatePreview()
  return true
}
