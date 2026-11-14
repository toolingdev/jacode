import { lazy, onCleanup, Suspense } from "solid-js"
import { Command, SettingsPage, type Plugin } from "@opencode/plugin/gui"
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

  ctx.add(Command, () => ({
    id: "open",
    title: ctx.t("command.title"),
    group: ctx.t("command.group"),
    run: () => ctx.layout.settings("mcp-servers"),
  }))
}

export default setup
