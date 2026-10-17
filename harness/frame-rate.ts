// harness · 帧率门槛（I8 / NFR-001/002）——页面内数值读回，输出 PASS/FAIL 与原始数字。
// 采集协议（plan §7）：固定场景（种子生成器 + 实测块数打印）· 固定窗口（1280×720，渲染 DPR=1）·
// 固定相机脚本（360° 旋转 → 2 次平移 → 缩放 → 复位，总 31 s ≥ 30 s）· 排除（前 2 s / hidden / blur）·
// 60 次单块操作（放置 / 擦除各 30，首样本丢弃）。
import * as THREE from 'three'
import { Volume } from '../src/core/volume'
import { VoxelView } from '../src/interaction/view'
import { buildSStarVolume, mulberry32 } from './seed'

const S_STAR = 20000
const CANVAS_W = 1280
const CANVAS_H = 720
const WARMUP_MS = 2000
const WINDOW_MS = 30000
const RUN_MS = 31000
const OP_COUNT = 60
const THRESH = { avgFps: 50, low1Fps: 30, medianOpMs: 34, p95OpMs: 100 } as const

const stage = document.getElementById('stage') as HTMLDivElement
const volume = new Volume()
const actualS = buildSStarVolume(volume, S_STAR)
const renderer = new VoxelView(stage, volume, null)
renderer.resize(CANVAS_W, CANVAS_H)
renderer.frameModel()

// ── preflight（test-preflight.md 四层；任一 FAIL ⇒ 中止且不产出数据）──
let invalidated = ''
type Row = [string, string, string, boolean]
const preflightRows: Row[] = []
const addPreflight = (layer: string, criterion: string, actual: string, pass: boolean): void => {
  preflightRows.push([layer, criterion, actual, pass])
  if (!pass) invalidated ||= `${layer}: ${criterion}（实测 ${actual}）`
}

const webglOk = renderer.renderer.getContext() instanceof WebGLRenderingContext || renderer.renderer.getContext() instanceof WebGL2RenderingContext
addPreflight('平台层', 'WebGL 上下文可用（非软件回退由人工抽查）', webglOk ? 'OK' : 'FAIL', webglOk)
addPreflight(
  '平台层',
  `画布 ${CANVAS_W}×${CANVAS_H}、渲染 DPR = 1（设备 DPR 记录在案）`,
  `canvas ${CANVAS_W}×${CANVAS_H} · devicePixelRatio = ${renderer.devicePixelRatio}`,
  true,
)
addPreflight('应用层', `S* 实测 = 标称 ${S_STAR}（不等即作废）`, String(actualS), actualS === S_STAR)
addPreflight('应用层', '相机脚本就绪（旋转 18s → 平移 6s → 缩放 6s → 复位 1s）', 'armed', true)
addPreflight('产物层', '本页输出 PASS/FAIL 表 + 原始数字（见下方结果区）', '结果区就绪', true)
addPreflight('过程层', '排除规则武装：前 2 s · document.hidden · blur；>250 ms 计入并计 hitch；不做重采样', 'armed', true)

const preflightTable = document.getElementById('preflight') as HTMLTableElement
for (const [layer, criterion, actual, pass] of preflightRows) {
  const tr = preflightTable.insertRow()
  tr.insertCell().textContent = layer
  tr.insertCell().textContent = criterion
  tr.insertCell().textContent = actual
  tr.insertCell().innerHTML = pass ? '<span class="pass">PASS</span>' : '<span class="fail">FAIL</span>'
}

const runButton = document.getElementById('run') as HTMLButtonElement
const progress = document.getElementById('progress') as HTMLSpanElement
const resultTable = document.getElementById('result') as HTMLTableElement
const raw = document.getElementById('raw') as HTMLPreElement

if (!invalidated) {
  runButton.disabled = false
  progress.textContent = `场景就绪：实测 S* = ${actualS}（= 标称）`
} else {
  progress.innerHTML = `<span class="fail">采集作废：${invalidated}——按协议不产出数据</span>`
}

interface RunStats {
  avgFps: number
  low1Fps: number
  medianFrameMs: number
  hitch: number
  opMedianMs: number
  opP95Ms: number
  opSamples: number
  includedFrames: number
  excludedFrames: number
  refreshEstimate: number
  resizeDuringRun: boolean
}

function percentile(sorted: number[], q: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))
  return sorted[idx]!
}

