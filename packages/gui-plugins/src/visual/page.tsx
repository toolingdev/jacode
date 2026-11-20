import { usePlugin } from "@opencode/plugin/gui"
import { createSignal, For, onCleanup, type JSX } from "solid-js"
import { createThemeColors, VisualFrame } from "./frame"
import type definition from "./index"
import {
  CARD_STYLES,
  CHART_STYLES,
  RANDOM,
  SAMPLE_CARD_FRAGMENT,
  SAMPLE_CHART_FRAGMENT,
  SAMPLE_WEATHER_FRAGMENT,
  WEATHER_CARD_STYLES,
  type CardStyle,
  type ChartStyle,
  type WeatherCardStyle,
} from "./styles"

/** The Cards settings page: one live sample per look, for weather cards, charts and the other cards; a click picks it. */
export default function VisualsPage() {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui
  const looks = ctx.stores.looks
  const colors = createThemeColors()

  // The Random tiles show what they mean by stepping through the looks.
  const [step, setStep] = createSignal(0)
  const timer = setInterval(() => setStep((current) => current + 1), 2200)
  onCleanup(() => clearInterval(timer))

  // `picked` is read when it is shown, not when the tile is made, so the highlight follows a click.
  const tile = (input: { label: string; picked: () => boolean; pick: () => void; sample: JSX.Element }) => (
    <button
      type="button"
      role="radio"
      aria-checked={input.picked()}
      data-action="settings-visual-style"
      class="flex min-w-0 cursor-pointer flex-col gap-2 rounded-md border border-v2-border-border-muted p-2 text-12-regular text-v2-text-text-muted hover:border-v2-border-border-strong aria-checked:border-v2-border-border-strong aria-checked:bg-v2-background-bg-layer-01 aria-checked:text-v2-text-text-base"
      onClick={input.pick}
    >
      {/* The sample is a picture here: a click on it picks the tile. */}
      <div class="pointer-events-none w-full overflow-hidden rounded-sm">{input.sample}</div>
      {input.label}
    </button>
  )

  const weatherSample = (id: string, style: () => WeatherCardStyle) => (
    <VisualFrame
      id={`sample-weather-${id}`}
      title={ctx.t(`weather.${id === RANDOM ? RANDOM : style()}`)}
      fragment={SAMPLE_WEATHER_FRAGMENT}
      weather={style()}
      chart="clean"
      colors={colors()}
      fixed={256}
    />
  )

  const chartSample = (id: string, style: () => ChartStyle) => (
    <VisualFrame
      id={`sample-chart-${id}`}
      title={ctx.t(`chart.${id === RANDOM ? RANDOM : style()}`)}
      fragment={SAMPLE_CHART_FRAGMENT}
      weather="clean"
      chart={style()}
      colors={colors()}
      fixed={160}
    />
  )

  const cardSample = (id: string, style: () => CardStyle) => (
    <VisualFrame
      id={`sample-card-${id}`}
      title={ctx.t(`card.${id === RANDOM ? RANDOM : style()}`)}
      fragment={SAMPLE_CARD_FRAGMENT}
      weather="clean"
      chart="clean"
      card={style()}
      colors={colors()}
      fixed={190}
    />
  )

  return (
    <ui.SettingsLayout title={ctx.t("page.title")} description={ctx.t("page.description")}>
      <div class="flex flex-col gap-2">
        <h3 class="text-13-medium text-v2-text-text-base">{ctx.t("weather.title")}</h3>
        <div
          role="radiogroup"
          aria-label={ctx.t("weather.title")}
          class="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-2"
        >
          {tile({
            label: ctx.t("weather.random"),
            picked: () => looks.value.weather === RANDOM,
            pick: () =>
              looks.update((draft) => {
                draft.weather = RANDOM
              }),
            sample: weatherSample(RANDOM, () => WEATHER_CARD_STYLES[step() % WEATHER_CARD_STYLES.length] ?? "clean"),
          })}
          <For each={WEATHER_CARD_STYLES}>
            {(style) =>
              tile({
                label: ctx.t(`weather.${style}`),
                picked: () => looks.value.weather === style,
                pick: () =>
                  looks.update((draft) => {
                    draft.weather = style
                  }),
                sample: weatherSample(style, () => style),
              })
            }
          </For>
        </div>
      </div>
      <div class="flex flex-col gap-2 pt-4">
        <h3 class="text-13-medium text-v2-text-text-base">{ctx.t("chart.title")}</h3>
        <div
          role="radiogroup"
          aria-label={ctx.t("chart.title")}
          class="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2"
        >
          {tile({
            label: ctx.t("chart.random"),
            picked: () => looks.value.chart === RANDOM,
            pick: () =>
              looks.update((draft) => {
                draft.chart = RANDOM
              }),
            sample: chartSample(RANDOM, () => CHART_STYLES[step() % CHART_STYLES.length] ?? "clean"),
          })}
          <For each={CHART_STYLES}>
            {(style) =>
              tile({
                label: ctx.t(`chart.${style}`),
                picked: () => looks.value.chart === style,
                pick: () =>
                  looks.update((draft) => {
                    draft.chart = style
                  }),
                sample: chartSample(style, () => style),
              })
            }
          </For>
        </div>
      </div>
      <div class="flex flex-col gap-2 pt-4">
        <h3 class="text-13-medium text-v2-text-text-base">{ctx.t("card.title")}</h3>
        <div
          role="radiogroup"
          aria-label={ctx.t("card.title")}
          class="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2"
        >
          {tile({
            label: ctx.t("card.random"),
            picked: () => looks.value.card === RANDOM,
            pick: () =>
              looks.update((draft) => {
                draft.card = RANDOM
              }),
            sample: cardSample(RANDOM, () => CARD_STYLES[step() % CARD_STYLES.length] ?? "clean"),
          })}
          <For each={CARD_STYLES}>
            {(style) =>
              tile({
                label: ctx.t(`card.${style}`),
                picked: () => (looks.value.card ?? "clean") === style,
                pick: () =>
                  looks.update((draft) => {
                    draft.card = style
                  }),
                sample: cardSample(style, () => style),
              })
            }
          </For>
        </div>
      </div>
    </ui.SettingsLayout>
  )
}
