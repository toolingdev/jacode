import { usePlugin, type MountedSession, type ServerRef } from "@opencode/plugin/gui"
import { createSignal, Show } from "solid-js"
import type definition from "./index"

// The port a worker's screen viewer (noVNC) listens on, as the worker setup installs it.
const SCREEN_PORT = 6080

/**
 * Fork feature: where a worker shows its screen. A worker reached over the network shares it on its own address; one
 * reached through an SSH tunnel or running on this computer has no address to show it on, so it has none.
 */
export function screenUrl(server: ServerRef) {
  if (server.builtin || !URL.canParse(server.url)) return
  const host = new URL(server.url).hostname

  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return

  return `http://${host}:${SCREEN_PORT}/vnc.html?autoconnect=1&resize=scale&reconnect=1`
}

/**
 * The worker's screen beside a chat that runs on it. It starts view only, so a click in it cannot disturb the
 * worker's work; Take control hands the mouse and keyboard to the user until they give it back.
 */
export default function WorkerScreen(props: { session: MountedSession }) {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui
  const [control, setControl] = createSignal(false)

  return (
    <Show when={screenUrl(props.session.server)}>
      {(url) => (
        <div class="flex h-full min-h-0 flex-1 flex-col gap-2 p-2">
          <div class="flex items-center justify-between gap-3">
            <div class="flex min-w-0 items-center gap-2">
              <ui.Switch label={ctx.t("screen.control")} hideLabel checked={control()} onChange={setControl} />
              <span class="text-13-medium text-v2-text-text-base">{ctx.t("screen.control")}</span>
            </div>
            <ui.Button
              variant="ghost"
              size="small"
              icon="photo"
              class="shrink-0 whitespace-nowrap"
              onClick={() => ctx.system.openExternal(url())}
            >
              {ctx.t("screen.open")}
            </ui.Button>
          </div>
          <p class="text-12-regular text-v2-text-text-muted">
            {ctx.t(control() ? "screen.control.on" : "screen.control.off")}
          </p>
          <div class="relative min-h-[320px] flex-1 overflow-hidden rounded-[6px] bg-black">
            {/* Reloaded with the other mode when control changes: noVNC reads view_only only when it connects. */}
            <iframe
              src={`${url()}&view_only=${control() ? 0 : 1}`}
              title={ctx.t("screen.title")}
              class="absolute inset-0 h-full w-full border-0"
              classList={{ "pointer-events-none": !control() }}
            />
          </div>
        </div>
      )}
    </Show>
  )
}
