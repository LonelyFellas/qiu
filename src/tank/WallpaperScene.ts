interface Bubble {
  x: number
  y: number
  r: number
  vy: number
  phase: number
}

const TAU = Math.PI * 2
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const rand = (a: number, b: number) => a + Math.random() * (b - a)
const hsl = (h: number, s: number, l: number, a = 1) =>
  `hsl(${h.toFixed(1)} ${s.toFixed(1)}% ${l.toFixed(1)}% / ${a})`

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= TAU
  while (a <= -Math.PI) a += TAU
  return a
}

class Fish {
  x = 0
  y = 0
  angle = 0
  speed = 0
  tail = 0
  tx = 0
  ty = 0
  spin = 0
  spinDir: 1 | -1 = 1
  orbitDir: 1 | -1 = Math.random() < 0.5 ? 1 : -1
}

/** 只负责壁纸、水景、鱼的自主游动和鼠标跟随。 */
export class WallpaperScene {
  private ctx: CanvasRenderingContext2D
  private w = 0
  private h = 0
  private t = 0
  private zoom = 1
  private fish = new Fish()
  private pointer = { x: 0, y: 0, at: -99, on: false }
  private bubbles: Bubble[] = []
  private grass: {
    x: number
    far: boolean
    blades: { h: number; w: number; phase: number; hue: number; light: number }[]
  }[] = []
  private stones: { x: number; r: number; hue: number }[] = []
  private sand: { x: number; y: number; r: number; a: number; dark: boolean }[] = []
  private seededAt = 0

  private get floorY() {
    return this.h - 26 * this.zoom
  }

  get fishPos() {
    return { x: this.fish.x, y: this.fish.y, r: 28 * this.zoom }
  }

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('拿不到 2D 画布')
    this.ctx = ctx
    this.resize()
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const rect = this.canvas.getBoundingClientRect()
    this.w = Math.max(1, rect.width)
    this.h = Math.max(1, rect.height)
    this.canvas.width = Math.round(this.w * dpr)
    this.canvas.height = Math.round(this.h * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.zoom = Math.max(1, Math.min(Math.min(this.w / 760, this.h / 560), 2.4))
    if (!this.grass.length || Math.abs(this.w - this.seededAt) > 160) this.reseed()
  }

  setPointer(x: number, y: number) {
    this.pointer = { x, y, at: this.t, on: true }
  }

  clearPointer() {
    this.pointer.on = false
  }

  frame(dt: number) {
    this.t += dt
    this.update(dt)
    this.draw()
  }

  private reseed() {
    this.grass.length = 0
    this.stones.length = 0
    this.sand.length = 0
    this.seededAt = this.w

    const makeGrass = (x: number, far: boolean) => ({
      x,
      far,
      blades: Array.from({ length: Math.round(rand(far ? 2 : 3, far ? 5 : 7)) }, () => ({
        h: rand(far ? 0.08 : 0.14, far ? 0.3 : 0.52) * this.h,
        w: rand(4, 9) * this.zoom,
        phase: rand(0, TAU),
        hue: rand(138, 166),
        light: far ? rand(18, 24) : rand(30, 44),
      })),
    })
    const farCount = Math.max(4, Math.round(this.w / 165))
    const nearCount = Math.max(3, Math.round(this.w / 240))
    for (let i = 0; i < farCount; i++)
      this.grass.push(makeGrass(this.w * ((i + 0.5) / farCount) + rand(-58, 58), true))
    for (let i = 0; i < nearCount; i++)
      this.grass.push(makeGrass(this.w * ((i + 0.5) / nearCount) + rand(-72, 72), false))

    for (let i = 0; i < Math.round(this.w / 78); i++)
      this.stones.push({ x: rand(0, this.w), r: rand(3, 8) * this.zoom, hue: rand(28, 44) })
    for (let i = 0; i < Math.round((this.w * this.h) / 1650); i++)
      this.sand.push({
        x: rand(0, this.w),
        y: rand(2, 34) * this.zoom,
        r: rand(1, 2.2) * this.zoom,
        a: rand(0.06, 0.3),
        dark: Math.random() < 0.5,
      })

    this.fish.x = this.w * 0.5
    this.fish.y = this.h * 0.48
    this.pickTarget()
  }

  private spawnBubble(x = rand(this.w * 0.08, this.w * 0.92), y = this.h + rand(0, 20)) {
    this.bubbles.push({
      x,
      y,
      r: rand(1.2, 3.8) * this.zoom,
      vy: rand(18, 38) * this.zoom,
      phase: rand(0, TAU),
    })
  }

