// Gráficos do painel, em SVG puro.
//
// Sem biblioteca: são três formas simples e o custo de uma dependência de
// gráficos não se paga aqui. Tudo desenha em um viewBox fixo e estica por CSS;
// `vector-effect="non-scaling-stroke"` mantém a espessura da linha constante
// mesmo com a escala distorcida, que é o que quebra SVG esticado.

import { money, money0, monthLabel, signClass, esc } from "./util.js?v=4c68d01ee0";

// Cores por token, nunca literais: o painel tem tema claro e escuro, e um hex
// cravado aqui fica errado em um dos dois. Perda usa o acento da marca -- num
// sistema em que o acento JA e vermelho, um segundo vermelho so briga.
const UP = "var(--gain)";
const DOWN = "var(--loss)";
const GRID = "var(--color-divider)";
const RULE = "var(--color-neutral-300)";
const INK = "var(--color-text)";
const SOFT = "var(--color-neutral-600)";
const MUTE = "var(--color-neutral-700)";

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
        <line x1="0" y1="${zeroY}" x2="${W}" y2="${zeroY}"
              stroke="var(--color-neutral-400)" stroke-dasharray="6 5"
              vector-effect="non-scaling-stroke"/>
        ${area ? `<path d="${area}" fill="${RULE}" opacity="0.55"/>` : ""}
        <path d="${line}" fill="none" stroke="${INK}" stroke-width="2.5"
              vector-effect="non-scaling-stroke"/>
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
        <circle cx="35" cy="35" r="${R}" fill="none" stroke="${RULE}" stroke-width="5"/>
        ${known ? `<circle cx="35" cy="35" r="${R}" fill="none" stroke="${color}" stroke-width="5"
            stroke-dasharray="${dash.toFixed(1)} ${(CIRC - dash).toFixed(1)}"
            transform="rotate(-90 35 35)"/>` : ""}
        <text x="35" y="40" text-anchor="middle" fill="${INK}"
              font-size="13" font-weight="800" font-family="Archivo, system-ui, sans-serif">
          ${known ? `${Math.round(value)}${suffix}` : "—"}
        </text>
      </svg>
      <span style="font-size:10px;color:${MUTE};letter-spacing:.1em;text-transform:uppercase">${esc(label)}</span>
    </div>`;
}

/**
 * Três indicadores do que essa operação realmente é: quantas contas devolvem
 * dinheiro, quanto o hedge consome e o retorno sobre o gasto em challenges.
 */
export function gauges({ paidRate, hedgeDrag, roi }) {
  return `
    <div style="display:flex;align-items:center;justify-content:space-around;padding:10px 4px;gap:8px">
      ${ring("paid", paidRate, 100, INK)}
      ${ring("hedge drag", hedgeDrag, 100, "var(--color-accent-400)")}
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

  return `<div style="display:flex;flex-direction:column;gap:16px">
    ${rows.map((r) => {
      const w = Math.max(1, (Math.abs(r.pnl) / peak) * 100);
      const up = r.pnl >= 0;
      return `<div>
        <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:12px">
          <span>${esc(r.firm)} <span style="color:${SOFT}">\u00b7 ${r.n}</span></span>
          <span class="n ${signClass(r.pnl)}" style="font-family:var(--font-heading);
                font-weight:800;font-size:16px">${money0(r.pnl)}</span>
        </div>
        <div style="height:6px;background:${RULE};margin-top:6px">
          <div style="height:100%;width:${w.toFixed(1)}%;background:${up ? UP : DOWN}"></div>
        </div>
      </div>`;
    }).join("")}
  </div>`;
}

