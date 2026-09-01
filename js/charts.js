// Gráficos do painel, em SVG puro.
//
// Sem biblioteca: são três formas simples e o custo de uma dependência de
// gráficos não se paga aqui. Tudo desenha em um viewBox fixo e estica por CSS;
// `vector-effect="non-scaling-stroke"` mantém a espessura da linha constante
// mesmo com a escala distorcida, que é o que quebra SVG esticado.

import { money, money0, monthLabel, signClass, esc } from "./util.js?v=87019441bc";

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

/** Barra de progresso fina, com marca de limite. `pct` já vem 0..100. */
function meter(pct, color, { warnAt = null } = {}) {
  const w = Math.max(0, Math.min(100, pct));
  return `<div style="height:5px;background:${GRID};position:relative;overflow:hidden">
    <div style="height:100%;width:${w.toFixed(1)}%;background:${color};opacity:.85;
                box-shadow:0 0 7px ${color}66"></div>
    ${warnAt != null ? `<div style="position:absolute;top:0;bottom:0;left:${
      Math.min(100, warnAt)}%;width:1px;background:#666"></div>` : ""}
  </div>`;
}

/**
 * Onde cada conta prop está contra as regras da mesa.
 *
 * O saldo não vem da plataforma: é `tamanho da conta + P&L acumulado`, que é a
 * mesma base que a mesa usa. Conta sem plano escolhido aparece sem as barras,
 * porque sem alvo e drawdown não há o que medir.
 */
export function accountProgress(rows) {
  if (!rows.length) return "";

  return `<div style="display:flex;flex-direction:column;gap:12px">
    ${rows.map((a) => {
      const pnl = Number(a.pnl) || 0;
      const hasPlan = a.profit_target != null;

      if (!hasPlan) {
        return `<div style="display:flex;justify-content:space-between;align-items:center;
                            font-size:10px;padding-bottom:10px;border-bottom:1px solid ${GRID}">
          <span><strong style="color:#fff;font-size:12px">${esc(a.short_id)}</strong>
            <span class="dim" style="margin-left:8px">no plan set</span></span>
          <span class="${signClass(pnl)}">${money0(pnl)}</span>
        </div>`;
      }

      const targetPct = Number(a.target_pct) || 0;
      const room = Number(a.drawdown_room) || 0;
      const dd = Number(a.max_drawdown) || 1;
      // Folga em relação ao drawdown cheio: 100% = intocado, 0% = estourou.
      const roomPct = (room / dd) * 100;
      const roomColor = roomPct <= 25 ? DOWN : roomPct <= 50 ? "#ccaa00" : UP;
      const bestPct = a.best_day_pct == null ? null : Number(a.best_day_pct);
      const limit = a.consistency_pct == null ? null : Number(a.consistency_pct);
      const daysLeft = a.days_left == null ? null : Number(a.days_left);

      // A consistência só pode ser julgada depois dos dias mínimos: com um dia
      // operado esse dia é 100% do lucro por definição, e apontar "quebrada"
      // aí seria alarme falso todo começo de conta.
      const settled = !daysLeft;
      const breaks = settled && bestPct != null && limit != null && bestPct > limit;
      const overLimit = bestPct != null && limit != null && bestPct > limit;

      return `<div style="padding-bottom:12px;border-bottom:1px solid ${GRID}">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">
          <span>
            <strong style="color:#fff;font-size:13px">${esc(a.short_id)}</strong>
            <span class="dim" style="margin-left:8px">${money0(a.account_size)}</span>
          </span>
          <span class="${signClass(pnl)}" style="font-size:12px;font-weight:700">${money(pnl)}</span>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <div style="display:flex;justify-content:space-between;font-size:9px;margin-bottom:3px">
              <span class="dim">target ${money0(a.profit_target)}</span>
              <span class="${targetPct >= 100 ? "pos" : ""}">${targetPct.toFixed(0)}%</span>
            </div>
            ${meter(targetPct, targetPct >= 100 ? UP : "#5599ff")}
            <div style="font-size:9px;color:#555;margin-top:3px">
              ${Number(a.target_left) <= 0
                ? "target reached"
                : `${money0(a.target_left)} to go`}
            </div>
          </div>

          <div>
            <div style="display:flex;justify-content:space-between;font-size:9px;margin-bottom:3px">
              <span class="dim">dd room</span>
              <span class="${roomPct <= 25 ? "neg" : ""}">${money0(room)}</span>
            </div>
            ${meter(roomPct, roomColor)}
            <div style="font-size:9px;color:#555;margin-top:3px">
              floor ${money0(a.drawdown_floor)} · ${esc(a.drawdown_type)}
            </div>
          </div>
        </div>

        ${a.rec_multiplier != null ? `
        <div style="margin-top:10px;padding:8px 10px;background:#0b0b0b;border:1px solid ${GRID}">
          <div style="display:flex;justify-content:space-between;align-items:baseline;
                      font-size:9px;margin-bottom:6px">
            <span style="color:#5599ff;letter-spacing:.15em;font-weight:700">TODAY</span>
            <span class="dim">spent ${money0(a.spent)} / dd left ${money0(a.drawdown_room)}</span>
          </div>
          <div style="display:flex;gap:18px;flex-wrap:wrap;font-size:10px">
            <span class="dim">multiplier
              <b style="color:#fff;font-size:12px">${Number(a.rec_multiplier).toFixed(3)}</b>
              ${a.raw_multiplier_shown ? "" : `<span style="color:#3a3a3a">
                (${Number(a.spent / a.drawdown_room).toFixed(3)} + buffer)</span>`}</span>
            <span class="dim">target
              <b style="color:#fff">${money0(a.rec_today_target)}</b></span>
            <span class="dim">hedge cost
              <b style="color:${DOWN}">${money0(a.rec_hedge_cost)}</b></span>
          </div>
          ${Array.isArray(a.rec_schedule) && a.rec_schedule.length > 1 ? `
          <div style="font-size:9px;color:#555;margin-top:6px">
            plan: ${a.rec_schedule.map((d) =>
              `${money0(d.target)} <span style="color:#3a3a3a">(${d.share_pct}%)</span>`
            ).join(" · ")}
          </div>` : ""}
        </div>` : ""}

        <div style="display:flex;gap:16px;font-size:9px;margin-top:8px">
          <span class="dim">days
            <b style="color:${daysLeft ? "#ccaa00" : UP}">${a.days_traded}</b>${
              a.min_trading_days ? `<span class="dim">/${a.min_trading_days}</span>` : ""}</span>
          ${limit != null ? `<span class="dim">best day
            <b style="color:${breaks ? DOWN : overLimit ? "#ccaa00" : bestPct == null ? "#555" : UP}">${
              bestPct == null ? "—" : bestPct.toFixed(0) + "%"}</b>
            <span class="dim">/ ${limit.toFixed(0)}% max</span></span>` : ""}
          ${breaks
            ? `<span class="neg">consistency broken</span>`
            : overLimit
              ? `<span style="color:#ccaa00">needs more days to spread</span>`
              : ""}
        </div>
      </div>`;
    }).join("")}
  </div>`;
}
