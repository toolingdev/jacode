import { createKeyed, usePlugin } from "@opencode/plugin/gui"
import { showToast } from "@opencode/ui/toast"
import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import type definition from "./index"
import {
  DEFAULT_WEATHER_SOURCES,
  emptyWeatherForm,
  moveSource,
  readWeatherForm,
  WEATHER_SOURCE_TYPES,
  weatherFormOf,
  type WeatherForm,
  type WeatherSource,
} from "./sources"

export default function WeatherPage() {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui

  // The routed session's server, else the app's own, else the first listed: Settings can open without a session.
  const server = createMemo(() => {
    const refs = ctx.servers.list().flatMap((id) => ctx.servers.get(id) ?? [])

    return ctx.sessions.current()?.server ?? refs.find((ref) => ref.builtin) ?? refs[0]
  })

  // What the config lists: `undefined` until read, `null` when it lists nothing and the tool uses its defaults.
  const [saved, setSaved] = createSignal<readonly WeatherSource[] | null>()

  const read = () => {
    const current = server()

    if (!current) return
    void current.client.config.get().then(
      (entries) => {
        const boundary = entries.findIndex((entry) => entry.type === "directory")

        setSaved(
          (boundary === -1 ? entries : entries.slice(0, boundary))
            .flatMap((entry) => (entry.type === "document" ? [entry.info.experimental?.weather] : []))
            .findLast((found) => found !== undefined)?.sources ?? null,
        )
      },
      () => undefined,
    )
  }

  createKeyed(
    () => server()?.connected && server()?.id,
    () => read(),
  )

  const sources = () => saved() ?? DEFAULT_WEATHER_SOURCES

  const name = (source: WeatherSource) => source.name || ctx.t(`type.${source.type}`)

  // Shown at once; the config is read again when the write fails, so the page never shows what was not saved.
  const save = (next: readonly WeatherSource[] | null) => {
    const client = server()?.client

    if (!client) return Promise.resolve()
    setSaved(next)

    return (
      next
        ? client.experimental.config.weather.set({ sources: [...next] })
        : client.experimental.config.weather.remove()
    ).then(
      () => undefined,
      () => {
        showToast({ variant: "error", title: ctx.t("failed") })
        read()
      },
    )
  }

  const replace = (index: number, source: WeatherSource) =>
    save(sources().map((current, at) => (at === index ? source : current)))

  const openForm = (index?: number) => {
    const editing = index === undefined ? undefined : sources()[index]

    return ctx.dialogs.open((dialog) => (
      <SourceDialog
        editing={editing}
        onCancel={dialog.close}
        onSubmit={(source) => {
          void (index === undefined ? save([...sources(), source]) : replace(index, source))
          dialog.close()
        }}
      />
    ))
  }

  return (
    // Fork feature: a section of the Cards page, not a page of its own.
    <ui.SettingsSection
      title={ctx.t("title")}
      footer={
        <div class="flex flex-col gap-2 pt-2">
          <Show when={server() && saved() === null}>
            <p class="px-1 text-12-regular text-v2-text-text-muted">{ctx.t("defaults")}</p>
          </Show>
          <div class="flex items-center justify-between gap-3">
            <p class="text-12-regular text-v2-text-text-muted">{ctx.t("description")}</p>
            <div class="flex shrink-0 items-center gap-2">
              <Show when={saved()}>
                <ui.Button variant="ghost" size="small" onClick={() => void save(null)}>
                  {ctx.t("reset")}
                </ui.Button>
              </Show>
              <ui.Button
                variant="neutral"
                size="small"
                icon="plus"
                disabled={!server()}
                onClick={() => void openForm()}
              >
                {ctx.t("add")}
              </ui.Button>
            </div>
          </div>
        </div>
      }
    >
      <Switch>
        <Match when={!server()}>
          <ui.SettingsRow title={ctx.t("unavailable")} />
        </Match>
        <Match when={sources().length === 0}>
          <ui.SettingsRow title={ctx.t("empty")} description={ctx.t("empty.description")} />
        </Match>
        <Match when={true}>
          <For each={sources()}>
            {(source, index) => (
              <ui.SettingsRow
                title={`${index() + 1}. ${name(source)}`}
                description={source.url || ctx.t(`about.${source.type}`)}
              >
                <div class="flex items-center gap-2">
                  <ui.Switch
                    label={ctx.t("enabled", { name: name(source) })}
                    hideLabel
                    checked={source.disabled !== true}
                    onChange={(enabled) => {
                      const { disabled: _, ...rest } = source

                      void replace(index(), enabled ? rest : { ...rest, disabled: true })
                    }}
                  />
                  <ui.Menu
                    label={ctx.t("actions", { name: name(source) })}
                    items={[
                      { label: ctx.t("edit"), icon: "edit", onSelect: () => void openForm(index()) },
                      {
                        label: ctx.t("up"),
                        icon: "arrow-up",
                        disabled: index() === 0,
                        onSelect: () => void save(moveSource(sources(), index(), -1)),
                      },
                      {
                        label: ctx.t("down"),
                        icon: "arrow-down-to-line",
                        disabled: index() === sources().length - 1,
                        onSelect: () => void save(moveSource(sources(), index(), 1)),
                      },
                      { type: "separator" },
                      {
                        label: ctx.t("remove"),
                        icon: "trash",
                        onSelect: () => void save(sources().filter((_, at) => at !== index())),
                      },
                    ]}
                  />
                </div>
              </ui.SettingsRow>
            )}
          </For>
        </Match>
      </Switch>
    </ui.SettingsSection>
  )
}

