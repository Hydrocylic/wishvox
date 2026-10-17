// r03 · T1/V8 工具面同源（L1）：AI_TOOLS = 19 件（读 5 / 写 13 / 会话 1）；
// 每个 OP_SPECS 条目 ⇒ 恰好一个 AI 工具；一致性 = 类型映射表逐条成立（ai-flow-research §⑥-1），
// 非字面同名：blockKey/blockKeys → 颜色寻址面（身份串 / 规范色值 / 项目键，`REQ-027`）· scope → target_kind+target_id 平铺 · coord3 → 三标量。
import { describe, expect, it } from 'vitest'
import { OP_SPECS } from '../../src/core/op-spec'
import { COORD_LIMIT } from '../../src/core/coords'
import { AI_LIMITS, AI_TOOLS, deriveWriteTool, getAiTool, isDynamicWide, isReadTool, isWriteTool, opToolName } from '../../src/ai/tools'

describe('V8 · 工具面清单（19 件 = 读 5 / 写 13 / 会话 1）', () => {
  it('总数 19；读 5 / 写 13 / 会话 1（update_plan）', () => {
    expect(AI_TOOLS).toHaveLength(19)
    const names = AI_TOOLS.map((t) => t.name)
    expect(new Set(names).size).toBe(19) // 无重名
    const read = AI_TOOLS.filter((t) => t.readOnly)
    const session = AI_TOOLS.filter((t) => t.name === 'update_plan')
    const write = AI_TOOLS.filter((t) => !t.readOnly && t.name !== 'update_plan')
    expect(read.map((t) => t.name)).toEqual(['get_model_summary', 'read_map_full', 'list_parts', 'list_compositions', 'get_selection'])
    expect(write).toHaveLength(13)
    expect(session).toHaveLength(13 - 13 + 1) // 1 件
  })

  it('每个 OP_SPECS 条目 ⇒ 恰好一个 AI 写工具（snake_case 名 + 双向映射）', () => {
    for (const spec of OP_SPECS) {
      const toolName = opToolName(spec.name)
      const tool = getAiTool(toolName)
      expect(tool, `${spec.name} → ${toolName}`).toBeDefined()
      expect(tool!.readOnly).toBe(false)
      expect(tool!.description).toContain(spec.label)
    }
    // 反向：每个派生工具都能找回唯一的 op
    for (const t of AI_TOOLS.filter((x) => !x.readOnly && !['brush', 'set_cells', 'undo', 'redo', 'update_plan'].includes(x.name))) {
      expect(opToolName(t.name) !== undefined || ['brush', 'set_cells', 'undo', 'redo', 'update_plan'].includes(t.name)).toBe(true)
    }
  })
})

