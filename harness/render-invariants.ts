// harness · 渲染不变量（I9 / REQ-018 数值读回）。
// 场景：一座 PD1 小屋 + 四个"跨界探针"块（自填 chunk(0,0,0)/(1,0,0)/(0,1,0)/(0,0,1) 各驻留）
//       + 一块 color:orange（橙色系的普通块）。
// I9 证据形态（T11 加固）：**集合等式**——读回"本次哪些 chunk 的 buildSeq 变了"，
// 与模型层 affectedResidentChunks 的集合逐元素比对（不只比个数）；另保留"重建 < 驻留"作全量重建的独立反证。
// T14（2026-10-01）：另起离屏空场景，读回"地面落格存在 + 第一块放置（residentChunks 0 → 1）+ 重建集合 = 受影响集合"。
// T15（2026-10-01）：擦掉某 chunk 的最后一个块 ⇒ 对账卸载（卸载集合 = {该 chunk} · residentChunks 减 1 · 集合等式仍成立）。
import { internBuiltin } from '../src/core/builtin-palette'
import { chunkKey } from '../src/core/coords'
import { PartRegistry } from '../src/core/parts'
import { Volume } from '../src/core/volume'
import { VoxelView } from '../src/interaction/view'
import { buildHouse } from './seed'

// T19 加载自检：顶层初始化进 try/catch——出错 ⇒ 页面显示错误行并禁用按钮，杜绝"静默点不动"
const runButton = document.getElementById('run') as HTMLButtonElement
const progressSpan = document.getElementById('progress') as HTMLSpanElement

let volume!: Volume
let parts!: PartRegistry
let renderer!: VoxelView
let grayKey = 0
let brickKey = 0
let orangeKey = 0
let houseBlocks = 0
let partId = ''

try {
  const stage = document.getElementById('stage') as HTMLDivElement
  volume = new Volume()
  parts = new PartRegistry()
  renderer = new VoxelView(stage, volume, parts)
  renderer.resize(1024, 576)
  renderer.frameModel()

  // T19：先 intern 再取键（与 tests/ 一致）。原写法在未 intern 的空调色板上 find ⇒ undefined
  // ⇒ 顶层抛 TypeError ⇒ 文件末尾的按钮监听永远挂不上（"运行全部检查"点不动）。
  const keysMap = internBuiltin(volume.palette)
  grayKey = keysMap.get('color:light-gray')!
  brickKey = keysMap.get('color:red-brick')!
  orangeKey = keysMap.get('color:orange')! // 故意不进 MC 映射表（缺项触发器）

  // 场景：跨界探针（与 tests/voxel-model.test.ts 的 I9 分母用例同构）+ 一座小屋 + 一个已知构件 + 一块缺项身份
  volume.setBlock(5, 5, 5, grayKey)
  volume.setBlock(20, 5, 5, grayKey)
  volume.setBlock(5, 20, 5, grayKey)
  volume.setBlock(5, 5, 20, grayKey)
  volume.setBlock(8, 5, 8, orangeKey)
  houseBlocks = buildHouse(volume, 32, 0, 32)
  const part = parts.create('测试构件', 0)
  partId = part.id
  for (const b of volume.iterBlocks()) {
    if (b.x >= 32) parts.assign(b.x, b.y, b.z, partId)
  }
} catch (err) {
  runButton.disabled = true
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  progressSpan.textContent = `初始化失败，「运行全部检查」已禁用——${msg}（详见控制台）`
  console.error('[render-invariants] 初始化失败：', err)
}

interface Check {
  name: string
  expect: string
  actual: string
  pass: boolean
}
const checks: Check[] = []

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()))

function place(x: number, y: number, z: number, key: number): void {
  const before = volume.getBlock(x, y, z)
  volume.setBlock(x, y, z, key)
  renderer.applyChanges([{ x, y, z, before, after: key }])
}

function erase(x: number, y: number, z: number): void {
  const before = volume.getBlock(x, y, z)
  volume.setBlock(x, y, z, 0)
  renderer.applyChanges([{ x, y, z, before, after: 0 }])
}

/** 前后两份 buildSeq 快照做差 = 本次实例数据被重建的 chunk 集合 */
function rebuiltChunkKeys(before: Map<string, number>, after: Map<string, number>): string[] {
  const changed: string[] = []
  for (const [key, seq] of after) {
    if (before.get(key) !== seq) changed.push(key)
  }
  return changed.sort()
}

function setsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

