// Fork feature: animated weather icons for visuals. A visual has no network, so it cannot load an icon set; the page
// it runs in defines `<weather-icon name="rain" size="48">` instead. The names are the ones the weather tool gives.

export const WEATHER_ICON_NAMES = [
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
] as const

/**
 * Defines the element. It runs inside the visual's page, not here: its source is written into that page, so it must
 * not use anything from outside its own body.
 */
function defineWeatherIcons() {
  const cloud = '<path class="cloud" d="M19 46h27a10 10 0 0 0 1.2-19.9A14 14 0 0 0 20.3 29 8.6 8.6 0 0 0 19 46z"/>'
  const drifting = `<g class="drift">${cloud}</g>`

  const sun = (x: number, y: number, radius: number) =>
    `<circle class="disc" cx="${x}" cy="${y}" r="${radius}"/><g class="rays" style="transform-origin:${x}px ${y}px">${[
      0, 45, 90, 135, 180, 225, 270, 315,
    ]
      .map(
        (angle) =>
          `<line x1="${x}" y1="${y - radius - 4}" x2="${x}" y2="${y - radius - 8}" transform="rotate(${angle} ${x} ${y})"/>`,
      )
      .join("")}</g>`

  const moon = (x: number, y: number, scale: number) =>
    `<path class="moon" transform="translate(${x} ${y}) scale(${scale})" d="M14 0a14 14 0 1 0 12 21A11 11 0 0 1 14 0z"/>`

  const drops = (count: number, kind: string) =>
    Array.from(
      { length: count },
      (_, index) =>
        `<line class="${kind}" style="animation-delay:${index * -0.35}s" x1="${26 + index * 8}" y1="50" x2="${24 + index * 8}" y2="56"/>`,
    ).join("")

  const flakes = [0, 1, 2]
    .map(
      (index) =>
        `<circle class="flake" style="animation-delay:${index * -0.6}s" cx="${25 + index * 8}" cy="51" r="1.8"/>`,
    )
    .join("")

  const icons = {
    sun: sun(32, 32, 11),
    moon: `<g class="glow">${moon(18, 16, 1.15)}</g>`,
    "partly-cloudy-day": `${sun(24, 22, 8)}${drifting}`,
    "partly-cloudy-night": `<g class="glow">${moon(12, 8, 0.8)}</g>${drifting}`,
    cloud: drifting,
    fog: [24, 33, 42]
      .map(
        (y, index) =>
          `<line class="mist" style="animation-delay:${index * -1.2}s" x1="14" y1="${y}" x2="50" y2="${y}"/>`,
      )
      .join(""),
    drizzle: `${cloud}${drops(2, "drop slow")}`,
    rain: `${cloud}${drops(3, "drop")}`,
    snow: `${cloud}${flakes}`,
    storm: `${cloud}<polygon class="bolt" points="34,42 27,53 32,53 29,62 40,49 34,49 37,42"/>${drops(2, "drop")}`,
  } satisfies Record<string, string>

  const css = `
:host{display:inline-block;vertical-align:middle;line-height:0}
svg{width:100%;height:100%;overflow:visible}
.disc,.moon{fill:var(--yellow,#f5c542)}
.rays line{stroke:var(--yellow,#f5c542);stroke-width:3;stroke-linecap:round}
.rays{animation:wi-spin 16s linear infinite}
.glow{animation:wi-glow 4s ease-in-out infinite}
.cloud{fill:var(--muted,#9aa0aa)}
.drift{animation:wi-drift 5s ease-in-out infinite}
.drop{stroke:var(--blue,#5aa9ff);stroke-width:2.6;stroke-linecap:round;animation:wi-fall 1s linear infinite}
.drop.slow{animation-duration:1.7s}
.flake{fill:var(--text,#e6e6e6);animation:wi-fall 2.4s linear infinite}
.bolt{fill:var(--yellow,#f5c542);animation:wi-flash 2.6s linear infinite}
.mist{stroke:var(--muted,#9aa0aa);stroke-width:3.4;stroke-linecap:round;animation:wi-slide 4.5s ease-in-out infinite}
@keyframes wi-spin{to{transform:rotate(360deg)}}
@keyframes wi-glow{0%,100%{opacity:1}50%{opacity:.72}}
@keyframes wi-drift{0%,100%{transform:translateX(-1.5px)}50%{transform:translateX(2.5px)}}
@keyframes wi-fall{0%{transform:translateY(-2px);opacity:0}25%{opacity:1}100%{transform:translateY(9px);opacity:0}}
@keyframes wi-flash{0%,62%,100%{opacity:.25}66%,72%{opacity:1}69%{opacity:.4}}
@keyframes wi-slide{0%,100%{transform:translateX(-3px)}50%{transform:translateX(3px)}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}`

  customElements.define(
    "weather-icon",
    class extends HTMLElement {
      static observedAttributes = ["name", "size"]

      connectedCallback() {
        this.draw()
      }

      attributeChangedCallback() {
        this.draw()
      }

      draw() {
        const name = this.getAttribute("name") ?? ""
        const size = Number(this.getAttribute("size")) || 48
        const root = this.shadowRoot ?? this.attachShadow({ mode: "open" })

        this.style.width = `${size}px`
        this.style.height = `${size}px`
        root.innerHTML = `<style>${css}</style><svg viewBox="0 0 64 64" role="img" aria-label="${name.replace(/[^a-z-]/g, "")}">${Object.entries(icons).find(([key]) => key === name)?.[1] ?? icons.cloud}</svg>`
      }
    },
  )
}

/** The element's definition as a script for the visual's page. */
export const WEATHER_ICONS_SCRIPT = `(${defineWeatherIcons.toString()})()`
