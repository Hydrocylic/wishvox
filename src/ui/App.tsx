import { useEffect, useRef } from 'react'
import { getEditor } from '../app/runtime'
import { downloadJson, readTextFile } from '../io/file-transfer'
import { useEditorUi } from '../state/editor-store'
import { cmd, commandEnabled } from './commands'
import type { AppCommand } from './commands'
import { EditorWorkspace } from './EditorWorkspace'
import { isTextEntryTarget } from './floating/UiInputBoundary'

const css = `
  :root {
    --bg: #0f1218;
    --bg-rail: #141922;
    --line: #232b35;
    --line-soft: #1d242d;
    --fg: #e3e9f0;
    --fg-dim: #99a4b1;
    --fg-mute: #6c7784;
    --accent: #57c26a;
    --btn: #1e252e;
    --btn-hover: #29323d;
    --btn-line: #2e3742;
    /* 状态四色（r05 · 规格 §2.1 / REQ-060）：三色一中性，值沿用现状三色不重调色。
       状态色一律经 token 引用（验收② grep：状态色无散落字面量）；选中 / 身份色不在此列（§2.4）。 */
    --ok: #7bbf7b;
    --warn: #d9a94e;
    --err: #c0705d;
    --mute: #8a929c;
  }
  * { box-sizing: border-box; }
  html, body, #root { height: 100%; margin: 0; }
  body { font-family: system-ui, "Segoe UI", "Microsoft YaHei", sans-serif; background: var(--bg); color: var(--fg); font-size: 13px; }
  button { background: var(--btn); color: var(--fg); border: 1px solid var(--btn-line); border-radius: 6px; padding: 4px 10px; cursor: pointer; font: inherit; }
  button:disabled { opacity: 0.36; cursor: default; }
  button:hover:not(:disabled) { background: var(--btn-hover); }
  select, input, textarea { background: #1a212a; color: var(--fg); border: 1px solid var(--btn-line); border-radius: 6px; padding: 4px 6px; font: inherit; }
  select:focus, input:focus, textarea:focus { outline: 1px solid var(--accent); outline-offset: 0; }
  .app { height: 100%; display: flex; flex-direction: column; }
  .topbar { display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-bottom: 1px solid var(--line); background: #12161d; }
  .brand { font-weight: 700; letter-spacing: .01em; }
  .save { color: var(--fg-mute); font-size: 12px; }
  /* 存储降级（REQ-002 补）：内存回退必须可见，不能继续显示"已保存" */
  .save-volatile { color: var(--warn); }
  .spacer { flex: 1; }
  .icon-btn { min-width: 34px; padding: 3px 8px; font-size: 15px; line-height: 1.35; }
  .mini-btn { padding: 2px 7px; font-size: 13px; line-height: 1.3; }
  .row-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row-meta { color: var(--fg-mute); flex: none; font-size: 11px; }
  .mode-pill { padding: 3px 12px; border-radius: 999px; font-size: 12px; }
  .mode-pill.edit { background: #24512e; border-color: #2f6b3c; }
  .mode-pill.inspect { background: #262d37; }
  .workspace { flex: 1; display: flex; min-height: 0; position: relative; }
  .statusbar { display: flex; gap: 16px; padding: 4px 12px; border-top: 1px solid var(--line); font-size: 12px; color: var(--fg-mute); background: #12161d; }
  /* ── 可折叠区块（Section）── */
  .panel { border-top: 1px solid var(--line-soft); }
  .panel:first-of-type { border-top: 0; }
  .panel-head { width: 100%; display: flex; align-items: center; gap: 6px; padding: 7px 10px; border: 0; border-radius: 0; background: transparent; text-align: left; font-size: 12.5px; font-weight: 600; color: var(--fg); }
  .panel-head:hover:not(:disabled) { background: rgba(255,255,255,0.04); }
  .panel-head .chev { width: 11px; color: var(--fg-mute); font-size: 10px; flex: none; }
  .panel-emoji { font-size: 14px; flex: none; }
  .panel-title { flex: none; }
  .panel-hint { margin-left: auto; padding-left: 8px; color: var(--fg-mute); font-weight: 400; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .panel-body { padding: 2px 10px 12px; }
  .panel .panel { margin: 8px -10px 0; border-top: 1px solid var(--line); }
  .rail-group { padding: 10px 10px 3px; font-size: 10.5px; letter-spacing: .1em; color: var(--fg-mute); text-transform: uppercase; }
  .panel-body > :first-child { margin-top: 0; }
  .field { display: block; margin: 6px 0; font-size: 12px; color: var(--fg-dim); }
  .field > select, .field > input { width: 100%; margin-top: 2px; }
  .note { color: var(--fg-mute); font-size: 11px; margin: 6px 0 0; line-height: 1.45; }
  .warn { color: var(--warn); font-size: 12px; margin: 4px 0; }
  /* ── 左栏（r05 T2）── 三段常开、不折叠（§1.2 末段 / Q4）；组标签复用 .rail-group 与右栏同构 */
  .panel-emoji-btn { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 6px 0; font-size: 11px; color: var(--fg-dim); }
  .panel-emoji-btn .glyph { font-size: 17px; line-height: 1; }
  .panel-emoji-btn.on { background: rgba(87,194,106,0.16); border-color: var(--accent); color: #bdf0c6; }
  /* ── 常显区（r05 T4 · REQ-061）：闸门卡挂这里 ⇒ AI 块折叠时它仍在（折叠只收正文） ── */
  .panel-pinned { padding: 2px 10px 10px; }
  /* 保存状态字（§2.2 首行）：错态 = 红字 + 可点（出口 = autosave.flush()，Q5 裁定） */
  .save-retry { background: none; border: 0; padding: 0; color: var(--err); font-size: 12px; cursor: pointer; text-decoration: underline; }
`

