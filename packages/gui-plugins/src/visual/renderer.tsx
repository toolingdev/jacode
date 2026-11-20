import { CodeBlock, Command, SettingsPage, type Plugin } from "@opencode/plugin/gui"
import { onIdle } from "@opencode/plugin/gui/builtin"
import { lazy, onCleanup, Suspense } from "solid-js"
import { CARD_LABEL_KEYS } from "./cards"
import { createThemeColors, VisualFrame } from "./frame"
import type definition from "./index"
import { CARD_STYLES, CHART_STYLES, resolveLook, WEATHER_CARD_STYLES } from "./styles"

/**
 * Fork feature: a reply can carry a live visual. A fenced code block with the language `visual` holds an HTML
 * fragment, such as a chart or a weather card, and shows as that page inside the message instead of as code. Weather
 * cards and charts take the looks the user picked on the Visuals settings page.
 */
const setup: Plugin.Setup<typeof definition> = (ctx) => {
  // Numbers the visuals, so each frame's messages are told apart.
  let next = 0
  const colors = createThemeColors()

  ctx.add(CodeBlock, {
    languages: ["visual"],
    render: (props) => {
      // Rolled once for this visual, so a random look stays put while the message is on screen.
      const roll = Math.random()

      return (
        <VisualFrame
          id={`visual-${(next += 1)}`}
          title={ctx.t("title")}
          fragment={props.code}
          weather={resolveLook(ctx.stores.looks.value.weather, WEATHER_CARD_STYLES, roll)}
          chart={resolveLook(ctx.stores.looks.value.chart, CHART_STYLES, roll)}
          card={resolveLook(ctx.stores.looks.value.card ?? "clean", CARD_STYLES, roll)}
          colors={colors()}
          labels={Object.fromEntries(CARD_LABEL_KEYS.map((key) => [key, ctx.t(`card.${key}`)]))}
        />
      )
    },
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
