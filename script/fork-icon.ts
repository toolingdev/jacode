#!/usr/bin/env bun
import { $ } from "bun"
import { mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { deflateSync } from "node:zlib"
import { sprites } from "../packages/app/src/mascot/sprites"

// Fork feature: the fork's app icon, the mark with a companion character standing inside it.
//
//   bun script/fork-icon.ts ribbit   draw the dev channel's macOS icon with that companion
//
// The icon is pixel art on a flat tile, so it is drawn straight into a pixel buffer; `sips` and `iconutil`, which
// ship with macOS, cut the sizes. Only the macOS files of the dev channel are written.
if (process.platform !== "darwin") throw new Error("fork-icon only draws the macOS icon")

const sprite = sprites.find((item) => item.id === process.argv[2])

if (!sprite) throw new Error(`Name a companion: ${sprites.map((item) => item.id).join(", ")}`)

const SIZE = 1024
// The macOS icon grid: an 824px tile, corners rounded to 185px, centred on the canvas.
const TILE = { inset: 100, radius: 185, color: [0x17, 0x18, 0x1d] }
// The 16x20 mark at 26px a unit, centred; a companion pixel is half a unit, so its 16 columns fill the counter.
const UNIT = 26
const MARK = { x: (SIZE - 16 * UNIT) / 2, y: (SIZE - 20 * UNIT) / 2, color: [0xe9, 0xe9, 0xec] }

const pixels = new Uint8Array(SIZE * SIZE * 4)

const fill = (x: number, y: number, width: number, height: number, color: readonly number[]) => {
  for (let row = y; row < y + height; row++)
    for (let column = x; column < x + width; column++) pixels.set([...color, 255], (row * SIZE + column) * 4)
}

const half = (SIZE - TILE.inset * 2) / 2

for (let row = 0; row < SIZE; row++)
  for (let column = 0; column < SIZE; column++) {
    // Distance to the rounded tile's edge, which gives each edge pixel its share of coverage.
    const dx = Math.max(Math.abs(column + 0.5 - SIZE / 2) - half + TILE.radius, 0)
    const dy = Math.max(Math.abs(row + 0.5 - SIZE / 2) - half + TILE.radius, 0)
    const alpha = Math.min(Math.max(0.5 - (Math.hypot(dx, dy) - TILE.radius), 0), 1)

    if (alpha > 0) pixels.set([...TILE.color, Math.round(alpha * 255)], (row * SIZE + column) * 4)
  }

// The frame of the mark: a 4-unit ring around a counter 8 units wide and 12 tall.
fill(MARK.x, MARK.y, 16 * UNIT, 4 * UNIT, MARK.color)
fill(MARK.x, MARK.y + 16 * UNIT, 16 * UNIT, 4 * UNIT, MARK.color)
fill(MARK.x, MARK.y, 4 * UNIT, 20 * UNIT, MARK.color)
fill(MARK.x + 12 * UNIT, MARK.y, 4 * UNIT, 20 * UNIT, MARK.color)

// The companion stands on the counter's floor, where the mark has its shaded block.
sprite.rows.forEach((half, row) =>
  [...half, ...[...half].reverse()].forEach((key, column) => {
    const color = sprite.palette[key]

    if (!color) return
    fill(
      MARK.x + 4 * UNIT + (column * UNIT) / 2,
      MARK.y + 8 * UNIT + (row * UNIT) / 2,
      UNIT / 2,
      UNIT / 2,
      [1, 3, 5].map((start) => Number.parseInt(color.slice(start, start + 2), 16)),
    )
  }),
)

const chunk = (type: string, data: Uint8Array) => {
  const body = Buffer.concat([Buffer.from(type), data])
  const frame = Buffer.alloc(body.length + 8)
  frame.writeUInt32BE(data.length, 0)
  body.copy(frame, 4)
  frame.writeUInt32BE(Bun.hash.crc32(body), body.length + 4)

  return frame
}

const header = Buffer.alloc(13)
header.writeUInt32BE(SIZE, 0)
header.writeUInt32BE(SIZE, 4)
// 8 bits a channel, RGBA.
header.set([8, 6, 0, 0, 0], 8)

// Each scanline starts with its filter byte; 0 is no filter.
const lines = Buffer.alloc((SIZE * 4 + 1) * SIZE)
for (let row = 0; row < SIZE; row++)
  lines.set(pixels.subarray(row * SIZE * 4, (row + 1) * SIZE * 4), row * (SIZE * 4 + 1) + 1)

const work = path.join(tmpdir(), `fork-icon-${process.pid}`)

const iconset = path.join(work, "icon.iconset")

const icons = path.resolve(import.meta.dir, "../packages/desktop/icons/dev")

await mkdir(iconset, { recursive: true })

const source = path.join(work, "icon.png")

await Bun.write(
  source,
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(lines)),
    chunk("IEND", new Uint8Array()),
  ]),
)

const resize = (size: number, file: string) => $`sips -z ${size} ${size} ${source} --out ${file}`.quiet()

await Promise.all(
  [16, 32, 128, 256, 512].flatMap((size) => [
    resize(size, path.join(iconset, `icon_${size}x${size}.png`)),
    resize(size * 2, path.join(iconset, `icon_${size}x${size}@2x.png`)),
  ]),
)

await $`iconutil -c icns ${iconset} -o ${path.join(icons, "icon.icns")}`

// The unpackaged app sets its Dock icon from `dock.png`, which matches the ICNS at 128@2x.
await Promise.all([
  resize(256, path.join(icons, "dock.png")),
  resize(512, path.join(icons, "icon.png")),
  resize(256, path.join(icons, "128x128@2x.png")),
  resize(128, path.join(icons, "128x128.png")),
  resize(64, path.join(icons, "64x64.png")),
  resize(32, path.join(icons, "32x32.png")),
])

await rm(work, { recursive: true })

console.log(`Drew the dev icon with ${sprite.name} into ${icons}`)
