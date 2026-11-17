import { describe, expect, test } from "bun:test"
import { VisualsPlugin } from "../../src/plugin/visuals"

const document = (experimental: object) => ({ type: "document", info: { experimental } }) as never

describe("visuals note", () => {
  test("tells the model about visual blocks, the weather card and the built-in chart library", () => {
    expect(VisualsPlugin.INSTRUCTION.startsWith("<system-reminder>\n")).toBe(true)
    expect(VisualsPlugin.INSTRUCTION).toContain("language is `visual`")
    expect(VisualsPlugin.INSTRUCTION).toContain("<weather-card>")
    expect(VisualsPlugin.INSTRUCTION).toContain('<script src="chart.js"></script>')
  })

  test("is on unless the config switches it off", () => {
    expect(VisualsPlugin.switchedOff([])).toBe(false)
    expect(VisualsPlugin.switchedOff([document({ visuals: true })])).toBe(false)
    expect(VisualsPlugin.switchedOff([document({ visuals: false }), document({ weather: { sources: [] } })])).toBe(true)
  })
})
