import { describe, expect, test } from "bun:test"
import { moveSource, readWeatherForm, weatherFormOf } from "./sources"

describe("weather sources", () => {
  test("reads a form, dropping what was left empty", () => {
    expect(readWeatherForm({ type: "wttr", name: " ", url: "" })).toEqual({ type: "wttr" })
    expect(readWeatherForm({ type: "open-meteo", name: "Mirror", url: " https://weather.example.com/v1 " })).toEqual({
      type: "open-meteo",
      name: "Mirror",
      url: "https://weather.example.com/v1",
    })
  })

  test("refuses an address that is not http or https", () => {
    expect(readWeatherForm({ type: "wttr", name: "", url: "ftp://example.com" })).toBeUndefined()
    expect(readWeatherForm({ type: "wttr", name: "", url: "not a url" })).toBeUndefined()
  })

  test("an edit reads back what was saved and keeps the source switched off", () => {
    const saved = { type: "met-norway" as const, name: "Norway", disabled: true }

    expect(readWeatherForm(weatherFormOf(saved), saved)).toEqual(saved)
  })

  test("moves a source one place and stops at the ends", () => {
    const sources = [{ type: "met-norway" as const }, { type: "open-meteo" as const }, { type: "wttr" as const }]

    expect(moveSource(sources, 2, -1).map((source) => source.type)).toEqual(["met-norway", "wttr", "open-meteo"])
    expect(moveSource(sources, 0, 1).map((source) => source.type)).toEqual(["open-meteo", "met-norway", "wttr"])
    expect(moveSource(sources, 0, -1)).toEqual(sources)
    expect(moveSource(sources, 2, 1)).toEqual(sources)
  })
})
