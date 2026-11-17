import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Tooltip } from "@opencode/ui/tooltip"
import { Show } from "solid-js"
import { useChatFolder } from "@/new-session/chat-folder"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection } from "@/runtime/server/registry"
import type { HomeProjectSelection } from "@/shell/state/layout"

/**
 * Fork feature: the chats that belong to no project, in a place of their own above the projects. Selecting it lists
 * them like any project's sessions; the button beside it starts a new one.
 */
export function HomeChats(props: {
  servers: ServerConnection.Any[]
  selection: HomeProjectSelection
  onSelect: (server: ServerConnection.Any, directory: string) => void
}) {
  const language = useLanguage()
  const chat = useChatFolder()
  const local = () => props.servers.find(ServerConnection.builtin)

  const selected = () => {
    const server = local()

    return (
      !!server &&
      props.selection.server === ServerConnection.key(server) &&
      !!props.selection.directory &&
      chat.is(props.selection.directory)
    )
  }

  return (
    <Show when={chat.available() && local()}>
      {(server) => (
        <div data-component="home-chats" class="group/chats relative mb-4 mr-3">
          <button
            type="button"
            data-action="home-chats"
            data-selected={selected() ? "" : undefined}
            class="flex h-7 w-full min-w-0 shrink-0 cursor-default items-center gap-2 rounded-[6px] bg-transparent px-1.5 text-left text-v2-text-text-muted [font-weight:440] transition-[background-color,color] duration-[120ms] ease-in-out hover:bg-v2-background-bg-layer-01 hover:text-v2-text-text-base focus-visible:bg-v2-background-bg-layer-01 focus-visible:text-v2-text-text-base focus-visible:outline-none data-[selected]:bg-v2-background-bg-layer-03 data-[selected]:text-v2-text-text-base"
            onClick={() => {
              const folder = chat.directory()

              if (folder) props.onSelect(server(), folder)
            }}
          >
            <Icon name="speech-bubble" size="small" class="shrink-0" />
            <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
              {language.t("home.chats")}
            </span>
          </button>
          <div class="absolute bottom-0 right-1 top-0 flex items-center">
            <Tooltip class="flex shrink-0 items-center" placement="bottom" value={language.t("home.chats.new")}>
              <IconButton
                data-action="home-chats-new"
                variant="ghost-muted"
                size="small"
                icon={<Icon name="plus" />}
                aria-label={language.t("home.chats.new")}
                onClick={() => void chat.open()}
              />
            </Tooltip>
          </div>
        </div>
      )}
    </Show>
  )
}
