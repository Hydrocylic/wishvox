// r03 · T5b/V6/V7 执行器与守卫（L1）：
// V6 = 坐标数域四路（`REQ-065` ±2¹²：噪声 −y 夹取属工具语义 / presetShape origin / 笔刷底面 / AI 显式坐标）+ 回执可见；
// V7 = 组合宾语三正例（收束逐元素 / 扩张集合判据）+ 一负例（target_id 不存在 ⇒ 教学式报错 + 零执行）；
// ADR-19 = 归属账（part 吸收 / 组合直属 / 抬升随块走 / all 新建）+ undo/redo 镜像 + v2 序列化透传。
import { describe, expect, it } from 'vitest'
import { executeTool } from '../../src/ai/executor'
import { parseWriteArgs } from '../../src/ai/args'
import { coordKey } from '../../src/core/coords'
import { resolveScope } from '../../src/core/scope'
import { decodeProject, encodeProject } from '../../src/io/serialize'
import { Editor } from '../../src/edit/editor'
import { applyProgramOp } from '../../src/ops/apply'
import { setUi } from '../../src/state/editor-store'

/** 小房子：空心砖墙 6×4×6 + 蓝色板屋顶 y=4 + 手工烟囱 + 组合「屋顶」（成员 = 屋顶 part + 烟囱） */
function house(): { editor: Editor; wallPartId: string; roofPartId: string; roofCompId: string; k: (i: string) => number } {
  const editor = new Editor()
  setUi({ mode: 'edit' })
  const k = (i: string): number => editor.volume.palette.list().find((e) => e.identity === i)!.key
  const wall = applyProgramOp(editor.log, 
    { type: 'program', name: 'presetShape', params: { shape: 'box', origin: { x: 0, y: 0, z: 0 }, size: { x: 6, y: 4, z: 6 }, key: k('color:red-brick'), hollow: true } },
    editor.compositions,
  )!
  editor.renamePart(wall.partId!, '墙体')
  const roof = applyProgramOp(editor.log, 
    { type: 'program', name: 'presetShape', params: { shape: 'box', origin: { x: -1, y: 4, z: -1 }, size: { x: 8, y: 1, z: 8 }, key: k('color:blue') } },
    editor.compositions,
  )!
  editor.renamePart(roof.partId!, '屋顶')
  setUi({ currentIdentity: 'color:dark-gray' })
  editor.place(5, 5, 5) // 手工烟囱（无归属，深灰）
  setUi({ currentIdentity: 'color:red' })
  const comp = editor.compositions.create('屋顶')
  editor.addPartToComposition(comp.id, roof.partId!)
  editor.compositions.addManualBlock(comp.id, 5, 5, 5)
  return { editor, wallPartId: wall.partId!, roofPartId: roof.partId!, roofCompId: comp.id, k }
}

const FLOOR = 0
/** `REQ-065` 坐标域上界（±2¹²）——本文件的"越界"判据用它，不再用被取代的 y≥0 下界 */
const DOMAIN = 4096

