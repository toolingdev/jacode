import { Select } from "@opencode/ui/select"
import { type Component, createMemo, For } from "solid-js"

import { useAutoModels } from "@/providers/models/auto"
import { useModels } from "@/providers/models/models"
import { useLanguage } from "@/runtime/i18n/language"
import { SettingsList } from "@/settings/list"
import { SettingsRow } from "@/settings/row"

type Option = { value: string; label: string }

const UNSET = "default"

// Fork feature: choose what the "Auto" model choice uses, for every provider and within each one.
export const SettingsAutoModels: Component = () => {
  const language = useLanguage()
  const models = useModels()
  const auto = useAutoModels()

  const unset = (): Option => ({ value: UNSET, label: language.t("settings.models.auto.default") })

  const providers = createMemo(() =>
    Array.from(
      Map.groupBy(
        models.list().filter((item) => models.visible({ providerID: item.provider.id, modelID: item.id })),
        (item) => item.provider.id,
      ),
      ([id, items]) => ({ id, name: items[0]?.provider.name ?? id, items }),
    ),
  )

  const all = createMemo(() => [
    unset(),
    ...providers().flatMap((provider) =>
      provider.items.map((item) => ({
        value: JSON.stringify([provider.id, item.id]),
        label: `${provider.name} · ${item.name}`,
      })),
    ),
  ])

  const allValue = () => (auto.chosen.all ? JSON.stringify([auto.chosen.all.providerID, auto.chosen.all.modelID]) : UNSET)

  return (
    <div class="flex flex-col gap-2 pb-6">
      <h3 class="text-13-medium text-v2-text-text-base">{language.t("settings.models.auto.title")}</h3>
      <SettingsList>
        <SettingsRow
          title={language.t("settings.models.auto.all.title")}
          description={language.t("settings.models.auto.all.description")}
        >
          <Select
            data-action="settings-auto-model-all"
            options={all()}
            current={all().find((option) => option.value === allValue()) ?? all()[0]}
            value={(option) => option.value}
            label={(option) => option.label}
            placement="bottom-end"
            gutter={6}
            onSelect={(option) => {
              if (!option) return

              const picked = providers()
                .flatMap((provider) => provider.items)
                .find((item) => JSON.stringify([item.provider.id, item.id]) === option.value)

              auto.setAll(picked && { providerID: picked.provider.id, modelID: picked.id })
            }}
          />
        </SettingsRow>
        <For each={providers()}>
          {(provider) => {
            const options = () => [unset(), ...provider.items.map((item) => ({ value: item.id, label: item.name }))]

            return (
              <SettingsRow
                title={language.t("settings.models.auto.provider.title", { provider: provider.name })}
                description={language.t("settings.models.auto.provider.description")}
              >
                <Select
                  data-action="settings-auto-model-provider"
                  options={options()}
                  current={
                    options().find((option) => option.value === (auto.chosen.providers[provider.id] || UNSET)) ??
                    options()[0]
                  }
                  value={(option) => option.value}
                  label={(option) => option.label}
                  placement="bottom-end"
                  gutter={6}
                  onSelect={(option) =>
                    option && auto.setProvider(provider.id, option.value === UNSET ? undefined : option.value)
                  }
                />
              </SettingsRow>
            )
          }}
        </For>
      </SettingsList>
    </div>
  )
}
