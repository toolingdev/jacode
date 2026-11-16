import type { Sprite } from "./sprites"

// An animation describes one frame at a time: where the sprite sits on the 24x24 stage, how its rows are pushed
// around, and which loose pixels (dots, sparks, drops) accompany it. Frames advance about nine times a second.

/** The stage is square; the sprite stands on its last row. */
export const STAGE = 24
/** Where the sprite's top-left corner rests. */
export const REST = { x: 4, y: 8 }

export type Pixel = readonly [x: number, y: number, color: string]

export type Frame = {
  dx?: number
  dy?: number
  /** Extra sideways push for one sprite row. */
  rowDx?: (row: number) => number
  /** Extra lift for one sprite row. */
  rowDy?: (row: number) => number
  closed?: boolean
  flip?: boolean
  /** Width and height as a share of full size; the sprite shrinks toward its center line and its feet. */
  scaleX?: number
  scaleY?: number
  alpha?: number
  /** Palette colors replaced for this frame. */
  tint?: Readonly<Record<string, string>>
  /** Stage rows from here down are not drawn, as if the sprite stood behind a ledge. */
  ledge?: number
  pixels?: readonly Pixel[]
}

export type Animation = {
  readonly id: string
  /** How many frames one pass takes. */
  readonly length: number
  readonly frame: (tick: number, sprite: Sprite) => Frame
}

const WHITE = "#f1f0ff"
const GOLD = "#ffd84a"
const BLUE = "#6cc8ff"
const PINK = "#ff8fb0"
const VIOLET = "#9aa4ff"

const at = <T>(items: readonly T[], tick: number) => items[tick % items.length]

const blink = (tick: number, every: number) => tick % every < 2

const head = (sprite: Sprite, push: number) => (row: number) => (row < sprite.neck ? push : 0)

// A 3x5 question mark and a 3x3 Z, placed by their top-left corner.
const glyph = (shape: readonly string[], x: number, y: number, color: string): Pixel[] =>
  shape.flatMap((line, row) =>
    line.split("").flatMap((cell, column): Pixel[] => (cell === "#" ? [[x + column, y + row, color]] : [])),
  )

const QUESTION = ["##.", "..#", ".#.", "...", ".#."]
const ZED = ["###", ".#.", "###"]
const BULB = [".#.", "###", "###", ".#."]
const HEART = ["#.#", "###", ".#."]
const NOTE = [".##", ".#.", "##."]

