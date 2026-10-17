// `D1` + `D5`：左上读数与提示区——自 `ui/Viewport.tsx` 抽出（architect §5.2：Viewport 只管渲染器
// 生命周期、尺寸读回、拾取与笔刷收尾；HUD 是覆盖层，归工作区）。
// `D5`（design §8，2026-10-16）：预览**全无效**时这里追加一行**黄字短原因**（`--warn`），
// 出现瞬间短闪一次（CSS 动画 ≤2s，`floating-styles.ts` 的 `hud-warn-flash`），此后稳定常显；
// 状态栏 `message` 只留诊断明细 ⇒ 两条通道共存不重复。
import { useEditorUi } from '../state/editor-store'

export function ViewportHud(): JSX.Element {
  const bounds = useEditorUi((s) => s.boundsReadout)
  const preview = useEditorUi((s) => s.previewReadout)
  const warn = useEditorUi((s) => s.previewReject)
  const mode = useEditorUi((s) => s.mode)
  const tool = useEditorUi((s) => s.tool)
  return (
    <div
      style={{
        padding: '6px 10px',
        borderRadius: 6,
        background: 'rgba(255,255,255,0.88)',
        border: '1px solid #d5dae1',
        fontSize: 12,
        lineHeight: 1.7,
        color: '#2b3138',
        fontFamily: 'ui-monospace, Consolas, monospace',
        whiteSpace: 'pre',
      }}
    >
      {bounds ? (
        <>
          {`W(x)=${bounds.w}  H(y)=${bounds.h}  L(z)=${bounds.l}`}
          {`\n范围 x ${bounds.min[0]}..${bounds.max[0]} · y ${bounds.min[1]}..${bounds.max[1]} · z ${bounds.min[2]}..${bounds.max[2]}`}
          {`\nAABB 中心 (${bounds.center[0]}, ${bounds.center[1]}, ${bounds.center[2]})`}
        </>
      ) : (
        '（空模型）'
      )}
      {preview && (
        <div style={{ marginTop: 4, color: mode === 'edit' ? '#1f6d28' : 'var(--mute)' }}>
          {`预览 ${preview.size[0]}×${preview.size[1]}×${preview.size[2]} @ (${preview.anchor[0]}, ${preview.anchor[1]}, ${preview.anchor[2]}) · ${preview.cells} 格`}
        </div>
      )}
      {/* `D5`：key = 出现序号 ⇒ 换原因时重放一次短闪，同一原因持续时不再闪（`nextPreviewReject` 保证） */}
      {warn && (
        <div key={warn.seq} className="hud-warn flash" role="status" aria-live="polite">
          ⚠️ {warn.text}
        </div>
      )}
      <div style={{ marginTop: 4, color: '#5b636d' }}>
        {mode === 'edit'
          ? tool === 'place'
            ? '编辑态 · 放置：左键落笔（拖动涂抹）· 右键拖动 = 旋转'
            : tool === 'erase'
              ? '编辑态 · 擦除：左键落笔（拖动涂抹）· 右键拖动 = 旋转'
              : tool === 'paint'
                ? '编辑态 · 上色：左键落笔（拖动涂抹）· 右键拖动 = 旋转'
                : '编辑态 · 吸管：左键点方块取原始色（不改模型）· 右键拖动 = 旋转'
          : '检视态：左键拖动 = 旋转 · 滚轮 = 慢缩 · 中键拖动 = 快缩 · 右键 = 平移'}
      </div>
    </div>
  )
}
