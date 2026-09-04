import { useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'

import { enterWallpaper, setWorldPointer, trackCursor } from './logic/desktop'
import { WallpaperScene, type FishFrame } from './tank/WallpaperScene'

const AMBIENT_LINES = [
  '你来啦',
  '我在这儿',
  '今天的水很安静',
  '刚才好像看见你了',
  '（吐了个泡泡）',
  '要一起待一会儿吗',
]
const DWELL_MS = 700
const BUBBLE_MS = 3800
const BUBBLE_COOLDOWN_MS = 15_000

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y)

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<WallpaperScene | null>(null)
  const pointerRef = useRef({ x: Number.NaN, y: Number.NaN })
  const dwellTimer = useRef(0)
  const bubbleTimer = useRef(0)
  const lastBubbleAt = useRef(Number.NEGATIVE_INFINITY)
  const [say, setSay] = useState('')

  const speak = () => {
    const now = performance.now()
    if (now - lastBubbleAt.current < BUBBLE_COOLDOWN_MS) return
    lastBubbleAt.current = now
    window.clearTimeout(bubbleTimer.current)
    setSay(AMBIENT_LINES[Math.floor(Math.random() * AMBIENT_LINES.length)])
    bubbleTimer.current = window.setTimeout(() => setSay(''), BUBBLE_MS)
  }

  const clearPointer = () => {
    window.clearTimeout(dwellTimer.current)
    pointerRef.current = { x: Number.NaN, y: Number.NaN }
    setSay('')
  }

  const followPointer = (x: number, y: number) => {
    const scene = sceneRef.current
    if (!scene) return
    const pointer = { x, y }
    pointerRef.current = pointer
    window.clearTimeout(dwellTimer.current)

    if (!scene.fishPos.visible || distance(pointer, scene.fishPos) > 160) return
    dwellTimer.current = window.setTimeout(() => {
      const latest = pointerRef.current
      if (!Number.isFinite(latest.x)) return
      if (distance(latest, pointer) > 12) return
      if (distance(latest, scene.fishPos) > 180) return
      speak()
    }, DWELL_MS)
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const scene = new WallpaperScene(canvas)
    sceneRef.current = scene

    const resize = () => scene.resize()
    window.addEventListener('resize', resize)
    scene.frame(0)

    let raf = 0
    let last = performance.now()
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      scene.frame(dt)

      const bubble = bubbleRef.current
      if (bubble) {
        const { x, y, r, visible } = scene.fishPos
        const bubbleX = Math.max(118, Math.min(canvas.clientWidth - 118, x))
        const bubbleY = Math.max(58, y - r - 12)
        bubble.style.visibility = !visible || x < 118 || x > canvas.clientWidth - 118
          ? 'hidden'
          : 'visible'
        bubble.style.transform = `translate(${bubbleX}px, ${bubbleY}px) translate(-50%, -100%)`
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      sceneRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return
    let alive = true
    let stopTracking = () => {}
    let stopListening = () => {}
    void (async () => {
      const screen = await enterWallpaper()
      if (!alive || !screen) return
      sceneRef.current?.setOrigin(screen.x, screen.y)
      stopListening = await listen<FishFrame>('fish-frame', (event) => {
        sceneRef.current?.setFishFrame(event.payload)
      })
      if (!alive) {
        stopListening()
        return
      }
      stopTracking = trackCursor(
        screen,
        (x, y) => {
          setWorldPointer(screen.x + x, screen.y + y)
          followPointer(x, y)
        },
        clearPointer,
      )
    })()
    return () => {
      alive = false
      stopTracking()
      stopListening()
    }
  }, [])

  useEffect(() => () => {
    window.clearTimeout(dwellTimer.current)
    window.clearTimeout(bubbleTimer.current)
  }, [])

  return (
    <main className="wallpaper">
      <canvas
        ref={canvasRef}
      />
      <div ref={bubbleRef} className={`say ${say ? 'on' : ''}`}>
        {say}
      </div>
    </main>
  )
}