/** What every character can do while it thinks. */
export const shared: readonly Animation[] = [
  {
    // Head tilts side to side while three dots count up.
    id: "ponder",
    length: 36,
    frame: (tick, sprite) => ({
      rowDx: head(sprite, at([-1, -1, 0, 1, 1, 0], tick >> 2)),
      closed: blink(tick, 30),
      pixels: Array.from({ length: (tick >> 2) % 4 }, (_, dot): Pixel => [9 + dot * 3, 4 - (dot % 2), WHITE]),
    }),
  },
  {
    // Walks the stage end to end, turning around at each wall.
    id: "pace",
    length: 40,
    frame: (tick) => {
      const step = tick % 40
      const dx = step < 20 ? step / 3 - 3 : (40 - step) / 3 - 3

      return { dx: Math.round(dx), dy: tick % 4 < 2 ? 0 : -1, flip: step >= 20 }
    },
  },
  {
    // Stands still, then an idea lands and it jumps.
    id: "eureka",
    length: 32,
    frame: (tick) => {
      const step = tick % 32
      const lit = step >= 18

      return {
        dy: lit ? at([0, -2, -3, -2, 0, 0, 0], step - 18) : 0,
        closed: !lit && step > 6,
        pixels: lit ? glyph(BULB, 11, 1, step % 2 ? GOLD : "#fff6c2") : [],
      }
    },
  },
  {
    // Shakes with effort while sweat flies off both sides.
    id: "sweat",
    length: 32,
    frame: (tick) => ({
      dx: tick % 2 ? 1 : -1,
      pixels: [
        [21, 9 + (tick % 8), BLUE],
        [2, 9 + ((tick + 4) % 8), BLUE],
        [20, 8 + ((tick + 2) % 8), "#b9e6ff"],
      ],
    }),
  },
  {
    // Eyes shut, hovering, with a ring of sparkles turning around it.
    id: "levitate",
    length: 40,
    frame: (tick) => ({
      dy: -3 + Math.round(Math.sin(tick / 3) * 1.5),
      closed: true,
      pixels: [0, 1, 2, 3].map((spark): Pixel => {
        const angle = tick / 4 + (spark * Math.PI) / 2

        return [Math.round(11.5 + Math.cos(angle) * 10), Math.round(14 + Math.sin(angle) * 4), spark % 2 ? GOLD : WHITE]
      }),
    }),
  },
  {
    // Turns on the spot like a coin.
    id: "spin",
    length: 32,
    frame: (tick) => {
      const turn = Math.cos((tick % 16) * (Math.PI / 8))

      return { scaleX: Math.max(0.15, Math.abs(turn)), flip: turn < 0 }
    },
  },
  {
    // Question marks pop up on alternating sides as the head follows them.
    id: "puzzled",
    length: 36,
    frame: (tick, sprite) => {
      const left = (tick >> 3) % 2 === 0

      return {
        rowDx: head(sprite, left ? -1 : 1),
        pixels: glyph(QUESTION, left ? 1 : 20, 3 - (tick % 8 < 4 ? 0 : 1), left ? BLUE : GOLD),
      }
    },
  },
  {
    // Dozes off, sinking lower, then startles awake.
    id: "doze",
    length: 40,
    frame: (tick) => {
      const step = tick % 40

      if (step >= 32) return { dy: at([-4, -5, -3, -1, 0, 0, 0, 0], step - 32), dx: step < 35 ? (step % 2 ? 1 : -1) : 0 }
      const drift = (step >> 2) % 3

      return { dy: Math.min(2, step >> 3), closed: true, pixels: glyph(ZED, 17 + drift * 2, 6 - drift * 2, VIOLET) }
    },
  },
  {
    // Keeps three balls in the air.
    id: "juggle",
    length: 36,
    frame: (tick) => ({
      dy: tick % 6 < 3 ? 0 : -1,
      pixels: [0, 1, 2].map((ball): Pixel => {
        const phase = ((tick + ball * 4) % 12) / 12

        return [Math.round(4 + phase * 15), Math.round(7 - Math.sin(phase * Math.PI) * 6), at([PINK, GOLD, BLUE], ball)]
      }),
    }),
  },
  {
    // Ducks behind the floor and peeks back over it.
    id: "peek",
    length: 40,
    frame: (tick) => {
      const step = tick % 40
      const sunk = step < 8 ? step * 2 : step < 16 ? 16 : step < 26 ? 10 : step < 32 ? 10 - (step - 26) * 2 : 0

      return { dy: sunk, ledge: STAGE, closed: step >= 16 && step < 26 && step % 6 === 0 }
    },
  },
]