  private pickTarget() {
    this.fish.tx = rand(this.w * 0.12, this.w * 0.88)
    this.fish.ty = rand(this.h * 0.14, this.floorY - 30)
  }

  private update(dt: number) {
    if (Math.random() < dt * 1.2 * this.zoom) this.spawnBubble()
    for (const bubble of this.bubbles) {
      bubble.y -= bubble.vy * dt
      bubble.phase += dt * 2.4
      bubble.x += Math.sin(bubble.phase) * 8 * dt
    }
    this.bubbles = this.bubbles.filter((bubble) => bubble.y > -12)
    this.swim(dt)
  }

  private swim(dt: number) {
    const fish = this.fish
    let curious = false
    if (this.pointer.on && this.t - this.pointer.at < 2.6) {
      const px = this.pointer.x
      const py = Math.min(this.pointer.y, this.floorY - 30)
      const radius = 74 * this.zoom
      const bearing = Math.atan2(fish.y - py, fish.x - px)
      const ahead = bearing + fish.orbitDir * 0.8
      fish.tx = px + Math.cos(ahead) * radius
      fish.ty = py + Math.sin(ahead) * radius * 0.62
      curious = true

      if (Math.random() < dt * 0.06) fish.orbitDir = fish.orbitDir === 1 ? -1 : 1
      if (Math.random() < dt * 0.35) this.spawnBubble(fish.x, fish.y - 8 * this.zoom)
    }

    const dx = fish.tx - fish.x
    const dy = fish.ty - fish.y
    if (!curious && Math.hypot(dx, dy) < 26) this.pickTarget()

    const targetSpeed = (curious ? 78 : 58) * this.zoom
    fish.speed = lerp(fish.speed, targetSpeed, Math.min(1, dt * 2.2))
    const desired = Math.atan2(dy, dx)
    fish.angle += wrapAngle(desired - fish.angle) * Math.min(1, dt * (curious ? 4.6 : 3.4))

    if (!curious && fish.spin <= 0 && Math.random() < dt * 0.12) {
      fish.spin = 1.1
      fish.spinDir = Math.random() < 0.5 ? 1 : -1
    }
    if (fish.spin > 0) {
      fish.spin -= dt
      fish.angle += dt * 5.2 * fish.spinDir
    }

    fish.x += Math.cos(fish.angle) * fish.speed * dt
    fish.y += Math.sin(fish.angle) * fish.speed * dt

    const along = 92 * 0.8 * this.zoom
    const across = 23 * 1.75 * this.zoom
    const cos = Math.abs(Math.cos(fish.angle))
    const sin = Math.abs(Math.sin(fish.angle))
    const padX = Math.max(34, cos * along + sin * across)
    const padY = Math.max(34, sin * along + cos * across)
    const floor = this.floorY - padY

    if (fish.y < padY || fish.y > floor) {
      fish.y = Math.max(padY, Math.min(floor, fish.y))
      if (!curious) this.pickTarget()
    }

    const outsideVisible = fish.x < padX || fish.x > this.w - padX
    if (curious) {
      const outside = 92 * 2 * this.zoom
      if (fish.x < -outside || fish.x > this.w + outside) {
        fish.x = Math.max(-outside, Math.min(this.w + outside, fish.x))
        fish.orbitDir = fish.orbitDir === 1 ? -1 : 1
      }
    } else if (outsideVisible) {
      fish.tx = fish.x < padX ? padX + along * 0.45 : this.w - padX - along * 0.45
      fish.ty = Math.max(padY, Math.min(floor, fish.y))
    }

    fish.tail += dt * (2.6 + (fish.speed / 40) * 5)
  }

  private draw() {
    const { ctx, w, h } = this
    ctx.clearRect(0, 0, w, h)
    this.drawWater()
    this.drawSurface()
    this.drawLightShafts()
    this.drawCaustics()
    this.drawFloor()
    this.drawGrass()
    this.drawFish()
    this.drawBubbles()
    this.drawGlass()
  }

