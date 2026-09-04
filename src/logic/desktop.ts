import { invoke } from '@tauri-apps/api/core'
import {
  cursorPosition,
  getCurrentWindow,
} from '@tauri-apps/api/window'

const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/** 隐藏窗口准备完成后，直接把它显示在真正的桌面壁纸层。 */
export async function enterWallpaper(): Promise<boolean> {
  if (!inTauri) return false
  try {
    await invoke<string>('enter_wallpaper')
    return true
  } catch {
    return false
  }
}

/** 壁纸窗口鼠标穿透，通过系统坐标让鱼继续跟随光标。 */
export function trackCursor(
  onMove: (x: number, y: number) => void,
  onLeave: () => void,
): () => void {
  if (!inTauri) return () => {}
  const win = getCurrentWindow()
  let origin = { x: 0, y: 0 }
  let dpr = window.devicePixelRatio || 1
  let last = { x: Number.NaN, y: Number.NaN }
  let busy = false
  let alive = true

  void win.outerPosition().then((position) => {
    origin = { x: position.x, y: position.y }
  })
  void win.scaleFactor().then((factor) => {
    dpr = factor
  })

  const id = window.setInterval(async () => {
    if (busy || !alive) return
    busy = true
    try {
      const position = await cursorPosition()
      const x = (position.x - origin.x) / dpr
      const y = (position.y - origin.y) / dpr
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