async function run(): Promise<void> {
  const progress = document.getElementById('progress') as HTMLSpanElement
  const resultTable = document.getElementById('result') as HTMLTableElement
  const raw = document.getElementById('raw') as HTMLPreElement
  renderer.rebuildAll()
  await nextFrame()
  await nextFrame()

  // ── I9（T11 加固：集合等式）——单块改动 ⇒ 重建 chunk 集合 = 受影响 chunk 集合（逐元素）──
  const case9 = (label: string, x: number, y: number, z: number, act: 'place' | 'erase'): void => {
    const before = renderer.buildSeqSnapshot()
    if (act === 'place') place(x, y, z, brickKey)
    else erase(x, y, z)
    // 分母按定义取"改动后"的驻留状态（Volume.affectedResidentChunks 的口径）
    const expected = [
      ...new Set(volume.affectedResidentChunks(x, y, z).map((c) => chunkKey(c.cx, c.cy, c.cz))),
    ].sort()
    const rebuilt = rebuiltChunkKeys(before, renderer.buildSeqSnapshot())
    const resident = renderer.stats().residentChunks
    checks.push({
      name: `I9 ${label}（集合等式）`,
      expect: `重建集合 = 受影响集合 {${expected.join(' ; ')}} ，且 |重建| < 驻留 ${resident}`,
      actual: `重建 {${rebuilt.join(' ; ')}}（|重建| ${rebuilt.length} = |受影响| ${expected.length}）`,
      pass: setsEqual(rebuilt, expected) && rebuilt.length < resident,
    })
  }
  case9('chunk 内部放置', 6, 6, 6, 'place')
  case9('面跨界放置（x=15）', 15, 5, 5, 'place')
  case9('角跨界放置（15,15,15）', 15, 15, 15, 'place')
  case9('面跨界擦除（x=15）', 15, 5, 5, 'erase')
  case9('chunk 内部擦除', 6, 6, 6, 'erase')

  // ── T15：擦掉某 chunk 的最后一个块 ⇒ 对账卸载（幽灵块修复）──
  // I9 五组的擦除都让 chunk 里还剩别的块 ⇒ "空 chunk 卸载"从未被覆盖，这里补上（沉淀不变量）。
  const g15SnapBefore = renderer.buildSeqSnapshot()
  const g15UnloadedBefore = renderer.stats().unloadedChunks
  const g15ResidentBefore = renderer.stats().residentChunks
  erase(20, 5, 5) // chunk(1,0,0) 在本场景只有这一块（跨界探针）⇒ 擦掉即清空该 chunk
  const g15Expected = [
    ...new Set(volume.affectedResidentChunks(20, 5, 5).map((c) => chunkKey(c.cx, c.cy, c.cz))),
  ].sort()
  const g15Rebuilt = rebuiltChunkKeys(g15SnapBefore, renderer.buildSeqSnapshot())
  const g15UnloadedKeys = [...g15SnapBefore.keys()]
    .filter((k) => !renderer.buildSeqSnapshot().has(k))
    .sort()
  const g15UnloadedDelta = renderer.stats().unloadedChunks - g15UnloadedBefore
  const g15ResidentAfter = renderer.stats().residentChunks
  checks.push({
    name: 'T15 擦掉 chunk 的最后一个块：卸载集合 = {该 chunk}，residentChunks 减 1（无幽灵块）',
    expect: `卸载 {1,0,0}（计数 +1），residentChunks ${g15ResidentBefore} → ${g15ResidentBefore - 1}`,
    actual: `卸载 {${g15UnloadedKeys.join(' ; ')}}（计数 +${g15UnloadedDelta}），residentChunks ${g15ResidentBefore} → ${g15ResidentAfter}`,
    pass:
      g15UnloadedKeys.length === 1 &&
      g15UnloadedKeys[0] === '1,0,0' &&
      g15UnloadedDelta === 1 &&
      g15ResidentAfter === g15ResidentBefore - 1,
  })
  checks.push({
    name: 'T15 擦掉 chunk 的最后一个块：重建集合 = 受影响集合（空 chunk 场景集合等式仍成立）',
    expect: '∅ = ∅（改动后不再驻留 ⇒ 不进分母；mesh 由卸载对账收走，不靠重建）',
    actual: `重建 {${g15Rebuilt.join(' ; ')}} = 受影响 {${g15Expected.join(' ; ')}}`,
    pass: setsEqual(g15Rebuilt, g15Expected),
  })

  // ── I9：NaN 计数 / 空帧 ──
  const statsNow = renderer.stats()
  checks.push({ name: 'I9 NaN 计数', expect: '= 0', actual: String(statsNow.nanCount), pass: statsNow.nanCount === 0 })
  checks.push({ name: 'I9 空帧（可见性空洞）', expect: '= 0', actual: String(statsNow.emptyFrames), pass: statsNow.emptyFrames === 0 })

  // ── I9 伴生：draw call 与驻留 chunk 的关系（记实测，不硬编码）──
  await nextFrame()
  const s2 = renderer.stats()
  checks.push({
    name: 'I9 draw call ↔ 驻留 chunk（记录值）',
    expect: '关系 = 每 chunk 1 次实例绘制（T17 已去网格；记实测）',
    actual: `drawCalls ${s2.drawCalls} · residentChunks ${s2.residentChunks} · instances ${s2.instanceCount}`,
    pass: true,
  })

  // ── REQ-018：选中构件 ⇒ 高亮块计数 = 该构件含块数 ──
  renderer.setHighlightedPart(partId)
  await nextFrame()
  const highlighted = renderer.stats().highlightedCount
  const partCount = parts.blockCount(partId)
  checks.push({
    name: 'REQ-018 高亮计数 = 选中构件含块数',
    expect: String(partCount),
    actual: String(highlighted),
    pass: highlighted === partCount,
  })
  renderer.setHighlightedPart(null)

  // ── T14：空场景 ⇒ 地面落格存在 + 第一块放置（residentChunks 0 → 1）+ 重建集合 = 受影响集合 ──
  // 独立离屏空场景（不动本页主场景），走真实 pick() 路径（相机 → NDC → 射线 → 地面平面）。
  const emptyStage = document.createElement('div')
  emptyStage.style.cssText = 'position:fixed;left:-20000px;top:0;width:1024px;height:576px;'
  document.body.appendChild(emptyStage)
  const emptyVolume = new Volume()
  const emptyRenderer = new VoxelView(emptyStage, emptyVolume, null)
  emptyRenderer.resize(1024, 576)
  emptyRenderer.camera.position.set(8, 50, 8) // 从上向下看地面中心 ⇒ 视口中心射线必与 y=0 平面相交
  emptyRenderer.controls.target.set(8, 0, 8)
  emptyRenderer.controls.update()
  await nextFrame() // 让渲染循环刷新 camera.matrixWorld（pick 的射线由它决定）
  const er = emptyStage.getBoundingClientRect()
  const center = emptyRenderer.pick(er.left + er.width / 2, er.top + er.height / 2)
  checks.push({
    name: 'T14 空场景：地面落格存在',
    expect: 'pick ≠ null 且落格在 y=0 层',
    actual: center ? `cell [${center.cell.join(', ')}]` : 'null',
    pass: center !== null && center.cell[1] === 0,
  })
  emptyRenderer.camera.position.set(8, 10, 8)
  emptyRenderer.controls.target.set(108, 10, 8) // 水平视线：不落到可放置地面范围 ⇒ 拒绝（null）
  emptyRenderer.controls.update()
  await nextFrame()
  const flat = emptyRenderer.pick(er.left + er.width / 2, er.top + er.height / 2)
  checks.push({
    name: 'T14 空场景：水平射线 ⇒ 拒绝',
    expect: 'pick = null',
    actual: flat ? `cell [${flat.cell.join(', ')}]` : 'null',
    pass: flat === null,
  })
  if (center) {
    const t14Key = internBuiltin(emptyVolume.palette).get('color:red')!
    const residentBefore = emptyRenderer.stats().residentChunks
    const snap = emptyRenderer.buildSeqSnapshot()
    emptyVolume.setBlock(center.cell[0], 0, center.cell[2], t14Key)
    emptyRenderer.applyChanges([{ x: center.cell[0], y: 0, z: center.cell[2], before: 0, after: t14Key }])
    const rebuilt = rebuiltChunkKeys(snap, emptyRenderer.buildSeqSnapshot())
    const expected = [
      ...new Set(
        emptyVolume.affectedResidentChunks(center.cell[0], 0, center.cell[2]).map((c) => chunkKey(c.cx, c.cy, c.cz)),
      ),
    ].sort()
    const residentAfter = emptyRenderer.stats().residentChunks
    checks.push({
      name: 'T14 空场景：放置第一块 ⇒ residentChunks 0 → 1 且重建集合 = 受影响集合',
      expect: `0 → 1，重建集合 = 受影响集合 {${expected.join(' ; ')}}`,
      actual: `${residentBefore} → ${residentAfter}，重建 {${rebuilt.join(' ; ')}}`,
      pass: residentBefore === 0 && residentAfter === 1 && setsEqual(rebuilt, expected),
    })
  } else {
    checks.push({
      name: 'T14 空场景：放置第一块 ⇒ residentChunks 0 → 1 且重建集合 = 受影响集合',
      expect: '0 → 1，重建集合 = 受影响集合',
      actual: '跳过（落格检查未通过）',
      pass: false,
    })
  }
  emptyRenderer.dispose()
  emptyStage.remove()

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
  tr.insertCell().textContent = allPass ? '全部通过' : '有不达标项（先分“设施 / 实现”再动手，plan §6.4）'
  tr.insertCell().innerHTML = allPass ? '<span class="pass">PASS</span>' : '<span class="fail">FAIL</span>'
  raw.textContent = JSON.stringify(
    {
      date: new Date().toISOString(),
      userAgent: navigator.userAgent,
      scene: { houseBlocks, partBlocks: partCount, missingIdentities: [] as string[] },
      stats: renderer.stats(),
      checks: checks.map((c) => ({ name: c.name, actual: c.actual, pass: c.pass })),
    },
    null,
    2,
  )
  progress.textContent = allPass ? '全部通过——数字与判定表贴回 voxel-core-log.md。' : '有不达标项——按 plan §6.4 先分类。'
}

runButton.addEventListener('click', () => {
  runButton.disabled = true
  void run().finally(() => {
    runButton.disabled = false
  })
})
