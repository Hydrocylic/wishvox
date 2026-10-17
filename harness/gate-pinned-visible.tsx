// harness · 闸门卡折叠可见读回（r05 `REQ-061` 验收① / T4 件三）：
//   折叠态 + `pendingGate` ⇒ `panel-pinned` 仍可见（高 > 0）且**闸门按钮数 = 4**；
//   对照 = 折叠态无闸门 ⇒ 不可见 · 展开态同位置同按钮数 · 清闸门 ⇒ 按钮归 0（证明这 4 个按钮来自 `pendingGate`）。
//
// 与 `verify-261008b` §A-⑤/§C-⑤ 的关系：**从临时副本的探针页搬来**（判据未改——见页内 `EXPECT`），
// 差别只有两处（都是"搬"的必要条件，不是判据变更）：
//   ① 落点从副本根目录的 `probe-ai-panel.html` 改为 `harness/gate-pinned-visible.html`；
//   ② CDP 驱动换成页内"点运行"按钮（本页自驱动，无需外部驱动脚本与 dev server 之外的工具）。
// 读回面与原探针逐字一致：`.panel-head[aria-expanded]` / `.panel-pinned` 的 `getBoundingClientRect().height` /
//   `.panel-pinned button` 计数 / 折叠摘要文案 / `useAiUi` 的 `view.pendingGate`。
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { getAiSession } from '../src/app/runtime'
import { useAiUi } from '../src/state/ai-store'
import { AiPanel } from '../src/ui/AiPanel'

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

const stage = document.getElementById('stage') as HTMLDivElement

/** 一帧渲染 + 测量（两次 rAF ⇒ React 提交与布局都落定） */
async function frame(): Promise<void> {
  await new Promise<void>((r) => requestAnimationFrame(() => r()))
  await new Promise<void>((r) => requestAnimationFrame(() => r()))
}

/** 读回面（同 `verify-261008b` §A-⑤ 的字段） */
function inspect(): {
  ariaExpanded: string | null
  panelPinnedExists: boolean
  panelBodyExists: boolean
  pinnedVisible: boolean
  pinnedHeightPx: number
  pinnedButtons: number
  hintText: string | null
  storePendingGate: string | null
} {
  const head = stage.querySelector('.panel-head')
  const pinned = stage.querySelector('.panel-pinned') as HTMLElement | null
  const hint = stage.querySelector('.panel-hint')
  return {
    ariaExpanded: head?.getAttribute('aria-expanded') ?? null,
    panelPinnedExists: pinned !== null,
    panelBodyExists: stage.querySelector('.panel-body') !== null,
    pinnedVisible: pinned !== null && pinned.getBoundingClientRect().height > 0,
    pinnedHeightPx: pinned ? Math.round(pinned.getBoundingClientRect().height) : 0,
    pinnedButtons: pinned ? pinned.querySelectorAll('button').length : 0,
    hintText: hint?.textContent ?? null,
    storePendingGate: useAiUi.getState().view?.pendingGate?.gateId ?? null,
  }
}

function click(sel: string): void {
  const el = stage.querySelector(sel) as HTMLElement | null
  if (!el) throw new Error(`探针：找不到 ${sel}`)
  el.click()
}

/** 造真实待答闸门：**走 `SessionLog.append`（产品同一入口）**，再经 `pushView()` 投影进 UI store */
function seedPendingGate(): string {
  const session = getAiSession()
  const gate = session.log.append({
    type: 'gateAsked',
    gateId: 'gate-probe-1',
    scope: 'plan',
    callId: null,
    summary: '计划：立树干 → 铺树冠 → 收口（探针造入）',
  })
  session.pushView()
  return gate.type === 'gateAsked' ? gate.gateId : 'gate-probe-1'
}

function clearPendingGate(): void {
  const session = getAiSession()
  session.answerGate('gate-probe-1', 'skip')
}

