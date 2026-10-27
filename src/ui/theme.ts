// S8 · 全局样式出口（token 化）：两壳共用一套变量与控件样式。
// 浮块壳的几何样式仍在 `floating/floating-styles.ts`（FLOATING_CSS）；这里收口 App 内联 CSS 与
// M1 三栏/ Dock / Pane 的样式。**深色只做 chrome**：3D 视口仍是白底（`Viewport` 内联 background），
// 本文件不碰 renderer / grids / stage 白底（REQ-048）。
export const APP_CSS = `
  :root {
    --bg: #0f1218;
    --bg-rail: #141922;
    --line: #232b35;
    --line-soft: #1d242d;
    --fg: #e3e9f0;
    --fg-dim: #99a4b1;
    --fg-mute: #6c7784;
    --accent: #57c26a;
    --btn: #1e252e;
    --btn-hover: #29323d;
    --btn-line: #2e3742;
    /* 状态四色（r05 · 规格 §2.1 / REQ-060）：三色一中性，值沿用现状三色不重调色。
       状态色一律经 token 引用（验收② grep：状态色无散落字面量）；选中 / 身份色不在此列（§2.4）。 */
    --ok: #7bbf7b;
    --warn: #d9a94e;
    --err: #c0705d;
    --mute: #8a929c;
  }
  * { box-sizing: border-box; }
  html, body, #root { height: 100%; margin: 0; }
  body { font-family: system-ui, "Segoe UI", "Microsoft YaHei", sans-serif; background: var(--bg); color: var(--fg); font-size: 13px; }
  button { background: var(--btn); color: var(--fg); border: 1px solid var(--btn-line); border-radius: 6px; padding: 4px 10px; cursor: pointer; font: inherit; }
  button:disabled { opacity: 0.36; cursor: default; }
  button:hover:not(:disabled) { background: var(--btn-hover); }
  select, input, textarea { background: #1a212a; color: var(--fg); border: 1px solid var(--btn-line); border-radius: 6px; padding: 4px 6px; font: inherit; }
  select:focus, input:focus, textarea:focus { outline: 1px solid var(--accent); outline-offset: 0; }
  .app { height: 100%; display: flex; flex-direction: column; }
  .topbar { display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-bottom: 1px solid var(--line); background: #12161d; }
  .brand { font-weight: 700; letter-spacing: .01em; }
  .save { color: var(--fg-mute); font-size: 12px; }
  /* 存储降级（REQ-002 补）：内存回退必须可见，不能继续显示"已保存" */
  .save-volatile { color: var(--warn); }
  /* S7 壳迁移骨架：闸门卡壳级常显（无闸门时 GateDock 不渲染 ⇒ 不占高、不遮画布） */
  .gate-dock { padding: 6px 12px; border-bottom: 1px solid var(--line); background: #12161d; }
  .shell-pick { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--fg-mute); }
  .shell-pick select { padding: 2px 6px; font-size: 12px; }
  .spacer { flex: 1; }
  .icon-btn { min-width: 34px; padding: 3px 8px; font-size: 15px; line-height: 1.35; }
  .mini-btn { padding: 2px 7px; font-size: 13px; line-height: 1.3; }
  .row-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row-meta { color: var(--fg-mute); flex: none; font-size: 11px; }
  .mode-pill { padding: 3px 12px; border-radius: 999px; font-size: 12px; }
  .mode-pill.edit { background: #24512e; border-color: #2f6b3c; }
  .mode-pill.inspect { background: #262d37; }
  .workspace { flex: 1; display: flex; min-height: 0; position: relative; }
  .statusbar { display: flex; gap: 16px; padding: 4px 12px; border-top: 1px solid var(--line); font-size: 12px; color: var(--fg-mute); background: #12161d; }
  /* ── 可折叠区块（Section）── */
  .panel { border-top: 1px solid var(--line-soft); }
  .panel:first-of-type { border-top: 0; }
  .panel-head { width: 100%; display: flex; align-items: center; gap: 6px; padding: 7px 10px; border: 0; border-radius: 0; background: transparent; text-align: left; font-size: 12.5px; font-weight: 600; color: var(--fg); }
  .panel-head:hover:not(:disabled) { background: rgba(255,255,255,0.04); }
  .panel-head .chev { width: 11px; color: var(--fg-mute); font-size: 10px; flex: none; }
  .panel-emoji { font-size: 14px; flex: none; }
  .panel-title { flex: none; }
  .panel-hint { margin-left: auto; padding-left: 8px; color: var(--fg-mute); font-weight: 400; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .panel-body { padding: 2px 10px 12px; }
  .panel .panel { margin: 8px -10px 0; border-top: 1px solid var(--line); }
  .rail-group { padding: 10px 10px 3px; font-size: 10.5px; letter-spacing: .1em; color: var(--fg-mute); text-transform: uppercase; }
  .panel-body > :first-child { margin-top: 0; }
  .field { display: block; margin: 6px 0; font-size: 12px; color: var(--fg-dim); }
  .field > select, .field > input { width: 100%; margin-top: 2px; }
  .note { color: var(--fg-mute); font-size: 11px; margin: 6px 0 0; line-height: 1.45; }
  .warn { color: var(--warn); font-size: 12px; margin: 4px 0; }
  /* ── 左栏（r05 T2）── 三段常开、不折叠（§1.2 末段 / Q4）；组标签复用 .rail-group 与右栏同构 */
  .panel-emoji-btn { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 6px 0; font-size: 11px; color: var(--fg-dim); }
  .panel-emoji-btn .glyph { font-size: 17px; line-height: 1; }
  .panel-emoji-btn.on { background: rgba(87,194,106,0.16); border-color: var(--accent); color: #bdf0c6; }
  /* ── 常显区（r05 T4 · REQ-061）：闸门卡挂这里 ⇒ AI 块折叠时它仍在（折叠只收正文） ── */
  .panel-pinned { padding: 2px 10px 10px; }
  /* 保存状态字（§2.2 首行）：错态 = 红字 + 可点（出口 = autosave.flush()，Q5 裁定） */
  .save-retry { background: none; border: 0; padding: 0; color: var(--err); font-size: 12px; cursor: pointer; text-decoration: underline; }

  /* ── S8 · 三栏壳（M1）── */
  .shell-body { flex: 1; display: grid; grid-template-columns: 252px minmax(0, 1fr) 336px; min-height: 0; }
  .left-rail { min-height: 0; overflow-y: auto; padding: 10px 12px 24px; background: var(--bg-rail); border-right: 1px solid var(--line); }
  .right-dock { min-height: 0; display: flex; flex-direction: column; background: var(--bg-rail); border-left: 1px solid var(--line); }
  .dock-tabs { display: flex; flex-wrap: wrap; gap: 2px; padding: 6px; border-bottom: 1px solid var(--line); }
  .dock-tab { padding: 3px 8px; font-size: 12px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--fg-dim); }
  .dock-tab.on { background: #232b37; border-color: var(--line); color: var(--fg); }
  .tab-badge { margin-left: 4px; color: var(--warn); }
  .dock-body { flex: 1; min-height: 0; overflow-y: auto; padding: 10px; }
  .pane { margin: 0 0 14px; }
  .pane-summary { margin: 2px 0 6px; color: var(--fg-mute); font-size: 11px; }
  .pane-accessory { margin-bottom: 6px; }
  .m1-stage { position: relative; min-width: 0; min-height: 0; display: flex; }
  .m1-stage > * { flex: 1; min-width: 0; }
  @media (max-width: 1279px) { .shell-body { grid-template-columns: 220px minmax(0, 1fr) 300px; } }
  /* 窄屏手动切 M1：三栏改纵向堆叠（无横滚、舞台保 60vh）；默认壳在 ≤1023 仍是浮块（shell-mode） */
  @media (max-width: 1023px) {
    .shell-body { display: flex; flex-direction: column; overflow-y: auto; }
    .left-rail { border-right: 0; border-top: 1px solid var(--line); }
    .right-dock { border-left: 0; border-top: 1px solid var(--line); }
    .m1-stage { min-height: 60vh; }
  }
`
