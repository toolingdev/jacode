export * as VisualsPlugin from "./visuals.js"

import { Message } from "@opencode/ai/effect"
import { define } from "@opencode/plugin/effect/plugin"
import type { Document, Entry } from "@opencode/schema/config"
import { Effect } from "effect"
import { Config } from "../config.js"
import type { PluginInternal } from "./internal.js"

// Fork feature: the desktop app can show a live visual inside a reply: a fenced `visual` code block becomes a chart,
// a weather card or another small page. A model only answers that way if it knows it may, so every prompt carries
// the note below. It is added here, on the server, so the very first message of a session has it and every client
// of this server gets the same; `experimental.visuals: false` in config leaves it out, for clients that show text only.

const LINES = [
  "This app can show a live visual inline in the chat. When a chart, graph, diagram, dashboard, styled table or a card (for example weather, a stock quote, a summary of numbers) would explain something better than text, include a fenced code block whose language is `visual`. Its content is an HTML fragment (no <html>, <head> or <body>) that the app renders in place of the code.",
  "Rules for the fragment: it runs in a sandboxed frame about 700px wide with a transparent background and has no network at all, so put every number it needs inside it and load nothing from a URL (no remote scripts, styles, fonts or images). Inline <style> and <script> are allowed. Chart.js 4 is built in: write <script src=\"chart.js\"></script> before your own script and use the global Chart; give the canvas a wrapper with a fixed height. The app applies the chart look the user picked (colors, fonts, grid, backdrop), so leave those out and give only the data, labels and chart type. No other library is available; simple charts can be plain inline SVG. Animated weather icons are built in: <weather-icon name=\"rain\" size=\"48\"></weather-icon>, with name one of sun, moon, partly-cloudy-day, partly-cloudy-night, cloud, fog, drizzle, rain, snow, storm.",
  "Use these CSS variables for color so it matches the user's theme: --text, --muted, --bg, --surface, --border, --accent, --blue, --green, --orange, --red, --purple, --yellow, --pink. Never hardcode a white or black background.",
  "Keep visuals compact and put the explanation in normal text outside the block. Do not use a visual for plain prose or for code, and do not write the visual to a file. For weather, call the weather tool; its result ends with a ready-made fenced `visual` block holding a <weather-card>. Copy that block into your reply unchanged, fence included, and do not build a weather card yourself. For other real-world data such as prices, get the data with your tools first, then show it.",
  "Two more tools end their result with a ready-made `visual` block to copy unchanged in the same way: `usage` (the user's subscription usage) and `verse` (the exact text of a Bible passage). Quote Scripture only from the verse tool, never from memory.",
  "Two cards you fill yourself, each a `visual` block holding the element with <script type=\"application/json\">{...}</script> inside. <quote-card> shows a quotation or citation: JSON with an optional title and quotes, each with text, and optionally author and source (the work, page, link text or year). Only quote words you have from a source or are sure of. <outline-card> shows an outline of anything (a talk, lesson, sermon, study plan, agenda): JSON with title, points (each with heading, optionally tag and notes as a list of short strings) and optionally label (what kind of outline it is), reference, summary, closing and closingLabel; titleAlt, summaryAlt and closingAlt carry the same line in a second language when the user works in two.",
]

/** What the model is told. Model-facing, so it is not translated. */
export const INSTRUCTION = `<system-reminder>\n${LINES.join("\n")}\n</system-reminder>`

/** Whether the config switches the note off; a later config that sets other experimental options does not hide it. */
export function switchedOff(entries: readonly Entry[]) {
  return (
    entries.findLast(
      (entry): entry is Document => entry.type === "document" && entry.info.experimental?.visuals !== undefined,
    )?.info.experimental?.visuals === false
  )
}

export const Plugin = define({
  id: "opencode.visuals",
  effect: Effect.fn("VisualsPlugin")(function* (ctx) {
    const config = yield* Config.Service

    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        if (switchedOff(yield* config.entries())) return
        const at = event.messages.findIndex((message) => message.role === "user")

        // Before the first prompt, and in the same place on every step so the cached prefix stays warm.
        if (at !== -1) event.messages.splice(at, 0, Message.user(INSTRUCTION))
      }),
    )
  }),
} satisfies PluginInternal.InternalPlugin)
