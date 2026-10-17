// `REQ-022`（2026-10-17 去贴图化）· 方块体系 = **color-only**：
//   · 代码无第二套体系 / 无跨体系映射（映射表已存档，见 lab `proposals/minecraft-texture-system-archive-2026-10-17.md`）；
//   · 旧档 `blockStyle:'minecraft'` ⇒ 降级为 `'color'` + `minecraft:*` 身份按条目 color 重写为 `color:#rrggbb`
//     （**不丢块、不整档拒绝**；缺可用 color hex ⇒ 明确报错，不静默）；
//   · 渲染解析只剩 color 面（缺项标记分支已移除）。
// N2 · 贴图源切换不改模型（`REQ-027` / N2：模型摘要不变；重建计数 = 0 归 harness/render-invariants）。
import { describe, expect, it } from 'vitest'
import { BUILTIN_COLOR_BLOCKS, internBuiltin } from '../../src/core/builtin-palette'
import { Palette } from '../../src/core/palette'
import type { ProjectFileV2 } from '../../src/core/types'
import { Editor } from '../../src/edit/editor'
import { loadOrSeed } from '../../src/edit/project'
import { MemoryProjectStore } from '../../src/io/project-store'
import { decodeProject } from '../../src/io/serialize'
import { resolveBlockColor } from '../../src/render/appearance'
import { useEditorUi } from '../../src/state/editor-store'

/** chunk(0,0,0) 的 16³ data：给定局部下标置 key（0 = 空；1 = 调色板键） */
function chunkData(indices: number[], key = 1): number[] {
  const data = new Array<number>(4096).fill(0)
  for (const i of indices) data[i] = key
  return data
}

/**
 * 一份形状合法的项目档；缺省 = **旧外观档**（`blockStyle:'minecraft'` + `minecraft:red_wool`）。
 * `color: null` = 该条目没有 color 字段（用来测"降级不得静默"）。
 */
function projectJson(opts: { blockStyle?: 'color' | 'minecraft'; identity?: string; color?: string | null } = {}): string {
  const entry: Record<string, unknown> = { key: 1, identity: opts.identity ?? 'minecraft:red_wool', state: {} }
  if (opts.color !== null) entry.color = opts.color ?? '#C0392B'
  return JSON.stringify({
    format: 'wishvox/project',
    formatVersion: 2,
    appVersion: '0.1.0',
    meta: { id: 'p-legacy', title: '旧外观档', createdAt: '2026-10-17T00:00:00.000Z', updatedAt: '2026-10-17T00:00:00.000Z' },
    blockStyle: opts.blockStyle ?? 'minecraft',
    palette: [entry],
    chunks: [{ x: 0, y: 0, z: 0, size: 16, data: chunkData([0, 1]) }],
    parts: [],
    compositions: [],
    log: {
      snapshotAt: 1,
      patches: [
        {
          seq: 0,
          op: { type: 'set', x: 0, y: 0, z: 0, key: 1 },
          changes: [{ x: 0, y: 0, z: 0, before: 0, after: 1 }],
          partId: null,
          createdAt: 0,
        },
      ],
      partCreations: [],
    },
  })
}

