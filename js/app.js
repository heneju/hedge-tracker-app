// Hedge Tracker -- app web.
//
// Roda igual no PC e no celular: e a mesma pagina, o mesmo Supabase. O PC nao
// serve nada -- o coletor la e headless.
//
// Divisao de escrita: este app so mexe no que e decisao humana (custo, payout,
// status, comentario, classificacao de conta). Execucoes, trades e vinculos sao
// do coletor, e aparecem aqui somente como leitura.

import {
  load, save, supabase, currentUser, signInWithPassword, signInWithEmail,
  changePassword, signOut,
} from "./db.js?v=4605ca5433";
import {
  money, money0, num, signClass, day, stamp, monthLabel, esc,
  STATUS_LABEL, statusLabel, statusOptions, phaseLabel, phasesFor, magicSourcePart,
  accountShort,
} from "./util.js?v=4605ca5433";
import {
  equityCurve, equityFinal, gauges, monthlyBars, firmBreakdown, accountProgress,
} from "./charts.js?v=4605ca5433";
import { cell, locked, wireEditables } from "./editable.js?v=4605ca5433";

const view = document.getElementById("view");
const modal = document.getElementById("modal");

const PAGES = [
  { id: "overview",   label: "Overview" },
  { id: "challenges", label: "Challenges" },
  { id: "unassigned", label: "Unassigned" },
  { id: "config",     label: "Setup" },
  { id: "calc",       label: "Calculator" },
  { id: "issues",     label: "Report" },
];

const state = {
  page: "overview",
  filters: { status: "", firm: "", month: "" },
  // Alimentado sempre que o journal e carregado, para a barra de status nao
  // precisar de uma consulta so dela.
  totals: { pnl: null, challenges: null },
  email: "",
  // Quantos reportes estao abertos. Fica no menu para o problema nao ficar
  // esquecido num canto: quem reportou ve que ainda esta la, e quem mantem ve
  // que tem coisa para olhar.
  openIssues: 0,
  isAdmin: false,
};

// ------------------------------------------------------------------- helpers

function toast(message) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function badge(kind, label) {
  return `<span class="badge ${esc(kind)}">${esc(label)}</span>`;
}

function cash(v) {
  return `<span class="${signClass(v)}">${money(v)}</span>`;
}

async function guard(fn, okMessage) {
  try {
    const result = await fn();
    if (okMessage) toast(okMessage);
    return result;
  } catch (err) {
    toast(`Error: ${err.message}`);
    throw err;
  }
}

function render(html) {
  view.innerHTML = html;
}