/** Two animations of each character's own, on top of the shared ones. */
export const signature: Readonly<Record<string, readonly Animation[]>> = {
  bolt: [
    {
      // Antenna throws sparks while the eyes cycle through colors.
      id: "sparks",
      length: 32,
      frame: (tick) => ({
        tint: { e: at(["#3df2c8", "#ffd23d", "#ff5a5a", "#6cc8ff"], tick >> 1), a: tick % 2 ? "#ffd23d" : "#ff5a5a" },
        pixels: [0, 1, 2].map((spark): Pixel => {
          const reach = ((tick + spark * 3) % 6) + 1

          return [Math.round(11.5 + at([-1, 1, 0], spark) * reach), 8 - reach + (spark === 2 ? -1 : 1), GOLD]
        }),
      }),
    },
    {
      // Powers down, a scanline sweeps it, and it boots back up.
      id: "reboot",
      length: 36,
      frame: (tick) => {
        const step = tick % 36
        const line = step - 8

        return {
          tint:
            step < 28 ? { e: "#56678a", a: "#56678a" } : { e: step % 2 ? "#ffffff" : "#3df2c8", a: "#ff5a5a" },
          rowDx: (row) => (row === line || row === line - 1 ? 1 : 0),
        }
      },
    },
  ],
  boo: [
    {
      // Fades almost out of sight and back.
      id: "vanish",
      length: 36,
      frame: (tick) => ({ alpha: 0.2 + 0.8 * Math.abs(Math.cos(tick / 6)), dy: -1 + Math.round(Math.sin(tick / 4)) }),
    },
    {
      // Ripples like a sheet in the wind.
      id: "ripple",
      length: 32,
      frame: (tick) => ({ rowDx: (row) => Math.round(Math.sin(row / 2 + tick / 2) * 1.4), dy: -1 }),
    },
  ],
  mochi: [
    {
      // Crouches, wiggles, and pounces.
      id: "pounce",
      length: 32,
      frame: (tick) => {
        const step = tick % 32

        if (step < 16) return { scaleY: 0.8, rowDx: (row) => (row > 10 ? (step % 2 ? 1 : -1) : 0) }

        return { dx: Math.min(4, step - 16), dy: -Math.round(Math.sin(((step - 16) / 16) * Math.PI) * 6) }
      },
    },
    {
      // Purrs, eyes shut, as hearts rise.
      id: "purr",
      length: 32,
      frame: (tick) => ({
        closed: true,
        dx: tick % 4 === 0 ? 1 : 0,
        pixels: glyph(HEART, 18, 7 - (tick % 8), PINK),
      }),
    },
  ],
  merl: [
    {
      // Stars wheel around as a spell is cast.
      id: "cast",
      length: 36,
      frame: (tick) => ({
        tint: { s: tick % 2 ? "#ffffff" : GOLD },
        pixels: [0, 1, 2, 3, 4, 5].map((star): Pixel => {
          const angle = tick / 3 + (star * Math.PI) / 3
          const reach = 6 + (tick % 12) / 2

          return [Math.round(11.5 + Math.cos(angle) * reach), Math.round(13 + Math.sin(angle) * reach * 0.8), GOLD]
        }),
      }),
    },
    {
      // The hat lifts off on its own and settles back.
      id: "hat",
      length: 32,
      frame: (tick, sprite) => {
        const lift = Math.round(Math.abs(Math.sin((tick % 32) * (Math.PI / 32))) * 5)

        return { rowDy: (row) => (row < sprite.neck ? -lift : 0), rowDx: (row) => (row < sprite.neck && lift > 3 ? 1 : 0) }
      },
    },
  ],
  goop: [
    {
      // Melts into a puddle and pulls itself together.
      id: "melt",
      length: 36,
      frame: (tick) => {
        const flat = Math.abs(Math.sin((tick % 36) * (Math.PI / 36)))

        return { scaleY: 1 - flat * 0.6, closed: flat > 0.7 }
      },
    },
    {
      // Wobbles while drops fall off it.
      id: "drip",
      length: 32,
      frame: (tick) => ({
        rowDx: (row) => Math.round(Math.sin(row + tick / 2)),
        pixels: [
          [5, 17 + (tick % 7), "#4fd66b"],
          [18, 17 + ((tick + 3) % 7), "#4fd66b"],
        ],
      }),
    },
  ],
  cap: [
    {
      // Puffs spores into the air.
      id: "spores",
      length: 32,
      frame: (tick) => ({
        scaleY: tick % 8 < 2 ? 0.9 : 1,
        pixels: [0, 1, 2, 3, 4].map((spore): Pixel => {
          const rise = (tick + spore * 3) % 10

          return [6 + spore * 3 + Math.round(Math.sin(rise + spore)), 9 - rise, spore % 2 ? "#fff6ea" : "#e58a8a"]
        }),
      }),
    },
    {
      // The cap bounces on the stem.
      id: "bounce",
      length: 24,
      frame: (tick, sprite) => ({
        rowDy: (row) => (row < sprite.neck ? -at([0, 1, 3, 4, 3, 1], tick) : 0),
        closed: tick % 6 === 0,
      }),
    },
  ],
  sirbit: [
    {
      // The visor glows hotter and hotter.
      id: "visor",
      length: 32,
      frame: (tick) => ({
        tint: { e: at(["#ffd23d", "#ffb02e", "#ff8a3d", "#ff5a5a", "#ffffff", "#ff5a5a", "#ff8a3d", "#ffb02e"], tick >> 1) },
        dy: tick % 16 < 2 ? -1 : 0,
      }),
    },
    {
      // The plume whips about in a wind only it can feel.
      id: "plume",
      length: 32,
      frame: (tick, sprite) => ({
        rowDx: (row) => (row < sprite.neck ? Math.round(Math.sin(tick / 1.5 + row) * (sprite.neck - row)) : 0),
      }),
    },
  ],
  ribbit: [
    {
      // Snaps a passing fly out of the air.
      id: "tongue",
      length: 32,
      frame: (tick) => {
        const step = tick % 32
        const reach = step < 16 ? 0 : step < 20 ? (step - 16) * 2 : step < 24 ? (24 - step) * 2 : 0
        const fly: Pixel[] = step < 20 ? [[22 - (step % 3), 17 + (step % 2), "#2b2b45"]] : []

        return { pixels: [...Array.from({ length: reach }, (_, link): Pixel => [14 + link, 18, PINK]), ...fly] }
      },
    },
    {
      // Hops across the stage and back.
      id: "hop",
      length: 32,
      frame: (tick) => {
        const step = tick % 32
        const hop = step % 8

        return {
          dx: (step < 16 ? step >> 3 : 3 - ((step - 16) >> 3)) * 2 - 2,
          dy: -Math.round(Math.sin((hop / 8) * Math.PI) * 5),
          scaleY: hop === 0 ? 0.8 : 1,
          flip: step >= 16,
        }
      },
    },
  ],
  orbit: [
    {
      // Drifts weightless, tumbling slowly.
      id: "drift",
      length: 48,
      frame: (tick) => ({
        dx: Math.round(Math.sin(tick / 6) * 3),
        dy: -3 + Math.round(Math.cos(tick / 4) * 2),
        flip: Math.cos(tick / 6) < 0,
      }),
    },
    {
      // A tiny moon circles overhead.
      id: "moon",
      length: 36,
      frame: (tick) => {
        const angle = tick / 3
        const x = Math.round(11.5 + Math.cos(angle) * 10)
        const y = Math.round(9 + Math.sin(angle) * 3)

        return {
          pixels: [
            [x, y, "#d9dbe6"],
            [x + 1, y, "#d9dbe6"],
            [x, y + 1, "#a9adc2"],
            [x + 1, y + 1, "#d9dbe6"],
          ],
        }
      },
    },
  ],
  hoot: [
    {
      // Swivels its head far to each side.
      id: "swivel",
      length: 32,
      frame: (tick, sprite) => ({ rowDx: head(sprite, at([0, 1, 2, 2, 2, 1, 0, -1, -2, -2, -2, -1], tick >> 1)) }),
    },
    {
      // Hoots a little tune.
      id: "tune",
      length: 32,
      frame: (tick) => ({
        scaleY: tick % 8 < 2 ? 0.92 : 1,
        pixels: [
          ...glyph(NOTE, 19, 8 - (tick % 8), GOLD),
          ...glyph(NOTE, 1, 8 - ((tick + 4) % 8), BLUE),
        ],
      }),
    },
  ],
}

