import { useState } from 'react'
import { getAiSession } from '../app/runtime'
import type { GateAnswer } from '../ai/session-log'
import { useAiUi } from '../state/ai-store'

// r05 T4 件三 · 闸门卡（规格 §3.2 / **`REQ-061` 四条**）：
// 计划 / 写操作闸门待答期间的**阻塞项**——**常显、不可折叠**：本件自身不提供任何折叠控件（验收④），
// 挂载位 = 壳级 `GateDock`（S7 起；顶栏下方常显区，不属任何可折叠 body）⇒ 面板收起 / 将来换壳
// 都**不收起**（验收①）。三种作答（批准 / 本次会话都批准 / 跳过）+ 文字意见「回复」
// 全部是 `<button>`（**纯鼠标可达**，回车只是加速——§3.2 配套口径 / 验收②）。
export function AiGateCard(): JSX.Element {
  const view = useAiUi((s) => s.view)
  const [words, setWords] = useState('')
  if (!view?.pendingGate) return <></>
  const g = view.pendingGate
  const answer = (a: GateAnswer): void => {
    getAiSession().answerGate(g.gateId, a, a === 'words' ? words : undefined)
    setWords('')
  }
  return (
    <div style={{ border: '1px solid var(--warn)', borderRadius: 6, padding: 8, margin: '6px 0', background: '#2b2620' }}>
      <div style={{ fontSize: 12, color: 'var(--warn)' }}>
        ⚠️ {g.scope === 'plan' ? '计划闸门' : '写操作闸门'}
        {g.tool ? ` · ${g.tool}` : ''}
      </div>
      <div style={{ margin: '6px 0', fontSize: 13 }}>{g.summary}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button onClick={() => answer('allow')}>批准</button>
        <button onClick={() => answer('allow-always')}>本次会话都批准</button>
        <button onClick={() => answer('skip')}>跳过</button>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '6px 0 0', fontSize: 12 }}>
        <input
          style={{ flex: 1 }}
          value={words}
          placeholder="或给一句意见（回车发送）"
          onChange={(e) => setWords(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && words.trim() !== '') answer('words')
          }}
        />
        <button disabled={words.trim() === ''} onClick={() => answer('words')}>
          回复
        </button>
      </div>
    </div>
  )
}