/** The source form, to add one or to change a listed one. */
function SourceDialog(props: {
  editing?: WeatherSource
  onCancel: () => void
  onSubmit: (source: WeatherSource) => void
}) {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui

  const [form, setForm] = createSignal<WeatherForm>(props.editing ? weatherFormOf(props.editing) : emptyWeatherForm)

  const [invalid, setInvalid] = createSignal(false)
  const set = (patch: Partial<WeatherForm>) => setForm((current) => ({ ...current, ...patch }))

  const submit = () => {
    const source = readWeatherForm(form(), props.editing)

    if (!source) return setInvalid(true)
    props.onSubmit(source)
  }

  return (
    <ui.Dialog
      title={props.editing ? ctx.t("form.title.edit") : ctx.t("form.title")}
      description={ctx.t("form.description")}
      footer={
        <>
          <ui.Button variant="ghost" onClick={props.onCancel}>
            {ctx.t("form.cancel")}
          </ui.Button>
          <ui.Button variant="contrast" onClick={submit}>
            {props.editing ? ctx.t("form.save") : ctx.t("form.submit")}
          </ui.Button>
        </>
      }
    >
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-1">
          <span class="text-12-medium text-v2-text-text-muted">{ctx.t("form.type")}</span>
          <div class="flex flex-wrap gap-2">
            <For each={WEATHER_SOURCE_TYPES}>
              {(type) => (
                <ui.Button
                  size="small"
                  variant={form().type === type ? "neutral" : "ghost"}
                  onClick={() => set({ type })}
                >
                  {ctx.t(`type.${type}`)}
                </ui.Button>
              )}
            </For>
          </div>
          <span class="text-12-regular text-v2-text-text-muted">{ctx.t(`about.${form().type}`)}</span>
        </div>
        <label class="flex flex-col gap-1">
          <span class="text-12-medium text-v2-text-text-muted">{ctx.t("form.name")}</span>
          <ui.TextInput
            label={ctx.t("form.name")}
            placeholder={ctx.t("form.name.placeholder")}
            size="large"
            class="w-full"
            value={form().name}
            onInput={(name) => set({ name })}
            onSubmit={submit}
          />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-12-medium text-v2-text-text-muted">{ctx.t("form.url")}</span>
          <ui.TextInput
            label={ctx.t("form.url")}
            placeholder={ctx.t("form.url.placeholder")}
            type="url"
            size="large"
            class="w-full"
            value={form().url}
            invalid={invalid()}
            onInput={(url) => {
              setInvalid(false)
              set({ url })
            }}
            onSubmit={submit}
          />
          <Show when={invalid()}>
            <span class="text-12-regular text-v2-state-fg-danger">{ctx.t("error.url.invalid")}</span>
          </Show>
        </label>
      </div>
    </ui.Dialog>
  )
}
