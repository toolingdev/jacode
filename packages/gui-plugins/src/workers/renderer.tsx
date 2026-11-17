import { Command, MenuItem, Server, type Plugin, type ServerEntry } from "@opencode/plugin/gui"
import { onIdle } from "@opencode/plugin/gui/builtin"
import { lazy, onCleanup, Suspense } from "solid-js"
import { Workers } from "./contract"
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

  const ipc = ctx.use(Workers)
  const Row = lazy(() => import("./docker-row"))

  const docker = () => {
    const live = ipc()

    return live.status === "active" ? live.value.state()?.docker : undefined
  }

  // The Docker worker is this plugin's own server: main says where it answers, and starts it when it is stopped.
  const resolve = async () => {
    const live = ipc()
    const http = live.status === "active" ? await live.value.dockerResolve({}) : null

    if (!http) throw new Error(ctx.t("failure.docker"))

    return http
  }

  const entry = (worker: NonNullable<ReturnType<typeof docker>>): ServerEntry => ({
    id: "docker",
    name: worker.name,
    label: ctx.t("docker.label"),
    state: worker.state,
    http: worker.http,
    reconnect: resolve,
    connect: () =>
      resolve().then(
        () => true,
        () => false,
      ),
    remove: async () => {
      const live = ipc()

      if (live.status !== "active") throw new Error(ctx.t("failure.docker"))
      await live.value.dockerRemove({})
    },
    row: (row) => (
      <Suspense>
        <Row row={row} worker={() => docker() ?? worker} onStart={() => void resolve().catch(() => undefined)} />
      </Suspense>
    ),
  })

  ctx.add(Server, () => {
    const live = ipc()
    const state = live.status === "active" ? live.value.state() : undefined
    const worker = state?.docker

    return { ready: state !== undefined, order: 3, entries: worker ? [entry(worker)] : [] }
  })

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
