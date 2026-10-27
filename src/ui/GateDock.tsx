// S7 · 壳级闸门常显区（`REQ-061` 验收①的新挂载点）。
// 闸门卡从 AI 浮块的 `pinned` 槽**外提到壳级**：只挂一份，与任何面板的折叠状态无关；
// 无闸门时返回 `null`（不占高度、不挡画布，也不做覆盖式浮层）。
// 挂载时主动 `pushView()`（幂等）：不依赖 `AiPanel` 常驻也能把「已落库但未投影」的闸门推上来。
import { useEffect } from 'react'
import { getAiSession } from '../app/runtime'
import { useAiUi } from '../state/ai-store'
import { AiGateCard } from './AiGateCard'

export function GateDock(): JSX.Element | null {
  const pending = useAiUi((s) => s.view?.pendingGate ?? null)

  useEffect(() => {
    getAiSession().pushView()
  }, [])

  if (!pending) return null
  return (
    <div className="gate-dock" data-ui-boundary="gate">
      <AiGateCard />
    </div>
  )
}
