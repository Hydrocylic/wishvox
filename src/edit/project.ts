// r04 T6（A4）：项目命令（新建 / 导入 / 导出）与文件装拆——自 edit/editor.ts 迁出。
// REQ-001 / REQ-003 · F6：新建 = 3³ 坯料；编解码走 io/serialize（D1 已在 T5 归位）。
import { internBuiltin } from '../core/builtin-palette'
import type { ProjectFileV2, ProjectMeta, VoxelChange } from '../core/types'
import { decodeProject, encodeProject, loadProjectFile } from '../io/serialize'
import type { StyleDowngrade } from '../io/legacy-style'
import { loadDefaultShowcase } from '../io/showcase'
import { setUi } from '../state/editor-store'
import type { Editor } from './editor'

/** `REQ-022` ③：旧外观档降级的回执说明（不静默——恢复 / 导入消息里点名身份重写条数） */
function styleDowngradeNote(d: StyleDowngrade | undefined): string {
  return d === undefined ? '' : `（旧外观档已降级为彩色：${d.rewrites} 个身份重写为 color:#hex）`
}

/** 项目元数据初值（r04 T6 自 editor.ts 迁来） */
export function freshMeta(title = '未命名项目'): ProjectMeta {
  const now = new Date().toISOString()
  return { id: `proj-${Math.random().toString(36).slice(2, 10)}`, title, createdAt: now, updatedAt: now }
}

export function newProject(ed: Editor): void {
  if (ed.stroke.active) ed.stroke.cancel()
  ed.volume.reset()
  ed.parts.clear()
  ed.compositions.clear()
  ed.log.reset()
  ed.builtinKeys = internBuiltin(ed.volume.palette)
  ed.meta = freshMeta()
  ed.blockStyle = 'color'
  ed.selectedPartId = null
  ed.selectedCompositionId = null
  ed.missing = []
  void ed.store.clear()
  seedBlank(ed)
  setUi({ message: '已新建项目（3×3×3 坯料 · 构件「坯料」· 相机对准坯料中心）' })
}

/**
 * 3×3×3 实心坯料 = **新建项目 / 首运行（无存档）共用的单一入口**（`REQ-056` · `REQ-062`）。
 * 调用前提 = 模型已清空（`newProject` 清档后 / `init` 读到无存档）。
 * 口径（r05 件一唯一正本，改这一处两处都变）：
 * - 27 块 `(0..2)³`、中心格 `(1,1,1)`，归初始构件「坯料」（复用 `REQ-023` 的构件路）；
 * - **走一条 place 笔刷补丁** ⇒ "一次撤销清空"天然成立（`V5`）；`notifyChange` ⇒ "刷新后仍在"；
 * - 相机对准坯料 AABB 中心（`frameModel`，`F6`）。
 */
export function seedBlank(ed: Editor): void {
  // `REQ-027`：初始化坯料不该为"当前色"分配自定义键 ⇒ 只查内置键，缺省退回色板首键（不 intern）
  const blankKey = ed.builtinKeys.get('color:light-gray') ?? ed.volume.palette.list()[0]?.key ?? 1
  const part = ed.log.createPart('坯料', true) // D3：捆绑——撤销初始化即剪掉空「坯料」，redo 复活
  const changes: VoxelChange[] = []
  for (let x = 0; x <= 2; x++) {
    for (let y = 0; y <= 2; y++) {
      for (let z = 0; z <= 2; z++) {
        changes.push({ x, y, z, before: 0, after: blankKey })
        ed.volume.setBlock(x, y, z, blankKey)
        ed.parts.assign(x, y, z, part.id)
      }
    }
  }
  ed.log.commitStroke({
    changes,
    ownersBefore: changes.map(() => null),
    op: { type: 'stroke', action: 'place', mode: 'additive', size: { x: 3, y: 3, z: 3 } },
    label: '初始化·坯料 3×3×3',
    partId: part.id,
  })
  ed.updateAppearance()
  ed.renderer?.rebuildAll()
  ed.renderer?.frameModel() // 相机初始对准坯料 AABB 中心（F6）
  ed.autosave.notifyChange()
  ed.syncUi()
}

/**
 * 启动装载分支（`Editor.init()` 的唯一入口；`editor.ts` 只留一行委托 ⇒ 400 行结构门槛下仍有余量）。
 * 口径（`REQ-001` / `REQ-062`，2026-10-17 改口径）：
 * - **有存档** ⇒ `applyFile` 恢复（**不建坯料、不覆盖用户存档、不读展示件**）；
 * - **无存档（首运行）** ⇒ 先 `loadDefaultShowcase()`：成功 ⇒ `applyFile` 装配展示件（与存档恢复同路，
 *   标题取自件内 `meta.title`）；
 * - **展示件不可用**（无 fetch / 非 2xx / 网络错 / 解码失败）⇒ 退回与 `newProject()` 调**同一段**
 *   `seedBlank` ⇒ 27 块 / 构件「坯料」/ 1 条补丁（与旧首运行一致，不误报成功）；
 * - 存档解码失败 ⇒ 保持空模型 + 报错（本单不动这条既有语义）。
 */
