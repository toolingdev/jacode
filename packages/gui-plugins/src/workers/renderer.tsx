import { lazy, onCleanup, Suspense } from "solid-js"
import { Command, SettingsPage, type Plugin } from "@opencode/plugin/gui"
import { onIdle } from "@opencode/plugin/gui/builtin"
import type definition from "./index"

/**
 * Fork feature: the Workers settings page. It says what this computer's own server is, lists the workers, and
 * guides adding one: where it runs, what the machine needs, a check that changes nothing, the install, and the
 * connection, all from the app.
 */
const setup: Plugin.Setup<typeof definition> = (ctx) => {
  const Page = lazy(() => import("./page"))
  // Load the page while idle so settings opens without a blank page.
  onCleanup(onIdle(() => void Page.preload()))

  ctx.add(SettingsPage, {
    id: "workers",
    icon: "server",
    get title() {
      return ctx.t("title")
    },
    get entries() {
      return [
        {
          id: "workers",
          title: ctx.t("title"),
          keywords: "worker remote server vps ssh docker machine computer add setup install",
        },
      ]
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
    run: () => ctx.layout.settings("workers"),
  }))
}

export default setup
