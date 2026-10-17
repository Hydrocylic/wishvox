// 操作规格表（REQ-014 ①：8 个操作的名字 / 参数 / 语义）——UI 表单与 tests 枚举的唯一出处。
// 参数面 = plan §1.1（拍板 2026-10-03：presetShape = 盒·柱·锥·球）。
// kind：absolute = 同参数（同范围引用）重复应用 ⇒ 终态不变；relative = 可逆但不幂等。
//   ⚠ bevelEdges 按削角语义是"逐次侵蚀"（上一轮削完的边界成为新一轮的角），实现上归 relative——
//   plan §1.1 原注把 #8 列在绝对类，此处按 §5.2 的降级口径（参数化最小面 + 记账）修正为 relative，差异写进轮次 log。
import type { NoiseDirs, OpName } from './types'

type OpKind = 'absolute' | 'relative'

type ParamType =
  | 'int'
  | 'float'
  | 'coord3'
  | 'scope'
  | 'shape'
  | 'axis'
  | 'blockKey'
  | 'blockKeys'
  | 'boolean'
  | 'dirs'

export interface ParamSpec {
  readonly field: string
  readonly label: string
  readonly type: ParamType
  readonly min?: number
  readonly max?: number
  readonly step?: number
  readonly optional?: boolean
}

export interface OpSpec {
  readonly name: OpName
  /** 中文显示名（构件默认名也用它拼序号） */
  readonly label: string
  readonly kind: OpKind
  readonly params: readonly ParamSpec[]
  readonly semantics: string
}

export const OP_SPECS: readonly OpSpec[] = [
  {
    name: 'noiseFill',
    label: '噪声填充',
    kind: 'absolute',
    params: [
      { field: 'scope', label: '范围', type: 'scope' },
      { field: 'density', label: '密度', type: 'float', min: 0, max: 1, step: 0.05 },
      { field: 'keys', label: '方块', type: 'blockKeys' },
      { field: 'seed', label: '种子', type: 'int', min: 0 },
    ],
    semantics: '范围（解析坐标集的包围盒）内的空位按密度以种子伪随机填块；已有块不动。重复应用不再命中 ⇒ 终态不变',
  },
  {
    // F8 噪声模块（r02 前半 · REQ-057）：v2 文件与手动调用面共用这一条规格。
    name: 'noiseSculpt',
    label: '噪声雕塑',
    kind: 'relative',
    params: [
      { field: 'scope', label: '范围', type: 'scope' },
      { field: 'amplitude', label: '幅度', type: 'int', min: 1, max: 4 },
      { field: 'density', label: '密度', type: 'float', min: 0.01, max: 1, step: 0.05 },
      { field: 'seed', label: '种子', type: 'int', min: 0 },
      { field: 'dirs', label: '方位', type: 'dirs' },
      { field: 'key', label: '方块', type: 'blockKey' },
    ],
    semantics: '范围内每个块的表面位点（该方位外侧是空气）按密度以种子抽签：一半概率生长（向外放块，可按幅度延伸）/ 一半概率侵蚀（删掉表面块）；一次性生成、无动画（重复应用继续改 ⇒ 相对操作）',
  },
  {
    name: 'presetShape',
    label: '预设体块',
    kind: 'absolute',
    params: [
      { field: 'shape', label: '形状', type: 'shape' },
      { field: 'origin', label: '原点(角)', type: 'coord3' },
      { field: 'size', label: '尺寸', type: 'coord3' },
      { field: 'key', label: '方块', type: 'blockKey' },
      { field: 'hollow', label: '掏空', type: 'boolean', optional: true },
    ],
    semantics: '在 origin..origin+size-1 的包围盒里生成盒 / 柱（y 轴，x z 为直径）/ 锥（底在下尖在上）/ 球（三轴直径）；掏空 = 外形减去各维缩 2 的内形',
  },
  {
    name: 'raiseByLayers',
    label: '按层抬升',
    kind: 'relative',
    params: [
      { field: 'scope', label: '范围', type: 'scope' },
      { field: 'layers', label: '层数', type: 'int', min: 1 },
    ],
    semantics: '范围内所有块整体沿 +y 平移 N 层（相对操作：重复应用继续抬）',
  },
  {
    name: 'addLayer',
    label: '加层',
    kind: 'relative',
    params: [
      { field: 'scope', label: '范围', type: 'scope' },
      { field: 'count', label: '层数', type: 'int', min: 1 },
      { field: 'key', label: '方块', type: 'blockKey' },
    ],
    semantics: '范围顶面轮廓（每 (x,z) 列的最高块）向上复制 count 层，材质用指定方块（相对操作）',
  },
  {
    name: 'recolor',
    label: '换材质',
    kind: 'absolute',
    params: [
      { field: 'scope', label: '范围', type: 'scope' },
      { field: 'toKey', label: '换成', type: 'blockKey' },
      { field: 'fromKeys', label: '仅这些', type: 'blockKeys', optional: true },
    ],
    semantics: '范围内的块改用 toKey（可选：只换 fromKeys 里的身份）——"屋顶改红"的手动版',
  },
  {
    name: 'clearScope',
    label: '范围清除',
    kind: 'absolute',
    params: [{ field: 'scope', label: '范围', type: 'scope' }],
    semantics: '范围内全部置空（绝对操作，幂等）',
  },
  {
    name: 'mirrorArray',
    label: '镜像阵列',
    kind: 'absolute',
    params: [
      { field: 'scope', label: '范围', type: 'scope' },
      { field: 'axis', label: '轴', type: 'axis' },
      { field: 'copies', label: '份数', type: 'int', min: 1 },
      { field: 'spacing', label: '间距', type: 'int', min: 0 },
    ],
    semantics: '沿轴在范围包围盒外侧生成 copies 份镜像（翻转）副本，相邻副本间隔 spacing 个空位',
  },
  {
    name: 'bevelEdges',
    label: '抹角修边',
    kind: 'relative',
    params: [
      { field: 'scope', label: '范围', type: 'scope' },
      { field: 'radius', label: '半径', type: 'int', min: 1, max: 3 },
      { field: 'passes', label: '遍数', type: 'int', min: 1 },
    ],
    semantics: '首版参数化最小面：按 26 邻域实心计数削块——radius 1 削角(≤7)、2 加削棱(≤11)、3 连面一起削(≤17)，passes 轮迭代；逐次侵蚀 ⇒ 归相对类',
  },
]

