// r05 收尾 · 件一（`REQ-062`）· **首运行（无存档）的 3×3×3 坯料**（r06 起 = **展示件不可用时的降级路径**）。
//
// 2026-10-17 口径变更（r06）：无存档首运行**先尝试展示件** `public/showcase/blue-big-fat-fish.json`
// （`REQ-062` 改口径）。本文件判"展示件不可用 ⇒ 退回与旧首运行一致"，故显式打桩为 null；
// 展示件正例见 `io/default-showcase`（加载器 + `K1` 读数）与 `io/first-run-showcase`（`init()` 分支 + 提示）。
//
// 复现证据 = `verify-261008b` §A-①（笔记库 curriculum/r05-ui-redesign/ui-redesign-log.md）：
// 改前 `Editor.init()` 只有 `store.load()` 非空才 `applyFile`，无存档分支**什么都不建** ⇒
// `nonEmptyCount = 0` / `parts = []` / `patches = 0`（首次运行 = 空模型）。
//
// 判据（`REQ-062` 五条；降级路径上同样成立）：
//   ① 无存档 + `init()` ⇒ 27 块 `(0..2)³` + 构件「坯料」 + **恰 1 条补丁**（走补丁日志）；
//   ② **一次撤销 ⇒ 0 块**（与 `newProject()` 同口径，`REQ-056`/`V5`）；
//   ③ **再次 `init()` 从存档恢复仍 27、补丁数不再增**（不重复叠加）；
//   ④ **有存档时行为不变**（不建第二个坯料——不覆盖 / 不重置用户既有存档）。
// 边界：不得改动 `newProject()` 的对外行为（既有 `baseline` / `persistence` / `editing-session` 用例零改动）。
import { describe, expect, it, vi } from 'vitest'
import { internBuiltin } from '../../src/core/builtin-palette'
import { CompositionRegistry } from '../../src/core/composition'
import { PartRegistry } from '../../src/core/parts'
import type { StrokeOp } from '../../src/core/types'
import { Volume } from '../../src/core/volume'
import { Editor } from '../../src/edit/editor'
import { MemoryProjectStore } from '../../src/io/project-store'
import { encodeProject } from '../../src/io/serialize'
import { useEditorUi } from '../../src/state/editor-store'

// 首运行新口径（r06）：展示件加载可被测试注入——本件只覆盖"展示件不可用"的降级路径（27 块坯料）。
vi.mock('../../src/io/showcase', () => ({ loadDefaultShowcase: async () => null }))

/** 造一份最小"用户存档"：只含 1 块（不含坯料 ⇒ 与首启形态可区分） */
function userFileWithBlock(x: number, y: number, z: number) {
  const v = new Volume()
  const key = internBuiltin(v.palette).get('color:red')!
  v.setBlock(x, y, z, key)
  return encodeProject({
    volume: v,
    parts: new PartRegistry(),
    patches: [
      {
        seq: 0,
        op: { type: 'set', x, y, z, key },
        changes: [{ x, y, z, before: 0, after: key }],
        partId: null,
        createdAt: 0,
        label: '用户单块放置',
      },
    ],
    partCreations: [],
    compositions: new CompositionRegistry(),
    blockStyle: 'color',
    meta: { id: 'p-user', title: '用户项目', createdAt: '2026-10-08T00:00:00.000Z', updatedAt: '2026-10-08T00:00:00.000Z' },
  })
}

/** 读回面（与 `verify-261008b` §C-① 同口径，另加坐标与补丁形状） */
function readBack(ed: Editor) {
  const s = useEditorUi.getState()
  return {
    nonEmptyCount: ed.volume.nonEmptyCount,
    parts: ed.parts.list().map((p) => ({ id: p.id, name: p.name, blocks: ed.parts.blockCount(p.id) })),
    partCount: ed.parts.list().length,
    patches: ed.log.patches.length,
    projectedParts: s.parts.map((p) => ({ name: p.name, count: p.count })),
    projectedNonEmpty: s.nonEmpty,
    message: s.message,
  }
}

function blankStore(): MemoryProjectStore {
  return new MemoryProjectStore() // 空 store = 首次运行（无存档）
}

