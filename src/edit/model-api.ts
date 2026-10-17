// r04 T6（A8 超线兜底之三）：模型级写 API——自 edit/editor.ts 迁出。
// place/erase/paint 是 r01 兼容面（测试与工具直调）；runOp 是手动程序化操作入口（OpsPanel/NoisePanel）。
// 检视态门（V10）只挡界面入口（strokeBegin / runOp），不挡模型级方法。
import { isCoordTripleDomain } from '../core/coords'
import { setUi, useEditorUi } from '../state/editor-store'
import type { ProgramOp } from '../core/types'
import { runProgramOp } from '../ops'
import type { Editor } from './editor'

/** 一笔进行中 ⇒ 拒绝并发写（守卫：place/erase/paint/runOp 共用） */
function guard(ed: Editor): boolean {
  if (ed.stroke.active) {
    setUi({ message: '一笔进行中，先松开鼠标' })
    return false
  }
  return true
}

/** `REQ-065`（A-08）手动入口的坐标判定：非法 ⇒ 明确拒绝 + **零写入零记账**（低层 `volume.setBlock` 也会兜底抛错）。
 *  三个模型级方法共用一句，判定本身只有 `core/coords#isCoordDomain` 一份。 */
function coordDomainOk(x: number, y: number, z: number): boolean {
  if (isCoordTripleDomain(x, y, z)) return true
  setUi({ message: `坐标非法（须为 ±4096 内的整数，REQ-065）：(${String(x)}, ${String(y)}, ${String(z)})——未写入、未记账` })
  return false
}

/** D-B ③（r02）：手工放置归当前选中构件；未选中 ⇒ 无归属（手工块——组合层的成员来源之一）。
 *  `REQ-027` 门四：颜色键在**真正写入前**解析/分配；容量耗尽 ⇒ 明确报错且模型、历史、色板零修改。 */
export function place(ed: Editor, x: number, y: number, z: number): void {
  if (!guard(ed)) return
  if (!coordDomainOk(x, y, z)) return
  const key = ed.tryCurrentKey()
  if (!key.ok) {
    setUi({ message: key.message })
    return
  }
  const patch = ed.log.apply({ type: 'set', x, y, z, key: key.key, partId: ed.selectedPartId ?? undefined })
  ed.afterChange(patch.changes)
}

export function erase(ed: Editor, x: number, y: number, z: number): void {
  if (!guard(ed)) return
  if (!coordDomainOk(x, y, z)) return
  const patch = ed.log.apply({ type: 'delete', x, y, z, partId: ed.selectedPartId ?? undefined })
  ed.afterChange(patch.changes)
}

/** 改色：只对已有块生效（before>0 → after>0 的替换）。`REQ-027`：写入前才分配自定义色键。 */
export function paint(ed: Editor, x: number, y: number, z: number): void {
  if (!guard(ed)) return
  if (!coordDomainOk(x, y, z)) return
  if (ed.volume.getBlock(x, y, z) === 0) {
    setUi({ message: '空格没有方块可改色' })
    return
  }
  const key = ed.tryCurrentKey()
  if (!key.ok) {
    setUi({ message: key.message })
    return
  }
  const partId = ed.selectedPartId ?? undefined
  const patch = ed.log.apply({ type: 'set', x, y, z, key: key.key, partId })
  ed.afterChange(patch.changes)
}

/** r02 手动调用面：程序化操作只走 runProgramOp + PatchLog.applyPlanned；空范围 / 非法参数明确反馈不记账。 */
export function runOp(ed: Editor, op: ProgramOp): boolean {
  if (!guard(ed)) return false
  if (useEditorUi.getState().mode !== 'edit') {
    setUi({ message: '检视态不可编辑：顶栏切到「编辑」后重试' })
    return false
  }
  let patch
  try {
    // r04 T5（C3）：变更集先由 ops 层算出，再交记账层；未知操作的 throw 在此被 catch 转成界面反馈
    const changes = runProgramOp(op, { volume: ed.volume, parts: ed.parts, compositions: ed.compositions })
    patch = ed.log.applyPlanned(op, changes, ed.compositions)
  } catch (e) {
    setUi({ message: `操作未执行：${(e as Error).message}` })
    return false
  }
  if (!patch) {
    setUi({ message: '操作未执行：范围内没有方块可作用' })
    return false
  }
  ed.afterChange(patch.changes)
  setUi({ message: `已应用「${patch.label ?? op.name}」` })
  return true
}
