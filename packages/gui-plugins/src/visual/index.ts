import { builtinCatalog } from "@opencode/plugin/gui/builtin"
import { Plugin, Store } from "@opencode/plugin/gui"
import { Schema } from "effect"
import en from "./i18n/en"
import { CARD_STYLES, CHART_STYLES, RANDOM, WEATHER_CARD_STYLES } from "./styles"

/** The looks the user picked for weather cards, for charts and for the other cards. */
export const VisualLooks = Schema.Struct({
  weather: Schema.Literals([...WEATHER_CARD_STYLES, RANDOM]),
  chart: Schema.Literals([...CHART_STYLES, RANDOM]),
  // Optional, so picks saved before the other cards had looks still read.
  card: Schema.optional(Schema.Literals([...CARD_STYLES, RANDOM])),
})

export default Plugin.define({
  stores: {
    // Weather cards start on a different look each time; charts start plain, where the numbers read easiest.
    looks: Store.global(VisualLooks, { weather: RANDOM, chart: "clean" }),
  },
  i18n: builtinCatalog({ en, es: () => import("./i18n/es") }),
})
