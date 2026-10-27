// S8 · 壳初值与持久化（纯函数，便于无头测试）。
// 规则（D10）：coarse 指针或视口 ≤1023 ⇒ 浮块壳（手机/窄屏）；否则三栏壳（PC）。
// 手动选择优先：localStorage 可读且值合法就用它；读写异常（隐私模式/配额）一律静默回退，不阻断启动。
export type Shell = 'floating' | 'm1'

export const SHELL_STORAGE_KEY = 'wishvox.shell'
export const M1_MIN_WIDTH = 1024

interface ShellEnv {
  readonly innerWidth?: number
  readonly coarsePointer?: boolean
  readonly stored?: string | null
}

/** 无 window 的环境（vitest / Node 集成脚本）⇒ 浮块壳：既有测试基线不因默认壳改变 */
export function initialShell(env: ShellEnv = {}): Shell {
  if (env.stored === 'floating' || env.stored === 'm1') return env.stored
  if (env.coarsePointer === true) return 'floating'
  if (typeof env.innerWidth === 'number' && env.innerWidth > 0) return env.innerWidth < M1_MIN_WIDTH ? 'floating' : 'm1'
  return 'floating'
}

/** 读浏览器环境（window 不存在时返回空环境 ⇒ initialShell 给 floating） */
export function readShellEnv(): ShellEnv {
  if (typeof window === 'undefined') return {}
  let stored: string | null = null
  try {
    stored = window.localStorage.getItem(SHELL_STORAGE_KEY)
  } catch {
    stored = null
  }
  let coarsePointer = false
  try {
    coarsePointer = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
  } catch {
    coarsePointer = false
  }
  return { innerWidth: window.innerWidth, coarsePointer, stored }
}

/** 写入手动选择；失败（隐私模式）返回 false，由调用方忽略 */
export function persistShell(shell: Shell): boolean {
  if (typeof window === 'undefined') return false
  try {
    window.localStorage.setItem(SHELL_STORAGE_KEY, shell)
    return true
  } catch {
    return false
  }
}
