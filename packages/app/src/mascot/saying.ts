import { createMemo, createSignal, onCleanup, type Accessor } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import en, { type MascotActivity } from "./sayings/en"
import es from "./sayings/es"
import { findSprite } from "./sprites"
import { useMascot } from "./store"

// How long one saying stays before the companion says something else.
const ROTATE_MS = 6_000

/**
 * Fork feature: what the user's companion says in place of "Working", picked at random from its own lines for what
 * the model is doing and changed every few seconds. Nothing while the companion is off or nothing is running.
 */
export function useMascotSaying(activity: Accessor<MascotActivity | undefined>) {
  const mascot = useMascot()
  const language = useLanguage()
  const [tick, setTick] = createSignal(0)
  const timer = setInterval(() => setTick((value) => value + 1), ROTATE_MS)

  onCleanup(() => clearInterval(timer))

  // The previous line, so the same one is not said twice in a row.
  const said = { last: "" }

  return createMemo(() => {
    tick()
    const kind = activity()

    if (!mascot.chosen.enabled || !kind) return undefined
    const character = findSprite(mascot.chosen.character).id
    const book = language.locale().startsWith("es") ? es : en
    const lines = book[character]?.[kind] ?? en[character]?.[kind] ?? []
    const fresh = lines.filter((line) => line !== said.last)
    const line = fresh[Math.floor(Math.random() * fresh.length)] ?? lines[0]

    said.last = line ?? ""

    return line
  })
}

/** What the model is doing, judged from the tool it is running; thinking when it runs none. */
export function mascotActivity(content: readonly { readonly type: string; readonly name?: string }[]): MascotActivity {
  const last = content.at(-1)
  const name = last?.type === "tool" ? (last.name ?? "").toLowerCase() : ""

  if (!name) return "think"

  if (name.includes("subagent") || name.includes("task")) return "delegate"

  if (name.includes("browser") || name.includes("playwright")) return "browser"

  if (name.includes("web") || name.includes("fetch") || name.includes("search_web")) return "web"

  if (name.includes("shell") || name.includes("bash")) return "shell"

  if (["edit", "write", "patch", "apply"].some((word) => name.includes(word))) return "edit"

  if (["read", "glob", "grep", "list", "search", "find"].some((word) => name.includes(word))) return "read"

  return "think"
}
