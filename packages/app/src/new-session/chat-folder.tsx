import { Icon } from "@opencode/ui/icon"
import { createEffect, createSignal, Match, Switch } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { useTabs } from "@/shell/tabs/tabs"
import { useWorkspaceLocation } from "@/workspaces/location"
import { pathKey } from "@/workspaces/path-key"
import type { PromptProjectController } from "./project/selector"

// Fork feature: a chat that is not tied to a project. Every session still runs in a directory, so such a chat runs
// in one folder the app keeps for the purpose on this computer, and the screen calls that "No folder".

// The folder is the same for every window part, and asking for it also makes it; one request serves them all.
const [directory, setDirectory] = createSignal<string>()

let asked = false

let listed = false

export function useChatFolder() {
  const platform = usePlatform()
  const servers = useServers()
  const tabs = useTabs()
  const global = useGlobal()

  if (!asked) {
    asked = true
    // Without the folder the app simply offers no folder-free chat, as on the web.
    void platform.chatDirectory?.().then(setDirectory, () => undefined)
  }

  // The folder is on this computer, so only the app's own server can run a chat in it.
  const server = () => servers.list.find(ServerConnection.builtin)

  // The folder is listed with the projects, so its chats are found again where every other session is. A project is
  // only listed once its server has resolved it, which adding does. Adding also makes it the last used project, so
  // it is done once, the first time the server shows its projects, and not on every launch.
  createEffect(() => {
    const local = server()
    const folder = directory()
    const projects = local && global.serverCtx(ServerConnection.key(local))?.projects

    if (listed || !folder || !projects || projects.list().length === 0) return
    listed = true

    if (projects.used().some((project) => pathKey(project.worktree) === pathKey(folder))) return
    void projects.add(folder)
  })

  return {
    directory,
    available: () => !!directory() && !!server(),
    is: (other: string) => !!directory() && pathKey(other) === pathKey(directory() ?? ""),
    /** Opens a new chat with no project. False when this app has no folder for one. */
    open(draftID?: string) {
      const local = server()
      const folder = directory()

      if (!local || !folder) return false

      // A server that has never seen the folder lists it from here on.
      if (!listed) void global.serverCtx(ServerConnection.key(local))?.projects.add(folder)

      listed = true
      void tabs.newDraft({ server: ServerConnection.key(local), directory: folder, draftID }, "")

      return true
    },
  }
}

/**
 * Under the new session composer: says the chat has no folder, or offers to drop the project it would start in.
 * `onPick` opens the project picker, which is how a folder-free chat is given a project after all.
 */
export function NewSessionChatFolder(props: { project: PromptProjectController; onPick: () => void }) {
  const language = useLanguage()
  const chat = useChatFolder()
  const location = useWorkspaceLocation()
  const active = () => chat.is(location().directory)

  const leave = () => {
    const folder = chat.directory()

    if (!folder) return
    // With several servers listed the draft must also move to this computer's, where the folder is.
    props.project.select({ worktree: folder, server: props.project.servers().find((item) => item.kind === "current") })
  }

  return (
    <Switch>
      <Match when={active()}>
        <button
          data-action="new-session-chat-folder"
          type="button"
          title={language.t("session.new.chat.pick")}
          class="flex h-7 w-fit min-w-0 items-center gap-1.5 rounded-sm px-2 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-base transition-colors hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none"
          onClick={props.onPick}
        >
          <Icon name="speech-bubble" size="small" class="shrink-0 text-v2-icon-icon-muted" />
          <span class="min-w-0 truncate leading-5">{language.t("session.new.chat.active")}</span>
          <span class="text-v2-text-text-faint">{language.t("session.new.chat.where")}</span>
          <Icon name="chevron-down" size="small" class="shrink-0 text-v2-icon-icon-muted" />
        </button>
      </Match>
      <Match when={chat.available()}>
        <button
          data-action="new-session-chat-folder"
          type="button"
          class="flex h-7 w-fit min-w-0 items-center gap-1.5 rounded-sm px-2 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-faint transition-colors hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none"
          onClick={leave}
        >
          <Icon name="speech-bubble" size="small" class="shrink-0 text-v2-icon-icon-muted" />
          <span class="min-w-0 truncate leading-5">{language.t("session.new.chat.offer")}</span>
        </button>
      </Match>
    </Switch>
  )
}
