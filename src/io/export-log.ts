// r04 T8（§4 件三）：卡死可导出会话事件——导出即完整事件流，离线可 validateLog 校验 + replayView 重放。
// 信封只收非敏感设置字段：apiKey 绝不进返回值（BYOK / REQ-013 / NFR-004 红线；测试断言串内无 key）。
// 层序：io 在下，对 ai 只留 type-only 契约（与 tests/structure.test.ts 的 type-only 豁免同口径）。
import type { AiSettings } from '../ai/settings'
import type { SessionEvent } from '../ai/session-log'
import { downloadJson } from './file-transfer'
import { APP_VERSION } from './version'

/** 会话日志的最小读取面（SessionLog 结构兼容；避免 io 运行期依赖 ai） */
interface SessionLogSource {
  readonly events: readonly SessionEvent[]
}

/**
 * 会话导出格式串（**写侧**）。2026-10-17 品牌改名：`voxel-ai-editor` → `wishvox`。
 * 注：当前**无读侧**（导出是单向的——离线 `validateLog` / `replayView` 只读 `events` 数组），
 * 故无「旧串双读」分支；将来若加导入面，读侧须同时接受旧串 `'voxel-ai-editor.session'`。
 */
export const SESSION_FORMAT = 'wishvox.session'

/** 导出信封（format/version 供格式演进；events = 完整事件流，时间戳自带） */
interface SessionExportEnvelope {
  readonly format: typeof SESSION_FORMAT
  readonly version: 1
  readonly exportedAt: string
  readonly appVersion: string
  readonly settings: {
    readonly presetId: string
    readonly baseUrl: string
    readonly model: string
    readonly oversight: AiSettings['oversight']
    readonly language: AiSettings['language']
  }
  readonly events: readonly SessionEvent[]
}

/** 纯函数：构信封（settings 显式取白名单字段——apiKey 不可能被带上） */
function buildEnvelope(log: SessionLogSource, settings: AiSettings, now: Date): SessionExportEnvelope {
  return {
    format: SESSION_FORMAT,
    version: 1,
    exportedAt: now.toISOString(),
    appVersion: APP_VERSION,
    settings: {
      presetId: settings.presetId,
      baseUrl: settings.baseUrl,
      model: settings.model,
      oversight: settings.oversight,
      language: settings.language,
    },
    events: log.events,
  }
}

/** 导出文本（缩进 2——离线人读 + validateLog / replayView 可校验重放） */
export function sessionExportText(log: SessionLogSource, settings: AiSettings, now: Date = new Date()): string {
  return JSON.stringify(buildEnvelope(log, settings, now), null, 2)
}

/** 下载会话日志（**任何时候可点**：卡死场景 = 先点导出再处理页面） */
export function downloadSessionLog(log: SessionLogSource, settings: AiSettings): void {
  const now = new Date()
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  downloadJson(`voxel-session-${stamp}.json`, sessionExportText(log, settings, now))
}
