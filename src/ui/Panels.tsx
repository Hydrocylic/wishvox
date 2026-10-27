import { cmd, commandEnabled, INSPECT_READONLY, pickPalette, setBrushAxis } from './commands'
import { useEditorUi } from '../state/editor-store'
import { ColorPanel } from './ColorPanel'
import { PanelFrame } from './PanelFrame'

// 左栏：工具（放置 / 擦除 / 上色 = 笔刷动作，REQ-055）+ 笔刷尺寸（长宽高 · 每轴 1–8）+ 替换开关 +
// 彩色调色板（REQ-027：≥12 种方块 · ≥8 色）。
// 检视态 = 工具灰掉不消失 + 一句话提示（REQ-054 / F5——照 vengi 的形状：单布尔回同一状态源）。
// r05 T2（左栏，规格 §8.1）：三段常开不折叠（§1.2 末段 / Q4）+ 组标签；工具三键 emoji 字形 + 小字标签并存
// （§1.1 末段 / §1.3 字形表，中文进 title / aria-label）；长文案收进折叠的「操作提示」（§1.2 末行）；
// 检视态提示句式按 §2.2 统一（黄 var(--warn)）；调色板仍可看不可改选（§3.3 第 1 行 / REQ-027）。
const TOOL_META: Record<'place' | 'erase' | 'paint' | 'pick', { emoji: string; label: string }> = {
  place: { emoji: '🧱', label: '放置' },
  erase: { emoji: '🧽', label: '擦除' },
  paint: { emoji: '🎨', label: '上色' },
  pick: { emoji: '💧', label: '吸管' },
}

export function ToolPanel(): JSX.Element {
  const tool = useEditorUi((s) => s.tool)
  const mode = useEditorUi((s) => s.mode)
  const brushSize = useEditorUi((s) => s.brushSize)
  const overridePlace = useEditorUi((s) => s.overridePlace)
  const paletteItems = useEditorUi((s) => s.paletteItems)
  const currentIdentity = useEditorUi((s) => s.currentIdentity)
  const disabled = mode !== 'edit'
  const tools: Array<typeof tool> = ['place', 'erase', 'paint', 'pick']
  // `D1` 折叠态摘要：当前工具 + 尺寸（收起成图标方块后，title / aria-label 仍可读出这块在干什么）
  const summary = `${TOOL_META[tool].label} · ${brushSize.x}×${brushSize.y}×${brushSize.z}${disabled ? ' · 检视态只读' : ''}`

  const axisInput = (axis: 'x' | 'y' | 'z', label: string): JSX.Element => (
    <label style={{ flex: 1, fontSize: 12, textAlign: 'center' }}>
      <span style={{ color: 'var(--fg-dim)' }}>{label}</span>
      <input
        type="number"
        min={1}
        max={8}
        step={1}
        value={brushSize[axis]}
        disabled={disabled}
        style={{ width: '100%' }}
        onChange={(e) => setBrushAxis(axis, Number(e.target.value))}
      />
    </label>
  )

  return (
    <PanelFrame id="tools" summary={summary}>
      <div className="rail-group">工具（笔刷动作）</div>
      <div style={{ display: 'flex', gap: 6 }}>
        {tools.map((id) => {
          const meta = TOOL_META[id]
          const c = cmd.tool(id)
          const on = tool === id
          return (
            <button
              key={id}
              className={on ? 'panel-emoji-btn on' : 'panel-emoji-btn'}
              title={disabled ? `${meta.label}（${INSPECT_READONLY}）` : meta.label}
              aria-label={meta.label}
              disabled={!commandEnabled(c)}
              onClick={() => c.run()}
            >
              <span className="glyph" aria-hidden>
                {meta.emoji}
              </span>
              {meta.label}
            </button>
          )
        })}
      </div>
      {disabled && (
        <p className="warn">
          {INSPECT_READONLY}
        </p>
      )}

      <div className="rail-group">笔刷 W·H·L（1–8）</div>
      <div style={{ display: 'flex', gap: 6 }}>
        {axisInput('x', 'W')}
        {axisInput('y', 'H')}
        {axisInput('z', 'L')}
      </div>
      {tool === 'pick' ? (
        <p className="note" style={{ marginTop: 4 }}>
          吸管：点模型读原始体素色（不含光照/高亮），只改当前色——不写模型、不进历史；网格与背景不取色。
        </p>
      ) : null}
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, margin: '8px 0 0', color: 'var(--fg-dim)' }}>
        <input
          type="checkbox"
          checked={overridePlace}
          disabled={disabled || tool !== 'place'}
          onChange={() => cmd.overridePlace.run()}
        />
        替换添加
      </label>
      <p className="note" style={{ marginTop: 4 }}>
        勾选 = 覆盖已有块；默认增量（已有块不动）。
      </p>

      <div className="rail-group">调色板</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        {paletteItems.map((item) => (
          <button
            key={item.identity}
            title={item.identity.replace('color:', '')}
            aria-label={item.identity.replace('color:', '')}
            disabled={disabled}
            onClick={() => pickPalette(item.identity)}
            style={{
              aspectRatio: '1',
              borderRadius: 4,
              background: item.color,
              outline: item.identity === currentIdentity ? '3px solid #ffffff' : '1px solid #00000055',
            }}
          />
        ))}
      </div>
      {disabled && <p className="note">检视态：当前色仍可见，色块不可改选（已灰）。</p>}

      <div className="rail-group">取色器（色相 / 明度 · HEX / RGB）</div>
      <ColorPanel />
      <details style={{ marginTop: 14, fontSize: 12, color: 'var(--fg-dim)' }}>
        <summary style={{ cursor: 'pointer', color: 'var(--fg-mute)' }}>操作提示</summary>
        <p className="note">
          编辑态：左键 = 笔刷（按住拖动 = 涂抹，松开 = 一笔）· 右键拖动 = 旋转 · 中键 / 滚轮 = 缩放。
          <br />
          检视态：左键拖动 = 旋转。
        </p>
      </details>
    </PanelFrame>
  )
}

// 右栏上半：外观（`REQ-027` color-only：无贴图源 / 无材质 / 无第二套体系可切）。
export function StylePanel(): JSX.Element {
  return (
    <PanelFrame id="style" summary="彩色">
      <p className="note">当前为彩色单一体系（color-only）：无贴图源、无材质、无第二套外观可切。</p>
    </PanelFrame>
  )
}
