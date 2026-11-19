import { createKeyed, usePlugin } from "@opencode/plugin/gui"
import { showToast } from "@opencode/ui/toast"
import { createMemo, createSignal, For, Show } from "solid-js"
import type definition from "./index"

// The servers the time tool uses when the config lists none; kept in step with the tool's own defaults.
const DEFAULTS = ["time.cloudflare.com", "time.google.com", "pool.ntp.org"]

export default function TimeServersSection() {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui

  // The routed chat's computer, else the app's own, else the first listed: Settings can open without a chat.
  const server = createMemo(() => {
    const refs = ctx.servers.list().flatMap((id) => ctx.servers.get(id) ?? [])

    return ctx.sessions.current()?.server ?? refs.find((ref) => ref.builtin) ?? refs[0]
  })

  // What the config lists: `undefined` until read, `null` when it lists none and the defaults apply.
  const [saved, setSaved] = createSignal<readonly string[] | null>()
  const [draft, setDraft] = createSignal("")

  const read = () => {
    const current = server()

    if (!current) return
    void current.client.config.get().then(
      (entries) => {
        const boundary = entries.findIndex((entry) => entry.type === "directory")

        setSaved(
          (boundary === -1 ? entries : entries.slice(0, boundary))
            .flatMap((entry) => (entry.type === "document" ? [entry.info.experimental?.time] : []))
            .findLast((found) => found !== undefined)?.servers ?? null,
        )
      },
      () => undefined,
    )
  }

  createKeyed(
    () => server()?.connected && server()?.id,
    () => read(),
  )

  const list = () => saved() ?? DEFAULTS

  // Shown at once; the config is read again when the write fails, so the page never shows what was not saved.
  const save = (next: readonly string[] | null) => {
    const client = server()?.client

    if (!client) return
    setSaved(next)
    void (
      next ? client.experimental.config.time.set({ servers: [...next] }) : client.experimental.config.time.remove()
    ).then(
      () => undefined,
      () => {
        showToast({ variant: "error", title: ctx.t("failed") })
        read()
      },
    )
  }

  const add = () => {
    const host = draft().trim()

    if (!host || list().includes(host)) return
    save([...list(), host])
    setDraft("")
  }

  return (
    <ui.SettingsSection
      title={ctx.t("title")}
      footer={
        <div class="flex flex-col gap-2 pt-2">
          <p class="text-12-regular text-v2-text-text-muted">{ctx.t("description")}</p>
          <Show when={server() && saved() === null}>
            <p class="text-12-regular text-v2-text-text-muted">{ctx.t("defaults")}</p>
          </Show>
          <div class="flex items-center gap-2">
            <div class="min-w-0 flex-1">
              <ui.TextInput
                label={ctx.t("add")}
                value={draft()}
                onInput={setDraft}
                onSubmit={add}
                placeholder={ctx.t("placeholder")}
              />
            </div>
            <ui.Button
              variant="neutral"
              size="small"
              icon="plus"
              class="shrink-0 whitespace-nowrap"
              disabled={!server() || !draft().trim()}
              onClick={add}
            >
              {ctx.t("add")}
            </ui.Button>
            <Show when={saved()}>
              <ui.Button variant="ghost" size="small" class="shrink-0 whitespace-nowrap" onClick={() => save(null)}>
                {ctx.t("reset")}
              </ui.Button>
            </Show>
          </div>
        </div>
      }
    >
      <Show when={server()} fallback={<ui.SettingsRow title={ctx.t("unavailable")} />}>
        <For each={list()}>
          {(host, index) => (
            <ui.SettingsRow id={`time-server-${index()}`} title={`${index() + 1}. ${host}`}>
              <Show when={list().length > 1}>
                <div class="flex items-center gap-1">
                  <ui.IconButton
                    icon="arrow-up"
                    label={ctx.t("up", { server: host })}
                    variant="ghost"
                    size="small"
                    disabled={index() === 0}
                    onClick={() => save(move(list(), index(), -1))}
                  />
                  {/* The icon set has no down arrow; the up arrow turned over stands in for it. */}
                  <span class="flex rotate-180">
                    <ui.IconButton
                      icon="arrow-up"
                      label={ctx.t("down", { server: host })}
                      variant="ghost"
                      size="small"
                      disabled={index() === list().length - 1}
                      onClick={() => save(move(list(), index(), 1))}
                    />
                  </span>
                  <ui.IconButton
                    icon="close"
                    label={ctx.t("remove", { server: host })}
                    variant="ghost"
                    size="small"
                    onClick={() => save(list().filter((other) => other !== host))}
                  />
                </div>
              </Show>
            </ui.SettingsRow>
          )}
        </For>
      </Show>
    </ui.SettingsSection>
  )
}

/** The list with the server at `index` swapped with its neighbour one step up (-1) or down (1). */
function move(list: readonly string[], index: number, step: -1 | 1) {
  const next = [...list]
  const target = index + step
  const current = next[index]
  const other = next[target]

  if (current === undefined || other === undefined) return next
  next[index] = other
  next[target] = current

  return next
}