describe('V6 · 坐标数域四路（REQ-065 ±2¹²，取代 REQ-059 的 y≥0）', () => {
  it('路①：noise_sculpt −y 生长仍夹取在 y=0（工具语义不动，非数域问题）', () => {
    const h = house()
    const r = executeTool(h.editor, 'noise_sculpt', {
      target_kind: 'all', amplitude: 4, density: 1, seed: 11,
      px: false, nx: false, py: false, ny: true, pz: false, nz: false,
      key: 'color:red',
    }, { jobFloor: FLOOR })
    expect(r.ok).toBe(true)
    // 本批只统一**坐标数域**；noiseSculpt 的 −y 夹取是 `ops/noise-sculpt.ts` 的工具语义（tests/core/noise-sculpt.test.ts 锁定）
    for (const b of h.editor.volume.iterBlocks()) expect(b.y).toBeGreaterThanOrEqual(0)
  })

  it('路②：preset_shape origin_y = -1 端到端可写到 y<0（REQ-065 取代 REQ-059 的下界）', () => {
    const h = house()
    const patchesBefore = h.editor.log.patches.length
    const r = executeTool(h.editor, 'preset_shape', {
      shape: 'box', origin_x: 0, origin_y: -1, origin_z: 8, size_x: 2, size_y: 2, size_z: 2, key: 'color:red',
    }, { jobFloor: FLOOR })
    expect(r.ok).toBe(true)
    expect(h.editor.volume.getBlock(0, -1, 8)).not.toBe(0) // 底面真的落在 y=-1（与人工放置一致）
    expect(h.editor.volume.getBlock(1, 0, 9)).not.toBe(0)
    expect(h.editor.log.patches.length).toBe(patchesBefore + 1) // 恰好一条补丁
  })

  it('路③：brush 目标越界（超出 ±2¹²）⇒ 丢弃且回执计数（"超出 ±4096 整数域未放置"），产物坐标都在域内', () => {
    const h = house()
    const r = executeTool(h.editor, 'brush', {
      modifier: 'place', size_x: 2, size_y: 3, size_z: 2, key: 'color:green',
      anchors: [[0, DOMAIN - 1, 10], [3, DOMAIN - 1, 10]], // 体积 y = 4095..4097 ⇒ 4096/4097 两格越界
    }, { jobFloor: FLOOR })
    expect(r.ok).toBe(true)
    expect(r.detail?.outOfBounds).toBeGreaterThan(0)
    expect(r.content).toContain('超出 ±4096 整数域未放置')
    for (const b of h.editor.volume.iterBlocks()) {
      expect(Number.isInteger(b.y)).toBe(true)
      expect(Math.abs(b.y)).toBeLessThanOrEqual(DOMAIN)
    }
  })

  it('路③-2：brush 底面跨越 y=0 ⇒ 允许写到 y<0（REQ-065 取代 REQ-059 的下界）', () => {
    const h = house()
    const r = executeTool(h.editor, 'brush', {
      modifier: 'place', size_x: 2, size_y: 3, size_z: 2, key: 'color:green',
      anchors: [[0, -2, 10], [3, -2, 10]],
    }, { jobFloor: FLOOR })
    expect(r.ok).toBe(true)
    expect(r.detail?.outOfBounds).toBe(0) // y=-2..0 全在合法域内
    expect(h.editor.volume.getBlock(0, -2, 10)).not.toBe(0)
    expect(h.editor.volume.getBlock(3, -1, 11)).not.toBe(0)
    expect(h.editor.volume.getBlock(0, 0, 10)).not.toBe(0)
  })

  it('路④：set_cells 显式 y<0 目标合法可写；域外/非整数/非有限才丢弃 + 回执计数', () => {
    const h = house()
    const patchesBefore = h.editor.log.patches.length
    const r = executeTool(h.editor, 'set_cells', {
      cells: [
        [9, 0, 0, 'color:red'],
        [9, -1, 1, 'color:red'], // REQ-065：y<0 合法 ⇒ 照常落账（原 REQ-059 口径下被丢弃）
        [9, DOMAIN + 1, 1, 'color:red'], // 数域外 → 丢弃 + 计数
        [9, 1, 0, 'air'], // 删除不存在块 → 零变化格（不进补丁）
      ],
    }, { jobFloor: FLOOR })
    expect(r.ok).toBe(true)
    expect(r.detail?.outOfBounds).toBe(1)
    expect(h.editor.log.patches.length).toBe(patchesBefore + 1) // 恰好 1 条补丁
    expect(h.editor.volume.getBlock(9, 0, 0)).toBe(h.k('color:red'))
    expect(h.editor.volume.getBlock(9, -1, 1)).toBe(h.k('color:red'))
  })
})

