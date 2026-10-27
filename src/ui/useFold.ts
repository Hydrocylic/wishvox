// S7 · 共用折叠原语：**受控 / 非受控两用**的开合状态 + 「收起后焦点回位」。
// 消费方：浮块壳 `FloatingTile`（开合由 TileHost 控制）与 S8 的 M1 `Pane`；`Section` 用它收掉
// 自己那份 `useState`。它**只管状态与焦点**，不产 DOM、不定样式——两套壳的标题行结构不同。
//
// 焦点纪律（`D1` / architect §5.5「隐藏正文不得仍能 Tab 进入」）：从展开切到收起的那一拍，
// 焦点若还在即将卸载的正文里，就回到触发方块；由 `triggerRef` 传入。
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

export interface FoldOptions {
  /** 受控开合（省略 = 非受控） */
  readonly open?: boolean
  /** 非受控初值 */
  readonly defaultOpen?: boolean
  /** 开合变化回调（受控方在此写回；非受控也会回调） */
  readonly onChange?: (open: boolean) => void
  /** 触发元素：收起后焦点回位到这里（无则跳过） */
  readonly triggerRef?: RefObject<HTMLElement>
}

export interface FoldControl {
  readonly open: boolean
  setOpen(open: boolean): void
  toggle(): void
}

export function useFold(opts: FoldOptions = {}): FoldControl {
  const [local, setLocal] = useState(opts.defaultOpen ?? false)
  const open = opts.open ?? local
  const setOpen = useCallback(
    (v: boolean) => {
      if (opts.open === undefined) setLocal(v)
      opts.onChange?.(v)
    },
    [opts.open, opts.onChange],
  )
  const toggle = useCallback(() => setOpen(!open), [open, setOpen])

  const wasOpen = useRef(open)
  useEffect(() => {
    if (wasOpen.current && !open) {
      const el = opts.triggerRef?.current
      if (el && typeof el.focus === 'function') el.focus()
    }
    wasOpen.current = open
  }, [open, opts.triggerRef])

  return { open, setOpen, toggle }
}
