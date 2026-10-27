import { createRoot } from 'react-dom/client'
import { bootstrap } from './app/runtime'
import { setUi } from './state/editor-store'
import { App } from './ui/App'
import { initialShell, readShellEnv } from './ui/shell-mode'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('#root not found')
// S8/S10：**渲染前**定壳初值（coarse / ≤1023 ⇒ 浮块；否则三栏；本机手动选择优先）。
// 必须在 createRoot().render 之前写 store ⇒ 桌面首帧就是三栏，不闪一次浮块。
setUi({ shell: initialShell(readShellEnv()) })
// r04 T5（F3）：启动序列前置——恢复存档 + 种入 AI 面板投影后再挂载（原 App 挂载 effect 迁此）。
// r04 T6 回补（实施单 §7.2 提示 3）：恢复失败不白屏——吞掉启动异常（页面仍渲染空态，与旧形态
// "先 render、effect 里失败"的可见行为一致；错误进控制台）。
try {
  await bootstrap()
} catch (e) {
  console.error('bootstrap 失败（页面以空态启动）', e)
}
createRoot(rootEl).render(<App />)
