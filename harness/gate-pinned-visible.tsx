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
import { GateDock } from '../src/ui/GateDock'
import { ShellContext } from '../src/ui/ShellContext'
import { RightDock } from '../src/ui/shell/RightDock'

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

/** 读回面（S7 起：闸门卡挂壳级 `.gate-dock`；面板只读 `aria-expanded` / `panel-body`） */
function inspect(): {
  ariaExpanded: string | null
  panelBodyExists: boolean
  dockExists: boolean
  dockHeightPx: number
  dockButtons: number
  dockCount: number
  hintText: string | null
  storePendingGate: string | null
} {
  const head = stage.querySelector('.panel-head')
  const dock = stage.querySelector('.gate-dock') as HTMLElement | null
  const hint = stage.querySelector('.panel-hint')
  return {
    ariaExpanded: head?.getAttribute('aria-expanded') ?? null,
    panelBodyExists: stage.querySelector('.panel-body') !== null,
    dockExists: dock !== null,
    dockHeightPx: dock ? Math.round(dock.getBoundingClientRect().height) : 0,
    dockButtons: dock ? dock.querySelectorAll('button').length : 0,
    dockCount: stage.querySelectorAll('.gate-dock').length,
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
function seedPendingGate(gateId = 'gate-probe-1'): string {
  const session = getAiSession()
  const gate = session.log.append({
    type: 'gateAsked',
    gateId,
    scope: 'plan',
    callId: null,
    summary: '计划：立树干 → 铺树冠 → 收口（探针造入）',
  })
  session.pushView()
  return gate.type === 'gateAsked' ? gate.gateId : gateId
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

  // ── 装一次，用 React root 复用（挂载 = 壳级 `GateDock` + 产品 `AiPanel`） ──
  stage.innerHTML = '<div id="probe-root"></div>'
  const rootEl = document.getElementById('probe-root') as HTMLDivElement
  let root: Root | null = createRoot(rootEl)
  root.render(
    <>
      <GateDock />
      <AiPanel />
    </>,
  )
  await frame()

  // ── ⑤-1 初始（AI 块默认展开、无闸门）⇒ 不渲染 dock ──
  check(
    '⑤-1 初始（无闸门）',
    'aria-expanded=true · dock 不存在（不占高）',
    JSON.stringify(inspect()),
    inspect().ariaExpanded === 'true' && inspect().dockExists === false && inspect().dockCount === 0,
  )

  // ── ⑤-2 折叠后（无闸门）⇒ 仍无 dock ──
  click('.panel-head')
  await frame()
  {
    const r = inspect()
    check('⑤-2 折叠后（无闸门）', 'aria-expanded=false · panel-body 卸载 · dock 不存在', JSON.stringify(r), r.ariaExpanded === 'false' && r.panelBodyExists === false && r.dockExists === false)
  }

  // ── ⑤-3 折叠 + pendingGate（★ 判据：与面板折叠无关、只挂一份）──
  const gateId = seedPendingGate()
  await frame()
  {
    const r = inspect()
    check(
      '⑤-3 折叠 + pendingGate（★ 判据）',
      `aria-expanded=false · dock 可见（高>0）· 闸门按钮=4 · dock 数=1 · store.pendingGate=${gateId}`,
      JSON.stringify(r),
      r.ariaExpanded === 'false' && r.dockExists === true && r.dockHeightPx > 0 && r.dockButtons === 4 && r.dockCount === 1 && r.storePendingGate === gateId,
    )
  }

  // ── ⑤-4 展开后对照（dock 仍 4 键、仍只一份）──
  click('.panel-head')
  await frame()
  {
    const r = inspect()
    check(
      '⑤-4 展开后对照',
      'aria-expanded=true · dock 仍在 · 闸门按钮=4 · dock 数=1',
      JSON.stringify(r),
      r.ariaExpanded === 'true' && r.dockExists === true && r.dockButtons === 4 && r.dockCount === 1,
    )
  }

  // ── ⑤-5 清闸门后对照 ⇒ dock 消失、按钮归 0（证明来自 pendingGate 而非静态 DOM）──
  clearPendingGate()
  await frame()
  {
    const r = inspect()
    check('⑤-5 清闸门后对照', 'dock 不存在 · 按钮 0 · store.pendingGate=null', JSON.stringify(r), r.dockExists === false && r.dockButtons === 0 && r.storePendingGate === null)
  }

  // ── ⑥ 三栏壳（M1）：换 RightDock 后闸门卡仍成立（同一个 GateDock，不随壳变） ──
  const m1GateId = seedPendingGate('gate-probe-2')
  root.render(
    <>
      <GateDock />
      <ShellContext.Provider value="m1">
        <RightDock />
      </ShellContext.Provider>
    </>,
  )
  await frame()
  {
    const r = inspect()
    const activeTab = stage.querySelector('[role="tab"][aria-selected="true"]')
    check(
      '⑥-1 三栏壳（M1）+ pendingGate',
      `dock 1 份 · 高>0 · 4 按钮 · 7 标签 · AI 选中带 ⚠ · store.pendingGate=${m1GateId}`,
      JSON.stringify({ ...r, activeTab: activeTab?.textContent ?? null }),
      r.dockExists === true &&
        r.dockHeightPx > 0 &&
        r.dockButtons === 4 &&
        r.dockCount === 1 &&
        stage.querySelectorAll('[role="tab"]').length === 7 &&
        activeTab !== null &&
        (activeTab.textContent ?? '').startsWith('AI') &&
        stage.querySelector('.tab-badge') !== null &&
        r.storePendingGate === m1GateId,
    )
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
