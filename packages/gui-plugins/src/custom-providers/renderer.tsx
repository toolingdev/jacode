import { lazy, onCleanup, Suspense } from "solid-js"
import { Command, SettingsPage, type Plugin } from "@opencode/plugin/gui"
import { onIdle } from "@opencode/plugin/gui/builtin"
import type definition from "./index"

/**
 * The Custom providers settings page: the providers the config defines, and adding, editing and removing
 * OpenAI-compatible ones without editing the config file. API keys go to the credential store, never to the file.
 */
const setup: Plugin.Setup<typeof definition> = (ctx) => {
  const Page = lazy(() => import("./page"))
  // Load the page while idle so settings opens without a blank page.
  onCleanup(onIdle(() => void Page.preload()))

  ctx.add(SettingsPage, {
    id: "custom-providers",
    icon: "providers",
    get title() {
      return ctx.t("title")
    },
    get entries() {
      return [
        {
          id: "custom-providers",
          title: ctx.t("title"),
          keywords: "provider api key openai compatible base url model add custom",
        },
      ]
    },
    render: () => (
      <Suspense>
        <Page />
      </Suspense>
    ),
  })

  ctx.add(Command, () => ({
    id: "open",
    title: ctx.t("command.title"),
    group: ctx.t("command.group"),
    run: () => ctx.layout.settings("custom-providers"),
  }))
}

export default setup
