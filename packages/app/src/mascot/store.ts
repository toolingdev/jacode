import { Schema } from "effect"
import { createRoot } from "solid-js"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { usePlatform } from "@/runtime/platform/platform"
import { defaultSprite } from "./sprites"

export const MascotSchema = Schema.Struct({
  /** Whether a character shows while the model works. */
  enabled: Schema.Boolean,
  /** The chosen character's ID. */
  character: Schema.String,
})

// One store for the window, so the timeline follows the settings page the moment a character is picked.
let shared: ReturnType<typeof open> | undefined

function open(platform: ReturnType<typeof usePlatform>) {
  return createRoot(() =>
    persisted(Persist.global("mascot"), MascotSchema, { enabled: true, character: defaultSprite.id }, platform),
  )
}

export function useMascot() {
  const platform = usePlatform()

  shared ??= open(platform)
  const [chosen, setChosen] = shared

  return {
    chosen,
    setEnabled: (enabled: boolean) => setChosen({ enabled }),
    setCharacter: (character: string) => setChosen({ character }),
  }
}
