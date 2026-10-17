// r06 · `REQ-067`：一键清理本地数据（清空恰好三项 ⇒ 首运行展示件）。
//
// 判据（`product/requirements.md` `REQ-067` ①–⑤）：
//   ① 取消 ⇒ 存档 / 两个 localStorage 键 / 模型 digest / 补丁数零修改；
//   ② 确认 ⇒ `store.load() === null`、两个键为 null，且越过自动保存防抖（>2s 口径）复查仍为空（无写回）；
//   ③ 清空后首屏 = 默认展示件（1268 块 · 标题「Blue Big Fat Fish」· 检视态），不是 3×3×3 坯料；
//   ④ 检视态下命令可点（`commandEnabled === true`）；
//   ⑤ 除三项外不删其它 localStorage 键（多删一项 = 不通过）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import showcaseText from '../../public/showcase/blue-big-fat-fish.json?raw'
import { Editor } from '../../src/edit/editor'
import { MemoryProjectStore } from '../../src/io/project-store'
import { decodeProject } from '../../src/io/serialize'
import { useEditorUi } from '../../src/state/editor-store'
import { cmd, commandEnabled } from '../../src/ui/commands'
import { loadDefaultShowcase } from '../../src/io/showcase'
import { askClearLocalData, CLEAR_CONFIRM_TEXT, clearLocalDataAndReload } from '../../src/ui/showcase-actions'

// 首屏判据走真实首运行装载路：把取件固定为产品落位件（加载器本身在 `io/default-showcase` 覆盖）。
vi.mock('../../src/io/showcase', () => ({ loadDefaultShowcase: vi.fn() }))

const decoded = decodeProject(showcaseText)
if (!decoded.ok) throw new Error(`展示件必须可解码（REQ-062 K0）：${decoded.error}`)
const showcaseFile = decoded.file

const AI_SETTINGS_KEY = 'wishvox/ai-settings/v1'
const AI_SESSION_KEY = 'wishvox/ai-session/v1'
/** 旧品牌键（2026-10-17 改名）：直改不迁移 ⇒ 孤儿化、既不被读也不被清（`REQ-067` ⑤「其它键不动」） */
const LEGACY_AI_SETTINGS_KEY = 'voxel-ai-editor/ai-settings/v1'
const LEGACY_AI_SESSION_KEY = 'voxel-ai-editor/ai-session/v1'

/** 最小 Storage 替身（L1 无头环境没有 localStorage） */
function fakeStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  }
}

beforeEach(() => {
  vi.mocked(loadDefaultShowcase).mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('REQ-067 ②③⑤ · 确认后恰好三项清空 ⇒ 无写回 ⇒ 首屏展示件', () => {
  it('三项逐项为空、无关键保留、越过防抖仍为空、随后 init() 得展示件', async () => {
    const storage = fakeStorage({
      [AI_SETTINGS_KEY]: '{"apiKey":"sk-test"}',
      [AI_SESSION_KEY]: '[]',
      [LEGACY_AI_SETTINGS_KEY]: 'legacy',
      [LEGACY_AI_SESSION_KEY]: 'legacy',
      'other-key': 'keep',
    })
    vi.stubGlobal('localStorage', storage)

    const ed = new Editor(new MemoryProjectStore())
    ed.newProject() // 27 块坯料 = 有可写场景
    await ed.autosave.flush() // 先落盘（模拟"已有存档"）
    expect(await ed.store.load()).not.toBeNull()

    let reloads = 0
    await clearLocalDataAndReload(ed, () => {
      reloads++
    })

    expect(reloads).toBe(1)
    expect(await ed.store.load()).toBeNull()
    expect(storage.getItem(AI_SETTINGS_KEY)).toBeNull()
    expect(storage.getItem(AI_SESSION_KEY)).toBeNull()
    expect(storage.getItem('other-key')).toBe('keep') // ⑤ 不多删
    // 改名不迁移（契约 §5）：旧品牌键孤儿化——既不读也不清，仍在原处
    expect(storage.getItem(LEGACY_AI_SETTINGS_KEY)).toBe('legacy')
    expect(storage.getItem(LEGACY_AI_SESSION_KEY)).toBe('legacy')

    // ②「越过自动保存防抖（>2s）复查三项仍为空」：按判据字面等 2.1s（防抖 400ms，早已越过）
    await new Promise((r) => setTimeout(r, 2100))
    expect(await ed.store.load()).toBeNull()
    expect(storage.getItem(AI_SETTINGS_KEY)).toBeNull()
    expect(storage.getItem(AI_SESSION_KEY)).toBeNull()

    // ③ 清空后首屏 = 默认展示件（等效重跑 init；UI 侧 = 重载后的同一条装载路）
    vi.mocked(loadDefaultShowcase).mockResolvedValue(showcaseFile)
    await ed.init()
    console.info(`[清理后首屏] nonEmpty=${ed.volume.nonEmptyCount} title=${ed.meta.title} mode=${useEditorUi.getState().mode}`)
    expect(ed.volume.nonEmptyCount).toBe(1268)
    expect(ed.meta.title).toBe('Blue Big Fat Fish')
    expect(useEditorUi.getState().mode).toBe('inspect')
  })
})

describe('REQ-067 ① · 取消 ⇒ 零修改', () => {
  it('命令路径 confirm=false ⇒ 存档 / 两个键 / digest / 补丁数逐项不变', async () => {
    const storage = fakeStorage({ [AI_SETTINGS_KEY]: '{"apiKey":"sk-test"}', [AI_SESSION_KEY]: '[]' })
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('window', { confirm: () => false })

    const ed = new Editor(new MemoryProjectStore())
    ed.newProject()
    await ed.autosave.flush()
    const before = { digest: ed.volume.digest(), patches: ed.log.patches.length, archive: await ed.store.load() }

    cmd.cleanLocalData.run() // 确认框返回 false ⇒ 不调用清理

    expect(await ed.store.load()).toEqual(before.archive)
    expect(storage.getItem(AI_SETTINGS_KEY)).toBe('{"apiKey":"sk-test"}')
    expect(storage.getItem(AI_SESSION_KEY)).toBe('[]')
    expect(ed.volume.digest()).toEqual(before.digest)
    expect(ed.log.patches.length).toBe(before.patches)
  })
})

describe('REQ-067 ④ · 检视态可点 + 确认文案', () => {
  it('检视态 commandEnabled=true；文案逐项列三项 + 不可撤销 + api key 提醒', () => {
    useEditorUi.setState({ mode: 'inspect' })
    expect(commandEnabled(cmd.cleanLocalData)).toBe(true)
    expect(cmd.cleanLocalData.label).toBe('清理本地数据')
    expect(CLEAR_CONFIRM_TEXT).toContain('IndexedDB 项目存档')
    expect(CLEAR_CONFIRM_TEXT).toContain('AI 设置（含 api key）')
    expect(CLEAR_CONFIRM_TEXT).toContain('AI 会话日志')
    expect(CLEAR_CONFIRM_TEXT).toContain('不可撤销')
    expect(CLEAR_CONFIRM_TEXT).toContain('需重新填写')
    expect(askClearLocalData(() => false)).toBe(false)
    expect(askClearLocalData(() => true)).toBe(true)
  })
})
