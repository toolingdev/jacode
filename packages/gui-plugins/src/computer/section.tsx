import { createKeyed, usePlugin } from "@opencode/plugin/gui"
import { showToast } from "@opencode/ui/toast"
import { createMemo, createSignal, For, Show } from "solid-js"
import type definition from "./index"

const KINDS = ["screenshot", "click", "move", "drag", "scroll", "type", "key"] as const

type Allowed = { readonly id: string; readonly kind: string; readonly project: string }

/**
 * Fork feature: Settings › Mac control. Switches the computer tool off or on for this Mac's chats, lists the kinds of
 * action the user allowed always (from the approval prompt in a chat) with a way to have each ask again, and says what
 * macOS needs the first time.
 */
export default function MacControlSection() {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui
  const server = createMemo(() =>
    ctx.servers
      .list()
      .flatMap((id) => ctx.servers.get(id) ?? [])
      .find((ref) => ref.builtin),
  )
  // `undefined` until the config is read.
  const [enabled, setEnabled] = createSignal<boolean>()
  const [allowed, setAllowed] = createSignal<readonly Allowed[]>([])

  const read = () => {
    const client = server()?.client

    if (!client) return
    void client.config.get().then(
      (entries) => {
        const boundary = entries.findIndex((entry) => entry.type === "directory")
        const value = (boundary === -1 ? entries : entries.slice(0, boundary))
          .flatMap((entry) => (entry.type === "document" ? [entry.info.experimental?.computer_use] : []))
          .findLast((found) => found !== undefined)

        setEnabled(value !== false)
      },
      () => undefined,
    )
    void Promise.all([client.permission.saved.list(), client.project.list()]).then(
      ([saved, projects]) =>
        setAllowed(
          saved
            .filter((item) => item.action === "computer")
            .map((item) => {
              const project = projects.find((found) => found.id === item.projectID)

              return {
                id: item.id,
                kind: item.resource,
                project: project?.name ?? project?.canonical.split("/").at(-1) ?? item.projectID,
              }
            }),
        ),
      () => undefined,
    )
  }

  createKeyed(
    () => server()?.connected && server()?.id,
    () => read(),
  )

  const toggle = (on: boolean) => {
    setEnabled(on)
    void server()
      ?.client.experimental.config.update({ computer: on ? null : false })
      .catch(() => {
        showToast({ variant: "error", title: ctx.t("failed") })
        read()
      })
  }

  const remove = (id: string) => {
    setAllowed((all) => all.filter((item) => item.id !== id))
    void server()
      ?.client.permission.saved.remove({ id })
      .catch(() => {
        showToast({ variant: "error", title: ctx.t("failed") })
        read()
      })
  }

  const label = (kind: string) =>
    KINDS.some((known) => known === kind) ? ctx.t(`kind.${kind}` as `kind.${(typeof KINDS)[number]}`) : kind

  return (
    <ui.SettingsLayout title={ctx.t("title")} description={ctx.t("description")}>
      <Show
        when={ctx.desktop?.os === "macos" && server()}
        fallback={
          <ui.SettingsSection>
            <ui.SettingsRow title={ctx.t("unavailable")} />
          </ui.SettingsSection>
        }
      >
        <ui.SettingsSection>
          <ui.SettingsRow
            id="settings-mac-control-enabled"
            title={ctx.t("enabled")}
            description={ctx.t("enabled.about")}
          >
            <ui.Switch
              label={ctx.t("enabled")}
              hideLabel
              checked={enabled() ?? true}
              disabled={enabled() === undefined}
              onChange={toggle}
            />
          </ui.SettingsRow>
        </ui.SettingsSection>
        <ui.SettingsSection title={ctx.t("allowed")}>
          <Show
            when={allowed().length > 0}
            fallback={<ui.SettingsRow title={ctx.t("allowed.empty")} description={ctx.t("allowed.none")} />}
          >
            <For each={allowed()}>
              {(item) => (
                <ui.SettingsRow
                  id={`settings-mac-control-allowed-${item.id}`}
                  title={label(item.kind)}
                  description={ctx.t("allowed.where", { project: item.project })}
                >
                  <ui.Button variant="neutral" size="small" onClick={() => remove(item.id)}>
                    {ctx.t("remove")}
                  </ui.Button>
                </ui.SettingsRow>
              )}
            </For>
          </Show>
        </ui.SettingsSection>
        <ui.SettingsSection title={ctx.t("macos")}>
          <ui.SettingsRow title={ctx.t("macos.title")} description={ctx.t("macos.about")} />
        </ui.SettingsSection>
      </Show>
    </ui.SettingsLayout>
  )
}
