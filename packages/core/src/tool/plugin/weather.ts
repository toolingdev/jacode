export * as WeatherTool from "./weather.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { Document, Entry } from "@opencode/schema/config"
import type { ConfigExperimental } from "@opencode/schema/config/experimental"
import { Duration, Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { Config } from "../../config.js"

// Fork feature: current weather and a daily forecast for a place. The place is looked up with Open-Meteo's geocoder;
// the forecast comes from the sources listed in config (`experimental.weather.sources`), tried in order until one
// answers. All of them are free and need no key. The place name and its coordinates are the only things sent. The
// result names an icon for each condition, which the app's inline visuals can draw.

export const name = "weather"

export const description = `Get the current weather and a daily forecast for a place by name (a city, optionally with a state or country, such as "Denver, CO" or "Lyon, France"). Data comes from a free forecast service chosen in Settings. Use this instead of searching the web for weather.

Each condition comes with an \`icon\` name. When you show the result as a visual, draw it with <weather-icon name="..."></weather-icon>.`

export const Input = Schema.Struct({
  location: Schema.String.annotate({ description: 'The place, e.g. "Denver, CO", "Paris" or "Tokyo, Japan"' }),
  units: Schema.optionalKey(
    Schema.Literals(["fahrenheit", "celsius"]).annotate({
      description:
        "Temperature unit. Fahrenheit also gives wind in mph; Celsius in km/h. Leave it out to use the user's setting.",
    }),
  ),
  days: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(10))
    .annotate({ description: "How many days of forecast, 1 to 10. Defaults to 5." })
    .pipe(Schema.withDecodingDefaultKey(Effect.succeed(5))),
})

const Icon = Schema.Literals([
  "sun",
  "moon",
  "partly-cloudy-day",
  "partly-cloudy-night",
  "cloud",
  "fog",
  "drizzle",
  "rain",
  "snow",
  "storm",
])
type Icon = typeof Icon.Type

const Day = Schema.Struct({
  date: Schema.String,
  condition: Schema.String,
  icon: Icon,
  high: Schema.Finite,
  low: Schema.Finite,
})

export const Output = Schema.Struct({
  source: Schema.String,
  place: Schema.String,
  timezone: Schema.String,
  temperatureUnit: Schema.String,
  windUnit: Schema.String,
  current: Schema.Struct({
    condition: Schema.String,
    icon: Icon,
    temperature: Schema.Finite,
    humidity: Schema.Finite,
    wind: Schema.Finite,
  }),
  days: Schema.Array(Day),
})
export type Output = typeof Output.Type

const Place = Schema.Struct({
  name: Schema.String,
  latitude: Schema.Finite,
  longitude: Schema.Finite,
  admin1: Schema.optionalKey(Schema.String),
  country: Schema.optionalKey(Schema.String),
  country_code: Schema.optionalKey(Schema.String),
  timezone: Schema.optionalKey(Schema.String),
})
type Place = typeof Place.Type

const Places = Schema.Struct({ results: Schema.optionalKey(Schema.Array(Place)) })

const Symbol = Schema.Struct({ summary: Schema.Struct({ symbol_code: Schema.String }) })

const Hour = Schema.Struct({
  time: Schema.String,
  data: Schema.Struct({
    instant: Schema.Struct({
      details: Schema.Struct({
        air_temperature: Schema.Finite,
        relative_humidity: Schema.optionalKey(Schema.Finite),
        wind_speed: Schema.optionalKey(Schema.Finite),
      }),
    }),
    next_1_hours: Schema.optionalKey(Symbol),
    next_6_hours: Schema.optionalKey(Symbol),
  }),
})
type Hour = typeof Hour.Type

const Forecast = Schema.Struct({ properties: Schema.Struct({ timeseries: Schema.Array(Hour) }) })

// MET Norway's symbol codes by the word they contain, most telling first, each with its wording and its icon by day.
const SYMBOLS: ReadonlyArray<readonly [word: string, condition: string, icon: Icon]> = [
  ["thunder", "Thunderstorm", "storm"],
  ["snow", "Snow", "snow"],
  ["sleet", "Sleet", "snow"],
  ["heavyrain", "Heavy rain", "rain"],
  ["lightrain", "Light rain", "drizzle"],
  ["rain", "Rain", "rain"],
  ["fog", "Fog", "fog"],
  ["partlycloudy", "Partly cloudy", "partly-cloudy-day"],
  ["cloudy", "Overcast", "cloud"],
  ["fair", "Mostly clear", "sun"],
  ["clearsky", "Clear", "sun"],
]

