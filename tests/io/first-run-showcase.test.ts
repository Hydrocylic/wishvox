// r06 · `S3`/`S4`/`K2`/`K3`：`Editor.init()` 首运行分支的集成判据。
//
// 判据（dispatch §2）：
//   · 无存档 ⇒ `applyFile(展示件)`：1268 块 / 标题「Blue Big Fat Fish」/ 提示 / 检视态（默认）；
//   · 有存档 ⇒ 恢复存档不变（**不读展示件、不覆盖**）；
//   · `newProject()` ⇒ 27 块坯料（行为不变）；
//   · 展示件不可用 ⇒ `seedBlank`（与旧首运行一致）。
// 展示件真实字节来自产品落位件 `public/showcase/blue-big-fat-fish.json`（`?raw`）；
// 本件只把"取件"打桩为直接返回该件——加载器本身与 `K0`/`K1` 在 `io/default-showcase` 覆盖。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import showcaseText from '../../public/showcase/blue-big-fat-fish.json?raw'
import { Editor } from '../../src/edit/editor'
import { MemoryProjectStore } from '../../src/io/project-store'
import { decodeProject } from '../../src/io/serialize'
import { loadDefaultShowcase } from '../../src/io/showcase'
import { useEditorUi } from '../../src/state/editor-store'

vi.mock('../../src/io/showcase', () => ({ loadDefaultShowcase: vi.fn() }))

const decoded = decodeProject(showcaseText)
if (!decoded.ok) throw new Error(`展示件必须可解码（K0）：${decoded.error}`)
const showcaseFile = decoded.file

const SHOWCASE_MESSAGE = '当前为展示模型「Blue Big Fat Fish」——点『新建项目』开始自己的模型'
const BLANK_MESSAGE = '首次运行：已建 3×3×3 坯料（构件「坯料」· 相机对准坯料中心）'

beforeEach(() => {
  vi.mocked(loadDefaultShowcase).mockReset()
})

describe('S3/K2/S4 · 无存档 + init() ⇒ 载入展示件', () => {
  it('1268 块 / 标题「Blue Big Fat Fish」/ 展示件提示 / 保持检视态（默认）', async () => {
    vi.mocked(loadDefaultShowcase).mockResolvedValue(showcaseFile)
    const ed = new Editor(new MemoryProjectStore())
    await ed.init()
    const s = useEditorUi.getState()
    console.info(`[首运行·展示件] nonEmpty=${ed.volume.nonEmptyCount} title=${ed.meta.title} mode=${s.mode} message=${s.message}`)

    expect(ed.volume.nonEmptyCount).toBe(1268)
    expect(ed.meta.title).toBe('Blue Big Fat Fish')
    expect(ed.volume.digest().coordHash).toBe('e62a90f9') // 与展示件逐块一致（K1 同源）
    expect(s.nonEmpty).toBe(1268)
    expect(s.message).toBe(SHOWCASE_MESSAGE)
    expect(s.mode).toBe('inspect') // S4：默认检视态，不自动进编辑
    expect(ed.parts.list()).toHaveLength(1)
    expect(ed.log.patches).toHaveLength(1683) // 复用存档恢复同路：历史随件恢复
    expect(loadDefaultShowcase).toHaveBeenCalledTimes(1)
  })
})

describe('K3 · 有存档 ⇒ 恢复存档（展示件不覆盖）', () => {
  it('走恢复分支：提示「已恢复项目」、块与展示件一致、展示件加载器一次都没被调用', async () => {
    // 存档 = 展示件副本 + 改标题（用于区分"恢复存档"与"载入展示件"两条路）
    const archive = { ...showcaseFile, meta: { ...showcaseFile.meta, title: '用户项目' } }
    const store = new MemoryProjectStore()
    await store.save(archive)
    vi.mocked(loadDefaultShowcase).mockResolvedValue(showcaseFile)

    const ed = new Editor(store)
    await ed.init()
    const s = useEditorUi.getState()
    console.info(`[有存档·恢复] nonEmpty=${ed.volume.nonEmptyCount} title=${ed.meta.title} message=${s.message}`)

    expect(s.message).toBe('已恢复项目「用户项目」')
    expect(ed.meta.title).toBe('用户项目')
    expect(ed.volume.nonEmptyCount).toBe(1268)
    expect(ed.volume.digest().coordHash).toBe('e62a90f9')
    expect(loadDefaultShowcase).not.toHaveBeenCalled() // 有存档 ⇒ 绝不取展示件
  })
})

describe('K3 · 新建项目仍产坯料（既有行为不变）', () => {
  it('展示件载入后 newProject() ⇒ 27 块 / 构件「坯料」/ 恰 1 条补丁', async () => {
    vi.mocked(loadDefaultShowcase).mockResolvedValue(showcaseFile)
    const ed = new Editor(new MemoryProjectStore())
    await ed.init()
    ed.newProject()
    const s = useEditorUi.getState()

    expect(ed.volume.nonEmptyCount).toBe(27)
    expect(ed.parts.list().map((p) => p.name)).toEqual(['坯料'])
    expect(ed.log.patches).toHaveLength(1)
    expect(ed.meta.title).toBe('未命名项目')
    expect(s.message).toBe('已新建项目（3×3×3 坯料 · 构件「坯料」· 相机对准坯料中心）')
  })
})

describe('失败降级 · 展示件不可用 ⇒ 与旧首运行一致', () => {
  it('加载器返回 null ⇒ 27 块坯料 + 旧首运行消息（不误报展示件成功）', async () => {
    vi.mocked(loadDefaultShowcase).mockResolvedValue(null)
    const ed = new Editor(new MemoryProjectStore())
    await ed.init()
    const s = useEditorUi.getState()
    console.info(`[降级] nonEmpty=${ed.volume.nonEmptyCount} message=${s.message}`)

    expect(ed.volume.nonEmptyCount).toBe(27)
    expect(ed.parts.list().map((p) => p.name)).toEqual(['坯料'])
    expect(ed.log.patches).toHaveLength(1)
    expect(s.message).toBe(BLANK_MESSAGE)
    expect(s.mode).toBe('inspect')
  })
})
