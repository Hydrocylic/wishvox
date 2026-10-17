// r06 · `REQ-068`：一键回到默认展示件（保存 ⇒ 重置）。
//
// 判据（`product/requirements.md` `REQ-068` ①–⑤）：
//   ① 确认后场景 = 展示件：1268 块 · 标题「Blue Big Fat Fish」· 构件 1 · 调色板 31（与 `REQ-062`/`K1` 同值）；
//   ② 保存分支：恰一次 `voxel-project.json` 下载，导出内容再导入 ⇒ 与点击前逐块相等；
//   ③ 取消：模型 digest / 补丁数 / 标题 / 存档 digest 逐项一致；
//   ④ 刷新：重置后 `store.load()` 即展示件，新 Editor + `init()` 仍 1268（不回到原项目）；
//   ⑤ 失败面：取件失败 ⇒⇒ 场景与存档均不变 + 明确失败提示（不落空场景、不改建坯料）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import showcaseText from '../../public/showcase/blue-big-fat-fish.json?raw'
import { internBuiltin } from '../../src/core/builtin-palette'
import { CompositionRegistry } from '../../src/core/composition'
import { PartRegistry } from '../../src/core/parts'
import { Volume } from '../../src/core/volume'
import { Editor } from '../../src/edit/editor'
import { downloadJson } from '../../src/io/file-transfer'
import { MemoryProjectStore } from '../../src/io/project-store'
import { decodeProject, encodeProject } from '../../src/io/serialize'
import { useEditorUi } from '../../src/state/editor-store'
import { cmd, commandEnabled } from '../../src/ui/commands'
import { askResetChoice, runShowcaseReset } from '../../src/ui/showcase-actions'

// 保存分支的下载必然走 io/file-transfer；本件把它换成计数桩（同时捕获导出文本）。
vi.mock('../../src/io/file-transfer', () => ({ downloadJson: vi.fn() }))

const decoded = decodeProject(showcaseText)
if (!decoded.ok) throw new Error(`展示件必须可解码（REQ-062 K0）：${decoded.error}`)
const showcaseFile = decoded.file

/** 造一份"用户项目"：1 块红块（不含坯料 ⇒ 与展示件可区分） */
function userFile() {
  const v = new Volume()
  const key = internBuiltin(v.palette).get('color:red')!
  v.setBlock(3, 0, 3, key)
  return encodeProject({
    volume: v,
    parts: new PartRegistry(),
    patches: [
      {
        seq: 0,
        op: { type: 'set', x: 3, y: 0, z: 3, key },
        changes: [{ x: 3, y: 0, z: 3, before: 0, after: key }],
        partId: null,
        createdAt: 0,
        label: '用户单块放置',
      },
    ],
    partCreations: [],
    compositions: new CompositionRegistry(),
    blockStyle: 'color',
    meta: { id: 'p-user', title: '用户项目', createdAt: '2026-10-17T00:00:00.000Z', updatedAt: '2026-10-17T00:00:00.000Z' },
  })
}

/** 建一个装着"用户项目"的编辑器（场景 + 存档都已就位） */
async function editorWithUserProject(): Promise<{ ed: Editor; store: MemoryProjectStore }> {
  const store = new MemoryProjectStore()
  const ed = new Editor(store)
  expect(ed.importFile(JSON.stringify(userFile())).ok).toBe(true)
  await ed.autosave.flush()
  return { ed, store }
}