const NIGHT: Partial<Record<Icon, Icon>> = { sun: "moon", "partly-cloudy-day": "partly-cloudy-night" }

/** The wording and icon for a symbol code such as `partlycloudy_night`; a clear night sky takes the moon. */
export function describeSymbol(code: string, day = !code.endsWith("_night")): { condition: string; icon: Icon } {
  const found = SYMBOLS.find((entry) => code.includes(entry[0]))
  const icon = found?.[2] ?? "cloud"

  return { condition: found?.[1] ?? "Unknown", icon: day ? icon : (NIGHT[icon] ?? icon) }
}

const symbolOf = (hour: Hour) =>
  hour.data.next_1_hours?.summary.symbol_code ?? hour.data.next_6_hours?.summary.symbol_code

/**
 * The hourly forecast as what the tool returns: the first hour as the current weather, and each of the place's own
 * calendar days with its highest and lowest temperature and the sky around midday. Temperatures arrive in Celsius and
 * wind in metres a second, and leave in the asked units.
 */
export function summarize(input: {
  source: string
  place: string
  timezone: string
  units: "fahrenheit" | "celsius"
  days: number
  hours: readonly Hour[]
}): Output | undefined {
  const first = input.hours[0]

  if (!first) return undefined
  const metric = input.units === "celsius"
  const degrees = (celsius: number) => Math.round(metric ? celsius : (celsius * 9) / 5 + 32)
  const dateOf = new Intl.DateTimeFormat("en-CA", { timeZone: input.timezone, dateStyle: "short" })
  const hourOf = new Intl.DateTimeFormat("en-GB", { timeZone: input.timezone, hour: "2-digit", hourCycle: "h23" })
  const fromMidday = (hour: Hour) => Math.abs(Number(hourOf.format(new Date(hour.time))) - 12)

  return {
    source: input.source,
    place: input.place,
    timezone: input.timezone,
    temperatureUnit: metric ? "°C" : "°F",
    windUnit: metric ? "km/h" : "mph",
    current: {
      ...describeSymbol(symbolOf(first) ?? ""),
      temperature: degrees(first.data.instant.details.air_temperature),
      humidity: Math.round(first.data.instant.details.relative_humidity ?? 0),
      wind: Math.round((first.data.instant.details.wind_speed ?? 0) * (metric ? 3.6 : 2.23694)),
    },
    days: [...Map.groupBy(input.hours, (hour) => dateOf.format(new Date(hour.time)))]
      .slice(0, input.days)
      .map(([date, hours]) => {
        const temperatures = hours.map((hour) => hour.data.instant.details.air_temperature)

        // The hour nearest midday that says what the sky does stands for the day, drawn as daytime.
        const midday = hours
          .filter((hour) => symbolOf(hour) !== undefined)
          .toSorted((a, b) => fromMidday(a) - fromMidday(b))[0]

        return {
          date,
          ...describeSymbol((midday && symbolOf(midday)) ?? "", true),
          high: degrees(Math.max(...temperatures)),
          low: degrees(Math.min(...temperatures)),
        }
      }),
  }
}

// US states are usually written as two letters, which the geocoder's results spell out.
const STATES: Readonly<Record<string, string>> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia",
}

/** A written location as the name to search for and the region words that follow its first comma. */
export function splitLocation(location: string) {
  const [city = "", ...rest] = location.split(",").map((part) => part.trim())

  return { city, regions: rest.filter((part) => part !== "").map((part) => STATES[part.toUpperCase()] ?? part) }
}

/**
 * The search result the written location means: the first whose state, country or country code matches every region
 * word, else the geocoder's own first result, which is its most populous match.
 */
export function pickPlace(places: readonly Place[], regions: readonly string[]) {
  const wanted = regions.map((region) => region.toLowerCase())

  return (
    places.find((place) =>
      wanted.every((region) =>
        [place.admin1, place.country, place.country_code].some((field) => field?.toLowerCase() === region),
      ),
    ) ?? places[0]
  )
}

