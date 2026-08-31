// Hedge Tracker -- app web.
//
// Roda igual no PC e no celular: e a mesma pagina, o mesmo Supabase. O PC nao
// serve nada -- o coletor la e headless.
//
// Divisao de escrita: este app so mexe no que e decisao humana (custo, payout,
// status, comentario, classificacao de conta). Execucoes, trades e vinculos sao
// do coletor, e aparecem aqui somente como leitura.

import { load, save, supabase, currentUser, signInWithEmail, signOut } from "./db.js";
import {
  money, money0, num, signClass, day, stamp, monthLabel, esc,
  STATUS_LABEL, PHASE_LABEL, magicSourcePart,
} from "./util.js";

const view = document.getElementById("view");
const modal = document.getElementById("modal");

const PAGES = [
  { id: "overview",   label: "Visão geral" },
  { id: "challenges", label: "Challenges" },
  { id: "unassigned", label: "Não atribuídos" },
  { id: "config",     label: "Configuração" },
  { id: "calc",       label: "Calculadora" },
];

const state = { page: "overview", filters: { status: "", firm: "", month: "" } };

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
    toast(`Erro: ${err.message}`);
    throw err;
  }
}

function render(html) {
  view.innerHTML = html;
}

function empty(message) {
  return `<div class="empty">${esc(message)}</div>`;
}

// -------------------------------------------------------------------- login

function renderLogin() {
  render(`
    <div class="panel" style="max-width:420px;margin:8vh auto">
      <h2>Entrar</h2>
      <div class="panel-body">
        <p class="muted" style="margin-top:0">
          Um link de acesso é enviado para o seu email. Vale no PC e no celular.
        </p>
        <div class="field"><label>Email</label>
          <input id="email" type="email" autocomplete="email" placeholder="voce@exemplo.com">
        </div>
        <button class="btn" id="send" style="margin-top:12px;width:100%">Enviar link</button>
      </div>
    </div>`);

  const send = document.getElementById("send");
  send.onclick = async () => {
    const email = document.getElementById("email").value.trim();
    if (!email) return toast("Informe o email");
    send.disabled = true;
    try {
      await signInWithEmail(email);
      toast("Link enviado — confira seu email");
    } catch (err) {
      toast(`Erro: ${err.message}`);
    } finally {
      send.disabled = false;
    }
  };
}

// ----------------------------------------------------------------- overview

