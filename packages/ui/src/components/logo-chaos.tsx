import { onCleanup, onMount } from "solid-js"

// Fork feature: the JaCode mark ("j" and a bracket, with a cursor block) assembled out of chaos. Five scenes mix the
// Lorenz attractor with curl-noise flow; each mount picks one at random, so the wait looks different every time.
// Everything is drawn on a transparent canvas in the mark's 512 icon space, so it sits on any background.

const STEM = "M210 226 L210 324 C210 364 186 384 150 384"

const BRACKET = "M372 196 C326 206 296 228 296 256 C296 284 326 306 372 316"

const CURSOR = { x: 184, y: 136, size: 52 }

const VIEW = { x: 0, y: 0, size: 512 }

const ACCENT = "#2ee6c8"

export const CHAOS_SCENES = ["smoke", "comets", "phase", "ink", "aurora"] as const

// When each scene's mark is fully formed, in ms from the start of its loop.
const LANDS: Record<(typeof CHAOS_SCENES)[number], number> = {
  smoke: 5280,
  comets: 5950,
  phase: 6800,
  ink: 6480,
  aurora: 5580,
}

/**
 * `land` starts the scene late enough that the mark is formed that many ms after mount, for waits too short to
 * watch a whole loop, such as app startup.
 */
export const ChaosMark = (props: { class?: string; scene?: (typeof CHAOS_SCENES)[number]; land?: number }) => {
  const canvas = document.createElement("canvas")
  canvas.setAttribute("data-component", "logo-chaos")
  canvas.setAttribute("aria-hidden", "true")
  canvas.style.aspectRatio = "1"
  // Fade the canvas out toward its edges so streaks dissolve into the page instead of stopping at a square.
  canvas.style.maskImage = "radial-gradient(closest-side, #000 58%, transparent 100%)"

  if (props.class) canvas.className = props.class

  onMount(() => {
    const stage = createStage(canvas)
    const name = props.scene ?? CHAOS_SCENES[Math.floor(Math.random() * CHAOS_SCENES.length)]
    const render = SCENES[name](stage)
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)")

    if (motion.matches) {
      drawMark(stage, 1, 1)

      return
    }

    const start = performance.now() - (props.land === undefined ? 0 : Math.max(0, LANDS[name] - props.land))
    const loop = { handle: 0 }

    const frame = (now: number) => {
      render(now - start)
      loop.handle = requestAnimationFrame(frame)
    }

    loop.handle = requestAnimationFrame(frame)
    onCleanup(() => cancelAnimationFrame(loop.handle))
  })

  return canvas
}

/* ---------- stage ---------- */

type Stage = ReturnType<typeof createStage>

