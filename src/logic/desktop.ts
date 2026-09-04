import { invoke } from '@tauri-apps/api/core'
import { cursorPosition } from '@tauri-apps/api/window'

const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export interface ScreenConfig {
  label: string
  x: number
  y: number
  width: number
  height: number
  scaleFactor: number
  primaryScaleFactor: number
}

/** 隐藏窗口准备完成后，直接把它显示在真正的桌面壁纸层。 */
export async function enterWallpaper(): Promise<ScreenConfig | null> {
  if (!inTauri) return null
  try {
    return await invoke<ScreenConfig>('enter_wallpaper')
  } catch {
    return null
  }
}

export function setWorldPointer(x: number, y: number): void {
  if (inTauri) void invoke('set_world_pointer', { x, y })
}

/** 壁纸窗口鼠标穿透，通过系统坐标让鱼继续跟随光标。 */
export function trackCursor(
  screen: ScreenConfig,
  onMove: (x: number, y: number) => void,
  onLeave: () => void,
): () => void {
  if (!inTauri) return () => {}
  let last = { x: Number.NaN, y: Number.NaN }
  let busy = false
  let alive = true

  const id = window.setInterval(async () => {
    if (busy || !alive) return
    busy = true
    try {
      const position = await cursorPosition()
      // macOS 的全局光标坐标由 Tao 按主屏缩放输出；统一还原为桌面逻辑坐标。
      const x = position.x / screen.primaryScaleFactor - screen.x
      const y = position.y / screen.primaryScaleFactor - screen.y
      if (x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight) {
        if (!Number.isFinite(last.x) || Math.hypot(x - last.x, y - last.y) >= 0.75) {
          last = { x, y }
          onMove(x, y)
        }
      } else if (Number.isFinite(last.x)) {
        last = { x: Number.NaN, y: Number.NaN }
        onLeave()
      }
    } catch {
      // 下一次轮询继续尝试，不让光标读取失败影响壁纸动画。
    } finally {
      busy = false
    }
  }, 70)

  return () => {
    alive = false
    window.clearInterval(id)
  }
}