describe('V7 · 组合宾语（REQ-051 / ai-flow-research §④-1.4）', () => {
  it('正例①：recolor(组合) ⇒ 组合块集合 vs 实际被改集合逐元素相等（收束类）', () => {
    const h = house()
    const scope = resolveScope(h.editor.volume, h.editor.parts, h.editor.compositions, { kind: 'composition', compositionId: h.roofCompId })
    expect(scope.length).toBeGreaterThan(0)
    const r = executeTool(h.editor, 'recolor', { target_kind: 'composition', target_id: h.roofCompId, to: 'color:red', from: ['color:blue', 'color:dark-gray'] }, { jobFloor: FLOOR })
    expect(r.ok).toBe(true)
    // 组合内每块都变红（含手工烟囱）；墙体外一块未动
    for (const c of resolveScope(h.editor.volume, h.editor.parts, h.editor.compositions, { kind: 'composition', compositionId: h.roofCompId })) {
      expect(h.editor.volume.getBlock(c.x, c.y, c.z)).toBe(h.k('color:red'))
    }
    expect(h.editor.volume.getBlock(0, 0, 0)).toBe(h.k('color:red-brick'))
    // 被改集合 = 恰好组合集合（逐元素）：补丁的变更坐标集 == scope 坐标集
    const patch = h.editor.log.patches[h.editor.log.patches.length - 1]!
    const changed = new Set(patch.changes.map((c) => coordKey(c.x, c.y, c.z)))
    expect([...changed].sort()).toEqual(scope.map((c) => coordKey(c.x, c.y, c.z)).sort())
  })

  it('正例②：noise_sculpt(组合) ⇒ 删除集 ⊆ 组合集；新增 ∈ 组合块的表面邻位（扩张类）', () => {
    const h = house()
    const scope = resolveScope(h.editor.volume, h.editor.parts, h.editor.compositions, { kind: 'composition', compositionId: h.roofCompId })
    const scopeSet = new Set(scope.map((c) => coordKey(c.x, c.y, c.z)))
    const r = executeTool(h.editor, 'noise_sculpt', {
      target_kind: 'composition', target_id: h.roofCompId, amplitude: 1, density: 0.9, seed: 7,
      px: true, nx: true, py: true, ny: false, pz: true, nz: true,
      key: 'color:dark-gray',
    }, { jobFloor: FLOOR })
    expect(r.ok).toBe(true)
    const patch = h.editor.log.patches[h.editor.log.patches.length - 1]!
    for (const c of patch.changes) {
      if (c.after === 0) expect(scopeSet.has(coordKey(c.x, c.y, c.z)), `删除 (${c.x},${c.y},${c.z}) 应在组合内`).toBe(true)
      if (c.before === 0) {
        // 新增必须在某个组合块的邻位（amplitude=1 ⇒ 恰好 1 格、六向其一）
        const near = scope.some((s) => Math.abs(s.x - c.x) + Math.abs(s.y - c.y) + Math.abs(s.z - c.z) === 1)
        expect(near, `新增 (${c.x},${c.y},${c.z}) 应是组合表面邻位`).toBe(true)
      }
    }
  })

  it('正例③：raise_layers(组合) ⇒ 删除集 = 组合集（源格清空）、新增集 = 平移像（保形）', () => {
    const h = house()
    const scope = resolveScope(h.editor.volume, h.editor.parts, h.editor.compositions, { kind: 'composition', compositionId: h.roofCompId })
    const keysBefore = new Map(scope.map((c) => [coordKey(c.x, c.y, c.z), h.editor.volume.getBlock(c.x, c.y, c.z)]))
    const r = executeTool(h.editor, 'raise_layers', { target_kind: 'composition', target_id: h.roofCompId, layers: 2 }, { jobFloor: FLOOR })
    expect(r.ok).toBe(true)
    for (const c of scope) {
      expect(h.editor.volume.getBlock(c.x, c.y, c.z), `源格 (${c.x},${c.y},${c.z}) 应清空`).toBe(0)
      expect(h.editor.volume.getBlock(c.x, c.y + 2, c.z), `平移像 (${c.x},${c.y + 2},${c.z}) 应保形`).toBe(keysBefore.get(coordKey(c.x, c.y, c.z)))
    }
  })

  it('负例：target_id 不存在 ⇒ 教学式报错（指向 list_*）+ 零执行（REQ-051 验收字面）', () => {
    const h = house()
    const before = h.editor.volume.digest()
    const patchesBefore = h.editor.log.patches.length
    const r = executeTool(h.editor, 'recolor', { target_kind: 'composition', target_id: 'comp-999', to: 'color:red' }, { jobFloor: FLOOR })
    expect(r.ok).toBe(false)
    expect(r.content).toContain('list_compositions')
    expect(r.content).toContain('最小合法示例')
    expect(h.editor.volume.digest()).toEqual(before)
    expect(h.editor.log.patches).toHaveLength(patchesBefore) // 未新增任何补丁
  })

  it('负例同型：target_id 指向构件但 kind 写成 composition ⇒ 拒绝；part 乱 id 同样拒绝', () => {
    const h = house()
    const a = executeTool(h.editor, 'recolor', { target_kind: 'part', target_id: h.roofCompId, to: 'color:red' }, { jobFloor: FLOOR })
    expect(a.ok).toBe(false)
    expect(a.content).toContain('list_parts')
  })
})