/** 只读复算：坯料坐标集合 = `(0..2)³` 恰 27 格，其余坐标全空 */
function coordsOfBlank(ed: Editor): Array<{ x: number; y: number; z: number }> {
  const cells: Array<{ x: number; y: number; z: number }> = []
  for (let x = 0; x <= 2; x++) {
    for (let y = 0; y <= 2; y++) {
      for (let z = 0; z <= 2; z++) {
        if (ed.volume.getBlock(x, y, z) !== 0) cells.push({ x, y, z })
      }
    }
  }
  return cells
}

describe('件一 · 首运行（无存档）+ init() ⇒ 3×3×3 坯料（REQ-062）', () => {
  it('A · 无存档 + init() ⇒ 27 块 / 构件「坯料」27 块 / 恰 1 条补丁（红 → 绿的主判据）', async () => {
    const store = blankStore()
    const ed = new Editor(store)
    await ed.init()
    const r = readBack(ed)
    console.info('[件一-A 无存档首启] ' + JSON.stringify(r))

    expect(r.nonEmptyCount).toBe(27)
    expect(coordsOfBlank(ed)).toHaveLength(27)
    expect(r.parts).toEqual([{ id: 'part-1', name: '坯料', blocks: 27 }])
    expect(ed.parts.partIdOf(1, 1, 1)).toBe('part-1') // 中心格 (1,1,1) 归「坯料」
    expect(r.projectedParts).toEqual([{ name: '坯料', count: 27 }]) // 结构树可见「坯料」
    expect(r.patches).toBe(1) // 走补丁日志（一次撤销可清空）
    const patch = ed.log.patches[0]!
    expect((patch.op as StrokeOp).type).toBe('stroke')
    expect(patch.changes).toHaveLength(27)
  })

  it('B · 一次撤销 ⇒ 0 块（与 newProject() 同口径）', () => {
    const ed = new Editor(blankStore())
    ed.newProject()
    ed.undo()
    console.info('[件一-B 撤销后] ' + JSON.stringify(readBack(ed)))
    expect(ed.volume.nonEmptyCount).toBe(0)
    expect(ed.log.patches).toHaveLength(0)
  })

  it('D · 再次 init() 从存档恢复仍 27、补丁数不再增（不重复叠加）', async () => {
    const store = blankStore()
    const ed = new Editor(store)
    await ed.init()
    await ed.autosave.flush() // 首启落盘（= 刷新后仍在的存储语义）
    const first = readBack(ed)

    await ed.init() // 第二次启动：有存档 ⇒ 走恢复分支
    const second = readBack(ed)
    console.info('[件一-D 首次 init] ' + JSON.stringify(first))
    console.info('[件一-D 再次 init] ' + JSON.stringify(second))

    expect(second.nonEmptyCount).toBe(27)
    expect(second.parts).toEqual([{ id: 'part-1', name: '坯料', blocks: 27 }])
    expect(second.patches).toBe(1)
    // 不重复叠加：第二次走的是"恢复存档"分支（键/构件/patch seq 都不重建），不是再 seed 一次
    expect(first.message).toBe('首次运行：已建 3×3×3 坯料（构件「坯料」· 相机对准坯料中心）')
    expect(second.message).toBe('已恢复项目「未命名项目」')
    expect(second).toEqual({ ...first, message: second.message })
  })

  it('E · 已有存档 ⇒ 行为不变（不建第二个坯料、不覆盖用户存档、不清补丁账）', async () => {
    const userFile = userFileWithBlock(3, 0, 3) // 用户存档：只含 1 块（无坯料）
    const userPatchCount = 1

    const store = blankStore()
    await store.save(userFile)
    const ed = new Editor(store)
    await ed.init() // 有存档 ⇒ 恢复，不得再建坯料
    const r = readBack(ed)
    console.info('[件一-E 有存档 init] ' + JSON.stringify(r))

    expect(ed.volume.nonEmptyCount).toBe(1)
    expect(ed.volume.getBlock(3, 0, 3)).not.toBe(0)
    expect(ed.volume.getBlock(0, 0, 0)).toBe(0) // 未建坯料
    expect(r.parts.some((p) => p.name === '坯料')).toBe(false)
    expect(r.patches).toBe(userPatchCount)
    expect(r.patches).toBeLessThan(2) // 未叠加"初始化·坯料"补丁
    expect(r.message).toBe('已恢复项目「用户项目」')
  })
})
