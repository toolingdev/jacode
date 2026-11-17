import { Select } from "@opencode/ui/select"
import { type Component } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { SettingsList } from "@/settings/list"
import { SettingsRow } from "@/settings/row"
import { useWordmarkStyle, wordmarkStyles } from "./wordmark-style"

/** Fork feature: choose how the wordmark on the new session screen moves and takes its colour. */
export const SettingsWordmark: Component = () => {
  const language = useLanguage()
  const wordmark = useWordmarkStyle()

  return (
    <div class="settings-section">
      <SettingsList>
        <SettingsRow
          title={language.t("settings.wordmark.title")}
          description={language.t("settings.wordmark.description")}
        >
          <Select
            data-action="settings-wordmark-style"
            options={[...wordmarkStyles]}
            current={wordmark.chosen.style}
            value={(style) => style}
            label={(style) => language.t(`settings.wordmark.style.${style}`)}
            placement="bottom-end"
            gutter={6}
            onSelect={(style) => style && wordmark.setStyle(style)}
          />
        </SettingsRow>
      </SettingsList>
    </div>
  )
}
