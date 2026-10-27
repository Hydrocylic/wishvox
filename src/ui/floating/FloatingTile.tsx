// `D1`（architect §5.2 `FloatingTile`）：**纯呈现外壳**——只做四件事：
//   ① 折叠态 = 图标方块（`D1` ①②⑤）；② 点击展开 / 收起（开关态唯一去处 = `open/onOpenChange`）；
//   ③ 展开体按锚点与方向摆放、受限尺寸 + 内部滚动（architect §5.4-3）；
//   ④ 常显槽（`REQ-061`：AI 待批卡在收起态仍可见）。
// 它**不** import Editor / AI session / 业务 store（architect §5.2 的依赖方向），也不持拖拽 / 缩放 /
// 位置写回（`D1` ②⑦：没有 onDrag、没有 transform、没有 localStorage）。
// 兼容面：DOM 契约沿用 `Section` 的类名（`.panel-head` / `.panel-hint` / `.panel-body` / `.panel-pinned`）
// ⇒ 既有 CSS 与面板内折叠读回继续成立；闸门卡自 S7 起外提到壳级 `.gate-dock`
//（`harness/gate-pinned-visible.tsx` 读 `.panel-head[aria-expanded]` + `.gate-dock` 高度）。
import { useRef } from 'react'
import type { ReactNode } from 'react'
import { useFold } from '../useFold'
import { TILE_PAD } from './tile-layout'
import { useTileHost } from './tile-host'
import { tileSpec } from './tile-specs'
import type { TileId } from './tile-specs'
import { UI_BOUNDARY_ATTR } from '../UiInputBoundary'

export interface FloatingTileProps {
  readonly id: TileId
  /** 折叠态摘要（D4 ②：层次块收起时仍要能读出当前档）——进 `title` / `aria-label` 与 `.panel-hint` */
  readonly summary?: ReactNode
  /** 常显附件（AI 待批卡）：收起/展开都在，独立稳定槽（`REQ-061`） */
  readonly accessory?: ReactNode
  readonly children: ReactNode
}

/** 摘要 → 纯文本（`title` / `aria-label` 只吃字符串；ReactNode 摘要按可见文本拼） */
function summaryText(summary: ReactNode): string {
  if (summary === undefined || summary === null || summary === false) return ''
  if (typeof summary === 'string' || typeof summary === 'number') return String(summary)
  if (Array.isArray(summary)) return summary.map(summaryText).filter((t) => t !== '').join(' ')
  return ''
}

export function FloatingTile(props: FloatingTileProps): JSX.Element {
  const spec = tileSpec(props.id)
  const host = useTileHost()
  const triggerRef = useRef<HTMLButtonElement>(null)
  // 开合 + 收起焦点回位走共用原语（`useFold`）：受控于 TileHost；无宿主时本地自持，行为与 S6 一致
  const fold = useFold(
    host
      ? { open: host.isOpen(props.id), onChange: (v) => host.setOpen(props.id, v), triggerRef }
      : { defaultOpen: spec.defaultOpen, triggerRef },
  )
  const open = fold.open
  const setOpen = fold.setOpen

  const slot = host?.layout?.slots[props.id] ?? null
  const hint = summaryText(props.summary)
  const name = hint === '' ? spec.title : `${spec.title} · ${hint}`

  const anchorStyle: React.CSSProperties = slot
    ? { left: slot.anchorLeft, top: slot.anchorTop }
    : { position: 'relative', display: 'inline-block' }

  const bodyStyle: React.CSSProperties = slot
    ? {
        top: slot.bodyTop,
        ...(slot.side === 'left' ? { left: TILE_PAD } : { right: TILE_PAD }),
        maxWidth: slot.bodyMaxWidth,
        maxHeight: slot.bodyMaxHeight,
      }
    : { maxWidth: 336, maxHeight: 420 }

  const pinned = props.accessory !== undefined && props.accessory !== null ? <div className="panel-pinned">{props.accessory}</div> : null

  return (
    <>
      <div
        className={slot ? 'tile-anchor' : 'tile-anchor standalone'}
        style={anchorStyle}
        {...{ [UI_BOUNDARY_ATTR]: `tile:${props.id}` }}
      >
        <button
          ref={triggerRef}
          type="button"
          className="panel-head tile-head"
          aria-expanded={open}
          aria-label={`${name} · 点击${open ? '收起' : '展开'}`}
          title={`${name} · 点击${open ? '收起' : '展开'}（位置固定不可拖动）`}
          onClick={() => setOpen(!open)}
        >
          <span className="panel-emoji" aria-hidden>
            {spec.icon}
          </span>
          {!open && hint !== '' && <span className="panel-hint tile-hint-sr">{props.summary}</span>}
        </button>
        {/* 收起态：常显槽挂在触发方块正下方（`REQ-061`：AI 待批卡不随折叠消失） */}
        {!open && pinned}
      </div>
      {open && (
        <div className={slot ? 'tile-body' : 'tile-body standalone'} style={bodyStyle} {...{ [UI_BOUNDARY_ATTR]: `tile:${props.id}` }}>
          <div className="tile-body-head">
            <strong>
              <span aria-hidden>{spec.icon}</span> {spec.title}
            </strong>
            {/* 收起入口（`F-04`：视口缩小时关闭入口始终可达）——与触发方块同一开关态 */}
            <button className="tile-close" type="button" aria-label={`收起 ${spec.title}`} title={`收起 ${spec.title}`} onClick={() => setOpen(false)}>
              ▾
            </button>
          </div>
          <div className="panel-body">{props.children}</div>
          {pinned}
        </div>
      )}
    </>
  )
}
