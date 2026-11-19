import type { ConfigExperimentalAddons } from "@opencode/client/promise"
import { Switch } from "@opencode/ui/switch"
import { type Component, createSignal, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useGlobalConfig } from "@/settings/global-config"
import { SettingsList } from "@/settings/list"
import { SettingsRow } from "@/settings/row"

// Fork feature: add-ons that come with the app. Each is off until switched on here, so the app ships neutral and a
// user adds what fits them.
export const BundledAddons: Component = () => {
  const language = useLanguage()
  const server = useServerSDK()
  const config = useGlobalConfig()
  // What was last saved here, shown at once; the config read catches up when the server reloads.
  const [saved, setSaved] = createSignal<{ settings: ConfigExperimentalAddons | undefined }>()

  const settings = () => {
    const local = saved()

    if (local) return local.settings

    return config.documents()?.findLast((document) => document.experimental?.addons !== undefined)?.experimental
      ?.addons
  }

  const change = (next: ConfigExperimentalAddons) => {
    setSaved({ settings: next })
    void config.save(() => server.api.experimental.config.addons.set(next))
  }

  const bible = () => settings()?.bible

  return (
    <div class="flex flex-col gap-2 pb-4">
      <span class="settings-extension-heading text-13-medium">{language.t("settings.addons.bundled.title")}</span>
      <SettingsList>
        <SettingsRow
          title={language.t("settings.addons.bible.title")}
          description={language.t("settings.addons.bible.description")}
        >
          <div data-action="settings-addons-bible">
            <Switch
              checked={bible()?.enabled === true}
              onChange={(checked) => change({ ...settings(), bible: { ...bible(), enabled: checked } })}
            />
          </div>
        </SettingsRow>
        <Show when={bible()?.enabled}>
          <SettingsRow
            title={language.t("settings.addons.bible.spanish.title")}
            description={language.t("settings.addons.bible.spanish.description")}
          >
            <div data-action="settings-addons-bible-spanish">
              <Switch
                checked={bible()?.spanish === true}
                onChange={(checked) => change({ ...settings(), bible: { enabled: true, spanish: checked } })}
              />
            </div>
          </SettingsRow>
        </Show>
      </SettingsList>
    </div>
  )
}