/** Resting between thoughts: a slow bob and the odd blink. */
export const idle: Animation = {
  id: "idle",
  length: 26,
  frame: (tick) => ({ dy: at([0, 0, 1, 1], tick >> 1), closed: blink(tick, 26) }),
}

export function thinking(sprite: Sprite): readonly Animation[] {
  return [...shared, ...(signature[sprite.id] ?? [])]
}

/** The animation to play after `previous`, never the same one twice running. */
export function nextAnimation(sprite: Sprite, previous: string | undefined, random: () => number) {
  const choices = thinking(sprite).filter((animation) => animation.id !== previous)

  return choices[Math.floor(random() * choices.length)] ?? idle
}

/** The stage pixels of one frame, back to front. */
export function paint(sprite: Sprite, frame: Frame): Pixel[] {
  const ledge = frame.ledge ?? STAGE + 1
  const palette = { ...sprite.palette, ...frame.tint }

  const body = sprite.rows.flatMap((half, row) =>
    `${half}${half.split("").reverse().join("")}`.split("").flatMap((cell, column): Pixel[] => {
      if (cell === ".") return []
      const side = frame.flip ? 15 - column : column
      const x = Math.round(7.5 + (side - 7.5) * (frame.scaleX ?? 1))
      const y = Math.round(15 - (15 - row) * (frame.scaleY ?? 1))

      return [
        [
          REST.x + x + (frame.dx ?? 0) + (frame.rowDx?.(row) ?? 0),
          REST.y + y + (frame.dy ?? 0) + (frame.rowDy?.(row) ?? 0),
          palette[cell === "e" && frame.closed ? sprite.lid : cell] ?? "#ff00ff",
        ],
      ]
    }),
  )

  return [...body, ...(frame.pixels ?? [])].filter(
    ([x, y]) => x >= 0 && x < STAGE && y >= 0 && y < STAGE && y < ledge,
  )
}
