// harness · 关键块预览 + 每工具笔刷尺寸读回（r05 · `REQ-063` / `REQ-064`）：
//   挂**真** `VoxelView`（WebGL，与产品同链路）⇒ 读回面：
//     `REQ-063`：`getPreviewCells` / `getPreviewKeyCells` / `previewMeshCounts`（附属 / 关键两组实例数）
//     `REQ-064`：store 的 `brushSizes`（按工具）+ 镜像 `brushSize` + 笔刷一笔补丁的 `op.size`
//   判据与 `tests/edit/preview-key-cell.test.ts` / `tests/edit/brush-size-per-tool.test.ts` 同源（一处口径两处读回：
//   无头用例管逻辑、本页管"真渲染链路 + 真两组网格"）。加载自检同其它四页（顶层 try/catch，出错禁用按钮）。
import { brushVolume } from '../src/core/brush/volume'
import type { Coord, StrokeOp } from '../src/core/types'
import { MemoryProjectStore } from '../src/io/project-store'
import { VoxelView } from '../src/interaction/view'
import { Editor } from '../src/edit/editor'
import { useEditorUi } from '../src/state/editor-store'

const runButton = document.getElementById('run') as HTMLButtonElement
const progressSpan = document.getElementById('progress') as HTMLSpanElement

interface Check {
  name: string
  expect: string
  actual: string
  pass: boolean
}
const checks: Check[] = []

function check(name: string, expect: string, actual: string, pass: boolean): void {
  checks.push({ name, expect, actual, pass })
}

const at = (x: number, y: number, z: number): Coord => ({ x, y, z })
const key = (c: Coord): string => `${c.x},${c.y},${c.z}`
const sortedKeys = (cells: readonly Coord[]): string => cells.map(key).sort().join(';')
const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()))

let editor: Editor
let renderer: VoxelView

try {
  const stage = document.getElementById('stage') as HTMLDivElement
  editor = new Editor(new MemoryProjectStore())
  renderer = new VoxelView(stage, editor.volume, editor.parts)
  renderer.resize(900, 420)
  editor.attachRenderer(renderer)
  editor.setMode('edit')
  editor.setLayerView('below', 3)
  editor.setBrushSize({ x: 1, y: 1, z: 1 })
} catch (err) {
  runButton.disabled = true
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  progressSpan.textContent = `初始化失败，「运行全部检查」已禁用——${msg}（详见控制台）`
  console.error('[preview-key-tool-size] 初始化失败：', err)
}