async function run(): Promise<void> {
  const resultTable = document.getElementById('result') as HTMLTableElement
  const raw = document.getElementById('raw') as HTMLPreElement
  checks.length = 0

  const session = getAiSession() // 组合根惰性单例（探针内自足；不读存档、不用 key）
  session.clearSession()

  // ── 装一次，用 React root 复用（挂载 = 产品 `AiPanel` 整块） ──
  stage.innerHTML = '<div id="probe-root"></div>'
  const rootEl = document.getElementById('probe-root') as HTMLDivElement
  let root: Root | null = createRoot(rootEl)
  root.render(<AiPanel />)
  await frame()

  // ── ⑤-1 初始（AI 块默认展开、无闸门）──
  check(
    '⑤-1 初始（AI 块默认展开、无闸门）',
    'aria-expanded=true · panel-pinned 存在但不可见 · 折叠摘要 none',
    JSON.stringify(inspect()),
    inspect().ariaExpanded === 'true' && inspect().panelPinnedExists && inspect().pinnedVisible === false,
  )

  // ── ⑤-2 折叠后（无闸门）⇒ 常显区不可见 ──
  click('.panel-head')
  await frame()
  {
    const r = inspect()
    check('⑤-2 折叠后（无闸门）', 'aria-expanded=false · panel-body 卸载 · pinnedVisible=false · 按钮 0', JSON.stringify(r), r.ariaExpanded === 'false' && r.panelBodyExists === false && r.pinnedVisible === false && r.pinnedButtons === 0)
  }

  // ── ⑤-3 折叠 + pendingGate（★ 判据）──
  const gateId = seedPendingGate()
  await frame()
  {
    const r = inspect()
    check(
      '⑤-3 折叠 + pendingGate（★ 判据）',
      `aria-expanded=false · pinnedVisible=true · 闸门按钮数=4 · store.pendingGate=${gateId}`,
      JSON.stringify(r),
      r.ariaExpanded === 'false' && r.panelBodyExists === false && r.pinnedVisible === true && r.pinnedButtons === 4 && r.storePendingGate === gateId,
    )
  }

  // ── ⑤-4 展开后对照（同位置同按钮数）──
  click('.panel-head')
  await frame()
  {
    const r = inspect()
    check('⑤-4 展开后对照（同位置）', 'aria-expanded=true · pinnedVisible=true · 闸门按钮数=4', JSON.stringify(r), r.ariaExpanded === 'true' && r.pinnedVisible === true && r.pinnedButtons === 4)
  }

  // ── ⑤-5 清闸门后对照 ⇒ 按钮归 0（证明按钮来自 pendingGate 而非静态 DOM）──
  clearPendingGate()
  await frame()
  {
    const r = inspect()
    check('⑤-5 清闸门后对照', 'pinnedVisible=false · 按钮 0 · store.pendingGate=null', JSON.stringify(r), r.pinnedVisible === false && r.pinnedButtons === 0 && r.storePendingGate === null)
  }

  root?.unmount()
  root = null

  const pass = checks.filter((c) => c.pass).length
  resultTable.innerHTML = `<tr><th>检查</th><th>期望</th><th>读回</th><th>结果</th></tr>${checks
    .map((c) => `<tr><td>${c.name}</td><td>${c.expect}</td><td>${c.actual}</td><td class="${c.pass ? 'pass' : 'fail'}">${c.pass ? 'PASS' : 'FAIL'}</td></tr>`)
    .join('')}`
  raw.textContent = checks.map((c) => `${c.pass ? 'PASS' : 'FAIL'} ${c.name} | ${c.actual}`).join('\n')
  const progress = document.getElementById('progress') as HTMLSpanElement
  progress.textContent = `${pass}/${checks.length} PASS`
  console.info('[gate-pinned-visible]', checks)
}

const runButton = document.getElementById('run') as HTMLButtonElement
const progressSpan = document.getElementById('progress') as HTMLSpanElement
try {
  runButton.addEventListener('click', () => {
    runButton.disabled = true
    void run()
      .catch((err) => {
        progressSpan.textContent = `运行失败：${String(err)}（详见控制台）`
        console.error('[gate-pinned-visible]', err)
      })
      .finally(() => {
        runButton.disabled = false
      })
  })
  progressSpan.textContent = '就绪（真产品件 · 不出网）'
} catch (err) {
  runButton.disabled = true
  progressSpan.textContent = `初始化失败：${String(err)}`
  console.error('[gate-pinned-visible] 初始化失败：', err)
}
