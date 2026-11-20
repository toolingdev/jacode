import { createSignal, For, lazy, onCleanup, Show, Suspense } from "solid-js"
import { Command, ComposerPill, createKeyed, SettingsPage, type ComposerPillProps, type Plugin } from "@opencode/plugin/gui"
import { showToast } from "@opencode/ui/toast"
import { isOff, withServer } from "./chat-tools"
import { onIdle } from "@opencode/plugin/gui/builtin"
import type definition from "./index"

/**
 * The MCP servers settings page: the servers of the current location with their status, and adding, removing,
 * reconnecting and listing the tools of each. Adding and removing write the global config, so they survive a restart.
 */
const setup: Plugin.Setup<typeof definition> = (ctx) => {
  const Page = lazy(() => import("./page"))
  // Load the page while idle so settings opens without a blank page.
  onCleanup(onIdle(() => void Page.preload()))

  ctx.add(SettingsPage, {
    id: "mcp-servers",
    icon: "mcp",
    get title() {
      return ctx.t("title")
    },
    get entries() {
      return [{ id: "mcp-servers", title: ctx.t("title"), keywords: "mcp server tools add remove connect extension" }]
    },
    render: () => (
      <Suspense>
        <Page />
      </Suspense>
    ),
  })

  // MCP connections are per location; the pill reads the routed chat's, loaded once it is routed.
  createKeyed(
    () => {
      const session = ctx.sessions.current()
      const where = session?.location

      return (
        session?.server.connected && where && JSON.stringify([session.server.id, where.directory, where.workspaceID ?? null])
      )
    },
    () => {
      const session = ctx.sessions.current()
      const where = session?.location

      if (session && where) void session.server.data.location.mcp.server.sync(where).catch(() => undefined)
    },
  )

  const servers = (input: ComposerPillProps) => {
    const where = input.session.location

    return [...((where && input.session.server.data.location.mcp.server.list(where)) || [])].toSorted((a, b) =>
      a.name.localeCompare(b.name),
    )
  }
  const rules = (input: ComposerPillProps) => input.session.server.data.session.get(input.session.id)?.permissions
  const [saving, setSaving] = createSignal(false)

  // Fork feature: switch connected tools on or off for this chat alone, from the row above the composer.
  ctx.add(ComposerPill, {
    id: "chat-tools",
    order: 30,
    show: (input) => {
      const list = servers(input)

      if (list.length === 0) return
      const off = list.filter((item) => isOff(rules(input), item.name)).length

      return {
        icon: "mcp",
        title: ctx.t("chat.title"),
        label: off === 0 ? ctx.t("chat.label") : ctx.t("chat.label.off", { count: off }),
        tone: off > 0 ? ("warning" as const) : undefined,
      }
    },
    menu: (input) => {
      const toggle = (name: string, on: boolean) => {
        setSaving(true)
        void input.session.server.client.session
          .update({ sessionID: input.session.id, permissions: withServer(rules(input), name, on) })
          .catch((cause: Error) => showToast({ variant: "error", title: ctx.t("chat.failed"), description: cause.message }))
          .finally(() => setSaving(false))
      }

      return (
        <div class="flex flex-col gap-2 p-2">
          <p class="text-12-regular text-v2-text-text-muted">{ctx.t("chat.description")}</p>
          <For each={servers(input)}>
            {(item) => (
              <div class="flex items-center justify-between gap-3">
                <div class="flex min-w-0 flex-col">
                  <span class="truncate text-13-medium">{item.name}</span>
                  <Show when={item.status.status !== "connected"}>
                    <span class="truncate text-12-regular text-v2-text-text-muted">
                      {ctx.t(`status.${item.status.status}`, {
                        error: "error" in item.status ? String(item.status.error) : "",
                      })}
                    </span>
                  </Show>
                </div>
                <ctx.ui.Switch
                  label={item.name}
                  hideLabel
                  checked={!isOff(rules(input), item.name)}
                  disabled={saving()}
                  onChange={(on) => toggle(item.name, on)}
                />
              </div>
            )}
          </For>
          <button
            type="button"
            class="self-start text-12-regular text-v2-text-text-muted underline"
            onClick={() => {
              input.close()
              ctx.layout.settings("mcp-servers")
            }}
          >
            {ctx.t("chat.manage")}
          </button>
        </div>
      )
    },
  })

  ctx.add(Command, () => ({
    id: "open",
    title: ctx.t("command.title"),
    group: ctx.t("command.group"),
    run: () => ctx.layout.settings("mcp-servers"),
  }))
}

export default setup
