import type { ProjectStore } from './project-store'
import type { ProjectFileV2 } from '../core/types'

// REQ-002：改动后 ≤2s 落本地 ⇒ 防抖常量必须 ≤500ms（取 400，留IndexedDB写入的时间余量）
export const AUTOSAVE_DEBOUNCE_MS = 400

export type SaveState = 'idle' | 'pending' | 'saved' | 'error'

export class AutoSaver {
  lastChangeAt = 0
  lastSaveAt = 0
  saveCount = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private store: ProjectStore

  constructor(
    store: ProjectStore,
    private readonly getFile: () => ProjectFileV2,
    private readonly debounceMs: number = AUTOSAVE_DEBOUNCE_MS,
    private readonly onState?: (state: SaveState) => void,
  ) {
    this.store = store
  }

  notifyChange(): void {
    this.lastChangeAt = Date.now()
    this.onState?.('pending')
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      void this.saveNow()
    }, this.debounceMs)
  }

  /** 立即落盘（卸载前 / 导出前调用） */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    await this.saveNow()
  }

  /** 更换底层存储（Editor 在浏览器环境把内存存储换成 IndexedDB 时用） */
  setStore(store: ProjectStore): void {
    this.store = store
  }

  private async saveNow(): Promise<void> {
    this.timer = null
    this.lastSaveAt = Date.now()
    this.saveCount++
    try {
      await this.store.save(this.getFile())
      this.onState?.('saved')
    } catch {
      this.onState?.('error')
    }
  }
}
