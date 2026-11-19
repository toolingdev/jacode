import type { ConfigExperimentalAutoTiers, ConfigExperimentalDecisions } from "@opencode/client/promise"
import { Select } from "@opencode/ui/select"
import { Switch } from "@opencode/ui/switch"
import { type Component, createMemo, createSignal, For, type JSX } from "solid-js"
import { AUTO, useAutoModels } from "@/providers/models/auto"
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

const SLOTS = ["quick", "everyday", "hard", "image"] as const

type Slot = (typeof SLOTS)[number]

// Fork feature: Auto, in one place. Auto picks a model for each prompt: a decision model says what kind of task it
// is, and Auto answers it with the model for that kind of task. Here the user sees how that flows, chooses the
// providers Auto across every provider may use, the decision model, and, per scope, a model for each kind of task.
export const SettingsAuto: Component = () => {
  const language = useLanguage()
  const server = useServerSDK()
  const data = useData()
  const models = useModels()
  const auto = useAutoModels()
  const config = useGlobalConfig()
  // What was last saved here, shown at once; the config read catches up when the server reloads.
  const [saved, setSaved] = createSignal<{ settings: ConfigExperimentalDecisions | undefined }>()
  const [scope, setScope] = createSignal(AUTO)

  const settings = () => {
    const local = saved()

    if (local) return local.settings

    return config.documents()?.findLast((document) => document.experimental?.decisions !== undefined)?.experimental
      ?.decisions
  }

  // Settings this build no longer reads (routing on or off, routed models, kept topics) are dropped when saving.
  const change = (patch: Partial<ConfigExperimentalDecisions>) => {
    const current = settings()

    const next = {
      model: current?.model,
      tiers: current?.tiers,
      allowPaid: current?.allowPaid,
      plan: current?.plan,
      confidence: current?.confidence,
      ...patch,
    }

    const api = server.api.experimental.config.decisions

    setSaved({ settings: next })
    void config.save(() => api.set(next))
  }

  const providers = createMemo(() =>
    Array.from(
      Map.groupBy(models.list(), (item) => item.provider.id),
      ([id, items]) => ({ id, name: items[0]?.provider.name ?? id }),
    ),
  )

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
      { value: UNSET, label: language.t("settings.auto.decider.default") },
      ...(view.status === "ready" ? view.value : []),
    ]
  })

  const decider = () =>
    deciderOptions().find((option) => option.value === (settings()?.model ?? UNSET)) ?? deciderOptions()[0]

  const scopeKey = () => (scope() === AUTO ? "all" : scope())

  const scopeOptions = createMemo((): Option[] => [
    { value: AUTO, label: language.t("settings.auto.scope.all") },
    ...providers().map((provider) => ({ value: provider.id, label: provider.name })),
  ])

  const tiers = () => settings()?.tiers?.[scopeKey()]

  // The models Auto in the chosen scope may use: those the picker shows, and any set here though hidden there.
  const inScope = createMemo(() => {
    const set = new Set(Object.values(tiers() ?? {}))

    return models
      .list()
      .filter((item) => (scope() === AUTO ? !auto.chosen.excluded?.[item.provider.id] : item.provider.id === scope()))
      .filter(
        (item) =>
          models.visible({ providerID: item.provider.id, modelID: item.id }) ||
          set.has(`${item.provider.id}/${item.id}`),
      )
  })

  const slotOptions = (slot: Slot): Option[] => [
    { value: UNSET, label: language.t("settings.auto.slot.automatic") },
    ...inScope()
      .filter((item) => slot !== "image" || item.capabilities.input.image)
      .map((item) => ({
        value: `${item.provider.id}/${item.id}`,
        label: scope() === AUTO ? `${item.provider.name} · ${item.name}` : item.name,
      })),
  ]

  // What the flow chart names for a kind of task: the model set for it, by its own name, or that Auto picks by price.
  const slotLabel = (slot: Slot) => {
    const key = tiers()?.[slot]
    const item = key && inScope().find((model) => `${model.provider.id}/${model.id}` === key)

    return item ? item.name : language.t("settings.auto.flow.slot.automatic")
  }

  const setSlot = (slot: Slot, value: string | undefined) => {
    const next: ConfigExperimentalAutoTiers = { ...tiers(), [slot]: value }
    const empty = SLOTS.every((item) => next[item] === undefined)
    const rest = Object.fromEntries(Object.entries(settings()?.tiers ?? {}).filter(([key]) => key !== scopeKey()))

    change({ tiers: empty ? rest : { ...rest, [scopeKey()]: next } })
  }

  return (
    <div class="flex flex-col gap-2 pb-6">
      <div class="flex flex-col gap-1">
        <h3 class="text-13-medium text-v2-text-text-base">{language.t("settings.models.auto.title")}</h3>
        <span class="text-12-regular text-v2-text-text-muted">{language.t("settings.auto.about")}</span>
      </div>
      <AutoFlow decider={decider()?.value === UNSET ? "Jev" : (decider()?.label ?? "Jev")} slot={slotLabel} />
      <SettingsList>
        <SettingsRow
          title={language.t("settings.auto.decider.title")}
          description={language.t("settings.auto.decider.description")}
        >
          <Select
            data-action="settings-auto-decider"
            options={deciderOptions()}
            current={decider()}
            value={(option) => option.value}
            label={(option) => option.label}
            placement="bottom-end"
            gutter={6}
            onSelect={(option) => option && change({ model: option.value === UNSET ? undefined : option.value })}
          />
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.auto.scope.title")}
          description={language.t("settings.auto.scope.description")}
        >
          <Select
            data-action="settings-auto-scope"
            options={scopeOptions()}
            current={scopeOptions().find((option) => option.value === scope()) ?? scopeOptions()[0]}
            value={(option) => option.value}
            label={(option) => option.label}
            placement="bottom-end"
            gutter={6}
            onSelect={(option) => option && setScope(option.value)}
          />
        </SettingsRow>
        <For each={SLOTS}>
          {(slot) => (
            <SettingsRow
              title={language.t(`settings.auto.slot.${slot}.title`)}
              description={language.t(`settings.auto.slot.${slot}.description`)}
            >
              <Select
                data-action={`settings-auto-slot-${slot}`}
                options={slotOptions(slot)}
                current={
                  slotOptions(slot).find((option) => option.value === (tiers()?.[slot] ?? UNSET)) ??
                  slotOptions(slot)[0]
                }
                value={(option) => option.value}
                label={(option) => option.label}
                placement="bottom-end"
                gutter={6}
                onSelect={(option) => option && setSlot(slot, option.value === UNSET ? undefined : option.value)}
              />
            </SettingsRow>
          )}
        </For>
        <SettingsRow
          title={language.t("settings.auto.paid.title")}
          description={language.t("settings.auto.paid.description")}
        >
          <div data-action="settings-auto-paid">
            <Switch
              checked={settings()?.allowPaid === true}
              onChange={(checked) => change({ allowPaid: checked || undefined })}
            />
          </div>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.auto.plan.title")}
          description={language.t("settings.auto.plan.description")}
        >
          <div data-action="settings-auto-plan">
            <Switch checked={settings()?.plan === true} onChange={(checked) => change({ plan: checked || undefined })} />
          </div>
        </SettingsRow>
      </SettingsList>
      <div class="flex flex-col gap-1 pt-4">
        <h4 class="text-12-medium text-v2-text-text-base">{language.t("settings.auto.providers.title")}</h4>
        <span class="text-12-regular text-v2-text-text-muted">{language.t("settings.auto.providers.about")}</span>
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

// How Auto answers a prompt, drawn as the steps it takes, with the models the chosen scope uses now.
const AutoFlow: Component<{ decider: string; slot: (slot: Slot) => string }> = (props) => {
  const language = useLanguage()

  return (
    <div
      data-component="auto-flow"
      class="flex flex-col gap-3 rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-01 p-4"
    >
      <div class="flex flex-col items-stretch gap-2 md:flex-row md:items-center">
        <Step title={language.t("settings.auto.flow.prompt.title")}>
          {language.t("settings.auto.flow.prompt.body")}
        </Step>
        <Arrow />
        <Step title={language.t("settings.auto.flow.read.title", { model: props.decider })}>
          {language.t("settings.auto.flow.read.body")}
        </Step>
        <Arrow />
        <Step title={language.t("settings.auto.flow.pick.title")} wide>
          <div class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
            <For each={SLOTS}>
              {(slot) => (
                <>
                  <span class="text-v2-text-text-accent">{language.t(`settings.auto.flow.slot.${slot}`)}</span>
                  <span class="truncate text-v2-text-text-base">{props.slot(slot)}</span>
                </>
              )}
            </For>
          </div>
        </Step>
        <Arrow />
        <Step title={language.t("settings.auto.flow.answer.title")}>
          {language.t("settings.auto.flow.answer.body")}
        </Step>
      </div>
      <ul class="flex flex-col gap-1 text-12-regular text-v2-text-text-muted">
        <li>{language.t("settings.auto.flow.note.unsure")}</li>
        <li>{language.t("settings.auto.flow.note.quota")}</li>
        <li>{language.t("settings.auto.flow.note.manual")}</li>
      </ul>
    </div>
  )
}

const Step: Component<{ title: string; wide?: boolean; children: JSX.Element }> = (props) => (
  <div
    class="flex min-w-0 flex-col gap-1 rounded-md border border-v2-border-border-muted bg-v2-background-bg-base px-3 py-2 text-12-regular text-v2-text-text-muted"
    classList={{ "md:flex-[1.6]": props.wide, "md:flex-1": !props.wide }}
  >
    <span class="text-12-medium text-v2-text-text-base">{props.title}</span>
    {props.children}
  </div>
)

const Arrow: Component = () => (
  <span aria-hidden="true" class="self-center text-v2-icon-icon-muted md:rotate-0 rotate-90">
    →
  </span>
)
