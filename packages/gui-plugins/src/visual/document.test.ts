import { describe, expect, test } from "bun:test"
import { visualDocument, visualHeight, wantsChart, withChart } from "./document"

describe("visual document", () => {
  const page = visualDocument({ fragment: "<p>hi</p>", id: "v1", colors: { text: "#fff", blue: undefined }, dark: true })

  test("carries the fragment, the theme colours it was given, and its id", () => {
    expect(page).toContain('<div id="visual-root"><p>hi</p></div>')
    expect(page).toContain("--text:#fff")
    expect(page).not.toContain("--blue")
    expect(page).toContain('id: "v1"')
  })

  test("refuses the network altogether", () => {
    expect(page).toContain("default-src 'none'")
    expect(page).toContain("script-src 'unsafe-inline';")
    expect(page).not.toContain("https://")
    expect(page).not.toContain("connect-src")
    expect(page).toContain("img-src data: blob:")
  })

  test("hands over the chart library in place of a request for it", () => {
    const fragment = `<canvas id="c"></canvas><script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script><script>new Chart(c, {})</script>`

    expect(wantsChart(fragment)).toBe(true)
    expect(wantsChart("<p>no chart</p><script>1</script>")).toBe(false)
    expect(withChart(fragment, "var Chart=1;'</script>'")).toBe(
      `<canvas id="c"></canvas><script>var Chart=1;'<\\/script>'</script><script>new Chart(c, {})</script>`,
    )
  })

  test("keeps the frame's height within bounds", () => {
    expect(visualHeight(0)).toBe(40)
    expect(visualHeight(312.4)).toBe(312)
    expect(visualHeight(99999)).toBe(1600)
  })
})
