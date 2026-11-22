import { lazy, onCleanup, Suspense } from "solid-js"
import { SettingsPage, type Plugin } from "@opencode/plugin/gui"
import { onIdle } from "@opencode/plugin/gui/builtin"
import type definition from "./index"

/**
 * Fork feature: Settings › Mac control, where the user switches the assistant's use of this Mac's screen off or on and
 * sees the kinds of action allowed always. Asking happens in the chat itself, through the usual approval prompt.
 */
const setup: Plugin.Setup<typeof definition> = (ctx) => {
  const Section = lazy(() => import("./section"))
  // Load the section while idle so settings opens without a blank page.
  onCleanup(onIdle(() => void Section.preload()))

  ctx.add(SettingsPage, {
    id: "mac-control",
    icon: "monitor",
    get title() {
      return ctx.t("title")
    },
    get entries() {
      return [
        { id: "mac-control", title: ctx.t("title"), keywords: "mac computer screen screenshot mouse keyboard control" },
      ]
    },
    render: () => (
      <Suspense>
        <Section />
      </Suspense>
    ),
  })
}

export default setup
