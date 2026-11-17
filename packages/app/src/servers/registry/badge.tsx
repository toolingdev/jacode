import { Show } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { pickProjectAvatarVariant, type ProjectAvatarVariant } from "@opencode/ui/project-avatar"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import "./badge.css"

// Green is this computer's, so another server never takes it.
const REMOTE_COLORS: readonly ProjectAvatarVariant[] = ["orange", "pink", "purple", "yellow", "blue", "red", "cyan"]

/**
 * Fork feature: tells this computer's sessions from another server's at a glance. This computer is a green monitor;
 * every other server is a server mark in a color of its own. Alone it is a small filled square, so it reads on a tab
 * of any color; `named` makes it a pill with the server's name. Shows nothing while there is only one server.
 */
export function ServerBadge(props: { server?: ServerConnection.Any; named?: boolean }) {
  const servers = useServers()
  const language = useLanguage()

  const shown = () => (servers.list.length > 1 ? props.server : undefined)

  return (
    <Show when={shown()}>
      {(conn) => (
        <span
          data-component="server-badge"
          data-kind={servers.local(conn()) ? "local" : "remote"}
          data-named={props.named ? "" : undefined}
          style={{
            "--server-badge-tint": `var(--v2-avatar-bg-${servers.local(conn()) ? "green" : pickProjectAvatarVariant(ServerConnection.key(conn()), REMOTE_COLORS)})`,
          }}
        >
          <Icon name={servers.local(conn()) ? "monitor" : "server"} size="small" aria-hidden="true" />
          <Show when={props.named}>
            <bdi dir="auto" class="min-w-0 truncate">
              {servers.local(conn()) ? language.t("server.thisComputer") : servers.label(conn())}
            </bdi>
          </Show>
        </span>
      )}
    </Show>
  )
}