describe('REQ-022 ③ · 旧外观档降级（不丢块、不整档拒绝）', () => {
  it("blockStyle 'minecraft' ⇒ 'color'；minecraft:* 身份重写为 color:#rrggbb（小写规范值）", () => {
    const decoded = decodeProject(projectJson())
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.file.blockStyle).toBe('color')
    expect(decoded.downgrade).toEqual({ rewrites: 1 })
    expect(decoded.file.palette.map((e) => e.identity)).toEqual(['color:#c0392b'])
  })

  it('装配后块不丢（2 块）、历史不丢、再导出即 color-only', () => {
    const ed = new Editor(new MemoryProjectStore())
    expect(ed.importFile(projectJson()).ok).toBe(true)
    expect(ed.volume.nonEmptyCount).toBe(2)
    expect(ed.volume.palette.list().every((e) => !e.identity.startsWith('minecraft:'))).toBe(true)
    expect(ed.blockStyle).toBe('color')
    const reExported = JSON.parse(ed.exportFile()) as { blockStyle: string; palette: Array<{ identity: string }> }
    expect(reExported.blockStyle).toBe('color')
    expect(reExported.palette.some((e) => e.identity === 'color:#c0392b')).toBe(true)
    expect(reExported.palette.every((e) => !e.identity.startsWith('minecraft:'))).toBe(true)
  })

  it('旧条目缺 color hex ⇒ 明确报错（REQ-022 ③：降级不得静默）', () => {
    const decoded = decodeProject(projectJson({ color: null }))
    expect(decoded.ok).toBe(false)
    if (!decoded.ok) {
      expect(decoded.error).toContain('REQ-022')
      expect(decoded.error).toContain('minecraft:red_wool')
    }
  })

  it('非 HEX 的 color 同样报错（不猜颜色）', () => {
    const decoded = decodeProject(projectJson({ color: 'not-a-color' }))
    expect(decoded.ok).toBe(false)
    if (!decoded.ok) expect(decoded.error).toContain('REQ-022')
  })

  it('color 档不带降级回执（downgrade 缺省）', () => {
    const decoded = decodeProject(projectJson({ blockStyle: 'color', identity: 'color:#c0392b' }))
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.downgrade).toBeUndefined()
  })
})

describe('REQ-022 ③ · 回执说明（恢复 / 导入都不静默）', () => {
  it('导入路径：消息点名降级与重写条数', () => {
    const ed = new Editor(new MemoryProjectStore())
    expect(ed.importFile(projectJson()).ok).toBe(true)
    const msg = useEditorUi.getState().message ?? ''
    expect(msg).toContain('已导入')
    expect(msg).toContain('旧外观档已降级为彩色：1 个身份重写为 color:#hex')
  })

  it('恢复路径（有存档）：消息同样点名降级', async () => {
    const ed = new Editor(new MemoryProjectStore())
    await loadOrSeed(ed, JSON.parse(projectJson()) as unknown as ProjectFileV2)
    const msg = useEditorUi.getState().message ?? ''
    expect(msg).toContain('已恢复项目「旧外观档」')
    expect(msg).toContain('旧外观档已降级为彩色：1 个身份重写为 color:#hex')
  })
})

describe('N1 · color-only 渲染（无映射、无缺项标记）', () => {
  const app = (missing: string[] = []) => ({ style: 'color' as const, missing: new Set(missing) })

  it('已定义身份 ⇒ 条目色；未定义身份 ⇒ 占位灰；旧"缺项"身份不再改写成标记色', () => {
    expect(resolveBlockColor('color:red', '#c0392b', app(), false)).toBe('#c0392b')
    expect(resolveBlockColor(undefined, '#c0392b', app(), false)).toBe('#9aa0a6')
    expect(resolveBlockColor('color:orange', '#d98324', app(['color:orange']), false)).toBe('#d98324')
  })

  it('高亮提亮（与基色不同）；缺项集合不参与解析', () => {
    expect(resolveBlockColor('color:orange', '#d98324', app(), true)).not.toBe('#d98324')
  })

  it('editor 级：缺项清单恒空（color-only 无第二套体系）', () => {
    const editor = new Editor(new MemoryProjectStore())
    editor.setCurrentIdentity('color:orange')
    editor.place(0, 0, 0)
    expect(useEditorUi.getState().missingIdentities).toEqual([])
  })
})

describe('REQ-027 ① · 彩色体系规模（由 palette 直接读出并计数）', () => {
  it('≥12 种方块身份', () => {
    const palette = new Palette()
    internBuiltin(palette)
    expect(palette.list().length).toBeGreaterThanOrEqual(12)
    expect(BUILTIN_COLOR_BLOCKS.length).toBeGreaterThanOrEqual(12)
  })

  it('≥8 色主调色板', () => {
    const palette = new Palette()
    internBuiltin(palette)
    const colors = new Set(palette.list().map((e) => (e.color ?? '').toLowerCase()))
    expect(colors.size).toBeGreaterThanOrEqual(8)
  })
})
