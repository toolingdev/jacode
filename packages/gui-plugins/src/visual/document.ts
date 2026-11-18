import { WEATHER_CARD_SCRIPT } from "./card"
import { OUTLINE_CARD_SCRIPT, QUOTE_CARD_SCRIPT, USAGE_CARD_SCRIPT } from "./cards"
import { CHART_STYLE_SCRIPT } from "./charts"
import { WEATHER_ICONS_SCRIPT } from "./icons"
import type { CardStyle, ChartStyle, WeatherCardStyle } from "./styles"

// Fork feature: the page a `visual` code block runs as.

// A script tag that asks for Chart.js, from wherever a model is used to loading it.
const CHART_SCRIPT = /<script\b[^>]*\bsrc\s*=\s*["'][^"']*chart[^"']*["'][^>]*>\s*<\/script>/gi

/** Whether the fragment asks for the chart library the app carries. */
export function wantsChart(fragment: string) {
  return fragment.search(CHART_SCRIPT) !== -1
}

/**
 * The fragment with each request for Chart.js answered by the library itself, inline. A visual reaches no network,
 * so the app carries the library and hands it over here.
 */
export function withChart(fragment: string, library: string) {
  // A closing script tag inside the library's text would end the inline script early.
  // The look follows the library at once, so it is in place before the fragment's own script draws a chart.
  return fragment.replace(
    CHART_SCRIPT,
    () => `<script>${library.replaceAll("</script", "<\\/script")}</script><script>${CHART_STYLE_SCRIPT}</script>`,
  )
}

/** The colours a visual is given as CSS variables, each read from one of the app's theme variables. */
export const VISUAL_COLORS = {
  text: "--v2-text-text-base",
  muted: "--v2-text-text-muted",
  bg: "--v2-background-bg-base",
  surface: "--v2-background-bg-layer-01",
  border: "--v2-border-border-base",
  accent: "--v2-text-text-accent",
  blue: "--v2-blue-500",
  green: "--v2-green-500",
  orange: "--v2-orange-500",
  red: "--v2-red-500",
  purple: "--v2-purple-500",
  yellow: "--v2-yellow-500",
  pink: "--v2-pink-500",
} as const

export type VisualColors = Partial<Record<keyof typeof VISUAL_COLORS, string>>

/**
 * The whole document for one visual: the model's HTML fragment inside a page that may run its own inline scripts and
 * nothing else. It cannot load, fetch or post anything over the network, so whatever it is shown stays in the frame.
 * The page reports its height under `id`, so the frame can fit it.
 */
export function visualDocument(input: {
  fragment: string
  id: string
  colors: VisualColors
  dark: boolean
  /** The looks the user picked; the page's weather card and charts read them from its root element. */
  weather?: WeatherCardStyle
  chart?: ChartStyle
  /** The look of the usage, quote and outline cards. */
  card?: CardStyle
  /** The words the usage and outline cards show, in the user's language; see CARD_LABEL_KEYS. */
  labels?: Record<string, string>
}) {
  const variables = Object.entries(input.colors)
    .flatMap(([name, value]) => (value ? [`--${name}:${value}`] : []))
    .join(";")

  const policy = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data:",
  ].join("; ")

  return `<!doctype html>
<html data-weather-style="${input.weather ?? "clean"}" data-chart-style="${input.chart ?? "clean"}" data-card-style="${input.card ?? "clean"}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<style>
:root{color-scheme:${input.dark ? "dark" : "light"};${variables}}
html,body{margin:0;padding:0;background:transparent}
body{color:var(--text);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden}
*{box-sizing:border-box}
</style>
<script>${WEATHER_ICONS_SCRIPT}</script>
<script>${WEATHER_CARD_SCRIPT}</script>
<script>window.visualLabels=${JSON.stringify(input.labels ?? {}).replaceAll("<", "\\u003c")}</script>
<script>${USAGE_CARD_SCRIPT}</script>
<script>${QUOTE_CARD_SCRIPT}</script>
<script>${OUTLINE_CARD_SCRIPT}</script>
</head>
<body>
<div id="visual-root">${input.fragment}</div>
<script>
(() => {
  const root = document.getElementById("visual-root")
  const report = () => parent.postMessage({ type: "visual-height", id: ${JSON.stringify(input.id)}, height: Math.ceil(root.getBoundingClientRect().height) }, "*")
  new ResizeObserver(report).observe(root)
  addEventListener("load", report)
  report()
})()
</script>
</body>
</html>`
}

/** The frame's height for a height the page reported: never collapsed, never taller than a screenful. */
export function visualHeight(reported: number) {
  return Math.min(Math.max(Math.round(reported), 40), 1600)
}
