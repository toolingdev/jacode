// Fork feature: more cards a visual can show, beside the weather card. The page defines `<usage-card>`,
// `<quote-card>` (any quote or citation; a Bible passage is one kind) and `<outline-card>` (any outline; a sermon is
// one kind). Each reads the JSON placed inside it and draws itself in the app's colours. The usage and verse tools
// hand a model the block to copy; a model writes other quotes and outlines itself.
//
// The scripts run inside the visual's page, so they are kept as text here.

/** The words the cards show, by key; the app hands the page each one in the user's language as `card.<key>`. */
export const CARD_LABEL_KEYS = [
  "usage",
  "inactive",
  "of",
  "refills",
  "byModel",
  "to",
  "requests",
  "legend",
  "more",
  "daily",
  "weekly",
  "input_tokens",
  "images",
  "outline",
  "closing",
] as const

// What every card shares: reading its JSON, redrawing while the data is still arriving, and escaping text.
const CARD_BASE = String.raw`
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const list = (value) => (Array.isArray(value) ? value : []);
  const t = (key) => (window.visualLabels ?? {})[key] ?? key;
  const define = (tag, css, render) => customElements.define(tag, class extends HTMLElement {
    connectedCallback() {
      this.draw();
      new MutationObserver(() => this.draw()).observe(this, { childList: true, subtree: true, characterData: true });
    }
    draw() {
      const text = this.querySelector('script[type="application/json"]')?.textContent ?? this.getAttribute("data") ?? "";
      let data;
      try { data = JSON.parse(text); } catch { return; }
      if (!data || typeof data !== "object") return;
      const root = this.shadowRoot ?? this.attachShadow({ mode: "open" });
      root.innerHTML = "<style>:host{display:block;padding:6px 2px 10px}*{box-sizing:border-box}.card{font:14px/1.45 system-ui,-apple-system,sans-serif;color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px 18px;max-width:640px;display:grid;gap:14px;position:relative;overflow:hidden}.eyebrow{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}" + css + "</style>" + render(data);
    }
  });
`

