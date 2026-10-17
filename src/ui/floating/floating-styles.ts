// `D1` 外观：悬浮方块、固定锚点、内容体（内部滚动 + 焦点样式）。
// 为什么是 TS 字符串而不是 `.css`：本仓 `vitest` 为 `environment: 'node'` 且不引 CSS 加载器，
// 产品既有的做法就是"App 注入一段 css 字符串"（`ui/App.tsx` 顶部 `css`）——沿用同一机制，
// 免引入新构建依赖（`README.md`：不新增依赖）。
// 尺寸来自 `tile-layout.ts` 的常量（**插值**进 CSS）⇒ 边长只有一处正本，不在样式里再抄一遍。
import { TILE_SIZE } from './tile-layout'

export const FLOATING_CSS = `
  .workspace-host { --tile-size: ${TILE_SIZE}px; position: relative; flex: 1; min-height: 0; display: flex; }
  .hud-slot { position: absolute; top: 8px; left: 8px; max-width: 46%; pointer-events: none; z-index: 3; }
  .tile-anchor { position: absolute; z-index: 4; }
  .tile-anchor.standalone { position: relative; display: inline-block; }
  .tile-head { width: var(--tile-size); height: var(--tile-size); padding: 0; justify-content: center; gap: 0; }
  .tile-head .panel-emoji { font-size: 17px; }
  .tile-hint-sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
  .tile-body { position: absolute; z-index: 5; display: flex; flex-direction: column; min-height: 0; overflow: hidden;
    background: var(--bg-rail); border: 1px solid var(--line); border-radius: 6px; box-shadow: 0 8px 24px rgba(0,0,0,0.45); }
  .tile-body.standalone { position: static; margin-top: 6px; max-width: 336px; }
  .tile-body-head { display: flex; align-items: center; gap: 6px; padding: 5px 6px 5px 9px; border-bottom: 1px solid var(--line-soft); flex: none; }
  .tile-body-head strong { flex: 1; font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tile-close { padding: 0 6px; line-height: 1.5; }
  .tile-body .panel-body { overflow: auto; min-height: 0; flex: 1; padding: 2px 10px 12px; }
  .tile-body .panel-pinned { flex: none; border-top: 1px solid var(--line-soft); }
  .tile-anchor .panel-pinned { position: absolute; top: calc(var(--tile-size) + 4px); right: 0; width: 264px; z-index: 5; }
  /* 常显槽无内容（无待批闸门）⇒ 不占位、不可见（REQ-061 的可见性判据 = 有卡才可见） */
  .panel-pinned:empty { display: none; }
  /* D5：左上预览区短原因 —— 出现瞬间短闪（≤2s 一次），此后稳定常显（动画结束即静态） */
  .hud-warn { color: var(--warn); font-size: 12px; margin-top: 4px; font-weight: 600; }
  .hud-warn.flash { animation: hud-warn-flash 1.8s ease-out 1; }
  @keyframes hud-warn-flash { 0%,100% { opacity: 1 } 10% { opacity: 0.2 } 22% { opacity: 1 } 40% { opacity: 0.3 } 55% { opacity: 1 } }
`
