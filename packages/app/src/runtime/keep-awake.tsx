import { Switch } from "@opencode/ui/switch"
import { Schema } from "effect"
import { createEffect, createRoot, onCleanup, Show, type Component } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { usePlatform } from "@/runtime/platform/platform"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { SettingsRow } from "@/settings/row"

// Fork feature: keep this computer awake while a session is working, so a long task is not cut off when the
// computer would otherwise go to sleep. Only sessions on this computer count; a remote server works on regardless.

export const KeepAwakeSchema = Schema.Struct({ enabled: Schema.Boolean })

// One store for the window, so the setting takes effect the moment it is flipped.
let shared: ReturnType<typeof open> | undefined

function open(platform: ReturnType<typeof usePlatform>) {
  return createRoot(() => persisted(Persist.global("keep-awake"), KeepAwakeSchema, { enabled: false }, platform))
}

function useKeepAwakeSetting() {
  const platform = usePlatform()

  shared ??= open(platform)

  return shared
}

/** Asks the desktop to hold the computer awake for as long as the setting is on and a local session is working. */
export function useKeepAwake() {
  const platform = usePlatform()
  const servers = useServers()
  const global = useGlobal()
  const [chosen] = useKeepAwakeSetting()

  const working = () =>
    servers.list
      .filter(ServerConnection.builtin)
      .some((server) => (global.serverCtx(ServerConnection.key(server))?.data.session.active().length ?? 0) > 0)

  createEffect<boolean>((held) => {
    const hold = chosen.enabled && working()

    if (hold !== held) void platform.setKeepAwake?.(hold)

    return hold
  }, false)

  onCleanup(() => void platform.setKeepAwake?.(false))
}

/** The switch for it, shown where the desktop can do it. */
export const KeepAwakeSetting: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const [chosen, setChosen] = useKeepAwakeSetting()

  return (
    <Show when={platform.setKeepAwake}>
      <SettingsRow
        title={language.t("settings.general.row.keepAwake.title")}
        description={language.t("settings.general.row.keepAwake.description")}
      >
        <div data-action="settings-keep-awake">
          <Switch checked={chosen.enabled} onChange={(enabled) => setChosen({ enabled })} />
        </div>
      </SettingsRow>
    </Show>
  )
}