describe('V7 · 教学式报错与参数守卫', () => {
  it('未知身份串 ⇒ 报错含可用示例（requireKey）', () => {
    const h = house()
    const r = executeTool(h.editor, 'recolor', { target_kind: 'all', to: 'color:not-exist' }, { jobFloor: FLOOR })
    expect(r.ok).toBe(false)
    expect(r.content).toContain('color:white') // 示例来自当前调色板（前 3 条）
  })

  it('超 AI 面上限（mirror copies=9 / preset size=17 / brush 并集 513）⇒ 拒绝并给上限数字', () => {
    const h = house()
    expect(executeTool(h.editor, 'mirror_array', { target_kind: 'all', axis: 'x', copies: 9, spacing: 0 }, { jobFloor: FLOOR }).content).toContain('≤8')
    expect(executeTool(h.editor, 'preset_shape', { shape: 'box', origin_x: 0, origin_y: 0, origin_z: 0, size_x: 17, size_y: 2, size_z: 2, key: 'color:red' }, { jobFloor: FLOOR }).content).toContain('1–16')
    expect(executeTool(h.editor, 'brush', { modifier: 'place', size_x: 4, size_y: 4, size_z: 4, key: 'color:red', anchors: Array.from({ length: 9 }, (_, i) => [i, 6, 8]) }, { jobFloor: FLOOR }).content).toContain('512')
  })

  it('读工具直回内容（get_model_summary / list_compositions / get_selection）', () => {
    const h = house()
    expect(executeTool(h.editor, 'get_model_summary', {}, { jobFloor: FLOOR }).content).toContain('[AABB]')
    expect(executeTool(h.editor, 'list_compositions', {}, { jobFloor: FLOOR }).content).toContain(h.roofCompId)
    expect(executeTool(h.editor, 'get_selection', {}, { jobFloor: FLOOR }).ok).toBe(true)
  })

  it('read_map_full 超限拒绝 ⇒ 教学式提示按宾语分读', () => {
    const editor = new Editor()
    setUi({ mode: 'edit' })
    const k = (i: string): number => editor.volume.palette.list().find((e) => e.identity === i)!.key
    applyProgramOp(editor.log, { type: 'program', name: 'presetShape', params: { shape: 'box', origin: { x: 0, y: 0, z: 0 }, size: { x: 20, y: 4, z: 4 }, key: k('color:red') } }, editor.compositions)
    const r = executeTool(editor, 'read_map_full', {}, { jobFloor: 0 })
    expect(r.ok).toBe(false)
    expect(r.content).toContain('get_model_summary')
  })
})

