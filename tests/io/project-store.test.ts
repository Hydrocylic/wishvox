// S5 · 存储降级（REQ-002 补）：IDB 正常 / blocked / open reject / 超时 / 迟到成功 五种情形。
// 不依赖真实浏览器时限：IDB 用最小 stub，超时用 fake timers 推进；不引 fake-indexeddb。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDB_OPEN_TIMEOUT_MS, createProjectStore } from '../../src/io/project-store'
import { Editor } from '../../src/edit/editor'
import { useEditorUi } from '../../src/state/editor-store'

interface FakeDb {
  close: ReturnType<typeof vi.fn>
}

interface FakeRequest {
  onupgradeneeded: (() => void) | null
  onsuccess: (() => void) | null
  onerror: (() => void) | null
  onblocked: (() => void) | null
  result: FakeDb
  error: Error | null
  objectStoreNames: { contains: (name: string) => boolean }
  createObjectStore: (name: string) => void
}

/** 最小 IDB open stub：只满足 `IdbProjectStore.open()` 的接线面（不实现事务）。 */
function fakeOpen(): { req: FakeRequest; db: FakeDb } {
  const db: FakeDb = { close: vi.fn() }
  const req: FakeRequest = {
    onupgradeneeded: null,
    onsuccess: null,
    onerror: null,
    onblocked: null,
    result: db,
    error: null,
    objectStoreNames: { contains: () => true },
    createObjectStore: () => {},
  }
  vi.stubGlobal('indexedDB', { open: () => req })
  return { req, db }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  useEditorUi.setState({ storageOk: true, saveState: 'idle' })
})

describe('S5 · createProjectStore 的降级路径', () => {
  it('正常 IDB ⇒ 用 indexeddb 存储，连接不关闭', async () => {
    const { req, db } = fakeOpen()
    const pending = createProjectStore(1500)
    req.onsuccess?.()
    const store = await pending
    expect(store.kind).toBe('indexeddb')
    expect(db.close).not.toHaveBeenCalled()
  })

  it('onblocked ⇒ 回内存；阻塞方关闭后迟到的 success 被关闭（不泄漏连接）', async () => {
    const { req, db } = fakeOpen()
    const pending = createProjectStore(1500)
    req.onblocked?.()
    const store = await pending
    expect(store.kind).toBe('memory')
    req.onsuccess?.() // 迟到成功
    await Promise.resolve()
    expect(db.close).toHaveBeenCalledTimes(1)
  })

  it('open reject（onerror）⇒ 回内存', async () => {
    const { req } = fakeOpen()
    const pending = createProjectStore(1500)
    req.onerror?.()
    const store = await pending
    expect(store.kind).toBe('memory')
  })

  it(`${IDB_OPEN_TIMEOUT_MS}ms 超时 ⇒ 回内存（fake timers，不等真实时限）`, async () => {
    vi.useFakeTimers()
    const { req } = fakeOpen()
    const pending = createProjectStore(IDB_OPEN_TIMEOUT_MS)
    await vi.advanceTimersByTimeAsync(IDB_OPEN_TIMEOUT_MS)
    const store = await pending
    expect(store.kind).toBe('memory')
    expect(req.onsuccess).not.toBeNull() // 连接仍在等，后面由迟到分支关掉
  })

  it('超时后迟到成功 ⇒ 仍用内存，迟到连接被关闭（不静默换 store）', async () => {
    vi.useFakeTimers()
    const { req, db } = fakeOpen()
    const pending = createProjectStore(100)
    await vi.advanceTimersByTimeAsync(100)
    const store = await pending
    expect(store.kind).toBe('memory')
    req.onsuccess?.()
    // open() 是 async，再经 createProjectStore 的 .then ⇒ 关连接要跨几个微任务
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(db.close).toHaveBeenCalledTimes(1)
  })
})

describe('S5 · Editor 把降级状态传给 UI', () => {
  it('无 indexedDB ⇒ adoptBrowserStore 把 storageOk 置 false', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const editor = new Editor()
    await editor.adoptBrowserStore()
    expect(useEditorUi.getState().storageOk).toBe(false)
  })
})