async function renderOverview() {
  const [journal, monthly] = await Promise.all([load.journal(), load.monthly()]);

  const sum = (f) => journal.reduce((a, c) => a + Number(c[f] || 0), 0);
  const total = sum("total_pnl");
  const noHedge = sum("no_hedge_pnl");
  const hedge = sum("lost_hedging");
  const open = journal.filter((c) => ["phase1", "phase2", "funded"].includes(c.status));

  const cards = [
    ["PnL total", money(total), signClass(total), `${journal.length} challenges`],
    ["Sem hedge teria sido", money(noHedge), signClass(noHedge), "custo + payouts"],
    ["Resultado do hedge", money(hedge), signClass(hedge), "as três colunas live"],
    ["Custos", money(sum("cost")), "neg", "challenges comprados"],
    ["Payouts", money(sum("funded_payout")), "pos", "recebido das mesas"],
    ["Contas ativas", String(open.length), "", "fases 1, 2 e funded"],
  ].map(([label, value, cls, sub]) => `
    <div class="card">
      <div class="label">${esc(label)}</div>
      <div class="value ${cls}">${esc(value)}</div>
      <div class="sub">${esc(sub)}</div>
    </div>`).join("");

  const peak = Math.max(1, ...monthly.map((m) => Math.abs(Number(m.pnl))));
  const bars = monthly.map((m) => {
    const pnl = Number(m.pnl);
    const height = Math.max(2, Math.round((Math.abs(pnl) / peak) * 120));
    return `<div class="col" title="${esc(monthLabel(m.month))}: ${money(pnl)} · ${m.accounts} contas">
      <span class="${signClass(pnl)}" style="font-size:11px;font-variant-numeric:tabular-nums">${money0(pnl)}</span>
      <div class="bar ${pnl < 0 ? "neg" : ""}" style="height:${height}px"></div>
      <span class="tick">${esc(monthLabel(m.month))}</span>
    </div>`;
  }).join("");

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
    <div class="panel">
      <h2>PnL por mês</h2>
      <div class="panel-body">
        ${monthly.length ? `<div class="bars">${bars}</div>` : empty("Sem dados ainda")}
      </div>
    </div>
    <div class="panel">
      <h2>Fechamento mensal</h2>
      <div class="scroll">
        <table>
          <thead><tr>
            <th>Mês</th><th class="num">Contas</th><th class="num">PnL</th>
            <th class="num">Custo</th><th class="num">Payouts</th>
            <th class="num">Hedge</th><th class="num">Sem hedge</th>
          </tr></thead>
          <tbody>${rows || `<tr><td colspan="7">${empty("Sem dados")}</td></tr>`}</tbody>
        </table>
      </div>
    </div>`);
}

// --------------------------------------------------------------- challenges

async function renderChallenges() {
  const [journal, firms] = await Promise.all([load.journal(), load.firms()]);

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

  const body = rows.map((c) => `
    <tr class="clickable" data-id="${c.id}">
      <td>${esc(c.firm || "—")}</td>
      <td class="muted">${esc(c.platform || "—")}</td>
      <td>${day(c.date_open)}</td>
      <td>${badge(c.status, STATUS_LABEL[c.status] || c.status)}</td>
      <td class="num">${cash(c.cost)}</td>
      <td class="num">${cash(c.p1_live)}</td>
      <td class="num">${cash(c.p2_live)}</td>
      <td class="num">${cash(c.funded_live)}</td>
      <td class="num">${cash(c.funded_payout)}</td>
      <td class="num">${cash(c.lost_hedging)}</td>
      <td class="num"><strong>${cash(c.total_pnl)}</strong></td>
      <td class="num muted">${c.trade_count || (c.import_source ? "imp." : "0")}</td>
    </tr>`).join("");

  render(`
    <div class="panel">
      <h2>Filtros</h2>
      <div class="panel-body row">
        <div class="field"><label>Status</label>
          <select id="f-status">${options(
            Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })),
            status, "Todos")}</select></div>
        <div class="field"><label>Mesa</label>
          <select id="f-firm">${options(
            firms.map((f) => ({ value: f.name, label: f.name })), firm, "Todas")}</select></div>
        <div class="field"><label>Mês de abertura</label>
          <select id="f-month">${options(
            months.map((m) => ({ value: m, label: monthLabel(m) })), month, "Todos")}</select></div>
        <div class="field" style="flex:0"><label>&nbsp;</label>
          <button class="btn" id="new-challenge">Novo challenge</button></div>
      </div>
    </div>

    <div class="panel">
      <h2>${rows.length} challenges</h2>
      <div class="scroll">
        <table>
          <thead><tr>
            <th>Mesa</th><th>Plataforma</th><th>Aberta</th><th>Status</th>
            <th class="num">Custo</th><th class="num">Fase 1 live</th>
            <th class="num">Fase 2 live</th><th class="num">Funded live</th>
            <th class="num">Payout</th><th class="num">Hedge</th>
            <th class="num">Total</th><th class="num">Trades</th>
          </tr></thead>
          <tbody>${body || `<tr><td colspan="12">${empty("Nenhum challenge com esses filtros")}</td></tr>`}</tbody>
          <tfoot><tr style="font-weight:640">
            <td colspan="4">Total</td>
            <td class="num">${cash(totals.cost)}</td>
            <td class="num">${cash(totals.p1_live)}</td>
            <td class="num">${cash(totals.p2_live)}</td>
            <td class="num">${cash(totals.funded_live)}</td>
            <td class="num">${cash(totals.funded_payout)}</td>
            <td class="num">${cash(totals.lost_hedging)}</td>
            <td class="num">${cash(totals.total_pnl)}</td>
            <td></td>
          </tr></tfoot>
        </table>
      </div>
    </div>`);

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
      <td>${esc(PHASE_LABEL[p.phase] || p.phase)}</td>
      <td>${esc(p.accounts?.login_or_name || p.account_ref || "—")}</td>
      <td class="muted">${esc(p.accounts?.platform || "—")}</td>
      <td>${p.started_at ? day(p.started_at) : "—"} → ${p.ended_at ? day(p.ended_at) : "aberta"}</td>
      <td>${p.outcome ? badge("closed", p.outcome) : "—"}</td>
    </tr>`).join("");

  const cashRows = cashEvents.map((e) => `
    <tr>
      <td>${day(e.occurred_on)}</td>
      <td>${esc({ cost: "Custo", payout: "Payout", refund: "Reembolso" }[e.kind] || e.kind)}</td>
      <td class="num">${cash(e.amount)}</td>
      <td class="muted">${esc(e.source)}</td>
      <td><button class="btn ghost" data-del-cash="${e.id}">Remover</button></td>
    </tr>`).join("");

  modal.innerHTML = `
    <header>
      <h1>${esc(c.firm || "Challenge")} · ${day(c.date_open)}</h1>
      <span class="spacer"></span>
      ${badge(c.status, STATUS_LABEL[c.status] || c.status)}
      <button class="btn ghost" id="edit-challenge">Editar</button>
      <button class="btn ghost" id="close-modal">Fechar</button>
    </header>
    <div style="padding:16px;max-height:74vh;overflow:auto">
      <div class="cards">
        <div class="card"><div class="label">Total</div>
          <div class="value ${signClass(c.total_pnl)}">${money(c.total_pnl)}</div></div>
        <div class="card"><div class="label">Custo</div>
          <div class="value neg">${money(c.cost)}</div></div>
        <div class="card"><div class="label">Payout</div>
          <div class="value pos">${money(c.funded_payout)}</div></div>
        <div class="card"><div class="label">Hedge</div>
          <div class="value ${signClass(c.lost_hedging)}">${money(c.lost_hedging)}</div></div>
      </div>

      <div class="panel"><h2>Fases</h2><div class="scroll"><table>
        <thead><tr><th>Fase</th><th>Conta</th><th>Plataforma</th><th>Período</th><th>Resultado</th></tr></thead>
        <tbody>${phaseRows || `<tr><td colspan="5">${empty("Nenhuma fase cadastrada")}</td></tr>`}</tbody>
      </table></div></div>

      <div class="panel"><h2>Custos e payouts</h2><div class="scroll"><table>
        <thead><tr><th>Data</th><th>Tipo</th><th class="num">Valor</th><th>Origem</th><th></th></tr></thead>
        <tbody>${cashRows || `<tr><td colspan="5">${empty("Nada lançado")}</td></tr>`}</tbody>
      </table></div>
      <div class="panel-body row">
        <div class="field"><label>Tipo</label><select id="cash-kind">
          <option value="cost">Custo</option><option value="payout">Payout</option>
          <option value="refund">Reembolso</option></select></div>
        <div class="field"><label>Valor</label><input id="cash-amount" type="number" step="0.01" placeholder="-99.00"></div>
        <div class="field"><label>Data</label><input id="cash-date" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
        <div class="field" style="flex:0"><label>&nbsp;</label><button class="btn" id="add-cash">Lançar</button></div>
      </div></div>

      <div class="panel"><h2>Trades pareadas (prop × live)</h2><div class="scroll"><table>
        <thead><tr>
          <th>Entrada</th><th>Prop</th><th class="num">PnL prop</th>
          <th>Live</th><th class="num">PnL live</th><th class="num">Net</th>
          <th class="num">Mult.</th><th>Vínculo</th>
        </tr></thead>
        <tbody>${pairRows || `<tr><td colspan="8">${empty("Nenhum par ainda")}</td></tr>`}</tbody>
      </table></div></div>

      ${soloRows ? `<div class="panel"><h2>Trades sem par</h2><div class="scroll"><table>
        <thead><tr><th>Entrada</th><th>Ponta</th><th>Ativo</th><th class="num">PnL</th></tr></thead>
        <tbody>${soloRows}</tbody></table></div></div>` : ""}
    </div>`;

  modal.showModal();
  modal.querySelector("#close-modal").onclick = () => modal.close();
  modal.querySelector("#edit-challenge").onclick = () => {
    modal.close();
    openChallengeEditor(c, firms);
  };
  modal.querySelector("#add-cash").onclick = async () => {
    const amount = Number(modal.querySelector("#cash-amount").value);
    if (!amount) return toast("Informe um valor");
    await guard(() => save.createCashEvent({
      challenge_id: id,
      kind: modal.querySelector("#cash-kind").value,
      amount,
      occurred_on: modal.querySelector("#cash-date").value,
      source: "manual",
    }), "Lançamento salvo");
    modal.close();
    renderChallenges();
  };
  modal.querySelectorAll("[data-del-cash]").forEach((b) => {
    b.onclick = async () => {
      await guard(() => save.deleteCashEvent(Number(b.dataset.delCash)), "Removido");
      modal.close();
      renderChallenges();
    };
  });
}