export async function loadOrSeed(ed: Editor, saved: ProjectFileV2 | null): Promise<void> {
  if (saved) {
    const result = decodeProject(JSON.stringify(saved))
    if (result.ok) {
      applyFile(ed, result.file)
      setUi({ message: `已恢复项目「${saved.meta.title}」${styleDowngradeNote(result.downgrade)}` })
    } else {
      setUi({ message: `恢复失败：${result.error}（已开新项目）` })
    }
    return
  }
  const showcase = await loadDefaultShowcase()
  if (showcase) {
    applyFile(ed, showcase)
    // `S4`：一句话说清"当前是展示件"+ 出口；检视态是默认态（`editor-store.ts` 初值），这里不切模式。
    setUi({ message: `当前为展示模型「${showcase.meta.title}」——点『新建项目』开始自己的模型` })
    return
  }
  seedBlank(ed)
  setUi({ message: '首次运行：已建 3×3×3 坯料（构件「坯料」· 相机对准坯料中心）' })
}

/**
 * `REQ-067`：清理本地数据（编辑面）。三项中的存档项 = `store.clear()`（只删当前项目记录，不动其它库/键）。
 * 次序：取消半笔 → `flush()` 掐掉防抖定时器并等在途写落完（同一 store 事务有序）→ 整档删除
 * ⇒ 清空之后自动保存（`REQ-002`）不会把内存里的旧场景写回（`REQ-067` ② 的「越过防抖复查」口径）。
 * AI 本地键（`ai-settings` / `ai-session`）与清空后重载属 ui 层组合（`ui/showcase-actions`）。
 */
export async function clearLocalData(ed: Editor): Promise<void> {
  if (ed.stroke.active) ed.stroke.cancel()
  await ed.autosave.flush()
  await ed.store.clear()
}

export function exportFile(ed: Editor): string {
  ed.meta = { ...ed.meta, updatedAt: new Date().toISOString() }
  return JSON.stringify(buildFile(ed), null, 2)
}

/** 导入要么完整成功、要么明确失败且当前场景不变（REQ-003 / NFR-006） */
export function importFile(ed: Editor, text: string): { ok: true } | { ok: false; error: string } {
  if (ed.stroke.active) ed.stroke.cancel()
  const result = decodeProject(text)
  if (!result.ok) {
    setUi({ message: `导入失败：${result.error}` })
    return { ok: false, error: result.error }
  }
  applyFile(ed, result.file)
  ed.autosave.notifyChange()
  ed.renderer?.frameModel()
  ed.syncUi()
  setUi({ message: `已导入「${result.file.meta.title}」${styleDowngradeNote(result.downgrade)}` })
  return { ok: true }
}

/** 存档装配（autosave 防抖回调 / 导出的数据源） */
export function buildFile(ed: Editor): ProjectFileV2 {
  return encodeProject({
    volume: ed.volume,
    parts: ed.parts,
    patches: ed.log.patches,
    partCreations: ed.log.partCreations,
    compositions: ed.compositions,
    blockStyle: ed.blockStyle,
    meta: { ...ed.meta, updatedAt: new Date().toISOString() },
  })
}

/** 存档落地（init 恢复 / importFile 成功路径共用） */
export function applyFile(ed: Editor, file: ProjectFileV2): void {
  const loaded = loadProjectFile(file, ed.volume, ed.parts, ed.compositions)
  ed.log.adopt(loaded.patches, loaded.partCreations)
  ed.meta = { ...file.meta }
  ed.blockStyle = file.blockStyle
  ed.selectedPartId = null
  ed.selectedCompositionId = null
  ed.builtinKeys = internBuiltin(ed.volume.palette)
  ed.updateAppearance()
  ed.renderer?.rebuildAll()
}

/**
 * `REQ-068`：回到默认展示件（复用首运行装载路，`REQ-062` 同源）。
 * - 成功：`applyFile(展示件)` = 场景 / 构件 / 组合 / 调色板 / 补丁历史 / 标题**整体换成展示件**；
 *   `applyFile` 内 `log.adopt` 会 `reset` 旧历史 ⇒ **旧项目撤销栈不可达**（撤销退不回旧项目）；
 * - 落盘：`notifyChange + flush` **立即写存档** ⇒ 刷新仍是展示件（不回到原项目）；
 * - 取景：`renderer?.frameModel()`（相机重新对准展示件）；
 * - 失败（取件 / 解码失败 ⇒ `null`）：**场景与存档零修改** + 明确报错，不落空场景、不改建坯料。
 */
export async function resetToShowcase(
  ed: Editor,
  load: typeof loadDefaultShowcase = loadDefaultShowcase,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (ed.stroke.active) ed.stroke.cancel()
  const file = await load()
  if (!file) {
    setUi({ message: '回到默认展示件失败：展示件不可用（取件或解码失败）——场景与存档未改动' })
    return { ok: false, error: '展示件不可用（取件或解码失败）' }
  }
  applyFile(ed, file)
  ed.autosave.notifyChange()
  await ed.autosave.flush()
  ed.renderer?.frameModel()
  ed.syncUi()
  setUi({ message: `已回到默认展示件「${file.meta.title}」` })
  return { ok: true }
}