const BY_NAME = new Map(OP_SPECS.map((s) => [s.name, s]))

export function getOpSpec(name: string): OpSpec | undefined {
  return BY_NAME.get(name as OpName)
}

function scopeLabel(scope: unknown): string {
  if (typeof scope !== 'object' || scope === null) return '?'
  const s = scope as { kind?: string; partId?: string; compositionId?: string }
  if (s.kind === 'all') return '全体'
  if (s.kind === 'manual') return '手工块'
  if (s.kind === 'part') return `构件#${s.partId}`
  if (s.kind === 'composition') return `组合#${s.compositionId}`
  return s.kind ?? '?'
}

function num(v: unknown): string {
  return typeof v === 'number' ? String(v) : '?'
}

/** 六向勾选摘要（如 "+x+y" = px 与 py 勾选） */
function dirsLabel(dirs: unknown): string {
  if (typeof dirs !== 'object' || dirs === null) return '?'
  const d = dirs as NoiseDirs
  let s = ''
  if (d.px) s += '+x'
  if (d.nx) s += '-x'
  if (d.py) s += '+y'
  if (d.ny) s += '-y'
  if (d.pz) s += '+z'
  if (d.nz) s += '-z'
  return s || '无'
}

/** Patch.label 的拼法：操作名 + 参数摘要（只放标量与范围引用，不展开块集合） */
export function formatOpLabel(name: OpName, params: Record<string, unknown>): string {
  const spec = getOpSpec(name)
  const label = spec?.label ?? name
  switch (name) {
    case 'noiseFill': {
      const p = params as { scope?: unknown; density?: unknown; seed?: unknown }
      return `${label}(${scopeLabel(p.scope)}, 密度=${num(p.density)}, 种子=${num(p.seed)})`
    }
    case 'noiseSculpt': {
      const p = params as { scope?: unknown; amplitude?: unknown; density?: unknown; seed?: unknown; dirs?: NoiseDirs }
      return `${label}(${scopeLabel(p.scope)}, 幅度=${num(p.amplitude)}, 密度=${num(p.density)}, 种子=${num(p.seed)}, 向=${dirsLabel(p.dirs)})`
    }
    case 'presetShape': {
      const p = params as { shape?: unknown; origin?: unknown; size?: unknown; hollow?: unknown }
      const o = p.origin as { x?: number; y?: number; z?: number } | undefined
      const s = p.size as { x?: number; y?: number; z?: number } | undefined
      return `${label}(${num(p.shape)} @${num(o?.x)},${num(o?.y)},${num(o?.z)} ×${num(s?.x)},${num(s?.y)},${num(s?.z)}${p.hollow ? ', 掏空' : ''})`
    }
    case 'raiseByLayers':
    case 'addLayer': {
      const p = params as { scope?: unknown; layers?: unknown; count?: unknown; key?: unknown }
      const n = name === 'raiseByLayers' ? num(p.layers) : num(p.count)
      return `${label}(${scopeLabel(p.scope)}, ${n} 层)`
    }
    case 'recolor': {
      const p = params as { scope?: unknown; toKey?: unknown }
      return `${label}(${scopeLabel(p.scope)} → 键${num(p.toKey)})`
    }
    case 'clearScope': {
      const p = params as { scope?: unknown }
      return `${label}(${scopeLabel(p.scope)})`
    }
    case 'mirrorArray': {
      const p = params as { scope?: unknown; axis?: unknown; copies?: unknown; spacing?: unknown }
      return `${label}(${scopeLabel(p.scope)}, 轴=${num(p.axis)}, ${num(p.copies)}份, 间距=${num(p.spacing)})`
    }
    case 'bevelEdges': {
      const p = params as { scope?: unknown; radius?: unknown; passes?: unknown }
      return `${label}(${scopeLabel(p.scope)}, 半径=${num(p.radius)}, ${num(p.passes)}遍)`
    }
  }
}
