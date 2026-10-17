// harness · 编辑系统视口读回（r02 前半 · editing-system-plan §4 的 L3 面）。
// 用真实 Editor + VoxelRenderer 走完整链路（store 会话态 → editor → 渲染层），读回：
//   V1 目标点（AABB 中心 · 更新即重算 · 拖动中冻结/松手更新）· V3 可见块数 = 按层计数 + 隐藏层不可拾取 ·
//   V4 网格对象数 · V5 坯料 27 块 · V6 预览集合 = 笔刷体积 · V8 一次撤销的块数（旁路/零变化）·
//   V10 检视态门（strokeBegin 拒绝）· V11 相机会话态（不进文件；撤销不回退视图）。
// 加载自检同 render-invariants（顶层 try/catch，出错禁用按钮——杜绝"静默点不动"）。
import { visibleCountByFilter } from '../src/core/model-info'
import { brushVolume } from '../src/core/brush/volume'
import type { Coord } from '../src/core/types'
import { MemoryProjectStore } from '../src/io/project-store'
import { VoxelView } from '../src/interaction/view'
import { Editor } from '../src/edit/editor'
import { setUi, useEditorUi } from '../src/state/editor-store'

const runButton = document.getElementById('run') as HTMLButtonElement
const progressSpan = document.getElementById('progress') as HTMLSpanElement

let editor!: Editor
let renderer!: VoxelView

try {
  const stage = document.getElementById('stage') as HTMLDivElement
  editor = new Editor(new MemoryProjectStore())
  renderer = new VoxelView(stage, editor.volume, editor.parts)
  renderer.resize(1024, 576)
  editor.attachRenderer(renderer)
  editor.setMode('edit')
} catch (err) {
  runButton.disabled = true
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  progressSpan.textContent = `初始化失败，「运行全部检查」已禁用——${msg}（详见控制台）`
  console.error('[editing-view] 初始化失败：', err)
}

interface Check {
  name: string
  expect: string
  actual: string
  pass: boolean
}
const checks: Check[] = []

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()))

function check(name: string, expect: string, actual: string, pass: boolean): void {
  checks.push({ name, expect, actual, pass })
}

const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) < eps
const vecNear = (a: readonly number[], b: readonly number[], eps = 1e-6): boolean =>
  a.length === b.length && a.every((v, i) => near(v, b[i]!, eps))
const cellsKey = (cells: readonly Coord[]): string => cells.map((c) => `${c.x},${c.y},${c.z}`).sort().join(';')