async function run(): Promise<void> {
  const resultTable = document.getElementById('result') as HTMLTableElement
  const raw = document.getElementById('raw') as HTMLPreElement
  checks.length = 0

  // ── REQ-063 ① 2×2×2 ⇒ 恰 1 格关键 + 7 格附属 ──
  editor.setTool('place')
  editor.setBrushSize({ x: 2, y: 2, z: 2 })
  const preview222 = editor.previewAt(at(0, 0, 0))
  await nextFrame()
  {
    const counts = renderer.previewMeshCounts()
    const zone = brushVolume({ x: 2, y: 2, z: 2 }, at(0, 0, 0))
    check(
      '① 2×2×2：恰 1 格关键 + 其余附属 · 预览集合 = 笔刷体积',
      '关键 1 · 总 8 · 网格(关键/附属)=1/8 · 集合=体积',
      JSON.stringify({ preview: preview222.length, key: renderer.getPreviewKeyCells().length, counts, volume: zone.length, sameAsVolume: sortedKeys(renderer.getPreviewCells()) === sortedKeys(zone) }),
      preview222.length === 8 && renderer.getPreviewKeyCells().length === 1 && counts.key === 1 && counts.secondary === 8 && sortedKeys(renderer.getPreviewCells()) === sortedKeys(zone),
    )
  }

  // ── REQ-063 ② 1×1×1 ⇒ 关键 1 / 附属 0 ──
  editor.setBrushSize({ x: 1, y: 1, z: 1 })
  const preview111 = editor.previewAt(at(4, 0, 4))
  await nextFrame()
  {
    const counts = renderer.previewMeshCounts()
    check('② 1×1×1：该唯一格即关键块', '关键 1 · 附属 0（两组网格 1/1）', JSON.stringify({ preview: preview111.length, key: renderer.getPreviewKeyCells(), counts }), preview111.length === 1 && renderer.getPreviewKeyCells().length === 1 && counts.key === 1 && counts.secondary === 1)
  }

  // ── REQ-063 ③ 过滤后：关键 ≤ 1；锚点自身被过滤 ⇒ 0（隐藏层那一侧） ──
  {
    // 先放一块，让 (5,0,5) 成为已占用格
    editor.setBrushSize({ x: 1, y: 1, z: 1 })
    editor.place(5, 0, 5)
    editor.setBrushSize({ x: 2, y: 1, z: 1 })
    const occ = editor.previewAt(at(5, 0, 5)) // 锚点自身已占用 + 增量 ⇒ 锚点被过滤
    await nextFrame()
    const countsOcc = renderer.previewMeshCounts()
    check('③ 已占用·增量：锚点自身被过滤 ⇒ 关键 0（只剩附属）', '关键 0 · 预览 1 格（邻格）', JSON.stringify({ preview: occ, key: renderer.getPreviewKeyCells(), counts: countsOcc }), renderer.getPreviewKeyCells().length === 0 && countsOcc.key === 0 && occ.length === 1)

    // 隐藏层（跨层的 1×3×1 锚点 y=0）
    editor.setBrushSize({ x: 1, y: 3, z: 1 })
    editor.setLayerView('single', 1)
    const hidden = editor.previewAt(at(0, 0, 0))
    await nextFrame()
    check('③ 隐藏层：锚点层被隐藏 ⇒ 关键 0 · 只剩可见层那格', '关键 0 · 预览 1 格 (0,1,0)', JSON.stringify({ preview: hidden, key: renderer.getPreviewKeyCells(), counts: renderer.previewMeshCounts() }), renderer.getPreviewKeyCells().length === 0 && hidden.length === 1 && key(hidden[0]!) === '0,1,0')
    editor.setLayerView('below', 3)
  }

  // ── REQ-063 ④ 检视态 ⇒ 两组均 0 ──
  {
    editor.setBrushSize({ x: 2, y: 2, z: 2 })
    editor.previewAt(at(10, 0, 10))
    editor.setMode('inspect')
    await nextFrame()
    const counts = renderer.previewMeshCounts()
    check('④ 检视态无预览 ⇒ 关键 / 附属格数均 0', '两组网格 0/0 · 读回空', JSON.stringify({ counts, cells: renderer.getPreviewCells().length, key: renderer.getPreviewKeyCells().length }), counts.key === 0 && counts.secondary === 0 && renderer.getPreviewCells().length === 0)
    editor.setMode('edit')
  }

  // ── REQ-064 ① 三工具各持一份 + 来回切换各自保持 ──
  {
    editor.setTool('place')
    editor.setBrushSize({ x: 2, y: 2, z: 2 })
    editor.setTool('erase')
    editor.setBrushSize({ x: 1, y: 1, z: 1 })
    editor.setTool('paint')
    editor.setBrushSize({ x: 3, y: 1, z: 1 })
    const kept: string[] = []
    for (const t of ['place', 'erase', 'paint', 'erase', 'place', 'paint'] as const) {
      editor.setTool(t)
      kept.push(`${t}=${JSON.stringify(useEditorUi.getState().brushSize)}`)
    }
    const s = useEditorUi.getState().brushSizes
    check(
      'REQ-064① 放置 2×2×2 / 擦除 1×1×1 / 上色 3×1×1 ⇒ 来回切换各自保持',
      'place 2×2×2 · erase 1×1×1 · paint 3×1×1（切换读回同值）',
      JSON.stringify({ brushSizes: s, 切换序列: kept }),
      JSON.stringify(s) === JSON.stringify({ place: { x: 2, y: 2, z: 2 }, erase: { x: 1, y: 1, z: 1 }, paint: { x: 3, y: 1, z: 1 } }),
    )
  }

  // ── REQ-064 ② 预览体积与补丁 size 同源 ──
  {
    editor.setTool('place')
    editor.setBrushSize({ x: 2, y: 1, z: 1 })
    const preview = editor.previewAt(at(20, 0, 20))
    await nextFrame()
    const counts = renderer.previewMeshCounts()
    editor.strokeBegin()
    editor.strokeApply(at(20, 0, 20))
    editor.strokeCommit()
    const patch = editor.log.patches[editor.log.patches.length - 1]!
    const opSize = (patch.op as StrokeOp).size
    check('REQ-064② 切到某工具：预览体积与补丁 size 都用该工具那份', '预览 2 格 · op.size = 2×1×1 · 关键 1', JSON.stringify({ preview: preview.length, counts, opSize, label: patch.label }), preview.length === 2 && counts.key === 1 && JSON.stringify(opSize) === JSON.stringify({ x: 2, y: 1, z: 1 }))
  }

  // ── REQ-064 ④ 每轴 1–8 与越界报错口径不变 ──
  {
    const messages: string[] = []
    for (const bad of [{ x: 0, y: 1, z: 1 }, { x: 1, y: 9, z: 1 }]) {
      try {
        editor.setBrushSize(bad) // 会话态 setter 只存值（与改动前同）；校验在体积计算处抛出
        editor.previewAt(at(0, 0, 0))
        messages.push('未抛错')
      } catch (e) {
        messages.push((e as Error).message)
      }
    }
    editor.setBrushSize({ x: 1, y: 1, z: 1 })
    check('REQ-064④ 每轴 1–8：越界仍抛教学式报错（validateBrushSize 原样）', '两条越界各含「1–8」', JSON.stringify(messages.map((m) => m.slice(0, 46))), messages.every((m) => m.includes('1–8')))
  }

  // ── REQ-064 ⑤ 项目文件不含尺寸 ──
  {
    const file = editor.exportFile()
    check('REQ-064⑤ 项目文件不含笔刷尺寸（会话态口径）', 'brushSize / brushSizes 均 0 命中', JSON.stringify({ brushSize: /brushSize/i.test(file), brushSizes: /brushSizes/i.test(file), len: file.length }), !/brushSize|brushSizes/i.test(file))
  }

  // 预览收尾：给一张可目视的 3×1×3 关键块预览（读回不参与判定，供人看"红一格 + 绿八格"）
  editor.setTool('place')
  editor.setBrushSize({ x: 3, y: 1, z: 3 })
  editor.previewAt(at(24, 0, 24))
  await nextFrame()

  const pass = checks.filter((c) => c.pass).length
  resultTable.innerHTML = `<tr><th>检查</th><th>期望</th><th>读回</th><th>结果</th></tr>${checks
    .map((c) => `<tr><td>${c.name}</td><td>${c.expect}</td><td>${c.actual}</td><td class="${c.pass ? 'pass' : 'fail'}">${c.pass ? 'PASS' : 'FAIL'}</td></tr>`)
    .join('')}`
  raw.textContent = checks.map((c) => `${c.pass ? 'PASS' : 'FAIL'} ${c.name} | ${c.actual}`).join('\n')
  progressSpan.textContent = `${pass}/${checks.length} PASS`
  console.info('[preview-key-tool-size]', checks)
}

try {
  runButton.addEventListener('click', () => {
    runButton.disabled = true
    void run()
      .catch((err) => {
        progressSpan.textContent = `运行失败：${String(err)}（详见控制台）`
        console.error('[preview-key-tool-size]', err)
      })
      .finally(() => {
        runButton.disabled = false
      })
  })
  progressSpan.textContent = '就绪（真 VoxelView + WebGL）'
} catch (err) {
  runButton.disabled = true
  progressSpan.textContent = `初始化失败：${String(err)}`
  console.error('[preview-key-tool-size] 初始化失败：', err)
}
