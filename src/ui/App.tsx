import { useEffect, useRef } from 'react'
import { getEditor } from '../app/runtime'
import { downloadJson, readTextFile } from '../io/file-transfer'
import { useEditorUi, setUi } from '../state/editor-store'
import { cmd, commandEnabled } from './commands'
import type { AppCommand } from './commands'
import { EditorWorkspace } from './EditorWorkspace'
import { GateDock } from './GateDock'
import { M1Workspace } from './M1Workspace'
import { initialShell, persistShell, readShellEnv } from './shell-mode'
import { APP_CSS } from './theme'
import { isTextEntryTarget } from './UiInputBoundary'

const css = APP_CSS

// UI 壳（T6 + r02 前半）：顶栏双态切换 / 新建 / 导入导出 / 撤销重做——全部具名命令（commands.ts，纪律 ①）。
// 会话态视图（层次 / 网格 / 相机 / 双态）不进项目文件（REQ-058）。
export function App(): JSX.Element {
  const saveState = useEditorUi((s) => s.saveState)
  const storageOk = useEditorUi((s) => s.storageOk)
  const shell = useEditorUi((s) => s.shell)
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

  // S8：启动按环境定初值（coarse / ≤1023 ⇒ 浮块；否则三栏）；合法的本机手动选择优先（shell-mode 读回）
  useEffect(() => {
    const initial = initialShell(readShellEnv())
    if (useEditorUi.getState().shell !== initial) setUi({ shell: initial })
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

  // S8：手动切壳——只改会话 store（不重建 Editor），并尽力持久化（隐私模式失败静默）
  const changeShell = (value: string): void => {
    const next = value === 'm1' ? 'm1' : 'floating'
    setUi({ shell: next })
    persistShell(next)
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
        {/* S8 壳切换：浮块 / 三栏（手动选择本地持久化，异常回退自动初值） */}
        <label className="shell-pick" title="壳形态：浮块（触屏/窄屏）· 三栏（桌面）">
          壳
          <select value={shell} aria-label="壳形态" onChange={(e) => changeShell(e.target.value)}>
            <option value="floating">浮块</option>
            <option value="m1">三栏</option>
          </select>
        </label>
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
      <GateDock />
      {/* S8：两壳二选一渲染——浮块壳（默认/窄屏/触屏）或 M1 三栏壳；同一 Editor 实例，不重建。
          浮块壳的装配仍是「工作区 + 九个悬浮方块」；三栏壳是 左栏 / 舞台 / 右 Dock。 */}
      {shell === 'm1' ? <M1Workspace /> : <EditorWorkspace />}
      <footer className="statusbar">
        <span>非空块 {nonEmpty}</span>
        <span>{message}</span>
      </footer>
    </div>
  )
}