describe('ADR-19 · 归属账（r02 顺延件）', () => {
  it('part 范围产出 ⇒ 归该 part（不新建）；组合范围产出 ⇒ 归组合直属块；all / 无范围 ⇒ 仍新建', () => {
    const h = house()
    // part 范围：另放一个无遮挡小盒（避开屋顶板）再给它加层 ⇒ 新层归该 part
    const box = executeTool(h.editor, 'preset_shape', { shape: 'box', origin_x: 12, origin_y: 0, origin_z: 0, size_x: 2, size_y: 2, size_z: 2, key: 'color:green' }, { jobFloor: FLOOR })
    const boxPartId = h.editor.log.patches[h.editor.log.patches.length - 1]!.partId!
    expect(box.ok).toBe(true)
    const partsBefore = h.editor.parts.list().length
    executeTool(h.editor, 'add_layer', { target_kind: 'part', target_id: boxPartId, count: 1, key: 'color:green' }, { jobFloor: FLOOR })
    expect(h.editor.parts.list().length).toBe(partsBefore) // 没新建
    expect(h.editor.parts.partIdOf(12, 2, 0)).toBe(boxPartId) // 新顶面归小盒
    // 组合范围：噪声填充 ⇒ 直属块吸收（manualBlocks 增长）
    const compBefore = h.editor.compositions.get(h.roofCompId)!.manualBlocks.size
    executeTool(h.editor, 'noise_fill', { target_kind: 'composition', target_id: h.roofCompId, density: 0.5, keys: ['color:orange'], seed: 3 }, { jobFloor: FLOOR })
    const compAfter = h.editor.compositions.get(h.roofCompId)!.manualBlocks.size
    expect(compAfter).toBeGreaterThan(compBefore)
    // all / 无范围（presetShape）⇒ 维持新建 `${label} N`
    const before2 = h.editor.parts.list().length
    const r = executeTool(h.editor, 'preset_shape', { shape: 'box', origin_x: 16, origin_y: 0, origin_z: 0, size_x: 2, size_y: 2, size_z: 2, key: 'color:green' }, { jobFloor: FLOOR })
    expect(r.ok).toBe(true)
    expect(h.editor.parts.list().length).toBe(before2 + 1)
    expect(h.editor.parts.list().map((p) => p.name).some((n) => n.startsWith('预设体块'))).toBe(true)
  })

  it('组合直属块的 undo/redo 镜像：撤销吸收 ⇒ 直属键收回；redo 放回', () => {
    const h = house()
    executeTool(h.editor, 'noise_fill', { target_kind: 'composition', target_id: h.roofCompId, density: 0.5, keys: ['color:orange'], seed: 3 }, { jobFloor: FLOOR })
    const withFill = h.editor.compositions.get(h.roofCompId)!.manualBlocks.size
    h.editor.undo()
    expect(h.editor.compositions.get(h.roofCompId)!.manualBlocks.size).toBeLessThan(withFill)
    h.editor.redo()
    expect(h.editor.compositions.get(h.roofCompId)!.manualBlocks.size).toBe(withFill)
  })

  it('抬升随块走：raiseByLayers(part) ⇒ 新位格仍归原 part、原构件不被搬空（无遮挡夹具）', () => {
    // 房子夹具里墙体上方是屋顶板：平移像压到范围外块 ⇒ 覆写按 D-B ② 不改原归属（r02 既定语义，ADR-19 不动）——
    // "随块走"的判据要在无遮挡处看：新位格（before===0）继承源格归属。
    const h = house()
    const wallBlocksBefore = h.editor.parts.blockCount(h.wallPartId)
    const r = executeTool(h.editor, 'raise_layers', { target_kind: 'part', target_id: h.wallPartId, layers: 3 }, { jobFloor: FLOOR })
    expect(r.ok).toBe(true)
    const lifted = 91 // 112 − 21（y1 带压到屋顶板 + 烟囱位：覆写不改原归属）
    expect(h.editor.parts.blockCount(h.wallPartId)).toBe(lifted)
    expect(h.editor.parts.partIdOf(0, 3, 0)).toBe(h.wallPartId) // 同键像留在原格 ⇒ 归属不变
    expect(h.editor.parts.partIdOf(0, 5, 0)).toBe(h.wallPartId) // 空位像 ⇒ 随块走
    expect(h.editor.parts.partIdOf(0, 6, 0)).toBe(h.wallPartId)
    expect(h.editor.volume.getBlock(0, 0, 0)).toBe(0) // 墙体真的抬走了
    expect(wallBlocksBefore).toBe(112) // 夹具自证
  })

  it('undo 工具带地板：退不穿 job 开始前的用户编辑', () => {
    const h = house()
    const floor = h.editor.log.patches.length // 用户已有一堆编辑
    executeTool(h.editor, 'preset_shape', { shape: 'box', origin_x: 12, origin_y: 0, origin_z: 0, size_x: 2, size_y: 2, size_z: 2, key: 'color:green' }, { jobFloor: floor })
    const r = executeTool(h.editor, 'undo', { steps: 4 }, { jobFloor: floor })
    expect(r.ok).toBe(false) // 地板之上只有 1 笔 AI 补丁，退 4 步会穿 ⇒ 拒绝
    expect(r.content).toContain('地板')
    const r1 = executeTool(h.editor, 'undo', { steps: 1 }, { jobFloor: floor })
    expect(r1.ok).toBe(true)
    expect(h.editor.log.patches.length).toBe(floor)
  })

  it('v2 序列化透传新账字段（compositionId / compMembersBefore / ownersAfter）⇒ 往返相等', () => {
    const h = house()
    executeTool(h.editor, 'noise_fill', { target_kind: 'composition', target_id: h.roofCompId, density: 0.5, keys: ['color:orange'], seed: 3 }, { jobFloor: FLOOR })
    executeTool(h.editor, 'raise_layers', { target_kind: 'part', target_id: h.wallPartId, layers: 2 }, { jobFloor: FLOOR })
    const file = JSON.parse(JSON.stringify(encodeProject({
      volume: h.editor.volume, parts: h.editor.parts, patches: h.editor.log.patches, partCreations: h.editor.log.partCreations,
      compositions: h.editor.compositions, blockStyle: 'color', meta: { id: 't', title: 't', createdAt: '', updatedAt: '' },
    })))
    const decoded = decodeProject(JSON.stringify(file))
    expect(decoded.ok).toBe(true)
    if (decoded.ok !== true) throw new Error('unreachable')
    const compPatch = decoded.file.log.patches.find((p: { compositionId?: string | null }) => p.compositionId !== undefined && p.compositionId !== null)
    expect(compPatch).toBeDefined()
    expect(compPatch!.compMembersBefore).toBeDefined()
    const movePatch = decoded.file.log.patches.find((p: { ownersAfter?: unknown }) => p.ownersAfter !== undefined)
    expect(movePatch).toBeDefined()
  })
})