describe('V8 · 类型映射表逐条成立', () => {
  it('int/float → 标量（min/max；AI 面收紧值生效）', () => {
    const noise = getAiTool('noise_sculpt')!
    expect(noise.parameters.properties.amplitude).toMatchObject({ type: 'integer', minimum: 1, maximum: 4 })
    expect(noise.parameters.properties.density).toMatchObject({ type: 'number', minimum: 0.01, maximum: 1 })
    const raise = getAiTool('raise_layers')!
    expect(raise.parameters.properties.layers).toMatchObject({ maximum: AI_LIMITS.raiseLayersMax })
    const addL = getAiTool('add_layer')!
    expect(addL.parameters.properties.count).toMatchObject({ maximum: AI_LIMITS.addLayerCountMax })
    const mirror = getAiTool('mirror_array')!
    expect(mirror.parameters.properties.copies).toMatchObject({ maximum: AI_LIMITS.mirrorCopiesMax })
    const bevel = getAiTool('bevel_edges')!
    expect(bevel.parameters.properties.passes).toMatchObject({ maximum: AI_LIMITS.bevelPassesMax })
  })

  it('coord3 → x/y/z 三标量（origin 与 size 各三件，不撞名）', () => {
    const preset = getAiTool('preset_shape')!
    for (const f of ['origin_x', 'origin_y', 'origin_z', 'size_x', 'size_y', 'size_z']) {
      expect(preset.parameters.properties[f], f).toMatchObject({ type: 'integer' })
    }
    expect(preset.parameters.properties.size_x).toMatchObject({ maximum: AI_LIMITS.presetSizeMaxAxis })
    // `REQ-065`：origin 三轴同域 ±2¹²（原 y 锁 0 = REQ-059 的 y≥0 下界，已废止）
    for (const f of ['origin_x', 'origin_y', 'origin_z'] as const) {
      expect(preset.parameters.properties[f], f).toMatchObject({ minimum: -COORD_LIMIT, maximum: COORD_LIMIT })
    }
    expect(preset.parameters.required).toContain('origin_x')
  })

  it('scope → target_kind 枚举 + target_id（平铺，无嵌套对象）', () => {
    for (const name of ['noise_fill', 'recolor', 'clear_scope']) {
      const t = getAiTool(name)!
      expect(t.parameters.properties.target_kind).toMatchObject({ type: 'string', enum: ['all', 'manual', 'part', 'composition'] })
      expect(t.parameters.properties.target_id).toMatchObject({ type: 'string' })
      expect(t.parameters.required).toContain('target_kind')
      expect(t.parameters.required).not.toContain('target_id') // 条件必填（part/composition）由执行器兜底校验
      // flat-first：properties 里不允许出现嵌套 object 类型
      for (const p of Object.values(t.parameters.properties)) expect(p.type).not.toBe('object')
    }
    // presetShape 不接 scope（保持 r02 语义：绝对放置）
    expect(getAiTool('preset_shape')!.parameters.properties.target_kind).toBeUndefined()
  })

  it('blockKey/blockKeys → 颜色寻址面：不再用 enum 锁死内置 16 色（REQ-027 门四 · B-07）', () => {
    // 旧断言（enum = 16 个内置身份）与 `REQ-027` 冲突：enum 会把"自建色 + 规范 HEX / 项目键"寻址挡在门外，
    // 而 B-07 的判据正要求 AI 能按**返回键或规范色值**改自建色。改成"字符串 + 三态说明"。
    for (const name of ['recolor', 'noise_sculpt', 'add_layer', 'preset_shape', 'brush']) {
      const t = getAiTool(name)!
      const keyField = name === 'recolor' ? 'to' : 'key'
      const prop = t.parameters.properties[keyField]!
      expect(prop.type, name).toBe('string')
      expect(prop.enum, name).toBeUndefined()
      expect(prop.description, name).toContain('#')
    }
    expect(getAiTool('recolor')!.parameters.properties.from).toMatchObject({ type: 'array', maxItems: AI_LIMITS.recolorFromKeysMax })
    expect(getAiTool('noise_fill')!.parameters.properties.keys?.type).toBe('array')
    // 内置 16 色仍是默认面（描述里给出示例身份）
    expect(getAiTool('brush')!.parameters.properties.key?.description).toContain('color:red')
  })

  it('dirs → 六个平铺布尔；shape/axis → 枚举；boolean → 布尔', () => {
    const sculpt = getAiTool('noise_sculpt')!
    for (const d of ['px', 'nx', 'py', 'ny', 'pz', 'nz']) {
      expect(sculpt.parameters.properties[d], d).toMatchObject({ type: 'boolean' })
    }
    expect(getAiTool('preset_shape')!.parameters.properties.shape).toMatchObject({ enum: ['box', 'cylinder', 'cone', 'sphere'] })
    expect(getAiTool('mirror_array')!.parameters.properties.axis).toMatchObject({ enum: ['x', 'z'] })
    expect(getAiTool('preset_shape')!.parameters.properties.hollow).toMatchObject({ type: 'boolean' })
  })

  it('可选性与 spec 一致（optional 参数不进 required）', () => {
    const spec = OP_SPECS.find((s) => s.name === 'recolor')!
    const fromSpec = spec.params.find((p) => p.field === 'fromKeys')!
    expect(fromSpec.optional).toBe(true)
    expect(getAiTool('recolor')!.parameters.required).not.toContain('from')
    expect(getAiTool('recolor')!.parameters.required).toContain('to')
  })

  it('spec 派生是纯函数：同 spec 两次派生相等', () => {
    const spec = OP_SPECS.find((s) => s.name === 'noiseFill')!
    expect(deriveWriteTool(spec)).toEqual(deriveWriteTool(spec))
  })
})

describe('V8 · wide 标注与上限数字', () => {
  it('静态 wide 五件：clear_scope / mirror_array / raise_layers / undo / redo', () => {
    for (const name of ['clear_scope', 'mirror_array', 'raise_layers', 'undo', 'redo']) {
      expect(getAiTool(name)!.wideStatic, name).toBe(true)
    }
    const staticWide = AI_TOOLS.filter((t) => t.wideStatic).map((t) => t.name).sort()
    expect(staticWide).toEqual(['clear_scope', 'mirror_array', 'raise_layers', 'redo', 'undo'])
  })

  it('动态 wide 阈值：>1024 格或 scope=all（§③-4）', () => {
    expect(isDynamicWide(1024, false)).toBe(false)
    expect(isDynamicWide(1025, false)).toBe(true)
    expect(isDynamicWide(1, true)).toBe(true) // scope=all 的任何写
  })

  it('brush / set_cells 上限（D-H ①：1 件 brush + modifier 枚举）', () => {
    const brush = getAiTool('brush')!
    expect(brush.parameters.properties.modifier).toMatchObject({ enum: ['place', 'erase', 'paint', 'override'] })
    expect(brush.parameters.properties.size_x).toMatchObject({ maximum: AI_LIMITS.brushMaxAxis })
    expect(brush.parameters.properties.anchors).toMatchObject({ maxItems: AI_LIMITS.brushMaxAnchors })
    expect(getAiTool('set_cells')!.parameters.properties.cells).toMatchObject({ maxItems: AI_LIMITS.setCellsMax })
  })

  it('读工具免闸 / 写工具可闸 / update_plan 是会话工具', () => {
    for (const r of ['get_model_summary', 'read_map_full', 'list_parts', 'list_compositions', 'get_selection']) {
      expect(isReadTool(r), r).toBe(true)
      expect(isWriteTool(r)).toBe(false)
    }
    expect(isWriteTool('recolor')).toBe(true)
    expect(isWriteTool('brush')).toBe(true)
    expect(isWriteTool('update_plan')).toBe(false) // 会话工具：走计划闸门
  })
})
