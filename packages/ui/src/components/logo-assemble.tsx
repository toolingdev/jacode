import { For } from "solid-js"

// Fork feature: the mark as loose blocks that drift together, hold, and drift apart again. It stands in for the
// still mark wherever the app is waiting or empty, so those places read as alive rather than stalled.

// The 16x20 mark on a grid of 4-unit blocks: the frame is the outer ring, the shaded counter its lower inside.
const blocks = Array.from({ length: 20 }, (_, index) => ({ column: index % 4, row: Math.floor(index / 4) }))
  .filter((block) => block.row !== 1 || block.column === 0 || block.column === 3)
  .map((block, index) => ({
    ...block,
    frame: block.row === 0 || block.row === 4 || block.column === 0 || block.column === 3,
    // Spread without randomness, so a block keeps its path between renders and the server and client agree.
    dx: (((index * 7) % 9) - 4) * 1.5,
    dy: (((index * 5) % 7) - 3) * 1.5,
    delay: ((index * 37) % 12) / 10,
  }))

const styles = `
[data-component="logo-assemble"] rect {
  transform-box: fill-box;
  animation: logo-assemble 7s ease-in-out infinite both;
}
@keyframes logo-assemble {
  0%, 6% { transform: translate(var(--dx), var(--dy)); opacity: 0; }
  38%, 86% { transform: translate(0, 0); opacity: 1; }
  100% { transform: translate(var(--dx), var(--dy)); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  [data-component="logo-assemble"] rect { animation: none; }
}
`

export const AssemblingMark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-assemble"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 16 20"
      fill="none"
      overflow="visible"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <style>{styles}</style>
      <For each={blocks}>
        {(block) => (
          <rect
            x={block.column * 4}
            y={block.row * 4}
            // A hair over the grid so neighbours meet without a seam at fractional sizes.
            width="4.05"
            height="4.05"
            fill={block.frame ? "var(--icon-strong-base)" : "var(--icon-weak-base)"}
            style={{
              "--dx": `${block.dx}px`,
              "--dy": `${block.dy}px`,
              "animation-delay": `${block.delay}s`,
            }}
          />
        )}
      </For>
    </svg>
  )
}
