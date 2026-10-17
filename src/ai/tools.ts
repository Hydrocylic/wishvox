// r03 · T1 工具面规格（ai-flow-research §③ 的实现面）：**一张规格表两个消费方**——
// 写工具 schema 由 core/op-spec.ts 的 OP_SPECS **派生**（口径卡 §一），手动面板与 AI 面共用同一份 spec。
// 首版 19 件 = 读 5 / 写 13 / 会话 1（plan §3 T1 定稿；笔刷 = 1 件 brush + modifier 枚举，D-H ①）。
// 纪律：flat-first 平铺标量（①-21）· 每调用上限（①-22）· seed 全显式 · 教学式报错提示写进描述。
import type { OpSpec, ParamSpec } from '../core/op-spec'
import { OP_SPECS } from '../core/op-spec'
import { COORD_LIMIT } from '../core/coords'

/** 每调用影响域上限与治理数字（ai-flow-research §③-3 的数字锚定；改动须记口径卡 + log——§八-2） */
export const AI_LIMITS = {
  /** 单调用全域上限（锚 = 16³ 单 chunk 体积；对齐 PetitMaker paint ≤4000 同量级） */
  cellsPerCall: 4096,
  /** 全图精读门槛（非空块 ≤4096 且 AABB 各维 ≤16 才可 read_map_full） */
  fullReadMaxCells: 4096,
  fullReadMaxAxis: 16,
  /** 笔刷：每维 ≤4（64 格/锚点）、锚点 ≤32、并集体积 ≤512 */
  brushMaxAxis: 4,
  brushMaxAnchors: 32,
  brushUnionMax: 512,
  /** 逐块清单兜底 ≤512 格/调用（实证锚 = Snap2Voxel 200–1600 清单可行，取保守下界） */
  setCellsMax: 512,
  setCellsCoordRange: 16, // 坐标须在 AABB ∪ 16 格内
  presetSizeMaxAxis: 16,
  raiseLayersMax: 16,
  addLayerCountMax: 16,
  recolorFromKeysMax: 16,
  mirrorCopiesMax: 8,
  bevelPassesMax: 4,
  undoStepsMax: 4,
  /** 动态 wide 阈值：单调用预估影响 >1024 格（全域 1/4）或 scope=all 的任何写（§③-4） */
  wideDynamicCells: 1024,
  /** 轮预算 24/job（锚 = PetitMaker 40 / 剩 5 按任务尺度收缩）；剩 3 警告一次 */
  roundBudget: 24,
  budgetWarnRemaining: 3,
  /** 目录输出上限 */
  listRowsMax: 64,
  summaryPaletteRowsMax: 32,
  /** 回执编辑区 y-slice ≤16 行（天然 < PetitMaker SNAPSHOT_MAX=24） */
  snapshotMaxRows: 16,
  /** update_plan：3–6 阶段、至多 2 次落档/job（①-4） */
  planStagesMin: 3,
  planStagesMax: 6,
  planCommitsMax: 2,
} as const

/** JSON-Schema 参数面（OpenAI 兼容 function calling 的 parameters 形状） */
interface AiParamSchema {
  readonly type: 'integer' | 'number' | 'string' | 'boolean' | 'array' | 'object'
  readonly description: string
  readonly enum?: readonly string[]
  readonly items?: { readonly type: 'integer' | 'string'; readonly maximum?: number }
  readonly minimum?: number
  readonly maximum?: number
  readonly maxItems?: number
  readonly default?: unknown
}

export interface AiToolSchema {
  readonly name: string
  readonly description: string
  readonly parameters: { readonly type: 'object'; readonly properties: Readonly<Record<string, AiParamSchema>>; readonly required: readonly string[] }
  /** 读工具免闸（口径卡 §二） */
  readonly readOnly: boolean
  /** 静态 wide 标注：clearScope / mirrorArray / raiseByLayers / undo / redo（§③-4 五件） */
  readonly wideStatic: boolean
}

// ── 名字映射（camelCase 操作名 ↔ snake_case 工具名）──

