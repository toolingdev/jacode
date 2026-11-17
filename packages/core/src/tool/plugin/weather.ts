export * as WeatherTool from "./weather.js"

import { ToolFailure } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import { Duration, Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"

// Fork feature: current weather and a daily forecast for a place. The place is looked up with Open-Meteo's geocoder
// and the forecast comes from MET Norway; both are free and need no key. The place name and its coordinates are the
// only things sent. The result names an icon for each condition, which the app's inline visuals can draw.

export const name = "weather"

export const description = `Get the current weather and a daily forecast for a place by name (a city, optionally with a state or country, such as "Denver, CA" or "Lyon, France"). Data comes from MET Norway. Use this instead of searching the web for weather.

Each condition comes with an \`icon\` name. When you show the result as a visual, draw it with <weather-icon name="..."></weather-icon>.`

export const Input = Schema.Struct({
  location: Schema.String.annotate({ description: 'The place, e.g. "Denver, CA", "Paris" or "Tokyo, Japan"' }),
  units: Schema.Literals(["fahrenheit", "celsius"])
    .annotate({ description: "Temperature unit. Fahrenheit also gives wind in mph; Celsius in km/h. Defaults to fahrenheit." })
    .pipe(Schema.withDecodingDefaultKey(Effect.succeed("fahrenheit" as const))),
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

/** The result as the short text the model reads. */
export function weatherText(weather: Output) {
  const degrees = weather.temperatureUnit

  return [
    `${weather.place} (${weather.timezone})`,
    `Now: ${weather.current.condition}, ${weather.current.temperature}${degrees}, humidity ${weather.current.humidity}%, wind ${weather.current.wind} ${weather.windUnit}. Icon: ${weather.current.icon}`,
    ...weather.days.map(
      (day) => `${day.date}: ${day.condition}, high ${day.high}${degrees}, low ${day.low}${degrees}. Icon: ${day.icon}`,
    ),
  ].join("\n")
}

const TIMEOUT = Duration.seconds(20)

export const Plugin = {
  id: "opencode.tool.weather",
  effect: Effect.fn("WeatherTool.Plugin")(function* (ctx: Context) {
    const http = yield* HttpClient.HttpClient

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

    yield* ctx.tool
      .transform((editor) =>
        editor.add({
          name,
          description,
          input: Input,
          output: Output,
          execute: (input) =>
            Effect.gen(function* () {
              const written = splitLocation(input.location)

              const found = yield* get(
                "https://geocoding-api.open-meteo.com/v1/search",
                { name: written.city, count: "10", language: "en", format: "json" },
                Places,
              )

              const place = pickPlace(found.results ?? [], written.regions)

              if (!place) return yield* Effect.fail(new Error(`No place found for "${input.location}"`))

              const forecast = yield* get(
                "https://api.met.no/weatherapi/locationforecast/2.0/compact",
                // The service takes at most four decimals.
                { lat: place.latitude.toFixed(4), lon: place.longitude.toFixed(4) },
                Forecast,
              )

              const output = summarize({
                place: [place.name, place.admin1, place.country].filter((part) => part !== undefined).join(", "),
                timezone: place.timezone ?? "UTC",
                units: input.units,
                days: input.days,
                hours: forecast.properties.timeseries,
              })

              if (!output) return yield* Effect.fail(new Error("The forecast came back empty"))

              return { output, content: weatherText(output) }
            }).pipe(
              Effect.timeoutOrElse({ duration: TIMEOUT, orElse: () => Effect.fail(new Error("Request timed out")) }),
              Effect.mapError(
                (error) => new ToolFailure({ message: `Unable to get the weather for ${input.location}`, error }),
              ),
            ),
        }),
      )
      .pipe(Effect.orDie)
  }),
}