// UI 壳（T6 + r02 前半）：顶栏双态切换 / 新建 / 导入导出 / 撤销重做——全部具名命令（commands.ts，纪律 ①）。
// 会话态视图（层次 / 网格 / 相机 / 双态）不进项目文件（REQ-058）。
export function App(): JSX.Element {
  const saveState = useEditorUi((s) => s.saveState)
  const storageOk = useEditorUi((s) => s.storageOk)
  const mode = useEditorUi((s) => s.mode)
  const message = useEditorUi((s) => s.message)
  const nonEmpty = useEditorUi((s) => s.nonEmpty)
  const fileInput = useRef<HTMLInputElement>(null)

  // r04 T5（F3）：启动序列（adoptBrowserStore + init）移入组合根 app/runtime 的 bootstrap()，
// 由 main.tsx 在 render 前调用——这里不再挂启动 effect。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return
      // `D1`（`F-03` · architect §5.5）：UI 覆盖层上的按键不算画布输入——但**只有文本输入面**保留
      // 自己的本地撤销（`R-14`，debug-261018，用户 2026-10-18 口径 A）。原判据 `isUiEventTarget` 把
      // 悬浮方块里的**按钮**也拦了：点过色板色块后焦点留在 `tile:tools` 内，`Ctrl+Z` 直接 return，
      // `history.undo()` 根本没执行（用户报的"换色后撤不掉上一块"）。按钮 / 勾选框 / 下拉不再拦截；
      // 指针隔离仍走 `isUiEventTarget`（Viewport / `pointOverUi`），不因这次收窄而放宽。
      // 为什么必须查 DOM 而不是 `stopPropagation`：本监听挂在 window，冒泡拦截对它无效。
      if (isTextEntryTarget(e.target)) return
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault()
        getEditor().undo()
      } else if ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y') {
        e.preventDefault()
        getEditor().redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onExport = (): void => {
    void getEditor().autosave.flush()
    // r04 T6（D4）：传输机制在 io/file-transfer；UI 只留按钮
    downloadJson('voxel-project.json', getEditor().exportFile())
  }

  const onImportPick = (): void => {
    fileInput.current?.click()
  }

  const onImportFile = (file: File): void => {
    void readTextFile(file).then((text) => getEditor().importFile(text))
  }

  const saveLabel: Record<string, string> = {
    idle: '自动保存：就绪',
    pending: '自动保存：待写…',
    saved: '自动保存：已落盘',
    error: '自动保存：失败',
  }

  // 保存状态字（§2.2 首行 · REQ-060 验收①/④）：`error` 不只是变红——**必须给动作出口**
  // （`Q5` 已裁 = A：点击状态字触发 `autosave.flush()`）；其余三值是读数，保持中性灰。
  const saveText = (): JSX.Element =>
    !storageOk ? (
      <span className="save save-volatile" title="浏览器存储不可用：改动只在本次会话有效">
        自动保存：本次会话不持久化（存储不可用）
      </span>
    ) : saveState === 'error' ? (
      <button className="save save-retry" title="点击重试保存" aria-label="重试保存" onClick={() => void getEditor().autosave.flush()}>
        {saveLabel[saveState]}
      </button>
    ) : (
      <span className="save">{saveLabel[saveState]}</span>
    )

  // 顶栏图标按钮：emoji 当字形，中文说明进 title / aria-label（不另做 icon 资产）
  const topButton = (c: AppCommand, emoji: string, title: string): JSX.Element => (
    <button className="icon-btn" title={title} aria-label={title} disabled={!commandEnabled(c)} onClick={() => c.run()}>
      {emoji}
    </button>
  )

  return (
    <div className="app">
      <style>{css}</style>
      <header className="topbar">
        <span className="brand">🧊 wishvox</span>
        {saveText()}
        {/* 模式胶囊 = 字形 + 文字并存（§1.1 / §2.4：状态语义不能只靠字形）；中文进 title / aria-label（P5）。
            字形按 §1.3 表：✏️ 编辑态 / 👁 检视态（Q3=B 允许按渲染微调，中文语义锁定）——
            检视态字形与左栏 / 右栏各块引用的 INSPECT_READONLY 句式里的「👁 检视态」同形（不引 icon 资产）。 */}
        <button
          className={`mode-pill ${mode}`}
          title={mode === 'edit' ? '编辑态 · 点击切到检视态（检视态所有编辑入口灰掉，只留下看）' : '检视态 · 点击切回编辑态（恢复全部编辑入口）'}
          aria-label={mode === 'edit' ? '切换到检视态' : '切换到编辑态'}
          onClick={() => cmd.toggleMode.run()}
        >
          {mode === 'edit' ? '✏️ 编辑态' : '👁 检视态'}
        </button>
        <span className="spacer" />
        {topButton(cmd.undo, '↩️', '撤销（Ctrl+Z）')}
        {topButton(cmd.redo, '↪️', '重做（Ctrl+Shift+Z / Ctrl+Y）')}
        {topButton(cmd.newProject, '🆕', '新建项目（清空当前项目与本地存档）')}
        {/* `REQ-067` / `REQ-068`（r06 展示件追加）：顶栏项目组顺序 = 🆕 · 🧹 · 🔄 · 📂 · 💾 */}
        {topButton(cmd.cleanLocalData, '🧹', '清理本地数据')}
        {topButton(cmd.showcaseReset, '🔄', '回到默认展示件')}
        <button className="icon-btn" title="导入项目（json）" aria-label="导入项目" onClick={onImportPick}>
          📂
        </button>
        <button className="icon-btn" title="导出项目（json）" aria-label="导出项目" onClick={onExport}>
          💾
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onImportFile(f)
            e.target.value = ''
          }}
        />
      </header>
      {/* `D1`（design §7.2）：原「左 `.toolbar` + 右 `.rail`」三栏装配改为**工作区 + 九个悬浮方块**
          （工具 / AI / 结构树 / 程序化 / 噪声 / 历史 / 外观 / 相机 / 层次）；顶栏与状态栏不变。 */}
      <EditorWorkspace />
      <footer className="statusbar">
        <span>非空块 {nonEmpty}</span>
        <span>{message}</span>
      </footer>
    </div>
  )
}
