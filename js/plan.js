// A aba Plan: o que fazer hoje para chegar na meta de saques.
//
// O alvo de cada conta e o multiplicador NÃO são calculados aqui: vêm prontos
// do coletor (`accounts.rec_*`, ver collector/core/playbook.py), que é onde a
// fórmula da mesa mora e tem teste. Aqui só se decide a lista do dia:
//
//   trade     uma por conta viva, a mais adiantada primeiro (a líder do Jack)
//   payout    ciclo fechado: pedir o saque
//   decide    conta que já sacou o combinado: queimar ou seguir
//   buy       vagas de funded livres por mesa x avaliações por vaga
//   deposit   o hedge precisa cobrir o custo até o saque da líder + o hedge
//             de hoje das outras; faltou, deposita

const PHASE_OF_STATUS = { phase1: "P1", phase2: "P2", funded: "FUNDED" };
const DIA = 864e5;

/** Dia de sessão de Nova York: vira às 17:00, e fim de semana é segunda. */
export function sessionDay(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hourCycle: "h23",
  }).formatToParts(now).map((p) => [p.type, p.value]));
  let d = Date.parse(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
  if (Number(parts.hour) >= 17) d += DIA;
  const semana = new Date(d).getUTCDay();
  if (semana === 6) d += 2 * DIA;
  if (semana === 0) d += DIA;
  return new Date(d).toISOString().slice(0, 10);
}

/** Soma pregões (seg-sex) a um dia ISO. */
export function addTradingDays(isoDay, n) {
  let d = Date.parse(`${isoDay}T00:00:00Z`);
  let falta = n;
  while (falta > 0) {
    d += DIA;
    const s = new Date(d).getUTCDay();
    if (s !== 0 && s !== 6) falta -= 1;
  }
  return new Date(d).toISOString().slice(0, 10);
}

/** Segunda e domingo da semana do dia. */
export function weekOf(isoDay) {
  const d = Date.parse(`${isoDay}T00:00:00Z`);
  const s = (new Date(d).getUTCDay() + 6) % 7; // 0 = segunda
  return {
    start: new Date(d - s * DIA).toISOString().slice(0, 10),
    end: new Date(d + (6 - s) * DIA).toISOString().slice(0, 10),
  };
}

/** P* da política -- a mesma conta de playbook.max_payout_profit, só para a tabela de regras. */
export function maxPayoutProfit(p) {
  if (p.cap == null) return p.cycle_target == null ? null : Number(p.cycle_target);
  const pct = Number(p.pct_of_total) || 100;
  return Number(p.buffer || 0) + Number(p.cap) / (pct / 100);
}

export function farmTarget(p) {
  if (Number(p.farm_day_target)) return Number(p.farm_day_target);
  return p.winning_day_min != null ? Number(p.winning_day_min) + 50 : 200;
}

export function burnAfter(p) {
  return Number(p?.burn_after_payouts) || 3;
}

const n = (v) => (v == null ? null : Number(v));

/**
 * Monta o dia. Tudo o que entra já foi lido do banco; nada aqui escreve.
 *
 * `checks`: Set de chaves marcadas a mão (qualquer dia recente).
 */
