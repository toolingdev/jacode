import { createSignal } from "solid-js"
import { ComposerPill, type ComposerPillProps, type Plugin } from "@opencode/plugin/gui"
import { showToast } from "@opencode/ui/toast"
import { isOn, withComputer } from "./rules"
import type definition from "./index"

/**
 * Fork feature: the "Mac control" pill above the composer switches the computer tool on or off for one chat. It shows
 * only for chats on the app's own server on a Mac, where the tool runs.
 */
const setup: Plugin.Setup<typeof definition> = (ctx) => {
  const mac = navigator.userAgent.includes("Macintosh")
  const rules = (input: ComposerPillProps) => input.session.server.data.session.get(input.session.id)?.permissions
  const [saving, setSaving] = createSignal(false)

  ctx.add(ComposerPill, {
    id: "computer",
    order: 31,
    show: (input) => {
      if (!mac || !input.session.server.builtin) return
      const on = isOn(rules(input))

      return {
        icon: "monitor",
        title: ctx.t("title"),
        label: on ? ctx.t("label.on") : ctx.t("label.off"),
        tone: on ? ("warning" as const) : undefined,
      }
    },
    menu: (input) => {
      const toggle = (on: boolean) => {
        setSaving(true)
        void input.session.server.client.session
          .update({ sessionID: input.session.id, permissions: withComputer(rules(input), on) })
          .catch((cause: Error) => showToast({ variant: "error", title: ctx.t("failed"), description: cause.message }))
          .finally(() => setSaving(false))
      }

      return (
        <div class="flex max-w-80 flex-col gap-2 p-2">
          <p class="text-12-regular text-v2-text-text-muted">{ctx.t("description")}</p>
          <div class="flex items-center justify-between gap-3">
            <span class="text-13-medium">{ctx.t("switch")}</span>
            <ctx.ui.Switch
              label={ctx.t("switch")}
              hideLabel
              checked={isOn(rules(input))}
              disabled={saving()}
              onChange={toggle}
            />
          </div>
          <p class="text-12-regular text-v2-text-text-muted">{ctx.t("setup")}</p>
        </div>
      )
    },
  })
}

export default setup
