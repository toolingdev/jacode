// Fork feature: the look of charts in a visual. Once the chart library is in the page, this script makes every
// chart drawn there follow the look the user picked: its colors, type, grid, backdrop and a few effects, whatever
// colors the chart's own code asked for.
//
// The script runs inside the visual's page, so it is kept as text here. It reads the look from the page's root
// element.

export const CHART_STYLE_SCRIPT = String.raw`(() => {
  const C = window.Chart;
  if (!C) return;
  const root = document.documentElement;
  const v = (name, fallback) => getComputedStyle(root).getPropertyValue(name).trim() || fallback;
  const mono = "ui-monospace,Menlo,Consolas,monospace";
  const text = v("--text", "#e6e6e6");
  const muted = v("--muted", "#9aa0aa");
  const border = v("--border", "rgba(128,128,128,.3)");
  const looks = {
    clean: { text: muted, grid: border, palette: [v("--accent", "#7c8cff"), v("--green", "#4cc38a"), v("--orange", "#f5a623"), v("--pink", "#e06bd0"), v("--blue", "#38b6ff"), v("--yellow", "#f4e04d")], radius: 6 },
    pixel: { font: mono, text: "#f8f8f2", grid: "#3b4270", palette: ["#ff5fa2", "#5fd7ff", "#ffd866", "#a6e22e", "#ae81ff", "#fd971f"], bg: "#1b1f3b", radius: 0, outline: "#f8f8f2", outlineWidth: 2, stepped: true, point: "rect" },
    neon: { text: "#8be9fd", grid: "rgba(0,240,255,.14)", palette: ["#00f0ff", "#ff2bd6", "#fff200", "#39ff14", "#ff6b00", "#b388ff"], bg: "#0b0b16", glow: 14, hollow: true, outlineWidth: 2, radius: 3 },
    block3d: { text: muted, grid: border, palette: ["#5b8def", "#f2994a", "#27ae60", "#eb5757", "#9b51e0", "#f2c94c"], radius: 0, depth: 9 },
    terminal: { font: mono, text: "#3dff7a", grid: "#145c30", palette: ["#3dff7a", "#1fae56", "#9dffc0", "#0f7a3a"], bg: "#03130a", radius: 0, dash: [2, 4] },
    pastel: { text: muted, grid: "transparent", palette: ["#a5d8ff", "#ffc9c9", "#b2f2bb", "#ffec99", "#d0bfff", "#ffd8a8"], radius: 12 },
    blueprint: { font: mono, text: "#dbeafe", grid: "rgba(219,234,254,.25)", palette: ["#ffffff", "#bfdbfe", "#93c5fd", "#60a5fa"], bg: "#1e3a8a", hollow: true, outlineWidth: 1.5, radius: 0, dash: [4, 3] },
    newspaper: { font: "Georgia,'Times New Roman',serif", text: "#1a1a1a", grid: "#c9c2b3", palette: ["#1a1a1a", "#6b6b6b", "#a3a3a3", "#3f3f3f"], bg: "#f4efe4", radius: 0, hatch: true, outline: "#1a1a1a", outlineWidth: 1 },
    sunset: { text: muted, grid: "transparent", pairs: [["#ff512f", "#f09819"], ["#8e2de2", "#4a00e0"], ["#11998e", "#38ef7d"], ["#fc466b", "#3f5efb"]], palette: ["#ff512f", "#8e2de2", "#11998e", "#fc466b"], radius: 10 },
    sketch: { font: "'Comic Sans MS','Marker Felt','Chalkboard SE',cursive", text: text, grid: "transparent", palette: ["#ff6b6b", "#4dabf7", "#ffd43b", "#69db7c", "#da77f2"], outline: text, outlineWidth: 2.5, dash: [7, 3], radius: 5, soft: true, tension: 0.45 },
  };
  const look = looks[root.dataset.chartStyle] ?? looks.clean;
  const round = ["pie", "doughnut", "polarArea"];

  const hatch = (color, index) => {
    const tile = document.createElement("canvas");
    tile.width = tile.height = 8;
    const pen = tile.getContext("2d");
    pen.strokeStyle = color;
    pen.lineWidth = 1.4;
    pen.beginPath();
    if (index % 3 === 0) { pen.moveTo(0, 8); pen.lineTo(8, 0); }
    else if (index % 3 === 1) { pen.moveTo(0, 4); pen.lineTo(8, 4); }
    else { pen.moveTo(0, 0); pen.lineTo(8, 8); pen.moveTo(0, 8); pen.lineTo(8, 0); }
    pen.stroke();
    return pen.createPattern(tile, "repeat");
  };

  const fillOf = (chart, index) => {
    const color = look.palette[index % look.palette.length];
    if (look.hatch) return hatch(color, index);
    if (look.hollow) return color + "2e";
    if (look.soft) return color + "99";
    if (look.pairs) {
      const pair = look.pairs[index % look.pairs.length];
      return (context) => {
        const area = context.chart.chartArea;
        if (!area) return pair[0];
        const gradient = context.chart.ctx.createLinearGradient(0, area.bottom, 0, area.top);
        gradient.addColorStop(0, pair[0]);
        gradient.addColorStop(1, pair[1]);
        return gradient;
      };
    }
    return color;
  };

  if (look.font) C.defaults.font.family = look.font;
  C.defaults.color = look.text;
  C.defaults.borderColor = look.grid;

  C.register({
    id: "jacode-look",
    beforeUpdate(chart) {
      const kind = chart.config.type;
      chart.data.datasets.forEach((dataset, index) => {
        const type = dataset.type || kind;
        const color = look.palette[index % look.palette.length];
        if (round.includes(type)) {
          // Slices take plain fills: a slice cannot carry a gradient that follows the chart's height.
          dataset.backgroundColor = (dataset.data || []).map((_, slice) => {
            const tone = look.palette[slice % look.palette.length];
            return look.hatch ? hatch(tone, slice) : look.hollow ? tone + "66" : look.soft ? tone + "cc" : tone;
          });
          dataset.borderColor = look.outline || look.bg || "transparent";
          dataset.borderWidth = look.outlineWidth ?? 2;
          return;
        }
        const line = type === "line" || type === "radar";
        dataset.backgroundColor = line && !dataset.fill ? color : fillOf(chart, index);
        dataset.borderColor = line ? color : look.outline || (look.hollow ? color : dataset.borderColor && look.outlineWidth ? color : color);
        dataset.borderWidth = line ? Math.max(look.outlineWidth ?? 2, 2) : (look.outlineWidth ?? 0);
        dataset.borderRadius = look.radius;
        dataset.borderDash = look.dash && (line || look.hollow || look.soft) ? look.dash : [];
        if (line) {
          dataset.stepped = look.stepped ? true : false;
          dataset.tension = look.stepped ? 0 : (look.tension ?? 0.3);
          dataset.pointStyle = look.point || "circle";
          dataset.pointRadius = look.point ? 4 : 3;
          dataset.pointBackgroundColor = color;
        }
      });
      // Set field by field: the options are live views that must not be copied.
      Object.keys(chart.options.scales || {}).forEach((key) => {
        const scale = chart.options.scales[key];
        scale.grid.color = look.grid;
        scale.ticks.color = look.text;
        scale.border.color = look.grid;
        scale.border.dash = look.dash || [];
      });
      const pad = (look.bg ? 12 : 2) + (look.depth || 0);
      chart.options.layout.padding = { top: pad, right: pad, bottom: look.bg ? 10 : 2, left: look.bg ? 10 : 2 };
    },
    beforeDraw(chart) {
      if (!look.bg) return;
      const pen = chart.ctx;
      pen.save();
      pen.fillStyle = look.bg;
      pen.beginPath();
      pen.roundRect(0, 0, chart.width, chart.height, look.radius === 0 ? 0 : 10);
      pen.fill();
      pen.restore();
    },
    beforeDatasetDraw(chart, args) {
      if (!look.glow) return;
      chart.ctx.save();
      chart.ctx.shadowColor = look.palette[args.index % look.palette.length];
      chart.ctx.shadowBlur = look.glow;
    },
    afterDatasetDraw(chart, args) {
      if (look.glow) chart.ctx.restore();
      if (!look.depth || (args.meta.type !== "bar")) return;
      const pen = chart.ctx;
      const depth = look.depth;
      const color = look.palette[args.index % look.palette.length];
      args.meta.data.forEach((bar) => {
        const box = bar.getProps(["x", "y", "base", "width"], true);
        const left = box.x - box.width / 2;
        const right = box.x + box.width / 2;
        const top = Math.min(box.y, box.base);
        const bottom = Math.max(box.y, box.base);
        const face = (points, shade) => {
          pen.beginPath();
          points.forEach((point, at) => (at ? pen.lineTo(point[0], point[1]) : pen.moveTo(point[0], point[1])));
          pen.closePath();
          pen.fillStyle = color;
          pen.fill();
          pen.fillStyle = shade;
          pen.fill();
        };
        pen.save();
        face([[left, top], [left + depth, top - depth], [right + depth, top - depth], [right, top]], "rgba(255,255,255,.28)");
        face([[right, top], [right + depth, top - depth], [right + depth, bottom - depth], [right, bottom]], "rgba(0,0,0,.3)");
        pen.restore();
      });
    },
  });
})()`
