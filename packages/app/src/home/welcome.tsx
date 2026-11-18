import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Schema } from "effect"
import { createMemo, createSignal, For, Show } from "solid-js"
import { useChatFolder } from "@/new-session/chat-folder"
import { useProviders } from "@/providers/catalog/providers"
import { useLanguage } from "@/runtime/i18n/language"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { SettingsServerDataScope } from "@/settings/server-scope"
import { useTabs } from "@/shell/tabs/tabs"

const WelcomeSchema = Persistence.struct({ done: Schema.Boolean })

/**
 * Fork feature: the first thing a new person sees on Home. Until this computer has a provider, a card walks them
 * through picking one, pasting its key and saying hello. It goes away after the hello, or when closed.
 */
export function HomeWelcome() {
  const servers = useServers()

  return (
    <Show when={servers.list.find(ServerConnection.builtin)} keyed>
      {(server) => (
        <SettingsServerDataScope server={server}>
          <Welcome server={server} />
        </SettingsServerDataScope>
      )}
    </Show>
  )
}

function Welcome(props: { server: ServerConnection.Any }) {
  const language = useLanguage()
  const dialog = useDialog()
  const tabs = useTabs()
  const chat = useChatFolder()
  const providers = useProviders(() => undefined)
  const [state, setState, , ready] = persisted(Persist.global("home.welcome"), WelcomeSchema, { done: false })
  // Set once a provider is added from this card, so the card stays for the last step instead of vanishing.
  const [added, setAdded] = createSignal(false)

  const connected = () => added() || providers.anyConnection() === true
  const visible = createMemo(() => ready() && !state.done && (added() || providers.anyConnection() === false))

  const connect = () =>
    void import("@/providers/connect/dialog").then(({ DialogConnectProvider }) =>
      dialog.show(() => <DialogConnectProvider defaultLocation onConnected={() => setAdded(true)} />),
    )

  const hello = () => {
    const folder = chat.directory()

    setState("done", true)

    if (!folder) return
    void tabs.newDraft(
      { server: ServerConnection.key(props.server), directory: folder },
      language.t("home.welcome.hello.prompt"),
    )
  }

  const steps = () => [
    { id: "pick", done: connected() },
    { id: "key", done: connected() },
    { id: "hello", done: false },
  ]

  return (
    <Show when={visible()}>
      <section
        data-component="home-welcome"
        aria-label={language.t("home.welcome.title")}
        class="relative mb-4 flex flex-col gap-3 rounded-[10px] border border-v2-border-border-base bg-v2-background-bg-layer-01 p-4"
      >
        <IconButton
          icon="close"
          variant="ghost"
          size="small"
          class="absolute right-2 top-2"
          aria-label={language.t("home.welcome.close")}
          onClick={() => setState("done", true)}
        />
        <div class="flex flex-col gap-1 pr-8">
          <h2 class="text-15-medium text-v2-text-text-base">{language.t("home.welcome.title")}</h2>
          <p class="text-13-regular text-v2-text-text-muted">{language.t("home.welcome.description")}</p>
        </div>
        <ol class="flex flex-col gap-2">
          <For each={steps()}>
            {(step, index) => (
              <li class="flex items-start gap-2 text-13-regular">
                <span
                  class="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-v2-border-border-base text-11-medium text-v2-text-text-muted"
                  classList={{ "border-transparent bg-v2-state-bg-success text-v2-state-fg-success": step.done }}
                >
                  <Show when={step.done} fallback={index() + 1}>
                    <Icon name="check" size="small" />
                  </Show>
                </span>
                <div class="flex min-w-0 flex-col">
                  <span class="text-v2-text-text-base">{language.t(`home.welcome.${step.id}.title`)}</span>
                  <span class="text-v2-text-text-muted">{language.t(`home.welcome.${step.id}.about`)}</span>
                </div>
              </li>
            )}
          </For>
        </ol>
        <div class="flex gap-2">
          <Show
            when={connected()}
            fallback={
              <Button variant="contrast" size="normal" icon="plus" onClick={connect}>
                {language.t("home.welcome.connect")}
              </Button>
            }
          >
            <Button variant="contrast" size="normal" onClick={hello}>
              {language.t("home.welcome.hello")}
            </Button>
          </Show>
        </div>
      </section>
    </Show>
  )
}
