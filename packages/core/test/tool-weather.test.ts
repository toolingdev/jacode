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
    expect(WeatherTool.summarize({ place: "x", timezone: "UTC", units: "celsius", days: 1, hours: [] })).toBeUndefined()
  })

  test("writes the result as text with the icon names", () => {
    expect(
      WeatherTool.weatherText({
        place: "Denver, California, United States",
        timezone: "America/Los_Angeles",
        temperatureUnit: "°F",
        windUnit: "mph",
        current: { condition: "Clear", icon: "sun", temperature: 72, humidity: 40, wind: 6 },
        days: [{ date: "2026-11-17", condition: "Rain", icon: "rain", high: 60, low: 48 }],
      }),
    ).toBe(
      [
        "Denver, California, United States (America/Los_Angeles)",
        "Now: Clear, 72°F, humidity 40%, wind 6 mph. Icon: sun",
        "2026-11-17: Rain, high 60°F, low 48°F. Icon: rain",
      ].join("\n"),
    )
  })
})