// Open-Meteo reports WMO weather codes, each here with its wording and the icon that draws it by day.
const CODES: ReadonlyArray<readonly [codes: readonly number[], condition: string, icon: Icon]> = [
  [[0], "Clear", "sun"],
  [[1], "Mostly clear", "sun"],
  [[2], "Partly cloudy", "partly-cloudy-day"],
  [[3], "Overcast", "cloud"],
  [[45, 48], "Fog", "fog"],
  [[51, 53, 55, 56, 57], "Drizzle", "drizzle"],
  [[61, 63, 80, 81], "Rain", "rain"],
  [[65, 82], "Heavy rain", "rain"],
  [[66, 67], "Freezing rain", "rain"],
  [[71, 73, 75, 77, 85, 86], "Snow", "snow"],
  [[95, 96, 99], "Thunderstorm", "storm"],
]

// wttr.in reports World Weather Online codes.
const WWO: ReadonlyArray<readonly [codes: readonly number[], condition: string, icon: Icon]> = [
  [[113], "Clear", "sun"],
  [[116], "Partly cloudy", "partly-cloudy-day"],
  [[119, 122], "Overcast", "cloud"],
  [[143, 248, 260], "Fog", "fog"],
  [[200, 386, 389, 392, 395], "Thunderstorm", "storm"],
  [[263, 266, 293, 296, 353], "Light rain", "drizzle"],
  [[176, 299, 302, 305, 308, 356, 359], "Rain", "rain"],
  [
    [179, 182, 185, 227, 230, 281, 284, 311, 314, 317, 320, 323, 326, 329, 332, 335, 338, 350, 362, 365, 368, 371, 374, 377],
    "Snow",
    "snow",
  ],
]

const worded = (table: typeof CODES, code: number, day: boolean): { condition: string; icon: Icon } => {
  const found = table.find((entry) => entry[0].includes(code))
  const icon = found?.[2] ?? "cloud"

  return { condition: found?.[1] ?? "Unknown", icon: day ? icon : (NIGHT[icon] ?? icon) }
}

/** The wording and icon for one of Open-Meteo's weather codes. */
export function describeCode(code: number, day = true) {
  return worded(CODES, code, day)
}

/** The wording and icon for one of wttr.in's weather codes. */
export function describeWwo(code: number, day = true) {
  return worded(WWO, code, day)
}

const OpenMeteoForecast = Schema.Struct({
  timezone: Schema.String,
  current: Schema.Struct({
    temperature_2m: Schema.Finite,
    relative_humidity_2m: Schema.Finite,
    weather_code: Schema.Finite,
    wind_speed_10m: Schema.Finite,
    is_day: Schema.Finite,
  }),
  daily: Schema.Struct({
    time: Schema.Array(Schema.String),
    weather_code: Schema.Array(Schema.Finite),
    temperature_2m_max: Schema.Array(Schema.Finite),
    temperature_2m_min: Schema.Array(Schema.Finite),
  }),
})

/** Open-Meteo's answer, which already comes in the asked units, as what the tool returns. */
export function fromOpenMeteo(input: {
  source: string
  place: string
  units: "fahrenheit" | "celsius"
  forecast: typeof OpenMeteoForecast.Type
}): Output {
  const metric = input.units === "celsius"

  return {
    source: input.source,
    place: input.place,
    timezone: input.forecast.timezone,
    temperatureUnit: metric ? "°C" : "°F",
    windUnit: metric ? "km/h" : "mph",
    current: {
      ...describeCode(input.forecast.current.weather_code, input.forecast.current.is_day === 1),
      temperature: Math.round(input.forecast.current.temperature_2m),
      humidity: Math.round(input.forecast.current.relative_humidity_2m),
      wind: Math.round(input.forecast.current.wind_speed_10m),
    },
    days: input.forecast.daily.time.map((date, index) => ({
      date,
      ...describeCode(input.forecast.daily.weather_code[index] ?? -1),
      high: Math.round(input.forecast.daily.temperature_2m_max[index] ?? 0),
      low: Math.round(input.forecast.daily.temperature_2m_min[index] ?? 0),
    })),
  }
}

// wttr.in writes every number as text.
const WttrForecast = Schema.Struct({
  current_condition: Schema.Array(
    Schema.Struct({
      temp_C: Schema.String,
      temp_F: Schema.String,
      humidity: Schema.String,
      windspeedKmph: Schema.String,
      windspeedMiles: Schema.String,
      weatherCode: Schema.String,
    }),
  ),
  weather: Schema.Array(
    Schema.Struct({
      date: Schema.String,
      maxtempC: Schema.String,
      maxtempF: Schema.String,
      mintempC: Schema.String,
      mintempF: Schema.String,
      hourly: Schema.Array(Schema.Struct({ time: Schema.String, weatherCode: Schema.String })),
    }),
  ),
})

