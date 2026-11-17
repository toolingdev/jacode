import { CodeBlock, Command, SettingsPage, type Plugin } from "@opencode/plugin/gui"
import { onIdle } from "@opencode/plugin/gui/builtin"
import { lazy, onCleanup, Suspense } from "solid-js"
import { VisualFrame } from "./frame"
import type definition from "./index"

/**
 * Fork feature: a reply can carry a live visual. A fenced code block with the language `visual` holds an HTML
 * fragment, such as a chart or a weather card, and shows as that page inside the message instead of as code. Weather
 * cards and charts take the looks the user picked on the Visuals settings page.
 */
const setup: Plugin.Setup<typeof definition> = (ctx) => {
  // Numbers the visuals, so each frame's messages are told apart.
  let next = 0

  ctx.add(CodeBlock, {
    languages: ["visual"],
    render: (props) => (
      <VisualFrame
        id={`visual-${(next += 1)}`}
        title={ctx.t("title")}
        fragment={props.code}
        weather={ctx.stores.looks.value.weather}
        chart={ctx.stores.looks.value.chart}
      />
    ),
  })

  const Page = lazy(() => import("./page"))
  // Load the page while idle so settings opens without a blank page.
  onCleanup(onIdle(() => void Page.preload()))

  ctx.add(SettingsPage, {
    id: "visuals",
    icon: "photo",
    get title() {
      return ctx.t("page.title")
    },
    get entries() {
      return [
        {
          id: "visuals",
          title: ctx.t("page.title"),
          keywords: "visual chart graph weather card style look theme pixel neon 3d",
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
    run: () => ctx.layout.settings("visuals"),
  }))
}

export default setup