// Barra de status do cabecalho. Mostra só o que é verdade: relógio, quem está
// logado e o total já carregado. Sem métrica inventada.
function renderStatus() {
  const el = document.getElementById("status");
  if (!el) return;
  // Deslogado nao tem status a mostrar -- e o relogio redesenha a barra a cada
  // segundo, entao sem esta guarda ela reaparece sozinha na tela de login.
  if (!state.email) {
    el.innerHTML = "";
    return;
  }
  const { pnl, challenges } = state.totals;
  const utc = new Date().toISOString().slice(11, 19);

  el.innerHTML = `
    <span><span class="dot"></span>live</span>
    <span>utc <b>${utc}</b></span>
    ${challenges != null ? `<span>accts <b>${challenges}</b></span>` : ""}
    ${pnl != null ? `<span>pnl <b class="${signClass(pnl)} ${
      Number(pnl) >= 0 ? "glow-green" : "glow-red"}">${money0(pnl)}</b></span>` : ""}
    <span class="dim" title="${esc(state.email)}">${esc(state.email.split("@")[0])}</span>
    <span class="actions">
      <button class="btn ghost icon" id="refresh" title="Reload">↻</button>
      <button class="btn ghost icon" id="logout" title="Sign out">⏻</button>
    </span>`;

  el.querySelector("#refresh").onclick = () => go(state.page);
  el.querySelector("#logout").onclick = async () => {
    await signOut();
    location.reload();
  };
}

function setTotals(journal) {
  state.totals = {
    pnl: journal.reduce((a, c) => a + Number(c.total_pnl || 0), 0),
    challenges: journal.length,
  };
  renderStatus();
}

function empty(message) {
  return `<div class="empty">${esc(message)}</div>`;
}

// -------------------------------------------------------------------- login

function renderLogin() {
  render(`
    <div class="panel" style="max-width:340px;margin:10vh auto">
      <h2>auth<span style="color:var(--ghostest)">v1</span></h2>
      <div class="panel-body">
        <div class="field"><label>Email</label>
          <input id="email" type="email" autocomplete="username" placeholder="voce@exemplo.com">
        </div>
        <div class="field" style="margin-top:10px"><label>Password</label>
          <input id="password" type="password" autocomplete="current-password">
        </div>
        <button class="btn" id="signin" style="margin-top:14px;width:100%">Sign in</button>

        <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--line-soft)">
          <button class="btn ghost" id="magic" style="width:100%">Email me a link instead</button>
          <p class="muted" style="margin:10px 0 0;font-size:9px;letter-spacing:.08em;line-height:1.7">
            The link is single use — some email providers open it before you do,
            and then it is already spent. Password always works.
          </p>
        </div>
      </div>
    </div>`);

  const email = document.getElementById("email");
  const password = document.getElementById("password");
  const signin = document.getElementById("signin");

  const submit = async () => {
    if (!email.value.trim() || !password.value) return toast("Email and password");
    signin.disabled = true;
    try {
      await signInWithPassword(email.value.trim(), password.value);
    } catch (err) {
      toast(`Error: ${err.message}`);
    } finally {
      signin.disabled = false;
    }
  };

  signin.onclick = submit;
  password.onkeydown = (e) => { if (e.key === "Enter") submit(); };
  email.onkeydown = (e) => { if (e.key === "Enter") password.focus(); };

  document.getElementById("magic").onclick = async () => {
    if (!email.value.trim()) return toast("Enter your email");
    try {
      await signInWithEmail(email.value.trim());
      toast("Link sent — check your email");
    } catch (err) {
      toast(`Error: ${err.message}`);
    }
  };

  email.focus();
}

// ----------------------------------------------------------------- overview

async function renderOverview() {
  const [journal, monthly, progress] = await Promise.all([
    load.journal(), load.monthly(), load.progress()]);
  setTotals(journal);

  // Só contas que ainda estão valendo: conta encerrada não tem alvo a perseguir.
  const running = progress.filter((a) =>
    a.challenge_status == null || ["phase1", "phase2", "funded"].includes(a.challenge_status));

  const sum = (f) => journal.reduce((a, c) => a + Number(c[f] || 0), 0);
  const total = sum("total_pnl");
  const noHedge = sum("no_hedge_pnl");
  const hedge = sum("lost_hedging");
  const cost = sum("cost");
  const payouts = sum("funded_payout");
  const open = journal.filter((c) => ["phase1", "phase2", "funded"].includes(c.status));

  // signClass em tudo: zero fica neutro, senao "$0.00" apareceria colorido e
  // sugeriria um resultado que nao existe.
  const cards = [
    ["Total P&L", money(total), signClass(total), `${journal.length} challenges`],
    ["Without hedge", money(noHedge), signClass(noHedge), "costs + payouts"],
    ["Hedge result", money(hedge), signClass(hedge), "the three live columns"],
    ["Costs", money(cost), signClass(cost), "challenges bought"],
    ["Payouts", money(payouts), signClass(payouts), "received from firms"],
    ["Active accounts", String(open.length), open.length ? "bright" : "muted", "phase 1, 2 and funded"],
  ].map(([label, value, cls, sub]) => `
    <div class="card">
      <div class="label">${esc(label)}</div>
      <div class="value ${cls}">${esc(value)}</div>
      <div class="sub">${esc(sub)}</div>
    </div>`).join("");

  // Indicadores só quando há base para eles -- null vira traço no anel.
  //
  // "paid" e não "pass rate": uma conta marcada como failed pode ter pago
  // payout antes de estourar, e paga com frequência. Medir por status diria
  // que quase nada dá certo, o que não é o que os números mostram.
  const paid = journal.filter((c) => Number(c.funded_payout) > 0).length;
  const spent = Math.abs(cost);
  const gross = payouts + spent;

  const stats = {
    paidRate: journal.length ? (paid / journal.length) * 100 : null,
    hedgeDrag: gross ? (Math.abs(hedge) / gross) * 100 : null,
    roi: spent ? (total / spent) * 100 : null,
  };

  const rows = monthly.slice().reverse().map((m) => `
    <tr>
      <td>${esc(monthLabel(m.month))}</td>
      <td class="num">${m.accounts}</td>
      <td class="num">${cash(m.pnl)}</td>
      <td class="num">${cash(m.cost)}</td>
      <td class="num">${cash(m.payouts)}</td>
      <td class="num">${cash(m.hedge_pnl)}</td>
      <td class="num">${cash(m.no_hedge_pnl)}</td>
    </tr>`).join("");

  render(`
    <div class="cards">${cards}</div>

    ${running.length ? `<div class="panel">
      <h2>Live accounts<span class="dim">target · drawdown · rules</span></h2>
      <div class="panel-body">${accountProgress(running)}</div>
    </div>` : ""}

    <div class="grid-2">
      <div class="panel">
        <h2>Equity curve<span class="${signClass(equityFinal(monthly))}">${money0(equityFinal(monthly))}</span></h2>
        <div class="panel-body">
          ${monthly.length ? equityCurve(monthly) : empty("no data yet")}
        </div>
      </div>
      <div class="panel">
        <h2>Gauges<span class="dim">paid / drag / roi</span></h2>
        <div class="panel-body">${gauges(stats)}</div>
      </div>
    </div>

    <div class="grid-2">
      <div class="panel">
        <h2>P&amp;L by month</h2>
        <div class="panel-body">
          ${monthly.length ? monthlyBars(monthly) : empty("no data yet")}
        </div>
      </div>
      <div class="panel">
        <h2>By firm</h2>
        <div class="panel-body">
          ${journal.length ? firmBreakdown(journal) : empty("no data yet")}
        </div>
      </div>
    </div>

    <div class="panel">
      <h2>Monthly close</h2>
      <div class="scroll">
        <table>
          <thead><tr>
            <th>Month</th><th class="num">Accounts</th><th class="num">P&amp;L</th>
            <th class="num">Cost</th><th class="num">Payouts</th>
            <th class="num">Hedge</th><th class="num">No hedge</th>
          </tr></thead>
          <tbody>${rows || `<tr><td colspan="7">${empty("no data")}</td></tr>`}</tbody>
        </table>
      </div>
    </div>`);
}

// --------------------------------------------------------------- challenges

async function renderChallenges() {
  const [journal, firms] = await Promise.all([load.journal(), load.firms()]);
  setTotals(journal);

  const months = [...new Set(journal.filter((c) => c.date_open)
    .map((c) => c.date_open.slice(0, 7)))].sort().reverse();

  const { status, firm, month } = state.filters;
  const rows = journal.filter((c) =>
    (!status || c.status === status) &&
    (!firm || c.firm === firm) &&
    (!month || (c.date_open || "").startsWith(month)));

  const totals = ["cost", "funded_payout", "p1_live", "p2_live", "funded_live",
    "lost_hedging", "total_pnl"].reduce((acc, f) => {
      acc[f] = rows.reduce((a, c) => a + Number(c[f] || 0), 0);
      return acc;
    }, {});

  const options = (list, selected, blank) =>
    `<option value="">${esc(blank)}</option>` +
    list.map((v) => `<option value="${esc(v.value)}" ${v.value === selected ? "selected" : ""}>${esc(v.label)}</option>`).join("");

  // Uma mesa de etapa unica (Tradeify) nunca tera fase 2. Se nenhuma linha em
  // vista usa duas fases, a coluna some em vez de exibir zeros para sempre.
  const showP2 = rows.some((c) => Number(c.eval_phases) === 2);
  const p2 = (html) => (showP2 ? html : "");
  const cols = showP2 ? 15 : 14;

  const firmOpts = [{ value: "", label: "—" }]
    .concat(firms.map((f) => ({ value: f.id, label: f.name })));

  // Um valor de perna live so e editavel quando NAO ha trade por tras dele.
  // Com trades pareadas o numero e medido; sobrescreve-lo seria mentir para si
  // mesmo. As linhas importadas da planilha nao tem trade, entao continuam
  // abertas para correcao.
  const liveCell = (c, field, value, trades) => trades > 0
    ? locked(cash(value), `${trades} trade(s) pareada(s) — valor medido, não editável`)
    : cell(value, { id: c.id, field, type: "number", align: true,
                    format: () => cash(value), title: "importado — clique para corrigir" });

  const cashCell = (c, field, value, entries) => entries > 1
    ? locked(cash(value), `${entries} lançamentos — abra a linha para editar`)
    : cell(value, { id: c.id, field, type: "number", align: true,
                    format: () => cash(value) });

  const body = rows.map((c) => `
    <tr class="clickable" data-id="${c.id}">
      <td><strong class="${c.status === "failed" ? "blown" : "bright"}">${
        esc(c.account_ids || "—")}</strong></td>
      ${cell(c.firm_id, { id: c.id, field: "firm_id", type: "select", options: firmOpts,
                          format: () => esc(c.firm || "—") })}
      <td class="muted">${esc(c.platform || "—")}</td>
      ${cell(c.date_open, { id: c.id, field: "date_open", type: "date",
                            format: () => day(c.date_open) })}
      ${cell(c.status, { id: c.id, field: "status", type: "select",
                         options: statusOptions(c.eval_phases),
                         format: () => badge(c.status, statusLabel(c.status, c.eval_phases)) })}
      ${cell(c.multipliers, { id: c.id, field: "multipliers", type: "text", align: true,
                              format: () => `<span class="muted">${esc(c.multipliers || "—")}</span>`,
                              title: "multiplicador por fase, separado por /" })}
      ${cashCell(c, "cost", c.cost, c.cost_entries)}
      ${liveCell(c, "import_p1_live", c.p1_live, c.p1_trades)}
      ${p2(liveCell(c, "import_p2_live", c.p2_live, c.p2_trades))}
      ${liveCell(c, "import_funded_live", c.funded_live, c.funded_trades)}
      ${cashCell(c, "payout", c.funded_payout, c.payout_entries)}
      <td class="num">${cash(c.lost_hedging)}</td>
      <td class="num"><strong>${cash(c.total_pnl)}</strong></td>
      ${cell(c.comments, { id: c.id, field: "comments", type: "text",
                           format: () => `<span class="muted">${esc(c.comments || "—")}</span>` })}
      <td class="num muted">${c.trade_count || (c.import_source ? "imp." : "0")}</td>
    </tr>`).join("");

  render(`
    <div class="panel">
      <h2>Filters</h2>
      <div class="panel-body row">
        <div class="field"><label>Status</label>
          <select id="f-status">${options(
            Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })),
            status, "All")}</select></div>
        <div class="field"><label>Firm</label>
          <select id="f-firm">${options(
            firms.map((f) => ({ value: f.name, label: f.name })), firm, "All")}</select></div>
        <div class="field"><label>Opened in</label>
          <select id="f-month">${options(
            months.map((m) => ({ value: m, label: monthLabel(m) })), month, "All")}</select></div>
        <div class="field auto"><label>&nbsp;</label>
          <button class="btn" id="new-challenge">New challenge</button></div>
      </div>
    </div>

    <div class="panel">
      <h2>${rows.length} challenges</h2>
      <div class="scroll">
        <table>
          <thead><tr>
            <th>Acct</th><th>Firm</th><th>Platform</th><th>Opened</th><th>Status</th>
            <th class="num">Mult.</th>
            <th class="num">Cost</th><th class="num">Phase 1 live</th>
            ${p2(`<th class="num">Phase 2 live</th>`)}<th class="num">Funded live</th>
            <th class="num">Payout</th><th class="num">Hedge</th>
            <th class="num">Total</th><th>Notes</th><th class="num">Trades</th>
          </tr></thead>
          <tbody>${body || `<tr><td colspan="${cols}">${empty("no challenges match these filters")}</td></tr>`}</tbody>
          <tfoot><tr style="font-weight:640">
            <td colspan="6">Total</td>
            <td class="num">${cash(totals.cost)}</td>
            <td class="num">${cash(totals.p1_live)}</td>
            ${p2(`<td class="num">${cash(totals.p2_live)}</td>`)}
            <td class="num">${cash(totals.funded_live)}</td>
            <td class="num">${cash(totals.funded_payout)}</td>
            <td class="num">${cash(totals.lost_hedging)}</td>
            <td class="num">${cash(totals.total_pnl)}</td>
            <td></td><td></td>
          </tr></tfoot>
        </table>
      </div>
    </div>`);

  wireEditables(view, saveChallengeField);

  for (const [id, key] of [["f-status", "status"], ["f-firm", "firm"], ["f-month", "month"]]) {
    document.getElementById(id).onchange = (e) => {
      state.filters[key] = e.target.value;
      renderChallenges();
    };
  }
  document.getElementById("new-challenge").onclick = () => openChallengeEditor(null, firms);
  view.querySelectorAll("tr.clickable").forEach((tr) => {
    tr.onclick = () => openChallenge(Number(tr.dataset.id), journal, firms);
  });
}

/**
 * Grava uma célula editada da tabela.
 *
 * Cada campo mora num lugar diferente do banco -- custo e payout são
 * lançamentos, o multiplicador é por fase, o resto é do challenge -- então a
 * escrita é despachada por campo em vez de um update genérico.
 */
async function saveChallengeField(field, id, raw) {
  const challengeId = Number(id);
  const number = () => (raw === "" ? null : Number(raw));

  await guard(async () => {
    if (field === "cost" || field === "payout") {
      const kind = field === "cost" ? "cost" : "payout";
      let amount = number() ?? 0;
      // Custo é dinheiro que sai: guardado negativo, como na planilha. Aceita
      // digitar 99 ou -99 e normaliza, para não depender de lembrar o sinal.
      if (kind === "cost" && amount > 0) amount = -amount;
      const existing = await load.cashEventId(challengeId, kind);
      return save.setCashTotal(challengeId, kind, amount, existing);
    }

    if (field === "multipliers") {
      // "0.05 / 0.1 / 0.2" na ordem das fases, como a planilha escreve.
      const parts = String(raw).split("/").map((x) => x.trim()).filter(Boolean);
      const phases = ["P1", "P2", "FUNDED"];
      for (let i = 0; i < phases.length; i += 1) {
        const value = parts[i] === undefined ? null : Number(parts[i]);
        if (parts[i] !== undefined && Number.isNaN(value)) continue;
        await save.phaseByChallenge(challengeId, phases[i], { multiplier: value });
      }
      return null;
    }

    const patch = {};
    if (field === "firm_id") patch.firm_id = raw ? Number(raw) : null;
    else if (field === "date_open") patch.date_open = raw || null;
    else if (field === "comments") patch.comments = raw || null;
    else if (field.startsWith("import_")) patch[field] = number();
    else patch[field] = raw;
    return save.challenge(challengeId, patch);
  }, "Saved");

  renderChallenges();
}

// ------------------------------------------------- detalhe de um challenge

async function openChallenge(id, journal, firms) {
  const c = journal.find((x) => x.id === id);
  if (!c) return;

  const [phases, cashEvents] = await Promise.all([load.phases(id), load.cashEvents(id)]);
  const trades = await load.tradesForPhases(phases.map((p) => p.id));
  const links = await load.linksForTrades(trades.map((t) => t.id));

  const byId = new Map(trades.map((t) => [t.id, t]));
  const pairRows = links.map((l) => {
    const prop = byId.get(l.prop_trade_id);
    const live = byId.get(l.live_trade_id);
    if (!prop || !live) return "";
    const net = Number(prop.net_pnl) + Number(live.net_pnl);
    return `<tr>
      <td>${stamp(prop.entry_ts)}</td>
      <td>${esc(prop.symbol)} <span class="muted">${esc(prop.side)}</span> ${num(prop.qty, 0)}</td>
      <td class="num">${cash(prop.net_pnl)}</td>
      <td>${esc(live.symbol)} <span class="muted">${esc(live.side)}</span> ${num(live.qty, 2)}</td>
      <td class="num">${cash(live.net_pnl)}</td>
      <td class="num"><strong>${cash(net)}</strong></td>
      <td class="num muted">${l.observed_multiplier ?? "—"}</td>
      <td>${badge("closed", l.link_method)}</td>
    </tr>`;
  }).join("");

  const linked = new Set(links.flatMap((l) => [l.prop_trade_id, l.live_trade_id]));
  const soloRows = trades.filter((t) => !linked.has(t.id)).map((t) => `
    <tr>
      <td>${stamp(t.entry_ts)}</td>
      <td>${badge(t.accounts?.kind || "prop", t.accounts?.kind === "live" ? "live" : "prop")}</td>
      <td>${esc(t.symbol)} <span class="muted">${esc(t.side)}</span> ${num(t.qty, 2)}</td>
      <td class="num">${cash(t.net_pnl)}</td>
    </tr>`).join("");

  const phaseRows = phases.map((p) => `
    <tr>
      <td>${esc(phaseLabel(p.phase, c.eval_phases))}</td>
      <td><strong>${esc(accountShort(p.accounts?.login_or_name || p.account_ref))}</strong>
          <span class="dim">${esc(p.accounts?.login_or_name || p.account_ref || "—")}</span></td>
      <td class="muted">${esc(p.accounts?.platform || "—")}</td>
      <td>${p.started_at ? day(p.started_at) : "—"} → ${p.ended_at ? day(p.ended_at) : "aberta"}</td>
      <td>${p.outcome ? badge("closed", p.outcome) : "—"}</td>
    </tr>`).join("");

  const cashRows = cashEvents.map((e) => `
    <tr>
      <td>${day(e.occurred_on)}</td>
      <td>${esc({ cost: "Cost", payout: "Payout", refund: "Refund" }[e.kind] || e.kind)}</td>
      <td class="num">${cash(e.amount)}</td>
      <td class="muted">${esc(e.source)}</td>
      <td><button class="btn ghost" data-del-cash="${e.id}">Remove</button></td>
    </tr>`).join("");

  modal.innerHTML = `
    <header>
      <h1>${esc(c.account_ids || "—")} · ${esc(c.firm || "Challenge")} · ${day(c.date_open)}</h1>
      <span class="spacer"></span>
      ${badge(c.status, STATUS_LABEL[c.status] || c.status)}
      <button class="btn ghost" id="edit-challenge">Edit</button>
      <button class="btn ghost" id="report-challenge">Report</button>
      <button class="btn ghost" id="close-modal">Close</button>
    </header>
    <div style="padding:16px;max-height:74vh;overflow:auto">
      <div class="cards">
        <div class="card"><div class="label">Total</div>
          <div class="value ${signClass(c.total_pnl)}">${money(c.total_pnl)}</div></div>
        <div class="card"><div class="label">Cost</div>
          <div class="value neg">${money(c.cost)}</div></div>
        <div class="card"><div class="label">Payout</div>
          <div class="value pos">${money(c.funded_payout)}</div></div>
        <div class="card"><div class="label">Hedge</div>
          <div class="value ${signClass(c.lost_hedging)}">${money(c.lost_hedging)}</div></div>
      </div>

      <div class="panel"><h2>Phases</h2><div class="scroll"><table>
        <thead><tr><th>Phase</th><th>Account</th><th>Platform</th><th>Period</th><th>Outcome</th></tr></thead>
        <tbody>${phaseRows || `<tr><td colspan="5">${empty("no phases set")}</td></tr>`}</tbody>
      </table></div></div>

      <div class="panel"><h2>Costs &amp; payouts</h2><div class="scroll"><table>
        <thead><tr><th>Date</th><th>Kind</th><th class="num">Amount</th><th>Source</th><th></th></tr></thead>
        <tbody>${cashRows || `<tr><td colspan="5">${empty("nothing recorded")}</td></tr>`}</tbody>
      </table></div>
      <div class="panel-body row">
        <div class="field"><label>Kind</label><select id="cash-kind">
          <option value="cost">Cost</option><option value="payout">Payout</option>
          <option value="refund">Refund</option></select></div>
        <div class="field"><label>Amount</label><input id="cash-amount" type="number" step="0.01" placeholder="-99.00"></div>
        <div class="field"><label>Date</label><input id="cash-date" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
        <div class="field auto"><label>&nbsp;</label><button class="btn" id="add-cash">Add</button></div>
      </div></div>

      <div class="panel"><h2>Paired trades (prop × live)</h2><div class="scroll"><table>
        <thead><tr>
          <th>Entry</th><th>Prop</th><th class="num">Prop P&amp;L</th>
          <th>Live</th><th class="num">Live P&amp;L</th><th class="num">Net</th>
          <th class="num">Mult.</th><th>Link</th>
        </tr></thead>
        <tbody>${pairRows || `<tr><td colspan="8">${empty("no pairs yet")}</td></tr>`}</tbody>
      </table></div></div>

      ${soloRows ? `<div class="panel"><h2>Unpaired trades</h2><div class="scroll"><table>
        <thead><tr><th>Entry</th><th>Leg</th><th>Symbol</th><th class="num">P&amp;L</th></tr></thead>
        <tbody>${soloRows}</tbody></table></div></div>` : ""}
    </div>`;

  modal.showModal();
  modal.querySelector("#close-modal").onclick = () => modal.close();
  modal.querySelector("#edit-challenge").onclick = () => {
    modal.close();
    openChallengeEditor(c, firms);
  };
  // O reporte sai daqui já sabendo qual linha é. Ao fechar, este drill-down
  // volta -- quem reportou não perde o lugar onde estava olhando.
  modal.querySelector("#report-challenge").onclick = () => {
    modal.close();
    openIssueForm({
      area: "challenges",
      targetTable: "challenges",
      targetId: c.id,
      targetLabel: `${c.account_ids || "?"} · ${c.firm || "?"} · ${day(c.date_open)}`,
    }, () => openChallenge(id, journal, firms));
  };
  modal.querySelector("#add-cash").onclick = async () => {
    const amount = Number(modal.querySelector("#cash-amount").value);
    if (!amount) return toast("Enter an amount");
    await guard(() => save.createCashEvent({
      challenge_id: id,
      kind: modal.querySelector("#cash-kind").value,
      amount,
      occurred_on: modal.querySelector("#cash-date").value,
      source: "manual",
    }), "Entry saved");
    modal.close();
    renderChallenges();
  };
  modal.querySelectorAll("[data-del-cash]").forEach((b) => {
    b.onclick = async () => {
      await guard(() => save.deleteCashEvent(Number(b.dataset.delCash)), "Removed");
      modal.close();
      renderChallenges();
    };
  });
}

// ------------------------------------------------- editor de um challenge

async function openChallengeEditor(c, firms) {
  const [stats, plans, discovered] = await Promise.all([
    load.accountStats(), load.plans(), load.discovered()]);
  const isNew = !c;

  const firmOptions = firms.map((f) =>
    `<option value="${f.id}" ${c && c.firm === f.name ? "selected" : ""}>${esc(f.name)}</option>`).join("");

  // Status e fases sao regra da MESA: uma mesa de etapa unica nao pode oferecer
  // "Phase 2", nem no seletor de status nem na lista de contas por fase.
  const firmById = new Map(firms.map((f) => [String(f.id), f]));
  const currentFirm = () => firmById.get(modal.querySelector("#c-firm")?.value ?? "");
  const evalPhasesOf = (firm) => Number(firm?.eval_phases ?? c?.eval_phases ?? 2);

  // Tamanho da conta: escolhido aqui, na compra. Alvo, drawdown, dias mínimos e
  // consistência vêm junto — são regra da mesa, não campo para digitar.
  const plansOf = (firm) => plans.filter((pl) => pl.firm_id === Number(firm?.id));

  const planSelect = (firm, selected) => {
    const list = plansOf(firm);
    if (!list.length) return "";
    // Sem o nome do modelo a escolha seria cega: a FundingPips tem
    // "2 Step Standard $50k" e "2 Step Pro $50k" com regras bem diferentes.
    const named = new Set(list.map((pl) => pl.name)).size > 1;
    return `<option value="">— size —</option>` + list.map((pl) =>
      `<option value="${pl.id}" ${pl.id === selected ? "selected" : ""}>${
        esc(named ? `${pl.name} · ${money0(pl.account_size)}`
                  : money0(pl.account_size))}</option>`).join("");
  };

  const planSummary = (planId) => {
    const pl = plans.find((x) => x.id === Number(planId));
    if (!pl) return `<span class="dim">pick a size to load the firm rules</span>`;
    const bits = [];
    if (pl.profit_target) {
      bits.push(`target <b class="bright">${money0(pl.profit_target)}</b>${
        pl.profit_target_p2 ? ` <span class="dim">then</span> <b class="bright">${
          money0(pl.profit_target_p2)}</b>` : ""}`);
    } else {
      bits.push(`<span class="dim">no profit target</span>`);
    }
    bits.push(`drawdown <b class="bright">${money0(pl.max_drawdown)}</b> <span class="dim">${esc(pl.drawdown_type)}</span>`);
    if (pl.daily_loss_limit) bits.push(`daily <b class="bright">${money0(pl.daily_loss_limit)}</b>`);
    if (pl.profit_split) bits.push(`split <b class="bright">${pl.profit_split}%</b>`);
    if (pl.min_trading_days) bits.push(`min days <b class="bright">${pl.min_trading_days}</b>`);
    if (pl.consistency_pct) bits.push(`consistency <b class="bright">${pl.consistency_pct}%</b>`);
    if (Number(pl.buffer_multiplier)) bits.push(`buffer <b class="bright">+${pl.buffer_multiplier}</b>`);
    if (Number(pl.buffer_cash)) bits.push(`buffer <b class="bright">+${money0(pl.buffer_cash)}</b>`);
    const line = bits.join(" <span style='color:#2a2a2a'>·</span> ");
    return pl.notes
      ? `${line}<div style="color:#555;margin-top:5px">${esc(pl.notes)}</div>`
      : line;
  };

  const statusSelect = (evalPhases, selected) =>
    statusOptions(evalPhases).map((o) =>
      `<option value="${o.value}" ${o.value === selected ? "selected" : ""}>${esc(o.label)}</option>`).join("");

  const phases = c ? await load.phases(c.id) : [];
  const phaseOf = (p) => phases.find((x) => x.phase === p);
  const mine = new Set(phases.map((x) => x.account_id));

  // Só contas prop livres. Uma conta já presa a uma fase -- inclusive a de um
  // challenge estourado -- não pode ser reaproveitada: o resultado dela iria
  // para dois challenges ao mesmo tempo. As deste challenge continuam na lista
  // para não sumirem ao editar.
  const available = stats.filter((a) =>
    a.kind === "prop" && a.is_active && (!a.in_use || mine.has(a.account_id)));

  // Contas que o coletor viu na maquina mas que ninguem classificou ainda.
  // Sao sempre NT8: a perna live e MT5, entao uma conta NT8 nova e prop.
  const registered = new Set(stats.map((a) => `${a.platform}:${a.login_or_name}`));
  const unregistered = discovered.filter((d) =>
    d.platform === "NT8" && !registered.has(`${d.platform}:${d.login_or_name}`));

  // O número inteiro é quase igual entre contas da mesma mesa; o que
  // diferencia são os 4 últimos dígitos e o resultado acumulado.
  const describe = (a) => {
    const bits = [a.short_id, a.platform];
    if (a.trade_count) bits.push(`${money0(a.net_pnl)} · ${a.trade_count}t`);
    else bits.push("no trades");
    return `${bits.join("  ·  ")}   ${a.login_or_name}`;
  };

  const accountOptions = (selected) =>
    `<option value="">— none —</option>` + available.map((a) =>
      `<option value="${a.account_id}" ${a.account_id === selected ? "selected" : ""}>${
        esc(describe(a))}</option>`).join("");

  modal.innerHTML = `
    <header><h1>${isNew ? "New challenge" : "Edit challenge"}</h1>
      <span class="spacer"></span>
      <button class="btn ghost" id="close-modal">Cancel</button></header>
    <div style="padding:16px;max-height:74vh;overflow:auto">
      <div class="row">
        <div class="field"><label>Firm</label><select id="c-firm">
          <option value="">— pick one —</option>${firmOptions}</select></div>
        <div class="field"><label>Opened</label>
          <input id="c-date" type="date" value="${esc(c?.date_open || new Date().toISOString().slice(0, 10))}"></div>
        <div class="field"><label>Status</label><select id="c-status">${
          statusSelect(evalPhasesOf(firms.find((f) => f.name === c?.firm)), c?.status)
        }</select></div>
      </div>
      <div class="row" style="margin-top:12px">
        <div class="field"><label>Account size</label>
          <select id="c-plan">${
            planSelect(firms.find((f) => f.name === c?.firm), c?.plan_id)}</select></div>
        <div class="field"><label>Trader split (%)</label>
          <input id="c-split" type="number" step="0.01" value="${esc(c?.split_pct ?? "")}"></div>
        <!-- Alvo manual so existe para mesa sem plano cadastrado; com plano ele
             seria uma segunda fonte de verdade para o mesmo numero. -->
        <div class="field wide" id="target-field" hidden><label>Profit target</label>
          <input id="c-target" type="number" step="0.01" value="${esc(c?.target ?? "")}"></div>
      </div>
      <div id="plan-summary" style="font-size:10px;color:#888;margin-top:8px;
           padding:7px 10px;background:#0b0b0b;border:1px solid var(--line-soft)">
        ${planSummary(c?.plan_id)}
      </div>
      <div class="field" style="margin-top:12px"><label>Notes</label>
        <textarea id="c-comments" rows="2">${esc(c?.comments || "")}</textarea></div>

      <div class="panel" style="margin-top:16px"><h2>Accounts per phase</h2><div class="panel-body">
        <p class="muted" style="margin-top:0">
          This link is what makes the live result land on the right challenge.
          Accounts already tied to another challenge are not listed.
        </p>
        ${available.length ? "" : (unregistered.length ? `
          <p class="muted" style="margin:0 0 8px;font-size:10px">
            Found on this PC, not registered yet — pick the one you just bought:
          </p>
          <div class="row" style="margin-bottom:12px;gap:6px">
            ${unregistered.map((d) => `
              <button class="btn ghost" data-claim-one="${esc(d.login_or_name)}"
                      title="${esc(d.login_or_name)}">
                + ${esc(accountShort(d.login_or_name))}</button>`).join("")}
          </div>` : `
          <p class="neg" style="margin:0 0 12px;font-size:10px">
            Every prop account on this PC is already tied to a challenge. Free one
            up by editing the challenge that holds it.
          </p>`)}
        <div id="phase-fields"></div>
      </div></div>

      <div class="row" style="margin-top:8px">
        <button class="btn" id="save-challenge">Save</button>
        ${isNew ? "" : `<button class="btn danger" id="delete-challenge">Delete</button>`}
      </div>
    </div>`;

  const renderPhaseFields = () => {
    const evalPhases = evalPhasesOf(currentFirm());
    modal.querySelector("#phase-fields").innerHTML = phasesFor(evalPhases).map((p) => `
      <div class="field" style="margin-bottom:10px">
        <label>${esc(phaseLabel(p, evalPhases))}</label>
        <select data-phase="${p}">${accountOptions(phaseOf(p)?.account_id)}</select>
      </div>`).join("");
  };

  modal.showModal();
  renderPhaseFields();

  // Uma conta por vez: registrar todas de uma vez traria as antigas junto, e
  // quem acabou de comprar uma quer aquela.
  modal.querySelectorAll("[data-claim-one]").forEach((btn) => {
    btn.onclick = async () => {
      const d = unregistered.find((x) => x.login_or_name === btn.dataset.claimOne);
      await guard(() => save.createAccount({
        kind: "prop",
        platform: d.platform,
        login_or_name: d.login_or_name,
        label: d.label,
        terminal_hash: d.terminal_hash,
        terminal_path: d.terminal_path,
        magic_source_part: magicSourcePart(d.platform, d.login_or_name),
      }), `${accountShort(d.login_or_name)} registered`);
      modal.close();
      openChallengeEditor(c, firms);
    };
  });
  modal.querySelector("#close-modal").onclick = () => modal.close();

  const refreshPlanSummary = () => {
    const chosen = modal.querySelector("#c-plan").value;
    modal.querySelector("#plan-summary").innerHTML = planSummary(chosen);
    // Com plano, o alvo vem dele; o campo manual so atrapalharia.
    modal.querySelector("#target-field").hidden = plansOf(currentFirm()).length > 0;
  };
  modal.querySelector("#c-plan").onchange = refreshPlanSummary;
  refreshPlanSummary();

  // Trocar de mesa muda as fases E os tamanhos disponiveis: cada mesa tem os
  // seus. Deixar a lista antiga ofereceria um plano de outra mesa.
  modal.querySelector("#c-firm").onchange = () => {
    const firm = currentFirm();
    const evalPhases = evalPhasesOf(firm);
    const statusEl = modal.querySelector("#c-status");
    statusEl.innerHTML = statusSelect(evalPhases, statusEl.value);
    modal.querySelector("#c-plan").innerHTML = planSelect(firm, null);
    refreshPlanSummary();
    renderPhaseFields();
  };

  modal.querySelector("#save-challenge").onclick = async () => {
    const firmId = modal.querySelector("#c-firm").value;
    const planId = modal.querySelector("#c-plan").value;
    const patch = {
      firm_id: firmId ? Number(firmId) : null,
      plan_id: planId ? Number(planId) : null,
      date_open: modal.querySelector("#c-date").value || null,
      status: modal.querySelector("#c-status").value,
      target: Number(modal.querySelector("#c-target")?.value) || null,
      split_pct: Number(modal.querySelector("#c-split").value) || null,
      comments: modal.querySelector("#c-comments").value || null,
    };

    await guard(async () => {
      const challengeId = isNew
        ? (await save.createChallenge(patch)).id
        : (await save.challenge(c.id, patch), c.id);

      for (const select of modal.querySelectorAll("[data-phase]")) {
        const phase = select.dataset.phase;
        const accountId = select.value ? Number(select.value) : null;
        const existing = phaseOf(phase);
        if (accountId && existing) {
          await save.phase(existing.id, { account_id: accountId });
        } else if (accountId) {
          await save.createPhase({
            challenge_id: challengeId, phase, account_id: accountId, outcome: "active",
          });
        } else if (existing) {
          await save.deletePhase(existing.id);
        }
      }
    }, "Challenge saved");

    modal.close();
    renderChallenges();
  };

  const del = modal.querySelector("#delete-challenge");
  if (del) del.onclick = async () => {
    if (!confirm("Delete this challenge and its entries?")) return;
    await guard(() => save.deleteChallenge(c.id), "Deleted");
    modal.close();
    renderChallenges();
  };
}

// ------------------------------------------------------------ não atribuídos

async function renderUnassigned() {
  const [trades, journal] = await Promise.all([load.unassigned(), load.journal()]);
  const phasesByChallenge = await Promise.all(
    journal.slice(0, 60).map(async (c) => ({ c, phases: await load.phases(c.id) })));
  const options = phasesByChallenge.flatMap(({ c, phases }) =>
    phases.map((p) => ({
      id: p.id,
      label: `${c.firm || "?"} ${day(c.date_open)} · ${PHASE_LABEL[p.phase] || p.phase}`,
    })));

  const rows = trades.map((t) => `
    <tr>
      <td>${stamp(t.exit_ts)}</td>
      <td>${esc(t.symbol)} <span class="muted">${esc(t.side)}</span> ${num(t.qty, 2)}</td>
      <td class="num">${cash(t.net_pnl)}</td>
      <td class="muted">${esc(t.comment || "—")}</td>
      <td class="muted">${esc(t.magic ?? "—")}</td>
      <td>
        <select data-trade="${t.id}">
          <option value="">— pick a phase —</option>
          ${options.map((o) => `<option value="${o.id}">${esc(o.label)}</option>`).join("")}
        </select>
      </td>
    </tr>`).join("");

  render(`
    <div class="panel">
      <h2>${trades.length} live trades with no challenge</h2>
      <div class="panel-body" style="padding-bottom:0">
        <p class="muted" style="margin-top:0">
          The collector only attributes by the Copyator magic. What lands here is a
          manual trade, an old account, or one not registered yet — nothing is guessed.
        </p>
      </div>
      <div class="scroll"><table>
        <thead><tr><th>Exit</th><th>Symbol</th><th class="num">P&amp;L</th>
          <th>Comment</th><th>Magic</th><th style="min-width:230px">Assign to</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6">${empty("nothing pending — all attributed")}</td></tr>`}</tbody>
      </table></div>
    </div>`);

  view.querySelectorAll("[data-trade]").forEach((select) => {
    select.onchange = async () => {
      if (!select.value) return;
      await guard(() => save.assignTrade(Number(select.dataset.trade), Number(select.value)),
        "Trade assigned");
      renderUnassigned();
    };
  });
}

// ------------------------------------------------------------- configuração

async function renderConfig() {
  const [accounts, stats, discovered, firms, plans, progress] = await Promise.all([
    load.accounts(), load.accountStats(), load.discovered(), load.firms(),
    load.plans(), load.progress()]);

  const claimed = new Set(accounts.map((a) => `${a.platform}:${a.login_or_name}`));
  const statOf = new Map(stats.map((x) => [x.account_id, x]));
  // Conta estourada: bateu o piso do drawdown ou o challenge foi marcado como
  // perdido. Risco no nome para não precisar ler número nenhum.
  const blown = new Set(progress.filter((x) => x.blown).map((x) => x.account_id));

  // Com uma mesa só, repetir o nome dela em toda opção é ruído -- o tamanho já
  // identifica. Com duas ou mais, "50,000" seria ambíguo e o nome volta.
  const manyFirms = new Set(plans.map((pl) => pl.firm_id)).size > 1;
  const planLabel = (pl) => manyFirms
    ? `${pl.prop_firms?.name ?? ""} ${money0(pl.account_size)}`
    : money0(pl.account_size);

  const accountRows = accounts.map((a) => {
    const st = statOf.get(a.id);
    return `
    <tr>
      <td>${badge(a.kind, a.kind)}</td>
      <td><strong class="${blown.has(a.id) ? "blown" : "bright"}">${
        esc(accountShort(a.login_or_name))}</strong></td>
      <td>${esc(a.platform)}</td>
      <td class="${blown.has(a.id) ? "blown" : "muted"}"
          ${blown.has(a.id) ? 'title="blown — drawdown floor hit or challenge failed"' : ""}
      >${esc(a.login_or_name)}</td>
      <td class="num">${st && st.trade_count ? cash(st.net_pnl) : `<span class="dim">—</span>`}</td>
      <td class="num muted">${st?.trade_count || "—"}</td>
      <td class="num">${a.cash_value != null
        ? `<span class="bright">${money0(a.cash_value)}</span>`
        : `<span class="dim">—</span>`}</td>
      <td>${a.kind === "prop" ? `<select data-plan="${a.id}">
        <option value="">— size —</option>
        ${plans.map((pl) => `<option value="${pl.id}" ${pl.id === a.plan_id ? "selected" : ""}>${
          esc(planLabel(pl))}</option>`).join("")}
      </select>${a.plan_id && a.plan_source === "inferred"
        ? `<div style="font-size:9px;color:#555;margin-top:2px">from balance</div>` : ""}`
        : `<span class="dim">—</span>`}</td>
      <td class="muted">${esc(a.label || a.terminal_path || "—")}</td>
      <td class="num muted">${a.magic_source_part ?? "—"}</td>
      <td class="row" style="gap:6px">
        <button class="btn ghost" data-toggle="${a.id}" data-kind="${a.kind}">
          Set as ${a.kind === "live" ? "prop" : "live"}</button>
        <button class="btn ghost" data-report-account="${a.id}">Report</button>
      </td>
    </tr>`;
  }).join("");

  const discoveredRows = discovered.map((d) => {
    const key = `${d.platform}:${d.login_or_name}`;
    return `<tr>
      <td>${esc(d.platform)}</td>
      <td>${esc(d.label)}</td>
      <td class="muted">${esc(d.login_or_name)}</td>
      <td>${claimed.has(key)
        ? `<span class="muted">registered</span>`
        : `<div class="row">
             ${d.platform === "MT5"
               ? `<input data-login="${d.id}" placeholder="MT5 login" style="width:130px">`
               : ""}
             <button class="btn ghost" data-claim="${d.id}" data-kind="prop">+ prop</button>
             <button class="btn ghost" data-claim="${d.id}" data-kind="live">+ live</button>
           </div>`}</td>
    </tr>`;
  }).join("");

  render(`
    <div class="panel">
      <h2>Registered accounts</h2>
      <div class="scroll"><table>
        <thead><tr><th>Kind</th><th>ID</th><th>Platform</th><th>Account</th>
          <th class="num">P&amp;L</th><th class="num">Trades</th>
          <th class="num">Balance</th><th>Plan</th>
          <th>Terminal</th><th class="num">magic_source_part</th><th></th></tr></thead>
        <tbody>${accountRows || `<tr><td colspan="11">${empty("no accounts yet — register one below")}</td></tr>`}</tbody>
      </table></div>
    </div>

    <div class="panel">
      <h2>Found on this PC</h2>
      <div class="panel-body" style="padding-bottom:0">
        <p class="muted" style="margin-top:0">
          The collector publishes what it found; you decide which is live and which is prop.
          For MT5 enter the login — the account number only shows with the terminal open.
        </p>
      </div>
      <div class="scroll"><table>
        <thead><tr><th>Platform</th><th>Terminal</th><th>Identifier</th><th>Classify</th></tr></thead>
        <tbody>${discoveredRows || `<tr><td colspan="4">${empty("run: python -m collector.discovery --push")}</td></tr>`}</tbody>
      </table></div>
    </div>

    <div class="panel">
      <h2>Account<span class="dim">${esc(state.email)}</span></h2>
      <div class="panel-body row">
        <div class="field"><label>New password</label>
          <input id="new-password" type="password" autocomplete="new-password"
                 placeholder="at least 8 characters"></div>
        <div class="field auto"><label>&nbsp;</label>
          <button class="btn ghost" id="change-password">Change</button></div>
        <p class="muted" style="margin:6px 0 0;font-size:9px;width:100%">
          The collector on this PC signs in with these credentials too — after
          changing it here, update TRACKER_PASSWORD in the .env.
        </p>
      </div>
    </div>

    <div class="panel">
      <h2>Prop firms</h2>
      <div class="panel-body">
        <div class="row">
          ${firms.map((f) => badge("closed",
            `${f.name} · ${f.platform} · ${Number(f.eval_phases) === 1 ? "1 phase" : "2 phases"}`)
          ).join(" ") || `<span class="muted">none</span>`}
        </div>
        <div class="row" style="margin-top:12px">
          <div class="field"><label>Name</label><input id="firm-name" placeholder="Tradeify"></div>
          <div class="field"><label>Platform</label><select id="firm-platform">
            <option>NT8</option><option>MT5</option><option>Tradovate</option><option>Other</option>
          </select></div>
          <div class="field"><label>Eval phases</label><select id="firm-phases">
            <option value="2">2 — phase 1 + phase 2</option>
            <option value="1">1 — straight to funded</option>
          </select></div>
          <div class="field"><label>Default split (%)</label>
            <input id="firm-split" type="number" step="0.01" placeholder="90"></div>
          <div class="field auto"><label>&nbsp;</label>
            <button class="btn" id="add-firm">Add</button></div>
        </div>
      </div>
    </div>`);

  // O plano define alvo, drawdown e regras -- sem ele o painel não tem o que medir.
  view.querySelectorAll("[data-plan]").forEach((sel) => {
    sel.onchange = async () => {
      await guard(() => save.account(Number(sel.dataset.plan), {
        plan_id: sel.value ? Number(sel.value) : null,
        // Escolha do usuário vence: marcada como manual, o coletor não a
        // sobrepõe mesmo que o saldo sugira outro tamanho.
        plan_source: sel.value ? "manual" : null,
      }), "Plan set");
      renderConfig();
    };
  });

  view.querySelectorAll("[data-report-account]").forEach((b) => {
    b.onclick = () => {
      const a = accounts.find((x) => x.id === Number(b.dataset.reportAccount));
      openIssueForm({
        area: "setup",
        targetTable: "accounts",
        targetId: a.id,
        targetLabel: `${accountShort(a.login_or_name)} · ${a.platform} · ${a.login_or_name}`,
      }, () => renderConfig());
    };
  });

  view.querySelectorAll("[data-toggle]").forEach((b) => {
    b.onclick = async () => {
      await guard(() => save.account(Number(b.dataset.toggle),
        { kind: b.dataset.kind === "live" ? "prop" : "live" }), "Account updated");
      renderConfig();
    };
  });

  view.querySelectorAll("[data-claim]").forEach((b) => {
    b.onclick = async () => {
      const d = discovered.find((x) => x.id === Number(b.dataset.claim));
      const loginInput = view.querySelector(`[data-login="${d.id}"]`);
      const login = d.platform === "MT5" ? (loginInput?.value || "").trim() : d.login_or_name;
      if (d.platform === "MT5" && !login) return toast("Enter the MT5 login");

      await guard(() => save.createAccount({
        kind: b.dataset.kind,
        platform: d.platform,
        login_or_name: login,
        label: d.label,
        terminal_hash: d.terminal_hash,
        terminal_path: d.terminal_path,
        broker_server: d.broker_server,
        magic_source_part: magicSourcePart(d.platform, login),
      }), "Account registered");
      renderConfig();
    };
  });

  document.getElementById("change-password").onclick = async () => {
    const value = document.getElementById("new-password").value;
    if (value.length < 8) return toast("At least 8 characters");
    await guard(() => changePassword(value), "Password changed");
    document.getElementById("new-password").value = "";
  };

  document.getElementById("add-firm").onclick = async () => {
    const name = document.getElementById("firm-name").value.trim();
    if (!name) return toast("Enter a name");
    await guard(() => save.createFirm({
      name,
      platform: document.getElementById("firm-platform").value,
      eval_phases: Number(document.getElementById("firm-phases").value),
      default_split: Number(document.getElementById("firm-split").value) || null,
    }), "Firm added");
    renderConfig();
  };
}

// ------------------------------------------------------- reporte de problema
//
// O que se ganha aqui é a LOCALIZAÇÃO. "O número está errado" sozinho custa uma
// conversa inteira para descobrir qual número; por isso o formulário já chega
// sabendo a tela, a linha e -- quando o usuário aponta -- o campo. Quem for
// consertar abre o reporte e vai direto ao lugar.

// Os campos que fazem sentido reportar em cada tipo de linha. Uma lista curta e
// específica vale mais que uma caixa de texto pedindo "descreva onde": o
// usuário reconhece o nome da coluna que está vendo na tela.
const REPORT_FIELDS = {
  challenges: [
    ["", "the row as a whole"],
    ["cost", "Cost"],
    ["p1_live", "Phase 1 live"],
    ["p2_live", "Phase 2 live"],
    ["funded_live", "Funded live"],
    ["funded_payout", "Payout"],
    ["total_pnl", "Total"],
    ["multipliers", "Multiplier"],
    ["status", "Status"],
    ["date_open", "Opened"],
    ["firm", "Firm"],
    ["trades", "Trades / pairing"],
  ],
  accounts: [
    ["", "the account as a whole"],
    ["cash_value", "Balance"],
    ["plan_id", "Plan / size"],
    ["net_pnl", "P&L"],
    ["kind", "Prop or live"],
    ["login_or_name", "Account number"],
    ["progress", "Target / drawdown"],
  ],
};

const AREAS = [
  ["challenges", "Challenges"],
  ["overview", "Overview"],
  ["unassigned", "Unassigned"],
  ["setup", "Setup"],
  ["calculator", "Calculator"],
  ["collector", "Collector on the PC"],
  ["other", "Something else"],
];

async function refreshIssueCount() {
  try {
    state.openIssues = await load.openIssueCount();
  } catch {
    state.openIssues = 0; // a contagem é enfeite: não pode quebrar a navegação
  }
  renderNav();
}

/**
 * Abre o formulário de reporte já apontando para um lugar do sistema.
 *
 * `context` vem de quem chamou: a linha do challenge, a conta, ou nada quando é
 * a tela toda. `afterClose` existe porque o botão costuma ficar dentro de outro
 * modal -- ao fechar este, quem estava atrás precisa voltar.
 */
function openIssueForm(context = {}, afterClose) {
  const { area = "other", targetTable = null, targetId = null,
          targetLabel = null, field = "" } = context;
  const fields = REPORT_FIELDS[targetTable] || null;

  modal.innerHTML = `
    <header>
      <h1>Report a problem</h1>
      <span class="spacer"></span>
      <button class="btn ghost" id="close-modal">Cancel</button>
    </header>
    <div style="padding:16px;max-width:640px">
      ${targetLabel ? `<div class="panel"><div class="panel-body">
        <div class="dim" style="font-size:9px;letter-spacing:.12em;text-transform:uppercase">Where</div>
        <div class="bright" style="margin-top:4px">${esc(targetLabel)}</div>
      </div></div>` : ""}

      <div class="panel"><div class="panel-body">
        <div class="row">
          <div class="field"><label>Screen</label>
            <select id="i-area">${AREAS.map(([v, l]) =>
              `<option value="${v}" ${v === area ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
          </div>
          ${fields ? `<div class="field"><label>Which part</label>
            <select id="i-field">${fields.map(([v, l]) =>
              `<option value="${esc(v)}" ${v === field ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
          </div>` : ""}
        </div>
        <div class="field" style="margin-top:12px;width:100%">
          <label>What is wrong</label>
          <textarea id="i-note" rows="5" style="width:100%;resize:vertical"
                    placeholder="What you see, and what it should be."></textarea>
        </div>
        <div class="row" style="margin-top:12px">
          <button class="btn" id="i-send">Send</button>
        </div>
      </div></div>
    </div>`;

  modal.showModal();
  const done = () => { modal.close(); if (afterClose) afterClose(); };
  modal.querySelector("#close-modal").onclick = done;

  modal.querySelector("#i-send").onclick = async () => {
    const note = modal.querySelector("#i-note").value.trim();
    if (!note) return toast("Say what is wrong");

    await guard(() => save.createIssue({
      area: modal.querySelector("#i-area").value,
      target_table: targetTable,
      target_id: targetId,
      target_label: targetLabel,
      field: (modal.querySelector("#i-field")?.value || null) || null,
      note,
    }), "Reported");
    await refreshIssueCount();
    done();
  };
  modal.querySelector("#i-note").focus();
}

async function renderIssues() {
  const [issues, isAdmin] = await Promise.all([load.issues(), load.isAdmin()]);
  state.isAdmin = isAdmin;
  const open = issues.filter((i) => i.status === "open");
  const closed = issues.filter((i) => i.status !== "open");

  const areaLabel = (v) => (AREAS.find(([id]) => id === v) || [null, v])[1];
  const fieldLabel = (i) => {
    const list = REPORT_FIELDS[i.target_table] || [];
    return (list.find(([v]) => v === i.field) || [null, i.field])[1];
  };

  const row = (i) => `
    <tr>
      <td class="muted">${stamp(i.created_at)}</td>
      ${isAdmin ? `<td class="muted">${esc((i.reporter || "").split("@")[0])}</td>` : ""}
      <td>${badge(i.status === "open" ? "phase1" : "closed", areaLabel(i.area))}</td>
      <td>
        ${i.target_label ? `<span class="bright">${esc(i.target_label)}</span>`
                         : `<span class="dim">&mdash;</span>`}
        ${i.field ? `<span class="muted"> &middot; ${esc(fieldLabel(i))}</span>` : ""}
      </td>
      <td style="white-space:pre-wrap;min-width:260px">${esc(i.note)}</td>
      <td>
        <button class="btn ghost" data-issue-status="${i.id}"
                data-next="${i.status === "open" ? "resolved" : "open"}">${
          i.status === "open" ? "Resolve" : "Reopen"}</button>
        ${i.reporter === state.email
          ? `<button class="btn ghost" data-issue-del="${i.id}">Delete</button>` : ""}
      </td>
    </tr>`;

  const head = `<tr><th>When</th>${isAdmin ? "<th>Who</th>" : ""}<th>Screen</th>
    <th>Where</th><th>What is wrong</th><th></th></tr>`;
  const cols = isAdmin ? 6 : 5;

  render(`
    <div class="panel">
      <h2>Report a problem</h2>
      <div class="panel-body">
        <p class="muted" style="margin-top:0">
          A number showing wrong, or a field you cannot fix? Report it here.
          To point at one exact row, open it and use the
          <b class="bright">Report</b> button inside &mdash; the report then
          carries that row and field with it.
        </p>
        <button class="btn" id="new-issue">New report</button>
      </div>
    </div>

    <div class="panel">
      <h2>${open.length} open</h2>
      <div class="scroll"><table>
        <thead>${head}</thead>
        <tbody>${open.map(row).join("") ||
          `<tr><td colspan="${cols}">${empty("nothing reported")}</td></tr>`}</tbody>
      </table></div>
    </div>

    ${closed.length ? `<div class="panel">
      <h2>${closed.length} resolved</h2>
      <div class="scroll"><table>
        <thead>${head}</thead>
        <tbody>${closed.map(row).join("")}</tbody>
      </table></div>
    </div>` : ""}`);

  document.getElementById("new-issue").onclick = () =>
    openIssueForm({ area: "other" }, () => go("issues"));

  view.querySelectorAll("[data-issue-status]").forEach((b) => {
    b.onclick = async () => {
      await guard(() => save.setIssueStatus(Number(b.dataset.issueStatus), b.dataset.next),
        b.dataset.next === "resolved" ? "Resolved" : "Reopened");
      await refreshIssueCount();
      renderIssues();
    };
  });

  view.querySelectorAll("[data-issue-del]").forEach((b) => {
    b.onclick = async () => {
      await guard(() => save.deleteIssue(Number(b.dataset.issueDel)), "Deleted");
      await refreshIssueCount();
      renderIssues();
    };
  });
}

// -------------------------------------------------------------- calculadora

function renderCalc() {
  render(`
    <div class="panel" style="max-width:560px">
      <h2>Hedge economics</h2>
      <div class="panel-body">
        <p class="muted" style="margin-top:0">
          The <em>Target × Multiplier</em> block from the spreadsheet: how much of the payout the hedge eats.
        </p>
        <div class="row">
          <div class="field"><label>Target</label>
            <input id="k-target" type="number" value="3000" step="100"></div>
          <div class="field"><label>Multiplier</label>
            <input id="k-mult" type="number" value="0.1" step="0.01"></div>
          <div class="field"><label>Trader split (%)</label>
            <input id="k-split" type="number" value="90" step="1"></div>
        </div>
        <div class="cards" style="margin-top:16px">
          <div class="card"><div class="label">Hedge cost</div>
            <div class="value neg" id="k-cost">—</div>
            <div class="sub">target × multiplier</div></div>
          <div class="card"><div class="label">After split</div>
            <div class="value" id="k-after">—</div>
            <div class="sub">target × split</div></div>
          <div class="card"><div class="label">Net profit</div>
            <div class="value" id="k-net">—</div>
            <div class="sub">after split − hedge cost</div></div>
        </div>
      </div>
    </div>`);

  const recompute = () => {
    const target = Number(document.getElementById("k-target").value) || 0;
    const mult = Number(document.getElementById("k-mult").value) || 0;
    const split = (Number(document.getElementById("k-split").value) || 0) / 100;
    const cost = target * mult;
    const after = target * split;
    const net = after - cost;
    document.getElementById("k-cost").textContent = money(cost);
    document.getElementById("k-after").textContent = money(after);
    const netEl = document.getElementById("k-net");
    netEl.textContent = money(net);
    netEl.className = `value ${signClass(net)}`;
  };
  ["k-target", "k-mult", "k-split"].forEach((id) => {
    document.getElementById(id).oninput = recompute;
  });
  recompute();
}

// ------------------------------------------------------------------ router

const RENDERERS = {
  overview: renderOverview,
  challenges: renderChallenges,
  unassigned: renderUnassigned,
  config: renderConfig,
  calc: renderCalc,
  issues: renderIssues,
};

function renderNav() {
  document.getElementById("nav").innerHTML = PAGES.map((p) => {
    const label = p.id === "issues" && state.openIssues
      ? `${p.label} <span class="pill">${state.openIssues}</span>`
      : esc(p.label);
    return `<button data-page="${p.id}" ${
      p.id === state.page ? 'aria-current="page"' : ""}>${label}</button>`;
  }).join("");
  document.querySelectorAll("[data-page]").forEach((b) => {
    b.onclick = () => go(b.dataset.page);
  });
  const section = document.getElementById("section");
  if (section) section.textContent = PAGES.find((p) => p.id === state.page)?.label ?? "";
}

async function go(page) {
  state.page = page;
  location.hash = page;
  renderNav();
  render(`<div class="empty">loading</div>`);
  try {
    await RENDERERS[page]();
  } catch (err) {
    render(`<div class="panel"><h2>Failed</h2><div class="panel-body">
      <p class="muted" style="margin:0">${esc(err.message)}</p>
    </div></div>`);
  }
}

// Relógio do cabeçalho. Um segundo é a granularidade certa para o que ele
// mostra e o custo é um innerHTML minúsculo.
setInterval(renderStatus, 1000);

/**
 * Recarrega quando há versão nova publicada.
 *
 * O deploy versiona os módulos (`?v=<hash>`), então o JS novo sempre chega --
 * mas o index.html que aponta para ele vem do GitHub Pages com `max-age=600`.
 * Sem isto, por até dez minutos depois de publicar o navegador segue servindo o
 * HTML antigo e a correção "não aparece", mesmo estando no ar.
 */
async function checkForUpdate() {
  const mine = new URL(import.meta.url).searchParams.get("v");
  if (!mine) return; // rodando local, sem versão carimbada

  try {
    const html = await fetch(new URL(location.pathname, location.origin), {
      cache: "no-store",
    }).then((r) => r.text());
    const live = html.match(/app\.js\?v=([a-f0-9]+)/)?.[1];
    if (!live || live === mine) return;

    // Uma recarga por versão: se ainda divergir depois disso o problema é
    // outro, e recarregar em laço deixaria o app inutilizável.
    if (sessionStorage.getItem("tracking:reloaded") === live) return;
    sessionStorage.setItem("tracking:reloaded", live);
    location.reload();
  } catch {
    // Offline ou bloqueado: seguir com o que já está carregado.
  }
}

checkForUpdate();
setInterval(checkForUpdate, 5 * 60 * 1000);

async function boot() {
  const user = await currentUser();
  if (!user) {
    // Zera o estado: sem isto a barra continua mostrando o nome e o PnL de quem
    // acabou de sair, na tela de login.
    state.email = "";
    state.totals = { pnl: null, challenges: null };
    state.openIssues = 0;
    document.getElementById("nav").innerHTML = "";
    document.getElementById("status").innerHTML = "";
    document.getElementById("section").textContent = "auth";
    return renderLogin();
  }
  state.email = user.email ?? "";
  renderStatus();
  renderNav();
  refreshIssueCount();
  const initial = location.hash.slice(1);
  await go(RENDERERS[initial] ? initial : "overview");
}

supabase.auth.onAuthStateChange(() => boot());
boot();