const OP_TOOL_NAMES: Readonly<Record<string, string>> = {
  noiseFill: 'noise_fill',
  noiseSculpt: 'noise_sculpt',
  presetShape: 'preset_shape',
  raiseByLayers: 'raise_layers',
  addLayer: 'add_layer',
  recolor: 'recolor',
  clearScope: 'clear_scope',
  mirrorArray: 'mirror_array',
  bevelEdges: 'bevel_edges',
}

export function opToolName(opName: string): string {
  return OP_TOOL_NAMES[opName] ?? opName
}

export function toolOpName(toolName: string): string | undefined {
  return Object.entries(OP_TOOL_NAMES).find(([, t]) => t === toolName)?.[0]
}

// ── 类型映射表（V8 的一致性断言源）：OP_SPECS 参数类型 → AI schema 属性 ──
// 一致性 = 本映射逐类型成立，不是字面同名（ai-flow-research §⑥-1）。

/** 每个写工具的 AI 面参数收紧上限（spec 已有的不动，只补 AI 面收紧值） */
const FIELD_MAX: Readonly<Record<string, number>> = {
  'raiseByLayers/layers': AI_LIMITS.raiseLayersMax,
  'addLayer/count': AI_LIMITS.addLayerCountMax,
  'mirrorArray/copies': AI_LIMITS.mirrorCopiesMax,
  'bevelEdges/passes': AI_LIMITS.bevelPassesMax,
}

/** coord3 的轴级规则（AI 面收紧 / 空间不变量）：presetShape size 每维 ≤16；
 *  origin 三轴 = `REQ-065` 整数域 ±2¹²（原 `y: { min: 0 }` 是 `REQ-059` 的 y≥0 下界，已废止）。 */
const COORD_DOMAIN = { min: -COORD_LIMIT, max: COORD_LIMIT } as const
const COORD_RULES: Readonly<Record<string, Readonly<Partial<Record<'x' | 'y' | 'z', { min?: number; max?: number }>>>>> = {
  'presetShape/size': { x: { max: AI_LIMITS.presetSizeMaxAxis }, y: { max: AI_LIMITS.presetSizeMaxAxis }, z: { max: AI_LIMITS.presetSizeMaxAxis } },
  'presetShape/origin': { x: COORD_DOMAIN, y: COORD_DOMAIN, z: COORD_DOMAIN },
}

/** `REQ-027`（门四）/`D6` 颜色寻址面：**项目键（数字）** 与 **规范色值** 是首选回填值，
 *  身份串保持兼容；**不接受的**是 `identity#key` 拼接（`color:pink#14`——读面已不再输出这种形式）。 */
const PALETTE_DESC =
  '颜色：用 key 数字（如 5；也可写成字符串 "5"）或规范 HEX 色值（如 "#3b6ea5"）；身份串（如 "color:red"）也接受。' +
  '**勿拼接 identity#key**（如 "color:pink#14" 非法，会被拒绝并给正确示例）。' +
  '内置 16 色；自建色按规范色值寻址，写入成功时才登记进项目色板'

interface MappedParam {
  readonly properties: Record<string, AiParamSchema>
  readonly required: string[]
}

