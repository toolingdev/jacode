import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { Show } from "solid-js"
import { usePlugin, type ServerRow } from "@opencode/plugin/gui"
import type { DockerWorker } from "./contract"
import type definition from "./index"

/** The Docker worker's row in the list of workers: how it is doing, a way to start it, and its removal. */
export default function DockerRow(props: { row: ServerRow; worker: () => DockerWorker; onStart: () => void }) {
  const plugin = usePlugin<typeof definition>()

  const indicator = () => {
    if (props.worker().state === "ready") return props.row.health() ?? { healthy: true }

    return props.worker().state === "failed" ? { healthy: false } : undefined
  }

  return (
    <div class="settings-servers-row">
      <div class="settings-servers-lead">
        <props.row.Indicator health={indicator()} connecting={props.worker().state === "starting"} />
        <div class="settings-servers-copy">
          <span class="flex min-w-0 items-center gap-1">
            <bdi class="settings-servers-name truncate" dir="auto">
              {props.worker().name}
            </bdi>
            <span class="shrink-0 rounded-[3px] border border-v2-border-border-base px-1 py-0.5 text-[9px] leading-none text-v2-text-text-muted">
              {plugin.t("docker.label")}
            </span>
          </span>
          <span class="settings-servers-meta">
            {props.worker().state === "ready"
              ? props.worker().http?.url
              : plugin.t(props.worker().state === "starting" ? "docker.starting" : "docker.stopped")}
          </span>
        </div>
      </div>
      <div class="settings-servers-actions">
        <Show when={props.worker().state === "stopped" || props.worker().state === "failed"}>
          <Button size="small" variant="ghost-muted" onClick={props.onStart}>
            {plugin.t("docker.start")}
          </Button>
        </Show>
        <Menu gutter={4} modal={false} placement="bottom-end">
          <Menu.Trigger
            as={IconButton}
            variant="ghost-muted"
            size="small"
            icon={<Icon name="outline-dots" />}
            aria-label={plugin.t("docker.menu")}
          />
          <Menu.Portal>
            <Menu.Content>
              <Menu.Group>
                <Menu.GroupLabel>{plugin.t("docker.menu")}</Menu.GroupLabel>
                <props.row.Items />
                <Menu.Separator />
                <Menu.Item onSelect={() => void props.row.remove()}>{plugin.t("docker.remove")}</Menu.Item>
              </Menu.Group>
            </Menu.Content>
          </Menu.Portal>
        </Menu>
      </div>
    </div>
  )
}
