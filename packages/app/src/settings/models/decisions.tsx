import type { ConfigExperimentalDecisions } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { Select } from "@opencode/ui/select"
import { Switch } from "@opencode/ui/switch"
import { TextInput } from "@opencode/ui/text-input"
import { type Component, createMemo, createSignal, For, Show } from "solid-js"
import { useModels } from "@/providers/models/models"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { createExtensionLoad } from "@/settings/extension-load"
import { useGlobalConfig } from "@/settings/global-config"
import { SettingsList } from "@/settings/list"
import { SettingsRow } from "@/settings/row"

type Option = { value: string; label: string }

const UNSET = "default"

// Fork feature: the decision layer's settings. A decision model looks at each prompt first and picks which of the
// models listed here should answer it, and whether the task is large enough to plan before starting.
export const SettingsDecisions: Component = () => {
  const language = useLanguage()
  const server = useServerSDK()
  const data = useData()
  const models = useModels()
  const config = useGlobalConfig()
  // What was last saved here, shown at once; the config read catches up when the server reloads.
  const [saved, setSaved] = createSignal<{ settings: ConfigExperimentalDecisions | undefined }>()

  const settings = () => {
    const local = saved()

    if (local) return local.settings

    return config.documents()?.findLast((document) => document.experimental?.decisions !== undefined)?.experimental
      ?.decisions
  }

  const save = (next: ConfigExperimentalDecisions | undefined) => {
    setSaved({ settings: next })
    const api = server.api.experimental.config.decisions

    void config.save(() => (next ? api.set(next) : api.remove()))
  }

  const change = (patch: Partial<ConfigExperimentalDecisions>) => save({ ...settings(), ...patch })

  const deciders = createExtensionLoad({
    key: () => server.scope,
    task: (_, signal) =>
      server.api.model.list({ location: data.location.default(), types: ["decision"] }, { signal }).then((result) =>
        result.data
          .filter((model) => model.type === "decision")
          .map((model): Option => ({ value: `${model.providerID}/${model.id}`, label: model.name }))
          .toSorted((a, b) => a.label.localeCompare(b.label)),
      ),
  })

  const deciderOptions = createMemo(() => {
    const view = deciders.view()

    return [
      { value: UNSET, label: language.t("settings.decisions.decider.default") },
      ...(view.status === "ready" ? view.value : []),
    ]
  })

  const chat = createMemo(() =>
    models
      .list()
      .filter((item) => models.visible({ providerID: item.provider.id, modelID: item.id }))
      .map(
        (item): Option => ({ value: `${item.provider.id}/${item.id}`, label: `${item.provider.name} · ${item.name}` }),
      ),
  )

  const pool = () => Object.entries(settings()?.models ?? {})

  const addable = () => [
    { value: UNSET, label: language.t("settings.decisions.models.add.choose") },
    ...chat().filter((option) => settings()?.models?.[option.value] === undefined),
  ]

  const name = (key: string) => chat().find((option) => option.value === key)?.label ?? key

  return (
    <div class="flex flex-col gap-2 pb-6">
      <h3 class="text-13-medium text-v2-text-text-base">{language.t("settings.decisions.title")}</h3>
      <SettingsList>
        <SettingsRow
          title={language.t("settings.decisions.enabled.title")}
          description={language.t("settings.decisions.enabled.description")}
        >
          <div data-action="settings-decisions-enabled">
            <Switch
              checked={settings() !== undefined}
              onChange={(checked) => save(checked ? { plan: true, models: {} } : undefined)}
            />
          </div>
        </SettingsRow>
        <Show when={settings()}>
          {(current) => (
            <>
              <SettingsRow
                title={language.t("settings.decisions.decider.title")}
                description={language.t("settings.decisions.decider.description")}
              >
                <Select
                  data-action="settings-decisions-decider"
                  options={deciderOptions()}
                  current={
                    deciderOptions().find((option) => option.value === (current().model ?? UNSET)) ??
                    deciderOptions()[0]
                  }
                  value={(option) => option.value}
                  label={(option) => option.label}
                  placement="bottom-end"
                  gutter={6}
                  onSelect={(option) => option && change({ model: option.value === UNSET ? undefined : option.value })}
                />
              </SettingsRow>
              <SettingsRow
                title={language.t("settings.decisions.plan.title")}
                description={language.t("settings.decisions.plan.description")}
              >
                <div data-action="settings-decisions-plan">
                  <Switch checked={current().plan !== false} onChange={(checked) => change({ plan: checked })} />
                </div>
              </SettingsRow>
              <For each={pool()}>
                {([key, use]) => (
                  <SettingsRow title={name(key)} description={language.t("settings.decisions.models.use.description")}>
                    <div class="flex items-center gap-2">
                      <div class="w-full sm:w-[280px]">
                        <TextInput
                          type="text"
                          appearance="base"
                          value={use}
                          // Saved when the field is left, not on every keystroke: each save rewrites the config.
                          onChange={(event) =>
                            change({ models: { ...current().models, [key]: event.currentTarget.value.trim() } })
                          }
                          placeholder={language.t("settings.decisions.models.use.placeholder")}
                          aria-label={language.t("settings.decisions.models.use.label", { model: name(key) })}
                          autocomplete="off"
                        />
                      </div>
                      <Button
                        type="button"
                        size="small"
                        variant="ghost-muted"
                        onClick={() =>
                          change({
                            models: Object.fromEntries(pool().filter(([other]) => other !== key)),
                          })
                        }
                      >
                        {language.t("settings.extensions.remove")}
                      </Button>
                    </div>
                  </SettingsRow>
                )}
              </For>
              <SettingsRow
                title={language.t("settings.decisions.models.add.title")}
                description={language.t("settings.decisions.models.add.description")}
              >
                <Select
                  data-action="settings-decisions-add-model"
                  options={addable()}
                  current={addable()[0]}
                  value={(option) => option.value}
                  label={(option) => option.label}
                  placement="bottom-end"
                  gutter={6}
                  onSelect={(option) => {
                    if (!option || option.value === UNSET) return
                    change({ models: { ...current().models, [option.value]: "" } })
                  }}
                />
              </SettingsRow>
            </>
          )}
        </Show>
      </SettingsList>
    </div>
  )
}
