import { Button } from "@opencode/ui/button"
import { TextInput } from "@opencode/ui/text-input"
import { type Component, createSignal, For, Show } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { listedEntries, useGlobalConfig } from "@/settings/global-config"
import { SettingsList } from "@/settings/list"

// Fork feature: add and remove plugins and skill sources from Settings instead of editing the config file.
export const ExtensionSources: Component<{ kind: "plugins" | "skills" }> = (props) => {
  const language = useLanguage()
  const server = useServerSDK()
  const config = useGlobalConfig()
  const [draft, setDraft] = createSignal("")
  const [busy, setBusy] = createSignal(false)

  const listed = () => listedEntries(config.documents() ?? [], props.kind)

  const change = (entry: string, present: boolean) => {
    const api = server.api.experimental.config

    setBusy(true)

    return config
      .save(() => {
        if (props.kind === "plugins")
          return present ? api.plugin.add({ package: entry }) : api.plugin.remove({ package: entry })

        return present ? api.skill.add({ source: entry }) : api.skill.remove({ source: entry })
      })
      .finally(() => setBusy(false))
  }

  const add = () => {
    const entry = draft().trim()

    if (!entry || busy()) return
    void change(entry, true).then(() => setDraft(""))
  }

  return (
    <div class="flex flex-col gap-2 pb-4">
      <form
        class="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          add()
        }}
      >
        <div class="min-w-0 flex-1">
          <TextInput
            data-action={`settings-extension-add-${props.kind}`}
            type="text"
            appearance="base"
            value={draft()}
            onInput={(event) => setDraft(event.currentTarget.value)}
            placeholder={language.t(`settings.extensions.${props.kind}.add.placeholder`)}
            aria-label={language.t(`settings.extensions.${props.kind}.add.label`)}
            spellcheck={false}
            autocomplete="off"
          />
        </div>
        <Button type="submit" size="small" variant="neutral" disabled={!draft().trim() || busy()}>
          {language.t("settings.extensions.add")}
        </Button>
      </form>
      <Show when={listed().length > 0}>
        <span class="text-11-regular text-v2-text-text-muted">{language.t("settings.extensions.added")}</span>
        <SettingsList variant="catalog">
          <For each={listed()}>
            {(entry) => (
              <div class="settings-extension-row">
                <div class="settings-extension-lead">
                  <span class="settings-extension-name truncate">{entry}</span>
                </div>
                <Button
                  type="button"
                  size="small"
                  variant="ghost-muted"
                  disabled={busy()}
                  onClick={() => void change(entry, false)}
                >
                  {language.t("settings.extensions.remove")}
                </Button>
              </div>
            )}
          </For>
        </SettingsList>
      </Show>
    </div>
  )
}
