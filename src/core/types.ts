// 核心数据契约：调色板条目（REQ-046 的 identity + state 两个字段位）、操作 / 补丁、项目文件 v1/v2。
// r02 追加段（ScopeRef / ProgramOp / Patch.label / CompositionFile / ProjectFileV2）只增不改 r01 字段。

export interface PaletteEntry {
  readonly key: number
  /** 方块身份（如 "color:red-brick"）——REQ-046 字段位之一 */
  readonly identity: string
  /** 方块状态（彩色体系下可为空对象，但字段必须在）——REQ-046 字段位之一 */
  readonly state: Record<string, unknown>
  /** 显示色（hex）——color-only 单一体系（`REQ-022`，2026-10-17 去贴图化：无第二套体系可切） */
  readonly color?: string
}

export interface SetOp {
  readonly type: 'set'
  readonly x: number
  readonly y: number
  readonly z: number
  readonly key: number
  readonly partId?: string
}

export interface DeleteOp {
  readonly type: 'delete'
  readonly x: number
  readonly y: number
  readonly z: number
  readonly partId?: string
}

/**
 * 笔刷一笔（r02 前半 F7 · REQ-016"一次操作 = 一条补丁"）：按下→松开 = 1 条补丁，
 * 拖动涂抹在 changes 里累积（旁路直写、松手 commitStroke 记账）。
 * 初始 3³ 坯料（F6）也以一条 place 笔刷补丁落账 ⇒ "一次撤销清空"天然成立（V5）。
 */
export interface StrokeOp {
  readonly type: 'stroke'
  readonly action: 'place' | 'erase' | 'paint'
  readonly mode: 'additive' | 'override'
  /** 笔刷尺寸（每轴 1–8） */
  readonly size: Coord
}

/** 一切写操作的唯一入口（r02 程序化操作族与 r04 时间轴读同一条入口） */
export type Op = SetOp | DeleteOp | ProgramOp | StrokeOp

// ── r02 追加：程序化操作的宾语（范围引用）与 8 个操作的参数（plan §1.1，拍板 2026-10-03）──

export interface Coord {
  readonly x: number
  readonly y: number
  readonly z: number
}

/** 范围引用：解析见 core/scope.ts 的 resolveScope（纯函数） */
export type ScopeRef =
  | { readonly kind: 'all' } // 全体（当前模型的全部块）
  | { readonly kind: 'manual' } // 手工块（无构件归属的块）
  | { readonly kind: 'part'; readonly partId: string }
  | { readonly kind: 'composition'; readonly compositionId: string }

export interface NoiseFillParams {
  readonly scope: ScopeRef
  /** 0–1；每个空位被命中的概率 */
  readonly density: number
  /** 命中后从这些调色板键中按种子选一 */
  readonly keys: readonly number[]
  readonly seed: number
}

// ── r02 前半追加：F8 噪声模块（REQ-057 · Q3 拍板：编辑态动作按钮 · 作用当前范围 · 六向可勾选 · 一次性）──

/** 六个方位的勾选（体素空间三轴六方位可延伸 ⇒ 噪声作用于立方体的方式） */
export interface NoiseDirs {
  readonly px: boolean
  readonly nx: boolean
  readonly py: boolean
  readonly ny: boolean
  readonly pz: boolean
  readonly nz: boolean
}

export interface NoiseSculptParams {
  readonly scope: ScopeRef
  /** 幅度 1–4：生长时从表面向外的最大层数（每调用上限） */
  readonly amplitude: number
  /** 密度 0–1：每个表面位点的命中概率 */
  readonly density: number
  /** 种子（全显式：同 seed 同形） */
  readonly seed: number
  /** 六个方位可勾选（至少勾一个） */
  readonly dirs: NoiseDirs
  /** 生长用的调色板键 */
  readonly key: number
}

/** 拍板 2026-10-03：盒·柱·锥·球（基础几何体；屋脊移除） */
type PresetShapeKind = 'box' | 'cylinder' | 'cone' | 'sphere'

export interface PresetShapeParams {
  readonly shape: PresetShapeKind
  /** 包围盒角（含）；柱/锥取 y 为轴、x/z 为底面直径；球取 x/y/z 为三轴直径 */
  readonly origin: Coord
  readonly size: Coord
  readonly key: number
  /** 掏空 = 外形 minus 各维缩 2 的内形；内形退化为 0 时等同实心 */
  readonly hollow?: boolean
}

export interface RaiseByLayersParams {
  readonly scope: ScopeRef
  readonly layers: number
}

export interface AddLayerParams {
  readonly scope: ScopeRef
  readonly count: number
  readonly key: number
}

export interface RecolorParams {
  readonly scope: ScopeRef
  readonly toKey: number
  /** 只换这些键；缺省 = 范围内全部 */
  readonly fromKeys?: readonly number[]
}

export interface ClearScopeParams {
  readonly scope: ScopeRef
}

export interface MirrorArrayParams {
  readonly scope: ScopeRef
  readonly axis: 'x' | 'z'
  readonly copies: number
  readonly spacing: number
}

export interface BevelEdgesParams {
  readonly scope: ScopeRef
  readonly radius: number
  readonly passes: number
}

