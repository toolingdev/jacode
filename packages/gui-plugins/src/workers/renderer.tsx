import {
  Command,
  createKeyed,
  MenuItem,
  Panel,
  Server,
  SettingsPage,
  Slot,
  type MountedSession,
  type PanelTab,
  type Plugin,
  type ServerEntry,
} from "@opencode/plugin/gui"
import { onIdle } from "@opencode/plugin/gui/builtin"
import { Schema } from "effect"
import { lazy, onCleanup, Show, Suspense } from "solid-js"
import { Ssh } from "../ssh/contract"
import { Workers, type UpdateTarget, type WorkersState } from "./contract"
import type definition from "./index"
import { screenUrl } from "./screen"

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

  // Fork feature: every worker follows the app's version. Workers set up over SSH are known by their address; a worker
  // connected by a pairing link needs its SSH address given once on the Workers page.
  const ssh = ctx.use(Ssh)
  const addresses = ctx.storage.store("updateAddresses", {
    schema: Schema.Record(Schema.String, Schema.String),
    initial: {},
  })
  const main = () => {
    const live = ipc()

    return live.status === "active" ? live.value : undefined
  }
  const linked = () =>
    ctx.servers
      .list()
      .flatMap((id) => ctx.servers.get(id) ?? [])
      .filter((ref) => !ref.builtin && !ref.local && URL.canParse(ref.url))
      .map((ref) => ({ id: `link:${ref.id}`, name: ref.name, target: addresses.value?.[`link:${ref.id}`] }))
  const sshWorkers = () => {
    const live = ssh()

    return live.status === "active" ? (live.value.state()?.servers.map((item) => item.config) ?? []) : []
  }

  createKeyed(
    () => {
      const client = main()
      const workers: UpdateTarget[] = [
        ...sshWorkers().map((config) => ({ id: `ssh:${config.id}`, name: config.name, target: config.target })),
        ...linked().flatMap((worker) => (worker.target ? [{ id: worker.id, name: worker.name, target: worker.target }] : [])),
      ]

      return client && addresses.value !== undefined ? { client, workers } : undefined
    },
    (value) => void value.client.track({ workers: value.workers }).catch(() => undefined),
    { equals: (a, b) => a.client === b.client && JSON.stringify(a.workers) === JSON.stringify(b.workers) },
  )

  // A worker reached through the SSH plugin connects only at the app's version, so once updated it connects again.
  createKeyed(
    () => {
      const updated = main()
        ?.state()
        ?.updates.filter((update) => update.state === "updated" && update.id.startsWith("ssh:"))
        .map((update) => update.id.slice(4))

      return updated && updated.length > 0 ? updated.join("\n") : undefined
    },
    (ids) => {
      const live = ssh()

      if (live.status !== "active") return
      for (const config of sshWorkers().filter((item) => ids.split("\n").includes(item.id)))
        void live.value.start({ ...config, background: true }).catch(() => undefined)
    },
  )

  const tracking: Tracking = {
    state: () => main()?.state(),
    linked,
    setAuto: (auto) => main()?.setAuto({ auto }) ?? Promise.resolve(),
    updateNow: (id) => main()?.updateNow({ id }) ?? Promise.resolve(),
    setAddress: (id, target) => addresses.set({ ...addresses.value, [id]: target }),
  }
  const Updates = lazy(() => import("./updates"))

  ctx.add(SettingsPage, {
    id: "updates",
    page: "servers",
    icon: "worker",
    get title() {
      return ctx.t("updates.title")
    },
    get entries() {
      return [{ id: "updates", title: ctx.t("updates.title"), keywords: "worker update version" }]
    },
    render: () => (
      <Suspense>
        <Updates tracking={tracking} />
      </Suspense>
    ),
  })

  // Fork feature: this computer's own server learns which workers it may hand scheduled tasks to, so a chat here can
  // schedule a task on a worker that keeps running while this computer sleeps. Workers on this computer (Docker, a
  // tunnel) sleep with it, so only those reached over the network count.
  createKeyed(
    () => {
      const refs = ctx.servers.list().flatMap((id) => ctx.servers.get(id) ?? [])
      const own = refs.find((ref) => ref.builtin)

      const list = refs
        .filter((ref) => !ref.builtin && !ref.local && URL.canParse(ref.url))
        .map((ref) => ({ name: ref.name, url: ref.url, password: ref.password }))

      return own?.connected ? { own, list } : undefined
    },
    (value) => void value.own.client.experimental.config.workers.set({ list: value.list }).catch(() => undefined),
    { equals: (a, b) => a.own.id === b.own.id && JSON.stringify(a.list) === JSON.stringify(b.list) },
  )

  // Fork feature: the worker's screen, as a side tab of a chat that runs on that worker. A button in the chat's
  // header opens or hides it; it is not on Home, which lists every computer at once.
  const Screen = lazy(() => import("./screen"))

  const screenTab: PanelTab = {
    id: "screen",
    get title() {
      return ctx.t("screen.title")
    },
  }

  ctx.add(Slot, {
    at: "session.header",
    order: 5,
    render: (input) => (
      <Show when={screenUrl(input.session.server)}>
        <AskedToTakeOver session={input.session} active={input.active} />
        <ctx.ui.IconButton
          icon="worker"
          label={ctx.t("screen.toggle")}
          variant="ghost"
          size="small"
          pressed={ctx.layout.state(`${ctx.id}:screen`, input.session) === "visible"}
          onClick={() => ctx.layout.toggle(`${ctx.id}:screen`, input.session)}
        />
      </Show>
    ),
  })

  // When a chat on a worker asks the user something, such as to sign in for it, its screen opens beside the question,
  // so taking control is one switch away. The app already notifies about the question itself.
  function AskedToTakeOver(props: { session: MountedSession; active: boolean }) {
    createKeyed(
      () => {
        const asking = (props.session.server.data.session.form.list(props.session.id) ?? []).length > 0

        return props.active && asking && props.session.id
      },
      () => ctx.layout.open(`${ctx.id}:screen`, props.session),
    )

    return null
  }

  ctx.add(Panel, {
    id: "screen",
    region: "side",
    width: 640,
    list: (input) => (input.open.includes("screen") && screenUrl(input.session.server) ? [screenTab] : []),
    render: (props) => (
      <Suspense>
        <Screen session={props.session} />
      </Suspense>
    ),
  })

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

/** What the Updates section reads and does, from the plugin's setup. */
export type Tracking = {
  readonly state: () => WorkersState | undefined
  readonly linked: () => readonly { readonly id: string; readonly name: string; readonly target?: string }[]
  readonly setAuto: (auto: boolean) => Promise<unknown>
  readonly updateNow: (id: string) => Promise<unknown>
  readonly setAddress: (id: string, target: string) => void
}

export default setup
