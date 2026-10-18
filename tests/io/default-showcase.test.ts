// r06 · `S2`/`K0`/`K1`：展示件落位 + 加载器 + 装配读数。
//
// 数据源 = 产品落位件 `public/showcase/blue-big-fat-fish.json`（用 Vite `?raw` 读**真实字节**，
// 不另造样本、不重复实现校验）。判据 = work/r06-default-showcase/dispatch/code-default-showcase-2026-10-17.md §2。
import { describe, expect, it, vi } from 'vitest'
import showcaseText from '../../public/showcase/blue-big-fat-fish.json?raw'
import { Editor } from '../../src/edit/editor'
import { applyFile, buildFile } from '../../src/edit/project'
import { loadDefaultShowcase, SHOWCASE_URL } from '../../src/io/showcase'
import type { ShowcaseFetch } from '../../src/io/showcase'
import { decodeProject } from '../../src/io/serialize'

const decoded = decodeProject(showcaseText)
if (!decoded.ok) throw new Error(`展示件必须可解码（K0）：${decoded.error}`)
const showcaseFile = decoded.file

/** 造一个可捕获 URL 的 fetch（只实现加载器要求的形状：`ok` + `text()`） */
function fetchReturning(body: string, init: { ok?: boolean } = {}): { calls: string[]; fn: ShowcaseFetch } {
  const calls: string[] = []
  const fn: ShowcaseFetch = async (url) => {
    calls.push(url)
    return { ok: init.ok ?? true, text: async () => body }
  }
  return { calls, fn }
}

describe('K0 · 落位展示件可解码且自描述', () => {
  it('decodeProject(text).ok === true；标题 / chunk / 调色板 / 构件 / 补丁与展示件一致', () => {
    expect(decoded.ok).toBe(true)
    expect(showcaseFile.meta.title).toBe('Blue Big Fat Fish')
    expect(showcaseFile.chunks).toHaveLength(8)
    expect(showcaseFile.palette).toHaveLength(31)
    expect(showcaseFile.parts).toHaveLength(1)
    expect(showcaseFile.log.patches).toHaveLength(1683)
  })
})

describe('S2 · loadDefaultShowcase（单一 URL 常量 + 可注入 + 失败一律 null）', () => {
  it('注入成功 fetch ⇒ 返回解码后的文件；请求的 URL = SHOWCASE_URL', async () => {
    const { calls, fn } = fetchReturning(showcaseText)
    const file = await loadDefaultShowcase(fn)
    expect(file).not.toBeNull()
    expect(file?.meta.title).toBe('Blue Big Fat Fish')
    expect(calls).toEqual([SHOWCASE_URL])
  })

  it('展示件 URL 收敛为单一常量，并随部署 base 自适配（vitest 下 BASE_URL = /）', () => {
    expect(import.meta.env.BASE_URL).toBe('/')
    expect(SHOWCASE_URL).toBe(`${import.meta.env.BASE_URL}showcase/blue-big-fat-fish.json`)
  })

  it('非 2xx ⇒ null（不误报成功）', async () => {
    const { fn } = fetchReturning(showcaseText, { ok: false })
    await expect(loadDefaultShowcase(fn)).resolves.toBeNull()
  })

  it('网络错（fetch 抛）⇒ null，不向上抛', async () => {
    const fn: ShowcaseFetch = async () => {
      throw new Error('network down')
    }
    await expect(loadDefaultShowcase(fn)).resolves.toBeNull()
  })

  it('取到但不是合法项目文件 ⇒ null（解码失败走降级）', async () => {
    const { fn } = fetchReturning('{"format":"nope"}')
    await expect(loadDefaultShowcase(fn)).resolves.toBeNull()
  })

  it('无 fetch 环境 ⇒ null（不抛错）', async () => {
    vi.stubGlobal('fetch', undefined)
    try {
      await expect(loadDefaultShowcase()).resolves.toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('K1 · applyFile 装配读数与展示件一致（数值读回）', () => {
  it('nonEmpty 1268 / digest e62a90f9 / 调色板 31 / 构件 1 / 补丁 1683', () => {
    const ed = new Editor()
    applyFile(ed, showcaseFile)
    const digest = ed.volume.digest()
    console.info(
      `[K1 装配] nonEmpty=${digest.nonEmpty} digest=${digest.coordHash} palette=${ed.volume.palette.list().length} ` +
        `parts=${ed.parts.list().length} patches=${ed.log.patches.length}`,
    )
    expect(digest.nonEmpty).toBe(1268)
    expect(digest.coordHash).toBe('e62a90f9')
    expect(ed.volume.palette.list()).toHaveLength(31)
    expect(ed.parts.list()).toHaveLength(1)
    expect(ed.parts.list()[0]?.name).toBe('坯料')
    expect(ed.log.patches).toHaveLength(1683)
    expect(ed.meta.title).toBe('Blue Big Fat Fish')
  })

  it('再编码 → 解码 → 装配：digest 相等（可复算，不靠目检）', () => {
    const a = new Editor()
    applyFile(a, showcaseFile)
    const round = decodeProject(JSON.stringify(buildFile(a)))
    expect(round.ok).toBe(true)
    if (!round.ok) return
    const b = new Editor()
    applyFile(b, round.file)
    expect(b.volume.digest()).toEqual(a.volume.digest())
  })
})
