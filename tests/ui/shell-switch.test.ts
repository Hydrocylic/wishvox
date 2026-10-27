// S8 · 壳初值与手动选择的持久化：纯函数，不依赖真实浏览器。
// S9b 追加：切壳重挂前，相机机位（position/target/distance）要落在会话 store 里。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { syncCameraReadout } from '../../src/edit/camera-sync'
import { useEditorUi } from '../../src/state/editor-store'
import { initialShell, M1_MIN_WIDTH, persistShell, SHELL_STORAGE_KEY } from '../../src/ui/shell-mode'

afterEach(() => {
  vi.unstubAllGlobals()
  useEditorUi.setState({ cameraPanel: { fov: 60, distance: 0, rotateSpeed: 1, damping: 0.08, target: [0, 0, 0] } })
})

describe('S8 · 壳初值', () => {
  it('无环境信息（无头 / Node）⇒ 浮块：既有测试基线不因默认壳改变', () => {
    expect(initialShell()).toBe('floating')
  })

  it('合法的本机手动选择优先于宽度与指针', () => {
    expect(initialShell({ stored: 'm1', innerWidth: 375, coarsePointer: true })).toBe('m1')
    expect(initialShell({ stored: 'floating', innerWidth: 1440 })).toBe('floating')
  })

  it('非法 / 空存储被忽略，回自动初值', () => {
    expect(initialShell({ stored: 'nope', innerWidth: 1440 })).toBe('m1')
    expect(initialShell({ stored: null, innerWidth: 1440 })).toBe('m1')
  })

  it('coarse 指针 ⇒ 浮块（即使宽屏）', () => {
    expect(initialShell({ coarsePointer: true, innerWidth: 1440 })).toBe('floating')
  })

  it(`宽度阈值：< ${M1_MIN_WIDTH} 浮块 · ≥ ${M1_MIN_WIDTH} 三栏`, () => {
    expect(initialShell({ innerWidth: M1_MIN_WIDTH - 1 })).toBe('floating')
    expect(initialShell({ innerWidth: M1_MIN_WIDTH })).toBe('m1')
  })
})

describe('S8 · 手动选择持久化', () => {
  it('写入成功 ⇒ 返回 true 且值可读回', () => {
    const map = new Map<string, string>()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => void map.set(k, v),
      },
    })
    expect(persistShell('m1')).toBe(true)
    expect(map.get(SHELL_STORAGE_KEY)).toBe('m1')
  })

  it('存储抛错（隐私模式）⇒ 静默返回 false，不阻断切壳', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => null,
        setItem: () => {
          throw new Error('denied')
        },
      },
    })
    expect(persistShell('floating')).toBe(false)
  })

  it('无 window（Node）⇒ 返回 false', () => {
    expect(persistShell('m1')).toBe(false)
  })
})

describe('S9b · 切壳保留机位', () => {
  it('相机读回把 position / target / distance 存进会话 store（重挂时据此恢复）', () => {
    syncCameraReadout({ target: [1, 2, 3], distance: 9, fov: 60, rotateSpeed: 1, damping: 0.08, position: [4, 5, 6] })
    const cam = useEditorUi.getState().cameraPanel
    expect(cam.position).toEqual([4, 5, 6])
    expect(cam.target).toEqual([1, 2, 3])
    expect(cam.distance).toBe(9)
  })

  it('初始（未读回）没有 position ⇒ 首帧允许 frameModel', () => {
    expect(useEditorUi.getState().cameraPanel.position).toBeUndefined()
  })
})