/** wttr.in's answer as what the tool returns. It carries both units, and three days at most. */
export function fromWttr(input: {
  source: string
  place: string
  timezone: string
  units: "fahrenheit" | "celsius"
  days: number
  forecast: typeof WttrForecast.Type
}): Output | undefined {
  const now = input.forecast.current_condition[0]

  if (!now) return undefined
  const metric = input.units === "celsius"

  return {
    source: input.source,
    place: input.place,
    timezone: input.timezone,
    temperatureUnit: metric ? "°C" : "°F",
    windUnit: metric ? "km/h" : "mph",
    current: {
      ...describeWwo(Number(now.weatherCode)),
      temperature: Number(metric ? now.temp_C : now.temp_F),
      humidity: Number(now.humidity),
      wind: Number(metric ? now.windspeedKmph : now.windspeedMiles),
    },
    days: input.forecast.weather.slice(0, input.days).map((day) => ({
      date: day.date,
      // The midday hour stands for the day.
      ...describeWwo(Number((day.hourly.find((hour) => hour.time === "1200") ?? day.hourly[0])?.weatherCode ?? -1)),
      high: Number(metric ? day.maxtempC : day.maxtempF),
      low: Number(metric ? day.mintempC : day.mintempF),
    })),
  }
}

type Source = ConfigExperimental.WeatherSource

/** What each kind of source is called and where it lives unless the config gives another address. */
export const SOURCE_TYPES = {
  "met-norway": { label: "MET Norway", url: "https://api.met.no/weatherapi/locationforecast/2.0/compact" },
  "open-meteo": { label: "Open-Meteo", url: "https://api.open-meteo.com/v1/forecast" },
  wttr: { label: "wttr.in", url: "https://wttr.in" },
} as const satisfies Record<Source["type"], { label: string; url: string }>

/** The sources used while the config lists none. */
export const DEFAULT_SOURCES: readonly Source[] = [{ type: "met-norway" }, { type: "open-meteo" }]

/** The sources to try, in order: the config's own list without the ones switched off, else the defaults. */
export function activeSources(entries: readonly Entry[]) {
  return (
    entries.findLast(
      (entry): entry is Document => entry.type === "document" && entry.info.experimental?.weather?.sources !== undefined,
    )?.info.experimental?.weather?.sources ?? DEFAULT_SOURCES
  ).filter((source) => source.disabled !== true)
}

type Asked = Omit<typeof Input.Type, "units"> & { readonly units: "fahrenheit" | "celsius" }

// Regions that measure temperature in Fahrenheit.
const FAHRENHEIT = new Set(["US", "LR", "MM", "BS", "BZ", "KY", "PW", "FM", "MH"])

/** The unit the user set in Settings, else the one this computer's region uses. */
export function units(entries: readonly Entry[], locale = Intl.DateTimeFormat().resolvedOptions().locale) {
  const set = entries.findLast(
    (entry): entry is Document => entry.type === "document" && entry.info.experimental?.weather?.units !== undefined,
  )?.info.experimental?.weather?.units

  return set ?? (FAHRENHEIT.has(new Intl.Locale(locale).maximize().region ?? "") ? "fahrenheit" : "celsius")
}

/** The result as the short text the model reads. */
export function weatherText(weather: Output) {
  const degrees = weather.temperatureUnit

  return [
    `${weather.place} (${weather.timezone}), from ${weather.source}`,
    `Now: ${weather.current.condition}, ${weather.current.temperature}${degrees}, humidity ${weather.current.humidity}%, wind ${weather.current.wind} ${weather.windUnit}. Icon: ${weather.current.icon}`,
    ...weather.days.map(
      (day) => `${day.date}: ${day.condition}, high ${day.high}${degrees}, low ${day.low}${degrees}. Icon: ${day.icon}`,
    ),
  ].join("\n")
}

/**
 * The ready-made block that shows the result as a card in the desktop app. Models copy what they are handed far more
 * reliably than they assemble it, and without the fence the card would arrive as plain text.
 */
export function cardHint(weather: Output) {
  return [
    "To show this as a weather card, put this block in your reply exactly as it is, fence included:",
    "```visual",
    `<weather-card><script type="application/json">${JSON.stringify(weather)}</script></weather-card>`,
    "```",
  ].join("\n")
}

// Each source gets this long before the next one is tried.
const TIMEOUT = Duration.seconds(12)

