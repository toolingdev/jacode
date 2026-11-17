import { describe, expect, test } from "bun:test"
import { WeatherTool } from "../src/tool/plugin/weather"

const hour = (time: string, celsius: number, symbol?: string) => ({
  time,
  data: {
    instant: { details: { air_temperature: celsius, relative_humidity: 50, wind_speed: 10 } },
    ...(symbol ? { next_1_hours: { summary: { symbol_code: symbol } } } : {}),
  },
})

describe("weather tool", () => {
  test("words a symbol code and gives clear nights the moon", () => {
    expect(WeatherTool.describeSymbol("clearsky_day")).toEqual({ condition: "Clear", icon: "sun" })
    expect(WeatherTool.describeSymbol("clearsky_night")).toEqual({ condition: "Clear", icon: "moon" })
    expect(WeatherTool.describeSymbol("partlycloudy_night")).toEqual({
      condition: "Partly cloudy",
      icon: "partly-cloudy-night",
    })
    expect(WeatherTool.describeSymbol("cloudy")).toEqual({ condition: "Overcast", icon: "cloud" })
    expect(WeatherTool.describeSymbol("lightrainshowers_night")).toEqual({ condition: "Light rain", icon: "drizzle" })
    expect(WeatherTool.describeSymbol("heavyrainandthunder")).toEqual({ condition: "Thunderstorm", icon: "storm" })
    expect(WeatherTool.describeSymbol("")).toEqual({ condition: "Unknown", icon: "cloud" })
  })

  test("reads a state written as two letters", () => {
    expect(WeatherTool.splitLocation("Denver, CA")).toEqual({ city: "Denver", regions: ["California"] })
    expect(WeatherTool.splitLocation(" Lyon , France ")).toEqual({ city: "Lyon", regions: ["France"] })
    expect(WeatherTool.splitLocation("Tokyo")).toEqual({ city: "Tokyo", regions: [] })
  })

  test("prefers the place in the named region, else the first result", () => {
    const places = [
      { name: "Portland", latitude: 45.5, longitude: -122.6, admin1: "Oregon", country: "United States", country_code: "US" },
      { name: "Portland", latitude: 43.6, longitude: -70.2, admin1: "Maine", country: "United States", country_code: "US" },
    ]

    expect(WeatherTool.pickPlace(places, ["Maine"])?.latitude).toBe(43.6)
    expect(WeatherTool.pickPlace(places, ["Maine", "us"])?.latitude).toBe(43.6)
    expect(WeatherTool.pickPlace(places, ["Narnia"])?.latitude).toBe(45.5)
    expect(WeatherTool.pickPlace([], [])).toBeUndefined()
  })

  test("sums hours up into the place's own days, in the asked units", () => {
    const weather = WeatherTool.summarize({
      source: "MET Norway",
      place: "Denver, California, United States",
      timezone: "America/Los_Angeles",
      units: "fahrenheit",
      days: 2,
      hours: [
        // 05:00 local on the 17th: still night there.
        hour("2026-11-17T13:00:00Z", 10, "clearsky_night"),
        hour("2026-11-17T20:00:00Z", 20, "partlycloudy_day"),
        hour("2026-11-18T03:00:00Z", 12, "cloudy"),
        // 08:00 UTC on the 18th is 00:00 local on the 18th.
        hour("2026-11-18T08:00:00Z", 5, "clearsky_night"),
        hour("2026-11-18T19:00:00Z", 15, "rain"),
        hour("2026-11-19T19:00:00Z", 30, "clearsky_day"),
      ],
    })

    expect(weather?.current).toEqual({ condition: "Clear", icon: "moon", temperature: 50, humidity: 50, wind: 22 })
    expect(weather?.days).toEqual([
      { date: "2026-11-17", condition: "Partly cloudy", icon: "partly-cloudy-day", high: 68, low: 50 },
      { date: "2026-11-18", condition: "Rain", icon: "rain", high: 59, low: 41 },
    ])
    expect(WeatherTool.summarize({ source: "s", place: "x", timezone: "UTC", units: "celsius", days: 1, hours: [] }),
    ).toBeUndefined()
  })

  test("reads Open-Meteo's answer, which already has the asked units", () => {
    expect(
      WeatherTool.fromOpenMeteo({
        source: "Open-Meteo",
        place: "Paris, France",
        units: "celsius",
        forecast: {
          timezone: "Europe/Paris",
          current: { temperature_2m: 11.4, relative_humidity_2m: 80.2, weather_code: 0, wind_speed_10m: 9.6, is_day: 0 },
          daily: {
            time: ["2026-11-17"],
            weather_code: [63],
            temperature_2m_max: [13.2],
            temperature_2m_min: [7.6],
          },
        },
      }),
    ).toEqual({
      source: "Open-Meteo",
      place: "Paris, France",
      timezone: "Europe/Paris",
      temperatureUnit: "°C",
      windUnit: "km/h",
      current: { condition: "Clear", icon: "moon", temperature: 11, humidity: 80, wind: 10 },
      days: [{ date: "2026-11-17", condition: "Rain", icon: "rain", high: 13, low: 8 }],
    })
  })

  test("reads wttr.in's answer, taking the asked unit and the midday sky", () => {
    const forecast = {
      current_condition: [
        { temp_C: "6", temp_F: "43", humidity: "94", windspeedKmph: "7", windspeedMiles: "4", weatherCode: "143" },
      ],
      weather: [
        {
          date: "2026-11-17",
          maxtempC: "12",
          maxtempF: "54",
          mintempC: "6",
          mintempF: "43",
          hourly: [
            { time: "0", weatherCode: "113" },
            { time: "1200", weatherCode: "302" },
          ],
        },
        { date: "2026-11-18", maxtempC: "11", maxtempF: "52", mintempC: "9", mintempF: "48", hourly: [] },
      ],
    }

    const weather = WeatherTool.fromWttr({
      source: "wttr.in",
      place: "Denver",
      timezone: "America/Los_Angeles",
      units: "fahrenheit",
      days: 1,
      forecast,
    })

    expect(weather?.current).toEqual({ condition: "Fog", icon: "fog", temperature: 43, humidity: 94, wind: 4 })
    expect(weather?.days).toEqual([{ date: "2026-11-17", condition: "Rain", icon: "rain", high: 54, low: 43 }])
    expect(
      WeatherTool.fromWttr({
        source: "w",
        place: "p",
        timezone: "UTC",
        units: "celsius",
        days: 1,
        forecast: { current_condition: [], weather: [] },
      }),
    ).toBeUndefined()
  })

  test("uses the config's sources without the ones switched off, else the defaults", () => {
    const document = (weather: object | undefined) =>
      ({ type: "document", info: { experimental: weather ? { weather } : {} } }) as never

    expect(WeatherTool.activeSources([]).map((source) => source.type)).toEqual(["met-norway", "open-meteo"])
    expect(
      WeatherTool.activeSources([
        document({ sources: [{ type: "wttr", disabled: true }, { type: "open-meteo", name: "Mirror" }] }),
        document(undefined),
      ]),
    ).toEqual([{ type: "open-meteo", name: "Mirror" }])
    expect(WeatherTool.activeSources([document({ sources: [] })])).toEqual([])
  })

  test("hands over the card as a fenced block to copy", () => {
    const weather = {
      source: "MET Norway",
      place: "Denver",
      timezone: "America/Los_Angeles",
      temperatureUnit: "°F",
      windUnit: "mph",
      current: { condition: "Clear", icon: "sun" as const, temperature: 72, humidity: 40, wind: 6 },
      days: [],
    }

    const lines = WeatherTool.cardHint(weather).split("\n")

    expect(lines[1]).toBe("```visual")
    expect(lines[2]).toBe(
      `<weather-card><script type="application/json">${JSON.stringify(weather)}</script></weather-card>`,
    )
    expect(lines[3]).toBe("```")
  })

  test("writes the result as text with the icon names", () => {
    expect(
      WeatherTool.weatherText({
        source: "MET Norway",
        place: "Denver, California, United States",
        timezone: "America/Los_Angeles",
        temperatureUnit: "°F",
        windUnit: "mph",
        current: { condition: "Clear", icon: "sun", temperature: 72, humidity: 40, wind: 6 },
        days: [{ date: "2026-11-17", condition: "Rain", icon: "rain", high: 60, low: 48 }],
      }),
    ).toBe(
      [
        "Denver, California, United States (America/Los_Angeles), from MET Norway",
        "Now: Clear, 72°F, humidity 40%, wind 6 mph. Icon: sun",
        "2026-11-17: Rain, high 60°F, low 48°F. Icon: rain",
      ].join("\n"),
    )
  })
})