// ------------------------------------------------- editor de um challenge

async function openChallengeEditor(c, firms) {
  const accounts = await load.accounts();
  const props = accounts.filter((a) => a.kind === "prop");
  const isNew = !c;

  const firmOptions = firms.map((f) =>
    `<option value="${f.id}" ${c && c.firm === f.name ? "selected" : ""}>${esc(f.name)}</option>`).join("");
  const statusOptions = Object.entries(STATUS_LABEL).map(([v, l]) =>
    `<option value="${v}" ${c?.status === v ? "selected" : ""}>${esc(l)}</option>`).join("");
  const accountOptions = (selected) =>
    `<option value="">— nenhuma —</option>` + props.map((a) =>
      `<option value="${a.id}" ${a.id === selected ? "selected" : ""}>${esc(a.login_or_name)} (${esc(a.platform)})</option>`).join("");

  const phases = c ? await load.phases(c.id) : [];
  const phaseOf = (p) => phases.find((x) => x.phase === p);

  modal.innerHTML = `
    <header><h1>${isNew ? "Novo challenge" : "Editar challenge"}</h1>
      <span class="spacer"></span>
      <button class="btn ghost" id="close-modal">Cancelar</button></header>
    <div style="padding:16px;max-height:74vh;overflow:auto">
      <div class="row">
        <div class="field"><label>Mesa</label><select id="c-firm">
          <option value="">— escolher —</option>${firmOptions}</select></div>
        <div class="field"><label>Data de abertura</label>
          <input id="c-date" type="date" value="${esc(c?.date_open || new Date().toISOString().slice(0, 10))}"></div>
        <div class="field"><label>Status</label><select id="c-status">${statusOptions}</select></div>
      </div>
      <div class="row" style="margin-top:12px">
        <div class="field"><label>Meta de lucro</label>
          <input id="c-target" type="number" step="0.01" value="${esc(c?.target ?? "")}"></div>
        <div class="field"><label>Split do trader (%)</label>
          <input id="c-split" type="number" step="0.01" value="${esc(c?.split_pct ?? "")}"></div>
      </div>
      <div class="field" style="margin-top:12px"><label>Comentários</label>
        <textarea id="c-comments" rows="2">${esc(c?.comments || "")}</textarea></div>

      <div class="panel" style="margin-top:16px"><h2>Contas por fase</h2><div class="panel-body">
        <p class="muted" style="margin-top:0">
          É esta ligação que faz o resultado da conta live cair no challenge certo.
        </p>
        ${["P1", "P2", "FUNDED"].map((p) => `
          <div class="field" style="margin-bottom:10px">
            <label>${esc(PHASE_LABEL[p])}</label>
            <select data-phase="${p}">${accountOptions(phaseOf(p)?.account_id)}</select>
          </div>`).join("")}
      </div></div>

      <div class="row" style="margin-top:8px">
        <button class="btn" id="save-challenge">Salvar</button>
        ${isNew ? "" : `<button class="btn ghost" id="delete-challenge">Excluir</button>`}
      </div>
    </div>`;

  modal.showModal();
  modal.querySelector("#close-modal").onclick = () => modal.close();

  modal.querySelector("#save-challenge").onclick = async () => {
    const firmId = modal.querySelector("#c-firm").value;
    const patch = {
      firm_id: firmId ? Number(firmId) : null,
      date_open: modal.querySelector("#c-date").value || null,
      status: modal.querySelector("#c-status").value,
      target: Number(modal.querySelector("#c-target").value) || null,
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
    }, "Challenge salvo");

    modal.close();
    renderChallenges();
  };

  const del = modal.querySelector("#delete-challenge");
  if (del) del.onclick = async () => {
    if (!confirm("Excluir este challenge e seus lançamentos?")) return;
    await guard(() => save.deleteChallenge(c.id), "Excluído");
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
          <option value="">— escolher fase —</option>
          ${options.map((o) => `<option value="${o.id}">${esc(o.label)}</option>`).join("")}
        </select>
      </td>
    </tr>`).join("");

  render(`
    <div class="panel">
      <h2>${trades.length} trades da conta live sem challenge</h2>
      <div class="panel-body" style="padding-bottom:0">
        <p class="muted" style="margin-top:0">
          O coletor só atribui pelo magic do Copyator. O que cai aqui é operação
          manual, conta antiga ou conta ainda não cadastrada — nada é chutado.
        </p>
      </div>
      <div class="scroll"><table>
        <thead><tr><th>Saída</th><th>Ativo</th><th class="num">PnL</th>
          <th>Comentário</th><th>Magic</th><th style="min-width:230px">Atribuir a</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6">${empty("Nada pendente — tudo atribuído")}</td></tr>`}</tbody>
      </table></div>
    </div>`);

  view.querySelectorAll("[data-trade]").forEach((select) => {
    select.onchange = async () => {
      if (!select.value) return;
      await guard(() => save.assignTrade(Number(select.dataset.trade), Number(select.value)),
        "Trade atribuída");
      renderUnassigned();
    };
  });
}

// ------------------------------------------------------------- configuração

async function renderConfig() {
  const [accounts, discovered, firms] = await Promise.all([
    load.accounts(), load.discovered(), load.firms()]);

  const claimed = new Set(accounts.map((a) => `${a.platform}:${a.login_or_name}`));

  const accountRows = accounts.map((a) => `
    <tr>
      <td>${badge(a.kind, a.kind)}</td>
      <td>${esc(a.platform)}</td>
      <td>${esc(a.login_or_name)}</td>
      <td class="muted">${esc(a.label || a.terminal_path || "—")}</td>
      <td class="num muted">${a.magic_source_part ?? "—"}</td>
      <td><button class="btn ghost" data-toggle="${a.id}" data-kind="${a.kind}">
        Marcar como ${a.kind === "live" ? "prop" : "live"}</button></td>
    </tr>`).join("");

  const discoveredRows = discovered.map((d) => {
    const key = `${d.platform}:${d.login_or_name}`;
    return `<tr>
      <td>${esc(d.platform)}</td>
      <td>${esc(d.label)}</td>
      <td class="muted">${esc(d.login_or_name)}</td>
      <td>${claimed.has(key)
        ? `<span class="muted">já cadastrada</span>`
        : `<div class="row">
             ${d.platform === "MT5"
               ? `<input data-login="${d.id}" placeholder="login MT5" style="width:130px">`
               : ""}
             <button class="btn ghost" data-claim="${d.id}" data-kind="prop">+ prop</button>
             <button class="btn ghost" data-claim="${d.id}" data-kind="live">+ live</button>
           </div>`}</td>
    </tr>`;
  }).join("");

  render(`
    <div class="panel">
      <h2>Contas cadastradas</h2>
      <div class="scroll"><table>
        <thead><tr><th>Tipo</th><th>Plataforma</th><th>Conta</th>
          <th>Terminal</th><th class="num">magic_source_part</th><th></th></tr></thead>
        <tbody>${accountRows || `<tr><td colspan="6">${empty("Nenhuma conta ainda — cadastre abaixo")}</td></tr>`}</tbody>
      </table></div>
    </div>

    <div class="panel">
      <h2>Encontradas neste PC</h2>
      <div class="panel-body" style="padding-bottom:0">
        <p class="muted" style="margin-top:0">
          O coletor publica o que achou; quem decide o que é live e o que é prop é você.
          Para MT5 informe o login, porque o número da conta só aparece com o terminal aberto.
        </p>
      </div>
      <div class="scroll"><table>
        <thead><tr><th>Plataforma</th><th>Terminal</th><th>Identificador</th><th>Classificar</th></tr></thead>
        <tbody>${discoveredRows || `<tr><td colspan="4">${empty("Rode: python -m collector.discovery --push")}</td></tr>`}</tbody>
      </table></div>
    </div>

    <div class="panel">
      <h2>Mesas proprietárias</h2>
      <div class="panel-body">
        <div class="row">
          ${firms.map((f) => badge("closed", `${f.name} · ${f.platform}`)).join(" ") || `<span class="muted">Nenhuma</span>`}
        </div>
        <div class="row" style="margin-top:12px">
          <div class="field"><label>Nome</label><input id="firm-name" placeholder="Tradeify"></div>
          <div class="field"><label>Plataforma</label><select id="firm-platform">
            <option>NT8</option><option>MT5</option><option>Tradovate</option><option>Other</option>
          </select></div>
          <div class="field"><label>Split padrão (%)</label>
            <input id="firm-split" type="number" step="0.01" placeholder="90"></div>
          <div class="field" style="flex:0"><label>&nbsp;</label>
            <button class="btn" id="add-firm">Adicionar</button></div>
        </div>
      </div>
    </div>`);

  view.querySelectorAll("[data-toggle]").forEach((b) => {
    b.onclick = async () => {
      await guard(() => save.account(Number(b.dataset.toggle),
        { kind: b.dataset.kind === "live" ? "prop" : "live" }), "Conta atualizada");
      renderConfig();
    };
  });

  view.querySelectorAll("[data-claim]").forEach((b) => {
    b.onclick = async () => {
      const d = discovered.find((x) => x.id === Number(b.dataset.claim));
      const loginInput = view.querySelector(`[data-login="${d.id}"]`);
      const login = d.platform === "MT5" ? (loginInput?.value || "").trim() : d.login_or_name;
      if (d.platform === "MT5" && !login) return toast("Informe o login do MT5");

      await guard(() => save.createAccount({
        kind: b.dataset.kind,
        platform: d.platform,
        login_or_name: login,
        label: d.label,
        terminal_hash: d.terminal_hash,
        terminal_path: d.terminal_path,
        broker_server: d.broker_server,
        magic_source_part: magicSourcePart(d.platform, login),
      }), "Conta cadastrada");
      renderConfig();
    };
  });

  document.getElementById("add-firm").onclick = async () => {
    const name = document.getElementById("firm-name").value.trim();
    if (!name) return toast("Informe o nome");
    await guard(() => save.createFirm({
      name,
      platform: document.getElementById("firm-platform").value,
      default_split: Number(document.getElementById("firm-split").value) || null,
    }), "Mesa adicionada");
    renderConfig();
  };
}

// -------------------------------------------------------------- calculadora

function renderCalc() {
  render(`
    <div class="panel" style="max-width:560px">
      <h2>Economia do hedge</h2>
      <div class="panel-body">
        <p class="muted" style="margin-top:0">
          O bloco <em>Target × Multiplier</em> da planilha: quanto do payout o hedge consome.
        </p>
        <div class="row">
          <div class="field"><label>Meta (target)</label>
            <input id="k-target" type="number" value="3000" step="100"></div>
          <div class="field"><label>Multiplicador</label>
            <input id="k-mult" type="number" value="0.1" step="0.01"></div>
          <div class="field"><label>Split do trader (%)</label>
            <input id="k-split" type="number" value="90" step="1"></div>
        </div>
        <div class="cards" style="margin-top:16px">
          <div class="card"><div class="label">Custo do hedge</div>
            <div class="value neg" id="k-cost">—</div>
            <div class="sub">meta × multiplicador</div></div>
          <div class="card"><div class="label">Após o split</div>
            <div class="value" id="k-after">—</div>
            <div class="sub">meta × split</div></div>
          <div class="card"><div class="label">Lucro líquido</div>
            <div class="value" id="k-net">—</div>
            <div class="sub">após split − custo do hedge</div></div>
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
};

