import { Command, MenuItem, type Plugin } from "@opencode/plugin/gui"
import { onIdle } from "@opencode/plugin/gui/builtin"
import { lazy, onCleanup, Suspense } from "solid-js"
import type definition from "./index"

/**
 * Fork feature: the guided way to add a worker, in the Add menu of the Workers settings page (the host's Servers
 * page), so workers are added, connected and removed in one place. It asks where the worker runs, says what the
 * machine needs, checks it without changing anything, installs, and connects, all from the app.
 */
const setup: Plugin.Setup<typeof definition> = (ctx) => {
  if (ctx.app.platform !== "desktop") return

  const Dialog = lazy(() => import("./dialog"))
  // Load the dialog while idle so it opens at once.
  onCleanup(onIdle(() => void Dialog.preload()))

  const open = () =>
    void ctx.dialogs.open((dialog) => (
      <Suspense>
        <Dialog onClose={dialog.close} />
      </Suspense>
    ))

  ctx.add(MenuItem, (): MenuItem => ({ menu: "server.add", id: "setup", title: ctx.t("add"), order: 0, run: open }))

  ctx.add(Command, () => ({
    id: "open",
    title: ctx.t("command.title"),
    group: ctx.t("command.group"),
    run: () => {
      ctx.layout.settings("servers")
      open()
    },
  }))
}

export default setup
