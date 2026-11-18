import { Switch } from "@opencode/ui/switch"
import { type Component, createMemo, For } from "solid-js"
import { useAutoModels } from "@/providers/models/auto"
import { useModels } from "@/providers/models/models"
import { useLanguage } from "@/runtime/i18n/language"
import { SettingsList } from "@/settings/list"
import { SettingsRow } from "@/settings/row"

// Fork feature: Auto picks a model for each prompt. Here the user chooses which providers Auto across every
// provider may draw from, for example to keep it off a provider billed per use. Auto on one provider is unaffected.
export const SettingsAutoProviders: Component = () => {
  const language = useLanguage()
  const models = useModels()
  const auto = useAutoModels()

  const providers = createMemo(() =>
    Array.from(
      Map.groupBy(models.list(), (item) => item.provider.id),
      ([id, items]) => ({ id, name: items[0]?.provider.name ?? id }),
    ),
  )

  return (
    <div class="flex flex-col gap-2 pb-6">
      <div class="flex flex-col gap-1">
        <h3 class="text-13-medium text-v2-text-text-base">{language.t("settings.models.auto.title")}</h3>
        <span class="text-12-regular text-v2-text-text-muted">{language.t("settings.models.auto.about")}</span>
      </div>
      <SettingsList>
        <For each={providers()}>
          {(provider) => (
            <SettingsRow
              title={provider.name}
              description={language.t(
                auto.chosen.excluded?.[provider.id] ? "settings.models.auto.excluded" : "settings.models.auto.included",
              )}
            >
              <div>
                <Switch
                  checked={!auto.chosen.excluded?.[provider.id]}
                  onChange={(checked) => auto.setExcluded(provider.id, !checked)}
                  hideLabel
                >
                  {provider.name}
                </Switch>
              </div>
            </SettingsRow>
          )}
        </For>
      </SettingsList>
    </div>
  )
}