/** Barra de progresso fina, com marca de limite. `pct` já vem 0..100. */
function meter(pct, color, { warnAt = null } = {}) {
  const w = Math.max(0, Math.min(100, pct));
  return `<div style="height:6px;background:${RULE};position:relative;overflow:hidden">
    <div style="height:100%;width:${w.toFixed(1)}%;background:${color}"></div>
    ${warnAt != null ? `<div style="position:absolute;top:0;bottom:0;left:${
      Math.min(100, warnAt)}%;width:1px;background:var(--color-neutral-500)"></div>` : ""}
  </div>`;
}

/**
 * Onde cada conta prop está contra as regras da mesa, e o que digitar hoje.
 *
 * Um cartão por conta, e dentro dele a ordem da pergunta real: quanto já fez,
 * quanto ainda pode perder, e -- em tamanho de leitura rápida -- o
 * multiplicador que vai para o Receiver antes da sessão. O resto do cartão
 * existe para justificar esse número.
 *
 * O saldo não vem da plataforma: é `tamanho da conta + P&L acumulado`, que é a
 * mesma base que a mesa usa. Conta sem plano escolhido aparece sem as barras,
 * porque sem alvo e drawdown não há o que medir.
 */
export function accountProgress(rows) {
  if (!rows.length) return "";
  return `<div class="accts">${rows.map(accountCard).join("")}</div>`;
}

function accountCard(a) {
  const pnl = Number(a.pnl) || 0;
  const size = a.account_size ? money0(a.account_size) : "";
  const plan = [a.plan_name, size].filter(Boolean).join(" ") || "no plan";

  const head = `
    <div style="display:flex;align-items:baseline;gap:10px;
                border-bottom:2px solid ${GRID};padding-bottom:12px">
      <span style="font-family:var(--font-heading);font-weight:800;font-size:24px;
            letter-spacing:-.01em" class="${a.blown ? "blown" : ""}">${esc(a.short_id)}</span>
      <span style="font-size:11px;color:${MUTE}">${esc(plan)}</span>
      <span class="n ${signClass(pnl)}" style="margin-left:auto;font-family:var(--font-heading);
            font-weight:800;font-size:24px">${money0(pnl)}</span>
    </div>`;

  if (a.profit_target == null && a.max_drawdown == null) {
    return `<div class="acct">
      ${head}
      <div style="margin-top:16px;font-size:12px;color:${SOFT}">
        no plan set — register the model in Setup, otherwise there is nothing to measure
      </div>
    </div>`;
  }

  const targetPct = Number(a.target_pct) || 0;
  const room = Number(a.drawdown_room) || 0;
  const dd = Number(a.max_drawdown) || 1;
  // Folga em relação ao drawdown cheio: 100% = intocado, 0% = estourou.
  const roomPct = (room / dd) * 100;
  const roomColor = roomPct <= 25 ? DOWN : roomPct <= 50 ? "var(--color-accent-400)" : MUTE;

  // Conta funded nao tem alvo: ela ja passou, e o que existe dali em diante e
  // lucro para sacar. Uma barra de progresso sem escala mostrando 0% e
  // "target reached" ao mesmo tempo -- que era o que aparecia -- nao diz nada.
  const funded = a.phase === "FUNDED";

  const left = funded
    ? `<div>
        <div style="font-size:11px;color:${MUTE}">PROFIT</div>
        <div class="n ${signClass(pnl)}" style="font-family:var(--font-heading);
             font-weight:800;font-size:22px;line-height:1;margin-top:6px">${money0(pnl)}</div>
        <div class="n" style="font-size:11px;color:${SOFT};margin-top:5px">
          no target — this is withdrawable profit
        </div>
      </div>`
    : `<div>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:${MUTE}">
          <span>TARGET ${a.profit_target == null ? "—" : money0(a.profit_target)}</span>
          <span class="n" style="color:${INK};font-weight:600">${targetPct.toFixed(0)}%</span>
        </div>
        ${meter(targetPct, targetPct >= 100 ? UP : INK)}
        <div class="n" style="font-size:11px;color:${SOFT};margin-top:5px">
          ${Number(a.target_left) <= 0 ? "target reached" : `${money0(a.target_left)} to go`}
        </div>
      </div>`;

  const meters = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:16px">
      ${left}
      <div>
        <div style="display:flex;justify-content:space-between;font-size:11px;color:${MUTE}">
          <span>DD ROOM</span>
          <span class="n" style="color:${roomPct <= 25 ? DOWN : INK};font-weight:600">${money0(room)}</span>
        </div>
        ${meter(roomPct, roomColor)}
        <div class="n" style="font-size:11px;color:${SOFT};margin-top:5px">
          floor ${money0(a.drawdown_floor)} · ${esc(a.drawdown_type || "—")}
        </div>
      </div>
    </div>`;

  return `<div class="acct">
    ${head}
    ${meters}
    ${todayBlock(a)}
    ${daysLine(a)}
  </div>`;
}

/**
 * O bloco do dia: multiplicador, alvo e o que o hedge deve custar se ele sair.
 *
 * O multiplicador vem da view, que recalcula a cada trade da perna live; o
 * cronograma vem do coletor. Quando o plano foi deduzido pelo saldo o número
 * perde a cor de acento e ganha o aviso -- é o drawdown do plano que o define,
 * e um plano chutado faz o número mentir por inteiro.
 */
