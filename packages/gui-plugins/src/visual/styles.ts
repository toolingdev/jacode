// Fork feature: the looks a user can pick for weather cards and for charts. The ids are what the visual's page reads.

export const WEATHER_CARD_STYLES = [
  "clean",
  "pixel",
  "glass",
  "neon",
  "block3d",
  "terminal",
  "newspaper",
  "sky",
  "minimal",
  "comic",
] as const

export type WeatherCardStyle = (typeof WEATHER_CARD_STYLES)[number]

/** What can be picked: a look, or a different one for every visual. */
export const RANDOM = "random"

/** The look a visual takes for a pick: the pick itself, or the look `roll` (0 up to 1) lands on when it is random. */
export function resolveLook<Look extends string>(pick: Look | typeof RANDOM, looks: readonly Look[], roll: number) {
  if (pick !== RANDOM) return pick

  return looks[Math.min(Math.floor(roll * looks.length), looks.length - 1)] ?? looks[0]
}

export const CHART_STYLES = [
  "clean",
  "pixel",
  "neon",
  "block3d",
  "terminal",
  "pastel",
  "blueprint",
  "newspaper",
  "sunset",
  "sketch",
] as const

export type ChartStyle = (typeof CHART_STYLES)[number]

/** A weather card with made-up numbers, for the previews in Settings. */
export const SAMPLE_WEATHER = {
  source: "Sample",
  place: "Denver, California",
  timezone: "America/Los_Angeles",
  temperatureUnit: "°F",
  windUnit: "mph",
  current: { condition: "Partly cloudy", icon: "partly-cloudy-day", temperature: 72, humidity: 40, wind: 6 },
  days: [
    { date: "2026-06-01", condition: "Clear", icon: "sun", high: 78, low: 55 },
    { date: "2026-06-02", condition: "Rain", icon: "rain", high: 64, low: 52 },
    { date: "2026-06-03", condition: "Thunderstorm", icon: "storm", high: 61, low: 50 },
    { date: "2026-06-04", condition: "Overcast", icon: "cloud", high: 66, low: 51 },
  ],
}

/** The fragment a preview tile shows for a weather card. */
export const SAMPLE_WEATHER_FRAGMENT = `<weather-card><script type="application/json">${JSON.stringify(SAMPLE_WEATHER)}</script></weather-card>`

/** The fragment a preview tile shows for a chart. */
export const SAMPLE_CHART_FRAGMENT = `<div style="height:150px"><canvas id="c"></canvas></div><script src="chart.js"></script><script>new Chart(document.getElementById("c"),{type:"bar",data:{labels:["Jan","Feb","Mar","Apr","May"],datasets:[{label:"A",data:[12,19,9,15,22]},{label:"B",data:[8,11,14,10,17]}]},options:{maintainAspectRatio:false,animation:false,plugins:{legend:{display:false}}}})</script>`