/** 单个 OP_SPECS 参数 → 平铺的 schema 属性（flat-first：受约束解码器不吃嵌套可选对象） */
export function mapParam(opName: string, p: ParamSpec): MappedParam {
  switch (p.type) {
    case 'int':
    case 'float': {
      const capped = FIELD_MAX[`${opName}/${p.field}`] ?? p.max
      return {
        properties: {
          [p.field]: {
            type: p.type === 'int' ? 'integer' : 'number',
            description: p.label,
            ...(p.min !== undefined ? { minimum: p.min } : {}),
            ...(capped !== undefined ? { maximum: capped } : {}),
          },
        },
        required: p.optional === true ? [] : [p.field],
      }
    }
    case 'coord3':
      // coord3 → x/y/z 三标量（前缀 = 字段名，防 origin/size 撞名）；轴级规则见 COORD_RULES
      {
        const rules = COORD_RULES[`${opName}/${p.field}`] ?? {}
        const axisParam = (axis: 'x' | 'y' | 'z'): AiParamSchema => {
          const r = rules[axis]
          return {
            type: 'integer',
            // `REQ-065`：origin 三轴同域（±4096 整数，含负值）；不再有 y=0 下界特例
            description: p.field === 'origin' ? `${p.label} ${axis}（±${COORD_LIMIT} 整数域）` : `${p.label} ${axis}`,
            ...(r?.min !== undefined ? { minimum: r.min } : {}),
            ...(r?.max !== undefined ? { maximum: r.max } : {}),
          }
        }
        return {
          properties: {
            [`${p.field}_x`]: axisParam('x'),
            [`${p.field}_y`]: axisParam('y'),
            [`${p.field}_z`]: axisParam('z'),
          },
          required: p.optional === true ? [] : [`${p.field}_x`, `${p.field}_y`, `${p.field}_z`],
        }
      }
    case 'scope':
      // scope → target_kind + target_id 平铺（REQ-051 的宾语面；名称→id 不做自然语言匹配）
      return {
        properties: {
          target_kind: {
            type: 'string',
            description: '范围（宾语）类型：all=全体块 / manual=手工块 / part=构件 / composition=组合',
            enum: ['all', 'manual', 'part', 'composition'],
          },
          target_id: { type: 'string', description: '构件或组合的 id（target_kind 为 part/composition 时必填；先用 list_parts / list_compositions 查 id）' },
        },
        required: ['target_kind'],
      }
    case 'shape':
      return { properties: { shape: { type: 'string', description: '形状', enum: ['box', 'cylinder', 'cone', 'sphere'] } }, required: ['shape'] }
    case 'axis':
      return { properties: { axis: { type: 'string', description: '镜像轴', enum: ['x', 'z'] } }, required: ['axis'] }
    case 'blockKey':
      return {
        properties: { [p.field === 'toKey' ? 'to' : p.field]: { type: 'string', description: PALETTE_DESC } },
        required: p.optional === true ? [] : [p.field === 'toKey' ? 'to' : p.field],
      }
    case 'blockKeys': {
      const name = p.field === 'fromKeys' ? 'from' : p.field
      return {
        properties: {
          [name]: {
            type: 'array',
            description: `${PALETTE_DESC}（可混用；≤${AI_LIMITS.recolorFromKeysMax} 个）`,
            items: { type: 'string' },
            maxItems: AI_LIMITS.recolorFromKeysMax,
          },
        },
        required: p.optional === true ? [] : [name],
      }
    }
    case 'boolean':
      return { properties: { [p.field]: { type: 'boolean', description: p.label } }, required: p.optional === true ? [] : [p.field] }
    case 'dirs':
      // NoiseDirs → 六个平铺布尔
      return {
        properties: {
          px: { type: 'boolean', description: '向 +x' },
          nx: { type: 'boolean', description: '向 −x' },
          py: { type: 'boolean', description: '向 +y' },
          ny: { type: 'boolean', description: '向 −y（到 y=0 即止，REQ-059）' },
          pz: { type: 'boolean', description: '向 +z' },
          nz: { type: 'boolean', description: '向 −z' },
        },
        required: ['px', 'nx', 'py', 'ny', 'pz', 'nz'],
      }
  }
}

/** 一个 OP_SPECS 条目 → 一个 AI 写工具（V8：恰好一个；参数名/类型/上下限/可选性由 mapParam 保证一致） */
export function deriveWriteTool(spec: OpSpec): AiToolSchema {
  const properties: Record<string, AiParamSchema> = {}
  const required = new Set<string>()
  for (const p of spec.params) {
    const mapped = mapParam(spec.name, p)
    Object.assign(properties, mapped.properties)
    for (const r of mapped.required) required.add(r)
  }
  // target_id 的条件必填写进描述（schema 层不表达条件依赖；执行器兜底校验）
  if (properties.target_id) {
    properties.target_id = { ...properties.target_id, description: `${properties.target_id.description}；target_kind 为 part/composition 时必填` }
  }
  return {
    name: opToolName(spec.name),
    description: `${spec.label}——${spec.semantics}。${spec.kind === 'relative' ? '（相对操作：重复应用继续改）' : '（绝对操作：同参数重复应用终态不变）'}`,
    parameters: { type: 'object', properties, required: [...required] },
    readOnly: false,
    wideStatic: spec.name === 'clearScope' || spec.name === 'mirrorArray' || spec.name === 'raiseByLayers',
  }
}

