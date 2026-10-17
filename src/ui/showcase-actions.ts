// r06 展示件追加功能（`REQ-067` / `REQ-068`）· UI 侧动作组合。
// 分工：场景/存档的原子操作在 `edit/project.ts`（`clearLocalData` / `resetToShowcase`）；
// AI 本地键由 ai 层自己清（settings / session-log）——本层只调用，不复制键名（也避免 io→ai 反向依赖）。
// 可测面：确认流程与文案是纯函数（`askClearLocalData` / `askResetChoice`，confirm 可注入）；
// 场景效果走 `clearLocalDataAndReload(ed, reload)` / `runShowcaseReset(choice, load, ed)`（`ed` 可注入）。
import { clearStoredAiSettings } from '../ai/settings'
import { createSessionStore } from '../ai/session-log'
import { getEditor } from '../app/runtime'
import type { Editor } from '../edit/editor'
import { clearLocalData, resetToShowcase } from '../edit/project'
import { downloadJson } from '../io/file-transfer'
import { loadDefaultShowcase } from '../io/showcase'
import { setUi } from '../state/editor-store'

/** `REQ-067`：二次确认框文案——逐项列出三项 + 「不可撤销」+ api key 提醒（判据逐条可查）。 */
export const CLEAR_CONFIRM_TEXT = [
  '清理本地数据？将清空恰好三项（不可撤销）：',
  '· IndexedDB 项目存档（当前项目的存档记录）',
  '· localStorage AI 设置（含 api key）',
  '· localStorage AI 会话日志',
  '',
  '不含浏览器历史 / 缓存 / cookie，也不动其它本地键。',
  'api key 删除后需重新填写；确认后立即重新载入默认展示件。',
].join('\n')

/** `REQ-068`：第一问——是否先保存当前工作（确定 = 保存并重置；取消 = 进入第二问）。 */
export const RESET_SAVE_PROMPT = [
  '回到默认展示件前，先保存当前工作吗？',
  '',
  '「确定」= 保存并重置：先下载 voxel-project.json（当前项目），再重置为展示件',
  '「取消」= 不保存，继续选择是否直接重置',
].join('\n')

/** `REQ-068`：第二问——不保存直接重置（确定 = 重置；取消 = 放弃，场景保持不变）。 */
export const RESET_DISCARD_PROMPT = [
  '不保存当前工作，直接重置为默认展示件？',
  '',
  '「确定」= 直接重置（当前工作不保留）',
  '「取消」= 放弃本次操作（场景保持不变）',
].join('\n')

export type ResetChoice = 'save' | 'discard' | 'cancel'
/** 确认面（可注入：无头测试不碰 `window`） */
export type ConfirmFn = (message: string) => boolean

const defaultConfirm: ConfirmFn = (message) => window.confirm(message)

/** `REQ-067`：清理前的二次确认（取消 ⇒ 调用方零修改）。 */
export function askClearLocalData(confirmFn: ConfirmFn = defaultConfirm): boolean {
  return confirmFn(CLEAR_CONFIRM_TEXT)
}

/** `REQ-068`：三出口询问——保存并重置 / 不保存直接重置 / 取消（纯询问，不改场景）。 */
export function askResetChoice(confirmFn: ConfirmFn = defaultConfirm): ResetChoice {
  if (confirmFn(RESET_SAVE_PROMPT)) return 'save'
  return confirmFn(RESET_DISCARD_PROMPT) ? 'discard' : 'cancel'
}

/**
 * `REQ-067`：确认后的清理——恰好三项（IndexedDB 存档 / `ai-settings` / `ai-session`）→ 立即重载。
 * 重载 = 落回「无存档 ⇒ 首运行展示件」（`REQ-062`），同时把内存里的 AI 设置 / 会话整体重置
 * （否则 api key 仍留在运行中的 AI 面板里，与「清空」语义不符）。
 * 存档清空抛错 ⇒ 明确报错、不重载、不清 AI 键（不制造半清状态）。
 */
export async function clearLocalDataAndReload(
  ed: Editor = getEditor(),
  reload: () => void = () => window.location.reload(),
): Promise<void> {
  try {
    await clearLocalData(ed)
  } catch (e) {
    setUi({ message: `清理本地数据失败：${(e as Error).message}——未重载，场景保持不变` })
    return
  }
  clearStoredAiSettings()
  createSessionStore().clear()
  reload()
}

/**
 * `REQ-068`：确认后的重置——保存分支先导出（恰一次 `voxel-project.json`）再重置；
 * 取消分支零修改；重置失败（展示件不可用）由 `resetToShowcase` 报错并保留场景与存档。
 */
export async function runShowcaseReset(
  choice: ResetChoice,
  load: typeof loadDefaultShowcase = loadDefaultShowcase,
  ed: Editor = getEditor(),
): Promise<boolean> {
  if (choice === 'cancel') {
    setUi({ message: '已取消：场景保持不变' })
    return false
  }
  if (choice === 'save') downloadJson('voxel-project.json', ed.exportFile())
  const result = await resetToShowcase(ed, load)
  return result.ok
}
