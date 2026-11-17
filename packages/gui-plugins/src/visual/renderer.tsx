import { CodeBlock, type Plugin } from "@opencode/plugin/gui"
import { createSignal, onCleanup, Show } from "solid-js"
import { VISUAL_COLORS, visualDocument, visualHeight, wantsChart, withChart, type VisualColors } from "./document"
import type definition from "./index"

/**
 * A theme colour as plain `rgb()`. The theme writes colours in forms such as `color-mix()`, which CSS understands
 * but a chart drawing on a canvas does not: it would draw black. Painting the colour and reading the pixel back
 * gives a form everything takes. Undefined when the colour cannot be resolved.
 */
function plainColor(value: string) {
  const probe = document.createElement("span")
  probe.style.color = value
  document.documentElement.append(probe)
  const resolved = getComputedStyle(probe).color
  probe.remove()

  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true })

  if (!context || !resolved) return undefined
  context.fillStyle = resolved
  context.fillRect(0, 0, 1, 1)
  const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data

  return `rgba(${red}, ${green}, ${blue}, ${(alpha / 255).toFixed(3)})`
}

/**
 * Fork feature: a reply can carry a live visual. A fenced code block with the language `visual` holds an HTML
 * fragment, such as a chart or a weather card, and shows as that page inside the message instead of as code. The
 * page runs in a sandboxed frame with an origin of its own: it reaches nothing of the app and nothing on the
 * network. Charts work because the app carries Chart.js and hands it to a fragment that asks for it.
 */
const setup: Plugin.Setup<typeof definition> = (ctx) => {
  // Numbers the visuals, so each frame's messages are told apart.
  let next = 0

  ctx.add(CodeBlock, {
    languages: ["visual"],
    render: (props) => {
      const id = `visual-${(next += 1)}`
      const [height, setHeight] = createSignal(160)
      const [page, setPage] = createSignal<string>()
      const dark = document.documentElement.dataset.colorScheme !== "light"

      const colors: VisualColors = Object.fromEntries(
        Object.entries(VISUAL_COLORS).map(([name, variable]) => [name, plainColor(`var(${variable})`)]),
      )

      const show = (fragment: string) => setPage(visualDocument({ fragment, id, colors, dark }))

      // The chart library is large, so it loads only for a visual that asks for it; the others show at once.
      if (wantsChart(props.code))
        // By file path: the package's export map does not list its browser build.
        void import("../../node_modules/chart.js/dist/chart.umd.min.js?raw").then(
          (library) => show(withChart(props.code, library.default)),
          () => show(props.code),
        )
      else show(props.code)

      let frame: HTMLIFrameElement | undefined

      const fit = (event: MessageEvent<{ type?: string; id?: string; height?: number } | undefined>) => {
        // Only this block's own frame sizes it; the page inside is untrusted, so the number is bounded.
        if (!frame || event.source !== frame.contentWindow) return

        if (event.data?.type !== "visual-height" || event.data.id !== id) return
        setHeight(visualHeight(Number(event.data.height) || 0))
      }

      window.addEventListener("message", fit)
      onCleanup(() => window.removeEventListener("message", fit))

      return (
        <Show when={page()} fallback={<div style={{ height: `${height()}px` }} />}>
          {(source) => (
            <iframe
              ref={frame}
              data-component="visual-block"
              title={ctx.t("title")}
              class="block w-full border-0 bg-transparent"
              // The same scheme as the page inside, or the browser paints the frame an opaque backdrop.
              style={{ height: `${height()}px`, "color-scheme": dark ? "dark" : "light" }}
              // Scripts only: no same-origin access, no forms, popups or navigation of the app.
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              srcdoc={source()}
            />
          )}
        </Show>
      )
    },
  })
}

export default setup
