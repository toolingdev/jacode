import { Show, type Component } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { Mascot } from "./mascot"
import { findSprite } from "./sprites"
import { useMascot } from "./store"
import { useCompanionSync } from "./sync"
import { useVisualsSync } from "@/visuals/sync"

/**
 * The user's chosen character, thinking beside the timeline's working status. Nothing when turned off. Given a
 * session, it also tells that session's assistant which character it is.
 */
export const SessionMascot: Component<{ working: boolean; sessionID?: string }> = (props) => {
  const language = useLanguage()
  const mascot = useMascot()

  useCompanionSync(() => props.sessionID)
  // Mounted with the timeline of every session, which is where the visuals instruction is needed too.
  useVisualsSync(() => props.sessionID)

  return (
    <Show when={mascot.chosen.enabled && props.working}>
      <Mascot
        sprite={findSprite(mascot.chosen.character)}
        thinking
        // The app's motion setting overrides the system's, and publishes the result here.
        still={document.documentElement.dataset.motion === "reduce"}
        label={language.t("mascot.thinking", { name: findSprite(mascot.chosen.character).name })}
      />
    </Show>
  )
}
