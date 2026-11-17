import { describe, expect, test } from "bun:test"
import { visualDocument, visualHeight, wantsChart, withChart } from "./document"
import { WEATHER_CARD_SCRIPT } from "./card"
import { CARD_LABEL_KEYS, OUTLINE_CARD_SCRIPT, QUOTE_CARD_SCRIPT, USAGE_CARD_SCRIPT } from "./cards"
import en from "./i18n/en"
import { CHART_STYLE_SCRIPT } from "./charts"
import { WEATHER_ICON_NAMES, WEATHER_ICONS_SCRIPT } from "./icons"
import { CHART_STYLES, RANDOM, resolveLook, WEATHER_CARD_STYLES } from "./styles"

describe("visual document", () => {
  const page = visualDocument({ fragment: "<p>hi</p>", id: "v1", colors: { text: "#fff", blue: undefined }, dark: true })

  test("carries the fragment, the theme colours it was given, and its id", () => {
    expect(page).toContain('<div id="visual-root"><p>hi</p></div>')
    // Only the colours that were given are set; the rest fall back inside the page.
    expect(page).toContain(":root{color-scheme:dark;--text:#fff}")
    expect(page).toContain('id: "v1"')
  })

  test("refuses the network altogether", () => {
    expect(page).toContain("default-src 'none'")
    expect(page).toContain("script-src 'unsafe-inline';")
    expect(page).not.toContain("connect-src")
    expect(page).toContain("img-src data: blob:")
  })

  test("hands over the chart library in place of a request for it", () => {
    const fragment = `<canvas id="c"></canvas><script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script><script>new Chart(c, {})</script>`

    expect(wantsChart(fragment)).toBe(true)
    expect(wantsChart("<p>no chart</p><script>1</script>")).toBe(false)
    const filled = withChart(fragment, "var Chart=1;'</script>'")

    expect(filled.startsWith(`<canvas id="c"></canvas><script>var Chart=1;'<\\/script>'</script><script>`)).toBe(true)
    expect(filled).toContain("jacode-look")
    expect(filled.endsWith("<script>new Chart(c, {})</script>")).toBe(true)
  })

  test("defines the weather icons without ending its own script early", () => {
    expect(page).toContain('customElements.define("weather-icon"')
    expect(WEATHER_ICONS_SCRIPT).not.toContain("</script")
    expect(WEATHER_ICON_NAMES.every((name) => WEATHER_ICONS_SCRIPT.includes(name))).toBe(true)
  })

  test("carries the picked looks and scripts that parse", () => {
    const styled = visualDocument({ fragment: "", id: "v", colors: {}, dark: true, weather: "pixel", chart: "neon" })

    expect(styled).toContain('data-weather-style="pixel" data-chart-style="neon"')
    expect(page).toContain('data-weather-style="clean" data-chart-style="clean"')
    expect(page).toContain('customElements.define("weather-card"')
    expect(() => new Function(WEATHER_CARD_SCRIPT)).not.toThrow()
    expect(() => new Function(CHART_STYLE_SCRIPT)).not.toThrow()
    expect(WEATHER_CARD_STYLES.every((style) => WEATHER_CARD_SCRIPT.includes(`.s-${style}`))).toBe(true)
    expect(CHART_STYLES.every((style) => CHART_STYLE_SCRIPT.includes(`${style}: {`))).toBe(true)
  })

  test("keeps the frame's height within bounds", () => {
    expect(visualHeight(0)).toBe(40)
    expect(visualHeight(312.4)).toBe(312)
    expect(visualHeight(99999)).toBe(1600)
  })
})

describe("picking a look", () => {
  test("a picked look is itself; random lands on one of the looks by its roll", () => {
    const looks = ["a", "b", "c", "d"] as const

    expect(resolveLook("c", looks, 0.99)).toBe("c")
    expect(resolveLook(RANDOM, looks, 0)).toBe("a")
    expect(resolveLook(RANDOM, looks, 0.5)).toBe("c")
    expect(resolveLook(RANDOM, looks, 0.999)).toBe("d")
    expect(resolveLook(RANDOM, looks, 1)).toBe("d")
  })
})

describe("visual cards", () => {
  test("ride in every page, each a script that parses", () => {
    const page = visualDocument({ fragment: "", id: "v3", colors: {}, dark: true })

    expect(page).toContain(USAGE_CARD_SCRIPT)
    expect(page).toContain(QUOTE_CARD_SCRIPT)
    expect(page).toContain(OUTLINE_CARD_SCRIPT)
    ;[USAGE_CARD_SCRIPT, QUOTE_CARD_SCRIPT, OUTLINE_CARD_SCRIPT].forEach((script) =>
      expect(() => new Function(script)).not.toThrow(),
    )
  })

  test("hands the cards their words, and has every word they ask for", () => {
    const labelled = visualDocument({ fragment: "", id: "v2", colors: {}, dark: true, labels: { usage: "Uso </script>" } })

    expect(labelled).toContain('window.visualLabels={"usage":"Uso \\u003c/script>"}')
    expect(CARD_LABEL_KEYS.filter((key) => !(`card.${key}` in en))).toEqual([])
  })
})
