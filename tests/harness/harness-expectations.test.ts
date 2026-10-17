// D1 · harness 期望值对拍（debug-261004，2026-10-04）：editing-view.ts 里硬编码的相机目标点
// 期望必须等于 modelBounds 现算的 AABB 中心。根因 = 坯料 y 跨 0..2 ⇒ 中心 y = (0+2+1)/2 = 1.5，
// 期望被写成 1 ⇒ 读回页 3 条 FAIL（MT-E0 原始输出）。这里从 harness 源码提取 vecNear 字面量，
// 对拍①三个场景的 modelBounds 真值 ②MT-E0 实测读回（1e-6 容差——正是 check 的判定口径）。
import { describe, expect, it } from 'vitest'
import { modelBounds } from '../../src/core/model-info'
import { MemoryProjectStore } from '../../src/io/project-store'
import { Editor } from '../../src/edit/editor'
// harness 源码按原文导入（vite `?raw`）——避免 tests 依赖 @types/node 的 fs/url
import harnessSource from '../../harness/editing-view.ts?raw'

/** 提取 harness 里全部 vecNear(cam*.target, [x, y, z]) 的字面量三元组（按源码顺序 = cam0/cam1/cam2/camReset） */
function extractTargetLiterals(): number[][] {
  const out: number[][] = []
  for (const m of harnessSource.matchAll(/vecNear\(\w+\.target, \[([-\d.]+), ([-\d.]+), ([-\d.]+)\]\)/g)) {
    out.push([Number(m[1]), Number(m[2]), Number(m[3])])
  }
  return out
}

/** 复刻 harness 的三段场景（新建 → 放 (10,0,10) → 放 (20,0,20)），返回各阶段 AABB 中心 */
function scenarioCenters(): number[][] {
  const editor = new Editor(new MemoryProjectStore())
  editor.setMode('edit')
  editor.newProject()
  const c0 = centerOf(editor)
  editor.place(10, 0, 10)
  const c1 = centerOf(editor)
  editor.place(20, 0, 20)
  const c2 = centerOf(editor)
  return [c0, c1, c2]
}

function centerOf(editor: Editor): number[] {
  const b = modelBounds(editor.volume)
  if (!b) throw new Error('scenario: 空模型（场景构造失败）')
  return [b.centerX, b.centerY, b.centerZ]
}

describe('D1 · harness 期望值 = AABB 中心（y 跨 0..2 ⇒ 1.5）', () => {
  it('三条硬编码期望 = modelBounds 现算中心（cam0/cam1/cam2 + 复位复用 cam2 中心）', () => {
    const literals = extractTargetLiterals()
    expect(literals).toHaveLength(4)
    const [c0, c1, c2] = scenarioCenters()
    expect(literals[0]).toEqual(c0)
    expect(literals[1]).toEqual(c1)
    expect(literals[2]).toEqual(c2)
    expect(literals[3]).toEqual(c2)
  })

  it('期望落在 MT-E0 实测读回的 1e-6 容差内（= 读回页三条 FAIL ⇒ PASS）', () => {
    // MT-E0 留档实测（procedural-ops-manual-tasks.md，2026-10-04 用户实跑）
    const measured: Array<[number, number, number] | null> = [
      null, // cam0 检查已 PASS，无复测必要
      [5.499999999999999, 1.4999999999999998, 5.499999999999999],
      [10.499999999999996, 1.4999999999999998, 10.499999999999996],
      [10.499999999999996, 1.4999999999999998, 10.499999999999996],
    ]
    const literals = extractTargetLiterals()
    for (let i = 0; i < literals.length; i++) {
      const m = measured[i]
      if (!m) continue
      expect(literals[i]!.every((v, axis) => Math.abs(v - m[axis]) < 1e-6)).toBe(true)
    }
  })
})