  private drawWater() {
    const { ctx, w, h } = this
    const gradient = ctx.createLinearGradient(0, 0, 0, h)
    gradient.addColorStop(0, 'hsl(187 62% 55%)')
    gradient.addColorStop(0.38, 'hsl(193 58% 42%)')
    gradient.addColorStop(1, 'hsl(205 64% 22%)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, w, h)
  }

  private drawSurface() {
    const { ctx, w } = this
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (let layer = 0; layer < 2; layer++) {
      ctx.strokeStyle = `rgba(210,248,255,${0.13 - layer * 0.05})`
      ctx.lineWidth = 2 - layer * 0.6
      ctx.beginPath()
      for (let x = 0; x <= w; x += 8) {
        const y = 6 + layer * 5 + Math.sin(x * 0.026 + this.t * 1.3 + layer) * 3
          + Math.sin(x * 0.011 - this.t * 0.8) * 2
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    ctx.restore()
  }

  private drawLightShafts() {
    const { ctx, w, h } = this
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < 5; i++) {
      const x = w * (0.12 + i * 0.21) + Math.sin(this.t * 0.18 + i) * 28
      const width = w * (0.08 + (i % 2) * 0.035)
      const gradient = ctx.createLinearGradient(x, 0, x + width * 0.4, h * 0.9)
      gradient.addColorStop(0, 'rgba(220,255,248,0.2)')
      gradient.addColorStop(1, 'rgba(180,245,245,0)')
      ctx.fillStyle = gradient
      ctx.beginPath()
      ctx.moveTo(x - width * 0.45, 0)
      ctx.lineTo(x + width * 0.45, 0)
      ctx.lineTo(x + width * 1.1, h)
      ctx.lineTo(x - width * 0.2, h)
      ctx.closePath()
      ctx.fill()
    }
    ctx.restore()
  }

  private drawCaustics() {
    const { ctx, w, h } = this
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.strokeStyle = 'rgba(180,248,245,0.12)'
    ctx.lineWidth = 1.4
    for (let row = 0; row < 6; row++) {
      const y = h * (0.12 + row * 0.14)
      ctx.beginPath()
      for (let x = 0; x <= w; x += 28) {
        const wave = Math.sin(x * 0.012 + this.t * 0.42 + row * 1.7) * 16
          + Math.sin(x * 0.005 - this.t * 0.3) * 9
        x === 0 ? ctx.moveTo(x, y + wave) : ctx.lineTo(x, y + wave)
      }
      ctx.stroke()
    }
    ctx.restore()
  }

  private drawFloor() {
    const { ctx, w, h } = this
    const base = this.floorY
    const gradient = ctx.createLinearGradient(0, base - 18 * this.zoom, 0, h)
    gradient.addColorStop(0, 'hsl(40 42% 70%)')
    gradient.addColorStop(0.3, 'hsl(36 38% 56%)')
    gradient.addColorStop(1, 'hsl(28 26% 34%)')
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.moveTo(0, base)
    for (let x = 0; x <= w; x += 18) {
      ctx.lineTo(x, base + Math.sin(x * 0.018) * 5 * this.zoom + Math.sin(x * 0.043) * 2)
    }
    ctx.lineTo(w, h)
    ctx.lineTo(0, h)
    ctx.closePath()
    ctx.fill()

    for (const grain of this.sand) {
      ctx.fillStyle = grain.dark
        ? `rgba(80,58,34,${grain.a})`
        : `rgba(255,240,190,${grain.a})`
      ctx.beginPath()
      ctx.arc(grain.x, base + grain.y, grain.r, 0, TAU)
      ctx.fill()
    }
    for (const stone of this.stones) {
      ctx.fillStyle = hsl(stone.hue, 14, 36)
      ctx.beginPath()
      ctx.ellipse(stone.x, base + 3, stone.r * 1.35, stone.r, 0, Math.PI, TAU)
      ctx.fill()
    }
  }

  private drawGrass() {
    const { ctx } = this
    const base = this.floorY + 8
    for (const cluster of this.grass) {
      ctx.save()
      if (cluster.far) ctx.globalAlpha = 0.45
      cluster.blades.forEach((blade, index) => {
        const spread = (index - (cluster.blades.length - 1) / 2) * 7
        const sway = Math.sin(this.t * 0.9 + blade.phase) * (cluster.far ? 8 : 15)
        const x = cluster.x + spread
        const tipX = x + sway + spread * 0.5
        const hue = cluster.far ? blade.hue + 26 : blade.hue
        const saturation = cluster.far ? 30 : 48
        const light = cluster.far ? blade.light * 1.5 + 12 : blade.light
        const gradient = ctx.createLinearGradient(x, base, tipX, base - blade.h)
        gradient.addColorStop(0, hsl(hue - 8, saturation * 0.96, light * 0.62))
        gradient.addColorStop(0.55, hsl(hue, saturation, light))
        gradient.addColorStop(1, hsl(hue + 14, saturation * 1.12, light * 1.35))
        ctx.fillStyle = gradient
        ctx.beginPath()
        ctx.moveTo(x - blade.w / 2, base)
        ctx.quadraticCurveTo(x - blade.w * 0.4 + sway * 0.35, base - blade.h * 0.55, tipX, base - blade.h)
        ctx.quadraticCurveTo(x + blade.w * 0.6 + sway * 0.35, base - blade.h * 0.5, x + blade.w / 2, base)
        ctx.closePath()
        ctx.fill()
      })
      ctx.restore()
    }
  }

  private drawBubbles() {
    const { ctx } = this
    for (const bubble of this.bubbles) {
      ctx.beginPath()
      ctx.arc(bubble.x, bubble.y, bubble.r, 0, TAU)
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.fillStyle = 'rgba(255,255,255,0.14)'
      ctx.fill()
    }
  }

  private drawGlass() {
    const { ctx, w, h } = this
    const gradient = ctx.createRadialGradient(
      w / 2, h / 2, Math.min(w, h) * 0.3,
      w / 2, h / 2, Math.max(w, h) * 0.72,
    )
    gradient.addColorStop(0, 'rgba(0,0,0,0)')
    gradient.addColorStop(1, 'rgba(4,26,40,0.42)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = 'rgba(255,255,255,0.05)'
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(w * 0.42, 0)
    ctx.lineTo(0, h * 0.5)
    ctx.closePath()
    ctx.fill()
  }

  private drawFish() {
    const { ctx } = this
    const fish = this.fish
    const length = 92 * this.zoom
    const height = 23 * this.zoom
    const wave = (u: number) => Math.sin(fish.tail - u * 2.7) * height * 0.34 * u * u
    const halfHeight = (u: number) =>
      u < 0.28
        ? height * (0.3 + 0.7 * (u / 0.28) ** 0.58)
        : height * (1 - 0.84 * ((u - 0.28) / 0.72) ** 1.35)
    const px = (u: number) => length * (0.52 - u)
    const py = (u: number) => wave(u)

    ctx.save()
    ctx.translate(fish.x, fish.y)
    ctx.rotate(fish.angle)
    if (Math.abs(wrapAngle(fish.angle)) > Math.PI / 2) ctx.scale(1, -1)

    const tailX = px(1)
    const tailY = py(1)
    const fin = ctx.createLinearGradient(0, -height * 1.7, 0, height * 1.7)
    fin.addColorStop(0, hsl(38, 70, 82, 0.82))
    fin.addColorStop(0.52, hsl(34, 82, 72, 0.68))
    fin.addColorStop(1, hsl(181, 38, 78, 0.38))
    const finLine = hsl(24, 70, 48, 0.5)

    const spread = height * 1.5
    const back = tailX - length * 0.3
    const swing = wave(1.32)
    ctx.fillStyle = fin
    ctx.beginPath()
    ctx.moveTo(tailX, tailY)
    ctx.quadraticCurveTo(back + length * 0.1, tailY + swing * 0.5 - spread * 0.4, back, tailY + swing - spread)
    ctx.quadraticCurveTo(tailX - length * 0.14, tailY + swing * 0.4, tailX, tailY)
    ctx.quadraticCurveTo(tailX - length * 0.14, tailY + swing * 0.4, back, tailY + swing + spread)
    ctx.quadraticCurveTo(back + length * 0.1, tailY + swing * 0.5 + spread * 0.4, tailX, tailY)
    ctx.fill()
    ctx.strokeStyle = finLine
    ctx.lineWidth = 0.9
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath()
      ctx.moveTo(tailX, tailY)
      ctx.quadraticCurveTo(
        tailX - length * 0.16,
        tailY + swing * 0.5 + (i * spread) / 4.4,
        back + length * 0.02,
        tailY + swing + (i * spread) / 3.1,
      )
      ctx.stroke()
    }

    ctx.fillStyle = fin
    ctx.beginPath()
    ctx.moveTo(px(0.24), py(0.24) - halfHeight(0.24) * 0.92)
    ctx.quadraticCurveTo(px(0.34), py(0.34) - height * 1.62, px(0.5), py(0.5) - halfHeight(0.5) * 0.94)
    ctx.quadraticCurveTo(px(0.4), py(0.4) - halfHeight(0.4) * 1.1, px(0.24), py(0.24) - halfHeight(0.24) * 0.92)
    ctx.fill()

    const body = new Path2D()
    body.moveTo(px(0), py(0))
    for (let u = 0; u <= 1.0001; u += 0.05) body.lineTo(px(u), py(u) - halfHeight(u))
    for (let u = 1; u >= -0.0001; u -= 0.05) body.lineTo(px(u), py(u) + halfHeight(u))
    body.closePath()

    const bodyGradient = ctx.createLinearGradient(0, -height, 0, height)
    bodyGradient.addColorStop(0, hsl(18, 82, 36))
    bodyGradient.addColorStop(0.2, hsl(26, 88, 52))
    bodyGradient.addColorStop(0.56, hsl(33, 88, 62))
    bodyGradient.addColorStop(0.82, hsl(41, 66, 76))
    bodyGradient.addColorStop(1, hsl(181, 34, 75))
    ctx.fillStyle = bodyGradient
    ctx.fill(body)
    ctx.strokeStyle = hsl(14, 60, 30, 0.58)
    ctx.lineWidth = Math.max(0.8, 1.15 * this.zoom)
    ctx.stroke(body)

    ctx.save()
    ctx.clip(body)
    const shine = ctx.createRadialGradient(
      length * 0.17, -height * 0.72, 0,
      length * 0.08, -height * 0.28, length * 0.62,
    )
    shine.addColorStop(0, hsl(44, 40, 92, 0.56))
    shine.addColorStop(0.42, hsl(38, 55, 82, 0.12))
    shine.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = shine
    ctx.fill(body)

    ctx.strokeStyle = hsl(14, 58, 35, 0.14)
    ctx.lineWidth = Math.max(0.55, 0.75 * this.zoom)
    for (let row = 0; row < 2; row++) {
      for (let u = 0.3 + row * 0.06; u < 0.87; u += 0.14) {
        const cy = py(u) + (row - 0.25) * height * 0.36
        ctx.beginPath()
        ctx.arc(px(u), cy, height * 0.16, Math.PI * 0.14, Math.PI * 0.86)
        ctx.stroke()
      }
    }
    ctx.strokeStyle = hsl(18, 62, 32, 0.5)
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.moveTo(px(0.17), py(0.17) - halfHeight(0.17) * 0.85)
    ctx.quadraticCurveTo(px(0.13), py(0.15), px(0.19), py(0.19) + halfHeight(0.19) * 0.8)
    ctx.stroke()
    ctx.restore()

    const finX = px(0.26)
    const finY = py(0.26) + halfHeight(0.26) * 0.5
    ctx.save()
    ctx.translate(finX, finY)
    ctx.rotate(0.44 - Math.sin(fish.tail) * 0.3)
    ctx.fillStyle = fin
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.quadraticCurveTo(length * 0.16, height * 0.02, length * 0.19, height * 0.3)
    ctx.quadraticCurveTo(length * 0.08, height * 0.25, 0, 0)
    ctx.fill()
    ctx.restore()

    ctx.strokeStyle = hsl(14, 58, 28, 0.75)
    ctx.lineWidth = 1.3
    ctx.beginPath()
    ctx.moveTo(px(0.005), py(0) + height * 0.03)
    ctx.quadraticCurveTo(px(0.04), py(0.04) + height * 0.14, px(0.075), py(0.07) + height * 0.1)
    ctx.stroke()

    const eyeX = px(0.115)
    const eyeY = py(0.115) - height * 0.2
    const eyeR = 4.35 * this.zoom
    ctx.fillStyle = hsl(14, 55, 42, 0.72)
    ctx.beginPath()
    ctx.arc(eyeX, eyeY, eyeR * 1.34, 0, TAU)
    ctx.fill()
    ctx.fillStyle = '#fff9e9'
    ctx.beginPath()
    ctx.arc(eyeX, eyeY, eyeR, 0, TAU)
    ctx.fill()
    ctx.fillStyle = '#17242c'
    ctx.beginPath()
    ctx.arc(eyeX + eyeR * 0.12, eyeY, eyeR * 0.62, 0, TAU)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.95)'
    ctx.beginPath()
    ctx.arc(eyeX - eyeR * 0.12, eyeY - eyeR * 0.34, eyeR * 0.23, 0, TAU)
    ctx.fill()
    ctx.restore()
  }
}
