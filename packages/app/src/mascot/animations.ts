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
  /** Upside down. */
  flipY?: boolean
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

const ORANGE = "#ff8a3d"

const BLUE = "#6cc8ff"

const ICE = "#b9e6ff"

const PINK = "#ff8fb0"

const VIOLET = "#9aa4ff"

const STEEL = "#b9c2d0"

const GREY = "#8a8fa3"

const RED = "#ff5a5a"

const GREEN = "#4fd66b"

const HUES = ["#ff5a5a", "#ff8a3d", "#ffd84a", "#4fd66b", "#6cc8ff", "#9aa4ff", "#ff8fb0"]

const at = <T>(items: readonly T[], tick: number) => items[((tick % items.length) + items.length) % items.length]

const blink = (tick: number, every: number) => tick % every < 2

const px = (x: number, y: number, color: string): Pixel => [Math.round(x), Math.round(y), color]

const head = (sprite: Sprite, push: number) => (row: number) => (row < sprite.neck ? push : 0)

/** Leans the sprite over from its feet. */
const lean = (amount: number) => (row: number) => Math.round(((15 - row) / 15) * amount)

/** A repeatable stand-in for randomness, so a frame always draws the same way. */
const hash = (a: number, b: number) => ((a * 73856093) ^ (b * 19349663)) >>> 0

// A small drawing placed by its top-left corner; `#` cells are drawn.
const glyph = (lines: readonly string[], x: number, y: number, color: string): Pixel[] =>
  lines.flatMap((line, row) =>
    line.split("").flatMap((cell, column): Pixel[] => (cell === "#" ? [px(x + column, y + row, color)] : [])),
  )

const ring = (
  tick: number,
  input: { count: number; rx: number; ry: number; x: number; y: number; speed: number; colors: readonly string[] },
): Pixel[] =>
  Array.from({ length: input.count }, (_, index) => {
    const angle = tick * input.speed + (index * Math.PI * 2) / input.count

    return px(input.x + Math.cos(angle) * input.rx, input.y + Math.sin(angle) * input.ry, at(input.colors, index))
  })

const rising = (tick: number, xs: readonly number[], base: number, span: number, colors: readonly string[]): Pixel[] =>
  xs.map((x, index) => px(x, base - ((tick + index * 3) % span), at(colors, index)))

const falling = (tick: number, xs: readonly number[], span: number, colors: readonly string[]): Pixel[] =>
  xs.map((x, index) => px(x, (tick + index * 5) % span, at(colors, index)))

const ZERO = ["###", "#.#", "###"]

const ONE = [".#.", ".#.", ".#."]

const BANG = ["#", "#", "#", ".", "#"]

const HEART = ["#.#", "###", ".#."]

const NOTE = [".##", ".#.", "##."]

const PLUS = [".#.", "###", ".#."]

const FISH = ["#.##", "####", "#.##"]

const CROSS = ["..#..", "#####", "..#..", "..#.."]

const MOON = [".##", "##.", "##.", ".##"]

const UFO = [".###.", "#####"]

const RUNES = [
  ["#.#", ".#.", "#.#"],
  [".#.", "###", ".#."],
  ["##.", ".#.", ".##"],
  ["#.#", "###", "#.#"],
]

/** The animations each character has of one kind, by character id. */
type Repertoire = Readonly<Record<string, readonly Animation[]>>

