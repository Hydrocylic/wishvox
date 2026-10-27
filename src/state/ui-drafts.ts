// S8 · 会话级草稿（不进项目文件、不进撤销、不落盘）。
// 为什么需要它：切换壳（浮块 ↔ 三栏）会换掉面板树，面板组件里的 `useState` 会随卸载丢失；
// 把用户正在填的表单/输入提升到这里 ⇒ 切壳后草稿仍在（merge-plan S8「AI 会话/表单草稿不丢」）。
// 形状刻意保持"面板自解释"：本模块不 import ui/ 的类型，避免 state→ui 反向依赖；面板侧自行窄化。
import { create } from 'zustand'

export interface OpsDraft {
  readonly name: string
  readonly form: Record<string, unknown>
  readonly expanded: boolean
}

export interface PartsDraft {
  readonly editingId: string | null
  readonly draft: string
  readonly expandedComp: string | null
}

interface UiDraftsState {
  ops: OpsDraft | null
  noise: Record<string, unknown> | null
  aiInput: string
  parts: PartsDraft | null
  setOps(draft: OpsDraft): void
  setNoise(form: Record<string, unknown> | null): void
  setAiInput(text: string): void
  setParts(draft: PartsDraft): void
}

export const useUiDrafts = create<UiDraftsState>((set) => ({
  ops: null,
  noise: null,
  aiInput: '',
  parts: null,
  setOps: (draft) => set({ ops: draft }),
  setNoise: (form) => set({ noise: form }),
  setAiInput: (text) => set({ aiInput: text }),
  setParts: (draft) => set({ parts: draft }),
}))
