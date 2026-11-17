import type { ConfigExperimentalWeatherSource } from "@opencode/client/promise"

// Fork feature: the weather tool's sources as the settings page edits them.

export type WeatherSource = ConfigExperimentalWeatherSource

export const WEATHER_SOURCE_TYPES = ["met-norway", "open-meteo", "wttr"] as const satisfies readonly WeatherSource["type"][]

/** What the tool uses while the config lists nothing; the page shows these until the user changes something. */
export const DEFAULT_WEATHER_SOURCES: readonly WeatherSource[] = [{ type: "met-norway" }, { type: "open-meteo" }]

/** The source's form as typed. */
export type WeatherForm = { readonly type: WeatherSource["type"]; readonly name: string; readonly url: string }

export const emptyWeatherForm: WeatherForm = { type: "met-norway", name: "", url: "" }

export function weatherFormOf(source: WeatherSource): WeatherForm {
  return { type: source.type, name: source.name ?? "", url: source.url ?? "" }
}

/** The source a filled form describes, or undefined when its address is not an http or https URL. */
export function readWeatherForm(form: WeatherForm, original?: WeatherSource): WeatherSource | undefined {
  const name = form.name.trim()
  const url = form.url.trim()

  if (url !== "" && !(URL.canParse(url) && /^https?:$/.test(new URL(url).protocol))) return undefined

  // What was left empty is left out, which sending drops; an edit keeps a switched-off source switched off.
  return {
    type: form.type,
    name: name || undefined,
    url: url || undefined,
    disabled: original?.disabled || undefined,
  }
}

/** The list with the source at `index` moved one place up or down; unchanged at either end. */
export function moveSource(sources: readonly WeatherSource[], index: number, by: -1 | 1) {
  const target = index + by
  const moved = sources[index]
  const other = sources[target]

  if (!moved || !other) return [...sources]

  return sources.map((source, at) => (at === index ? other : at === target ? moved : source))
}