function renderNav() {
  document.getElementById("nav").innerHTML = PAGES.map((p) =>
    `<button data-page="${p.id}" ${p.id === state.page ? 'aria-current="page"' : ""}>${esc(p.label)}</button>`
  ).join("");
  document.querySelectorAll("[data-page]").forEach((b) => {
    b.onclick = () => go(b.dataset.page);
  });
}

async function go(page) {
  state.page = page;
  location.hash = page;
  renderNav();
  render(`<div class="empty">Carregando…</div>`);
  try {
    await RENDERERS[page]();
  } catch (err) {
    render(`<div class="panel"><div class="panel-body">
      <strong>Não foi possível carregar.</strong>
      <p class="muted">${esc(err.message)}</p>
    </div></div>`);
  }
}

document.getElementById("refresh").onclick = () => go(state.page);
document.getElementById("theme").onclick = () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("theme", next); } catch {}
};

try {
  const saved = localStorage.getItem("theme");
  if (saved) document.documentElement.dataset.theme = saved;
} catch {}

async function boot() {
  if (!(await currentUser())) {
    document.getElementById("nav").innerHTML = "";
    return renderLogin();
  }
  renderNav();
  const initial = location.hash.slice(1);
  await go(RENDERERS[initial] ? initial : "overview");
}

supabase.auth.onAuthStateChange(() => boot());
boot();
