import { createMemo, createResource, createSignal, onCleanup, Show } from "solid-js"
import { VISUAL_COLORS, visualDocument, visualHeight, wantsChart, withChart, type VisualColors } from "./document"
import type { CardStyle, ChartStyle, WeatherCardStyle } from "./styles"

/**
 * A theme colour as plain `rgba()`. The theme writes colours in forms such as `color-mix()`, which CSS understands
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
 * One visual: an HTML fragment shown as a page in a sandboxed frame with an origin of its own. It reaches nothing
 * of the app and nothing on the network. Charts work because the app carries Chart.js and hands it to a fragment
 * that asks for it. The frame grows to the page's height unless `fixed` pins it, as the preview tiles do.
 */
export function VisualFrame(props: {
  id: string
  title: string
  fragment: string
  weather: WeatherCardStyle
  chart: ChartStyle
  card?: CardStyle
  /** The words the cards show; the settings samples, which show none of those cards, leave it out. */
  labels?: Record<string, string>
  fixed?: number
}) {
  const [height, setHeight] = createSignal(160)
  const dark = document.documentElement.dataset.colorScheme !== "light"

  const colors: VisualColors = Object.fromEntries(
    Object.entries(VISUAL_COLORS).map(([name, variable]) => [name, plainColor(`var(${variable})`)]),
  )

  // The chart library is large, so it loads only for a visual that asks for it; the others show at once.
  // The source is a word, not a boolean: a resource never loads for a false source, and a visual without a chart
  // must still resolve, to an empty library.
  const [library] = createResource(
    () => (wantsChart(props.fragment) ? "chart" : "none"),
    (wanted) =>
      wanted === "chart"
        ? // By file path: the package's export map does not list its browser build.
          import("../../node_modules/chart.js/dist/chart.umd.min.js?raw").then(
            (loaded) => loaded.default,
            () => "",
          )
        : "",
  )

  const page = createMemo(() => {
    const loaded = library()

    if (loaded === undefined) return undefined

    return visualDocument({
      fragment: loaded ? withChart(props.fragment, loaded) : props.fragment,
      id: props.id,
      colors,
      dark,
      weather: props.weather,
      chart: props.chart,
      card: props.card,
      labels: props.labels,
    })
  })

  let frame: HTMLIFrameElement | undefined

  const fit = (event: MessageEvent<{ type?: string; id?: string; height?: number } | undefined>) => {
    // Only this visual's own frame sizes it; the page inside is untrusted, so the number is bounded.
    if (!frame || event.source !== frame.contentWindow) return

    if (event.data?.type !== "visual-height" || event.data.id !== props.id) return
    setHeight(visualHeight(Number(event.data.height) || 0))
  }

  window.addEventListener("message", fit)
  onCleanup(() => window.removeEventListener("message", fit))

  const size = () => `${props.fixed ?? height()}px`

  return (
    <Show when={page()} fallback={<div style={{ height: size() }} />}>
      {(source) => (
        <iframe
          ref={frame}
          data-component="visual-block"
          title={props.title}
          class="block w-full border-0 bg-transparent"
          // The same scheme as the page inside, or the browser paints the frame an opaque backdrop.
          style={{ height: size(), "color-scheme": dark ? "dark" : "light" }}
          // Scripts only: no same-origin access, no forms, popups or navigation of the app.
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          srcdoc={source()}
        />
      )}
    </Show>
  )
}