/** 程序化操作（REQ-014）：一次 = 一条补丁（PatchLog.applyOp） */
export type ProgramOp =
  | { readonly type: 'program'; readonly name: 'noiseFill'; readonly params: NoiseFillParams }
  | { readonly type: 'program'; readonly name: 'noiseSculpt'; readonly params: NoiseSculptParams }
  | { readonly type: 'program'; readonly name: 'presetShape'; readonly params: PresetShapeParams }
  | { readonly type: 'program'; readonly name: 'raiseByLayers'; readonly params: RaiseByLayersParams }
  | { readonly type: 'program'; readonly name: 'addLayer'; readonly params: AddLayerParams }
  | { readonly type: 'program'; readonly name: 'recolor'; readonly params: RecolorParams }
  | { readonly type: 'program'; readonly name: 'clearScope'; readonly params: ClearScopeParams }
  | { readonly type: 'program'; readonly name: 'mirrorArray'; readonly params: MirrorArrayParams }
  | { readonly type: 'program'; readonly name: 'bevelEdges'; readonly params: BevelEdgesParams }

export type OpName = ProgramOp['name']

export interface VoxelChange {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly before: number
  readonly after: number
}

/** 一次操作 = 恰好 1 条补丁（REQ-016 的"1 次撤销"由补丁粒度保证）；before==after 的无变化补丁也计入（I1 幂等） */
export interface Patch {
  readonly seq: number
  readonly op: Op
  readonly changes: readonly VoxelChange[]
  readonly partId: string | null
  readonly createdAt: number
  /** r02 追加：操作名 + 参数摘要（UI / r03 AI / r04 时间轴读的可读标识）；r01 补丁与 v1 导入缺省 */
  readonly label?: string
  /** r02 追加：与 changes 平行的"操作前归属"（partId | null=无归属），undo 据此精确还原归属；
   *  replay 只前向应用（与 applyOp 的前向规则一致），不消费它。仅程序化操作补丁携带。 */
  readonly ownersBefore?: ReadonlyArray<string | null>
  /** r03 追加（ADR-19）：范围 = 组合时产出块归**组合直属块**——本补丁影响的组合 id；
   *  undo / redo 据此与 compMembersBefore 镜像还原直属键。 */
  readonly compositionId?: string | null
  /** r03 追加（ADR-19）：与 changes 平行的"操作前是否为该组合直属块"（coord 在 composition.manualBlocks 里）。
   *  仅 compositionId 非 null 的补丁携带。 */
  readonly compMembersBefore?: ReadonlyArray<boolean>
  /** r03 追加（ADR-19 抬升随块走）：与 changes 平行的"应用后归属"——仅 before===0 的格有意义
   *  （新位格继承源格归属），其余为 null。redo / replay 前向消费；只有移动类（raiseByLayers）补丁携带。 */
  readonly ownersAfter?: ReadonlyArray<string | null>
}

/** 方块体系：color-only（`REQ-022`，2026-10-17 去贴图化后只剩这一种） */
export type BlockStyle = 'color'

export interface ProjectMeta {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

export interface ChunkFile {
  x: number
  y: number
  z: number
  size: number
  data: number[]
}

interface PartFile {
  id: string
  name: string
  createdAtPatch: number
  blocks: Array<[number, number, number]>
}

export interface SerializedPatch {
  seq: number
  op: Op
  changes: VoxelChange[]
  partId: string | null
  createdAt: number
  /** r02 追加（v2 写出 / 读入；v1 样本缺省） */
  label?: string
  ownersBefore?: Array<string | null>
  /** r03 追加（ADR-19）：组合直属块账（v2 透传；旧档缺省） */
  compositionId?: string | null
  compMembersBefore?: boolean[]
  ownersAfter?: Array<string | null>
}

/** 构件创建事件也进日志（否则"重放"会丢构件边界——r04 时间轴读的就是这份日志） */
export interface PartCreationFile {
  seq: number
  id: string
  name: string
  /** D3（debug-261004）：捆绑创建标记（撤销同 seq 补丁即剪空构件）；旧存档缺省 = 不捆绑 */
  bundled?: boolean
}

/**
 * 项目文件格式串（**写侧**）。2026-10-17 品牌改名：`voxel-ai-editor` → `wishvox`。
 * 写侧只用 `PROJECT_FORMAT`；`LEGACY_PROJECT_FORMAT` 只给 `decodeProject` **双读**用
 * （旧档 / `public/showcase/blue-big-fat-fish.json` 仍是旧串）。
 */
export const PROJECT_FORMAT = 'wishvox/project'
export const LEGACY_PROJECT_FORMAT = 'voxel-ai-editor/project'
/** 解码可接受的格式串（新旧双读；写侧恒为 `PROJECT_FORMAT`） */
export type ProjectFormat = typeof PROJECT_FORMAT | typeof LEGACY_PROJECT_FORMAT

/** 项目文件 v1（plan §1.3）：历史档，格式串可能仍是旧品牌（双读） */
export interface ProjectFileV1 {
  format: ProjectFormat
  formatVersion: 1
  appVersion: string
  meta: ProjectMeta
  blockStyle: BlockStyle
  palette: PaletteEntry[]
  chunks: ChunkFile[]
  parts: PartFile[]
  log: { snapshotAt: number; patches: SerializedPatch[]; partCreations?: PartCreationFile[] }
}

// ── r02 追加：组合层（D6-ADR-12：语义分组 = 成员 part 引用 ∪ 手工块坐标；不改 part 归属；首版不嵌套）──

export interface CompositionData {
  id: string
  name: string
  partIds: string[]
  blocks: Array<[number, number, number]>
}

/** 项目文件 v2（NFR-006：格式由 r01–r02 定稿）：+ compositions + 补丁 label/ownersBefore */
export interface ProjectFileV2 {
  format: typeof PROJECT_FORMAT
  formatVersion: 2
  appVersion: string
  meta: ProjectMeta
  blockStyle: BlockStyle
  palette: PaletteEntry[]
  chunks: ChunkFile[]
  parts: PartFile[]
  compositions: CompositionData[]
  log: {
    snapshotAt: number
    patches: SerializedPatch[]
    partCreations?: PartCreationFile[]
  }
}
