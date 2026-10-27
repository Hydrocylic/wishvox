// S8 · M1 右栏 Dock：低频面板收进标签页；**全部面板常驻挂载**（只切 `hidden`）——
// 表单草稿 / AI 会话视图不因切标签丢失。图纸标签留到 S10（本步只接本地壳，不挂图纸）。
// 标签集合与浮块壳的九块一一对应：AI / 结构 / 操作 / 噪声 / 历史 / 显示（显示 = 层次 + 相机 + 外观）。
import { useState } from 'react'
import { useAiUi } from '../../state/ai-store'
import { AiPanel } from '../AiPanel'
import { CameraPanel } from '../CameraPanel'
import { HistoryPanel } from '../HistoryPanel'
import { LayerPanel } from '../LayerPanel'
import { NoisePanel } from '../NoisePanel'
import { OpsPanel } from '../OpsPanel'
import { StylePanel } from '../Panels'
import { PartTree } from '../PartTree'
import { UI_BOUNDARY_ATTR } from '../UiInputBoundary'

interface DockTab {
  readonly id: string
  readonly label: string
  readonly content: JSX.Element
}

export function RightDock(): JSX.Element {
  const pendingGate = useAiUi((s) => s.view?.pendingGate ?? null)
  const [active, setActive] = useState('ai')
  const tabs: DockTab[] = [
    { id: 'ai', label: 'AI', content: <AiPanel /> },
    { id: 'parts', label: '结构', content: <PartTree /> },
    { id: 'ops', label: '操作', content: <OpsPanel /> },
    { id: 'noise', label: '噪声', content: <NoisePanel /> },
    { id: 'history', label: '历史', content: <HistoryPanel /> },
    {
      id: 'view',
      label: '显示',
      content: (
        <>
          <LayerPanel />
          <CameraPanel />
          <StylePanel />
        </>
      ),
    },
  ]
  return (
    <aside className="right-dock" {...{ [UI_BOUNDARY_ATTR]: 'right-dock' }}>
      <div className="dock-tabs" role="tablist" aria-label="右侧面板">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active === t.id}
            className={active === t.id ? 'dock-tab on' : 'dock-tab'}
            onClick={() => setActive(t.id)}
          >
            {t.label}
            {t.id === 'ai' && pendingGate !== null && (
              <span className="tab-badge" aria-label="有等待批准的闸门">
                ⚠
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="dock-body">
        {tabs.map((t) => (
          <div key={t.id} role="tabpanel" aria-label={t.label} hidden={active !== t.id}>
            {t.content}
          </div>
        ))}
      </div>
    </aside>
  )
}