function createStage(canvas: HTMLCanvasElement) {
  const css = canvas.clientWidth || 240
  const ratio = Math.min(2, window.devicePixelRatio || 1)
  canvas.width = canvas.height = Math.round(css * ratio)

  const ctx = canvas.getContext("2d")!
  const scale = canvas.width / VIEW.size
  ctx.setTransform(scale, 0, 0, scale, -VIEW.x * scale, -VIEW.y * scale)

  // The theme's strongest icon color is the ink; a dark ink means a light theme, where glow-by-addition washes out.
  const ink = getComputedStyle(canvas).getPropertyValue("--icon-strong-base").trim() || "#f2f4f8"
  const dark = luminance(ink) > 0.5
  const frames = { count: 0 }

  return {
    ctx,
    ink,
    dark,
    // Trails: fade what is drawn toward transparent, so the page background shows through.
    fade(alpha: number) {
      ctx.globalCompositeOperation = "destination-out"
      ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`
      ctx.fillRect(VIEW.x, VIEW.y, VIEW.size, VIEW.size)
      ctx.globalCompositeOperation = dark ? "lighter" : "source-over"
      frames.count += 1

      if (frames.count % 20 === 0) clearResidue(canvas, ctx)
    },
    tone(hue: number, saturation: number, lightness: number, alpha = 1) {
      return `hsla(${hue}, ${saturation}%, ${dark ? lightness : lightness * 0.5}%, ${alpha})`
    },
  }
}

// A partial fade rounds faint pixels back up in 8-bit alpha, so old trails never quite vanish and leave a dim box.
// Every so often, drop the pixels that are nearly transparent.
function clearResidue(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = image.data

  // A plain loop: this walks every pixel of the canvas, and an array per call would churn the garbage collector.
  for (let index = 3; index < data.length; index += 4) if (data[index] < 14) data[index] = 0
  ctx.putImageData(image, 0, 0)
}

function luminance(color: string) {
  const probe = document.createElement("canvas").getContext("2d")!
  probe.fillStyle = color
  probe.fillRect(0, 0, 1, 1)
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data

  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

const stemPath = () => new Path2D(STEM)

const bracketPath = () => new Path2D(BRACKET)

function drawMark(stage: Stage, alpha: number, blink: number) {
  if (alpha <= 0) return
  const ctx = stage.ctx
  ctx.save()
  ctx.globalCompositeOperation = "source-over"
  ctx.globalAlpha = alpha
  ctx.shadowColor = "rgba(46, 230, 200, 0.5)"
  ctx.shadowBlur = stage.dark ? 28 : 10
  ctx.strokeStyle = stage.ink
  ctx.lineWidth = 36
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  ctx.stroke(stemPath())
  ctx.stroke(bracketPath())
  ctx.globalAlpha = alpha * blink
  ctx.fillStyle = ACCENT
  ctx.beginPath()
  ctx.roundRect(CURSOR.x, CURSOR.y, CURSOR.size, CURSOR.size, 10)
  ctx.fill()
  ctx.restore()
}

const blinkAt = (time: number) => (Math.floor(time / 530) % 2 ? 0.25 : 1)

function segment(stage: Stage, from: Point, to: Point, color: string, width: number) {
  const ctx = stage.ctx
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineCap = "round"
  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  ctx.lineTo(to.x, to.y)
  ctx.stroke()
}

/* ---------- math ---------- */

type Point = { x: number; y: number }

// A trail with no previous point yet.
const unset = (): Point | undefined => undefined

type State = [number, number, number]

// Deterministic randomness, so a scene draws the same way each time it plays.
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  const a = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  const b = (a + Math.imul(a ^ (a >>> 7), 61 | a)) ^ a

  return ((b ^ (b >>> 14)) >>> 0) / 4294967296
}

const clamp = (value: number) => Math.min(1, Math.max(0, value))

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

const smooth = (t: number) => clamp(t) * clamp(t) * (3 - 2 * clamp(t))

// 0 before a, eases to 1 by b, holds until c, eases back to 0 by d.
const envelope = (t: number, a: number, b: number, c: number, d: number) =>
  t < a ? 0 : t < b ? smooth((t - a) / (b - a)) : t < c ? 1 : 1 - smooth((t - c) / (d - c))

// The Lorenz system (σ = 10, ρ = 28, β = 8/3), integrated with fourth-order Runge-Kutta.
const lorenz = (s: State): State => [10 * (s[1] - s[0]), s[0] * (28 - s[2]) - s[1], s[0] * s[1] - (8 / 3) * s[2]]

const step = (s: State, h: number, k: State): State => [s[0] + h * k[0], s[1] + h * k[1], s[2] + h * k[2]]

function rk4(s: State, h: number): State {
  const k1 = lorenz(s)
  const k2 = lorenz(step(s, h / 2, k1))
  const k3 = lorenz(step(s, h / 2, k2))
  const k4 = lorenz(step(s, h, k3))

  return [
    s[0] + (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
    s[1] + (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
    s[2] + (h / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]),
  ]
}

// A state already on the attractor: integrate a random start past the transient.
function onAttractor(random: () => number) {
  const steps = 300 + Math.floor(random() * 1500)

  return Array.from({ length: steps }).reduce<State>(
    (s) => rk4(s, 0.008),
    [random() * 2 - 1, random() * 2 - 1, 20 + random() * 6],
  )
}

// Lorenz space turned by yaw around its vertical axis, then put on screen with perspective.
function project(s: State, yaw: number, scale = 6.2) {
  const z = s[2] - 25
  const across = s[0] * Math.cos(yaw) - s[1] * Math.sin(yaw)
  const depth = s[0] * Math.sin(yaw) + s[1] * Math.cos(yaw)
  const f = 90 / (90 + depth)

  return { x: 256 + across * scale * f, y: 262 - z * scale * 0.9 * f, f }
}

// Improved Perlin noise in 3D, and the curl of a 2D slice of it: a divergence-free flow that swirls like smoke.
function perlin(seed: number) {
  const random = rng(seed)
  const shuffled = Array.from({ length: 256 }, (_, i) => i)
  // Fisher-Yates, from the last index down.
  Array.from({ length: 255 }, (_, n) => 255 - n).forEach((i) => {
    const j = Math.floor(random() * (i + 1))

    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  })
  const p = [...shuffled, ...shuffled]
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)

  const grad = (hash: number, x: number, y: number, z: number) => {
    const h = hash & 15
    const u = h < 8 ? x : y
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z

    return (h & 1 ? -u : u) + (h & 2 ? -v : v)
  }

  const noise = (x: number, y: number, z: number) => {
    const X = Math.floor(x) & 255
    const Y = Math.floor(y) & 255
    const Z = Math.floor(z) & 255
    const xf = x - Math.floor(x)
    const yf = y - Math.floor(y)
    const zf = z - Math.floor(z)
    const u = fade(xf)
    const v = fade(yf)
    const w = fade(zf)
    const A = p[X] + Y
    const B = p[X + 1] + Y
    const AA = p[A] + Z
    const AB = p[A + 1] + Z
    const BA = p[B] + Z
    const BB = p[B + 1] + Z

    const near = lerp(
      lerp(grad(p[AA], xf, yf, zf), grad(p[BA], xf - 1, yf, zf), u),
      lerp(grad(p[AB], xf, yf - 1, zf), grad(p[BB], xf - 1, yf - 1, zf), u),
      v,
    )

    const far = lerp(
      lerp(grad(p[AA + 1], xf, yf, zf - 1), grad(p[BA + 1], xf - 1, yf, zf - 1), u),
      lerp(grad(p[AB + 1], xf, yf - 1, zf - 1), grad(p[BB + 1], xf - 1, yf - 1, zf - 1), u),
      v,
    )

    return lerp(near, far, w)
  }

  const curl = (x: number, y: number, t: number, s = 0.011) => {
    const e = 0.6
    const psi = (px: number, py: number) => noise(px * s, py * s, t)

    return { x: (psi(x, y + e) - psi(x, y - e)) / (2 * e), y: -(psi(x + e, y) - psi(x - e, y)) / (2 * e) }
  }

  return { noise, curl }
}

// Points spread over the filled mark: across each stroke's width, and inside the cursor block.
function markPoints(count: number, random: () => number) {
  const holder = document.createElementNS("http://www.w3.org/2000/svg", "svg")
  holder.style.position = "absolute"
  document.body.appendChild(holder)

  const paths = [STEM, BRACKET].map((d) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
    path.setAttribute("d", d)
    holder.appendChild(path)

    return { path, length: path.getTotalLength() }
  })

  const total = paths[0].length + paths[1].length

  const points = Array.from({ length: count }, () => {
    if (random() < 0.12)
      return {
        x: CURSOR.x + 4 + random() * (CURSOR.size - 8),
        y: CURSOR.y + 4 + random() * (CURSOR.size - 8),
        cursor: true,
      }
    const pick = random() * total
    const stroke = pick < paths[0].length ? paths[0] : paths[1]
    const at = random() * stroke.length
    const before = stroke.path.getPointAtLength(Math.max(0, at - 1))
    const after = stroke.path.getPointAtLength(Math.min(stroke.length, at + 1))
    const point = stroke.path.getPointAtLength(at)
    const tx = after.x - before.x
    const ty = after.y - before.y
    const n = Math.hypot(tx, ty) || 1
    const off = (random() - 0.5) * 30

    return { x: point.x - (ty / n) * off, y: point.y + (tx / n) * off, cursor: false }
  })

  holder.remove()

  return points
}

function clock() {
  const state = { last: 0 }

  return (time: number) => {
    const dt = Math.min(0.033, (time - state.last) / 1000 || 0.016)
    state.last = time

    return dt
  }
}

/* ---------- scenes ---------- */

const SCENES: Record<(typeof CHAOS_SCENES)[number], (stage: Stage) => (time: number) => void> = {
  // Points ride the attractor while curl noise blows them sideways: a butterfly drawn in drifting smoke.
  smoke(stage) {
    const random = rng(101)
    const field = perlin(3)
    const tick = clock()

    const parts = markPoints(520, random).map((target) => ({
      target,
      s: onAttractor(random),
      dx: 0,
      dy: 0,
      last: unset(),
    }))

    const CYCLE = 8000

    return (time) => {
      const dt = tick(time)
      const t = (time % CYCLE) / CYCLE
      const k = envelope(t, 0.5, 0.66, 0.86, 1)
      stage.fade(k > 0.9 ? 0.35 : 0.075)
      parts.forEach((p) => {
        p.s = rk4(p.s, 0.0045)
        const a = project(p.s, time / 5200)
        const c = field.curl(a.x + p.dx, a.y + p.dy, time / 4000)
        p.dx = (p.dx + c.x * 2600 * dt) * 0.985
        p.dy = (p.dy + c.y * 2600 * dt) * 0.985
        const next = { x: lerp(a.x + p.dx, p.target.x, k), y: lerp(a.y + p.dy, p.target.y, k) }

        if (p.last) {
          const speed = Math.hypot(next.x - p.last.x, next.y - p.last.y)
          const hue = p.target.cursor && k > 0.5 ? 168 : lerp(170, 265, clamp(speed / 9))
          segment(stage, p.last, next, stage.tone(hue, 85, lerp(62, 92, k), 0.5), lerp(1.6, 3, k))
        }

        p.last = next
      })
      drawMark(stage, smooth((k - 0.85) / 0.15), blinkAt(time))
    }
  },

  // Four leaders fly the attractor in 3D; each drags a swarm through curl noise like a comet's tail.
  comets(stage) {
    const random = rng(202)
    const field = perlin(8)
    const tick = clock()
    const hues = [172, 196, 228, 262]
    const leaders = hues.map((hue) => ({ hue, s: onAttractor(random), at: { x: 256, y: 256, f: 1 } }))

    const parts = markPoints(480, random).map((target, index) => ({
      target,
      leader: leaders[index % leaders.length],
      x: 236 + random() * 40,
      y: 236 + random() * 40,
      vx: 0,
      vy: 0,
      last: unset(),
    }))

    const CYCLE = 8500

    return (time) => {
      const dt = tick(time)
      const t = (time % CYCLE) / CYCLE
      const k = envelope(t, 0.52, 0.7, 0.86, 1)
      leaders.forEach((leader) => {
        leader.s = rk4(leader.s, 0.006)
        leader.at = project(leader.s, time / 3800)
      })
      stage.fade(k > 0.9 ? 0.3 : 0.07)
      parts.forEach((p) => {
        const goal = { x: lerp(p.leader.at.x, p.target.x, k), y: lerp(p.leader.at.y, p.target.y, k) }
        const c = field.curl(p.x, p.y, time / 3000)
        const pull = lerp(26, 160, k)
        const swirl = lerp(52000, 0, k)
        const damp = lerp(0.955, 0.8, k)
        p.vx = (p.vx + ((goal.x - p.x) * pull + c.x * swirl) * dt) * damp
        p.vy = (p.vy + ((goal.y - p.y) * pull + c.y * swirl) * dt) * damp
        p.x += p.vx * dt
        p.y += p.vy * dt
        const next = { x: p.x, y: p.y }

        if (p.last) {
          const hue = k > 0.6 ? (p.target.cursor ? 168 : 205) : p.leader.hue
          segment(stage, p.last, next, stage.tone(hue, 95, lerp(55, 90, k), 0.42), lerp(1.3, 3, k))
        }

        p.last = next
      })

      if (k < 0.5)
        leaders.forEach((leader) => {
          stage.ctx.fillStyle = stage.tone(leader.hue, 100, 85, 0.9 * (1 - k * 2))
          stage.ctx.beginPath()
          stage.ctx.arc(leader.at.x, leader.at.y, 3.4 * leader.at.f, 0, Math.PI * 2)
          stage.ctx.fill()
        })
      drawMark(stage, smooth((k - 0.85) / 0.15), blinkAt(time))
    }
  },

  // Calm smoke heats into the butterfly, crystallizes into the mark, then melts back into smoke.
  phase(stage) {
    const random = rng(303)
    const field = perlin(13)
    const tick = clock()

    const parts = markPoints(560, random).map((target) => ({
      target,
      s: onAttractor(random),
      cx: VIEW.x + random() * VIEW.size,
      cy: VIEW.y + random() * VIEW.size,
      last: unset(),
    }))

    const CYCLE = 10000

    return (time) => {
      const dt = tick(time)
      const t = (time % CYCLE) / CYCLE
      const melt = t > 0.84 ? smooth((t - 0.84) / 0.13) : 0
      const order = melt > 0 ? 0 : envelope(t, 0.22, 0.38, 2, 3)
      const form = envelope(t, 0.56, 0.68, 0.84, 0.97)
      const yaw = 0.4 + Math.sin(time / 4000) * 0.5
      stage.fade(form > 0.9 ? 0.4 : 0.07)
      parts.forEach((p) => {
        p.s = rk4(p.s, 0.004)
        const c = field.curl(p.cx, p.cy, time / 5000)
        p.cx = wrap(p.cx + c.x * 6000 * dt)
        p.cy = wrap(p.cy + c.y * 6000 * dt)
        const a = project(p.s, yaw)
        const from = { x: lerp(p.cx, a.x, order), y: lerp(p.cy, a.y, order) }
        const next = { x: lerp(from.x, p.target.x, form), y: lerp(from.y, p.target.y, form) }

        if (p.last && Math.hypot(next.x - p.last.x, next.y - p.last.y) < 60) {
          const hue = lerp(lerp(178, 285, order), p.target.cursor ? 168 : 205, form)
          segment(stage, p.last, next, stage.tone(hue, 88, lerp(58, 90, form), 0.5), lerp(1.3, 3, form))
        }

        p.last = next
      })
      drawMark(stage, smooth((form - 0.85) / 0.15) * (1 - melt), blinkAt(time))
    }
  },

  // The attractor turns in 3D with depth fog, thickened by noise like ink in water, then flattens into the mark.
  ink(stage) {
    const random = rng(404)
    const field = perlin(21)

    const parts = markPoints(620, random).map((target) => ({
      target,
      s: onAttractor(random),
      seed: random() * 100,
      last: unset(),
    }))

    const CYCLE = 9000

    return (time) => {
      const t = (time % CYCLE) / CYCLE
      const k = envelope(t, 0.55, 0.72, 0.87, 1)
      // The camera spins while in chaos and settles to face the mark.
      const spin = time / 2600
      const yaw = lerp(spin, Math.round(spin / Math.PI) * Math.PI, k)
      stage.fade(k > 0.9 ? 0.35 : 0.1)
      parts.forEach((p) => {
        p.s = rk4(p.s, 0.004)
        const n = field.noise(p.s[0] * 0.08 + p.seed, p.s[2] * 0.08, time / 3000) * 9
        const m = field.noise(p.s[1] * 0.08, p.seed, time / 3000 + 7) * 9
        const a = project([p.s[0] + n, p.s[1] + m, p.s[2] + n * 0.6], yaw, 6.6)
        const fog = clamp((a.f - 0.72) / 0.6)
        const next = { x: lerp(a.x, p.target.x, k), y: lerp(a.y, p.target.y, k) }

        if (p.last && Math.hypot(next.x - p.last.x, next.y - p.last.y) < 50) {
          const hue = lerp(lerp(250, 178, fog), p.target.cursor ? 168 : 210, k)
          const color = stage.tone(hue, 85, lerp(lerp(40, 75, fog), 90, k), lerp(0.18 + fog * 0.5, 0.6, k))
          segment(stage, p.last, next, color, lerp(0.8 + a.f * 1.6, 3, k))
        }

        p.last = next
      })
      drawMark(stage, smooth((k - 0.85) / 0.15), blinkAt(time))
    }
  },

  // Aurora streaks flow through a field the Lorenz system keeps reshaping. The mark is a well in that field:
  // streaks slow down inside it and pile up until it glows into view.
  aurora(stage) {
    const random = rng(505)
    const field = perlin(34)
    const tick = clock()
    const GRID = 90
    const inside = markPoints(900, rng(9))

    const well = Float32Array.from({ length: GRID * GRID }, (_, index) => {
      const x = VIEW.x + ((index % GRID) + 0.5) * (VIEW.size / GRID)
      const y = VIEW.y + (Math.floor(index / GRID) + 0.5) * (VIEW.size / GRID)

      return Math.sqrt(inside.reduce((best, p) => Math.min(best, (p.x - x) ** 2 + (p.y - y) ** 2), Infinity))
    })

    const distance = (x: number, y: number) => {
      const gx = Math.floor(((x - VIEW.x) / VIEW.size) * GRID)
      const gy = Math.floor(((y - VIEW.y) / VIEW.size) * GRID)

      if (gx < 0 || gy < 0 || gx >= GRID || gy >= GRID) return 999

      return well[gy * GRID + gx]
    }

    const spawn = () => ({
      x: VIEW.x + random() * VIEW.size,
      y: VIEW.y + random() * VIEW.size,
      life: 0,
      max: 1.5 + random() * 3,
      last: unset(),
    })

    const parts = Array.from({ length: 1100 }, () => {
      const p = spawn()
      p.life = random() * p.max

      return p
    })

    const driver = { s: onAttractor(random) }
    const CYCLE = 9000

    return (time) => {
      const dt = tick(time)
      const t = (time % CYCLE) / CYCLE
      const trap = envelope(t, 0.35, 0.62, 0.86, 1)
      driver.s = rk4(driver.s, 0.004)
      // The Lorenz state steers the field: where it samples, how fine it is, and which way it leans.
      const offset = driver.s[0] * 0.03
      const scale = 0.008 + (driver.s[2] / 50) * 0.008
      const lean = driver.s[1] * 0.04
      stage.fade(0.06 + trap * 0.06)
      parts.forEach((p, index) => {
        const c = field.curl(p.x, p.y, time / 6000 + offset, scale)
        const d = distance(p.x, p.y)
        const slow = lerp(1, 0.04 + smooth(d / 26) * 0.96, trap)
        p.x += (c.x * 7000 + lean * 60) * dt * slow
        p.y += (c.y * 7000 - 14) * dt * slow
        p.life += dt * lerp(1, 0.35, d < 18 ? trap : 0)
        const outside = p.x < VIEW.x || p.x > VIEW.x + VIEW.size || p.y < VIEW.y || p.y > VIEW.y + VIEW.size

        if (p.life > p.max || outside) {
          parts[index] = spawn()

          return
        }

        const next = { x: p.x, y: p.y }

        if (p.last) {
          const near = trap * (1 - smooth(d / 24))
          const hue = lerp(150 + (p.y - VIEW.y) / 3, 190, near)
          const alpha = Math.sin((p.life / p.max) * Math.PI) * lerp(0.35, 0.7, near)
          segment(stage, p.last, next, stage.tone(hue, 90, lerp(58, 88, near), alpha), lerp(1.2, 2.4, near))
        }

        p.last = next
      })
      drawMark(stage, smooth((trap - 0.8) / 0.2) * 0.9, blinkAt(time))
    }
  },
}

const wrap = (value: number) =>
  value < VIEW.x ? value + VIEW.size : value > VIEW.x + VIEW.size ? value - VIEW.size : value
