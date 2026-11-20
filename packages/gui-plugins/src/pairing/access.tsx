import { usePlugin, type IpcClient, type Live } from "@opencode/plugin/gui"
import { createSignal, For, onCleanup, Show, type Accessor } from "solid-js"
import type { AccessEntry, AccessInput, AccessMethod, AccessStatus, Pairing } from "./contract"
import type definition from "./index"

type Client = IpcClient<typeof Pairing.spec>

// How often the list asks the service again while it is on screen; the service checks each address once a minute.
const REFRESH_MS = 5_000

/**
 * Fork feature: the ways another device reaches this computer, in the order pairing hands them out, each with what
 * the background service found for it. Mirrors the time servers list: a numbered list with up and down buttons.
 */
export default function AccessMethods(props: { pairing: Accessor<Live<Client>> }) {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui

  const [status, setStatus] = createSignal<AccessStatus>()
  const [readFailed, setReadFailed] = createSignal(false)
  const [saving, setSaving] = createSignal(false)
  const [saveError, setSaveError] = createSignal<string>()
  const [draft, setDraft] = createSignal<string>()

  const main = () => {
    const live = props.pairing()

    return live.status === "active" ? live.value : undefined
  }

  // A read that lands while a save restarts the service would show the old choices, so reads wait for the save.
  const read = () => {
    const client = main()

    if (!client || saving()) return
    void client.access({ signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(15_000)]) }).then(
      (next) => {
        if (saving()) return
        setStatus(next)
        setReadFailed(false)
      },
      () => setReadFailed(true),
    )
  }

  read()
  const timer = setInterval(read, REFRESH_MS)
  onCleanup(() => clearInterval(timer))

  const entries = () => status()?.entries ?? []

  const input = (change: Partial<AccessInput>): AccessInput => {
    const list = entries()
    const chosen = (method: AccessMethod) => list.find((entry) => entry.method === method)?.chosen === true

    return {
      order: list.map((entry) => entry.method),
      tailscale: chosen("tailscale"),
      funnel: chosen("funnel"),
      lan: chosen("lan"),
      opentunnel: chosen("opentunnel"),
      custom: status()?.custom,
      ...change,
    }
  }

  const save = (change: Partial<AccessInput>) => {
    const client = main()

    if (!client || saving()) return
    const next = input(change)

    setSaving(true)
    setSaveError(undefined)
    // Shown at once, as the time servers list does; the next read replaces it with what the service found.
    setStatus((current) => current && optimistic(current, next))
    void client.setAccess(next, { signal: ctx.signal }).then(
      () => {
        setSaving(false)
        setDraft(undefined)
        read()
      },
      (error: Error) => {
        setSaving(false)
        setSaveError(error.message)
        read()
      },
    )
  }

  const toggle = (method: AccessMethod, on: boolean) => {
    if (method === "custom") return save({ custom: on ? (draft() ?? status()?.custom) : undefined })

    save({ [method]: on })
  }

  const move = (index: number, step: -1 | 1) => {
    const order = entries().map((entry) => entry.method)
    const current = order[index]
    const other = order[index + step]

    if (current === undefined || other === undefined) return
    order[index] = other
    order[index + step] = current
    save({ order })
  }

  const describe = (entry: AccessEntry) => {
    const about = ctx.t(`method.${entry.method}.about`)

    if (!entry.chosen) return about

    const state =
      entry.state === "ready" && entry.url
        ? ctx.t("access.state.ready", { url: entry.url })
        : entry.state === "failed"
          ? entry.message
            ? ctx.t("access.state.failed", { reason: entry.message })
            : ctx.t("access.state.failed.unknown")
          : entry.state === "starting"
            ? ctx.t("access.state.starting")
            : ctx.t("access.state.off")

    return `${state} ${about}`
  }

  return (
    <Show when={main()}>
      <ui.SettingsSection
        title={ctx.t("access.title")}
        footer={
          <div class="flex flex-col gap-2 pt-2">
            <p class="text-12-regular text-v2-text-text-muted">{ctx.t("access.description")}</p>
            <Show when={status()?.paused}>
              <p class="text-12-regular text-v2-state-fg-warning">{ctx.t("access.paused")}</p>
            </Show>
            <Show when={status() && status()?.enabled && !status()?.running && !saving()}>
              <p class="text-12-regular text-v2-state-fg-warning">{ctx.t("access.stopped")}</p>
            </Show>
            <Show when={saving()}>
              <p class="text-12-regular text-v2-text-text-muted" role="status">
                {ctx.t("access.saving")}
              </p>
            </Show>
            <Show when={saveError()}>
              {(reason) => (
                <p class="text-v2-state-fg-danger" role="alert">
                  {ctx.t("access.failed", { reason: reason() })}
                </p>
              )}
            </Show>
            <Show when={readFailed() && !status()}>
              <p class="text-v2-state-fg-danger" role="alert">
                {ctx.t("access.unavailable")}
              </p>
            </Show>
            <div class="flex items-center gap-2">
              <div class="min-w-0 flex-1">
                <ui.TextInput
                  label={ctx.t("access.custom.label")}
                  value={draft() ?? status()?.custom ?? ""}
                  onInput={setDraft}
                  onSubmit={() => save({ custom: draft()?.trim() || undefined })}
                  placeholder={ctx.t("access.custom.placeholder")}
                />
              </div>
              <ui.Button
                variant="neutral"
                size="small"
                class="shrink-0 whitespace-nowrap"
                disabled={saving() || !draft()?.trim() || draft()?.trim() === status()?.custom}
                onClick={() => save({ custom: draft()?.trim() })}
              >
                {ctx.t("access.custom.save")}
              </ui.Button>
              <Show when={status()?.custom}>
                <ui.Button
                  variant="ghost"
                  size="small"
                  class="shrink-0 whitespace-nowrap"
                  disabled={saving()}
                  onClick={() => save({ custom: undefined })}
                >
                  {ctx.t("access.custom.clear")}
                </ui.Button>
              </Show>
            </div>
          </div>
        }
      >
        <For each={entries()}>
          {(entry, index) => (
            <ui.SettingsRow
              id={`settings-access-${entry.method}`}
              title={`${index() + 1}. ${ctx.t(`method.${entry.method}`)}`}
              description={describe(entry)}
            >
              <div class="flex items-center gap-1">
                <ui.IconButton
                  icon="arrow-up"
                  label={ctx.t("access.up", { method: ctx.t(`method.${entry.method}`) })}
                  variant="ghost"
                  size="small"
                  disabled={saving() || index() === 0}
                  onClick={() => move(index(), -1)}
                />
                {/* The icon set has no down arrow; the up arrow turned over stands in for it. */}
                <span class="flex rotate-180">
                  <ui.IconButton
                    icon="arrow-up"
                    label={ctx.t("access.down", { method: ctx.t(`method.${entry.method}`) })}
                    variant="ghost"
                    size="small"
                    disabled={saving() || index() === entries().length - 1}
                    onClick={() => move(index(), 1)}
                  />
                </span>
                <ui.Switch
                  label={ctx.t(`method.${entry.method}`)}
                  hideLabel
                  checked={entry.chosen}
                  disabled={saving() || (entry.method === "custom" && !entry.chosen && !(draft() ?? status()?.custom))}
                  onChange={(on) => toggle(entry.method, on)}
                />
              </div>
            </ui.SettingsRow>
          )}
        </For>
      </ui.SettingsSection>
    </Show>
  )
}

/** The list as it will look once the service has the new choices: the new order, each chosen way setting up. */
function optimistic(current: AccessStatus, next: AccessInput): AccessStatus {
  const chosen = (method: AccessMethod) => (method === "custom" ? !!next.custom : next[method])

  return {
    ...current,
    paused: false,
    custom: next.custom,
    entries: next.order.flatMap((method) => {
      const entry = current.entries.find((found) => found.method === method)

      if (!entry) return []

      const on = chosen(method)

      return [
        {
          method,
          chosen: on,
          state: on ? (entry.chosen ? entry.state : "starting") : "off",
          url: on ? entry.url : undefined,
          message: on ? entry.message : undefined,
        },
      ]
    }),
  }
}
