import { create } from 'zustand'
import type { LayerFilter } from '../core/brush/predicate'
import type { BlockStyle } from '../core/types'
import type { PreviewReject } from './preview-warning'

export type Tool = 'place' | 'erase' | 'paint' | 'pick'
/** `REQ-064`（r05 件四）：带"按工具各持一份尺寸"的工具名（与 `Tool` 同集合，语义名给尺寸面用） */
export type BrushTool = Tool
export type SaveState = 'idle' | 'pending' | 'saved' | 'error'
/** F5 双态（REQ-054 · E1 拍板）：检视（默认）↔ 编辑；单布尔回同一状态源 */
export type EditorMode = 'inspect' | 'edit'

interface PaletteItem {
  identity: string
  color: string
  key: number
}

/** P3（B-05）：模型**当前已用**颜色条目——由全模型非空块统计（不随层次隐藏 / 选中变化），按规范色值去重 */
export interface UsedColorItem {
  identity: string
  /** 规范 HEX（小写 #rrggbb） */
  color: string
  /** 首次出现该色值的键（点选/展示用） */
  key: number
  count: number
}

interface PartItem {
  id: string
  name: string
  count: number
  createdAtPatch: number
}

/** r02：组合条目（blockCount = resolveScope 解析出的现存块数——UI 展示与高亮同口径） */
interface CompositionItem {
  id: string
  name: string
  memberPartIds: string[]
  manualBlockCount: number
  blockCount: number
}

/** F2：非空块 AABB 读数（W(x)/H(y)/L(z)，右手系；随模型变化，不随相机变化） */
interface BoundsReadout {
  min: [number, number, number]
  max: [number, number, number]
  w: number
  h: number
  l: number
  center: [number, number, number]
}

/** F7：虚方块预览读数（HUD：尺寸 + 锚点坐标） */
interface PreviewReadout {
  anchor: [number, number, number]
  size: [number, number, number]
  cells: number
}

/** F9：相机面板的输入面（会话态，不进项目文件） */
interface CameraPanelParams {
  fov: number
  distance: number
  rotateSpeed: number
  damping: number
  target: [number, number, number]
}

/** F12：撤销历史条目（label = 补丁的操作名字段；state 区分已应用 / 已撤销） */
export interface HistoryItem {
  seq: number
  label: string
  cells: number
  action: string
  state: 'applied' | 'undone'
}

export interface EditorUiState {
  tool: Tool
  currentIdentity: string
  /** P3（`REQ-027` 门四 · B-01）：**会话当前色**（规范 HEX）。选色 / 吸管只改它——不写模型、不进历史、不分配持久键 */
  currentColor: string
  /** P3（B-05）：模型已用颜色（全模型统计，隐藏层的颜色仍在；最后同色块删除即消失，撤销即恢复） */
  usedColors: UsedColorItem[]
  blockStyle: BlockStyle
  selectedPartId: string | null
  selectedCompositionId: string | null
  missingIdentities: string[]
  paletteItems: PaletteItem[]
  parts: PartItem[]
  compositions: CompositionItem[]
  manualBlockCount: number
  saveState: SaveState
  canUndo: boolean
  canRedo: boolean
  nonEmpty: number
  chunkCount: number
  message: string | null
  version: number
  // ── r02 前半会话态（不进项目文件）──
  /** F5 双态 */
  mode: EditorMode
  /** F7 笔刷参数。`REQ-064`（r05 件四）：尺寸**按工具各存一份**（`brushSizes`），
   *  `brushSize` = **当前工具那一份的镜像**（既有读点不变：面板 / 快捷键 / stroke 都读它）。
   *  唯一写者 = `edit/session-view.ts#setBrushSize` / `#setTool`，两者同步写两份 ⇒ 不变式恒成立。 */
  brushSize: { x: number; y: number; z: number }
  /** `REQ-064`：放置 / 擦除 / 上色各持一份尺寸（每轴 1–8；会话态，不进项目文件 / 补丁日志）。
   *  P3：`pick`（吸管）不是笔刷动作 ⇒ 没有自己的尺寸（缺项按 `brushSize` 镜像兜底）。 */
  brushSizes: Partial<Record<BrushTool, { x: number; y: number; z: number }>>
  overridePlace: boolean
  /** F3 层次（滑块 y + 三档过滤；`REQ-052`：`all` = 显示全部，唯一不裁剪拾取的档；
   *  `layerMinY/layerMaxY` = 模型**实际占用**的最低/最高层，不含冒充模型层的"建造余量"） */
  layerMode: LayerFilter['mode'] | 'all'
  layerY: number
  layerMinY: number
  layerMaxY: number
  perLayerCounts: Array<{ y: number; count: number }>
  /** F4 网格开关（默认全关）· F4/`REQ-048`：`gridLayer` = **独立工作网格**（平面隔空放置的唯一闸门） */
  gridBase: boolean
  gridLayer: boolean
  /** `REQ-048`：独立工作平面高度（整数 y，`REQ-065` 数域）；移动它不改模型、不改过滤、不进历史 */
  workGridY: number
  /** `D3`（2026-10-16）：**参考网格**独立整数 y（默认 0、域 ±4096）——与工作网格各持一份，互不影响。
   *  参考网格仍是**只读参考平面**（可设 y，但不提供放置 / 不参与命中）。 */
  refGridY: number
  /** `D3`：工作网格「参数跟随」（默认关）。勾选 ⇒ 生效 y = 当前层实际 y（`layerY`），
   *  手动输入禁用、但**独立值 `workGridY` 不被覆盖** ⇒ 取消勾选即恢复勾选前的值。 */
  followLayerWork: boolean
  /** `D3`：参考网格「参数跟随」（默认关）——语义同上，与工作网格那一个互相独立。 */
  followLayerRef: boolean
  /** F2 读数 */
  boundsReadout: BoundsReadout | null
  /** F7 预览读数（null = 无预览） */
  previewReadout: PreviewReadout | null
  /** `D5`：预览**全无效**时的左上黄字短原因（null = 无提示）；`message` 通道保留诊断明细，两者不重复 */
  previewReject: PreviewReject | null
  /** F9 相机面板（输入值 + 渲染层读回） */
  cameraPanel: CameraPanelParams
  /** F12 撤销历史 */
  history: HistoryItem[]
}