// ── 非派生工具（读 5 件 + brush + set_cells + undo/redo + update_plan）──

const obj = (properties: Record<string, AiParamSchema>, required: string[]): AiToolSchema['parameters'] => ({
  type: 'object',
  properties,
  required,
})

const READ_TOOLS: readonly AiToolSchema[] = [
  {
    name: 'get_model_summary',
    description:
      '全图摘要：AABB / 每层块数 / 调色板与已用色表（三字段 identity·key·color，key 与 color 可直接回填改色） / 构件与组合计数。' +
      '改动前先看它——不要凭记忆猜现状；改色用 key 数字或 color 规范色值，勿拼接 identity#key',
    parameters: obj({ cursor: { type: 'integer', description: '调色板表分页游标（>32 色时翻页；缺省 0）' } }, []),
    readOnly: true,
    wideStatic: false,
  },
  {
    name: 'read_map_full',
    description: '全图精读：按 y 层切片的一字一格文本（每格一个颜色字符，"."=空）。仅当模型 ≤4096 块且 AABB 各维 ≤16 可用；超限会被拒——先 get_model_summary、再按构件/组合分读',
    parameters: obj({ from_y: { type: 'integer', description: '起始层（缺省 minY）' }, to_y: { type: 'integer', description: '结束层（含；缺省 minY+15）' } }, []),
    readOnly: true,
    wideStatic: false,
  },
  {
    name: 'list_parts',
    description: '构件目录：id / 名字 / 块数 / AABB（先拿 id 再把 id 传给写工具的 target_id）',
    parameters: obj({ name_contains: { type: 'string', description: '按名字过滤（可选）' } }, []),
    readOnly: true,
    wideStatic: false,
  },
  {
    name: 'list_compositions',
    description: '组合目录：id / 名字 / 成员构件数 / 块数 / AABB（"把屋顶改红"的屋顶 = 组合，先在这里查 id）',
    parameters: obj({ name_contains: { type: 'string', description: '按名字过滤（可选）' } }, []),
    readOnly: true,
    wideStatic: false,
  },
  {
    name: 'get_selection',
    description: '当前选中（构件 / 组合 id）与当前范围引用——用户说"这个/它"时先查这里',
    parameters: obj({}, []),
    readOnly: true,
    wideStatic: false,
  },
]

const BRUSH_TOOL: AiToolSchema = {
  name: 'brush',
  description: `方形笔刷一笔（D-H ①：1 件 + modifier 枚举）。size 每维 1–${AI_LIMITS.brushMaxAxis}；anchors ≤${AI_LIMITS.brushMaxAnchors} 个锚点（锚点 = 笔刷最小角，体积向 +x/+y/+z 延伸）；并集 ≤${AI_LIMITS.brushUnionMax} 格。place+additive 只写空气、place+override 逐块覆盖；erase 清除；paint 只改已有块`,
  parameters: obj(
    {
      modifier: { type: 'string', description: '笔刷修饰（vengi BrushTool.modifierType 同型）', enum: ['place', 'erase', 'paint', 'override'] },
      size_x: { type: 'integer', description: '笔刷 x 维（1–4）', minimum: 1, maximum: AI_LIMITS.brushMaxAxis },
      size_y: { type: 'integer', description: '笔刷 y 维（1–4）', minimum: 1, maximum: AI_LIMITS.brushMaxAxis },
      size_z: { type: 'integer', description: '笔刷 z 维（1–4）', minimum: 1, maximum: AI_LIMITS.brushMaxAxis },
      key: { type: 'string', description: PALETTE_DESC },
      anchors: {
        type: 'array',
        description: `锚点列表（≤${AI_LIMITS.brushMaxAnchors} 个；每个 = [x, y, z]，三轴须为 ±${COORD_LIMIT} 内的整数；域外目标被丢弃并计数）`,
        items: { type: 'integer' },
        maxItems: AI_LIMITS.brushMaxAnchors,
      },
    },
    ['modifier', 'size_x', 'size_y', 'size_z', 'anchors'],
  ),
  readOnly: false,
  wideStatic: false,
}

