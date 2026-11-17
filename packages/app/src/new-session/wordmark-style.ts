import { Schema } from "effect"
import { createRoot } from "solid-js"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { usePlatform } from "@/runtime/platform/platform"

// Fork feature: how the new session wordmark moves and takes its colour, chosen in Settings.
export const wordmarkStyles = [
  "assemble",
  "rainbow",
  "typed",
  "aurora",
  "bounce",
  "companion",
  "twinkle",
  "shine",
  "trail",
  "signal",
] as const

export type WordmarkStyle = (typeof wordmarkStyles)[number]

export const WordmarkStyleSchema = Schema.Struct({ style: Schema.Literals(wordmarkStyles) })

// One store for the window, so the new session screen follows the settings page the moment a style is picked.
let shared: ReturnType<typeof open> | undefined

function open(platform: ReturnType<typeof usePlatform>) {
  return createRoot(() => persisted(Persist.global("wordmark"), WordmarkStyleSchema, { style: "assemble" }, platform))
}

export function useWordmarkStyle() {
  const platform = usePlatform()

  shared ??= open(platform)
  const [chosen, setChosen] = shared

  return { chosen, setStyle: (style: WordmarkStyle) => setChosen({ style }) }
}
