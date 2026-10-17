import { useState } from 'react'
import { canonicalHex, hexToRgb, hsvToRgb, rgbToHex, rgbToHsv } from '../core/color'
import { currentColorHex } from '../edit/color'
import { useEditorUi } from '../state/editor-store'
import { commitHexColor, commitRgbColor, pickUsedColor } from './commands'

// P3（`REQ-027` · B-01/B-02/B-05/B-08）：取色器 = 色相条 + 饱和度/明度色面 + HEX/RGB 输入 + 模型已用色。
// 口径：
// · 选色**只改会话当前色**（不写模型、不进历史、不分配持久键）——键在实际写入时才 intern（门四）；
// · 等价输入（大小写 HEX、三位写法、rgb() 与 HEX）归一成同一个规范色值 ⇒ 不产生重复色项（B-02）；
// · 非法输入（非 HEX / 通道越界 / 小数 / 带透明度）保留上次有效色并给原因（B-08）；
// · 检视态灰掉输入（`REQ-054`：当前色可见、不可改选），与左栏调色板同一纪律。

const HUE_STOPS = '#ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%'

/** 拖动面：按下即取值，按住拖动持续取值（pointer capture 保证出界后仍跟随） */
function DragArea(props: {
  disabled: boolean
  style: React.CSSProperties
  onPick: (fx: number, fy: number) => void
  title: string
  ariaLabel: string
}): JSX.Element {
  const handle = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (props.disabled) return
    const r = e.currentTarget.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return
    const fx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const fy = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    props.onPick(fx, fy)
  }
  return (
    <div
      role="slider"
      tabIndex={-1}
      aria-label={props.ariaLabel}
      title={props.title}
      onPointerDown={(e) => {
        if (props.disabled) return
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          /* 合成事件下捕获不可用：仍可拖动，只是出界后停止跟随 */
        }
        handle(e)
      }}
      onPointerMove={(e) => {
        if (!props.disabled && (e.buttons & 1) === 1) handle(e)
      }}
      style={{ ...props.style, cursor: props.disabled ? 'not-allowed' : 'crosshair', opacity: props.disabled ? 0.5 : 1 }}
    />
  )
}

export function ColorPanel(): JSX.Element {
  const mode = useEditorUi((s) => s.mode)
  const usedColors = useEditorUi((s) => s.usedColors)
  const disabled = mode !== 'edit'

  // 单一真源 = store（内置身份命中时以内置色值为准）；这里只读它算显示值
  const hex = canonicalHex(currentColorHex()) ?? '#c0392b'
  const rgb = hexToRgb(hex) ?? { r: 0, g: 0, b: 0 }
  const hsv = rgbToHsv(rgb)

  // 取色器自己的色相位（灰色时 s=0 无法从色值反推色相；外部改色后回落到色值推导）
  const [pickHue, setPickHue] = useState<number | null>(null)
  const hue = pickHue ?? (hsv.s > 0.001 ? hsv.h : 0)

  const [hexDraft, setHexDraft] = useState<string | null>(null)

  const commitHsv = (next: { h: number; s: number; v: number }): void => {
    const out = rgbToHex(hsvToRgb(next))
    setPickHue(next.h)
    commitHexColor(out, `已选择颜色 ${out}`)
  }

  const stateColor = `hsl(${hue}, 100%, 50%)`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div
          aria-label="当前颜色"
          title={hex}
          style={{ width: 28, height: 28, borderRadius: 4, background: hex, outline: '1px solid #00000055' }}
        />
        <div style={{ fontSize: 12, color: 'var(--fg-dim)', lineHeight: 1.35 }}>
          当前色 <code>{hex}</code>
          <br />
          <span style={{ color: 'var(--fg-mute)' }}>选色不写模型；放置时才登记为项目色</span>
        </div>
      </div>

      <DragArea
        disabled={disabled}
        ariaLabel="色相"
        title="色相"
        style={{ height: 12, borderRadius: 6, background: `linear-gradient(to right, ${HUE_STOPS})` }}
        onPick={(fx) => commitHsv({ h: fx * 360, s: Math.max(hsv.s, 1), v: Math.max(hsv.v, 1) })}
      />

      <DragArea
        disabled={disabled}
        ariaLabel="饱和度与明度"
        title="饱和度（横）× 明度（纵）"
        style={{
          height: 96,
          borderRadius: 4,
          background: `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, ${stateColor})`,
        }}
        onPick={(fx, fy) => commitHsv({ h: hue, s: fx, v: 1 - fy })}
      />

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
        <span style={{ color: 'var(--fg-dim)' }}>HEX</span>
        <input
          type="text"
          value={hexDraft ?? hex}
          disabled={disabled}
          spellCheck={false}
          placeholder="#3b6ea5 或 #39f"
          style={{ flex: 1, minWidth: 0 }}
          onChange={(e) => setHexDraft(e.target.value)}
          onBlur={() => {
            if (hexDraft === null) return
            const text = hexDraft
            setHexDraft(null)
            commitHexColor(text, `已选择颜色 ${text}`)
          }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.currentTarget.blur()
          }}
        />
      </label>

      <div style={{ display: 'flex', gap: 6, fontSize: 12 }}>
        {(['r', 'g', 'b'] as const).map((ch) => (
          <label key={ch} style={{ flex: 1, minWidth: 0 }}>
            <span style={{ color: 'var(--fg-dim)', textTransform: 'uppercase' }}>{ch}</span>
            <input
              type="number"
              min={0}
              max={255}
              step={1}
              value={rgb[ch]}
              disabled={disabled}
              style={{ width: '100%' }}
              onChange={(e) => {
                const v = e.target.value === '' ? Number.NaN : Number(e.target.value)
                setPickHue(null)
                commitRgbColor(ch === 'r' ? v : rgb.r, ch === 'g' ? v : rgb.g, ch === 'b' ? v : rgb.b)
              }}
            />
          </label>
        ))}
      </div>

      <div className="rail-group" style={{ marginTop: 4 }}>
        模型已用色（{usedColors.length}）
      </div>
      {usedColors.length === 0 ? (
        <p className="note" style={{ margin: 0 }}>
          模型还没有方块。
        </p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
          {usedColors.map((item) => (
            <button
              key={item.color}
              title={`${item.color} · ${item.identity} · ${item.count} 块`}
              aria-label={`已用色 ${item.color}（${item.count} 块）`}
              disabled={disabled}
              onClick={() => {
                setPickHue(null)
                setHexDraft(null)
                pickUsedColor(item.color, item.identity)
              }}
              style={{
                aspectRatio: '1',
                borderRadius: 4,
                background: item.color,
                outline: hex === item.color ? '3px solid #ffffff' : '1px solid #00000055',
              }}
            />
          ))}
        </div>
      )}
      <p className="note" style={{ margin: 0 }}>
        已用色按全模型统计（隐藏层的颜色仍在）；点选只改当前色，不批量改模型。
      </p>
    </div>
  )
}
