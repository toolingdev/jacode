import { For, Match, Switch } from "solid-js"
import { defaultSprite, findSprite } from "@/mascot/sprites"
import { useMascot } from "@/mascot/store"
import { useWordmarkStyle } from "./wordmark-style"
import "./wordmark-blocks.css"

// Fork feature: the new session wordmark in colour and in motion. The letters are built from loose blocks, and the
// style chosen in Settings decides what the blocks do: drift together like the startup mark, roll through colours,
// type themselves out, and so on. Each letter draws its own blocks inside its letter group, so the blocks follow
// whatever the lodger does to the letters.

// One letter slot is four 6-unit blocks wide and seven tall: an ascender row, five rows of x-height, a descender row.
const GLYPHS = [
  [],
  [],
  ["....", ".###", "...#", "...#", "...#", "#..#", "####"],
  ["....", "####", "...#", "####", "#..#", "####", "...."],
  ["....", "####", "#...", "#...", "#...", "####", "...."],
  ["....", "####", "#..#", "#..#", "#..#", "####", "...."],
  ["...#", "####", "#..#", "#..#", "#..#", "####", "...."],
  ["....", "####", "#..#", "####", "#...", "####", "...."],
]

const COLORS = [
  "var(--v2-pink-500)",
  "var(--v2-orange-500)",
  "var(--v2-yellow-500)",
  "var(--v2-green-500)",
  "var(--v2-blue-500)",
  "var(--v2-purple-500)",
]

const total = GLYPHS.flat().join("").replaceAll(".", "").length

const blocks = GLYPHS.map((rows, slot) =>
  rows.flatMap((row, y) => [...row].flatMap((cell, x) => (cell === "#" ? [{ x, y }] : []))),
).map((letter, slot, letters) => {
  const before = letters.slice(0, slot).reduce((sum, item) => sum + item.length, 0)

  return letter.map((block, index) => {
    const order = before + index

    return {
      x: slot * 30 + block.x * 6,
      y: block.y * 6,
      // Everything a style may key its timing or colour on. Spread without randomness, so a block keeps its path
      // between renders.
      vars: {
        "--dx": `${(((order * 7) % 9) - 4) * 6}px`,
        "--dy": `${(((order * 5) % 7) - 3) * 6}px`,
        "--delay": `${((order * 37) % 12) / 10}s`,
        "--col": `${(slot - 2) * 5 + block.x}`,
        "--row": `${block.y}`,
        "--order": `${order / total}`,
        "--seed": `${(order * 37) % 34}`,
        "--spark": COLORS[(order * 5) % COLORS.length],
      },
    }
  })
})

/** The blocks of one letter slot. */
export function WordmarkBlocks(props: { slot: number }) {
  const wordmark = useWordmarkStyle()

  return (
    <g
      data-slot="wordmark-blocks"
      data-style={wordmark.chosen.style}
      style={{ "--letter": COLORS[props.slot - 2], "--slot": `${props.slot - 2}` }}
    >
      <For each={blocks[props.slot]}>
        {(block) => (
          <rect
            x={block.x}
            y={block.y}
            // A hair over the grid so neighbours meet without a seam at fractional sizes.
            width="6.1"
            height="6.1"
            style={block.vars}
          />
        )}
      </For>
    </g>
  )
}

/** What some styles draw beside the letters: the cursor that types them, or the chosen companion hopping along. */
export function WordmarkExtras() {
  const wordmark = useWordmarkStyle()
  const mascot = useMascot()
  const sprite = () => findSprite(mascot.chosen.character) ?? defaultSprite

  return (
    <Switch>
      <Match when={wordmark.chosen.style === "typed"}>
        <rect data-slot="wordmark-cursor" x="240" y="6" width="5" height="30" fill="var(--icon-base)" />
      </Match>
      <Match when={wordmark.chosen.style === "companion"}>
        <g data-slot="wordmark-companion">
          <g>
            {/* A sprite pixel is 1.5 units, so the 16-pixel character is one letter wide and stands on the x-height. */}
            <For each={sprite().rows}>
              {(half, row) => (
                <For each={[...half, ...[...half].reverse()]}>
                  {(key, column) => (
                    <rect
                      x={column() * 1.5}
                      y={row() * 1.5 - 18}
                      width="1.55"
                      height="1.55"
                      fill={sprite().palette[key] ?? "none"}
                    />
                  )}
                </For>
              )}
            </For>
          </g>
        </g>
      </Match>
    </Switch>
  )
}
