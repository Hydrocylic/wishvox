import { useEffect, useRef } from 'react'
import { acceptPatternFile, recognizeLocal } from './pattern-import-actions'
import { setPatternOptions, usePatternStore } from '../state/pattern-store'
import type { PatternOptions } from '../state/pattern-store'
import { patternHint } from '../state/pattern-store'
import { useEditorUi } from '../state/editor-store'
import { cmd, INSPECT_READONLY } from './commands'
import { drawPatternPreview } from './pattern-preview'
import { PanelFrame } from './PanelFrame'

// 拼豆图纸 → 方块（r06）：**本地识别 + 人核对 + 一次补丁**（AI 视觉通道押 v1.1，本步不接）。
//   本地通道：`io/pattern/recognize.ts`——规则方格图纸逐格取色，离线、确定、可测。
// 识别产出**给人看的预览**；人点「生成方块」才走 `edit/pattern-apply.ts` 写入
// （一次 = 一条补丁、一次撤销）——写路径与笔刷 / 程序化操作同一条。
//
// 面板形态：**内容 + 容器**——`PatternImportBody` 只放正文，外层由 `PanelFrame` 按壳选容器
// （浮块壳 ⇒ `FloatingTile`，参与九宫布局与开合；三栏壳 ⇒ `Pane`）。与其余九个面板同构。

