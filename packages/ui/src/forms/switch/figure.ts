// Fork feature: the switch thumb holds a Lissajous figure. Off it is a still circle (1:1); on, its frequency ratio is
// steered by a live Lorenz system, so the knot keeps morphing without ever repeating. All switches share one
// animation frame, and a figure only animates while it is on, visible and motion is allowed.

type Figure = {
  canvas: HTMLCanvasElement
  thumb: HTMLElement
  visible: boolean
  // Spring from 0 (circle) to 1 (Lorenz-steered knot).
  p: number
  v: number
  phase: number
  lorenz: [number, number, number]
  last: number
}

const figures = new Set<Figure>()

const loop = { frame: 0 }

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches

export function attachFigure(canvas: HTMLCanvasElement, thumb: HTMLElement) {
  const figure: Figure = {
    canvas,
    thumb,
    visible: true,
    p: thumb.hasAttribute("data-checked") ? 1 : 0,
    v: 0,
    phase: 0,
    // Each switch starts at its own point on the attractor, so a page of switches does not move in lockstep.
    lorenz: [1 + Math.random() * 4, 1 + Math.random() * 4, 20 + Math.random() * 6],
    last: performance.now(),
  }

  const changes = new MutationObserver(wake)
  changes.observe(thumb, { attributes: true, attributeFilter: ["data-checked"] })

  const sight = new IntersectionObserver((entries) => {
    figure.visible = entries.some((entry) => entry.isIntersecting)
    wake()
  })

  sight.observe(canvas)
  figures.add(figure)
  wake()

  return () => {
    changes.disconnect()
    sight.disconnect()
    figures.delete(figure)
  }
}

function wake() {
  if (!loop.frame) loop.frame = requestAnimationFrame(tick)
}

function tick(now: number) {
  loop.frame = 0
  const busy = Array.from(figures).map((figure) => draw(figure, now))

  if (busy.some(Boolean)) wake()
}

// Draws one frame and says whether this figure still needs frames.
function draw(figure: Figure, now: number) {
  const dt = Math.min(0.033, (now - figure.last) / 1000)
  figure.last = now
  const on = figure.thumb.hasAttribute("data-checked")
  const still = reduced()

  if (still) {
    figure.p = on ? 1 : 0
    figure.v = 0
  }

  if (!still) {
    // Damped spring toward the circle or the knot: x'' = -k(x - target) - c x'.
    figure.v += (-40 * (figure.p - (on ? 1 : 0)) - 9 * figure.v) * dt
    figure.p += figure.v * dt
  }

  const settling = Math.abs(figure.p - (on ? 1 : 0)) > 0.001 || Math.abs(figure.v) > 0.01

  if (on && !still) step(figure, dt)

  if (figure.visible) render(figure)

  return figure.visible && !still && (on || settling)
}

// The Lorenz system (σ = 10, ρ = 28, β = 8/3), a few small Euler steps per frame.
function step(figure: Figure, dt: number) {
  const s = figure.lorenz
  Array.from({ length: 4 }).forEach(() => {
    const h = 0.0012
    const dx = 10 * (s[1] - s[0])
    const dy = s[0] * (28 - s[2]) - s[1]
    const dz = s[0] * s[1] - (8 / 3) * s[2]
    s[0] += dx * h
    s[1] += dy * h
    s[2] += dz * h
  })
  figure.phase += dt * 0.8
}

function render(figure: Figure) {
  const canvas = figure.canvas
  const size = canvas.clientWidth
  const ratio = Math.min(3, window.devicePixelRatio || 1)
  const pixels = Math.round(size * ratio)

  if (canvas.width !== pixels) canvas.width = canvas.height = pixels

  const ctx = canvas.getContext("2d")

  if (!ctx || !size) return
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.clearRect(0, 0, size, size)

  const style = getComputedStyle(canvas)
  const e = Math.min(1, Math.max(0, figure.p))
  // Lorenz x and z, normalized to about [-1, 1], tune the two frequencies.
  const lx = figure.lorenz[0] / 20
  const lz = (figure.lorenz[2] - 25) / 22
  const a = 1 + (1 + lx * 1.2) * e
  const b = 1 + (1 + lz * 0.8) * e
  const radius = size * 0.31
  const center = size / 2

  ctx.strokeStyle = e > 0.5 ? style.getPropertyValue("--switch-figure-on") : style.getPropertyValue("--switch-figure-off")
  ctx.lineWidth = Math.max(0.9, size / 16)
  ctx.lineJoin = "round"
  ctx.beginPath()
  Array.from({ length: 181 }, (_, i) => (i / 180) * Math.PI * 2).forEach((t, i) => {
    const x = center + radius * Math.sin(a * t + figure.phase * e + Math.PI / 2)
    const y = center + radius * Math.sin(b * t)

    if (i === 0) ctx.moveTo(x, y)

    if (i > 0) ctx.lineTo(x, y)
  })
  ctx.stroke()
}