export const USAGE_CARD_SCRIPT = String.raw`(() => {${CARD_BASE}
  const count = (value) => new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(Number(value) || 0);
  const level = (percent) => (percent >= 85 ? "var(--red)" : percent >= 60 ? "var(--yellow)" : "var(--green)");
  const until = (at, from) => {
    const minutes = Math.max(0, Math.round((at - from) / 60000));
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    return days > 0 ? days + "d " + hours + "h" : hours > 0 ? hours + "h " + (minutes % 60) + "m" : minutes + "m";
  };
  const colors = ["--blue", "--purple", "--pink", "--orange", "--green", "--yellow", "--red"];
  const css = [
    ".card::before{content:'';position:absolute;inset:0 0 auto 0;height:3px;background:linear-gradient(90deg,var(--blue),var(--purple),var(--pink),var(--orange))}",
    ".head{display:flex;justify-content:space-between;gap:12px;align-items:baseline}",
    ".name{font-size:16px;font-weight:650}",
    ".off{color:var(--red);font-size:12px}",
    ".meter{display:grid;gap:5px}",
    ".row{display:flex;justify-content:space-between;gap:12px;align-items:baseline}",
    ".big{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums}",
    ".of{color:var(--muted);font-size:12px}",
    ".track{height:10px;border-radius:99px;background:color-mix(in srgb,var(--muted) 22%,transparent);overflow:hidden}",
    ".fill{height:100%;border-radius:99px;min-width:4px}",
    ".models{display:grid;gap:7px}",
    ".model{display:grid;grid-template-columns:minmax(0,34%) minmax(0,1fr) auto;gap:10px;align-items:center;font-size:12.5px}",
    ".label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".bar{display:flex;height:8px;border-radius:99px;overflow:hidden;background:color-mix(in srgb,var(--muted) 14%,transparent)}",
    ".bar i{display:block;height:100%}",
    ".bar i+i{opacity:.45}",
    ".num{color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}",
    ".legend{color:var(--muted);font-size:11.5px}",
  ].join("");

  define("usage-card", css, (data) => list(data.providers).map((provider) => {
    // An image model counts requests, not tokens, and would only draw an empty bar.
    const models = list(provider.models).filter((entry) => (entry.input || 0) + (entry.output || 0) > 0);
    const shown = models.slice(0, 8);
    const most = Math.max(1, ...shown.map((entry) => (entry.input || 0) + (entry.output || 0)));
    return '<div class="card">' +
      '<div class="head"><span class="name">' + esc(provider.name) + '</span><span class="eyebrow">' + esc(t("usage")) + "</span></div>" +
      (provider.active === false ? '<div class="off">' + esc(t("inactive")) + "</div>" : "") +
      list(provider.meters).map((meter) => {
        const percent = Math.max(0, Math.min(100, Number(meter.percent) || 0));
        return '<div class="meter"><div class="row"><span><span class="big" style="color:' + level(percent) + '">' + percent + '%</span> <span class="of">' + esc(t(meter.window)) + " " + esc(t(meter.unit)) + '</span></span><span class="of">' + count(meter.used) + " " + esc(t("of")) + " " + count(meter.limit) + " · " + esc(t("refills")) + " " + until(meter.resetsAt, data.asOf ?? Date.now()) + "</span></div>" +
          '<div class="track"><div class="fill" style="width:' + percent + "%;background:" + level(percent) + '"></div></div></div>';
      }).join("") +
      (shown.length === 0 ? "" :
        '<div class="models"><div class="eyebrow">' + esc(t("byModel")) + (provider.from ? " · " + esc(provider.from) + " " + esc(t("to")) + " " + esc(provider.to) : "") + "</div>" +
        shown.map((entry, index) => {
          const color = "var(" + colors[index % colors.length] + ")";
          const input = ((entry.input || 0) / most) * 100;
          const output = ((entry.output || 0) / most) * 100;
          return '<div class="model"><span class="label" title="' + esc(entry.model) + '">' + esc(String(entry.model).split("/").pop()) + '</span><span class="bar"><i style="width:' + input + "%;background:" + color + '"></i><i style="width:' + output + "%;background:" + color + '"></i></span><span class="num">' + count((entry.input || 0) + (entry.output || 0)) + " · " + count(entry.requests) + " " + esc(t("requests")) + "</span></div>";
        }).join("") +
        '<div class="legend">' + esc(t("legend")) + (models.length > shown.length ? " · " + (models.length - shown.length) + " " + esc(t("more")) : "") + "</div></div>") +
      "</div>";
  }).join(""));
})()`

export const QUOTE_CARD_SCRIPT = String.raw`(() => {${CARD_BASE}
  const css = [
    ".card{padding-left:24px;background:linear-gradient(135deg,color-mix(in srgb,var(--purple) 16%,var(--surface)),var(--surface) 60%)}",
    ".card::before{content:'';position:absolute;inset:0 auto 0 0;width:5px;background:linear-gradient(180deg,var(--yellow),var(--orange),var(--pink),var(--purple))}",
    ".card::after{content:'\\201C';position:absolute;top:2px;right:14px;font:120px/1 Georgia,serif;color:var(--purple);opacity:.16;pointer-events:none}",
    ".title{font:600 20px/1.2 Georgia,'Times New Roman',serif}",
    ".cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px 22px}",
    ".text{font:16px/1.65 Georgia,'Times New Roman',serif}",
    ".text sup{font:600 10px/1 system-ui,sans-serif;color:var(--orange);margin-right:3px}",
    ".by{margin-top:8px;font-weight:600}",
    ".tag{margin-top:4px}",
  ].join("");
  // A quote is plain text, or lines that each carry a small label, such as a verse or line number.
  const quote = (value) => !value ? "" :
    '<div><div class="text" dir="auto">' + (list(value.lines).length ? list(value.lines).map((line) => (line.label ? "<sup>" + esc(line.label) + "</sup>" : "") + esc(line.text)).join(" ") : esc(value.text)) + "</div>" +
    (value.author ? '<div class="by" dir="auto">— ' + esc(value.author) + "</div>" : "") +
    (value.source ? '<div class="eyebrow tag" dir="auto">' + esc(value.source) + "</div>" : "") + "</div>";

  define("quote-card", css, (data) =>
    '<div class="card">' + (data.title ? '<div class="title" dir="auto">' + esc(data.title) + "</div>" : "") + '<div class="cols">' + list(data.quotes).map(quote).join("") + "</div></div>");
})()`