function PatternImportBody(): JSX.Element {
  const status = usePatternStore((s) => s.status)
  const message = usePatternStore((s) => s.message)
  const grid = usePatternStore((s) => s.grid)
  const geometry = usePatternStore((s) => s.geometry)
  const palette = usePatternStore((s) => s.palette)
  const warnings = usePatternStore((s) => s.warnings)
  const emptyCells = usePatternStore((s) => s.emptyCells)
  const options = usePatternStore((s) => s.options)
  const imageName = usePatternStore((s) => s.imageName)
  const imageWidth = usePatternStore((s) => s.imageWidth)
  const imageHeight = usePatternStore((s) => s.imageHeight)
  const previewDataUrl = usePatternStore((s) => s.previewDataUrl)
  const recognizedBy = usePatternStore((s) => s.recognizedBy)
  const mode = useEditorUi((s) => s.mode)
  const disabled = mode !== 'edit'
  const fileRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (canvasRef.current !== null) drawPatternPreview(canvasRef.current, grid)
  }, [grid])

  const acceptFile = (file: File | null): void => {
    if (file === null) return
    void acceptPatternFile(file)
  }

  /** 改识别参数 ⇒ 用同一张图重跑本地识别（AI 通道按需手动再点） */
  const updateOptions = (patch: Partial<PatternOptions>, rerun = true): void => {
    setPatternOptions(patch)
    const s = usePatternStore.getState()
    if (rerun && s.rgba !== null) recognizeLocal(s.rgba, s.options)
  }

  const cropField = (label: string, key: 'cropLeft' | 'cropTop' | 'cropRight' | 'cropBottom'): JSX.Element => (
    <label className="field" style={{ flex: 1 }}>
      {label}
      <input
        id={`pattern-${key}`} name={key}
        type="number"
        min={0}
        max={64}
        value={options[key]}
        onChange={(e) => updateOptions({ [key]: Math.max(0, Math.min(64, Math.round(Number(e.target.value)) || 0)) } as never)}
      />
    </label>
  )

  const numField = (label: string, value: number | null, onChange: (v: number | null) => void, placeholder: string): JSX.Element => (
    <label className="field" style={{ flex: 1 }}>
      {label}
      <input
        id={`pattern-${label.startsWith('列') ? 'cols' : 'rows'}`} name={label.startsWith('列') ? 'cols' : 'rows'}
        type="number"
        min={1}
        max={128}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === '' ? null : Math.max(1, Math.min(128, Math.round(Number(e.target.value)))) )}
      />
    </label>
  )

  const originAxis = (axis: 'x' | 'y' | 'z'): JSX.Element => (
    <input
      key={axis}
      id={`pattern-origin-${axis}`} name={`origin-${axis}`}
      type="number"
      aria-label={`起点 ${axis}`}
      value={options.origin[axis]}
      style={{ width: '33%' }}
      onChange={(e) => updateOptions({ origin: { ...options.origin, [axis]: Math.round(Number(e.target.value)) || 0 } }, false)}
    />
  )

  return (
    <>
      {disabled && <p className="warn">{INSPECT_READONLY}</p>}
      <input
        ref={fileRef}
        id="pattern-file" name="pattern-file"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
        style={{ display: 'none' }}
        onChange={(e) => {
          acceptFile(e.target.files?.[0] ?? null)
          e.target.value = ''
        }}
      />
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <button style={{ flex: 1 }} onClick={() => fileRef.current?.click()}>
          🖼 选择图纸
        </button>
      </div>
      <p className="note" style={{ margin: '4px 0 0' }}>
        本地识别 = 规则方格逐格取色（离线、免费）。AI 视觉识别押 v1.1，本版不接。
      </p>

      {imageName !== null && (
        <p className="note" style={{ margin: '6px 0 0' }}>
          图：{imageName} · {imageWidth}×{imageHeight}px{recognizedBy !== null ? ` · 已${recognizedBy === 'ai' ? 'AI' : '本地'}识别` : ''}
        </p>
      )}
      {previewDataUrl !== null && (
        <img
          src={previewDataUrl}
          alt="图纸原图"
          style={{ display: 'block', maxWidth: '100%', maxHeight: 120, marginTop: 6, borderRadius: 4, imageRendering: 'pixelated' }}
        />
      )}
      {grid !== null ? (
        <>
          <div style={{ marginTop: 6, background: '#0b0f14', border: '1px solid var(--line)', borderRadius: 4, padding: 4 }}>
            <canvas ref={canvasRef} style={{ display: 'block', width: '100%', maxWidth: 260, imageRendering: 'pixelated' }} />
          </div>
          <p className="note" style={{ margin: '4px 0 0' }}>
            预览 = 即将摆放的方块：{grid.cols}×{grid.rows} 格 · {palette.length} 色 · 空 {emptyCells} 格
            {geometry !== null && geometry.source === 'auto' ? ` · 格边长 ${geometry.cellW.toFixed(1)}px` : ''}
          </p>
          <p className="note" style={{ margin: '2px 0 0' }}>
            棋盘格 = 空位（不摆块）。想只看图案本体可勾「裁掉四周空白边」，或在下方「裁边」填格数。
          </p>
        </>
      ) : (
        <p className="note" style={{ margin: '6px 0 0' }}>
          选一张拼豆图纸（PNG / JPEG / WebP），识别后这里会显示"将要生成的方块"预览。
        </p>
      )}
      {warnings.length > 0 && (
        <div className="warn" style={{ marginTop: 4 }}>
          {warnings.map((w) => (
            <p key={w} style={{ margin: '2px 0' }}>
              ⚠ {w}
            </p>
          ))}
        </div>
      )}

      <div className="rail-group" style={{ padding: '8px 0 2px' }}>
        识别参数
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {numField('列数（空=自动）', options.manualCols, (v) => updateOptions({ manualCols: v }), 'auto')}
        {numField('行数（空=自动）', options.manualRows, (v) => updateOptions({ manualRows: v }), 'auto')}
      </div>
      <label className="field">
        颜色归并（越大越少色）：{options.mergeTolerance}
        <input
          id="pattern-mergeTolerance" name="mergeTolerance"
          type="range"
          min={0}
          max={60}
          step={2}
          value={options.mergeTolerance}
          style={{ width: '100%' }}
          onChange={(e) => updateOptions({ mergeTolerance: Number(e.target.value) })}
        />
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, margin: '4px 0', color: 'var(--fg-dim)' }}>
        <input id="pattern-backgroundToEmpty" name="backgroundToEmpty" type="checkbox" checked={options.backgroundToEmpty} onChange={(e) => updateOptions({ backgroundToEmpty: e.target.checked })} />
        背景色（纸色）= 空位
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, margin: '4px 0', color: 'var(--fg-dim)' }}>
        <input id="pattern-trimBlankEdges" name="trimBlankEdges" type="checkbox" checked={options.trimBlankEdges} onChange={(e) => updateOptions({ trimBlankEdges: e.target.checked })} />
        裁掉四周空白边（默认保留图纸整张网格）
      </label>

      <div className="rail-group" style={{ padding: '8px 0 2px' }}>
        裁边（单位：格）
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {cropField('左', 'cropLeft')}
        {cropField('上', 'cropTop')}
        {cropField('右', 'cropRight')}
        {cropField('下', 'cropBottom')}
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, margin: '4px 0', color: 'var(--fg-dim)' }}>
        <input id="pattern-mirrorX" name="mirrorX" type="checkbox" checked={options.mirrorX} onChange={(e) => updateOptions({ mirrorX: e.target.checked })} />
        水平镜像（图纸标注「镜像」时勾选）
      </label>
      <p className="note" style={{ margin: '2px 0 0' }}>
        顶部/左右的行列号条会自动裁；若底部还残留图例色卡条，把「下」加 1–3 格裁掉。
      </p>

      <div className="rail-group" style={{ padding: '8px 0 2px' }}>
        摆放
      </div>
      <label className="field">
        平面
        <select id="pattern-plane" name="plane" value={options.plane} style={{ width: '100%' }} onChange={(e) => updateOptions({ plane: e.target.value as PatternOptions['plane'] }, false)}>
          <option value="xz">地面平铺（x-z，行沿 +z）</option>
          <option value="xy">竖直墙面（x-y，行向上）</option>
        </select>
      </label>
      <div className="field">
        起点（左上角坐标）
        <div style={{ display: 'flex', gap: 2, marginTop: 2 }}>{originAxis('x')}{originAxis('y')}{originAxis('z')}</div>
      </div>
      <label className="field">
        厚度（沿法线复制，1–8）
        <input
          type="number"
          min={1}
          max={8}
          id="pattern-thickness" name="thickness"
          value={options.thickness}
          style={{ width: '100%' }}
          onChange={(e) => updateOptions({ thickness: Math.max(1, Math.min(8, Math.round(Number(e.target.value)) || 1)) }, false)}
        />
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, margin: '4px 0', color: 'var(--fg-dim)' }}>
        <input id="pattern-clearEmpty" name="clearEmpty" type="checkbox" checked={options.clearEmpty} onChange={(e) => updateOptions({ clearEmpty: e.target.checked }, false)} />
        空格子也清除目标区域（默认不动已有块）
      </label>

      <button style={{ width: '100%', marginTop: 8 }} disabled={disabled || grid === null} onClick={() => cmd.patternApply.run()}>
        ⬛ 生成方块（一次 = 一条补丁，可一次撤销）
      </button>
      {message !== null && (
        <p className={status === 'error' ? 'warn' : 'note'} style={{ margin: '6px 0 0' }}>
          {message}
        </p>
      )}
    </>
  )
}

/** 图纸 → 方块面板：正文在 `PatternImportBody`，容器由 `PanelFrame` 按当前壳选择。 */
export function PatternImport(): JSX.Element {
  const summary = usePatternStore((s) => patternHint(s))
  return (
    <PanelFrame id="pattern" summary={summary}>
      <PatternImportBody />
    </PanelFrame>
  )
}