// Fork feature: the weather card a visual can show. The page defines `<weather-card>`; a model puts the weather
// tool's JSON inside it and the app draws it in the look the user picked, so every card matches that choice.
//
// The script runs inside the visual's page, so it is kept as text here. It reads the look from the page's root
// element and uses the `<weather-icon>` element for its icons.

export const WEATHER_CARD_SCRIPT = String.raw`(() => {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const css = [
    ":host{display:block;padding:8px 18px 22px 6px}",
    ".card{font:14px/1.4 system-ui,-apple-system,sans-serif;color:var(--text);padding:16px 18px;border-radius:14px;max-width:560px;display:grid;gap:12px;position:relative}",
    ".head{display:flex;justify-content:space-between;gap:12px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}",
    ".now{display:flex;align-items:center;gap:14px}",
    ".temp{font-size:44px;font-weight:700;line-height:1}",
    ".cond{color:var(--muted);font-size:13px;margin-top:4px}",
    ".days{display:grid;grid-template-columns:repeat(auto-fit,minmax(58px,1fr));gap:8px;text-align:center;font-size:12px}",
    ".day{display:grid;gap:4px;justify-items:center}",
    ".hl span{color:var(--muted)}",
    ".s-clean{background:var(--surface);border:1px solid var(--border)}",
    ".s-pixel{font-family:ui-monospace,Menlo,Consolas,monospace;border-radius:0;background:#1b1f3b;border:4px solid #f8f8f2;box-shadow:4px 4px 0 #ff5fa2,8px 8px 0 #5fd7ff;--text:#f8f8f2;--muted:#a9b1d6;--yellow:#ffd866;--blue:#5fd7ff}",
    ".s-pixel .temp{letter-spacing:2px;text-shadow:3px 3px 0 #ff5fa2}",
    ".s-pixel .day{border:2px solid #5fd7ff;padding:6px 2px;background:#262b52}",
    ".s-glass{background:linear-gradient(135deg,rgba(255,255,255,.18),rgba(255,255,255,.04));border:1px solid rgba(255,255,255,.28);box-shadow:0 10px 30px rgba(0,0,0,.25);overflow:hidden}",
    ".s-glass::before{content:'';position:absolute;inset:-40% 40% 30% -20%;background:radial-gradient(circle,var(--blue),transparent 65%);opacity:.35;z-index:-1}",
    ".s-glass::after{content:'';position:absolute;inset:30% -20% -40% 45%;background:radial-gradient(circle,var(--pink),transparent 65%);opacity:.3;z-index:-1}",
    ".s-neon{background:#0b0b16;border:1.5px solid #ff2bd6;box-shadow:0 0 12px #ff2bd6,inset 0 0 18px rgba(0,255,255,.15);--text:#e8faff;--muted:#8be9fd;--yellow:#fff200;--blue:#00f0ff}",
    ".s-neon .temp{color:#00f0ff;text-shadow:0 0 10px #00f0ff,0 0 24px #00f0ff}",
    ".s-neon .place{color:#ff2bd6;text-shadow:0 0 8px #ff2bd6}",
    ".s-block3d{background:linear-gradient(160deg,#5b8def,#7a5cf0);border-radius:18px;transform:perspective(900px) rotateX(5deg) rotateY(-7deg);box-shadow:1px 1px 0 #4a52c9,2px 2px 0 #4a52c9,3px 3px 0 #4a52c9,4px 4px 0 #4a52c9,5px 5px 0 #4a52c9,6px 6px 0 #4a52c9,7px 7px 0 #4a52c9,8px 8px 0 #4a52c9,14px 20px 26px rgba(0,0,0,.35);--text:#fff;--muted:rgba(255,255,255,.82);--yellow:#ffe066}",
    ".s-block3d .day{background:rgba(255,255,255,.14);border-radius:10px;padding:6px 2px;box-shadow:0 3px 0 rgba(0,0,0,.2)}",
    ".s-block3d .temp{text-shadow:0 2px 0 rgba(0,0,0,.25),0 4px 0 rgba(0,0,0,.15)}",
    ".s-terminal{font-family:ui-monospace,Menlo,Consolas,monospace;background:#03130a;border:1px solid #1f8f4a;border-radius:4px;--text:#3dff7a;--muted:#1fae56;--yellow:#3dff7a;--blue:#3dff7a}",
    ".s-terminal .place::before{content:'> '}",
    ".s-terminal .temp::after{content:'_';animation:wc-blink 1s steps(1) infinite}",
    ".s-terminal .day+.day{border-left:1px dashed #1f8f4a}",
    ".s-newspaper{font-family:Georgia,'Times New Roman',serif;background:#f4efe4;border:1px solid #1a1a1a;border-radius:2px;--text:#1a1a1a;--muted:#555;--yellow:#1a1a1a;--blue:#444}",
    ".s-newspaper .head{border-bottom:3px double #1a1a1a;padding-bottom:6px;color:#1a1a1a}",
    ".s-newspaper .temp{font-size:52px;font-style:italic}",
    ".s-newspaper .days{border-top:1px solid #1a1a1a;padding-top:8px}",
    ".s-newspaper .day+.day{border-left:1px solid #bbb}",
    ".s-sky{border-radius:20px;background:linear-gradient(180deg,#2f80ed,#7fb8f0);--text:#fff;--muted:rgba(255,255,255,.86);--yellow:#ffe066;--blue:#d6ecff}",
    ".s-sky.c-sun{background:linear-gradient(180deg,#2f80ed,#f2994a)}",
    ".s-sky.c-rain,.s-sky.c-drizzle,.s-sky.c-storm{background:linear-gradient(180deg,#3b4a63,#6f86a6)}",
    ".s-sky.c-moon,.s-sky.c-partly-cloudy-night{background:linear-gradient(180deg,#141e46,#4b3f8f)}",
    ".s-sky.c-fog,.s-sky.c-cloud{background:linear-gradient(180deg,#5d6a79,#9aa6b3)}",
    ".s-sky.c-snow{background:linear-gradient(180deg,#5f7fa6,#b9cde3)}",
    ".s-minimal{padding:4px 0}",
    ".s-minimal .temp{font-size:72px;font-weight:200}",
    ".s-minimal .head{letter-spacing:.2em}",
    ".s-minimal .days{border-top:1px solid var(--border);padding-top:10px}",
    ".s-comic{font-family:'Comic Sans MS','Marker Felt','Chalkboard SE',system-ui,sans-serif;background-color:#ffe066;background-image:radial-gradient(rgba(0,0,0,.13) 1.2px,transparent 1.3px);background-size:9px 9px;border:3px solid #1b1b1b;border-radius:18px;box-shadow:6px 6px 0 #1b1b1b;transform:rotate(-1deg);--text:#1b1b1b;--muted:#3a3a3a;--yellow:#ff7a00;--blue:#0077ff}",
    ".s-comic .temp{font-size:52px;color:#fff;-webkit-text-stroke:1.5px #1b1b1b}",
    ".s-comic .day{background:#fff;border:2px solid #1b1b1b;border-radius:10px;padding:5px 2px}",
    "@keyframes wc-blink{50%{opacity:0}}",
    "@media (prefers-reduced-motion:reduce){*{animation:none!important}}",
  ].join("");

  customElements.define("weather-card", class extends HTMLElement {
    connectedCallback() {
      // The data may still be arriving while the page is parsed.
      this.draw();
      new MutationObserver(() => this.draw()).observe(this, { childList: true, subtree: true, characterData: true });
    }
    draw() {
      const text = this.querySelector('script[type="application/json"]')?.textContent ?? this.getAttribute("data") ?? "";
      let data;
      try { data = JSON.parse(text); } catch { return; }
      if (!data || typeof data !== "object") return;
      const style = document.documentElement.dataset.weatherStyle || "clean";
      const now = data.current ?? {};
      const unit = data.temperatureUnit ?? "°";
      const degree = unit.slice(0, 1) === "°" ? "°" : unit;
      const days = Array.isArray(data.days) ? data.days : [];
      const weekday = (date) => {
        const parsed = new Date(date + "T12:00:00");
        return Number.isNaN(parsed.getTime()) ? esc(date) : parsed.toLocaleDateString(undefined, { weekday: "short" });
      };
      const details = [now.condition, now.humidity == null ? "" : "humidity " + now.humidity + "%", now.wind == null ? "" : "wind " + now.wind + " " + (data.windUnit ?? "")].filter(Boolean).map(esc).join(" · ");
      const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
      root.innerHTML = "<style>" + css + "</style>" +
        '<div class="card s-' + esc(style) + " c-" + esc(now.icon) + '">' +
        '<div class="head"><span class="place">' + esc(data.place) + '</span><span class="src">' + esc(data.source) + "</span></div>" +
        '<div class="now"><weather-icon name="' + esc(now.icon) + '" size="' + (style === "minimal" ? 44 : 64) + '"></weather-icon><div><div class="temp">' + esc(now.temperature) + esc(degree) + '</div><div class="cond">' + details + "</div></div></div>" +
        '<div class="days">' + days.map((day) => '<div class="day"><div class="dow">' + weekday(day.date) + '</div><weather-icon name="' + esc(day.icon) + '" size="30"></weather-icon><div class="hl"><b>' + esc(day.high) + "°</b> <span>" + esc(day.low) + "°</span></div></div>").join("") + "</div>" +
        "</div>";
    }
  });
})()`
