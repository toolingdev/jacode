import { usePlugin } from "@opencode/plugin/gui"
import { createSignal, For, Show } from "solid-js"
import type { WorkerUpdate } from "./contract"
import type definition from "./index"
import type { Tracking } from "./renderer"

/**
 * Fork feature: worker updates on the Workers page. Every worker follows the app's version; this section says where
 * each one stands, updates one now, switches automatic updates off, and asks for the SSH address of a worker that was
 * connected by a pairing link, which the app needs to update it.
 */
export default function Updates(props: { tracking: Tracking }) {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui
  const [drafts, setDrafts] = createSignal<Record<string, string>>({})

  const describe = (update: WorkerUpdate) => {
    const version = update.version ?? ctx.t("updates.version.unknown")

    if (update.state === "failed")
      return ctx.t("updates.state.failed", { reason: update.message ?? ctx.t("updates.version.unknown") })

    return ctx.t(`updates.state.${update.state}`, { version, app: props.tracking.state()?.version ?? "" })
  }

  return (
    <Show when={props.tracking.state()}>
      {(state) => (
        <ui.SettingsSection title={ctx.t("updates.title")}>
          <ui.SettingsRow
            id="settings-worker-updates-auto"
            title={ctx.t("updates.auto")}
            description={ctx.t("updates.auto.about", { version: state().version })}
          >
            <ui.Switch
              label={ctx.t("updates.auto")}
              hideLabel
              checked={state().auto}
              onChange={(auto) => void props.tracking.setAuto(auto)}
            />
          </ui.SettingsRow>
          <For each={state().updates}>
            {(update) => (
              <ui.SettingsRow
                id={`settings-worker-update-${update.id}`}
                title={update.name}
                description={describe(update)}
              >
                <ui.Button
                  variant="neutral"
                  size="small"
                  disabled={["checking", "downloading", "updating", "current", "updated", "unmanaged"].includes(
                    update.state,
                  )}
                  onClick={() => void props.tracking.updateNow(update.id)}
                >
                  {ctx.t("updates.now")}
                </ui.Button>
              </ui.SettingsRow>
            )}
          </For>
          <For each={props.tracking.linked()}>
            {(worker) => (
              <ui.SettingsRow
                id={`settings-worker-update-address-${worker.id}`}
                title={worker.name}
                description={ctx.t("updates.address.about")}
              >
                <div class="flex w-72 max-w-full items-center gap-2">
                  <div class="min-w-0 flex-1">
                    <ui.TextInput
                      label={ctx.t("updates.address.label")}
                      value={drafts()[worker.id] ?? worker.target ?? ""}
                      placeholder={ctx.t("address.placeholder")}
                      onInput={(value) => setDrafts((all) => ({ ...all, [worker.id]: value }))}
                    />
                  </div>
                  <ui.Button
                    variant="neutral"
                    size="small"
                    class="shrink-0 whitespace-nowrap"
                    disabled={!drafts()[worker.id]?.trim() || drafts()[worker.id]?.trim() === worker.target}
                    onClick={() => props.tracking.setAddress(worker.id, drafts()[worker.id]?.trim() ?? "")}
                  >
                    {ctx.t("updates.address.save")}
                  </ui.Button>
                </div>
              </ui.SettingsRow>
            )}
          </For>
        </ui.SettingsSection>
      )}
    </Show>
  )
}