const SET_CELLS_TOOL: AiToolSchema = {
  name: 'set_cells',
  description: `逐块清单兜底（笔刷/操作表达不了时的最后手段）：显式坐标列表，恰好一次调用一条补丁。≤${AI_LIMITS.setCellsMax} 格；坐标须在模型 AABB ±${AI_LIMITS.setCellsCoordRange} 格内；三轴须为 ±${COORD_LIMIT} 内的整数（含负值），非整数 / 非有限 / 越界目标会被丢弃并计数`,
  parameters: obj(
    {
      cells: {
        type: 'array',
        description: `目标格（≤${AI_LIMITS.setCellsMax} 个；每个 = [x, y, z, key]，key 为项目键数字（如 5）、规范 HEX（如 "#3b6ea5"）或身份串（如 "color:red"），"air" 表示删除；**勿拼接 identity#key**）`,
        items: { type: 'string' },
        maxItems: AI_LIMITS.setCellsMax,
      },
    },
    ['cells'],
  ),
  readOnly: false,
  wideStatic: false,
}

const UNDO_REDO_TOOLS: readonly AiToolSchema[] = [
  {
    name: 'undo',
    description: `撤销最近的 AI 写（带地板：退不进本次任务开始前用户的编辑）。steps 1–${AI_LIMITS.undoStepsMax}`,
    parameters: obj({ steps: { type: 'integer', description: '步数', minimum: 1, maximum: AI_LIMITS.undoStepsMax } }, ['steps']),
    readOnly: false,
    wideStatic: true, // 口径卡 §二静态 wide 五件之一
  },
  {
    name: 'redo',
    description: `重做被撤销的写。steps 1–${AI_LIMITS.undoStepsMax}`,
    parameters: obj({ steps: { type: 'integer', description: '步数', minimum: 1, maximum: AI_LIMITS.undoStepsMax } }, ['steps']),
    readOnly: false,
    wideStatic: true,
  },
]

const UPDATE_PLAN_TOOL: AiToolSchema = {
  name: 'update_plan',
  description: `提交 3–6 阶段的名词短语计划（每阶段 ≤30 字）。非 yolo 档计划本身也要过闸门（计划是对用户的承诺，不是草稿）；至多 ${AI_LIMITS.planCommitsMax} 次落档`,
  parameters: obj(
    { stages: { type: 'array', description: '阶段列表（3–6 个名词短语）', items: { type: 'string' } } },
    ['stages'],
  ),
  readOnly: false, // 会话工具：不改模型，但受计划闸门管辖（gates.ts 单独处理）
  wideStatic: false,
}

// ── 全集：19 件 = 读 5 + 写 13 + 会话 1 ──

export const AI_TOOLS: readonly AiToolSchema[] = [
  ...READ_TOOLS,
  ...OP_SPECS.map(deriveWriteTool),
  BRUSH_TOOL,
  SET_CELLS_TOOL,
  ...UNDO_REDO_TOOLS,
  UPDATE_PLAN_TOOL,
]

export function getAiTool(name: string): AiToolSchema | undefined {
  return AI_TOOLS.find((t) => t.name === name)
}

export function isReadTool(name: string): boolean {
  return getAiTool(name)?.readOnly === true
}

export function isWriteTool(name: string): boolean {
  const t = getAiTool(name)
  return t !== undefined && !t.readOnly && name !== 'update_plan'
}

/** 动态 wide（§③-4）：单调用预估影响 >1024 格，或 scope=all 的任何写 */
export function isDynamicWide(estimatedCells: number, scopeIsAll: boolean): boolean {
  return scopeIsAll || estimatedCells > AI_LIMITS.wideDynamicCells
}