export function buildPlan({ journal, progress, accounts, firms, plans, policies, today,
                            settings, checks, cash, liveDays, now = new Date() }) {
  const session = sessionDay(now);
  const contas = new Map(accounts.map((a) => [a.id, a]));
  const hoje = new Map(today.map((t) => [t.account_id, t]));
  const politicas = new Map(policies.map((p) => [p.id, p]));
  const firmas = new Map(firms.map((f) => [f.id, f]));

  const vivos = journal.filter((c) => PHASE_OF_STATUS[c.status] && !c.drawdown_blown);

  // ------------------------------------------------------------ trades
  const trades = [];
  const payouts = [];
  const decisions = [];
  const forecast = [];
  for (const c of vivos) {
    const fase = PHASE_OF_STATUS[c.status];
    const prog = progress.find((p) => Number(p.challenge_id) === Number(c.id) && p.phase === fase);
    if (!prog || prog.blown) continue;
    const conta = contas.get(prog.account_id) || {};
    const stage = conta.rec_stage;
    const passos = Array.isArray(conta.rec_schedule) ? conta.rec_schedule : [];
    const politica = politicas.get(conta.payout_policy_id);
    const operou = Boolean(hoje.get(prog.account_id)?.traded_today || hoje.get(prog.account_id)?.open_now);
    const base = {
      challengeId: c.id, accountId: prog.account_id, short: prog.short_id || c.account_ids,
      firm: c.firm, plan: prog.plan_name,
    };

    if (fase === "FUNDED") {
      const saques = Number(c.payout_entries) || 0;
      if (politica && saques >= burnAfter(politica)) {
        const key = `burn:${c.id}:${saques}`;
        decisions.push({ ...base, key, done: checks.has(key), payouts: saques,
          nextBig: passos.find((s) => s.kind === "big")?.target ?? null,
          why: c.firm === "Tradeify" && saques >= 4
            ? "the 5th payout can move it to live and close the other funded"
            : `${saques} payouts taken` });
      }
      if (stage === "payout_ready") {
        const key = `payout:${c.id}:${c.cycle_closed_on || ""}`;
        payouts.push({ ...base, key, done: checks.has(key),
          amount: n(conta.rec_payout_net) ?? n(c.funded_withdrawable) });
        forecast.push({ ...base, kind: "payout", amount: n(conta.rec_payout_net),
          day: addTradingDays(session, 1) });
        continue;
      }
      if (!politica) {
        trades.push({ ...base, stage: "funded", label: "Funded · no payout policy picked",
          target: null, multiplier: n(conta.rec_multiplier), hedge: null, done: operou,
          stepsLeft: 99, note: "Pick the payout policy so the plan knows the cycle." });
        continue;
      }
    }
    if (!stage) continue;

    const ciclo = (Number(c.payout_entries) || 0) + 1;
    const exigidos = Number(c.payout_winning_days) || 0;
    // O ciclo só é dito a partir do 2º: no 1º ele é ruído na linha.
    const sufixoCiclo = ciclo > 1 ? ` · cycle ${ciclo}` : "";
    const label = stage === "eval"
      ? `Eval · day ${(Number(prog.days_traded) || 0) + (operou ? 0 : 1)}`
      : stage === "big"
        ? `Big trade${sufixoCiclo}`
        : `Farm · day ${Math.min((Number(c.winning_days) || 0) + (operou ? 0 : 1), exigidos || 5)} of ${exigidos || 5}${sufixoCiclo}`;
    // Avaliação ainda tem a funded inteira pela frente: ~5 passos a mais.
    const stepsLeft = passos.length + (stage === "eval" ? 5 : 0);
    trades.push({
      ...base, stage, label,
      target: n(conta.rec_today_target), multiplier: n(conta.rec_multiplier),
      hedge: n(conta.rec_hedge_cost), costToPayout: n(conta.rec_cost_to_payout),
      payoutNet: n(conta.rec_payout_net), note: conta.rec_note || null,
      done: operou, stepsLeft,
    });
    if (fase === "FUNDED" && passos.length) {
      // O último passo fecha o ciclo; o saque cai no pregão seguinte.
      const ultimo = addTradingDays(session, passos.length - (operou ? 0 : 1));
      forecast.push({ ...base, kind: "payout", amount: n(conta.rec_payout_net),
        day: addTradingDays(ultimo, 1) });
    }
  }
  trades.sort((a, b) => (a.done - b.done) || (a.stepsLeft - b.stepsLeft));

  // ------------------------------------------------------------ buy
  const porMesa = new Map();
  for (const c of journal) {
    if (!c.firm_id) continue;
    const m = porMesa.get(c.firm_id) || { funded: 0, passed: 0, evals: 0, recente: null };
    if (c.status === "funded" && !c.drawdown_blown) m.funded += 1;
    if (c.status === "passed") m.passed += 1;
    if ((c.status === "phase1" || c.status === "phase2") && !c.drawdown_blown) m.evals += 1;
    // O plano da compra é o do challenge mais recente da mesa: na MFFU o
    // histórico é de Builder, e o que se compra agora é Rapid EOD.
    if (c.plan_id && (!m.recente || String(c.date_open || "") + c.id
        > String(m.recente.date_open || "") + m.recente.id)) m.recente = c;
    porMesa.set(c.firm_id, m);
  }
  const porVaga = Number(settings.evals_per_free_slot) || 3;
  const buys = [];
  for (const [firmId, m] of porMesa) {
    const firma = firmas.get(firmId);
    // Só mesa com regra de saque cadastrada entra: sem ela não há plano de funded.
    if (!firma || !policies.some((p) => p.firm_id === firmId)) continue;
    const vagas = Math.max((Number(firma.max_funded) || 2) - m.funded - m.passed, 0);
    const quantas = Math.max(vagas * porVaga - m.evals, 0);
    if (!quantas) continue;
    const doMesa = plans.filter((p) => p.firm_id === firmId);
    const plano = doMesa.find((p) => p.is_preferred)
      || doMesa.find((p) => p.id === m.recente?.plan_id) || doMesa[0];
    const preco = n(plano?.price);
    // Promoção "compra uma, leva outra" (Top One): o preço do plano paga duas.
    const bogo = /\bBOGO\b/i.test(plano?.notes || "");
    const compras = bogo ? Math.ceil(quantas / 2) : quantas;
    buys.push({
      key: `buy:${firmId}`, firm: firma.name, firmId, n: quantas, plan: plano?.name || "",
      price: preco, bogo, cost: preco == null ? null : preco * compras,
      why: `${vagas} funded slot${vagas === 1 ? "" : "s"} free · ${m.evals} eval${m.evals === 1 ? "" : "s"} running`
        + (bogo ? ` · BOGO: ${compras} purchase${compras === 1 ? "" : "s"}` : ""),
    });
  }

  // ------------------------------------------------------------ deposit
  const pendentes = trades.filter((t) => !t.done);
  const lider = [...trades].filter((t) => t.costToPayout != null)
    .sort((a, b) => a.stepsLeft - b.stepsLeft)[0] || null;
  const equity = accounts.filter((a) => a.kind === "live" && a.equity != null)
    .reduce((s, a) => s + Number(a.equity), 0);
  const precisa = (lider ? lider.costToPayout : 0)
    + pendentes.filter((t) => t !== lider).reduce((s, t) => s + (t.hedge || 0), 0);
  const falta = precisa - equity;
  const deposit = {
    need: Math.round(precisa), equity: Math.round(equity), lead: lider,
    missing: falta > 0 ? Math.ceil(falta / 100) * 100 : 0,
  };

  // ------------------------------------------------------------ goal & week
  const alvo = n(settings.goal_profit) ?? 6000;
  const desde = settings.goal_since || null;
  const feito = desde
    ? cash.filter((e) => e.occurred_on >= desde && ["payout", "cost", "refund"].includes(e.kind))
        .reduce((s, e) => s + Number(e.amount || 0), 0)
      + liveDays.filter((d) => d.day >= desde).reduce((s, d) => s + Number(d.day_pnl || 0), 0)
    : null;
  const semana = weekOf(session);
  const proxima = weekOf(addTradingDays(semana.end, 1));
  const saquesSemana = cash.filter((e) => e.kind === "payout"
    && e.occurred_on >= semana.start && e.occurred_on <= semana.end).length;
  forecast.sort((a, b) => a.day.localeCompare(b.day));

  return {
    session,
    goal: { target: alvo, since: desde, done: feito,
      pct: feito == null || !alvo ? null : Math.max(0, Math.min(100, (feito / alvo) * 100)) },
    week: {
      ...semana, goal: Number(settings.goal_payouts_week) || 2, payouts: saquesSemana,
      expectedThis: forecast.filter((f) => f.day <= semana.end).length,
      expectedNext: forecast.filter((f) => f.day >= proxima.start && f.day <= proxima.end).length,
    },
    trades, payouts, decisions, buys, deposit, forecast,
  };
}
