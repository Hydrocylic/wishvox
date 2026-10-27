import { useFold } from './useFold'

/**
 * 可折叠区块（r05 UI 重设计，规格 §3.1 契约八条中的机制部分）：
 * - 标题行（button.panel-head）= 唯一展开 / 收起热区，整行可点，行内不放其他可交互控件；
 * - 构成 = chevron ▾/▸ + emoji + 块名（中文），带 `aria-expanded` 与 `title`；
 * - 折叠态在标题行右侧显示一行摘要（单行省略号截断）；展开态摘要隐藏（详情已在正文）——
 *   可折叠块必须给 `hint`（"无摘要的可折叠块 = 判不合格"，P2）；
 * - 折叠只卸载正文（children 卸载）：**表单值必须由父组件或 store 持有**，折叠 → 展开后原值仍在
 *   （§3.1-5；现状 OpsPanel / NoisePanel 表单态在面板组件、相机与 AI 连接在 store，均满足）；
 * - 二级折叠（AI 连接）复用本组件，样式右缩进一层（.panel .panel）；
 * - **常显区 `pinned`（r05 T4 · `REQ-061`）**：给**阻塞项**用的例外口——它不随折叠收起（折叠只卸载
 *   `children`），且**自身不得含折叠控件**（否则阻塞项又进了折叠体系，与 §3.2 的论证相悖）。
 *   渲染位 = 折叠态在标题行正下方、展开态在正文之后——同一位置，展开时不会与正文重复。
 * - 无折叠动画（动效属以后层）。
 * `.panel-head` 类名与 `aria-expanded` 同时是目检工具 _ui-shot.mjs 的挂钩（allopen / collapsed 模式点它）。
 */
export function Section(props: {
  title: string
  emoji?: string
  defaultOpen?: boolean
  /** 折叠态一行摘要（§2.3：非「可操作」态必须投影进摘要，颜色用状态 token） */
  hint?: React.ReactNode
  /** 常显区（不随折叠收起；自身无折叠控件）——仅闸门卡使用（§3.2 / `REQ-061`） */
  pinned?: React.ReactNode
  children: React.ReactNode
}): JSX.Element {
  const { open, setOpen } = useFold({ defaultOpen: props.defaultOpen ?? false })
  return (
    <section className="panel">
      <button
        className="panel-head"
        type="button"
        aria-expanded={open}
        title={`${props.title} · 点击${open ? '收起' : '展开'}`}
        onClick={() => setOpen(!open)}
      >
        <span className="chev" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
        {props.emoji !== undefined && (
          <span className="panel-emoji" aria-hidden>
            {props.emoji}
          </span>
        )}
        <span className="panel-title">{props.title}</span>
        {!open && props.hint !== undefined && <span className="panel-hint">{props.hint}</span>}
      </button>
      {!open && props.pinned !== undefined && <div className="panel-pinned">{props.pinned}</div>}
      {open && <div className="panel-body">{props.children}</div>}
      {open && props.pinned !== undefined && <div className="panel-pinned">{props.pinned}</div>}
    </section>
  )
}
