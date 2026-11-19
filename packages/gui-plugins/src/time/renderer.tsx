import { lazy, onCleanup, Suspense } from "solid-js"
import { SettingsPage, type Plugin } from "@opencode/plugin/gui"
import { onIdle } from "@opencode/plugin/gui/builtin"
import type definition from "./index"

/**
 * Fork feature: the NTP servers the time tool asks for the exact time, as a section of the Preferences page. It
 * writes the global config of the computer whose settings show, so nobody edits the config file for it.
 */
const setup: Plugin.Setup<typeof definition> = (ctx) => {
  const Section = lazy(() => import("./section"))
  // Load the section while idle so settings opens without a blank row.
  onCleanup(onIdle(() => void Section.preload()))

  ctx.add(SettingsPage, {
    id: "time-servers",
    page: "general",
    get title() {
      return ctx.t("title")
    },
    get entries() {
      return [{ id: "time-servers", title: ctx.t("title"), keywords: "time ntp clock server precise" }]
    },
    render: () => (
      <Suspense>
        <Section />
      </Suspense>
    ),
  })
}

export default setup
