// REQ-002 · 自动保存与恢复：防抖常量 ≤500ms、写入发起时间 ≤2s、窗口内合并、save→load 逐块相等
// （刷新不丢的 L1 面：浏览器刷新由人工四条之 REQ-001 验，存储语义在此断言）
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTOSAVE_DEBOUNCE_MS, AutoSaver } from '../../src/io/autosave'
import { internBuiltin } from '../../src/core/builtin-palette'
import { PatchLog } from '../../src/core/patch-log'
import { PartRegistry } from '../../src/core/parts'
import { MemoryProjectStore } from '../../src/io/project-store'
import { decodeProject, encodeProject, loadProjectFile } from '../../src/io/serialize'
import { CompositionRegistry } from '../../src/core/composition'
import type { ProjectFileV2 } from '../../src/core/types'
import { Volume } from '../../src/core/volume'

function buildFile(): { file: ProjectFileV2; volume: Volume } {
  const volume = new Volume()
  const keys = internBuiltin(volume.palette)
  const parts = new PartRegistry()
  const compositions = new CompositionRegistry()
  const log = new PatchLog(volume, parts)
  for (let i = 0; i < 10; i++) {
    log.apply({ type: 'set', x: i, y: 0, z: 0, key: keys.get('color:red')! })
  }
  const file = encodeProject({
    volume,
    parts,
    patches: log.patches,
    partCreations: log.partCreations,
    compositions,
    blockStyle: 'color',
    meta: {
      id: 'p1',
      title: '自动保存测试',
      createdAt: '2026-09-30T00:00:00.000Z',
      updatedAt: '2026-09-30T00:00:01.000Z',
    },
  })
  return { file, volume }
}

describe('REQ-002 · 自动保存与恢复', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('防抖常量 ≤ 500 ms（门槛的一半留给写入本身）', () => {
    expect(AUTOSAVE_DEBOUNCE_MS).toBeLessThanOrEqual(500)
  })

  it('改动后防抖到期才写入：写入发起时间 − 改动时间 ≤ 2000 ms（实测 = 防抖值）', () => {
    const store = new MemoryProjectStore()
    const { file } = buildFile()
    const saver = new AutoSaver(store, () => file)
    saver.notifyChange()
    expect(store.saveTimestamps).toHaveLength(0) // 未到期不写
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS - 1)
    expect(store.saveTimestamps).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(store.saveTimestamps).toHaveLength(1)
    const latency = saver.lastSaveAt - saver.lastChangeAt
    expect(latency).toBeGreaterThanOrEqual(0)
    expect(latency).toBeLessThanOrEqual(2000)
    expect(saver.saveCount).toBe(1)
  })

  it('防抖窗口内的多次改动合并为一次写入', () => {
    const store = new MemoryProjectStore()
    const { file } = buildFile()
    const saver = new AutoSaver(store, () => file)
    for (let i = 0; i < 10; i++) {
      saver.notifyChange()
      vi.advanceTimersByTime(50)
    }
    expect(store.saveTimestamps).toHaveLength(0) // 都在窗口内，尚未落
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS)
    expect(store.saveTimestamps).toHaveLength(1)
  })

  it('save→load：经存储层往返后逐块相等（"刷新后模型 = 改动前"的存储语义）', async () => {
    const store = new MemoryProjectStore()
    const { file, volume } = buildFile()
    await store.save(file)
    const loaded = await store.load()
    expect(loaded).not.toBeNull()
    const freshVolume = new Volume()
    const freshParts = new PartRegistry()
    const result = decodeProject(JSON.stringify(loaded))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    loadProjectFile(result.file, freshVolume, freshParts)
    expect(freshVolume.digest()).toEqual(volume.digest())
  })
})