runButton.addEventListener('click', () => {
  runButton.disabled = true
  const t0 = performance.now()
  const frameDeltas: number[] = []
  const opDeltas: number[] = []
  let excluded = 0
  let interrupted = false // hidden/blur/resize 自上一帧起发生过 ⇒ 本帧不计
  let resized = false
  let prev = t0
  let finished = false

  const onHiddenChange = (): void => {
    interrupted = true
  }
  const onBlur = (): void => {
    interrupted = true
  }
  const onResize = (): void => {
    interrupted = true
    resized = true
  }
  document.addEventListener('visibilitychange', onHiddenChange)
  window.addEventListener('blur', onBlur)
  window.addEventListener('resize', onResize)

  // ── 相机脚本（各段固定时长，期间不做自由操作）──
  const home = { px: renderer.camera.position.clone(), tx: renderer.controls.target.clone() }
  const baseDir = home.px.clone().sub(home.tx)
  const baseLen = baseDir.length()
  baseDir.normalize()
  const panX = new THREE.Vector3(1, 0, 0)
  renderer.controls.autoRotate = true
  renderer.controls.autoRotateSpeed = 30 / 18 // 18 s 转 360°

  // ── 60 次单块操作（放置 / 擦除各 30，同一根牺牲柱交替；setTimeout 模拟输入事件时机）──
  const rng = mulberry32(4242)
  const keys = [...volume.palette.list()]
  const wallKey = keys.find((e) => e.identity === 'color:red-brick')!.key
  const columnBase: [number, number, number] = [-40, 0, 120 + Math.floor(rng() * 20)]
  let pendingOpT0: number | null = null
  let opPlaced = false
  const scheduleOp = (k: number): void => {
    const when = t0 + 3000 + k * 440
    const delay = Math.max(0, when - performance.now())
    setTimeout(() => {
      if (finished) return
      pendingOpT0 = performance.now() // "输入事件"时刻
      const placing = k % 2 === 0
      const [x, y, z] = columnBase
      const cellY = y + Math.floor(k / 2)
      const before = volume.getBlock(x, cellY, z)
      const after = placing ? wallKey : 0
      volume.setBlock(x, cellY, z, after)
      renderer.applyChanges([{ x, y: cellY, z, before, after }])
      opPlaced = true
    }, delay)
  }
  for (let k = 0; k < OP_COUNT; k++) scheduleOp(k)

  const tick = (): void => {
    const now = performance.now()
    const t = now - t0
    const dt = now - prev
    prev = now
    const visible = !document.hidden && document.hasFocus()
    if (t >= WARMUP_MS && t <= WARMUP_MS + WINDOW_MS) {
      if (interrupted || !visible) excluded++
      else frameDeltas.push(dt)
    }
    interrupted = false
    // 操作延迟：从"输入事件"到"包含该改动的帧被渲染后"的下一个 rAF 时刻
    if (opPlaced && pendingOpT0 !== null) {
      opDeltas.push(now - pendingOpT0)
      pendingOpT0 = null
      opPlaced = false
    }
    // 相机脚本分段：0–18 s 旋转 → 18–21 s 平移 +x → 21–24 s 平移回 → 24–27 s 推近 → 27–30 s 拉回 → 复位
    if (t < 18000) {
      renderer.controls.autoRotate = true
    } else {
      renderer.controls.autoRotate = false
      renderer.controls.target.copy(home.tx)
      if (t < 21000) {
        renderer.camera.position.addScaledVector(panX, (24 * dt) / 3000)
        renderer.controls.target.addScaledVector(panX, (24 * dt) / 3000)
      } else if (t < 24000) {
        renderer.camera.position.addScaledVector(panX, (-24 * dt) / 3000)
        renderer.controls.target.addScaledVector(panX, (-24 * dt) / 3000)
      } else if (t < 27000) {
        const s = (t - 24000) / 3000
        renderer.camera.position.copy(home.tx).addScaledVector(baseDir, baseLen * (1 - 0.35 * s))
      } else if (t < 30000) {
        const s = (t - 27000) / 3000
        renderer.camera.position.copy(home.tx).addScaledVector(baseDir, baseLen * (0.65 + 0.35 * s))
      } else {
        renderer.camera.position.copy(home.px)
      }
    }
    if (t < RUN_MS) {
      requestAnimationFrame(tick)
      return
    }
    finished = true
    document.removeEventListener('visibilitychange', onHiddenChange)
    window.removeEventListener('blur', onBlur)
    window.removeEventListener('resize', onResize)
    renderer.controls.autoRotate = false

    // ── 统计（plan §7 ① 指标定义）──
    const sortedAsc = [...frameDeltas].sort((a, b) => a - b)
    const sortedDesc = [...frameDeltas].sort((a, b) => b - a)
    const totalMs = frameDeltas.reduce((s, d) => s + d, 0)
    const avgFps = frameDeltas.length > 0 ? (frameDeltas.length / (totalMs / 1000)) : 0
    const low1Fps = sortedDesc.length > 0 ? 1000 / sortedDesc[Math.max(0, Math.floor(sortedDesc.length * 0.01))]! : 0
    const medianFrameMs = percentile(sortedAsc, 0.5)
    const hitch = frameDeltas.filter((d) => d > 250).length
    // 首样本丢弃（warm-up）
    const opSamples = opDeltas.slice(1)
    const opSorted = [...opSamples].sort((a, b) => a - b)
    const stats: RunStats = {
      avgFps,
      low1Fps,
      medianFrameMs,
      hitch,
      opMedianMs: opSorted.length > 0 ? percentile(opSorted, 0.5) : NaN,
      opP95Ms: opSorted.length > 0 ? percentile(opSorted, 0.95) : NaN,
      opSamples: opSamples.length,
      includedFrames: frameDeltas.length,
      excludedFrames: excluded,
      refreshEstimate: medianFrameMs > 0 ? 1000 / medianFrameMs : 0,
      resizeDuringRun: resized,
    }

    const checks: Array<[string, string, string, boolean]> = [
      ['NFR-001 平均帧率', `≥ ${THRESH.avgFps} fps`, stats.avgFps.toFixed(1), stats.avgFps >= THRESH.avgFps],
      ['NFR-001 1% low', `≥ ${THRESH.low1Fps} fps`, stats.low1Fps.toFixed(1), stats.low1Fps >= THRESH.low1Fps],
      ['NFR-002 操作延迟中位数', `≤ ${THRESH.medianOpMs} ms`, `${stats.opMedianMs.toFixed(1)} ms（n=${stats.opSamples}）`, stats.opMedianMs <= THRESH.medianOpMs],
      ['NFR-002 操作延迟 p95', `≤ ${THRESH.p95OpMs} ms`, `${stats.opP95Ms.toFixed(1)} ms`, stats.opP95Ms <= THRESH.p95OpMs],
      ['S* 实测 = 标称', String(S_STAR), String(actualS), actualS === S_STAR],
      ['窗口完整性', '无 resize / 排除帧已单独计', `excluded=${stats.excludedFrames}${resized ? ' · resize!' : ''}`, !resized],
    ]
    resultTable.innerHTML = ''
    for (const [name, expect, actual, pass] of checks) {
      const tr = resultTable.insertRow()
      tr.insertCell().textContent = name
      tr.insertCell().textContent = expect
      tr.insertCell().textContent = actual
      tr.insertCell().innerHTML = pass ? '<span class="pass">PASS</span>' : '<span class="fail">FAIL</span>'
    }
    const allPass = checks.every((c) => c[3])
    const verdict = resultTable.insertRow()
    verdict.insertCell().innerHTML = `<strong>总判定</strong>`
    verdict.insertCell().textContent = '—'
    verdict.insertCell().textContent = allPass ? '全部通过' : '有不达标项（先核口径再判实现，plan §6.4）'
    verdict.insertCell().innerHTML = allPass ? '<span class="pass">PASS</span>' : '<span class="fail">FAIL</span>'

    raw.textContent = JSON.stringify(
      {
        date: new Date().toISOString(),
        userAgent: navigator.userAgent,
        canvas: `${CANVAS_W}x${CANVAS_H}`,
        devicePixelRatio: renderer.devicePixelRatio,
        renderPixelRatio: 1,
        sStarNominal: S_STAR,
        sStarActual: actualS,
        refreshEstimateHz: Number(stats.refreshEstimate.toFixed(1)),
        avgFps: Number(stats.avgFps.toFixed(2)),
        low1Fps: Number(stats.low1Fps.toFixed(2)),
        medianFrameMs: Number(stats.medianFrameMs.toFixed(2)),
        hitchOver250ms: stats.hitch,
        opLatencyMedianMs: Number(stats.opMedianMs.toFixed(2)),
        opLatencyP95Ms: Number(stats.opP95Ms.toFixed(2)),
        opSamples: stats.opSamples,
        includedFrames: stats.includedFrames,
        excludedFrames: stats.excludedFrames,
        resizeDuringRun: stats.resizeDuringRun,
      },
      null,
      2,
    )
    progress.textContent = '采集完成——把上面的 JSON 与判定表贴回 voxel-core-log.md。'
  }
  requestAnimationFrame(tick)
})