async function run(): Promise<void> {
  const progress = document.getElementById('progress') as HTMLSpanElement
  const resultTable = document.getElementById('result') as HTMLTableElement
  const raw = document.getElementById('raw') as HTMLPreElement

  // ── V5 初始坯料 ──
  editor.newProject()
  await nextFrame()
  check('V5 新建 = 3³ 坯料：27 块 · 构件「坯料」27 块', '27 / 27', `${editor.volume.nonEmptyCount} / ${editor.parts.list().find((p) => p.name === '坯料')?.blocks.size ?? -1}`, editor.volume.nonEmptyCount === 27)

  // ── V1 目标点 = 非空块 AABB 中心（新建后相机对准坯料中心）──
  const cam0 = renderer.getCameraState()
  check('V1 目标点 = 坯料 AABB 中心 (1.5, 1.5, 1.5)', '(1.5, 1.5, 1.5)', `(${cam0.target.join(', ')})`, vecNear(cam0.target, [1.5, 1.5, 1.5]))

  // 有方块更新就重算：在 (10,0,10) 放一块 ⇒ AABB 变 0..10、y 仍 0..2 ⇒ 中心 (5.5, 1.5, 5.5)
  // （y 中心 = (0+2+1)/2 = 1.5——D1 修复，2026-10-04：原期望把 y 写成 1，读回页 3 条 FAIL）
  setUi({ brushSize: { x: 1, y: 1, z: 1 }, tool: 'place', overridePlace: false, currentIdentity: 'color:red' })
  const patchesBefore = editor.log.patches.length
  editor.strokeBegin()
  const written = editor.strokeApply({ x: 10, y: 0, z: 10 })
  check('V8 旁路：按下写入即时可见（未记账）', `written=1 · patches 仍 ${patchesBefore}`, `written=${written} · patches=${editor.log.patches.length}`, written === 1 && editor.log.patches.length === patchesBefore)
  editor.strokeCommit()
  const cam1 = renderer.getCameraState()
  const expectCenter = '(5.5, 1.5, 5.5)'
  check('V1 方块更新 ⇒ 目标点重算为新 AABB 中心', expectCenter, `(${cam1.target.join(', ')})`, vecNear(cam1.target, [5.5, 1.5, 5.5]))

  // 拖动相机期间冻结、松手后更新（Q4）：真实手势的指针路径归人工走查（MT-E2）；
  // 这里在 controls 上直接派发 'start'/'end'（与 OrbitControls 派发的同名事件同一监听）——
  // 合成 PointerEvent 会在 setPointerCapture 上抛 NotFoundError（非活动 pointerId），不可用。
  renderer.controls.dispatchEvent({ type: 'start' })
  await nextFrame()
  // 拖动中放一块远块 ⇒ 目标点不得移动（冻结）
  editor.place(20, 0, 20)
  const camFrozen = renderer.getCameraState()
  const frozen = vecNear(camFrozen.target, cam1.target)
  check('V1 拖动相机期间目标点冻结（Q4）', `拖动中模型变化 ⇒ 目标仍在 (${cam1.target.join(', ')})`, `(${camFrozen.target.join(', ')})`, frozen)
  renderer.controls.dispatchEvent({ type: 'end' })
  await nextFrame()
  const cam2 = renderer.getCameraState()
  const expectCenter2 = '(10.5, 1.5, 10.5)' // AABB 0..20 ⇒ (0+20+1)/2；y 仍跨 0..2 ⇒ 1.5
  check('V1 松手后目标点更新（保持朝向与距离——只平移）', expectCenter2, `(${cam2.target.join(', ')})`, vecNear(cam2.target, [10.5, 1.5, 10.5]))
  // 距离保持（V1：更新时保持朝向与距离）
  check('V1 松手重算保持距离（朝向不变 ⇒ 距离差 < 1e-6）', `${cam1.distance.toFixed(4)}`, `${cam2.distance.toFixed(4)}`, near(cam1.distance, cam2.distance))
  editor.setMode('edit')

  // 复位：视角回 AABB 中心机位
  editor.resetCameraView()
  await nextFrame()
  const camReset = renderer.getCameraState()
  check('V11/F9 复位视角 ⇒ 目标点回到当前 AABB 中心', '(10.5, 1.5, 10.5)', `(${camReset.target.join(', ')})`, vecNear(camReset.target, [10.5, 1.5, 10.5]))

  // ── V8 一次撤销的块数 ──
  const nonEmptyBeforeUndo = editor.volume.nonEmptyCount
  const lastPatch = editor.log.patches[editor.log.patches.length - 1]!
  const undoCells = lastPatch.changes.length
  editor.undo()
  check('V8 一次撤销的块数 = 该笔补丁的变更格数', `undo 后非空 ${nonEmptyBeforeUndo - undoCells} 块`, `补丁 ${undoCells} 格 → 非空 ${editor.volume.nonEmptyCount} 块`, editor.volume.nonEmptyCount === nonEmptyBeforeUndo - undoCells)

  // 零变化不入栈：同色上色
  setUi({ currentIdentity: 'color:light-gray', tool: 'paint' })
  const p0 = editor.log.patches.length
  editor.strokeBegin()
  editor.strokeApply({ x: 1, y: 1, z: 1 })
  editor.strokeCommit()
  check('V8 零变化不入栈（同色上色 ⇒ 补丁数不变）', `${p0}`, `${editor.log.patches.length}（${useEditorUi.getState().message}）`, editor.log.patches.length === p0)

  // ── V3 层次：可见块数 = 按层计数（模型当前 = 坯料 27 + (10,0,10) 1 块 = 28）──
  editor.setLayerView('below', 1)
  await nextFrame()
  const filter = { mode: 'below' as const, y: 1 }
  const expectVisible = visibleCountByFilter(editor.volume, filter)
  const statVisible = renderer.stats().visibleInstanceCount
  check('V3 可见块数 = 按层计数（below y=1）', `${expectVisible}（纯函数）`, `${statVisible}（渲染读回）`, statVisible === expectVisible)
  editor.setLayerView('single', 1)
  await nextFrame()
  const expectSingle = visibleCountByFilter(editor.volume, { mode: 'single', y: 1 })
  check('V3 可见块数 = 该层块数（single y=1）', `${expectSingle}`, `${renderer.stats().visibleInstanceCount}`, renderer.stats().visibleInstanceCount === expectSingle)

  // 隐藏层不可拾取：只显示 y=0，把相机对准 (1,1,1) ⇒ 拾取不得返回 y=1 的块
  editor.setLayerView('below', 0)
  await nextFrame()
  renderer.camera.position.set(1.5, 1.5, 6.5)
  renderer.controls.target.set(1.5, 1.5, 1.5)
  renderer.controls.update()
  await nextFrame()
  const cr = renderer.renderer.domElement.getBoundingClientRect()
  const pickHit = renderer.pick(cr.left + cr.width / 2, cr.top + cr.height / 2)
  const pickedY = pickHit ? pickHit.cell[1] : null
  check('V3/Q7 隐藏层不可拾取（只显示 y=0，直射 (1,1,1)）', '命中格 y = 0（或未命中），不得 y=1', `命中 [${pickHit ? pickHit.cell.join(', ') : 'null'}]`, pickedY === null || pickedY === 0)

  // ── V6 预览集合 = 笔刷体积 ──
  editor.setLayerView('below', 99) // 夹取到滑块顶（= 模型顶 + 1 建造余量）
  editor.setMode('edit')
  setUi({ brushSize: { x: 3, y: 1, z: 1 }, tool: 'place', overridePlace: false, currentIdentity: 'color:red' })
  const preview = editor.previewAt({ x: 3, y: 0, z: 0 })
  const expectCells = brushVolume({ x: 3, y: 1, z: 1 }, { x: 3, y: 0, z: 0 })
  const gotCells = renderer.getPreviewCells()
  check('V6 预览集合 = 笔刷体积（3×1×1 @ (3,0,0)，逐坐标）', cellsKey(expectCells), cellsKey(gotCells), cellsKey(expectCells) === cellsKey(gotCells) && preview.length === 3)
  // Q7：隐藏层锚点 ⇒ 无预览
  editor.setLayerView('below', 0)
  const hiddenPreview = editor.previewAt({ x: 3, y: 2, z: 0 })
  check('V6/Q7 隐藏层无预览', '0 格', `${renderer.getPreviewCells().length} 格（editor 返回 ${hiddenPreview.length}）`, renderer.getPreviewCells().length === 0 && hiddenPreview.length === 0)
  editor.clearPreview()

  // ── V4 网格对象数 ──
  editor.setGridView(true, false)
  const g1 = renderer.stats().gridCount
  editor.setGridView(true, true)
  const g2 = renderer.stats().gridCount
  editor.setGridView(false, false)
  const g0 = renderer.stats().gridCount
  check('V4 网格开关 ⇒ 网格对象数 0 / 1 / 2（默认关）', '0 → 1 → 2 → 0', `${g0} → ${g1} → ${g2} → ${g0}`, g1 === 1 && g2 === 2 && g0 === 0)

  // ── V10 检视态门 ──
  editor.setMode('inspect')
  const refused = editor.strokeBegin()
  check('V10 检视态：strokeBegin 拒绝（读回断言）', 'false + 提示', `${refused}（${useEditorUi.getState().message}）`, refused === false)
  editor.setMode('edit')

  // ── debug-261007（MT-04）：模型长高 ⇒ 渲染层层次过滤被投影同步（不需要动滑块）──
  // 用户现象：AI 大改让模型 y 长高后新层不显示，动一下 y 滑块才出现。
  // 读回面 = renderer.layerFilterReadback()（渲染层实际持有的过滤）+ stats().visibleInstanceCount（可见块数）。
  editor.setLayerView('below', 99) // 先把滑块放到顶（粘滞的前置：原来在顶才跟着长高）
  await nextFrame()
  const grownFilter0 = renderer.layerFilterReadback()
  const grownBefore = renderer.stats().visibleInstanceCount
  editor.aiSetCells({ cells: [{ x: 1, y: 6, z: 1, key: 1 }] }) // AI 长高到 y=6（走 renderChanges + refreshViews）
  await nextFrame()
  const grownFilter1 = renderer.layerFilterReadback()
  const grownAfter = renderer.stats().visibleInstanceCount
  const grownExpect = visibleCountByFilter(editor.volume, grownFilter1)
  check(
    'debug-261007 模型长高（AI 写入）后新层立即可见（过滤已推 · 不需要动滑块）',
    `过滤 y ≥ 6 且可见块数 = 按层计数（${grownExpect}）`,
    `过滤 ${grownFilter0?.y} → ${grownFilter1?.y} · 可见 ${grownBefore} → ${grownAfter} · store layerY=${useEditorUi.getState().layerY}`,
    (grownFilter1?.y ?? -1) >= 6 && grownAfter === grownExpect && grownAfter > grownBefore,
  )

  // ── V11 相机会话态：不进项目文件 + 撤销不回退视图 ──
  const fileText = editor.exportFile()
  const noCam = !/"fov"|"camera"|"layerMode"|"gridBase"|"rotateSpeed"|"damping"|"previewReadout"/.test(fileText)
  check('V11 项目文件不含相机 / 层次 / 网格字段（会话态）', '全部缺失', noCam ? '全部缺失' : '发现会话态字段泄漏', noCam)
  const camBeforeUndo = renderer.getCameraState()
  setUi({ brushSize: { x: 1, y: 1, z: 1 }, tool: 'place', overridePlace: false })
  editor.strokeBegin()
  editor.strokeApply({ x: 0, y: 5, z: 0 })
  editor.strokeCommit()
  editor.undo()
  editor.undo()
  const camAfterUndo = renderer.getCameraState()
  const layerStateStable = useEditorUi.getState().layerMode === 'below'
  check(
    'V11 连撤 2 次后相机 / 滑块不变（撤销不回退视图）',
    `target (${camBeforeUndo.target.map((v) => v.toFixed(2)).join(', ')}) · dist ${camBeforeUndo.distance.toFixed(3)} · fov ${camBeforeUndo.fov}`,
    `target (${camAfterUndo.target.map((v) => v.toFixed(2)).join(', ')}) · dist ${camAfterUndo.distance.toFixed(3)} · fov ${camAfterUndo.fov} · layerMode 稳定=${layerStateStable}`,
    vecNear(camBeforeUndo.target, camAfterUndo.target, 1e-6) && near(camBeforeUndo.distance, camAfterUndo.distance) && camBeforeUndo.fov === camAfterUndo.fov && layerStateStable,
  )

  // ── V9/F9 相机面板读回一致性 ──
  editor.applyCameraParams({ fov: 45, rotateSpeed: 1.5, damping: 0.2 })
  const camPanel = useEditorUi.getState().cameraPanel
  const camReal = renderer.getCameraState()
  check(
    'V11/F9 面板值与相机实际参数一致（读回）',
    'fov 45 · speed 1.5 · damping 0.2',
    `面板 fov ${camPanel.fov} · speed ${camPanel.rotateSpeed} · damping ${camPanel.damping} ‖ 实际 fov ${camReal.fov} · speed ${camReal.rotateSpeed} · damping ${camReal.damping}`,
    camPanel.fov === camReal.fov && camPanel.rotateSpeed === camReal.rotateSpeed && camPanel.damping === camReal.damping,
  )

  // ── 输出 ──
  resultTable.innerHTML = ''
  for (const c of checks) {
    const tr = resultTable.insertRow()
    tr.insertCell().textContent = c.name
    tr.insertCell().textContent = c.expect
    tr.insertCell().textContent = c.actual
    tr.insertCell().innerHTML = c.pass ? '<span class="pass">PASS</span>' : '<span class="fail">FAIL</span>'
  }
  const allPass = checks.every((c) => c.pass)
  const tr = resultTable.insertRow()
  tr.insertCell().innerHTML = '<strong>总判定</strong>'
  tr.insertCell().textContent = '—'
  tr.insertCell().textContent = allPass ? '全部通过' : '有不达标项（先分“设施 / 实现”再动手）'
  tr.insertCell().innerHTML = allPass ? '<span class="pass">PASS</span>' : '<span class="fail">FAIL</span>'
  raw.textContent = JSON.stringify(
    {
      date: new Date().toISOString(),
      userAgent: navigator.userAgent,
      nonEmpty: editor.volume.nonEmptyCount,
      stats: renderer.stats(),
      checks: checks.map((c) => ({ name: c.name, actual: c.actual, pass: c.pass })),
    },
    null,
    2,
  )
  progress.textContent = allPass ? '全部通过——数字与判定表贴回 editing-system-log.md。' : '有不达标项——先分类再动手。'
}

runButton.addEventListener('click', () => {
  runButton.disabled = true
  void run().finally(() => {
    runButton.disabled = false
  })
})
