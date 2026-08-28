import { useEffect, useRef } from 'react'

const COLORS = ['#be2e24', '#e0685c', '#f5c9a0', '#fbf5e4', '#c9505f']

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  w: number
  h: number
  r: number
  vr: number
  c: string
  alive: boolean
}

interface Props {
  /** 每次自增触发一次纸屑；0 表示还没盖章 */
  trigger: number
}

/** 盖章那一下炸开的纸屑。 */
export default function Confetti({ trigger }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const resize = () => {
      cv.width = window.innerWidth
      cv.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  useEffect(() => {
    if (!trigger) return
    const cv = ref.current
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx) return

    const parts: Particle[] = Array.from({ length: 110 }, () => ({
      x: window.innerWidth / 2 + (Math.random() - 0.5) * 260,
      y: window.innerHeight * 0.34 + (Math.random() - 0.5) * 90,
      vx: (Math.random() - 0.5) * 7,
      vy: Math.random() * -9 - 2,
      w: 4 + Math.random() * 7,
      h: 6 + Math.random() * 10,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.28,
      c: COLORS[(Math.random() * COLORS.length) | 0],
      alive: true,
    }))

    let raf = 0
    const tick = () => {
      ctx.clearRect(0, 0, cv.width, cv.height)
      let alive = 0
      for (const p of parts) {
        p.vy += 0.27
        p.vx *= 0.995
        p.x += p.vx
        p.y += p.vy
        p.r += p.vr
        if (p.y > window.innerHeight + 40) p.alive = false
        if (!p.alive) continue
        alive++
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.r)
        ctx.fillStyle = p.c
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
        ctx.restore()
      }
      if (alive) raf = requestAnimationFrame(tick)
      else ctx.clearRect(0, 0, cv.width, cv.height)
    }
    raf = requestAnimationFrame(tick)

    return () => cancelAnimationFrame(raf)
  }, [trigger])

  return <canvas className="fx" ref={ref} aria-hidden="true" />
}