/** Ten thinking animations for each character, none shared with another. */
export const own = {
  bolt: [
    {
      // Antenna throws sparks while the eyes cycle through colors.
      id: "sparks",
      length: 32,
      frame: (tick) => ({
        tint: { e: at(["#3df2c8", "#ffd23d", RED, BLUE], tick >> 1), a: tick % 2 ? "#ffd23d" : RED },
        pixels: [0, 1, 2].map((spark) => {
          const reach = ((tick + spark * 3) % 6) + 1

          return px(11.5 + at([-1, 1, 0], spark) * reach, 8 - reach + (spark === 2 ? -1 : 1), GOLD)
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
          tint: { e: step < 28 ? "#56678a" : step % 2 ? "#ffffff" : "#3df2c8", a: step < 28 ? "#56678a" : RED },
          rowDx: (row) => (row === line || row === line - 1 ? 1 : 0),
        }
      },
    },
    {
      // Ones and zeros stream past overhead.
      id: "compute",
      length: 28,
      frame: (tick) => ({
        tint: { e: tick % 4 < 2 ? "#3df2c8" : "#b6fff0" },
        pixels: [0, 1, 2, 3].flatMap((digit) =>
          glyph(hash(digit, 7) % 2 ? ONE : ZERO, 24 - ((tick + digit * 7) % 28), 2, "#3df2c8"),
        ),
      }),
    },
    {
      // Runs hot, vents steam, and cools off.
      id: "overheat",
      length: 40,
      frame: (tick) => {
        const step = tick % 40
        const heat = step < 28 ? Math.min(3, Math.floor(step / 7)) : 0

        return {
          dx: heat === 3 ? (tick % 2 ? 1 : -1) : 0,
          tint: {
            b: at(["#7f93b8", "#a88a9a", "#d07a70", RED], heat),
            l: at(["#c9d6ef", "#e0c6cf", "#f3b5ab", "#ffb3b3"], heat),
          },
          pixels: heat >= 2 ? rising(tick, [7, 11, 15], 8, 8, ["#d9dbe6"]) : [],
        }
      },
    },
    {
      // The head springs off the body and bobs back down.
      id: "headpop",
      length: 32,
      frame: (tick, sprite) => {
        const step = tick % 32
        const lift = step < 6 ? 0 : Math.round(Math.abs(Math.sin((step - 6) / 4)) * 6 * (1 - (step - 6) / 26))

        return {
          rowDy: (row) => (row < sprite.neck ? -lift : 0),
          pixels: Array.from({ length: lift }, (_, coil) => px(11 + (coil % 2), 17 - coil, STEEL)),
        }
      },
    },
    {
      // Eye beams sweep out to both sides.
      id: "scan",
      length: 32,
      frame: (tick) => {
        const step = tick % 32
        const reach = step < 16 ? step / 2 : (32 - step) / 2

        return {
          tint: { e: tick % 2 ? "#ffffff" : "#3df2c8" },
          pixels: Array.from({ length: Math.round(reach) }, (_, link) => [
            px(16 + link, 13, "#3df2c8"),
            px(7 - link, 13, "#3df2c8"),
          ]).flat(),
        }
      },
    },
    {
      // Rows tear sideways as the signal breaks up.
      id: "glitch",
      length: 28,
      frame: (tick) => ({
        tint: { e: tick % 5 === 0 ? RED : "#3df2c8" },
        rowDx: (row) => (hash(row, tick >> 1) % 6 === 0 ? (hash(tick, row) % 2 ? 2 : -2) : 0),
      }),
    },
    {
      // A battery overhead fills cell by cell, then flashes.
      id: "charge",
      length: 36,
      frame: (tick) => {
        const step = tick % 36
        const cells = Math.min(5, Math.floor(step / 5))
        const full = step >= 28

        return {
          dy: full && step % 2 ? -1 : 0,
          tint: { e: full ? "#ffffff" : "#3df2c8" },
          pixels: [
            ...[3, 4].flatMap((y) => [px(5, y, GREY), px(17, y, GREY)]),
            ...Array.from({ length: cells }, (_, cell) =>
              [3, 4].map((y) => px(7 + cell * 2, y, full ? GOLD : GREEN)),
            ).flat(),
          ],
        }
      },
    },
    {
      // The antenna twitches and sends out radio waves.
      id: "broadcast",
      length: 32,
      frame: (tick) => ({
        rowDx: (row) => (row < 2 ? at([-1, 0, 1, 0], tick) : 0),
        pixels: [0, 4].flatMap((delay) => {
          const reach = ((tick + delay) % 8) + 2

          return [px(11 - reach, 8 - reach / 2, GOLD), px(12 + reach, 8 - reach / 2, GOLD)]
        }),
      }),
    },
    {
      // Glides from side to side on hidden wheels, kicking up dust.
      id: "skate",
      length: 40,
      frame: (tick) => {
        const angle = ((tick % 40) / 40) * Math.PI * 2
        const dx = Math.round(Math.sin(angle) * 4)
        const forward = Math.cos(angle) >= 0 ? 1 : -1

        return {
          dx,
          flip: forward < 0,
          pixels: [px(11.5 - forward * 9 + dx, 23, GREY), px(11.5 - forward * 11 + dx, 22, GREY)],
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
    {
      // Swoops in a figure of eight.
      id: "haunt",
      length: 32,
      frame: (tick) => ({
        dx: Math.round(Math.sin(tick / 5) * 4),
        dy: -3 + Math.round(Math.sin(tick / 2.5) * 2),
        flip: Math.cos(tick / 5) < 0,
      }),
    },
    {
      // Shrinks down small, then jumps out big.
      id: "boo",
      length: 32,
      frame: (tick) => {
        const step = tick % 32
        const size = step < 20 ? 0.6 : step < 27 ? 1.15 : 1

        return {
          scaleX: size,
          scaleY: size,
          closed: step < 20,
          pixels: step >= 20 && step < 27 ? [...glyph(BANG, 21, 2, GOLD), ...glyph(BANG, 2, 2, GOLD)] : [],
        }
      },
    },
    {
      // Sinks through the floor and drops back in from above.
      id: "phase",
      length: 36,
      frame: (tick) => {
        const step = tick % 36
        const dy = step < 12 ? step * 2 : step < 24 ? -24 + (step - 12) * 2 : 0

        return { dy, alpha: dy === 0 ? 1 : 0.7 }
      },
    },
    {
      // Shivers under falling snow.
      id: "chill",
      length: 32,
      frame: (tick) => ({
        dx: tick % 2,
        tint: { w: "#d6ecff" },
        pixels: falling(tick, [2, 7, 12, 17, 21], 22, [WHITE]),
      }),
    },
    {
      // Blue wisps circle it from head to toe.
      id: "wisps",
      length: 38,
      frame: (tick) => ({
        dy: -1,
        pixels: ring(tick, { count: 3, rx: 10, ry: 7, x: 11.5, y: 14, speed: 1 / 3, colors: [BLUE, ICE] }).flatMap(
          ([x, y, color]) => [px(x, y, color), px(x, y - 1, ICE)],
        ),
      }),
    },
    {
      // Stretches tall and thin, then short and wide.
      id: "stretch",
      length: 26,
      frame: (tick) => ({ scaleY: 1 + Math.sin(tick / 4) * 0.35, scaleX: 1 - Math.sin(tick / 4) * 0.25 }),
    },
    {
      // Sways beside a flickering candle.
      id: "candle",
      length: 32,
      frame: (tick) => ({
        dy: -1,
        rowDx: lean(Math.sin(tick / 5) * 2),
        pixels: [
          ...[17, 18, 19, 20].map((y) => px(22, y, "#fff6ea")),
          px(22, 16, tick % 2 ? GOLD : ORANGE),
          ...(tick % 3 ? [px(22, 15, GOLD)] : []),
        ],
      }),
    },
    {
      // Tumbles end over end in mid-air.
      id: "tumble",
      length: 32,
      frame: (tick) => {
        const quarter = (tick >> 2) % 4

        return { flip: quarter === 1 || quarter === 2, flipY: quarter >= 2, dy: -3 + Math.round(Math.sin(tick / 3)) }
      },
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
      frame: (tick) => ({ closed: true, dx: tick % 4 === 0 ? 1 : 0, pixels: glyph(HEART, 19, 7 - (tick % 8), PINK) }),
    },
    {
      // Tracks a laser dot across the floor.
      id: "laser",
      length: 50,
      frame: (tick, sprite) => {
        const x = 11.5 + Math.cos(tick / 4) * 10

        return {
          dx: Math.round(Math.cos(tick / 4 - 0.8) * 2),
          rowDx: head(sprite, x > 11.5 ? 1 : -1),
          pixels: [px(x, 21 + Math.sin(tick / 2) * 2, "#ff3b3b")],
        }
      },
    },
    {
      // Tucks into a loaf and breathes slowly.
      id: "loaf",
      length: 40,
      frame: (tick) => ({ scaleY: tick % 16 < 8 ? 0.72 : 0.76, scaleX: 1.08, closed: tick % 20 > 2 }),
    },
    {
      // Watches a ball of yarn bounce from wall to wall.
      id: "yarn",
      length: 40,
      frame: (tick, sprite) => {
        const phase = (tick % 20) / 20
        const x = (tick % 40 < 20 ? phase : 1 - phase) * 20 + 1
        const y = 22 - Math.abs(Math.sin(phase * Math.PI * 2)) * 4

        return {
          rowDx: head(sprite, x > 11.5 ? 1 : -1),
          pixels: [
            px(x, y, PINK),
            px(x + 1, y, PINK),
            px(x, y - 1, PINK),
            px(x + 1, y - 1, "#ffc2d4"),
            px(x - 1, 23, PINK),
          ],
        }
      },
    },
    {
      // A long, slow stretch.
      id: "stretchy",
      length: 32,
      frame: (tick) => {
        const reach = Math.abs(Math.sin(((tick % 32) / 32) * Math.PI))

        return { scaleX: 1 + reach * 0.25, scaleY: 1 - reach * 0.25, closed: reach > 0.6 }
      },
    },
    {
      // Tears back and forth at full speed.
      id: "zoomies",
      length: 32,
      frame: (tick) => {
        const step = tick % 16
        const back = step >= 8
        const dx = back ? 4 - (step - 8) : -4 + step

        return { dx, flip: back, pixels: [14, 17, 20].map((y) => px(back ? 22 + dx : 1 + dx, y, WHITE)) }
      },
    },
    {
      // Kneads the ground with its paws.
      id: "knead",
      length: 32,
      frame: (tick) => ({
        closed: true,
        scaleY: 0.95,
        rowDx: (row) => (row >= 13 ? ((tick >> 1) % 2 ? 1 : -1) : 0),
      }),
    },
    {
      // Dreams of fish and drools a little.
      id: "fish",
      length: 32,
      frame: (tick) => ({
        closed: tick % 12 < 6,
        pixels: [
          px(17, 7, WHITE),
          px(18, 5, WHITE),
          ...glyph(FISH, 19, 1 + ((tick >> 2) % 2), BLUE),
          px(12, 18 + ((tick >> 2) % 3), ICE),
        ],
      }),
    },
    {
      // Leaps at a butterfly that stays just out of reach.
      id: "swat",
      length: 38,
      frame: (tick, sprite) => {
        const x = 11.5 + Math.sin(tick / 3) * 8
        const y = 4 + Math.cos(tick / 2) * 2
        const wing = tick % 2 ? 0 : -1

        return {
          dy: -at([2, 4, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], tick),
          rowDx: head(sprite, x > 11.5 ? 1 : -1),
          pixels: [px(x, y, WHITE), px(x - 1, y + wing, VIOLET), px(x + 1, y + wing, VIOLET)],
        }
      },
    },
  ],
  merl: [
    {
      // Stars wheel around as a spell is cast.
      id: "cast",
      length: 36,
      frame: (tick) => ({
        tint: { s: tick % 2 ? "#ffffff" : GOLD },
        pixels: ring(tick, {
          count: 6,
          rx: 6 + (tick % 12) / 2,
          ry: 5 + (tick % 12) / 3,
          x: 11.5,
          y: 13,
          speed: 1 / 3,
          colors: [GOLD],
        }),
      }),
    },
    {
      // The hat lifts off on its own and settles back.
      id: "hat",
      length: 32,
      frame: (tick, sprite) => {
        const lift = Math.round(Math.abs(Math.sin((tick % 32) * (Math.PI / 32))) * 5)

        return {
          rowDy: (row) => (row < sprite.neck ? -lift : 0),
          rowDx: (row) => (row < sprite.neck && lift > 3 ? 1 : 0),
        }
      },
    },
    {
      // Minds a bubbling cauldron.
      id: "potion",
      length: 28,
      frame: (tick, sprite) => ({
        rowDx: head(sprite, -1),
        pixels: [
          ...[1, 2, 3].map((x) => px(x, 23, GREY)),
          px(0, 22, GREY),
          px(4, 22, GREY),
          ...[1, 2, 3].map((x) => px(x, 22, GREEN)),
          ...rising(tick, [2, 1, 3], 21, 14, [GREEN, "#7b5cff"]),
        ],
      }),
    },
    {
      // Reads a floating book that turns its own pages.
      id: "tome",
      length: 32,
      frame: (tick, sprite) => ({
        rowDx: head(sprite, at([0, 0, 1, 0, 0, -1], tick >> 1)),
        pixels: glyph([tick % 8 < 2 ? "#...#" : "##.##", "##.##", "#####"], 9, 1 + ((tick >> 3) % 2), "#e6e6f0"),
      }),
    },
    {
      // The beard streams in a breeze.
      id: "beard",
      length: 26,
      frame: (tick) => ({ rowDx: (row) => (row >= 10 ? Math.round(Math.sin(tick / 2 + row / 1.5) * 1.5) : 0) }),
    },
    {
      // Blinks out of one spot and into another.
      id: "teleport",
      length: 32,
      frame: (tick) => {
        const local = tick % 16
        const width = local < 8 ? 1 - local * 0.11 : 0.12 + (local - 8) * 0.11
        const dx = tick % 32 < 16 === local < 8 ? -3 : 3

        return {
          dx,
          scaleX: width,
          pixels:
            width < 0.5
              ? ring(tick, { count: 4, rx: 5, ry: 7, x: 11.5 + dx, y: 15, speed: 1, colors: [VIOLET, WHITE] })
              : [],
        }
      },
    },
    {
      // Grows a fireball and sends it skyward.
      id: "fireball",
      length: 28,
      frame: (tick) => {
        const step = tick % 28
        const size = step < 14 ? 1 + Math.floor(step / 5) : 3
        const y = step < 14 ? 16 : 16 - (step - 14) * 2

        return {
          pixels: [
            ...Array.from({ length: size * size }, (_, cell) =>
              px(20 + (cell % size), y - Math.floor(cell / size), cell % 2 ? GOLD : ORANGE),
            ),
            ...(step >= 14 ? [px(21, y + 2, RED), px(21, y + 4, "#993c1d")] : []),
          ],
        }
      },
    },
    {
      // The robe changes color, hue after hue.
      id: "transmute",
      length: 28,
      frame: (tick) => ({ tint: { v: at(HUES, tick >> 2) }, dy: tick % 4 === 0 ? -1 : 0 }),
    },
    {
      // Writes runes in the air, one by one, until they flare.
      id: "runes",
      length: 36,
      frame: (tick) => {
        const step = tick % 36

        return {
          pixels: RUNES.slice(0, Math.min(4, Math.floor(step / 6))).flatMap((rune, index) =>
            glyph(rune, 2 + index * 6, 2, step >= 26 && step % 2 ? WHITE : VIOLET),
          ),
        }
      },
    },
    {
      // Follows a comet across the sky.
      id: "comet",
      length: 24,
      frame: (tick, sprite) => {
        const phase = (tick % 24) / 24
        const x = -2 + phase * 28
        const y = 6 - Math.sin(phase * Math.PI) * 5

        return {
          rowDx: head(sprite, x > 11 ? 1 : -1),
          pixels: [px(x, y, WHITE), px(x - 1, y, GOLD), px(x - 2, y, GOLD), px(x - 3, y, "#b98a2e")],
        }
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

        return { scaleY: 1 - flat * 0.6, scaleX: 1 + flat * 0.2, closed: flat > 0.7 }
      },
    },
    {
      // Wobbles while drops fall off it.
      id: "drip",
      length: 32,
      frame: (tick) => ({
        rowDx: (row) => Math.round(Math.sin(row + tick / 2)),
        pixels: [px(3, 17 + (tick % 7), GREEN), px(20, 17 + ((tick + 3) % 7), GREEN)],
      }),
    },
    {
      // Bounces, squashing flat on every landing.
      id: "boing",
      length: 32,
      frame: (tick) => {
        const step = tick % 16
        const air = step >= 4 && step < 12

        return {
          dy: air ? -Math.round(Math.sin(((step - 4) / 8) * Math.PI) * 7) : 0,
          scaleY: step < 4 ? 1 - step * 0.08 : air ? 1.2 : 0.8 + (step - 12) * 0.05,
          scaleX: step < 4 ? 1 + step * 0.05 : air ? 0.9 : 1.15 - (step - 12) * 0.04,
        }
      },
    },
    {
      // Jiggles like jelly that was just poked.
      id: "jiggle",
      length: 24,
      frame: (tick) => ({
        rowDx: (row) => Math.round(Math.sin(row * 1.3 + tick * 1.5) * Math.max(0, 3 - (tick % 24) / 6)),
      }),
    },
    {
      // Bubbles fizz up through its body.
      id: "fizz",
      length: 24,
      frame: (tick) => ({
        scaleY: tick % 8 < 2 ? 1.05 : 1,
        pixels: [0, 1, 2].map((bubble) => px(8 + bubble * 3, 22 - ((tick + bubble * 3) % 7), "#b6f5c0")),
      }),
    },
    {
      // Swallows a passing star and glows with it.
      id: "absorb",
      length: 32,
      frame: (tick) => {
        const step = tick % 32
        const glowing = step >= 16 && step < 26

        return {
          scaleX: step >= 16 && step < 20 ? 1.15 : 1,
          tint: { g: glowing ? "#c9e85a" : GREEN, l: glowing ? "#fff6c2" : "#b6f5c0" },
          pixels: step < 16 ? glyph(PLUS, 22 - step, 18, GOLD) : [],
        }
      },
    },
    {
      // Rises up tall for a look around.
      id: "periscope",
      length: 36,
      frame: (tick, sprite) => ({
        scaleY: 1.4,
        scaleX: 0.75,
        rowDx: head(sprite, at([-1, -1, 0, 1, 1, 0], tick >> 2)),
      }),
    },
    {
      // Oozes along, leaving a trail.
      id: "ooze",
      length: 48,
      frame: (tick) => {
        const angle = ((tick % 48) / 48) * Math.PI * 2
        const dx = Math.round(Math.sin(angle) * 4)
        const forward = Math.cos(angle) >= 0 ? 1 : -1

        return {
          dx,
          scaleY: 0.9,
          scaleX: 1.1,
          pixels: [9, 11, 12].map((back) => px(11.5 - forward * back + dx, 23, "#3aa551")),
        }
      },
    },
    {
      // Shifts through every color it knows.
      id: "rainbow",
      length: 28,
      frame: (tick) => ({ tint: { g: at(HUES, tick >> 2) }, scaleY: tick % 8 < 4 ? 1 : 0.95 }),
    },
    {
      // Swells until it bursts, then regrows from a speck.
      id: "pop",
      length: 36,
      frame: (tick) => {
        const step = tick % 36

        if (step < 20) return { scaleX: 1 + step * 0.015, scaleY: 1 + step * 0.015 }

        if (step < 26)
          return {
            alpha: 0,
            pixels: ring(0, {
              count: 8,
              rx: (step - 19) * 2,
              ry: (step - 19) * 1.5,
              x: 11.5,
              y: 18,
              speed: 0,
              colors: [GREEN],
            }),
          }

        return { scaleX: 0.2 + (step - 26) * 0.08, scaleY: 0.2 + (step - 26) * 0.08 }
      },
    },
  ],
  cap: [
    {
      // Puffs spores into the air.
      id: "spores",
      length: 30,
      frame: (tick) => ({
        scaleY: tick % 8 < 2 ? 0.9 : 1,
        pixels: [0, 1, 2, 3, 4].map((spore) => {
          const rise = (tick + spore * 3) % 10

          return px(6 + spore * 3 + Math.sin(rise + spore), 9 - rise, spore % 2 ? "#fff6ea" : "#e58a8a")
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
    {
      // Sprouts from the ground up.
      id: "sprout",
      length: 32,
      frame: (tick) => {
        const step = tick % 32
        const grown = step < 20 ? 0.3 + step * 0.035 : 1

        return {
          scaleY: grown,
          scaleX: 0.6 + 0.4 * grown,
          pixels: step >= 20 && step < 27 ? glyph(PLUS, 10, 3, step % 2 ? GOLD : WHITE) : [],
        }
      },
    },
    {
      // Stays dry under its own cap in the rain.
      id: "rain",
      length: 24,
      frame: (tick) => ({
        closed: tick % 10 < 5,
        pixels: [1, 5, 9, 13, 17, 22].flatMap((x, index) => {
          const y = (tick * 2 + index * 5) % 24
          const sheltered = x > 3 && x < 20

          if (sheltered && y >= 9) return y < 12 ? [px(x - 1, 8, ICE), px(x + 1, 8, ICE)] : []

          return [px(x, y, BLUE)]
        }),
      }),
    },
    {
      // Its spots glow in the dark.
      id: "glow",
      length: 32,
      frame: (tick) => ({
        tint: { w: at(["#fff6ea", "#c9f5ff", "#8fe9ff", "#c9f5ff"], tick >> 2) },
        pixels: ring(tick, { count: 2, rx: 10, ry: 3, x: 11.5, y: 12, speed: 0.2, colors: ["#8fe9ff"] }),
      }),
    },
    {
      // The cap wobbles like a jelly.
      id: "wobble",
      length: 28,
      frame: (tick, sprite) => ({
        rowDx: (row) => (row < sprite.neck ? Math.round(Math.sin(tick / 1.5 + row / 2) * 1.5) : 0),
      }),
    },
    {
      // Little mushrooms pop up on either side.
      id: "family",
      length: 32,
      frame: (tick, sprite) => {
        const step = tick % 32

        const baby = (x: number) => [
          px(x, 22, "#e5484d"),
          px(x + 1, 22, "#e5484d"),
          px(x + 2, 22, "#e5484d"),
          px(x + 1, 23, "#f4e2c4"),
        ]

        return {
          rowDx: head(sprite, step < 16 ? -1 : 1),
          pixels: [...(step >= 4 ? baby(0) : []), ...(step >= 16 ? baby(21) : [])],
        }
      },
    },
    {
      // Sways like it is rooted in a breeze.
      id: "sway",
      length: 26,
      frame: (tick) => ({ rowDx: lean(Math.sin(tick / 4) * 3) }),
    },
    {
      // Fireflies wander around it.
      id: "fireflies",
      length: 30,
      frame: (tick) => ({
        pixels: [0, 1, 2].flatMap((fly) =>
          (tick + fly * 3) % 6 < 4
            ? [px(11.5 + Math.sin(tick / 5 + fly * 2) * 10, 8 + Math.cos(tick / 3 + fly) * 6, "#eaff6b")]
            : [],
        ),
      }),
    },
    {
      // Pulls its cap down over its eyes for a moment.
      id: "hide",
      length: 32,
      frame: (tick, sprite) => {
        const step = tick % 32
        const down = Math.round(step < 8 ? step / 4 : step < 24 ? 2 : (32 - step) / 4)

        return { rowDy: (row) => (row < sprite.neck ? down : 0), closed: down >= 1 }
      },
    },
  ],
  sirbit: [
    {
      // The visor glows hotter and hotter.
      id: "visor",
      length: 32,
      frame: (tick) => ({
        tint: { e: at(["#ffd23d", "#ffb02e", ORANGE, RED, "#ffffff", RED, ORANGE, "#ffb02e"], tick >> 1) },
        dy: tick % 16 < 2 ? -1 : 0,
      }),
    },
    {
      // The plume whips about in a wind only it can feel.
      id: "plume",
      length: 28,
      frame: (tick, sprite) => ({
        rowDx: (row) => (row < sprite.neck ? Math.round(Math.sin(tick / 1.5 + row) * (sprite.neck - row)) : 0),
      }),
    },
    {
      // Practices sword swings.
      id: "sword",
      length: 38,
      frame: (tick) => {
        const angle = -Math.PI / 2 + Math.sin(tick / 3) * 1.1

        return {
          pixels: [
            px(19, 18, GOLD),
            ...[1, 2, 3, 4, 5, 6].map((link) => px(19 + Math.cos(angle) * link, 18 + Math.sin(angle) * link, STEEL)),
          ],
        }
      },
    },
    {
      // Braces behind a shield as blows land on it.
      id: "shield",
      length: 32,
      frame: (tick) => {
        const hit = tick % 8 < 2

        return {
          dx: hit ? 1 : 0,
          pixels: [
            ...glyph(["###", "###", "###", "###", ".#."], 1, 14, BLUE),
            px(2, 16, GOLD),
            ...(hit ? [px(0, 12, GOLD), px(4, 12, GOLD), px(0, 20, GOLD)] : []),
          ],
        }
      },
    },
    {
      // Marches on the spot.
      id: "march",
      length: 32,
      frame: (tick) => {
        const left = (tick >> 1) % 2 === 0

        return {
          dy: left ? 0 : -1,
          rowDx: (row) => (row >= 14 ? (left ? -1 : 1) : 0),
          pixels: [px(left ? 3 : 20, 23, GREY)],
        }
      },
    },
    {
      // Kneels beneath a shining cross.
      id: "vigil",
      length: 32,
      frame: (tick) => ({
        scaleY: 0.82,
        closed: true,
        pixels: glyph(CROSS, 9, 2, tick % 8 < 4 ? GOLD : "#fff6c2"),
      }),
    },
    {
      // The armor rattles and sheds a couple of rivets.
      id: "clank",
      length: 24,
      frame: (tick) => {
        const phase = (tick % 12) / 12

        return {
          rowDx: (row) => (row >= 8 && row < 14 && tick % 3 === 0 ? (hash(row, tick) % 2 ? 1 : -1) : 0),
          pixels: [-1, 1].map((side) => px(11.5 + side * (2 + phase * 9), 16 - Math.sin(phase * Math.PI) * 6, STEEL)),
        }
      },
    },
    {
      // Stands by a banner snapping in the wind.
      id: "banner",
      length: 26,
      frame: (tick) => ({
        pixels: [
          ...Array.from({ length: 22 }, (_, y) => px(22, y + 2, "#8a5a3c")),
          ...[0, 1, 2, 3].flatMap((row) =>
            Array.from({ length: 3 + Math.round(Math.sin(tick / 2 + row)) }, (_, column) =>
              px(21 - column, 2 + row, RED),
            ),
          ),
        ],
      }),
    },
    {
      // Rears back, then charges.
      id: "joust",
      length: 32,
      frame: (tick) => {
        const step = tick % 32

        if (step < 10) return { dx: -2, rowDx: lean(-1) }

        if (step < 18)
          return {
            dx: Math.round(-2 + (step - 10) * 0.8),
            rowDx: lean(2),
            pixels: [14, 17, 20].map((y) => px(step - 10, y, WHITE)),
          }

        return { dx: Math.round(4 - (step - 18) * 0.3) }
      },
    },
    {
      // A gleam runs across freshly polished armor.
      id: "polish",
      length: 32,
      frame: (tick) => {
        const step = tick % 16

        return {
          tint: { s: step < 12 ? "#d5dcea" : STEEL },
          pixels: step < 12 ? [px(6 + step, 22 - step, "#ffffff"), px(7 + step, 22 - step, "#ffffff")] : [],
        }
      },
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

        return {
          pixels: [
            ...Array.from({ length: reach }, (_, link) => px(14 + link, 18, PINK)),
            ...(step < 20 ? [px(22 - (step % 3), 17 + (step % 2), WHITE)] : []),
          ],
        }
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
    {
      // Puffs up and croaks.
      id: "croak",
      length: 30,
      frame: (tick) => {
        const step = tick % 10
        const loud = step < 4

        return {
          scaleX: loud ? 1.15 : 1,
          tint: { y: loud ? "#f3ffc4" : "#d9f2a0" },
          pixels: loud
            ? [17, 19, 21].flatMap((y, index) => [
                px(20 + step + (index % 2), y, "#d9f2a0"),
                px(3 - step - (index % 2), y, "#d9f2a0"),
              ])
            : [],
        }
      },
    },
    {
      // Bobs on a lily pad.
      id: "lily",
      length: 26,
      frame: (tick) => ({
        dy: -1 + (Math.sin(tick / 4) > 0 ? 0 : -1),
        pixels: [
          ...Array.from({ length: 18 }, (_, x) => px(x + 3, 23, "#2f8f4a")),
          ...(tick % 8 < 4 ? [px(0, 23, BLUE), px(23, 23, BLUE)] : [px(1, 22, BLUE), px(22, 22, BLUE)]),
        ],
      }),
    },
    {
      // Dances in the rain.
      id: "raindance",
      length: 32,
      frame: (tick) => ({
        dy: at([0, -1, -2, -1], tick),
        flip: (tick >> 3) % 2 === 1,
        pixels: falling(tick, [1, 5, 9, 13, 17, 21], 24, [BLUE]),
      }),
    },
    {
      // Follows a fly round and round with its eyes.
      id: "stare",
      length: 26,
      frame: (tick, sprite) => {
        const x = 11.5 + Math.cos(tick / 4) * 10
        const y = 8 + Math.sin(tick / 4) * 5

        return {
          rowDx: head(sprite, x > 14 ? 1 : x < 9 ? -1 : 0),
          pixels: [px(x, y, WHITE), px(x + (tick % 2 ? 1 : -1), y - 1, GREY)],
        }
      },
    },
    {
      // Blows a bubble until it pops.
      id: "bubble",
      length: 32,
      frame: (tick) => {
        const step = tick % 32
        const radius = step < 24 ? 1 + step / 6 : (step - 22) * 2

        return {
          closed: step < 24,
          pixels: ring(0, {
            count: step < 24 ? 10 : 4,
            rx: radius,
            ry: radius,
            x: 11.5,
            y: 9 - (step < 24 ? radius : 4),
            speed: 0,
            colors: [ICE],
          }),
        }
      },
    },
    {
      // Swims with long, lazy strokes.
      id: "swim",
      length: 38,
      frame: (tick) => ({
        dx: Math.round(Math.sin(tick / 6) * 3),
        scaleX: 1 + Math.abs(Math.cos(tick / 3)) * 0.15,
        flip: Math.cos(tick / 6) < 0,
        pixels: Array.from({ length: 12 }, (_, wave) => px(wave * 2 + (tick % 2), 19, BLUE)),
      }),
    },
    {
      // Leaps clean off the stage and lands back on it.
      id: "leap",
      length: 32,
      frame: (tick) => {
        const step = tick % 32

        if (step < 4) return { scaleY: 0.75 }

        if (step < 20) return { dy: step < 12 ? -(step - 4) * 4 : -32 + (step - 12) * 4 }

        if (step < 23) return { scaleY: 0.7, pixels: [px(2, 23, GREY), px(21, 23, GREY)] }

        return {}
      },
    },
    {
      // Basks in the sun.
      id: "sunbathe",
      length: 32,
      frame: (tick) => ({
        closed: true,
        scaleY: 0.92,
        tint: { g: "#6fd07a" },
        pixels: [
          ...glyph(["###", "###", "###"], 19, 1, GOLD),
          ...(tick % 8 < 4
            ? [px(18, 0, GOLD), px(22, 0, GOLD), px(18, 4, GOLD), px(22, 4, GOLD)]
            : [px(20, 0, GOLD), px(17, 2, GOLD), px(20, 5, GOLD), px(23, 2, GOLD)]),
        ],
      }),
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
        const x = Math.round(11.5 + Math.cos(tick / 3) * 10)
        const y = Math.round(9 + Math.sin(tick / 3) * 3)

        return {
          pixels: [px(x, y, "#d9dbe6"), px(x + 1, y, "#d9dbe6"), px(x, y + 1, "#a9adc2"), px(x + 1, y + 1, "#d9dbe6")],
        }
      },
    },
    {
      // Hovers on a sputtering jetpack.
      id: "jetpack",
      length: 30,
      frame: (tick) => {
        const dy = -4 + Math.round(Math.sin(tick / 3))

        return {
          dy,
          pixels: [9, 14].flatMap((x, index) => [px(x, 24 + dy, ORANGE), px(x, 25 + dy + ((tick + index) % 2), GOLD)]),
        }
      },
    },
    {
      // Plants a flag and salutes it.
      id: "flag",
      length: 32,
      frame: (tick) => ({
        dy: tick % 16 < 2 ? -1 : 0,
        pixels: [
          ...Array.from({ length: 19 }, (_, y) => px(1, y + 5, STEEL)),
          ...[0, 1, 2].flatMap((row) =>
            Array.from({ length: at([3, 2, 3, 4], (tick >> 1) + row) }, (_, column) => px(2 + column, 5 + row, ORANGE)),
          ),
        ],
      }),
    },
    {
      // Gazes around at twinkling stars.
      id: "stargaze",
      length: 36,
      frame: (tick, sprite) => ({
        rowDx: head(sprite, at([-1, -1, 0, 1, 1, 0], tick >> 2)),
        pixels: Array.from({ length: 8 }, (_, star) =>
          (tick + star * 3) % 8 < 5 ? [px(hash(star, 1) % 24, hash(star, 2) % 8, star % 3 ? WHITE : GOLD)] : [],
        ).flat(),
      }),
    },
    {
      // Watches a saucer pass overhead.
      id: "ufo",
      length: 34,
      frame: (tick, sprite) => {
        const x = 24 - (tick % 34)

        return {
          rowDx: head(sprite, x + 2 > 11 ? 1 : -1),
          pixels: [...glyph(UFO, x, 1, VIOLET), px(x + 2, 0, GOLD), px(x + 2, 3 + (tick % 3), "#eaff6b")],
        }
      },
    },
    {
      // Moonwalks backward across the stage.
      id: "moonwalk",
      length: 32,
      frame: (tick) => ({
        dx: 3 - Math.round(((tick % 32) / 32) * 6),
        rowDx: (row) => (row >= 14 ? ((tick >> 1) % 2 ? 1 : -1) : 0),
      }),
    },
    {
      // Radios home.
      id: "comms",
      length: 30,
      frame: (tick) => ({
        tint: { e: tick % 4 < 2 ? "#8fd3ff" : "#ffffff" },
        pixels: [0, 3].flatMap((delay) => {
          const reach = (tick + delay) % 6

          return [px(19 + reach, 10, GREEN), px(20 + reach, 12, GREEN), px(19 + reach, 14, GREEN)]
        }),
      }),
    },
    {
      // Spins out of control in zero gravity.
      id: "spinout",
      length: 32,
      frame: (tick) => {
        const turn = Math.cos((tick % 16) * (Math.PI / 8))

        return {
          scaleX: Math.max(0.15, Math.abs(turn)),
          flip: turn < 0,
          flipY: (tick >> 4) % 2 === 1,
          dy: -3 + Math.round(Math.sin(tick / 5) * 2),
        }
      },
    },
    {
      // Ducks as meteors streak past.
      id: "meteors",
      length: 24,
      frame: (tick) => {
        const step = tick % 12
        const x = 23 - step * 2

        return {
          scaleY: step >= 4 && step < 9 ? 0.8 : 1,
          pixels: [px(x, step, GOLD), px(x + 1, step - 1, ORANGE), px(x + 2, step - 2, "#993c1d")],
        }
      },
    },
  ],
  hoot: [
    {
      // Swivels its head far to each side.
      id: "swivel",
      length: 24,
      frame: (tick, sprite) => ({ rowDx: head(sprite, at([0, 1, 2, 2, 2, 1, 0, -1, -2, -2, -2, -1], tick >> 1)) }),
    },
    {
      // Hoots a little tune.
      id: "tune",
      length: 32,
      frame: (tick) => ({
        scaleY: tick % 8 < 2 ? 0.92 : 1,
        pixels: [...glyph(NOTE, 20, 8 - (tick % 8), GOLD), ...glyph(NOTE, 1, 8 - ((tick + 4) % 8), BLUE)],
      }),
    },
    {
      // Reads a book line by line.
      id: "read",
      length: 32,
      frame: (tick, sprite) => ({
        rowDx: head(sprite, at([-1, -1, 0, 0, 1, 1, 0, 0], tick >> 1)),
        pixels: glyph([tick % 10 < 2 ? "#....#" : "##..##", "######"], 9, 21, "#e6e6f0"),
      }),
    },
    {
      // Wears a graduation cap with a swinging tassel.
      id: "scholar",
      length: 32,
      frame: (tick) => {
        const swing = at([0, 1, 1, 0], tick >> 1)

        return {
          pixels: [
            ...Array.from({ length: 10 }, (_, x) => px(x + 7, 8, "#5a6bc0")),
            ...Array.from({ length: 6 }, (_, x) => px(x + 9, 7, "#5a6bc0")),
            px(17 + swing, 9, GOLD),
            px(17 + swing, 10, GOLD),
          ],
        }
      },
    },
    {
      // Flaps up off the ground.
      id: "flap",
      length: 32,
      frame: (tick) => {
        const up = (tick >> 1) % 2 === 0

        return { scaleX: up ? 1.25 : 0.95, dy: -3 + (up ? -1 : 1) }
      },
    },
    {
      // Keeps watch under the moon, eyes aglow.
      id: "night",
      length: 40,
      frame: (tick) => ({
        closed: blink(tick, 20),
        tint: { w: at(["#fffbe8", "#fff1a8", "#ffe36b", "#fff1a8"], tick >> 2) },
        pixels: [
          ...glyph(MOON, 1, 1, "#fff6c2"),
          ...(tick % 6 < 4 ? [px(20, 2, WHITE)] : []),
          ...(tick % 8 < 5 ? [px(16, 5, WHITE)] : []),
        ],
      }),
    },
    {
      // Pecks up seeds until none are left.
      id: "peck",
      length: 36,
      frame: (tick, sprite) => {
        const step = tick % 12
        const down = step < 2 ? 2 : step < 4 ? 1 : 0

        return {
          rowDy: (row) => (row < sprite.neck ? down : 0),
          pixels: [1, 22, 3].slice(0, 3 - Math.floor((tick % 36) / 12)).map((x) => px(x, 23, "#e8c99a")),
        }
      },
    },
    {
      // Puffs up wide-eyed at a sudden noise, then shivers.
      id: "startle",
      length: 32,
      frame: (tick) => {
        const step = tick % 32

        if (step < 6) return {}

        if (step < 20) return { scaleX: 1.1, scaleY: 1.08, tint: { w: "#ffe36b" }, pixels: glyph(BANG, 21, 2, GOLD) }

        return { dx: tick % 2 ? 1 : -1 }
      },
    },
    {
      // Shakes loose a few feathers that drift down.
      id: "feathers",
      length: 32,
      frame: (tick) => {
        const step = tick % 32

        return {
          dx: step < 6 ? (step % 2 ? 1 : -1) : 0,
          pixels:
            step < 6
              ? []
              : [2, 21, 5].flatMap((x, index) => {
                  const y = 6 + (step - 6) + index * 2

                  return [px(x + Math.sin((step + index * 4) / 2) * 2, y, index % 2 ? "#e8c99a" : "#8a5a3c")]
                }),
        }
      },
    },
    {
      // Sways on a branch as leaves fall.
      id: "perch",
      length: 38,
      frame: (tick) => ({
        rowDx: lean(Math.sin(tick / 6) * 1.5),
        pixels: [
          ...[0, 1, 2, 3, 4, 5, 6, 17, 18, 19, 20, 21, 22, 23].map((x) => px(x, 23, "#8a5a3c")),
          ...[0, 1].map((leaf) =>
            px(3 + leaf * 17 + Math.sin((tick + leaf * 7) / 3) * 2, (tick + leaf * 9) % 22, GREEN),
          ),
        ],
      }),
    },
  ],
} satisfies Repertoire

const PANEL = "#3a4a6b"

const NAVY = "#22355e"

const TERMINAL = "#3df2c8"

const SMOKE = "#d9dbe6"

const WOOD = "#8a5a3c"

const fill = (x: number, y: number, width: number, height: number, color: string): Pixel[] =>
  Array.from({ length: width * height }, (_, index) => px(x + (index % width), y + Math.floor(index / width), color))

const outline = (x: number, y: number, width: number, height: number, color: string): Pixel[] =>
  fill(x, y, width, height, color).filter(
    (pixel) => pixel[0] === x || pixel[0] === x + width - 1 || pixel[1] === y || pixel[1] === y + height - 1,
  )

/** A chip seen from above, legs out both sides. */
const chip = (x: number, y: number): Pixel[] => [
  ...[0, 2].flatMap((row) => [px(x, y + row, STEEL), px(x + 3, y + row, STEEL)]),
  ...fill(x + 1, y, 2, 3, PANEL),
  px(x + 1, y, GOLD),
]

/** A keyboard strip whose keys light as they are struck. */
const keyboard = (x: number, y: number, width: number, struck: readonly number[]): Pixel[] => [
  ...fill(x, y, width, 2, GREY),
  ...struck.map((key) => px(x + (((key % width) + width) % width), y, WHITE)),
]

/** The straight run of pixels from one point to another. */
const wire = (from: readonly [number, number], to: readonly [number, number], color: string): Pixel[] => {
  const steps = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]), 1)

  return Array.from({ length: steps + 1 }, (_, index) =>
    px(from[0] + ((to[0] - from[0]) * index) / steps, from[1] + ((to[1] - from[1]) * index) / steps, color),
  )
}

const ARROW = ["#..", "##.", "###", ".#."]

const ZED = ["###", ".#.", "###"]

const BULB = [".##.", "####", "####", ".##."]

const LENS = [".###.", "#...#", "#...#", "#...#", ".###."]

const KEY = ["##....", "#.####", "##..#."]

const DIGITS = [ZERO, ONE, ["###", ".##", "###"], ["#.#", "###", "..#"], ["###", "##.", "###"], ["##.", ".#.", ".##"]]

const MORSE = "###.#.###.#...###.###.###...###.#.#...#......"

/** Three animations of each character at work on something technical, none shared with another. */
export const tech = {
  bolt: [
    {
      // A cable drops in, plugs into its side, and charge runs down the line.
      id: "plugin",
      length: 40,
      frame: (tick) => {
        const step = tick % 40
        const path = [...wire([22, 0], [22, 20], GREY), ...wire([21, 20], [20, 20], GREY)]
        const plugged = step >= 16

        return {
          dx: step === 16 || step === 17 ? -1 : 0,
          tint: plugged ? { e: tick % 2 ? "#ffffff" : "#3df2c8", a: GOLD, y: tick % 4 < 2 ? GOLD : GREEN } : undefined,
          pixels: [
            ...path.slice(0, Math.round(step * 1.5)),
            ...(plugged ? [at(path, tick * 2), at(path, tick * 2 + 11)].map((spot) => px(spot[0], spot[1], GOLD)) : []),
          ],
        }
      },
    },
    {
      // Solders a chip at its feet: the iron dips, smoke curls, sparks jump.
      id: "solder",
      length: 36,
      frame: (tick, sprite) => {
        const dip = tick % 8 < 4 ? 0 : -1

        return {
          rowDx: head(sprite, -1),
          tint: { e: tick % 8 < 4 ? ORANGE : "#3df2c8" },
          pixels: [
            ...chip(0, 21),
            ...wire([3, 15 + dip], [1, 19 + dip], STEEL),
            px(3, 14 + dip, BLUE),
            px(1, 20 + dip, tick % 2 ? GOLD : ORANGE),
            ...rising(tick, [1, 2], 18, 10, [SMOKE]),
            ...(tick % 8 === 0 || tick % 8 === 1 ? [px(0, 20, GOLD), px(3, 20, GOLD)] : []),
          ],
        }
      },
    },
    {
      // Hammers a keyboard while lines of output fill a terminal overhead.
      id: "typist",
      length: 44,
      frame: (tick) => {
        const step = tick % 44
        const widths = [10, 7, 12]

        return {
          closed: blink(tick, 22),
          pixels: [
            ...widths.flatMap((width, line) => {
              const typed = Math.max(0, Math.min(width, step - widths.slice(0, line).reduce((sum, w) => sum + w, 0)))

              return [
                ...fill(5, 1 + line * 2, typed, 1, TERMINAL),
                ...(typed > 0 && typed < width && tick % 2 ? [px(5 + typed, 1 + line * 2, WHITE)] : []),
              ]
            }),
            ...keyboard(6, 22, 12, [hash(tick, 1), hash(tick, 5)]),
          ],
        }
      },
    },
  ],
  boo: [
    {
      // Shrinks, slips into a monitor, peers out of the screen, and climbs back out.
      id: "possess",
      length: 44,
      frame: (tick) => {
        const step = tick % 44
        const inside = step >= 14 && step < 32
        const size = step < 8 ? 1 - step / 10 : step >= 38 ? 0.2 + (step - 38) / 7.5 : 0.2
        const lift = step < 8 || step >= 38 ? 0 : step < 14 ? (step - 8) * 3 : step >= 32 ? (38 - step) * 3 : 40

        return {
          scaleX: size,
          scaleY: size,
          dy: -lift,
          pixels: [
            ...outline(7, 0, 10, 7, STEEL),
            ...fill(11, 7, 2, 1, STEEL),
            ...(inside
              ? [
                  ...fill(8, 1, 8, 5, NAVY),
                  ...(blink(tick, 9) ? [] : [px(10, 3, WHITE), px(13, 3, WHITE)]),
                  px(9, 4, PINK),
                  px(14, 4, PINK),
                ]
              : []),
          ],
        }
      },
    },
    {
      // Chases a mouse pointer that will not hold still.
      id: "cursor",
      length: 48,
      frame: (tick) => {
        const x = 10 + Math.cos(tick / 5) * 9
        const y = 3 + Math.sin(tick / 3) * 2

        return {
          dx: Math.round(Math.cos((tick - 4) / 5) * 3),
          rowDx: lean(Math.cos((tick - 2) / 5) * 2),
          pixels: [
            ...glyph(ARROW, x, y, WHITE),
            ...(tick % 16 < 3 ? [px(x - 1, y - 1, GOLD), px(x + 3, y, GOLD), px(x + 1, y + 4, GOLD)] : []),
          ],
        }
      },
    },
    {
      // Swallows a floppy disk whole, and the bits float off.
      id: "savefile",
      length: 40,
      frame: (tick) => {
        const step = tick % 40
        const y = step - 5

        return {
          dy: step >= 14 && step < 18 ? 1 : 0,
          tint: step >= 14 && step < 20 ? { w: ICE } : undefined,
          pixels:
            step < 14
              ? [...fill(9, y, 5, 5, BLUE), ...fill(10, y, 3, 2, STEEL), ...fill(10, y + 3, 3, 2, WHITE)]
              : step < 18
                ? []
                : [0, 1].flatMap((side) => glyph((step + side) % 8 < 4 ? ZERO : ONE, side * 21, 20 - (step - 18), ICE)),
        }
      },
    },
  ],
  mochi: [
    {
      // Strolls back and forth across a keyboard, typing nonsense.
      id: "keywalk",
      length: 50,
      frame: (tick) => {
        const dx = Math.round(Math.sin(tick / 8) * 4)

        return {
          dx,
          dy: tick % 4 < 2 ? 0 : -1,
          pixels: [
            ...rising(tick, [6 + dx, 12 + dx, 17 + dx], 7, 7, HUES.slice(tick % 5)),
            ...keyboard(0, 22, 24, [6 + dx + (tick % 4 < 2 ? 0 : 3), 15 + dx + (tick % 4 < 2 ? 2 : 0)]),
          ],
        }
      },
    },
    {
      // A computer mouse scurries past and gets pounced on.
      id: "mousehunt",
      length: 44,
      frame: (tick, sprite) => {
        const step = tick % 44
        const x = Math.round(step < 18 ? step * 0.6 - 5 : step < 22 ? 6 : (step - 22) * 1.2 + 6)
        const pounce = step >= 14 && step < 18 ? 3 : 0

        return {
          dy: -pounce,
          scaleY: step >= 18 && step < 22 ? 0.85 : 1,
          rowDx: head(sprite, Math.sign(x + 2 - 11)),
          pixels: [
            ...fill(x, 22, 4, 2, STEEL),
            px(x + 3, 22, step >= 18 && step < 22 ? RED : WHITE),
            px(x - 1, 23, GREY),
            px(x - 2, 22, GREY),
            px(x - 3, 23, GREY),
          ],
        }
      },
    },
    {
      // Asleep against a warm laptop, soaking up the heat.
      id: "laptopnap",
      length: 40,
      frame: (tick) => ({
        closed: true,
        scaleY: 0.86 + Math.sin(tick / 6) * 0.04,
        dx: 1,
        pixels: [
          ...fill(0, 23, 24, 1, STEEL),
          ...fill(22, 12, 2, 11, STEEL),
          ...fill(21, 13, 1, 9, tick % 12 < 6 ? TERMINAL : "#b6fff0"),
          ...[0, 1].flatMap((z) => glyph(ZED, 0 + z * 2, 12 - ((tick + z * 8) % 13), VIOLET)),
        ],
      }),
    },
  ],
  merl: [
    {
      // Solders a chip with the tip of a wand; the smoke comes out in colors.
      id: "wandsolder",
      length: 36,
      frame: (tick, sprite) => {
        const dip = tick % 6 < 3 ? 0 : 1

        return {
          rowDx: head(sprite, tick % 12 < 6 ? 1 : 0),
          tint: { s: at(HUES, tick >> 1) },
          pixels: [
            ...chip(20, 21),
            ...wire([20, 13 + dip], [22, 18 + dip], WOOD),
            px(22, 19 + dip, at(HUES, tick)),
            ...rising(tick, [21, 22, 23], 17, 9, HUES),
            ...(tick % 6 === 3 ? [px(20, 20, GOLD), px(23, 19, WHITE)] : []),
          ],
        }
      },
    },
    {
      // Reads the future off an oscilloscope.
      id: "scry",
      length: 40,
      frame: (tick, sprite) => {
        const swing = 1 + Math.abs(Math.sin(tick / 10)) * 1.5

        return {
          rowDx: head(sprite, at([0, 0, 1, 0, 0, -1], tick >> 2)),
          pixels: [
            ...outline(5, 0, 14, 8, STEEL),
            ...Array.from({ length: 12 }, (_, x) => px(6 + x, 3.5 + Math.sin((x + tick) / 1.6) * swing, GREEN)),
            px(20, 2, RED),
            px(20, 5, tick % 4 < 2 ? GOLD : GREY),
          ],
        }
      },
    },
    {
      // Floats a chip up off the bench and sets it gently back down.
      id: "levichip",
      length: 40,
      frame: (tick, sprite) => {
        const lift = Math.round(((1 - Math.cos(((tick % 40) / 40) * Math.PI * 2)) / 2) * 12)

        return {
          rowDx: head(sprite, lift > 6 ? -1 : 0),
          tint: { s: tick % 2 ? GOLD : WHITE },
          pixels: [
            ...chip(0, 20 - lift),
            ...Array.from({ length: Math.floor(lift / 2) }, (_, dot) =>
              px(1 + ((dot + tick) % 2), 23 - dot * 2, VIOLET),
            ),
            ...(lift > 3 ? [px(0, 19 - lift, at(HUES, tick)), px(3, 23 - lift, at(HUES, tick + 3))] : []),
          ],
        }
      },
    },
  ],
  goop: [
    {
      // Cranks a wrench round and round a nut balanced on its head.
      id: "wrench",
      length: 32,
      frame: (tick) => {
        const angle = (Math.floor(tick / 2) % 8) * (Math.PI / 4)

        return {
          scaleY: 1 + Math.sin(tick / 2) * 0.04,
          dx: at([0, 1, 0, -1], tick >> 1),
          pixels: [
            ...fill(11, 12, 2, 2, GREY),
            ...Array.from({ length: 6 }, (_, link) =>
              px(11.5 + Math.cos(angle) * (link + 2), 10.5 + Math.sin(angle) * (link + 2), STEEL),
            ),
            ...fill(11, 10, 2, 2, GOLD),
          ],
        }
      },
    },
    {
      // Types by bouncing on the keys, one squelch at a time.
      id: "keybounce",
      length: 36,
      frame: (tick) => {
        const phase = tick % 12
        const bounce = Math.floor(tick / 12)
        const landed = phase < 2

        return {
          dy: -Math.round(Math.sin((phase / 12) * Math.PI) * 6),
          scaleY: landed ? 0.8 : 1,
          scaleX: landed ? 1.1 : 1,
          pixels: [
            ...fill(2 + (hash(bounce, 3) % 18), 10 - phase, 2, 2, at(HUES, bounce)),
            ...keyboard(2, 22, 20, landed ? [5, 8, 11, 14] : []),
          ],
        }
      },
    },
    {
      // Sits in a circuit as the wire: current runs through it and lights a bulb.
      id: "conductor",
      length: 40,
      frame: (tick) => {
        const phase = tick % 10
        const lit = phase >= 6

        return {
          tint: phase >= 4 && phase < 7 ? { g: "#8ff0a0", l: "#ffffff" } : undefined,
          pixels: [
            ...fill(0, 21, 4, 1, ORANGE),
            ...fill(20, 21, 4, 1, ORANGE),
            ...(phase < 4 ? [px(phase, 21, WHITE), px(23 - phase, 21, WHITE)] : []),
            ...fill(11, 10, 2, 4, STEEL),
            ...glyph(BULB, 10, 6, lit ? GOLD : "#8a7a3a"),
            ...(lit ? [px(9, 5, GOLD), px(14, 5, GOLD), px(8, 8, GOLD), px(15, 8, GOLD), px(11, 4, GOLD)] : []),
          ],
        }
      },
    },
  ],
  cap: [
    {
      // Its roots are a network: packets run out along them and the nodes answer.
      id: "network",
      length: 40,
      frame: (tick) => ({
        rowDx: lean(Math.sin(tick / 8)),
        tint: tick % 8 < 2 ? { w: BLUE } : undefined,
        pixels: [
          ...fill(0, 23, 8, 1, STEEL),
          ...fill(16, 23, 8, 1, STEEL),
          ...[2, 5, 18, 21].flatMap((x, node) => [
            px(x, 22, STEEL),
            ...(node % 3 ? [] : [px(x, 21, STEEL)]),
            px(x, node % 3 ? 21 : 20, hash(tick >> 2, node) % 3 ? GREEN : BLUE),
          ]),
          px(7 - (tick % 8), 23, GOLD),
          px(16 + (tick % 8), 23, GOLD),
        ],
      }),
    },
    {
      // Broadcasts wifi off the top of its cap.
      id: "hotspot",
      length: 36,
      frame: (tick) => {
        const bars = (tick >> 2) % 4

        return {
          dy: bars === 0 ? 1 : 0,
          tint: bars === 3 ? { w: BLUE } : undefined,
          pixels: [3, 5, 7].slice(0, bars).flatMap((radius) =>
            Array.from({ length: 9 }, (_, index) => {
              const angle = (-150 + index * 15) * (Math.PI / 180)

              return px(11.5 + Math.cos(angle) * radius, 8.5 + Math.sin(angle) * radius, BLUE)
            }),
          ),
        }
      },
    },
    {
      // Drives a screw home with a screwdriver bigger than it is.
      id: "screwdriver",
      length: 40,
      frame: (tick) => {
        const step = tick % 40
        const top = 19 + Math.min(3, Math.floor(step / 9))
        const turn = tick % 4 < 2 ? 0 : 1

        return {
          rowDx: lean(1 + (tick % 4 < 2 ? 0 : 0.6)),
          pixels: [
            ...fill(20, 23, 4, 1, GREY),
            ...fill(21, top, 2, 23 - top, STEEL),
            ...fill(21 + turn, top - 5, 1, 5, STEEL),
            ...fill(20, top - 9, 4, 4, RED),
            ...fill(20 + (tick % 4), top - 9, 1, 4, GOLD),
            ...(step >= 36 ? [px(20, 21, GOLD), px(23, 21, GOLD), px(19, 22, WHITE)] : []),
          ],
        }
      },
    },
  ],
  sirbit: [
    {
      // Raises a firewall overhead, brick by brick, and the bad packets break on it.
      id: "firewall",
      length: 44,
      frame: (tick) => {
        const step = tick % 44
        const built = Math.min(10, Math.floor(step / 2))

        return {
          dy: step > 20 && tick % 8 < 2 ? -1 : 0,
          pixels: [
            ...Array.from({ length: built }, (_, brick) => [
              ...fill(2 + brick * 2, 5, 2, 1, brick % 2 ? ORANGE : "#d0603a"),
              ...fill(2 + brick * 2, 6, 2, 1, brick % 2 ? "#d0603a" : ORANGE),
            ]).flat(),
            ...[4, 9, 14, 19].map((x, index) => {
              const y = (tick + index * 3) % 6

              return px(x, y, y === 4 && x < 2 + built * 2 ? GOLD : RED)
            }),
          ],
        }
      },
    },
    {
      // Drops the visor and welds, throwing sparks.
      id: "weld",
      length: 36,
      frame: (tick) => {
        const welding = tick % 36 < 26

        return {
          tint: welding ? { e: tick % 2 ? BLUE : WHITE } : undefined,
          pixels: [
            ...fill(0, 22, 4, 1, GREY),
            px(3, 19, STEEL),
            px(2, 20, STEEL),
            ...(welding
              ? [
                  px(1, 21, tick % 2 ? WHITE : ICE),
                  ...(tick % 4 < 2 ? [px(0, 21, BLUE), px(2, 21, BLUE), px(1, 20, BLUE)] : []),
                  ...[0, 1, 2, 3].map((spark) =>
                    px(hash(tick, spark) % 4, 14 + (hash(tick, spark + 9) % 6), spark % 2 ? GOLD : ORANGE),
                  ),
                ]
              : rising(tick, [1, 2], 20, 8, [SMOKE])),
          ],
        }
      },
    },
    {
      // Carries a key to a padlock and locks the secrets away.
      id: "encrypt",
      length: 44,
      frame: (tick) => {
        const step = tick % 44
        const locked = step >= 22

        return {
          dy: step >= 20 && step < 24 ? -1 : 0,
          pixels: [
            ...[px(18, 2, STEEL), px(18, 1, STEEL), px(19, 0, STEEL), px(20, 0, STEEL), px(21, 1, STEEL)],
            ...(locked ? [px(21, 2, STEEL)] : []),
            ...fill(17, 3, 6, 4, locked ? GOLD : GREY),
            px(19, 5, NAVY),
            px(20, 5, NAVY),
            ...(locked ? [] : glyph(KEY, Math.min(11, step / 2), 3, GOLD)),
            ...(locked
              ? Array.from({ length: 8 }, (_, bit) => px(1 + bit * 2, 4, hash(tick >> 1, bit) % 2 ? TERMINAL : NAVY))
              : []),
          ],
        }
      },
    },
  ],
  ribbit: [
    {
      // A bug crawls across the monitor; one flick of the tongue and it is fixed.
      id: "debug",
      length: 40,
      frame: (tick) => {
        const step = tick % 20
        const round = Math.floor(tick / 20)

        const bug = [
          7 + ((Math.floor(Math.min(step, 12) / 2) + (hash(round, 1) % 5)) % 10),
          2 + (hash(round, 2) % 5),
        ] as const

        return {
          closed: step >= 16,
          dy: step >= 16 && step < 18 ? 1 : 0,
          pixels: [
            ...outline(4, 0, 16, 10, STEEL),
            ...fill(10, 10, 4, 1, STEEL),
            ...fill(6, 2, 6, 1, "#2f7a45"),
            ...fill(6, 4, 9, 1, "#2f7a45"),
            ...fill(6, 6, 5, 1, "#2f7a45"),
            ...(step < 16 ? [px(bug[0], bug[1], RED), px(bug[0] + 1, bug[1], step % 2 ? RED : ORANGE)] : []),
            ...(step >= 12 && step < 16 ? wire([11, 18], bug, PINK) : []),
          ],
        }
      },
    },
    {
      // Taps out a message on a telegraph key, dots and dashes streaming overhead.
      id: "morse",
      length: MORSE.length,
      frame: (tick) => {
        const down = at(MORSE.split(""), tick) === "#"

        return {
          tint: down ? { y: WHITE } : undefined,
          pixels: [
            ...MORSE.split("").flatMap((cell, index): Pixel[] => {
              const x = 19 - ((((tick - index) % MORSE.length) + MORSE.length) % MORSE.length)

              return cell === "#" && x >= 0 ? [px(x, 3, GOLD)] : []
            }),
            ...fill(20, 22, 4, 1, WOOD),
            ...fill(20, down ? 21 : 20, 4, 1, STEEL),
            px(23, down ? 20 : 19, RED),
            ...(down ? [px(21, 18, GOLD), px(22, 17, GOLD)] : []),
          ],
        }
      },
    },
    {
      // Clips on both probes and watches the meter settle.
      id: "multimeter",
      length: 40,
      frame: (tick) => {
        const step = tick % 40
        const settled = step >= 26
        const reading = settled ? 4 : Math.floor(tick / 3)
        const twitch = settled ? 0 : tick % 2

        return {
          closed: blink(tick, 14),
          dy: settled && step < 30 ? -1 : 0,
          pixels: [
            ...fill(6, 0, 12, 8, GOLD),
            ...fill(7, 1, 10, 5, NAVY),
            ...glyph(at(DIGITS, reading), 8, 2, settled ? GREEN : TERMINAL),
            ...glyph(at(DIGITS, reading * 3 + 1), 13, 2, settled ? GREEN : TERMINAL),
            px(12, 4, settled ? GREEN : TERMINAL),
            px(11, 6, RED),
            ...wire([5, 8], [3, 10], RED),
            ...wire([3, 11], [3, 17 + twitch], RED),
            px(3, 18 + twitch, STEEL),
            ...wire([18, 8], [20, 10], GREY),
            ...wire([20, 11], [20, 18 - twitch], GREY),
            px(20, 19 - twitch, STEEL),
          ],
        }
      },
    },
  ],
  orbit: [
    {
      // Floats up to a satellite with a dead panel and knocks it back to life.
      id: "satellite",
      length: 44,
      frame: (tick) => {
        const step = tick % 44
        const x = 10 + Math.round(Math.sin(tick / 10) * 2)
        const fixed = step >= 30

        return {
          dy: Math.round(Math.sin(tick / 5)) - 1,
          pixels: [
            ...fill(x - 4, 2, 3, 2, BLUE),
            ...fill(x + 4, 2, 3, 2, fixed || tick % 10 < 3 ? BLUE : GREY),
            px(x - 1, 3, GREY),
            px(x + 3, 3, GREY),
            ...fill(x, 2, 3, 3, STEEL),
            px(x + 1, 1, STEEL),
            px(x + 1, 0, tick % 6 < 3 ? RED : GREY),
            ...(!fixed && tick % 8 < 2 ? [px(x + 1, 5, GOLD), px(x, 6, GOLD), px(x + 2, 6, GOLD)] : []),
            ...(fixed ? [px(x - 5, 0, GREEN), px(x + 7, 0, GREEN)].filter(() => tick % 4 < 2) : []),
          ],
        }
      },
    },
    {
      // Works a mission console: a radar sweeps and the buttons blink.
      id: "console",
      length: 36,
      frame: (tick) => ({
        tint: { e: at(["#8fd3ff", GREEN, GOLD], tick >> 2) },
        pixels: [
          ...ring(0, { count: 10, rx: 3, ry: 3, x: 3, y: 4, speed: 0, colors: ["#2f7a45"] }),
          ...[1, 2, 3].map((reach) => px(3 + Math.cos(tick / 3) * reach, 4 + Math.sin(tick / 3) * reach, GREEN)),
          ...fill(0, 21, 24, 3, PANEL),
          ...fill(0, 21, 24, 1, STEEL),
          ...[2, 6, 10, 14, 18, 22].map((x, button) =>
            px(x, 22, hash(tick >> 2, button) % 3 ? at(HUES, button) : WHITE),
          ),
        ],
      }),
    },
    {
      // Steers a little rover across the ground by remote.
      id: "rover",
      length: 48,
      frame: (tick, sprite) => {
        const x = Math.round((tick % 48) * 0.6) - 5

        return {
          rowDx: head(sprite, Math.sign(x + 2 - 11)),
          pixels: [
            ...[0, 4, 8, 12, 16, 20].map((dot) => px(dot + 1, 23, "#b06a3a")),
            ...fill(x, 20, 5, 2, STEEL),
            px(x, 19, BLUE),
            ...[0, 2, 4].map((wheel) => px(x + wheel, 22, tick % 2 ? GREY : WHITE)),
            px(x + 4, 19, GREY),
            px(x + 4, 18, tick % 4 < 2 ? RED : GREY),
            px(x + 4, 16 - (tick % 3), GOLD),
          ],
        }
      },
    },
  ],
  hoot: [
    {
      // Studies a blueprint as the circuit draws itself in.
      id: "schematic",
      length: 44,
      frame: (tick, sprite) => {
        const step = tick % 44

        const trace = [
          ...wire([5, 2], [9, 2], WHITE),
          ...wire([9, 3], [9, 5], WHITE),
          ...wire([10, 5], [14, 5], WHITE),
          ...wire([14, 4], [14, 2], WHITE),
          ...wire([15, 2], [18, 2], WHITE),
        ]

        return {
          rowDx: head(sprite, at([0, 1, 1, 0, -1, -1], tick >> 2)),
          pixels: [
            ...fill(3, 0, 18, 8, NAVY),
            ...outline(3, 0, 18, 8, "#3d6bd6"),
            ...trace.slice(0, step),
            ...(step > trace.length && tick % 4 < 2
              ? [px(5, 2, GOLD), px(18, 2, GOLD), px(11, 5, GOLD), px(12, 5, GOLD)]
              : []),
          ],
        }
      },
    },
    {
      // Up all night at a laptop with a coffee, nodding off and jolting awake.
      id: "allnighter",
      length: 40,
      frame: (tick) => {
        const step = tick % 40
        const nodding = step >= 24 && step < 34

        return {
          closed: nodding,
          dy: nodding ? 1 : step === 34 || step === 35 ? -1 : 0,
          tint: nodding ? undefined : { w: tick % 6 < 3 ? "#fffbe8" : ICE },
          pixels: [
            ...fill(20, 21, 4, 1, STEEL),
            ...fill(22, 15, 1, 6, STEEL),
            ...fill(21, 15, 1, 6, tick % 6 < 3 ? ICE : WHITE),
            ...fill(0, 19, 3, 4, WHITE),
            px(3, 20, WHITE),
            px(3, 21, WHITE),
            px(1, 19, WOOD),
            ...rising(tick, [0, 2], 17, 7, [SMOKE]),
          ],
        }
      },
    },
    {
      // Goes over a circuit board with a magnifying glass, pad by pad.
      id: "inspect",
      length: 44,
      frame: (tick, sprite) => {
        const x = 9 + Math.round(Math.sin(tick / 7) * 8)
        const pad = (x + 2) % 4 === 1

        return {
          rowDx: head(sprite, Math.sign(x + 2 - 11)),
          pixels: [
            ...fill(0, 22, 24, 2, "#2f7a45"),
            ...[1, 5, 9, 13, 17, 21].map((spot) => px(spot, 22, GOLD)),
            ...glyph(LENS, x, 16, STEEL),
            px(x + 5, 21, WOOD),
            px(x + 6, 22, WOOD),
            px(x + 1, 17, WHITE),
            ...(pad ? [px(x + 2, 18, GOLD), px(x + 2, 19, GOLD), px(x + 3, 18, GOLD)] : []),
          ],
        }
      },
    },
  ],
} satisfies Repertoire

/** Resting between thoughts: a slow bob and the odd blink. */
export const idle: Animation = {
  id: "idle",
  length: 26,
  frame: (tick) => ({ dy: at([0, 0, 1, 1], tick >> 1), closed: blink(tick, 26) }),
}

// A character with no animations of a kind simply has none to play.
const repertoire = (all: Repertoire, sprite: Sprite) => all[sprite.id] ?? []

export function thinking(sprite: Sprite): readonly Animation[] {
  return repertoire(own, sprite)
}

export function tinkering(sprite: Sprite): readonly Animation[] {
  return repertoire(tech, sprite)
}

/**
 * The animation to play after `previous`, never the same one twice running. The timeline cannot tell a running
 * tool from a thinking model, so thinking and technical work are drawn from one pool.
 */
export function nextAnimation(sprite: Sprite, previous: string | undefined, random: () => number) {
  const choices = [...thinking(sprite), ...tinkering(sprite)].filter((animation) => animation.id !== previous)

  return choices[Math.floor(random() * choices.length)] ?? idle
}

/** The stage pixels of one frame, back to front. */
export function paint(sprite: Sprite, frame: Frame): Pixel[] {
  const ledge = frame.ledge ?? STAGE + 1
  const palette = { ...sprite.palette, ...frame.tint }

  const scaleX = frame.scaleX ?? 1
  const scaleY = frame.scaleY ?? 1
  const cells = sprite.rows.map((half) => `${half}${half.split("").reverse().join("")}`)

  const span = (scale: number) =>
    Array.from({ length: Math.ceil(16 * Math.max(1, scale)) + 2 }, (_, index) => index - 1)

  // Walks the scaled sprite's own cells and reads each one back from the drawing, so growing it leaves no gaps.
  const body = span(scaleY).flatMap((down) => {
    const y = 15 - Math.ceil(16 * Math.max(1, scaleY)) + down
    const row = Math.round(15 - (15 - y) / scaleY)
    const line = cells[frame.flipY ? 15 - row : row]

    if (row < 0 || row > 15 || !line) return []

    return span(scaleX).flatMap((across): Pixel[] => {
      const x = Math.round(7.5 - Math.ceil(16 * Math.max(1, scaleX)) / 2) + across
      const column = Math.round(7.5 + (x - 7.5) / scaleX)
      const cell = line[frame.flip ? 15 - column : column]

      if (column < 0 || column > 15 || !cell || cell === ".") return []

      return [
        [
          REST.x + x + (frame.dx ?? 0) + (frame.rowDx?.(row) ?? 0),
          REST.y + y + (frame.dy ?? 0) + (frame.rowDy?.(row) ?? 0),
          palette[cell === "e" && frame.closed ? sprite.lid : cell] ?? "#ff00ff",
        ],
      ]
    })
  })

  return [...body, ...(frame.pixels ?? [])].filter(([x, y]) => x >= 0 && x < STAGE && y >= 0 && y < STAGE && y < ledge)
}