export const OUTLINE_CARD_SCRIPT = String.raw`(() => {${CARD_BASE}
  const colors = ["--blue", "--purple", "--pink", "--orange", "--green", "--yellow"];
  const css = [
    ".card::before{content:'';position:absolute;inset:0 0 auto 0;height:4px;background:linear-gradient(90deg,var(--yellow),var(--orange),var(--pink),var(--purple),var(--blue))}",
    ".title{font:650 22px/1.2 Georgia,'Times New Roman',serif}",
    ".alt{color:var(--muted);font-style:italic}",
    ".chip{display:inline-block;padding:2px 9px;border-radius:99px;font-size:12px;font-weight:600;background:color-mix(in srgb,var(--chip,var(--purple)) 22%,transparent);color:color-mix(in srgb,var(--chip,var(--purple)) 70%,var(--text))}",
    ".summary{font:italic 15px/1.5 Georgia,'Times New Roman',serif;border-left:3px solid var(--orange);padding-left:12px}",
    ".points{display:grid;gap:12px}",
    ".point{display:grid;grid-template-columns:30px minmax(0,1fr);gap:12px}",
    ".n{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;font-weight:700;color:var(--bg);background:var(--chip)}",
    ".heading{font-weight:650;font-size:15px;display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center}",
    "ul{margin:6px 0 0;padding-left:18px;color:var(--muted)}",
    "li{margin:2px 0}",
    ".closing{border-radius:10px;padding:10px 12px;background:color-mix(in srgb,var(--green) 16%,transparent);border:1px solid color-mix(in srgb,var(--green) 40%,transparent)}",
  ].join("");
  // The same line in a second language, when the outline is bilingual.
  const alt = (value) => (value ? '<div class="alt" dir="auto">' + esc(value) + "</div>" : "");

  define("outline-card", css, (data) =>
    '<div class="card">' +
    '<div><div class="eyebrow">' + esc(data.label ?? t("outline")) + '</div><div class="title" dir="auto">' + esc(data.title) + "</div>" + alt(data.titleAlt) + "</div>" +
    (data.reference ? '<div><span class="chip">' + esc(data.reference) + "</span></div>" : "") +
    (data.summary ? '<div class="summary" dir="auto">' + esc(data.summary) + alt(data.summaryAlt) + "</div>" : "") +
    '<div class="points">' + list(data.points).map((point, index) =>
      '<div class="point" style="--chip:var(' + colors[index % colors.length] + ')"><div class="n">' + (index + 1) + '</div><div><div class="heading"><span dir="auto">' + esc(point.heading) + "</span>" + (point.tag ? '<span class="chip">' + esc(point.tag) + "</span>" : "") + "</div>" +
      (list(point.notes).length ? "<ul>" + list(point.notes).map((note) => '<li dir="auto">' + esc(note) + "</li>").join("") + "</ul>" : "") + "</div></div>").join("") + "</div>" +
    (data.closing ? '<div class="closing"><div class="eyebrow">' + esc(data.closingLabel ?? t("closing")) + '</div><div dir="auto">' + esc(data.closing) + "</div>" + alt(data.closingAlt) + "</div>" : "") +
    "</div>");
})()`