// r04 T6（B-3）· D4 收严 + D5 单解析的行为锁（新增用例；既有断言零改动）
describe('r04 T6 · D4/D5：set_cells 单趟解析（解析面 = 执行面）', () => {
  it('D4：cells[].key 未知身份 ⇒ 教学式整笔拒；占位格不被"静默当 0 删除"（旧版执行面 ?? 0 放宽已移除）', () => {
    const h = house()
    const before = h.editor.volume.getBlock(5, 5, 5) // 手工烟囱（占位格）
    expect(before).not.toBe(0)
    const r = executeTool(h.editor, 'set_cells', { cells: [[5, 5, 5, 'color:who-dis']] }, { jobFloor: 0 })
    expect(r.ok).toBe(false)
    expect(r.content).toContain('没有身份 "color:who-dis"')
    expect(h.editor.volume.getBlock(5, 5, 5)).toBe(before) // 未被静默删除（旧版：keyOfIdentity ?? 0 ⇒ 删格）
    expect(h.editor.log.patches.length).toBe(3) // 零执行零记账（house = 墙 + 屋顶 + 烟囱 3 笔）
  })

  it('D5：preparsed 直传 ⇒ 执行面用解析产物、不重解析（args 传别的也不改结果 = 一调用一解析）', () => {
    const h = house()
    const parsed = parseWriteArgs(h.editor, 'set_cells', { cells: [[5, 5, 6, 'color:who-dis']] }) // 解析失败产物
    const r = executeTool(h.editor, 'set_cells', { cells: [[5, 5, 6, h.k('color:blue')]] }, { jobFloor: 0, preparsed: parsed })
    expect(r.ok).toBe(false) // 结果取 preparsed 的拒绝（args 本可执行）⇒ 执行面不再二次解析
    expect(r.content).toContain('color:who-dis')
    expect(h.editor.volume.getBlock(5, 5, 6)).toBe(0) // 未落任何块
  })
})
