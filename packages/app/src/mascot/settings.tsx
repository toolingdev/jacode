import { Switch } from "@opencode/ui/switch"
import { For, type Component } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { SettingsList } from "@/settings/list"
import { SettingsRow } from "@/settings/row"
import { Mascot } from "./mascot"
import { sprites } from "./sprites"
import { useMascot } from "./store"

/** Turn the working-status character on or off and choose which one it is. Each tile previews its animations. */
export const SettingsMascot: Component = () => {
  const language = useLanguage()
  const mascot = useMascot()

  return (
    <div class="settings-section">
      <SettingsList>
        <SettingsRow
          title={language.t("settings.mascot.enabled.title")}
          description={language.t("settings.mascot.enabled.description")}
        >
          <div>
            <Switch checked={mascot.chosen.enabled} onChange={mascot.setEnabled} hideLabel>
              {language.t("settings.mascot.enabled.title")}
            </Switch>
          </div>
        </SettingsRow>
      </SettingsList>
      <div
        role="radiogroup"
        aria-label={language.t("settings.mascot.character")}
        class="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2 pt-3"
      >
        <For each={sprites}>
          {(sprite) => (
            <button
              type="button"
              role="radio"
              aria-checked={mascot.chosen.character === sprite.id}
              data-action="settings-mascot-character"
              class="flex flex-col items-center gap-1 rounded-md border border-v2-border-border-muted p-2 text-12-regular text-v2-text-text-muted aria-checked:border-v2-border-border-strong aria-checked:bg-v2-background-bg-layer-01 aria-checked:text-v2-text-text-base"
              onClick={() => mascot.setCharacter(sprite.id)}
            >
              <Mascot
                sprite={sprite}
                thinking={mascot.chosen.character === sprite.id}
                still={document.documentElement.dataset.motion === "reduce"}
                size={72}
                label={sprite.name}
              />
              {sprite.name}
            </button>
          )}
        </For>
      </div>
    </div>
  )
}
