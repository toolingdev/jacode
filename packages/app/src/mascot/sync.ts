import { createEffect } from "solid-js"
import { useServerSDK } from "@/runtime/server/client"
import { findSprite, type Sprite } from "./sprites"
import { useMascot } from "./store"

// Fork feature: the assistant is the character on screen. The chosen character is attached to each session as a
// durable instruction entry, so the server keeps it for work that runs with no app open, such as a scheduled wake.
const KEY = "companion"

/** What a session instruction entry may hold: any JSON value. The companion entry holds a string. */
type EntryValue = string | number | boolean | null | object

type Entries = {
  list: (input: { sessionID: string }) => Promise<readonly { readonly key: string; readonly value: EntryValue }[]>
  put: (input: { sessionID: string; key: string; value: string }) => Promise<object | void>
  remove: (input: { sessionID: string; key: string }) => Promise<object | void>
}

/** What the model is told about the character. Model-facing, so it is not translated. */
export function companionInstruction(sprite: Sprite) {
  return `The user's companion character in OpenCode is ${sprite.name}, ${sprite.persona}. That character is you: answer to the name ${sprite.name} and let its temperament color your voice lightly, without getting in the way of the work. If earlier messages or files call you by another character's name, the user has switched; ${sprite.name} is current.`
}

/**
 * Makes the session's companion entry match the chosen character, writing only when it differs: a rewrite is
 * announced to the model, and reopening a session must not announce anything.
 */
export async function syncCompanion(entries: Entries, sessionID: string, sprite: Sprite | undefined) {
  const current = (await entries.list({ sessionID })).find((entry) => entry.key === KEY)?.value
  const wanted = sprite && companionInstruction(sprite)

  if (current === wanted) return

  if (wanted === undefined) return void (await entries.remove({ sessionID, key: KEY }))
  await entries.put({ sessionID, key: KEY, value: wanted })
}

/** Keeps the open session's companion entry in step with the settings, on whichever server holds the session. */
export function useCompanionSync(sessionID: () => string | undefined) {
  const server = useServerSDK()
  const mascot = useMascot()

  createEffect(() => {
    const id = sessionID()

    if (!id) return
    // A server without instruction entries, or one that is unreachable, simply goes without the character.
    void syncCompanion(
      server.api.experimental.session.instructions.entry,
      id,
      mascot.chosen.enabled ? findSprite(mascot.chosen.character) : undefined,
    ).catch(() => undefined)
  })
}
