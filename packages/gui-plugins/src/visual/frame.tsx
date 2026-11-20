import { createMemo, createResource, createSignal, onCleanup, Show } from "solid-js"
import { VISUAL_COLORS, visualDocument, visualHeight, wantsChart, withChart, type VisualColors } from "./document"
import type { CardStyle, ChartStyle, WeatherCardStyle } from "./styles"

/** The colours read for one theme; `theme` identifies the theme they were read under. */
type Palette = { theme: string; colors: VisualColors }

/**
 * Reads the theme's colours as plain `rgba()`. The theme writes colours in forms such as `color-mix()`, which CSS
 * understands but a chart drawing on a canvas does not: it would draw black. Painting each colour and reading the
 * pixel back gives a form everything takes.
 *
 * Reading a computed style makes the browser restyle the whole app, which takes tens of milliseconds in a big
 * window. So the reader takes all colours in one pass and keeps them until the theme changes: the Cards settings
 * page shows 29 visuals at once, and reading per visual and per colour froze it for half a minute.
 */
export function createThemeColors() {
  const palette: Palette = { theme: "", colors: {} }

  return () => {
    const root = document.documentElement

    // The theme lives in the root's attributes and the app's theme stylesheet (`oc-theme`, written by the UI package).
    const theme = [
      root.className,
      root.getAttribute("style"),
      JSON.stringify(root.dataset),
      document.getElementById("oc-theme")?.textContent,
    ].join("|")

    if (palette.theme === theme) return palette.colors

    const probes = Object.entries(VISUAL_COLORS).map(([name, variable]) => {
      const probe = document.createElement("span")
      probe.style.color = `var(${variable})`

      return { name, probe }
    })

    root.append(...probes.map((entry) => entry.probe))
    const resolved = probes.map((entry) => ({ name: entry.name, color: getComputedStyle(entry.probe).color }))
    probes.forEach((entry) => entry.probe.remove())

    const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true })

    palette.theme = theme
    palette.colors = Object.fromEntries(
      resolved.flatMap((entry) => {
        if (!context || !entry.color) return []

        context.clearRect(0, 0, 1, 1)
        context.fillStyle = entry.color
        context.fillRect(0, 0, 1, 1)
        const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data

        return [[entry.name, `rgba(${red}, ${green}, ${blue}, ${(alpha / 255).toFixed(3)})`]]
      }),
    )

    return palette.colors
  }
}

/** Where the server that serves the app in a browser keeps the host page for visuals (see the CLI's WebUi). */
const FRAME_HOST = "/visual-frame.html"

/**
 * Whether visuals load through the server's host page: true when the app runs in a browser from a JaCode server.
 * A visual shown as `srcdoc` takes on the app's CSP, which a server-served app sets to forbid inline scripts, so every
 * card stayed blank there. The desktop app and dev servers have no host page and keep `srcdoc`. Asked once per owner.
 */
export function createFrameHost() {
  const protocol = location.protocol

  if (protocol !== "http:" && protocol !== "https:") return Promise.resolve(false)

  return fetch(FRAME_HOST, { method: "HEAD", cache: "no-store" }).then(
    (response) => response.ok && response.headers.get("x-visual-frame") === "1",
    () => false,
  )
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
  /** The theme's colours, from a `createThemeColors` reader. */
  colors: VisualColors
  /** Whether to load through the server's host page, from a `createFrameHost` check. */
  host: Promise<boolean>
}) {
  const [height, setHeight] = createSignal(160)
  const dark = document.documentElement.dataset.colorScheme !== "light"
  const [hosted] = createResource(() => props.host)

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

    if (loaded === undefined || hosted() === undefined) return undefined

    return visualDocument({
      fragment: loaded ? withChart(props.fragment, loaded) : props.fragment,
      id: props.id,
      colors: props.colors,
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

    // The host page is ready for the visual: it has an origin of its own, so the message goes to any origin.
    if (event.data?.type === "visual-frame-ready")
      return frame.contentWindow?.postMessage({ visualDocument: page() }, "*")

    if (event.data?.type !== "visual-height" || event.data.id !== props.id) return
    setHeight(visualHeight(Number(event.data.height) || 0))
  }

  window.addEventListener("message", fit)
  onCleanup(() => window.removeEventListener("message", fit))

  const size = () => `${props.fixed ?? height()}px`

  return (
    // Keyed, so a hosted visual whose page changes gets a fresh host page to write it into.
    <Show when={page()} keyed fallback={<div style={{ height: size() }} />}>
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
          src={hosted() ? FRAME_HOST : undefined}
          srcdoc={hosted() ? undefined : source}
        />
      )}
    </Show>
  )
}