export const useEditorUi = create<EditorUiState>(() => ({
  tool: 'place',
  currentIdentity: 'color:red',
  currentColor: '#c0392b',
  usedColors: [],
  blockStyle: 'color',
  selectedPartId: null,
  selectedCompositionId: null,
  missingIdentities: [],
  paletteItems: [],
  parts: [],
  compositions: [],
  manualBlockCount: 0,
  saveState: 'idle',
  canUndo: false,
  canRedo: false,
  nonEmpty: 0,
  chunkCount: 0,
  message: null,
  version: 0,
  mode: 'inspect',
  brushSize: { x: 1, y: 1, z: 1 },
  brushSizes: { place: { x: 1, y: 1, z: 1 }, erase: { x: 1, y: 1, z: 1 }, paint: { x: 1, y: 1, z: 1 } },
  overridePlace: false,
  // `D4`（design §8 · 用户 2026-10-16 确认）：**默认档 = 「显示全部」**（原 `below`）——A3「推荐显示全部」由此落实。
  layerMode: 'all',
  layerY: 3,
  layerMinY: 0,
  layerMaxY: 3,
  perLayerCounts: [],
  gridBase: false,
  gridLayer: false,
  workGridY: 0,
  refGridY: 0,
  followLayerWork: false,
  followLayerRef: false,
  boundsReadout: null,
  previewReadout: null,
  previewReject: null,
  cameraPanel: { fov: 60, distance: 0, rotateSpeed: 1.0, damping: 0.08, target: [0, 0, 0] },
  history: [],
}))

export function setUi(patch: Partial<EditorUiState>): void {
  useEditorUi.setState(patch)
}

/**
 * `D3`（design §8）：网格的**生效 y** —— 唯一派生点（渲染层与放置平面都读它，不各自算一遍）。
 * - 勾选「参数跟随」⇒ 生效 y = 当前层**实际 y**（`layerY`；U8 网格显示实际 y，不是主层序序号）；
 * - 未勾选 ⇒ 各自的**独立值**（`workGridY` / `refGridY`）——跟随时不把跟随值写回独立值，
 *   所以取消勾选恢复的是**勾选前**的值；
 * - 两个网格各持一份、互不影响。
 */
export function effectiveGridY(
  s: Pick<EditorUiState, 'workGridY' | 'refGridY' | 'followLayerWork' | 'followLayerRef' | 'layerY'>,
): { work: number; ref: number } {
  return {
    work: s.followLayerWork ? s.layerY : s.workGridY,
    ref: s.followLayerRef ? s.layerY : s.refGridY,
  }
}
