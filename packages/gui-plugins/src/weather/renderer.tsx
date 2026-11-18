import { lazy, onCleanup, Suspense } from "solid-js"
import { Command, SettingsPage, type Plugin } from "@opencode/plugin/gui"
import { onIdle } from "@opencode/plugin/gui/builtin"
import type definition from "./index"

/**
 * Fork feature: the Weather settings page, where the weather tool's forecast sources are added, changed, ordered
 * and removed. It writes the global config, so nobody edits the config file for it.
 */
const setup: Plugin.Setup<typeof definition> = (ctx) => {
  const Page = lazy(() => import("./page"))
  // Load the page while idle so settings opens without a blank page.
  onCleanup(onIdle(() => void Page.preload()))

  ctx.add(SettingsPage, {
    id: "weather",
    // Fork feature: weather sources live on the Cards page.
    page: "visuals",
    icon: "globe",
    get title() {
      return ctx.t("title")
    },
    get entries() {
      return [{ id: "weather", title: ctx.t("title"), keywords: "weather forecast source service temperature" }]
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
    run: () => ctx.layout.settings("weather"),
  }))
}

export default setup
