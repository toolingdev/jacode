import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { createMemo, For, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerHealthIndicator } from "@/servers/registry/row"
import { sessionBusy } from "@/shell/layout/project-avatar-state"

// The port a worker's screen viewer (noVNC) listens on, as the worker setup installs it.
const SCREEN_PORT = 6080

/**
 * Fork feature: one card per worker on Home, so what each is doing is seen at a glance: whether it is working, the
 * chats it is working on, the last one it finished, and a live picture of its screen when the worker shares one.
 */
export function HomeWorkers() {
  const servers = useServers()
  const workers = createMemo(() => servers.list.filter((conn) => !ServerConnection.builtin(conn)))

  return (
    <Show when={workers().length > 0}>
      <div class="mb-4 grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
        <For each={workers()}>{(conn) => <WorkerCard conn={conn} />}</For>
      </div>
    </Show>
  )
}

function WorkerCard(props: { conn: ServerConnection.Any }) {
  const language = useLanguage()
  const global = useGlobal()
  const servers = useServers()
  const platform = usePlatform()
  const key = () => ServerConnection.key(props.conn)
  const data = () => global.serverCtx(key())?.data

  const chats = createMemo(() => {
    const current = data()

    if (!current) return []

    return current.session.list().filter((session) => current.session.root(session.id) === session.id)
  })

  const busy = createMemo(() => {
    const current = data()

    return current ? chats().filter((session) => sessionBusy(current, session.id)) : []
  })

  const finished = createMemo(
    () =>
      chats()
        .filter((session) => session.time.idle !== undefined && !busy().includes(session))
        .toSorted((a, b) => (b.time.idle ?? 0) - (a.time.idle ?? 0))[0],
  )

  const screen = createMemo(() => screenUrl(props.conn))
  const title = (session: { title?: string }) => session.title || language.t("home.workers.untitled")

  return (
    <section
      data-component="home-worker-card"
      aria-label={servers.label(props.conn)}
      class="flex min-w-0 flex-col gap-2 rounded-[10px] border border-v2-border-border-base bg-v2-background-bg-layer-01 p-3"
    >
      <div class="flex items-center gap-2">
        <ServerHealthIndicator health={global.servers.health[key()]} />
        <Icon name="worker" size="small" class="shrink-0 text-v2-icon-icon-muted" />
        <span class="min-w-0 flex-1 truncate text-13-medium text-v2-text-text-base">{servers.label(props.conn)}</span>
        <span
          class="shrink-0 rounded-full px-2 py-0.5 text-11-medium"
          classList={{
            "bg-v2-state-bg-success text-v2-state-fg-success": busy().length > 0,
            "bg-v2-background-bg-layer-02 text-v2-text-text-muted": busy().length === 0,
          }}
        >
          {language.t(busy().length > 0 ? "home.workers.busy" : "home.workers.idle")}
        </span>
      </div>
      <Show when={screen()}>
        {(url) => (
          <div class="relative aspect-video w-full overflow-hidden rounded-[6px] bg-v2-background-bg-deep">
            {/* View only and scaled down: a picture of the screen, not a way to work on it. */}
            <iframe
              src={`${url()}/vnc.html?autoconnect=1&view_only=1&resize=scale&reconnect=1`}
              title={language.t("home.workers.screen")}
              class="pointer-events-none absolute inset-0 size-full border-0"
              loading="lazy"
            />
          </div>
        )}
      </Show>
      <div class="flex flex-col gap-1 text-12-regular">
        <Show
          when={busy().length > 0}
          fallback={<span class="text-v2-text-text-muted">{language.t("home.workers.nothing")}</span>}
        >
          <For each={busy()}>
            {(session) => (
              <span class="truncate text-v2-text-text-base">
                {language.t("home.workers.working", { title: title(session) })}
              </span>
            )}
          </For>
        </Show>
        <Show when={finished()}>
          {(session) => (
            <span class="truncate text-v2-text-text-muted">
              {language.t("home.workers.finished", { title: title(session()) })}
            </span>
          )}
        </Show>
      </div>
      <Show when={screen()}>
        {(url) => (
          <Button
            variant="ghost"
            size="small"
            icon="photo"
            class="self-start"
            onClick={() => platform.openExternal(`${url()}/vnc.html?autoconnect=1&resize=scale`)}
          >
            {language.t("home.workers.open")}
          </Button>
        )}
      </Show>
    </section>
  )
}

// A worker reached over the network shares its screen on its own address; one reached through an SSH tunnel or on
// this computer has no address to show it on.
function screenUrl(conn: ServerConnection.Any) {
  const http = ServerConnection.http(conn)

  if (!http || !URL.canParse(http.url)) return
  const host = new URL(http.url).hostname

  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return

  return `http://${host}:${SCREEN_PORT}`
}
