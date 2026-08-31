// Gráficos do painel, em SVG puro.
//
// Sem biblioteca: são três formas simples e o custo de uma dependência de
// gráficos não se paga aqui. Tudo desenha em um viewBox fixo e estica por CSS;
// `vector-effect="non-scaling-stroke"` mantém a espessura da linha constante
// mesmo com a escala distorcida, que é o que quebra SVG esticado.

import { money, money0, monthLabel, signClass, esc } from "./util.js?v=90a602f587";

const UP = "#00cc00";
const DOWN = "#cc0000";
const GRID = "#1e1e1e";

/** Total acumulado ao fim da série -- o mesmo número que a curva termina. */
export function equityFinal(monthly) {
  return monthly.reduce((a, m) => a + (Number(m.pnl) || 0), 0);
}

/** Curva de capital acumulado. Mostra a trajetória, que as barras mensais não contam. */
export function equityCurve(monthly, { height } = {}) {
  if (!monthly.length) return "";
  // Com um ou dois pontos, a altura cheia deixa um ponto perdido no vazio.
  height ??= monthly.length < 3 ? 90 : 190;

  let running = 0;
  const points = monthly.map((m) => {
    running += Number(m.pnl) || 0;
    return { month: m.month, value: running };
  });

  const W = 1000;
  const H = 240;
  const PAD = 12;
  const values = points.map((p) => p.value);
  const hi = Math.max(0, ...values);
  const lo = Math.min(0, ...values);
  const span = hi - lo || 1;

  const x = (i) => points.length === 1
    ? W / 2
    : PAD + (i * (W - PAD * 2)) / (points.length - 1);
  const y = (v) => PAD + ((hi - v) / span) * (H - PAD * 2);

  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
  const zeroY = y(0).toFixed(1);
  const area = points.length === 1
    ? ""
    : `${line}L${x(points.length - 1).toFixed(1)},${zeroY}L${x(0).toFixed(1)},${zeroY}Z`;

  const last = points[points.length - 1];
  const positive = last.value >= 0;
  const color = positive ? UP : DOWN;
  const id = `eq${Math.random().toString(36).slice(2, 8)}`;

  const dots = points.map((p, i) =>
    `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3"
       fill="${p.value >= 0 ? UP : DOWN}" vector-effect="non-scaling-stroke">
       <title>${esc(monthLabel(p.month))}: ${money(p.value)}</title>
     </circle>`).join("");

  const ticks = points.map((p) =>
    `<span class="tick" style="flex:1 1 0;text-align:center">${esc(monthLabel(p.month))}</span>`).join("");

  return `
    <div>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"
           style="width:100%;height:${height}px;display:block;overflow:visible">
        <defs>
          <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${color}" stop-opacity="0.28"/>
            <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <line x1="0" y1="${zeroY}" x2="${W}" y2="${zeroY}"
              stroke="${GRID}" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>
        ${area ? `<path d="${area}" fill="url(#${id})"/>` : ""}
        <path d="${line}" fill="none" stroke="${color}" stroke-width="2"
              vector-effect="non-scaling-stroke"
              style="filter:drop-shadow(0 0 6px ${color}88)"/>
        ${dots}
      </svg>
      <div style="display:flex;margin-top:6px">${ticks}</div>
    </div>`;
}

/** Anel de progresso. `value` nulo vira traço: melhor vazio do que zero inventado. */
function ring(label, value, max, color, suffix = "%") {
  const R = 26;
  const CIRC = 2 * Math.PI * R;
  const known = value != null && Number.isFinite(value);
  const filled = known ? Math.min(1, Math.max(0, Math.abs(value) / max)) : 0;
  const dash = filled * CIRC;

  return `
    <div style="display:flex;flex-direction:column;align-items:center;gap:6px">
      <svg width="70" height="70" style="overflow:visible">
        <circle cx="35" cy="35" r="${R}" fill="none" stroke="${GRID}" stroke-width="5"/>
        ${known ? `<circle cx="35" cy="35" r="${R}" fill="none" stroke="${color}" stroke-width="5"
            stroke-dasharray="${dash.toFixed(1)} ${(CIRC - dash).toFixed(1)}"
            transform="rotate(-90 35 35)"
            style="filter:drop-shadow(0 0 5px ${color}99)"/>` : ""}
        <text x="35" y="39" text-anchor="middle" fill="#e0e0e0"
              font-size="11" font-weight="700" font-family="Roboto Mono, monospace">
          ${known ? `${Math.round(value)}${suffix}` : "—"}
        </text>
      </svg>
      <span style="font-size:9px;color:#555;letter-spacing:.15em;text-transform:uppercase">${esc(label)}</span>
    </div>`;
}

/**
 * Três indicadores do que essa operação realmente é: quantas contas devolvem
 * dinheiro, quanto o hedge consome e o retorno sobre o gasto em challenges.
 */
export function gauges({ paidRate, hedgeDrag, roi }) {
  return `
    <div style="display:flex;align-items:center;justify-content:space-around;padding:10px 4px;gap:8px">
      ${ring("paid", paidRate, 100, "#e0e0e0")}
      ${ring("hedge drag", hedgeDrag, 100, "#ccaa00")}
      ${ring("roi", roi, 200, roi != null && roi < 0 ? DOWN : UP)}
    </div>`;
}

/** Barras mensais, com o custo como sombra atrás do resultado. */
export function monthlyBars(monthly) {
  if (!monthly.length) return "";
  const peak = Math.max(1, ...monthly.map((m) => Math.abs(Number(m.pnl))));

  return `<div class="bars">${monthly.map((m) => {
    const pnl = Number(m.pnl);
    const h = Math.max(2, Math.round((Math.abs(pnl) / peak) * 120));
    return `<div class="col" title="${esc(monthLabel(m.month))} · ${money(pnl)} · ${m.accounts} accounts">
      <span class="val ${signClass(pnl)}">${money0(pnl)}</span>
      <div class="bar ${pnl < 0 ? "neg" : ""}" style="height:${h}px"></div>
      <span class="tick">${esc(monthLabel(m.month))}</span>
    </div>`;
  }).join("")}</div>`;
}

/** Distribuição por mesa: onde o dinheiro foi feito e perdido. */
export function firmBreakdown(journal) {
  const byFirm = new Map();
  for (const c of journal) {
    const key = c.firm || "—";
    const e = byFirm.get(key) ?? { firm: key, pnl: 0, n: 0 };
    e.pnl += Number(c.total_pnl) || 0;
    e.n += 1;
    byFirm.set(key, e);
  }
  const rows = [...byFirm.values()].sort((a, b) => b.pnl - a.pnl);
  if (!rows.length) return "";
  const peak = Math.max(1, ...rows.map((r) => Math.abs(r.pnl)));

  return `<div style="display:flex;flex-direction:column;gap:8px;padding:2px 0">
    ${rows.map((r) => {
      const w = Math.max(1, (Math.abs(r.pnl) / peak) * 100);
      const up = r.pnl >= 0;
      return `<div>
        <div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:3px">
          <span style="color:#bbb">${esc(r.firm)} <span class="dim">${r.n}</span></span>
          <span class="${signClass(r.pnl)}">${money0(r.pnl)}</span>
        </div>
        <div style="height:5px;background:${GRID}">
          <div style="height:100%;width:${w.toFixed(1)}%;background:${up ? UP : DOWN};
                      opacity:.8;box-shadow:0 0 8px ${up ? UP : DOWN}66"></div>
        </div>
      </div>`;
    }).join("")}
  </div>`;
}
