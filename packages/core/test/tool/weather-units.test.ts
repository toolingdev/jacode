import { expect, test } from "bun:test"
import { WeatherTool } from "../../src/tool/plugin/weather"

test("the weather unit is the one set in Settings, else the one the region uses", () => {
  expect(WeatherTool.units([], "en-US")).toBe("fahrenheit")
  expect(WeatherTool.units([], "fr-FR")).toBe("celsius")
  expect(WeatherTool.units([], "en-GB")).toBe("celsius")
  // SAFETY: units reads only the type and the experimental weather block of each entry.
  const set = [{ type: "document", info: { experimental: { weather: { units: "celsius" } } } }] as never
  expect(WeatherTool.units(set, "en-US")).toBe("celsius")
})

test("setting only the unit keeps the weather sources listed earlier", () => {
  // SAFETY: activeSources reads only the type and the experimental weather block of each entry.
  const entries = [
    { type: "document", info: { experimental: { weather: { sources: [{ type: "wttr" }] } } } },
    { type: "document", info: { experimental: { weather: { units: "celsius" } } } },
  ] as never
  expect(WeatherTool.activeSources(entries)).toEqual([{ type: "wttr" }])
})
