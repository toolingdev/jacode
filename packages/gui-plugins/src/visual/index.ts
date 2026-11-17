import { Plugin, Store } from "@opencode/plugin/gui"
import { Schema } from "effect"
import en from "./i18n/en"
import { CHART_STYLES, WEATHER_CARD_STYLES } from "./styles"

/** The looks the user picked for weather cards and for charts. */
export const VisualLooks = Schema.Struct({
  weather: Schema.Literals(WEATHER_CARD_STYLES),
  chart: Schema.Literals(CHART_STYLES),
})

export default Plugin.define({
  stores: {
    looks: Store.global(VisualLooks, { weather: "clean", chart: "clean" }),
  },
  i18n: { en },
})