beforeEach(() => {
  vi.mocked(downloadJson).mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('REQ-068 ①④ · 确认后场景 = 展示件，落盘后刷新仍是展示件', () => {
  it('1268 / 标题 / 构件 1 / 调色板 31；旧撤销栈不可达；store.load() 即展示件', async () => {
    const { ed, store } = await editorWithUserProject()
    const oldDigest = ed.volume.digest()

    const ok = await runShowcaseReset('discard', async () => showcaseFile, ed)
    console.info(`[重置后] nonEmpty=${ed.volume.nonEmptyCount} title=${ed.meta.title} parts=${ed.parts.list().length} palette=${ed.volume.palette.list().length}`)

    expect(ok).toBe(true)
    expect(ed.volume.nonEmptyCount).toBe(1268)
    expect(ed.meta.title).toBe('Blue Big Fat Fish')
    expect(ed.parts.list()).toHaveLength(1)
    expect(ed.volume.palette.list()).toHaveLength(31)
    expect(ed.volume.digest().coordHash).toBe('e62a90f9')

    // 旧项目撤销栈不可达：撤销一次仍是展示件的历史，不会回到原项目
    ed.undo()
    expect(ed.volume.getBlock(3, 0, 3)).toBe(0)
    expect(ed.volume.digest()).not.toEqual(oldDigest)

    // ④ 重置后 store.load() 即展示件
    const saved = await store.load()
    expect(saved?.meta.title).toBe('Blue Big Fat Fish')

    // 刷新（新 Editor 从同一存档恢复）⇒ 仍 1268 块展示件
    const refreshed = new Editor(store)
    await refreshed.init()
    expect(refreshed.volume.nonEmptyCount).toBe(1268)
    expect(refreshed.meta.title).toBe('Blue Big Fat Fish')
  })
})

describe('REQ-068 ② · 保存分支：恰一次下载，导出内容再导入 = 点击前逐块相等', () => {
  it('downloadJson 恰 1 次（voxel-project.json）；导出件再导入与点击前 digest 相等', async () => {
    const { ed } = await editorWithUserProject()
    const before = ed.volume.digest()

    const ok = await runShowcaseReset('save', async () => showcaseFile, ed)

    expect(ok).toBe(true)
    expect(downloadJson).toHaveBeenCalledTimes(1)
    const call = vi.mocked(downloadJson).mock.calls[0]!
    expect(call[0]).toBe('voxel-project.json')
    const fresh = new Editor(new MemoryProjectStore())
    expect(fresh.importFile(call[1]).ok).toBe(true)
    expect(fresh.volume.digest()).toEqual(before) // ② 导出内容 = 点击时刻的工作（逐块相等）
    expect(ed.volume.nonEmptyCount).toBe(1268)
  })
})

describe('REQ-068 ③ · 取消 ⇒ 零修改', () => {
  it('三出口询问 + 取消后模型 / 补丁 / 标题 / 存档逐项不变', async () => {
    expect(askResetChoice(() => true)).toBe('save')
    const answers = [false, true]
    expect(askResetChoice(() => answers.shift() ?? false)).toBe('discard')
    expect(askResetChoice(() => false)).toBe('cancel')

    const { ed, store } = await editorWithUserProject()
    const before = { digest: ed.volume.digest(), patches: ed.log.patches.length, title: ed.meta.title, archive: await store.load() }

    const ok = await runShowcaseReset('cancel', async () => showcaseFile, ed)

    expect(ok).toBe(false)
    expect(downloadJson).not.toHaveBeenCalled()
    expect(ed.volume.digest()).toEqual(before.digest)
    expect(ed.log.patches.length).toBe(before.patches)
    expect(ed.meta.title).toBe(before.title)
    expect(await store.load()).toEqual(before.archive)
  })
})

describe('REQ-068 ⑤ · 展示件不可用 ⇒ 场景与存档不变 + 明确失败提示', () => {
  it('取件 null ⇒ 保持用户项目（非空场景、非坯料）+ 失败文案', async () => {
    const { ed, store } = await editorWithUserProject()
    const before = { digest: ed.volume.digest(), patches: ed.log.patches.length, title: ed.meta.title, archive: await store.load() }

    const ok = await runShowcaseReset('discard', async () => null, ed)

    expect(ok).toBe(false)
    expect(ed.volume.digest()).toEqual(before.digest)
    expect(ed.volume.nonEmptyCount).toBe(1) // 不落空场景、也不悄悄改建成 27 块坯料
    expect(ed.meta.title).toBe(before.title)
    expect(ed.log.patches.length).toBe(before.patches)
    expect(await store.load()).toEqual(before.archive)
    const msg = useEditorUi.getState().message ?? ''
    expect(msg).toContain('回到默认展示件失败')
    expect(msg).toContain('场景与存档未改动')
  })
})

describe('REQ-068 · 检视态可点 + 命令名', () => {
  it('检视态 commandEnabled=true；label = 回到默认展示件', () => {
    useEditorUi.setState({ mode: 'inspect' })
    expect(commandEnabled(cmd.showcaseReset)).toBe(true)
    expect(cmd.showcaseReset.label).toBe('回到默认展示件')
  })
})
