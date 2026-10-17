// r04 T5（F1-F3 / U2）· 组合根：装配的唯一正本。
// Editor 与 AgentSession 的单例在这里**惰性**创建（memoize）——任何模块 import 本文件都只拿到
// 函数、不触发构造，由此断掉"模块加载期单例互连"（旧形态：import ui/editor 即构造 Editor、
// import ui/AiPanel 即构造 AgentSession 并互连）。ui 层经 getEditor()/getAiSession() 做服务定位，
// 是全图唯一上行边（Q2 已裁，2026-10-06）。
import { AgentSession } from '../ai/agent'
import { Editor } from '../edit/editor'

let editorInstance: Editor | null = null
let aiSessionInstance: AgentSession | null = null

export function getEditor(): Editor {
  if (!editorInstance) editorInstance = new Editor()
  return editorInstance
}

export function getAiSession(): AgentSession {
  if (!aiSessionInstance) aiSessionInstance = new AgentSession(getEditor())
  return aiSessionInstance
}

/**
 * 启动序列（原 ui/App.tsx 的挂载 effect 迁来，时序口径见方案 §1.1-F3）：
 * ① 种入 AI 面板设置/视图投影（AgentSession 构造内即 pushView——D7 消重后 state 层不再持有
 *    默认设置副本，首绘的真实设置由这里落地）；② 编辑器换用浏览器存储并恢复存档。
 * main.tsx 在 render(<App/>) 前调用——存档恢复完成前 UI 渲染空态（与旧时序可见行为等价）。
 */
export async function bootstrap(): Promise<void> {
  getAiSession().pushView()
  const editor = getEditor()
  await editor.adoptBrowserStore()
  await editor.init()
}
