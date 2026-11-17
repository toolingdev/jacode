import { createEffect } from "solid-js"
import { useServerSDK } from "@/runtime/server/client"

// Fork feature: the app can show a live visual inside a reply (see the `visual` built-in plugin). A model only uses
// that if it knows, so each open session carries a durable instruction entry that says how.
const KEY = "visuals"

/** What the model is told. Model-facing, so it is not translated. */
export const VISUALS_INSTRUCTION = [
  "This app can show a live visual inline in the chat. When a chart, graph, diagram, dashboard, styled table or a card (for example weather, a stock quote, a summary of numbers) would explain something better than text, include a fenced code block whose language is `visual`. Its content is an HTML fragment (no <html>, <head> or <body>) that the app renders in place of the code.",
  "Rules for the fragment: it runs in a sandboxed frame about 700px wide with a transparent background and has no network at all, so put every number it needs inside it and load nothing from a URL (no remote scripts, styles, fonts or images). Inline <style> and <script> are allowed. Chart.js 4 is built in: write <script src=\"chart.js\"></script> before your own script and use the global Chart; give the canvas a wrapper with a fixed height. No other library is available; simple charts can be plain inline SVG.",
  "Use these CSS variables for color so it matches the user's theme: --text, --muted, --bg, --surface, --border, --accent, --blue, --green, --orange, --red, --purple, --yellow, --pink. Never hardcode a white or black background.",
  "Keep visuals compact and put the explanation in normal text outside the block. Do not use a visual for plain prose or for code, and do not write the visual to a file. For real-world data such as weather or prices, get the data with your tools first, then show it.",
].join("\n")

type Entries = {
  list: (input: { sessionID: string }) => Promise<readonly { readonly key: string; readonly value: unknown }[]>
  put: (input: { sessionID: string; key: string; value: string }) => Promise<object | void>
}

/** Writes the entry unless the session already holds this exact text: a rewrite is announced to the model. */
export async function syncVisuals(entries: Entries, sessionID: string) {
  if ((await entries.list({ sessionID })).some((entry) => entry.key === KEY && entry.value === VISUALS_INSTRUCTION))
    return
  await entries.put({ sessionID, key: KEY, value: VISUALS_INSTRUCTION })
}

/** Keeps the open session told about visuals, on whichever server holds it. */
export function useVisualsSync(sessionID: () => string | undefined) {
  const server = useServerSDK()

  createEffect(() => {
    const id = sessionID()

    if (!id) return
    // A server without instruction entries, or one that is unreachable, simply goes without.
    void syncVisuals(server.api.experimental.session.instructions.entry, id).catch(() => undefined)
  })
}
