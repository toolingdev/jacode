import { lazy, onCleanup, Show, Suspense } from "solid-js"
import { Command, Slot, type MountedSession, type Plugin } from "@opencode/plugin/gui"
import { onIdle } from "@opencode/plugin/gui/builtin"
import type definition from "./index"

/**
 * Image generation from the session header: a dialog that takes a prompt, an image model, an aspect ratio and a
 * count, shows the results and saves them into the session's directory. It calls the server's stateless image
 * endpoint, so it works with any provider that has image models.
 */
const setup: Plugin.Setup<typeof definition> = (ctx) => {
  const Dialog = lazy(() => import("./dialog"))
  // Load the dialog while idle so it opens at once.
  onCleanup(onIdle(() => void Dialog.preload()))

  const open = (session: MountedSession) =>
    ctx.dialogs.open((dialog) => (
      <Suspense>
        <Dialog session={session} onClose={dialog.close} />
      </Suspense>
    ))

  ctx.add(Slot, {
    at: "session.header",
    order: 30,
    render: (input) => (
      <Show when={input.session.id}>
        <ctx.ui.Tooltip value={ctx.t("title")} placement="bottom">
          <ctx.ui.IconButton icon="photo" label={ctx.t("title")} onClick={() => open(input.session)} />
        </ctx.ui.Tooltip>
      </Show>
    ),
  })

  ctx.add(Command, () => ({
    id: "open",
    title: ctx.t("command.title"),
    group: ctx.t("command.group"),
    run: () => {
      const session = ctx.sessions.current()

      if (session) open(session)
    },
  }))
}

export default setup