function todayBlock(a) {
  const mult = a.hedge_multiplier ?? a.rec_multiplier;
  if (mult == null) return "";

  const guessed = a.plan_source === "inferred";
  const chips = Array.isArray(a.rec_schedule) && a.rec_schedule.length > 1
    ? `<div style="display:flex;gap:6px;margin-top:14px">
        ${a.rec_schedule.map((d) => `<span class="n" style="flex:1;border:1px solid ${GRID};
          padding:5px 8px;font-size:11px">${money0(d.target)}
          <span style="color:${SOFT}">${Number(d.share_pct).toFixed(0)}%</span></span>`).join("")}
      </div>`
    : "";

  return `
    <div style="margin-top:18px;border-top:2px solid ${GRID};padding-top:14px">
      <div style="display:flex;align-items:baseline;gap:12px">
        <span style="font-size:11px;font-weight:600;letter-spacing:.12em;
              color:var(--color-accent)">TODAY</span>
        <span class="n" style="margin-left:auto;font-size:11px;color:${SOFT}">
          spent ${money0(a.spent)} / dd left ${money0(a.drawdown_room)}</span>
      </div>
      <div style="display:flex;align-items:flex-end;gap:24px;margin-top:10px;flex-wrap:wrap">
        <div>
          <div class="n" style="font-family:var(--font-heading);font-weight:800;font-size:44px;
                line-height:.9;letter-spacing:-.02em;color:${
                  guessed ? "var(--color-neutral-500)" : "var(--color-accent)"}">${
            Number(mult).toFixed(2)}</div>
          <div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;
                color:${MUTE};margin-top:6px">multiplier</div>
        </div>
        ${a.phase === "FUNDED" ? `
        <div style="display:flex;gap:20px;padding-bottom:6px">
          <div>
            <div class="n" style="font-family:var(--font-heading);font-weight:800;
                  font-size:18px;color:${DOWN}">-${money0(Number(mult) * 1000)}</div>
            <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;
                  color:${MUTE};margin-top:3px">hedge per $1,000 taken</div>
          </div>
        </div>` : ""}
        ${a.rec_today_target ? `
        <div style="display:flex;gap:20px;padding-bottom:6px">
          <div>
            <div class="n" style="font-family:var(--font-heading);font-weight:800;font-size:18px">${
              money0(a.rec_today_target)}</div>
            <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;
                  color:${MUTE};margin-top:3px">today target</div>
          </div>
          <div>
            <div class="n" style="font-family:var(--font-heading);font-weight:800;font-size:18px;
                  color:${DOWN}">−${money0(a.rec_hedge_cost)}</div>
            <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;
                  color:${MUTE};margin-top:3px">hedge cost</div>
          </div>
        </div>` : ""}
      </div>
      ${chips}
      ${a.phase === "FUNDED" ? `<div style="margin-top:10px;font-size:11px;
            line-height:1.6;color:${SOFT}">
          A funded account has no daily target, so there is no cost-if-today\u2019s-target-lands
          to show. What the hedge costs here scales with what you take.
        </div>` : ""}
      ${guessed ? `<div class="mult-note" style="margin-top:14px">
        Plan deduced from balance, not chosen. Confirm the model in Setup before
        trusting this number — the drawdown is what sets it.
      </div>` : ""}
    </div>`;
}

/**
 * Dias operados e o melhor dia contra o teto de consistência.
 *
 * O teto só pode ser julgado depois dos dias mínimos: com um dia operado esse
 * dia é 100% do lucro por definição, e apontar "quebrada" aí seria alarme falso
 * todo começo de conta.
 */
function daysLine(a) {
  // Dias minimos e consistencia sao regra de AVALIACAO. Numa conta funded elas
  // nao valem, e mostrar "days 0/3" ali sugere que ha tres dias a cumprir de
  // novo -- que e o oposto do que aconteceu.
  if (a.phase === "FUNDED") return "";
  const bestPct = a.best_day_pct == null ? null : Number(a.best_day_pct);
  const limit = a.consistency_pct == null ? null : Number(a.consistency_pct);
  const daysLeft = a.days_left == null ? null : Number(a.days_left);
  const settled = !daysLeft;
  const over = bestPct != null && limit != null && bestPct > limit;
  const breaks = settled && over;

  return `
    <div style="display:flex;flex-wrap:wrap;gap:18px;margin-top:14px;font-size:11px;color:${MUTE}">
      <span>days <b class="n" style="color:${INK}">${a.days_traded}</b>${
        a.min_trading_days ? `/${a.min_trading_days}` : ""}</span>
      ${limit != null ? `<span>best day <b class="n" style="color:${
        breaks ? DOWN : over ? "var(--loss)" : bestPct == null ? SOFT : INK}">${
        bestPct == null ? "—" : bestPct.toFixed(0) + "%"}</b> / ${limit.toFixed(0)}% max</span>` : ""}
      ${breaks
        ? `<span style="color:${DOWN}">consistency broken</span>`
        : over
          ? `<span style="color:var(--loss)">needs more days to spread</span>`
          : ""}
    </div>`;
}