export const Plugin = {
  id: "opencode.tool.weather",
  effect: Effect.fn("WeatherTool.Plugin")(function* (ctx: Context) {
    const http = yield* HttpClient.HttpClient
    const config = yield* Config.Service

    // MET Norway asks every client to name itself.
    const get = <A>(url: string, params: Record<string, string>, schema: Schema.Codec<A, unknown>) =>
      http
        .execute(
          HttpClientRequest.get(url).pipe(
            HttpClientRequest.setUrlParams(params),
            HttpClientRequest.setHeader("User-Agent", "jacode-weather-tool/1.0"),
          ),
        )
        .pipe(
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
        )

    const empty = Effect.fail(new Error("The forecast came back empty"))

    // One source's forecast for a found place, in the asked units.
    const ask = (source: Source, place: Place, input: Asked): Effect.Effect<Output, unknown> => {
      const kind = SOURCE_TYPES[source.type]
      const label = source.name || kind.label
      const url = source.url || kind.url
      const named = [place.name, place.admin1, place.country].filter((part) => part !== undefined).join(", ")
      // The services take at most four decimals.
      const latitude = place.latitude.toFixed(4)
      const longitude = place.longitude.toFixed(4)

      if (source.type === "open-meteo")
        return get(
          url,
          {
            latitude,
            longitude,
            current: "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,is_day",
            daily: "weather_code,temperature_2m_max,temperature_2m_min",
            temperature_unit: input.units,
            wind_speed_unit: input.units === "celsius" ? "kmh" : "mph",
            timezone: "auto",
            forecast_days: String(input.days),
          },
          OpenMeteoForecast,
        ).pipe(Effect.map((forecast) => fromOpenMeteo({ source: label, place: named, units: input.units, forecast })))

      if (source.type === "wttr")
        return get(`${url.replace(/\/$/, "")}/${latitude},${longitude}`, { format: "j1" }, WttrForecast).pipe(
          Effect.flatMap((forecast) => {
            const output = fromWttr({
              source: label,
              place: named,
              timezone: place.timezone ?? "UTC",
              units: input.units,
              days: input.days,
              forecast,
            })

            return output ? Effect.succeed(output) : empty
          }),
        )

      return get(url, { lat: latitude, lon: longitude }, Forecast).pipe(
        Effect.flatMap((forecast) => {
          const output = summarize({
            source: label,
            place: named,
            timezone: place.timezone ?? "UTC",
            units: input.units,
            days: input.days,
            hours: forecast.properties.timeseries,
          })

          return output ? Effect.succeed(output) : empty
        }),
      )
    }

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          // Called directly rather than from Code Mode, where a script gets only the data back: the model must read
          // the text result, which ends with the card to show.
          options: { codemode: false },
          description,
          input: Input,
          output: Output,
          execute: (input) =>
            Effect.gen(function* () {
              const entries = yield* config.entries()
              const sources = activeSources(entries)
              const asked = { ...input, units: input.units ?? units(entries) }

              if (sources.length === 0)
                return yield* Effect.fail(new Error("No weather source is turned on. Add one in Settings, under Weather."))
              const written = splitLocation(input.location)

              const found = yield* get(
                "https://geocoding-api.open-meteo.com/v1/search",
                { name: written.city, count: "10", language: "en", format: "json" },
                Places,
              ).pipe(
                Effect.timeoutOrElse({
                  duration: TIMEOUT,
                  orElse: () => Effect.fail(new Error("Looking up the place timed out")),
                }),
              )

              const place = pickPlace(found.results ?? [], written.regions)

              if (!place) return yield* Effect.fail(new Error(`No place found for "${input.location}"`))

              // Each source in turn; a failure moves on to the next, and all of them failing reports each reason.
              const from = (index: number, failures: readonly string[]): Effect.Effect<Output, Error> => {
                const source = sources[index]

                if (!source) return Effect.fail(new Error(failures.join("; ")))
                const label = source.name || SOURCE_TYPES[source.type].label

                return ask(source, place, asked).pipe(
                  Effect.timeoutOrElse({ duration: TIMEOUT, orElse: () => Effect.fail(new Error("timed out")) }),
                  Effect.catch((error) =>
                    from(index + 1, [...failures, `${label}: ${error instanceof Error ? error.message : String(error)}`]),
                  ),
                )
              }

              const output = yield* from(0, [])

              return { output, content: `${weatherText(output)}\n\n${cardHint(output)}` }
            }).pipe(
              Effect.mapError(
                (error) => new ToolFailure({ message: `Unable to get the weather for ${input.location}`, error }),
              ),
            ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
