// Hedge Tracker -- app web.
//
// Roda igual no PC e no celular: e a mesma pagina, o mesmo Supabase. O PC nao
// serve nada -- o coletor la e headless.
//
// Divisao de escrita: este app so mexe no que e decisao humana (custo, payout,
// status, comentario, classificacao de conta). Execucoes, trades e vinculos sao
// do coletor, e aparecem aqui somente como leitura.

import {
  load, save, manualPatch, supabase, currentUser, signInWithPassword,
  signInWithEmail, changePassword, signOut,
} from "./db.js?v=15ae3687a3";
import {
  money, money0, num, signClass, day, stamp, monthLabel, esc,
  STATUS_LABEL, PHASE_LABEL, statusLabel, statusOptions, phaseLabel, phasesFor,
  magicSourcePart, accountShort, signedCash,
} from "./util.js?v=15ae3687a3";
import {
  equityCurve, equityFinal, firmBreakdown, accountProgress,
} from "./charts.js?v=15ae3687a3";
import { cell, locked, wireEditables } from "./editable.js?v=15ae3687a3";
import { exportChallenges } from "./export.js?v=15ae3687a3";
import { mountPlanPicker } from "./plan-picker.js?v=15ae3687a3";
import { nextLiveLot } from "./next-lot.js?v=15ae3687a3";
import { filterForFirm } from "./firm-accounts.js?v=15ae3687a3";
import { currentPhase, newerAttempt, planReset } from "./reset-account.js?v=15ae3687a3";
import {
  ALL, machineNames, keep as keepOfMachine, keepByAccount, keepChallenges,
} from "./machine.js?v=15ae3687a3";

const view = document.getElementById("view");
const modal = document.getElementById("modal");

const PAGES = [
  { id: "overview",   label: "Overview" },
  { id: "challenges", label: "Challenges" },
  { id: "unassigned", label: "Unassigned" },
  { id: "config",     label: "Setup" },
  { id: "issues",     label: "Report" },
];

// Onde a máquina escolhida fica guardada. Declarada ANTES de `state`: `state`
// chama `readMachine()` ao nascer, e uma const declarada depois ainda está na
// zona morta -- o erro cairia no catch e a escolha salva seria perdida em
// silêncio a cada carregamento.
const MACHINE_KEY = "tracking:machine";

const state = {
  page: "overview",
  filters: { status: "", firm: "", month: "", q: "" },
  // Alimentado sempre que o journal e carregado, para a barra de status nao
  // precisar de uma consulta so dela.
  totals: { pnl: null, challenges: null },
  email: "",
  // Quantos reportes estao abertos. Fica no menu para o problema nao ficar
  // esquecido num canto: quem reportou ve que ainda esta la, e quem mantem ve
  // que tem coisa para olhar.
  openIssues: 0,
  isAdmin: false,
  // Linha aberta na tela Hedge e filtro da lista. Ficam no estado para a
  // escolha sobreviver ao redesenho da tela a cada clique.
  // O grupo das encerradas comeca fechado: elas sao historico, nao decisao.
  hedgeClosed: false,
  // Sub-aba aberta no Setup.
  setupTab: "register",
  // Quantas informações o coletor não tem como descobrir e continuam em branco.
  // Fica no menu pelo mesmo motivo dos reportes: buraco esquecido vira número
  // errado que ninguém questiona.
  pendingSetup: 0,
  // Linha das contas estouradas na aba Challenges: fechada por padrão.
  failedOpen: false,
  // Máquina em foco e as que existem. Quem tem VPS separada por conjunto de
  // contas não quer a lista de uma misturada com a da outra; `ALL` mostra tudo,
  // como sempre foi. A escolha é da pessoa e do navegador, não do banco: é
  // preferência de tela, e cada aparelho dela pode olhar uma máquina diferente.
  machine: readMachine(),
  machines: [],
};

function readMachine() {
  try {
    return localStorage.getItem(MACHINE_KEY) || ALL;
  } catch {
    return ALL;   // janela anônima: vale só para esta sessão
  }
}

function setMachine(next) {
  setMachineQuiet(next);
  go(state.page);
}

// ------------------------------------------------------------------- helpers

function toast(message) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

/**
 * Dias operados que uma consistência de `pct` exige, no mínimo.
 *
 * Com N dias o melhor dia nunca fica abaixo de 1/N do total -- é divisão, não
 * é sorte. Um teto de 40% portanto precisa de `ceil(100/40) = 3` dias, e
 * cadastrar "mínimo 2 dias + 40%" descreve uma conta que ninguém passa nunca.
 *
 * Aconteceu: um plano com essas duas regras segurou uma avaliação aprovada em
 * `phase1` -- melhor dia 50%, limite 40% -- enquanto a mesa já tinha liberado a
 * conta funded. A mesma conta que o cronograma do coletor usa.
 */
function daysForConsistency(pct) {
  const n = Number(pct);
  return n > 0 ? Math.ceil(100 / n) : 0;
}

/**
 * Por que a conta funded pode, ou não pode, sacar hoje.
 *
 * As duas políticas da mesa contam coisas diferentes: a Daily prende um
 * colchão e libera o que passa dele todo dia; a Flex não prende nada e só
 * paga a cada 5 dias vencedores, com piso por dia. Mostrar "$0,00" nas duas
 * esconde justamente o que falta para o dinheiro sair.
 */
function withdrawableWhy(c) {
  if (c.split_pct == null) return "no split set — counting 100% of the funded profit";
  if (!c.payout_policy) {
    return "no payout policy picked — counting the whole profit as withdrawable, "
      + "which is the old behaviour";
  }
  const policy = c.payout_policy_label || c.payout_policy;
  if (Number(c.winning_days_left) > 0) {
    const total = Number(c.winning_days) + Number(c.winning_days_left);
    return `${policy}: ${c.winning_days} of ${total} winning days done`
      + `${c.payout_winning_day_min
          ? ` — a day counts from ${money0(c.payout_winning_day_min)} up` : ""}.`
      + ` Nothing can be requested before that. Then`
      + `${c.payout_pct ? ` ${num(c.payout_pct, 0)}% of total profit` : ""}`
      + `${c.payout_cap ? `, up to ${money0(c.payout_cap)} per payout` : ""}.`;
  }
  return `${policy}: ${money0(c.funded_withdrawable)} can be requested today.`
    + `${Number(c.funded_locked)
        ? ` ${money0(c.funded_locked)} must stay in the account as buffer — it goes`
          + ` if the account breaches, so it is not counted in Total.`
        : ""}`;
}

/** A linha fina embaixo do valor: o que segura o saque. */
function withdrawableNote(c) {
  // Ciclo fechado e a conta operando de novo: o dinheiro caiu e ninguem
  // lancou. Enquanto nao lancar, este numero mostra dinheiro que ja saiu.
  if (c.traded_after_cycle) return `<div class="sub">⚠ payout not recorded?</div>`;
  if (Number(c.winning_days_left) > 0) {
    const total = Number(c.winning_days) + Number(c.winning_days_left);
    return `<div class="sub">${c.winning_days}/${total} winning days</div>`;
  }
  return Number(c.funded_locked)
    ? `<div class="sub">+${money0(c.funded_locked)} buffer</div>` : "";
}

/**
 * Por que "Total PnL" e "Total" diferem.
 *
 * O Total conta o lucro funded que a mesa ainda não pagou, porque ele vira
 * payout no saque seguinte. Mas ele some junto se a conta estourar antes
 * disso, e é por isso que existem as duas colunas: uma responde "quanto esta
 * conta já me deu", a outra "quanto ela vale se tudo correr bem".
 */
/**
 * A conta desta linha, com quanto ela ainda pode perder antes de estourar.
 *
 * O número sai de `account_progress`, que já desconta o que foi sacado: sacar
 * tira dinheiro do saldo e aproxima do chão, mesmo que o P&L das trades não
 * mude. Na conta funded do Adil dá $2.619,94, e o saldo medido pelo
 * NinjaTrader confirma em 46 centavos -- $52.720,40 contra o chão em $50.100.
 *
 * Um challenge pode ter duas contas (avaliação e funded). A que importa é a da
 * ETAPA corrente; conta estourada não tem folga nenhuma a mostrar.
 */
function accountToBlow(challenge, progress) {
  const doChallenge = progress.filter((p) => p.challenge_id === challenge.id);
  const alvo = doChallenge.find((p) => p.phase === PHASE_OF_STATUS[challenge.status])
    || doChallenge[0];
  return alvo && !alvo.blown && alvo.drawdown_room != null ? alvo : null;
}

function cashWhy(c) {
  const naMesa = Number(c.funded_withdrawable) || 0;
  return "money already settled: cost, hedge and payouts received."
    + (naMesa
      ? ` ${money0(naMesa)} of funded profit is still at the firm — that is in`
        + ` Total, not here, and it goes if the account breaches.`
      : " Nothing pending at the firm, so it matches Total.");
}

/**
 * Lê o nome da conta pelo padrão da mesa. Espelha `core/naming.parse_account_name`.
 *
 * O Python aceita `(?P<x>)`, o JS só `(?<x>)`; traduzir antes evita rejeitar um
 * padrão que funciona no coletor.
 */
// As letras que a mesa escreve no nome dizem como a conta PAGA: FTDFYSL**D**
// paga todo dia, FTDFYSL**X** paga a cada cinco dias vencedores. Espelha
// `core/naming.POLICY_GROUPS` -- o nome do grupo é a própria política, então
// mesa nova precisa só de regex, sem tabela de tradução de letra.
const POLICY_GROUPS = ["daily", "flex"];

function parseAccountName(name, pattern) {
  if (!pattern || !name) return null;
  try {
    const m = new RegExp(pattern.replace(/\(\?P</g, "(?<")).exec(name.trim());
    if (!m) return null;
    return {
      funded: Boolean(m.groups?.funded),
      // O padrão escreve o tamanho em milhares, como a mesa escreve.
      size: m.groups?.size ? Number(m.groups.size) * 1000 : null,
      policy: POLICY_GROUPS.find((nome) => m.groups?.[nome]) || null,
    };
  } catch {
    return null;   // Padrão inválido não pode derrubar a tela de pendências.
  }
}

/**
 * Dias mínimos EFETIVOS: o maior entre o que a mesa pede e o que a
 * consistência obriga. É a mesma conta que a view faz, e é o que impede o par
 * contraditório -- mínimo 2 com teto de 40% -- de voltar a existir.
 */
function effectiveMinDays(minDays, consistencyPct) {
  return Math.max(Number(minDays) || 0, daysForConsistency(consistencyPct));
}

/** Explica o mínimo quando é a consistência que manda, não o campo. */
function daysNote(minDays, consistencyPct) {
  const efetivo = effectiveMinDays(minDays, consistencyPct);
  if (!efetivo || efetivo <= (Number(minDays) || 0)) return "";
  return `${num(consistencyPct, 0)}% consistency needs at least ${efetivo}`
       + ` trading days — with fewer, the best day passes the cap by division.`
       + ` This plan asks for ${Number(minDays) || 0}, so ${efetivo} apply.`;
}

/**
 * Transforma um botão em confirmação de dois toques.
 *
 * O primeiro clique troca o rótulo pelo aviso e arma; o segundo executa. Se
 * nada acontecer em quatro segundos ele desarma sozinho -- um botão que fica
 * armado para sempre acaba disparando sem querer no clique seguinte.
 */
function armDelete(button, warning, onConfirm) {
  const original = button.textContent;
  let armed = false;
  let timer = null;

  button.onclick = () => {
    if (armed) {
      clearTimeout(timer);
      return onConfirm();
    }
    armed = true;
    button.textContent = warning;
    button.classList.add("armed");
    timer = setTimeout(() => {
      armed = false;
      button.textContent = original;
      button.classList.remove("armed");
    }, 4000);
  };
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

  const dark = theme() === "dark";

  el.innerHTML = `
    <span class="lbl"><span class="dot"></span>LIVE</span>
    <span class="lbl utc">UTC <b class="n">${utc}</b></span>
    ${challenges != null ? `<span class="lbl">accts <b class="n">${challenges}</b></span>` : ""}
    ${pnl != null ? `<span class="lbl">pnl <b class="n ${
      signClass(pnl)}">${money0(pnl)}</b></span>` : ""}
    <span class="lbl" title="${esc(state.email)}">${esc(state.email.split("@")[0])}</span>
    <span class="thm">
      <button type="button" data-theme-set="dark" aria-pressed="${dark}">Dark</button>
      <button type="button" data-theme-set="light" aria-pressed="${!dark}">Light</button>
    </span>
    <span class="actions">
      <button class="btn ghost icon" id="refresh" title="Reload">${ICON.reload}</button>
      <button class="btn ghost icon" id="logout" title="Sign out">${ICON.signout}</button>
    </span>`;

  el.querySelectorAll("[data-theme-set]").forEach((b) => {
    b.onclick = () => setTheme(b.dataset.themeSet);
  });
  el.querySelector("#refresh").onclick = () => go(state.page);
  el.querySelector("#logout").onclick = async () => {
    await signOut();
    location.reload();
  };
}

// Ícones do cabeçalho. Desenhados, não emoji: emoji muda de forma e de cor a
// cada sistema, e num cabeçalho de duas cores isso aparece.
const ICON = {
  reload: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path
    d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path></svg>`,
  signout: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path
    d="M18.36 6.64A9 9 0 0 1 20.77 15a9 9 0 0 1-17.54 0 9 9 0 0 1 2.41-8.36"></path><line
    x1="12" y1="2" x2="12" y2="12"></line></svg>`,
};

/**
 * Tema claro ou escuro.
 *
 * O `index.html` já aplica o salvo antes do app subir -- senão a página pinta
 * clara e vira escura na frente de quem está olhando. Aqui só trocamos.
 */
function theme() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function setTheme(next) {
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem("tracking:theme", next);
  } catch {
    // Janela anônima: vale só para esta sessão, o que já é o suficiente.
  }
  renderStatus();
}

function setTotals(journal) {
  state.totals = {
    pnl: journal.reduce((a, c) => a + Number(c.total_pnl || 0), 0),
    challenges: journal.length,
  };
  renderStatus();
}

/**
 * A conta é a que está VALENDO no challenge agora?
 *
 * Um challenge passa por mais de uma conta: a avaliação em uma, a funded em
 * outra que a mesa libera depois. As duas ficam em `account_progress`, porque
 * lá a linha é por conta. Mostrar as duas lado a lado no painel sugere duas
 * operações em curso quando é uma só -- e pior, a antiga aparece com o mesmo
 * multiplicador da nova, como se ainda houvesse o que hedgear nela.
 *
 * Conta sem challenge continua aparecendo: ela não está superada, está sem
 * cadastro, e é isso que o aviso de pendências cobra.
 */
const PHASE_OF_STATUS = { phase1: "P1", phase2: "P2", funded: "FUNDED" };

function isCurrentPhase(a) {
  if (!a.challenge_status || !a.phase) return true;
  // `passed` ainda está na conta da avaliação: a funded não chegou.
  if (a.challenge_status === "passed") return a.phase !== "FUNDED";
  const expected = PHASE_OF_STATUS[a.challenge_status];
  return !expected || a.phase === expected;
}

function empty(message) {
  return `<div class="empty">${esc(message)}</div>`;
}

// -------------------------------------------------------------------- login

function renderLogin() {
  render(`
    <div class="panel" style="max-width:360px;margin:12vh auto">
      <h2>Sign in<span class="dim">tracking</span></h2>
      <div class="panel-body">
        <div class="field"><label>Email</label>
          <input id="email" type="email" autocomplete="username" placeholder="voce@exemplo.com">
        </div>
        <div class="field" style="margin-top:10px"><label>Password</label>
          <input id="password" type="password" autocomplete="current-password">
        </div>
        <button class="btn" id="signin" style="margin-top:14px;width:100%">Sign in</button>

        <div style="margin-top:18px;padding-top:16px;border-top:2px solid var(--color-divider)">
          <button class="btn ghost" id="magic" style="width:100%">Email me a link instead</button>
          <p class="muted" style="margin:12px 0 0;font-size:11px;line-height:1.7">
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

// ------------------------------------------------------------------ no ar
//
// A única coisa do sistema que olha para posição ABERTA. Tudo o mais conta
// trade fechada, de propósito: resultado flutuante muda a cada tick e não é
// resultado. Aqui é diferente porque a pergunta é outra -- não "quanto rendeu"
// e sim "a perna está coberta agora".
//
// É o risco que este tracker existe para não ter. Se o Copyator não copiar, ou
// copiar com o tamanho errado, a ponta prop fica nua e isso não aparecia em
// lugar nenhum até a trade fechar.
//
// Nada daqui entra em soma nenhuma. O retrato é substituído a cada ciclo do
// coletor; `seen_at` diz quando, e a tela avisa quando está velho em vez de
// mostrar posição que talvez já tenha fechado.

const STALE_AFTER = 3 * 60 * 1000;   // coletor roda a cada ~5s; 3 min já é abandono

function openPositions(rows, accounts) {
  if (!rows.length) return "";

  const byId = new Map(accounts.map((a) => [a.id, a]));
  const props = rows.filter((p) => byId.get(p.account_id)?.kind === "prop");
  const lives = rows.filter((p) => byId.get(p.account_id)?.kind === "live");

  // A perna live carrega no magic a conta prop que ela hedgeia -- a mesma
  // chave que atribui trade fechada. Aqui ela responde "quem cobre quem".
  const coverOf = (prop) => lives.filter((l) =>
    Number(l.magic ?? 0) % 2 ** 32 === Number(prop.magic_source_part ?? -1));

  const oldest = Math.min(...rows.map((p) => new Date(p.seen_at).getTime()));
  const stale = Date.now() - oldest > STALE_AFTER;

  const card = (p) => {
    const account = byId.get(p.account_id) || {};
    const prop = { ...p, magic_source_part: account.magic_source_part };
    const cover = coverOf(prop);
    const coveredQty = cover.reduce((t, c) => t + Number(c.qty || 0), 0);
    const floating = cover.reduce((t, c) => t + Number(c.floating_pnl || 0), 0);
    const naked = cover.length === 0;

    return `
    <div class="acct" style="${naked ? "border-left:2px solid var(--loss)" : ""}">
      <div style="display:flex;align-items:baseline;gap:10px;
                  border-bottom:2px solid var(--color-divider);padding-bottom:12px">
        <span style="font-family:var(--font-heading);font-weight:800;font-size:22px">${
          esc(accountShort(account.login_or_name))}</span>
        <span style="font-size:11px;color:var(--color-neutral-700)">${
          esc(p.symbol)} ${esc(p.side)} ${num(p.qty, 0)}</span>
        <span style="margin-left:auto">${naked
          ? `<span class="badge failed">uncovered</span>`
          : `<span class="badge live">hedged</span>`}</span>
      </div>

      ${naked ? `
        <div class="mult-note" style="margin-top:14px">
          No live position carrying this account’s magic. Either the copy has not
          landed yet, or this leg is running naked — the loss on the prop side is
          not being returned anywhere.
        </div>`
      : `
        <div style="display:flex;align-items:flex-end;gap:24px;margin-top:16px;flex-wrap:wrap">
          <div>
            <div class="n ${signClass(floating)}" style="font-family:var(--font-heading);
                 font-weight:800;font-size:32px;line-height:1">${money0(floating)}</div>
            <div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;
                 color:var(--color-neutral-700);margin-top:6px">hedge, floating now</div>
          </div>
          <div style="padding-bottom:4px">
            <div class="n" style="font-family:var(--font-heading);font-weight:800;
                 font-size:18px">${num(coveredQty, 2)}</div>
            <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;
                 color:var(--color-neutral-700);margin-top:3px">live size</div>
          </div>
          <div style="padding-bottom:4px">
            <div class="n" style="font-family:var(--font-heading);font-weight:800;
                 font-size:18px">${Number(p.qty) ? num(coveredQty / Number(p.qty), 3) : "—"}</div>
            <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;
                 color:var(--color-neutral-700);margin-top:3px">multiplier now</div>
          </div>
        </div>
        <div class="n" style="margin-top:12px;font-size:11px;color:var(--color-neutral-600)">
          ${cover.map((c) => `${esc(byId.get(c.account_id)?.login_or_name ?? "?")} ·
            ${esc(c.symbol)} ${esc(c.side)} ${num(c.qty, 2)}`).join(" · ")}
        </div>`}
    </div>`;
  };

  // Perna live sem prop do outro lado tambem e um descasamento, so que do
  // outro sentido: hedge sem nada para hedgear.
  const cobertas = new Set(props.flatMap((p) => {
    const account = byId.get(p.account_id) || {};
    return coverOf({ ...p, magic_source_part: account.magic_source_part }).map((c) => c.id);
  }));
  const soltas = lives.filter((l) => !cobertas.has(l.id));

  return `
    <div class="panel">
      <h2>In the air right now<span class="dim">${
        stale ? "collector has not reported for a while — this may be out of date"
              : "open positions · not counted in any total"}</span></h2>
      <div class="panel-body">
        <div class="accts">${props.map(card).join("")}</div>
        ${soltas.length ? `
        <div class="mult-note" style="margin-top:16px">
          ${soltas.length} live position${soltas.length === 1 ? "" : "s"} with no prop
          leg behind ${soltas.length === 1 ? "it" : "them"}:
          ${soltas.map((l) => `${esc(l.symbol)} ${esc(l.side)} ${num(l.qty, 2)}`).join(" · ")}.
          A hedge with nothing to hedge is an open trade of its own.
        </div>` : ""}
      </div>
    </div>`;
}

// ----------------------------------------------------------------- overview

async function renderOverview() {
  const [todoJournal, monthly, todoProgresso, todoOAr, todasContas] = await Promise.all([
    load.journal(), load.monthly(), load.progress(),
    load.openPositions(), load.accounts()]);
  // Filtrado ANTES de qualquer soma: o total do topo precisa fechar com a
  // tabela de baixo. Um total geral sobre uma lista filtrada seria pior do que
  // não ter filtro nenhum.
  //
  // O mapa de máquinas sai sempre da lista COMPLETA de contas. Filtrar as
  // contas primeiro e traduzir depois transformaria a conta da outra máquina em
  // "conta desconhecida" -- e desconhecida passa pelo filtro.
  const accounts = keepOfMachine(todasContas, state.machine);
  const progress = keepByAccount(todoProgresso, todasContas, state.machine);
  const inTheAir = keepByAccount(todoOAr, todasContas, state.machine);
  const journal = keepChallenges(todoJournal, todoProgresso, todasContas, state.machine);
  const liveAccount = () =>
    accounts.find((a) => a.kind === "live" && a.margin_at) ?? null;
  setTotals(journal);

  // Só contas que ainda estão valendo: conta encerrada não tem alvo a
  // perseguir, e a conta de avaliação de um challenge que já virou funded
  // cumpriu o papel dela -- quem está em jogo é a conta nova.
  const running = progress.filter((a) =>
    (a.challenge_status == null || ["phase1", "phase2", "passed", "funded"]
      .includes(a.challenge_status)) && isCurrentPhase(a));

  const sum = (f) => journal.reduce((a, c) => a + Number(c[f] || 0), 0);
  const total = sum("total_pnl");
  const cashTotal = sum("cash_pnl");
  const noHedge = sum("no_hedge_pnl");
  const hedge = sum("lost_hedging");
  const cost = sum("cost");
  const payouts = sum("funded_payout");
  // Avaliação é só visualização: dinheiro simulado, que não conta em lugar
  // nenhum. Funded é diferente -- vira payout -- mas só a parte SACÁVEL entra
  // no Total: o buffer fica preso na conta e some junto se ela estourar.
  const evalProp = sum("eval_prop");
  const pending = sum("funded_withdrawable");
  const locked = sum("funded_locked");
  const withProp = journal.filter((c) => Number(c.prop_trades) > 0).length;
  const open = journal.filter((c) => ["phase1", "phase2", "passed", "funded"].includes(c.status));

  // "paid" e não "pass rate": uma conta marcada como failed pode ter pago
  // payout antes de estourar, e paga com frequência. Medir por status diria
  // que quase nada dá certo, o que não é o que os números mostram.
  const paid = journal.filter((c) => Number(c.funded_payout) > 0).length;
  const spent = Math.abs(cost);
  const gross = payouts + spent;
  const pctOf = (v) => (v == null ? "—" : `${Math.round(v)}<span style="font-size:15px">%</span>`);
  const paidRate = journal.length ? (paid / journal.length) * 100 : null;
  const hedgeDrag = gross ? (Math.abs(hedge) / gross) * 100 : null;
  const roi = spent ? (total / spent) * 100 : null;

  const span = monthly.length
    ? `${monthLabel(monthly[0].month)} → ${monthLabel(monthly[monthly.length - 1].month)}`
    : "no month closed yet";

  // O número que a operação inteira produz. Ele é o assunto da tela, então
  // ocupa um bloco pintado em vez de mais um cartão na fila -- e a cor do
  // preenchimento é o próprio resultado.
  const hero = `
    <div style="padding:0">
      <div style="height:100%;padding:32px 26px 28px;color:${
        total >= 0 ? "var(--gain-ink)" : "var(--loss-ink)"};background:${
        total >= 0 ? "var(--gain-fill)" : "var(--loss-fill)"}">
        <div style="font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;
              opacity:.82;margin-bottom:10px">Total P&amp;L</div>
        <div class="n" style="font-family:var(--font-heading);font-weight:800;font-size:72px;
              line-height:.9;letter-spacing:-.03em">${money0(total)}</div>
        <div style="margin-top:14px;font-size:12px;opacity:.78">${
          journal.length} challenges · ${esc(span)}${
          Math.round(total) !== Math.round(cashTotal)
            ? ` · ${money0(cashTotal)} in total PnL` : ""}</div>
      </div>
    </div>`;

  const kpi = (label, value, cls, sub) => `
    <div class="card">
      <div class="label">${esc(label)}</div>
      <div class="value ${cls}">${value}</div>
      <div class="sub">${sub}</div>
    </div>`;

  const ledger = (label, value, cls, sub) => `
    <div class="card led">
      <div class="label">${esc(label)}</div>
      <div class="value n ${cls}">${value}</div>
      <div class="sub">${esc(sub)}</div>
    </div>`;

  const rows = monthly.slice().reverse();
  const peak = Math.max(1, ...rows.map((m) => Math.abs(Number(m.pnl) || 0)));
  const monthRows = rows.map((m) => {
    const pnl = Number(m.pnl) || 0;
    // A barra cresce a partir do meio: à direita quando o mês fechou no azul,
    // à esquerda quando fechou no vermelho. Uma barra da esquerda para a
    // direita esconderia o sinal, que é o que se lê primeiro.
    const half = (Math.abs(pnl) / peak) * 50;
    const left = pnl >= 0 ? 50 : 50 - half;
    return `
    <tr>
      <td style="font-weight:600">${esc(monthLabel(m.month))}</td>
      <td style="width:180px;padding-right:20px">
        <div style="height:6px;background:var(--color-neutral-200);position:relative">
          <div style="position:absolute;top:0;bottom:0;left:${left.toFixed(1)}%;
               width:${half.toFixed(1)}%;background:${
                 pnl >= 0 ? "var(--gain)" : "var(--loss)"}"></div>
          <div style="position:absolute;top:-3px;bottom:-3px;left:50%;width:1px;
               background:var(--color-neutral-500)"></div>
        </div>
      </td>
      <td class="num muted">${m.accounts}</td>
      <td class="num">${cash(m.pnl)}</td>
      <td class="num">${cash(m.cost)}</td>
      <td class="num">${cash(m.payouts)}</td>
      <td class="num">${cash(m.hedge_pnl)}</td>
      <td class="num">${cash(m.no_hedge_pnl)}</td>
      <td class="num muted">${cash(m.prop_pnl)}</td>
      <td class="num muted">${cash(m.funded_pending)}</td>
    </tr>`;
  }).join("");

  render(`
    <section class="cards kpi">
      ${hero}
      ${kpi("Without hedge", money0(noHedge), signClass(noHedge), "costs + payouts")}
      ${kpi("Hedge result", money0(hedge), signClass(hedge), "the three live columns")}
      ${kpi("Withdrawable", money0(pending), signClass(pending),
        locked ? `in Total · ${money0(locked)} locked out of it`
               : "what you can request · in Total")}
    </section>

    <section class="cards ledger">
      ${ledger("Costs", money0(cost), signClass(cost), "challenges bought")}
      ${ledger("Payouts", money0(payouts), signClass(payouts), "received from firms")}
      ${ledger("Eval accounts", money0(evalProp), signClass(evalProp),
               `${withProp} tracked · not counted`)}
      ${ledger("Active accounts", String(open.length), "", "phase 1, 2, passed and funded")}
      ${ledger("Paid / Drag / ROI",
               `${pctOf(paidRate)} · ${pctOf(hedgeDrag)} · ${pctOf(roi)}`, "",
               `${paid} paid · drag on gross · on spend`)}
    </section>

    ${openPositions(inTheAir, accounts)}

    ${running.length ? `<div class="panel">
      <h2>Live accounts<span class="dim">target · drawdown · today’s multiplier</span></h2>
      <div class="panel-body">${accountProgress(running, liveAccount())}</div>
    </div>` : ""}

    <div class="grid-2">
      <div class="panel">
        <h2>Equity curve<span class="dim n ${signClass(equityFinal(monthly))}">${
          money0(equityFinal(monthly))}</span></h2>
        <div class="panel-body">
          ${monthly.length ? equityCurve(monthly) : empty("no data yet")}
        </div>
      </div>
      <div class="panel">
        <h2>By firm<span class="dim">where it was made and lost</span></h2>
        <div class="panel-body">
          ${journal.length ? firmBreakdown(journal) : empty("no data yet")}
        </div>
      </div>
    </div>

    <div class="panel">
      <h2>Monthly close<span class="dim">bar reads P&amp;L against the strongest month</span></h2>
      <div class="scroll">
        <table style="min-width:900px">
          <thead><tr>
            <th style="width:96px">Month</th><th></th>
            <th class="num">Accounts</th><th class="num">P&amp;L</th>
            <th class="num">Cost</th><th class="num">Payouts</th>
            <th class="num">Hedge</th><th class="num">No hedge</th>
            <th class="num">Prop</th><th class="num">Pending</th>
          </tr></thead>
          <tbody>${monthRows || `<tr><td colspan="10">${empty("no data")}</td></tr>`}</tbody>
        </table>
      </div>
    </div>`);
}

// --------------------------------------------------------------- challenges

async function renderChallenges() {
  // As contas só são lidas quando há filtro: elas servem só para dizer de que
  // máquina é cada challenge, e sem filtro isso não muda nada na tela.
  const [todos, firms, progressoTodo, contas] = await Promise.all([
    load.journal(), load.firms(), load.progress(),
    state.machine ? load.accounts() : []]);
  const progress = keepByAccount(progressoTodo, contas, state.machine);
  const journal = keepChallenges(todos, progressoTodo, contas, state.machine);
  for (const challenge of journal) {
    const next = nextLiveLot(challenge, progress);
    challenge.next_live_lot = next.lot;
    challenge.next_live_lot_reason = next.reason;
  }
  setTotals(journal);

  const months = [...new Set(journal.filter((c) => c.date_open)
    .map((c) => c.date_open.slice(0, 7)))].sort().reverse();

  const { status, firm, month, q } = state.filters;
  const needle = q.trim().toLocaleLowerCase();
  const rows = journal.filter((c) =>
    (!status || c.status === status) &&
    (!firm || c.firm === firm) &&
    (!month || (c.date_open || "").startsWith(month)) &&
    (!needle || `${c.account_ids || ""} ${c.firm || ""} ${c.comments || ""}`
      .toLocaleLowerCase().includes(needle)));

  const totals = ["cost", "funded_payout", "p1_live", "p2_live", "funded_live",
    "lost_hedging", "cash_pnl", "total_pnl", "eval_prop", "funded_prop",
    "funded_pending", "funded_withdrawable", "funded_locked"].reduce((acc, f) => {
      acc[f] = rows.reduce((a, c) => a + Number(c[f] || 0), 0);
      return acc;
    }, {});

  const options = (list, selected, blank) =>
    `<option value="">${esc(blank)}</option>` +
    list.map((v) => `<option value="${esc(v.value)}" ${v.value === selected ? "selected" : ""}>${esc(v.label)}</option>`).join("");

  // Status como chips e nao select: as opcoes cabem na linha, e ver qual esta
  // ativo sem abrir nada e o que se quer numa barra de filtro.
  const statusChips = [{ value: "", label: "All" }]
    .concat(Object.entries(STATUS_LABEL).map(([value, label]) => ({
      value,
      // "Passed -- awaiting activation" nao cabe num chip; o rotulo longo fica
      // no title e na tabela, onde ha espaco.
      label: value === "passed" ? "Passed" : label,
    })))
    .map((o) => `<button type="button" data-status="${esc(o.value)}"
      aria-pressed="${o.value === status}">${esc(o.label)}</button>`).join("");

  // Uma mesa de etapa unica (Tradeify) nunca tera fase 2. Se nenhuma linha em
  // vista usa duas fases, a coluna some em vez de exibir zeros para sempre.
  const showP2 = rows.some((c) => Number(c.eval_phases) === 2);
  const p2 = (html) => (showP2 ? html : "");
  const cols = showP2 ? 20 : 19;

  // Resultado da conta da mesa. Em avaliação é só visualização: dinheiro
  // simulado, fora de qualquer soma. Quando a conta vira funded ele passa a
  // valer -- mas o que entra no Total é a coluna Pending, o lucro que ainda
  // não virou payout, para o mesmo dólar não ser contado duas vezes.
  //
  // Linha importada da planilha não tem perna prop gravada: mostra "—", porque
  // zero ali seria um número inventado.
  const propCell = (c, value) => `<td class="num">${
    c.prop_trades ? cash(value) : `<span class="dim">—</span>`}</td>`;

  const roomOf = (c) => accountToBlow(c, progress)?.drawdown_room ?? null;
  const roomCell = (c) => {
    const room = roomOf(c);
    return `<td class="num muted">${room == null
      ? `<span class="dim">—</span>` : money0(room)}</td>`;
  };

  const firmOpts = [{ value: "", label: "—" }]
    .concat(firms.map((f) => ({ value: f.id, label: f.name })));

  // Um valor de perna live so e editavel quando NAO ha trade por tras dele.
  // Com trades pareadas o numero e medido; sobrescreve-lo seria mentir para si
  // mesmo. As linhas importadas da planilha nao tem trade, entao continuam
  // abertas para correcao.
  const liveCell = (c, field, value, trades) => trades > 0
    ? locked(cash(value), `${trades} paired trade(s) — measured, not editable`)
    : cell(value, { id: c.id, field, type: "number", align: true,
                    format: () => cash(value), title: "importado — clique para corrigir" });

  const cashCell = (c, field, value, entries) => field === "payout"
    ? `<td class="num"><button class="btn ghost" title="Open challenge to record payout">${cash(value)} ✎</button></td>`
    : entries > 1
    ? locked(cash(value), `${entries} lançamentos — abra a linha para editar`)
    : cell(value, { id: c.id, field, type: "number", align: true,
                    format: () => cash(value) });

  const rowHtml = (c, { failedRow = false, hidden = false } = {}) => `
    <tr class="clickable${failedRow ? " failed-row" : ""}" data-id="${c.id}"${
      hidden ? " hidden" : ""}>
      <td><strong class="${c.status === "failed" || c.drawdown_blown
        ? "blown" : "bright"}">${esc(c.account_ids || "—")}</strong></td>
      ${cell(c.firm_id, { id: c.id, field: "firm_id", type: "select", options: firmOpts,
                          format: () => esc(c.firm || "—") })}
      <td class="muted">${esc(c.platform || "—")}</td>
      ${cell(c.date_open, { id: c.id, field: "date_open", type: "date",
                            format: () => day(c.date_open) })}
      ${cell(c.status, { id: c.id, field: "status", type: "select",
        options: statusOptions(c.eval_phases),
        // Janela entre o estouro e o ciclo do coletor que marca: mostra os
        // dois em vez de escolher um. Fora dessa janela os dois concordam.
        title: c.drawdown_blown && c.status !== "failed"
          ? "a conta bateu o chão do drawdown, mas o status ainda diz o contrário"
          : "",
        format: () => `${badge(c.status, statusLabel(c.status, c.eval_phases))}${
          c.drawdown_blown && c.status !== "failed"
            ? ` <span class="badge failed">blown</span>` : ""}` })}
      <td class="num" title="${esc(c.next_live_lot_reason)}">${c.next_live_lot == null ? "—" : num(c.next_live_lot, 2)}</td>
      ${propCell(c, c.eval_prop)}
      ${propCell(c, c.funded_prop)}
      ${roomCell(c)}
      ${cashCell(c, "cost", c.cost, c.cost_entries)}
      ${liveCell(c, "import_p1_live", c.p1_live, c.p1_trades)}
      ${p2(liveCell(c, "import_p2_live", c.p2_live, c.p2_trades))}
      ${liveCell(c, "import_funded_live", c.funded_live, c.funded_trades)}
      ${cashCell(c, "payout", c.funded_payout, c.payout_entries)}
      <td class="num" title="${esc(withdrawableWhy(c))}">${
        Number(c.funded_pending)
          ? `${cash(c.funded_withdrawable)}${withdrawableNote(c)}${
              c.split_pct == null ? " ⚠" : ""}${
              !c.payout_policy && Number(c.funded_pending) ? " ⚠" : ""}`
          : `<span class="dim">—</span>`}</td>
      <td class="num">${cash(c.lost_hedging)}</td>
      <td class="num" title="${esc(cashWhy(c))}">${cash(c.cash_pnl)}</td>
      <td class="num"><strong>${cash(c.total_pnl)}</strong></td>
      ${cell(c.comments, { id: c.id, field: "comments", type: "text",
                           cls: "note", title: c.comments || "",
                           format: () => `<span class="muted">${esc(c.comments || "—")}</span>` })}
      <td class="num muted">${c.trade_count || (c.import_source ? "imp." : "0")}</td>
    </tr>`;

  // Conta estourada é histórico: não tem mais o que acompanhar, e empurrava
  // as vivas para baixo -- na tela real eram 6 de 11 linhas. Ela sai da frente
  // numa linha só, com o subtotal de cada coluna, e continua no Total do
  // rodapé: esconder não é tirar da conta. Com o filtro Failed ligado a pessoa
  // pediu para vê-las, e aí elas voltam a ser linhas normais.
  const collapseFailed = status !== "failed";
  const failedRows = collapseFailed ? rows.filter((c) => c.status === "failed") : [];
  const liveRows = collapseFailed ? rows.filter((c) => c.status !== "failed") : rows;
  const failedOpen = Boolean(state.failedOpen);
  const failedSum = (f) => failedRows.reduce((a, c) => a + Number(c[f] || 0), 0);
  const failedSummary = !failedRows.length ? "" : `
    <tr class="failed-sum" data-failed-toggle tabindex="0" role="button"
        aria-expanded="${failedOpen}"
        title="Blown accounts, folded. They still count in Total.">
      <td colspan="6"><span class="chev" aria-hidden="true">›</span><span
        class="failed-label">${failedRows.length} failed</span></td>
      <td class="num">${cash(failedSum("eval_prop"))}</td>
      <td class="num">${cash(failedSum("funded_prop"))}</td>
      <td class="num"><span class="dim">—</span></td>
      <td class="num">${cash(failedSum("cost"))}</td>
      <td class="num">${cash(failedSum("p1_live"))}</td>
      ${p2(`<td class="num">${cash(failedSum("p2_live"))}</td>`)}
      <td class="num">${cash(failedSum("funded_live"))}</td>
      <td class="num">${cash(failedSum("funded_payout"))}</td>
      <td class="num">${Number(failedSum("funded_withdrawable"))
        ? cash(failedSum("funded_withdrawable")) : `<span class="dim">—</span>`}</td>
      <td class="num">${cash(failedSum("lost_hedging"))}</td>
      <td class="num">${cash(failedSum("cash_pnl"))}</td>
      <td class="num"><strong>${cash(failedSum("total_pnl"))}</strong></td>
      <td></td>
      <td class="num">${failedRows.reduce((a, c) => a + Number(c.trade_count || 0), 0)}</td>
    </tr>`;
  const body = liveRows.map((c) => rowHtml(c)).join("") + failedSummary
    + failedRows.map((c) => rowHtml(c, { failedRow: true, hidden: !failedOpen })).join("");

  render(`
    <div class="tool">
      <h2>Challenges</h2>
      <span class="hint">the journal · ${journal.length} rows, filtered down to what
        you are looking at</span>
      <span class="right">
        <input class="inp n" id="f-q" type="search" placeholder="account, firm or note"
               value="${esc(q)}" style="min-width:180px">
        <select class="inp" id="f-firm">${options(
          firms.map((f) => ({ value: f.name, label: f.name })), firm, "All firms")}</select>
        <select class="inp" id="f-month">${options(
          months.map((m) => ({ value: m, label: monthLabel(m) })), month, "All months")}</select>
        <span class="filt">${statusChips}</span>
        <button class="btn ghost" id="export-xlsx" title="Download what is on screen">
          Export .xlsx</button>
        <button class="btn" id="new-challenge">New challenge</button>
      </span>
    </div>
    <div class="count n">${rows.length} of ${journal.length} challenges</div>

    <div class="panel" style="margin-top:0">
      <div class="scroll">
        <table class="dt n">
          <thead><tr>
            <th>Acct</th><th>Firm</th><th>Platform</th><th>Opened</th><th>Status</th>
            <th class="num" title="Live lot for the next operation. Evaluation: total recovery cost / drawdown.">Next lot</th>
            <th class="num">Prop eval</th><th class="num">Prop funded</th>
            <th class="num" title="how much this account can still lose before it breaches. What was already withdrawn is discounted.">To blow</th>
            <th class="num">Cost</th><th class="num">Phase 1 live</th>
            ${p2(`<th class="num">Phase 2 live</th>`)}<th class="num">Funded live</th>
            <th class="num">Payout</th><th class="num" title="what you can request today. The buffer stays in the account and is not in Total">Withdrawable</th>
            <th class="num">Hedge</th>
            <th class="num" title="what this account has already given you: cost, hedge and payouts received">Total PnL</th>
            <th class="num" title="Total PnL plus the funded profit still at the firm">Total</th><th>Notes</th><th class="num">Trades</th>
          </tr></thead>
          <tbody>${body || `<tr><td colspan="${cols}">${empty("no challenges match these filters")}</td></tr>`}</tbody>
          <tfoot><tr style="font-weight:640">
            <td colspan="6">Total</td>
            <td class="num">${cash(totals.eval_prop)}</td>
            <td class="num">${cash(totals.funded_prop)}</td>
            <td class="num">${money0(rows.reduce((a, c) => a + (Number(roomOf(c)) || 0), 0))}</td>
            <td class="num">${cash(totals.cost)}</td>
            <td class="num">${cash(totals.p1_live)}</td>
            ${p2(`<td class="num">${cash(totals.p2_live)}</td>`)}
            <td class="num">${cash(totals.funded_live)}</td>
            <td class="num">${cash(totals.funded_payout)}</td>
            <!-- O buffer fica so na linha da conta. Somado no rodape ele
                 sugeria um agregado sacavel, e ele nao sai nunca: fica no
                 saldo enquanto a conta viver e vai junto se ela estourar. -->
            <td class="num">${cash(totals.funded_withdrawable)}</td>
            <td class="num">${cash(totals.lost_hedging)}</td>
            <td class="num">${cash(totals.cash_pnl)}</td>
            <td class="num">${cash(totals.total_pnl)}</td>
            <td></td><td></td>
          </tr></tfoot>
        </table>
      </div>
    </div>`);

  wireEditables(view, saveChallengeField);

  for (const [id, key] of [["f-firm", "firm"], ["f-month", "month"]]) {
    document.getElementById(id).onchange = (e) => {
      state.filters[key] = e.target.value;
      renderChallenges();
    };
  }
  view.querySelectorAll("[data-status]").forEach((b) => {
    b.onclick = () => {
      state.filters.status = b.dataset.status;
      renderChallenges();
    };
  });
  // Redesenha a cada tecla, mas devolve o cursor: sem isto a busca perde o
  // foco na primeira letra e a pessoa digita uma letra por clique.
  const search = document.getElementById("f-q");
  search.oninput = () => {
    state.filters.q = search.value;
    renderChallenges();
    const again = document.getElementById("f-q");
    again.focus();
    again.setSelectionRange(again.value.length, again.value.length);
  };
  document.getElementById("new-challenge").onclick = () => openChallengeEditor(null, firms);

  // Exporta o que está em vista, com o filtro registrado no cabeçalho: um
  // arquivo com 3 das 296 linhas e nada dizendo o porquê vira número sem
  // procedência daqui a um mês.
  const exportBtn = document.getElementById("export-xlsx");
  exportBtn.onclick = async () => {
    if (!rows.length) return toast("Nothing to export");
    const label = exportBtn.textContent;
    exportBtn.disabled = true;
    exportBtn.textContent = "Building…";
    try {
      await exportChallenges(rows.map((c) => ({ ...c, to_blow: roomOf(c) })),
        { filters: state.filters, statusLabel, showP2 });
      toast(`${rows.length} rows exported`);
    } catch (err) {
      toast(`Error: ${err.message}`);
    } finally {
      exportBtn.disabled = false;
      exportBtn.textContent = label;
    }
  };
  // Abre e fecha sem ir ao banco nem redesenhar: as linhas já estão na
  // página, só escondidas. Redesenhar refaria a consulta a cada clique.
  const failedToggle = view.querySelector("[data-failed-toggle]");
  if (failedToggle) {
    const flip = () => {
      state.failedOpen = !state.failedOpen;
      failedToggle.setAttribute("aria-expanded", String(state.failedOpen));
      view.querySelectorAll("tr.failed-row").forEach((tr) => { tr.hidden = !state.failedOpen; });
    };
    failedToggle.onclick = flip;
    failedToggle.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); }
    };
  }
  view.querySelectorAll("tr.clickable").forEach((tr) => {
    tr.onclick = () => openChallenge(Number(tr.dataset.id), journal, firms, progress);
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
      // Custo sai, payout entra: o sinal vem do tipo, nao do que foi digitado.
      const amount = signedCash(kind, raw) ?? 0;
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

async function openChallenge(id, journal, firms, progress = []) {
  const c = journal.find((x) => x.id === id);
  if (!c) return;

  const [phases, cashEvents] = await Promise.all([load.phases(id), load.cashEvents(id)]);
  const trades = await load.tradesForPhases(phases.map((p) => p.id));
  const links = await load.linksForTrades(trades.map((t) => t.id));

  const byId = new Map(trades.map((t) => [t.id, t]));

  // Para onde um trade pode ser movido dentro deste challenge. "solto" tira da
  // fase: ele reaparece em Unassigned, e de la vai para qualquer challenge --
  // e por isso que remover aqui nao perde nada.
  const phaseOptions = [{ value: "", label: "— loose —" }].concat(
    phases.map((p) => ({ value: p.id, label: phaseLabel(p.phase, c.eval_phases) })));

  // O resultado e medido pela plataforma; editar marca a coluna e o coletor
  // para de sobrescrever aquele trade. A marca aparece como ✎ ao lado.
  const pnlCell = (t) => cell(t.net_pnl, {
    id: t.id, field: "trade:net_pnl", type: "number", align: true,
    title: "measured — editing stops the collector from overwriting this value",
    format: () => `${cash(t.net_pnl)}${(t.manual_cols || []).includes("net_pnl") ? " ✎" : ""}`,
  });

  const phaseCell = (t) => cell(t.phase_id, {
    id: t.id, field: "trade:phase_id", type: "select", options: phaseOptions,
    format: () => `<span class="muted">${esc(
      phaseOptions.find((o) => String(o.value) === String(t.phase_id))?.label ?? "—")}</span>`,
  });

  const pairRows = links.map((l) => {
    const prop = byId.get(l.prop_trade_id);
    const live = byId.get(l.live_trade_id);
    if (!prop || !live) return "";
    const net = Number(prop.net_pnl) + Number(live.net_pnl);
    return `<tr>
      <td>${stamp(prop.entry_ts)}</td>
      <td>${esc(prop.symbol)} <span class="muted">${esc(prop.side)}</span> ${num(prop.qty, 0)}</td>
      ${pnlCell(prop)}
      <td>${esc(live.symbol)} <span class="muted">${esc(live.side)}</span> ${num(live.qty, 2)}</td>
      ${pnlCell(live)}
      <td class="num"><strong>${cash(net)}</strong></td>
      <td class="num muted">${l.observed_multiplier ?? "—"}</td>
      <td>${badge("closed", l.link_method)}</td>
      <td><button class="btn ghost danger" data-unlink="${l.id}">Unlink</button></td>
    </tr>`;
  }).join("");

  const linked = new Set(links.flatMap((l) => [l.prop_trade_id, l.live_trade_id]));
  const soloRows = trades.filter((t) => !linked.has(t.id)).map((t) => `
    <tr>
      <td>${stamp(t.entry_ts)}</td>
      <td>${badge(t.accounts?.kind || "prop", t.accounts?.kind === "live" ? "live" : "prop")}</td>
      <td>${esc(t.symbol)} <span class="muted">${esc(t.side)}</span> ${num(t.qty, 2)}</td>
      ${pnlCell(t)}
      ${phaseCell(t)}
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
      <td class="num">${e.kind === "payout" && e.gross_amount != null ? cash(e.gross_amount) : "—"}</td>
      <td class="num">${e.kind === "payout" ? cash(e.redeposit_amount || 0) : "—"}</td>
      <td class="muted">${esc(e.source)}</td>
      <td>${e.kind === "payout" ? `<button class="btn ghost" data-edit-payout="${e.id}">Edit</button>` : ""}<button class="btn ghost" data-del-cash="${e.id}">Remove</button></td>
    </tr>`).join("");

  modal.innerHTML = `
    <header>
      <h1>${esc(c.account_ids || "—")} · ${esc(c.firm || "Challenge")} · ${day(c.date_open)}</h1>
      <span class="spacer"></span>
      ${badge(c.status, STATUS_LABEL[c.status] || c.status)}
      ${c.drawdown_blown && c.status !== "failed"
        ? `<span class="badge failed" title="bateu o chão do drawdown">blown</span>` : ""}
      ${c.status === "failed" || c.drawdown_blown
        ? `<button class="btn ghost" id="reset-account"
             title="the firm gave this account back — start a new attempt on it"
             >Reset account</button>`
        : ""}
      <button class="btn ghost" id="edit-challenge">Edit</button>
      <button class="btn ghost" id="report-challenge">Report</button>
      <button class="btn ghost" id="close-modal">Close</button>
    </header>
    <div style="padding:16px;max-height:74vh;overflow:auto">
      <div class="cards">
        <div class="card"><div class="label">Total</div>
          <div class="value ${signClass(c.total_pnl)}">${money(c.total_pnl)}</div>
          ${Number(c.funded_withdrawable)
            ? `<div class="sub">${money(c.cash_pnl)} total PnL · ${
                money0(c.funded_withdrawable)} still at the firm</div>`
            : ""}</div>
        <div class="card"><div class="label">Cost</div>
          <div class="value neg">${money(c.cost)}</div></div>
        <div class="card"><div class="label">Payout</div>
          <div class="value pos">${money(c.funded_payout)}</div></div>
        <div class="card"><div class="label">Hedge</div>
          <div class="value ${signClass(c.lost_hedging)}">${money(c.lost_hedging)}</div></div>
        ${(() => {
          const conta = accountToBlow(c, progress);
          if (!conta) return "";
          return `<div class="card"><div class="label">To blow</div>
            <div class="value">${money(conta.drawdown_room)}</div>
            <div class="sub">${conta.drawdown_locked
              ? `floor locked at +${money0(conta.drawdown_lock_at)}`
              : `peak ${money0(conta.peak_eod)} − ${money0(conta.max_drawdown)} drawdown`}</div></div>`;
        })()}
        <div class="card"><div class="label">${
          c.status === "funded" ? "Funded acct" : "Eval acct"}</div>
          <div class="value ${c.prop_trades ? signClass(c.prop_pnl) : "muted"}">${
            c.prop_trades ? money(c.prop_pnl) : "—"}</div>
          <div class="sub">${Number(c.funded_pending)
            ? `${money(c.funded_withdrawable)} withdrawable${
                Number(c.winning_days_left) > 0
                  ? ` · ${c.winning_days}/${Number(c.winning_days)
                      + Number(c.winning_days_left)} winning days`
                  : Number(c.funded_locked) ? ` · ${money0(c.funded_locked)} locked` : ""}`
            : "not counted"}</div></div>
      </div>

      <div class="panel"><h2>Phases</h2><div class="scroll"><table>
        <thead><tr><th>Phase</th><th>Account</th><th>Platform</th><th>Period</th><th>Outcome</th></tr></thead>
        <tbody>${phaseRows || `<tr><td colspan="5">${empty("no phases set")}</td></tr>`}</tbody>
      </table></div></div>

      <div class="panel"><h2>Costs &amp; payouts</h2><div class="scroll"><table>
        <thead><tr><th>Date</th><th>Kind</th><th class="num">Net / amount</th><th class="num">Gross payout</th><th class="num">Plexy redeposit</th><th>Source</th><th></th></tr></thead>
        <tbody>${cashRows || `<tr><td colspan="7">${empty("nothing recorded")}</td></tr>`}</tbody>
      </table></div>
      <form id="payout-form" class="panel-body">
        <h3>Record received payout</h3>
        <div class="row">
          <div class="field"><label for="payout-net">Net received ($)</label><input id="payout-net" type="number" min="0.01" step="0.01" required></div>
          <div class="field"><label for="payout-gross">Gross withdrawn ($)</label><input id="payout-gross" type="number" min="0.01" step="0.01" required></div>
          <div class="field"><label for="payout-redeposit">Redeposited to Plexy ($)</label><input id="payout-redeposit" type="number" min="0" step="0.01" value="0" required></div>
          <div class="field"><label for="payout-date">Received on</label><input id="payout-date" type="date" required value="${new Date().toISOString().slice(0, 10)}"></div>
          <div class="field auto"><label>&nbsp;</label><button class="btn" type="submit" id="save-payout">Save payout</button></div>
          <button class="btn ghost" type="button" id="cancel-payout" hidden>Cancel edit</button>
        </div>
        <p class="muted" id="payout-help">Gross is suggested from the profit split; check the amount debited by the firm. Redeposit is a transfer, not additional profit. Plexy balance comes from the collector.</p>
      </form>
      <div class="panel-body row">
        <div class="field"><label>Kind</label><select id="cash-kind">
          <option value="cost">Cost</option>
          <option value="refund">Refund</option></select></div>
        <div class="field"><label>Amount</label><input id="cash-amount" type="number" step="0.01"
          placeholder="105.00" title="the sign comes from the kind — cost goes out, refund comes in"></div>
        <div class="field"><label>Date</label><input id="cash-date" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
        <div class="field auto"><label>&nbsp;</label><button class="btn" id="add-cash">Add</button></div>
      </div></div>

      <div class="panel"><h2>Paired trades (prop × live)</h2><div class="scroll"><table>
        <thead><tr>
          <th>Entry</th><th>Prop</th><th class="num">Prop P&amp;L</th>
          <th>Live</th><th class="num">Live P&amp;L</th><th class="num">Net</th>
          <th class="num">Mult.</th><th>Link</th><th></th>
        </tr></thead>
        <tbody>${pairRows || `<tr><td colspan="9">${empty("no pairs yet")}</td></tr>`}</tbody>
      </table></div></div>

      ${soloRows ? `<div class="panel"><h2>Unpaired trades</h2><div class="scroll"><table>
        <thead><tr><th>Entry</th><th>Leg</th><th>Symbol</th><th class="num">P&amp;L</th>
          <th>Phase</th></tr></thead>
        <tbody>${soloRows}</tbody></table></div></div>` : ""}
    </div>`;

  modal.showModal();
  const payoutForm = modal.querySelector("#payout-form");
  const payoutNet = modal.querySelector("#payout-net");
  const payoutGross = modal.querySelector("#payout-gross");
  const payoutRedeposit = modal.querySelector("#payout-redeposit");
  const payoutDate = modal.querySelector("#payout-date");
  const payoutButton = modal.querySelector("#save-payout");
  const payoutCancel = modal.querySelector("#cancel-payout");
  let payoutId = null;
  let grossEdited = false;
  let payoutRequestId = crypto.randomUUID();
  payoutGross.oninput = () => { grossEdited = true; };
  payoutNet.oninput = () => {
    if (!grossEdited && Number(c.split_pct) > 0) {
      payoutGross.value = payoutNet.value ? (Number(payoutNet.value) * 100 / Number(c.split_pct)).toFixed(2) : "";
    }
  };
  payoutCancel.onclick = () => {
    payoutForm.reset();
    payoutId = null;
    grossEdited = false;
    payoutRequestId = crypto.randomUUID();
    payoutButton.textContent = "Save payout";
    payoutCancel.hidden = true;
  };
  modal.querySelectorAll("[data-edit-payout]").forEach((button) => {
    button.onclick = () => {
      const event = cashEvents.find((entry) => String(entry.id) === button.dataset.editPayout);
      payoutId = event.id;
      payoutNet.value = event.amount;
      payoutGross.value = event.gross_amount ?? "";
      grossEdited = event.gross_amount != null;
      if (!grossEdited) payoutNet.oninput();
      payoutRedeposit.value = event.redeposit_amount || 0;
      payoutDate.value = event.occurred_on;
      payoutButton.textContent = "Update payout";
      payoutCancel.hidden = false;
      payoutNet.focus();
    };
  });
  payoutForm.onsubmit = async (event) => {
    event.preventDefault();
    if (payoutButton.disabled || !payoutForm.reportValidity()) return;
    const amount = Number(payoutNet.value);
    const gross = Number(payoutGross.value);
    const redeposit = Number(payoutRedeposit.value);
    if (![amount, gross, redeposit].every(Number.isFinite) || amount <= 0 || gross < amount || redeposit < 0 || redeposit > amount) {
      return toast("Gross must cover net received. Redeposit must be between zero and net received.");
    }
    payoutButton.disabled = true;
    try {
      const row = { challenge_id: id, kind: "payout", amount, gross_amount: gross,
        redeposit_amount: redeposit, occurred_on: payoutDate.value, source: "manual" };
      if (payoutId) await save.updateCashEvent(payoutId, row);
      else await save.createCashEvent({ ...row, request_id: payoutRequestId });
      toast("Payout saved");
      modal.close();
      await renderChallenges();
    } catch (err) {
      toast(err.code === "23505" ? "This payout was already saved. Reopen the challenge to check it." : `Error: ${err.message}`);
    } finally {
      payoutButton.disabled = false;
    }
  };
  modal.querySelector("#close-modal").onclick = () => modal.close();
  modal.querySelector("#edit-challenge").onclick = () => {
    modal.close();
    openChallengeEditor(c, firms);
  };
  const resetButton = modal.querySelector("#reset-account");
  if (resetButton) {
    resetButton.onclick = () => {
      modal.close();
      openResetDialog(c, journal, firms);
    };
  }
  // O reporte sai daqui já sabendo qual linha é. Ao fechar, este drill-down
  // volta -- quem reportou não perde o lugar onde estava olhando.
  modal.querySelector("#report-challenge").onclick = () => {
    modal.close();
    openIssueForm({
      area: "challenges",
      targetTable: "challenges",
      targetId: c.id,
      targetLabel: `${c.account_ids || "?"} · ${c.firm || "?"} · ${day(c.date_open)}`,
    }, () => openChallenge(id, journal, firms, progress));
  };
  modal.querySelector("#add-cash").onclick = async () => {
    const kind = modal.querySelector("#cash-kind").value;
    // Pelo tipo do lancamento, nao pelo sinal digitado: um custo entrado como
    // 105 virava +105 e deixava o challenge positivo.
    const amount = signedCash(kind, modal.querySelector("#cash-amount").value);
    if (!amount) return toast("Enter an amount");
    await guard(() => save.createCashEvent({
      challenge_id: id,
      kind,
      amount,
      occurred_on: modal.querySelector("#cash-date").value,
      source: "manual",
    }), "Entry saved");
    modal.close();
    renderChallenges();
  };
  wireEditables(modal, async (field, tradeId, value) => {
    const column = field.split(":")[1];
    const trade = byId.get(Number(tradeId)) || {};

    await guard(() => save.trade(Number(tradeId), column === "phase_id"
      // A fase e atribuicao, nao medicao: o coletor recalcula toda vez, entao
      // sem a marca a escolha voltaria atras sozinha no ciclo seguinte.
      ? manualPatch(trade, { phase_id: value ? Number(value) : null })
      : manualPatch(trade, { [column]: value === "" ? null : Number(value) })), "Saved");

    modal.close();
    renderChallenges();
  });

  // Desfazer o par nao apaga trade nenhuma: as duas continuam no challenge,
  // separadas, e podem ser religadas quando o par certo for identificado.
  modal.querySelectorAll("[data-unlink]").forEach((b) => {
    armDelete(b, "Unlink?", async () => {
      await guard(() => save.deleteLink(Number(b.dataset.unlink)), "Unlinked");
      modal.close();
      renderChallenges();
    });
  });

  modal.querySelectorAll("[data-del-cash]").forEach((b) => {
    b.onclick = async () => {
      await guard(() => save.deleteCashEvent(Number(b.dataset.delCash)), "Removed");
      modal.close();
      renderChallenges();
    };
  });
}

// ------------------------------------------------- editor de um challenge

/**
 * Reset da conta estourada.
 *
 * A mesa devolve a MESMA conta, com o mesmo numero, e o painel abre outra
 * tentativa nela. O QUE escrever fica em `reset-account.js`; aqui e a tela e a
 * ORDEM das escritas -- fechar a tentativa velha antes de abrir a nova.
 *
 * A linha crua de `challenges` e lida de novo de proposito: o journal entrega
 * `split_pct` ja resolvido pelo plano e nao entrega `consistency_addon`.
 */
async function openResetDialog(c, journal, firms) {
  const [phases, row] = await Promise.all([load.phases(c.id), load.challengeRow(c.id)]);
  const alvo = currentPhase(phases);
  if (!alvo) return toast("This challenge has no account to reset");
  const conta = alvo.accounts?.login_or_name || alvo.account_ref || "?";
  const maisNova = newerAttempt(await load.phasesOfAccount(alvo.account_id), alvo.id);
  if (maisNova) {
    return toast(`${accountShort(conta)} already has a newer attempt — `
      + `open challenge ${maisNova.challenge_id} to reset that one`);
  }
  const hoje = new Date().toISOString().slice(0, 10);
  const etapas = statusOptions(c.eval_phases)
    .filter((o) => ["phase1", "phase2", "funded"].includes(o.value));

  modal.innerHTML = `
    <header><h1>Reset ${esc(accountShort(conta))}</h1><span class="spacer"></span>
      <button class="btn ghost" id="cancel-reset">Cancel</button></header>
    <div style="padding:16px;max-width:620px">
      <p class="muted" style="margin-top:0;line-height:1.7">
        The firm hands the account back with the <strong class="bright">same number</strong>,
        so the panel opens a new attempt on <strong class="bright">${esc(conta)}</strong>:
        P&amp;L, trading days, best day and drawdown all count from now.
      </p>
      <p class="muted" style="line-height:1.7">
        Nothing is deleted. The trades of the failed attempt stay on this challenge
        (${esc(c.account_ids || "?")} · ${day(c.date_open)}), which keeps showing what it cost.
      </p>
      <div class="row">
        <div class="field"><label for="reset-stage">Restart as</label>
          <select id="reset-stage">${etapas.map((o) =>
            `<option value="${o.value}">${esc(o.label)}</option>`).join("")}</select></div>
        <div class="field"><label for="reset-cost">Reset cost ($)</label>
          <input id="reset-cost" type="number" min="0" step="0.01" placeholder="0.00"></div>
        <div class="field"><label for="reset-date">Opened on</label>
          <input id="reset-date" type="date" value="${hoje}"></div>
        <div class="field auto"><label>&nbsp;</label>
          <button class="btn" id="do-reset" type="button">Reset account</button></div>
      </div>
      <p class="muted" style="font-size:11px;line-height:1.6">
        The cost is what this attempt has to earn back, and it drives the hedge
        multiplier. Leave it empty when the reset is free. Trades already imported
        stay where they are; the collector can take up to a minute to notice the
        new attempt.
      </p>
    </div>`;

  modal.querySelector("#cancel-reset").onclick = () => {
    modal.close();
    openChallenge(c.id, journal, firms);
  };
  modal.querySelector("#do-reset").onclick = async () => {
    const botao = modal.querySelector("#do-reset");
    botao.disabled = true;
    let plano;
    try {
      plano = planReset(row, phases, {
        at: new Date().toISOString(),
        restartAs: modal.querySelector("#reset-stage").value,
        cost: modal.querySelector("#reset-cost").value,
        date: modal.querySelector("#reset-date").value || hoje,
      });
    } catch (err) {
      botao.disabled = false;
      return toast(err.message);
    }
    let criado = null;
    try {
      await guard(async () => {
        for (const fase of plano.close) await save.phase(fase.id, fase.patch);
        if (plano.challengePatch) await save.challenge(c.id, plano.challengePatch);
        criado = await save.createChallenge(plano.challenge);
        await save.createPhase({ ...plano.phase, challenge_id: criado.id });
        if (plano.cash) await save.createCashEvent({ ...plano.cash, challenge_id: criado.id });
      }, `${accountShort(conta)} reset — new attempt started`);
    } catch {
      // Challenge sem fase nao aparece na tela e ainda prende a conta: desfaz
      // o que entrou antes do erro. O aviso ja saiu no `guard`.
      if (criado) {
        try {
          await save.deleteChallenge(criado.id);
        } catch (falha) {
          toast(`Could not undo challenge ${criado.id}: ${falha.message}`);
        }
      }
      botao.disabled = false;
      return;
    }
    modal.close();
    renderChallenges();
  };
  modal.showModal();
}

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
    const line = bits.join(" <span style='color:var(--color-neutral-400)'>·</span> ");
    return pl.notes
      ? `${line}<div style="color:var(--color-neutral-600);margin-top:5px">${esc(pl.notes)}</div>`
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
      <div id="plan-summary" style="font-size:11px;color:var(--color-neutral-700);
           margin-top:8px;padding:9px 11px;background:var(--color-neutral-100);
           border:1px solid var(--color-divider)">
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
  const [todas, journal, contas] = await Promise.all([
    load.unassigned(), load.journal(), state.machine ? load.accounts() : []]);
  const trades = keepByAccount(todas, contas, state.machine);
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
      <td>${badge(t.account_kind || "prop", t.account_kind || "prop")}</td>
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
    <div class="tool">
      <h2>Unassigned trades</h2>
      <span class="hint">nothing is guessed — the collector only attributes by the
        Copyator magic. What lands here is a manual trade, an old account, one not
        registered yet, or one you took off a challenge.</span>
      <span class="right n" style="color:var(--color-neutral-600);font-size:11px">${
        trades.length} pending</span>
    </div>

    <div class="panel" style="margin-top:0">
      <div class="scroll"><table class="dt n" style="min-width:1000px">
        <thead><tr><th>Exit</th><th>Leg</th><th>Symbol</th><th class="num">P&amp;L</th>
          <th>Comment</th><th>Magic</th><th style="min-width:230px">Assign to</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="7">${empty("nothing pending — all attributed")}</td></tr>`}</tbody>
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
  const [todasContas, stats, todasFontes, firms, plans, progress] = await Promise.all([
    load.accounts(), load.accountStats(), load.discovered(), load.firms(),
    load.plans(), load.progress()]);
  const accounts = keepOfMachine(todasContas, state.machine);
  const discovered = keepOfMachine(todasFontes, state.machine);

  // `claimed` olha TODAS as contas, não só as da máquina em foco: uma fonte já
  // cadastrada na outra máquina continua cadastrada, e oferecê-la de novo aqui
  // criaria a mesma conta duas vezes.
  const claimed = new Set(todasContas.map((a) => `${a.platform}:${a.login_or_name}`));
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

  const firmOpts = [{ value: "", label: "—" }]
    .concat(firms.map((f) => ({ value: f.id, label: f.name })));

  // O onboarding aceita tanto uma conta ja classificada e ainda livre quanto
  // uma fonte que acabou de ser descoberta. Para MT5 o identificador da fonte
  // e o terminal, nao o login digitado depois; por isso a deduplicacao usa o
  // hash do terminal nesse caso.
  const isDiscoveredClaimed = (d) => claimed.has(`${d.platform}:${d.login_or_name}`)
    || (d.platform === "MT5" && accounts.some((a) =>
      a.platform === "MT5" && a.terminal_hash && a.terminal_hash === d.terminal_hash
      && (!d.broker_server || a.broker_server === d.broker_server)));
  const freeRegistered = accounts.filter((a) => {
    const st = statOf.get(a.id);
    return a.kind === "prop" && a.is_active !== false && !st?.in_use;
  });
  const freeDiscovered = discovered.filter((d) => !isDiscoveredClaimed(d));
  // Planos com regras cadastradas viram atalho: é o que a tela da mesa faz --
  // escolher produto e tamanho, e o resto vem junto. Digitar alvo, drawdown e
  // consistência a cada compra foi o que produziu um plano com regra
  // impossível.
  const knownPlans = plans
    .filter((pl) => pl.account_size && pl.profit_target)
    .sort((a, b) => (a.prop_firms?.name || "").localeCompare(b.prop_firms?.name || "")
      || String(a.product || "").localeCompare(String(b.product || ""))
      || Number(a.account_size) - Number(b.account_size));
  const onboardingOptions = [
    ...freeDiscovered.map((d) => ({
      value: `source:${d.id}`,
      platform: d.platform,
      name: d.login_or_name,
      label: `${d.platform} · ${accountShort(d.login_or_name)} · ${d.label} · found`,
    })),
    ...freeRegistered.map((a) => ({
      value: `account:${a.id}`,
      platform: a.platform,
      name: a.login_or_name,
      label: `${a.platform} · ${accountShort(a.login_or_name)} · ${a.label || a.login_or_name} · registered`,
    })),
  ];

  const accountRows = accounts.map((a) => {
    const st = statOf.get(a.id);
    // Saldo é medido (o AddOn do NinjaTrader publica a cada 5s). Editável
    // mesmo assim: para a conta que o AddOn não alcança, digitar é o único
    // caminho -- e o `manual_cols` impede o coletor de apagar o que foi
    // digitado. O título da célula avisa que a marca fica.
    const manual = new Set(a.manual_cols || []);
    const mark = (f) => (manual.has(f) ? " ✎" : "");
    return `
    <tr${a.is_active === false ? ` style="opacity:.5"` : ""}>
      <td>${badge(a.kind, a.kind)}${a.is_active === false
        ? ` <span class="badge">archived</span>` : ""}</td>
      <td><strong class="${blown.has(a.id) ? "blown" : "bright"}">${
        esc(accountShort(a.login_or_name))}</strong></td>
      <td>${esc(a.platform)}</td>
      ${cell(a.login_or_name, { id: a.id, field: "account:login_or_name", type: "text",
        title: "account number/name on the platform — it is what generates the magic",
        format: () => `<span class="${blown.has(a.id) ? "blown" : "muted"}">${
          esc(a.login_or_name)}</span>` })}
      <td class="num">${st && st.trade_count ? cash(st.net_pnl) : `<span class="dim">—</span>`}</td>
      <td class="num muted">${st?.trade_count || "—"}</td>
      ${cell(a.cash_value, { id: a.id, field: "account:cash_value", type: "number", align: true,
        title: "measured by the AddOn — editing stops the collector from overwriting",
        format: () => (a.cash_value != null
          ? `<span class="bright">${money0(a.cash_value)}${mark("cash_value")}</span>`
          : `<span class="dim">—</span>`) })}
      <td>${a.kind === "prop" ? `<select data-plan="${a.id}">
        <option value="">— size —</option>
        ${plans.map((pl) => `<option value="${pl.id}" ${pl.id === a.plan_id ? "selected" : ""}>${
          esc(planLabel(pl))}</option>`).join("")}
      </select>${a.plan_id && a.plan_source === "inferred"
        ? `<div style="font-size:10px;color:var(--color-neutral-600);margin-top:2px">from balance</div>` : ""}`
        : `<span class="dim">—</span>`}</td>
      ${cell(a.label, { id: a.id, field: "account:label", type: "text",
        format: () => `<span class="muted">${esc(a.label || a.terminal_path || "—")}</span>` })}
      <!-- Quem lê esta conta. Escrito pelo coletor no primeiro ciclo em que ele
           a enxerga, e editável porque conta que nenhum coletor alcança (uma
           importada, uma live de corretora) nunca receberia carimbo nenhum. -->
      ${cell(a.machine, { id: a.id, field: "account:machine", type: "text",
        title: "machine whose collector reads this account",
        format: () => `<span class="muted">${a.machine
          ? esc(a.machine) : `<span class="dim">—</span>`}</span>` })}
      ${cell(a.magic_source_part, { id: a.id, field: "account:magic_source_part",
        type: "number", align: true,
        title: "key linking this account to the live hedge — only touch if you know",
        format: () => `<span class="muted">${a.magic_source_part ?? "—"}</span>` })}
      <td class="row" style="gap:6px">
        <button class="btn ghost" data-toggle="${a.id}" data-kind="${a.kind}">
          ${a.kind === "live" ? "prop" : "live"}</button>
        <!-- Trocar de conta live nao pode exigir Delete: a conta antiga carrega
             o historico, e apagar leva as trades junto por cascade. Arquivar
             tira ela do coletor -- que so le is_active -- e das listas de
             escolha, sem encostar em nada gravado. -->
        <button class="btn ghost" data-archive="${a.id}" data-active="${a.is_active !== false}"
          title="${a.is_active === false
            ? "collect this account again"
            : "stop collecting, without deleting the history"}">
          ${a.is_active === false ? "unarchive" : "archive"}</button>
        <button class="btn ghost" data-report-account="${a.id}">Report</button>
        <button class="btn ghost danger" data-del-account="${a.id}"
          data-trades="${st?.trade_count || 0}">Delete</button>
      </td>
    </tr>`;
  }).join("");

  const discoveredRows = discovered.map((d) => {
    return `<tr>
      <td>${esc(d.platform)}</td>
      <td class="muted">${d.machine
        ? esc(d.machine)
        : `<span class="dim" title="found before the collector started stamping the machine">—</span>`}</td>
      <td>${esc(d.label)}</td>
      <td class="muted">${esc(d.login_or_name)}</td>
      <td>${isDiscoveredClaimed(d)
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

  const firmRows = firms.map((f) => `
    <tr>
      ${cell(f.name, { id: f.id, field: "firm:name", type: "text",
        format: () => `<strong class="bright">${esc(f.name)}</strong>` })}
      ${cell(f.platform, { id: f.id, field: "firm:platform", type: "select",
        options: ["NT8", "MT5", "Tradovate", "Other"].map((v) => ({ value: v, label: v })),
        format: () => esc(f.platform) })}
      ${cell(f.eval_phases, { id: f.id, field: "firm:eval_phases", type: "select",
        options: [{ value: 1, label: "1 — straight to funded" },
                  { value: 2, label: "2 — phase 1 + phase 2" }],
        format: () => (Number(f.eval_phases) === 1 ? "1 phase" : "2 phases") })}
      ${cell(f.default_split, { id: f.id, field: "firm:default_split", type: "number", align: true,
        format: () => (f.default_split == null
          ? `<span class="dim">—</span>` : `${num(f.default_split, 0)}%`) })}
      ${cell(f.account_pattern, { id: f.id, field: "firm:account_pattern", type: "text",
        title: "regex for the account name. It limits the account selector on "
             + "Register to this firm. With the (?<funded>) and (?<size>) groups, "
             + "the funded account the firm releases also links itself to the "
             + "passed challenge. Without a pattern the selector shows every "
             + "account of the platform, and the panel asks for the link.",
        format: () => (f.account_pattern
          ? `<code class="muted" style="font-size:11px">${esc(f.account_pattern)}</code>`
          : `<span class="dim" title="no pattern: linking the funded account stays manual"
               >— manual</span>`) })}
      ${cell(f.notes, { id: f.id, field: "firm:notes", type: "text",
        format: () => `<span class="muted">${esc(f.notes || "—")}</span>` })}
      <td class="num muted">${plans.filter((pl) => pl.firm_id === f.id).length}</td>
      <td><button class="btn ghost danger" data-del-firm="${f.id}">Delete</button></td>
    </tr>`).join("");

  // O catálogo inteiro numa tabela só, em vez de uma tabela por mesa: é como a
  // planilha mostrava, e comparar tamanhos entre mesas é justamente o que se
  // quer olhar na hora de comprar a próxima conta.
  const planRows = plans.map((pl) => {
    // O mínimo que vale é derivado da consistência quando ela é mais exigente.
    const efetivo = effectiveMinDays(pl.min_trading_days, pl.consistency_pct);
    const nota = daysNote(pl.min_trading_days, pl.consistency_pct);
    return `
    <tr>
      ${cell(pl.firm_id, { id: pl.id, field: "plan:firm_id", type: "select", options: firmOpts,
        format: () => `<span class="muted">${esc(pl.prop_firms?.name || "—")}</span>` })}
      ${cell(pl.name, { id: pl.id, field: "plan:name", type: "text",
        format: () => esc(pl.name || "—") })}
      ${cell(pl.product, { id: pl.id, field: "plan:product", type: "select",
        options: PRODUCTS,
        title: "the firm's product line. It decides which payout policies the funded "
             + "account can choose — the model name is free text and cannot.",
        format: () => (pl.product
          ? `<span class="muted">${esc(pl.product)}</span>`
          : `<span class="dim">—</span>`) })}
      ${cell(pl.account_size, { id: pl.id, field: "plan:account_size", type: "number", align: true,
        format: () => `<strong class="bright">${money0(pl.account_size)}</strong>` })}
      ${cell(pl.profit_target, { id: pl.id, field: "plan:profit_target", type: "number", align: true,
        format: () => money0(pl.profit_target) })}
      ${cell(pl.profit_target_p2, { id: pl.id, field: "plan:profit_target_p2", type: "number", align: true,
        format: () => (pl.profit_target_p2 == null
          ? `<span class="dim">—</span>` : money0(pl.profit_target_p2)) })}
      ${cell(pl.max_drawdown, { id: pl.id, field: "plan:max_drawdown", type: "number", align: true,
        format: () => money0(pl.max_drawdown) })}
      ${cell(pl.drawdown_type, { id: pl.id, field: "plan:drawdown_type", type: "select",
        options: [{ value: "eod", label: "eod" }, { value: "intraday", label: "intraday" },
                  { value: "static", label: "static" }],
        format: () => `<span class="muted">${esc(pl.drawdown_type)}</span>` })}
      ${cell(pl.daily_loss_limit, { id: pl.id, field: "plan:daily_loss_limit", type: "number", align: true,
        format: () => (pl.daily_loss_limit == null
          ? `<span class="dim">—</span>` : money0(pl.daily_loss_limit)) })}
      ${cell(pl.min_trading_days, { id: pl.id, field: "plan:min_trading_days", type: "number", align: true,
        title: nota || "trading days the firm requires",
        format: () => `${pl.min_trading_days || `<span class="dim">—</span>`}${
          nota ? `<div class="sub">${efetivo} apply</div>` : ""}` })}
      ${cell(pl.consistency_pct, { id: pl.id, field: "plan:consistency_pct", type: "number", align: true,
        title: nota || "no single day may exceed this share of total profit",
        format: () => (pl.consistency_pct == null
          ? `<span class="dim">—</span>` : `${num(pl.consistency_pct, 0)}%`) })}
      ${cell(pl.consistency_addon_pct, { id: pl.id, field: "plan:consistency_addon_pct",
        type: "number", align: true,
        title: "consistency cap when the evaluation is bought with the add-on. Empty "
             + "= the firm does not offer one. On Tradeify Select it takes 40% "
             + "to 50%, which is what allows passing in 2 days instead of 3.",
        format: () => (pl.consistency_addon_pct == null
          ? `<span class="dim">—</span>`
          : `${num(pl.consistency_addon_pct, 0)}%<div class="sub">${
              daysForConsistency(pl.consistency_addon_pct)} days</div>`) })}
      ${cell(pl.profit_split, { id: pl.id, field: "plan:profit_split", type: "number", align: true,
        format: () => (pl.profit_split == null
          ? `<span class="dim">—</span>` : `${num(pl.profit_split, 0)}%`) })}
      ${cell(pl.buffer_multiplier, { id: pl.id, field: "plan:buffer_multiplier", type: "number", align: true,
        title: "added to the hedge multiplier (futures)",
        format: () => (Number(pl.buffer_multiplier)
          ? `+${pl.buffer_multiplier}` : `<span class="dim">—</span>`) })}
      ${cell(pl.buffer_cash, { id: pl.id, field: "plan:buffer_cash", type: "number", align: true,
        title: "added to spend before dividing (CFD)",
        format: () => (Number(pl.buffer_cash)
          ? `+${money0(pl.buffer_cash)}` : `<span class="dim">—</span>`) })}
      ${cell(pl.notes, { id: pl.id, field: "plan:notes", type: "text",
        format: () => `<span class="muted">${esc(pl.notes || "—")}</span>` })}
      <td><button class="btn ghost danger" data-del-plan="${pl.id}">Delete</button></td>
    </tr>`;
  }).join("");

  const setupTabs = [
    ["register", "Register"],
    ["accounts", `Accounts · ${accounts.length}`],
    ["found", `Found · ${discovered.length}`],
    ["firms", `Firms · ${firms.length}`],
    ["plans", `Plans · ${plans.length}`],
    ["account", "Sign-in"],
  ];
  const tab = setupTabs.some(([id]) => id === state.setupTab) ? state.setupTab : "register";

  render(`
    <div class="tool">
      <h2>Setup</h2>
      <span class="hint">what the collector cannot find out on its own</span>
      <button class="btn ghost" id="open-pending" style="margin-left:auto">Pending${
        state.pendingSetup ? ` <span class="pill">${state.pendingSetup}</span>` : ""}</button>
      <span class="snav">${setupTabs.map(([id, label]) =>
        `<button type="button" data-setup-tab="${id}" aria-pressed="${id === tab}">${
          esc(label)}</button>`).join("")}</span>
    </div>

    <div class="panel" data-setup="register" ${tab === "register" ? "" : "hidden"}>
      <h2>Register prop account <span class="dim">one step</span></h2>
      <div class="panel-body">
        <p class="muted" style="margin-top:0">
          Select one or more accounts. Every selected account will use the same
          prop firm, model, size, phases, rules, current stage and cost configured
          below. The app creates a separate challenge for each account.
        </p>
        ${knownPlans.length ? `
        <div style="margin-bottom:14px">
          <label style="display:block;margin-bottom:6px">Known plan</label>
          <div id="plan-picker" class="plan-picker"></div>
          <p class="muted" style="margin:6px 0 0;font-size:11px">
            The plan fills firm, size, target, drawdown, rules, split and cost.
            Everything stays editable.</p>
        </div>` : ""}
        <div class="row">
          <div class="field wide"><label>Accounts *</label>
            <button class="btn ghost" id="onboard-open-accounts" type="button"
                    style="width:100%;text-align:left"
                    ${onboardingOptions.length ? "" : "disabled"}>
              ${onboardingOptions.length ? "Select accounts" : "No free accounts"}
            </button>
            <div class="account-picker-summary" id="onboard-account-summary">
              No accounts selected. Open the selector to choose one or more accounts.
            </div>
          </div>
          <div class="field wide" id="onboard-mt5-fields" hidden></div>
          <div class="field"><label>Prop firm *</label>
            <input id="onboard-firm" list="onboard-firms" placeholder="Tradeify">
            <datalist id="onboard-firms">${firms.map((f) =>
              `<option value="${esc(f.name)}">${esc(f.platform)}</option>`).join("")}</datalist>
          </div>
          <div class="field"><label>Model</label>
            <input id="onboard-model" placeholder="2 Step Standard"></div>
          <div class="field"><label>Account size *</label>
            <input id="onboard-size" type="number" min="1" step="0.01" placeholder="50000"></div>
          <div class="field"><label>Evaluation phases *</label><select id="onboard-phases">
            <option value="2">2 — phase 1 + phase 2</option>
            <option value="1">1 — straight to funded</option>
          </select></div>
          <div class="field"><label>Current stage *</label><select id="onboard-status"></select></div>
        </div>

        <div class="row" style="margin-top:12px">
          <div class="field"><label>Phase 1 target</label>
            <input id="onboard-target-p1" type="number" min="0" step="0.01" placeholder="3000"></div>
          <div class="field" id="onboard-p2-field"><label>Phase 2 target</label>
            <input id="onboard-target-p2" type="number" min="0" step="0.01" placeholder="2500"></div>
          <div class="field"><label>Max drawdown *</label>
            <input id="onboard-drawdown" type="number" min="0" step="0.01" placeholder="2000"></div>
          <div class="field"><label>Drawdown type</label><select id="onboard-dd-type">
            <option value="eod">EOD trailing</option>
            <option value="intraday">Intraday trailing</option>
            <option value="static">Static</option>
          </select></div>
          <div class="field"><label>Purchase cost / account</label>
            <input id="onboard-cost" type="number" min="0" step="0.01" placeholder="99"></div>
          <div class="field"><label>Opened</label>
            <input id="onboard-date" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
          <!-- Do CHALLENGE, não do plano: o add-on é comprado com cada
               avaliação, e o mesmo modelo tem contas com e sem. -->
          <div class="field"><label>Bought with add-on</label>
            <label class="row" style="gap:6px;align-items:center;margin-top:6px">
              <input id="onboard-addon" type="checkbox">
              <span class="muted" style="font-size:11px">uses the add-on cap</span>
            </label></div>
        </div>

        <details style="margin-top:12px">
          <summary class="muted" style="cursor:pointer;font-size:10px">More rules</summary>
          <div class="row" style="margin-top:10px">
            <div class="field"><label>Daily loss limit</label>
              <input id="onboard-daily-loss" type="number" min="0" step="0.01"></div>
            <div class="field"><label>Minimum trading days</label>
              <input id="onboard-min-days" type="number" min="0" step="1"></div>
            <div class="field"><label>Consistency (%)</label>
              <input id="onboard-consistency" type="number" min="0" max="100" step="0.01"></div>
            <div class="field"><label>Consistency add-on (%)</label>
              <input id="onboard-consistency-addon" type="number" min="0" max="100" step="0.01"
                     title="cap when the evaluation comes with the add-on. Empty if the firm offers none."></div>
            <div class="field"><label>Payout split (%)</label>
              <input id="onboard-split" type="number" min="0" max="100" step="0.01"></div>
            <div class="field"><label>Futures buffer ×</label>
              <input id="onboard-buffer-mult" type="number" min="0" step="0.0001" placeholder="0.03"></div>
            <div class="field"><label>CFD buffer $</label>
              <input id="onboard-buffer-cash" type="number" min="0" step="0.01"></div>
            <div class="field wide"><label>Notes</label>
              <input id="onboard-notes" placeholder="optional"></div>
          </div>
        </details>

        <div class="row" style="margin-top:12px">
          <div class="field auto"><button class="btn" id="register-prop"
              ${onboardingOptions.length ? "" : "disabled"}>Register and link</button></div>
        </div>
      </div>
    </div>

    <div class="panel" data-setup="accounts" ${tab === "accounts" ? "" : "hidden"}>
      <h2>Registered accounts</h2>
      <div class="scroll"><table>
        <thead><tr><th>Kind</th><th>ID</th><th>Platform</th><th>Account</th>
          <th class="num">P&amp;L</th><th class="num">Trades</th>
          <th class="num">Balance</th><th>Plan</th>
          <th>Terminal</th><th>Machine</th>
          <th class="num">magic_source_part</th><th></th></tr></thead>
        <tbody>${accountRows || `<tr><td colspan="12">${empty("no accounts yet — register one below")}</td></tr>`}</tbody>
      </table></div>
    </div>

    <div class="panel" data-setup="found" ${tab === "found" ? "" : "hidden"}>
      <h2>Found by the collector</h2>
      <div class="panel-body" style="padding-bottom:0">
        <p class="muted" style="margin-top:0">
          Every machine running the collector publishes what it found; you decide which is
          live and which is prop. For MT5 enter the login — the account number only shows
          with the terminal open.
        </p>
      </div>
      <div class="scroll"><table>
        <thead><tr><th>Platform</th><th>Machine</th><th>Terminal</th>
          <th>Identifier</th><th>Classify</th></tr></thead>
        <tbody>${discoveredRows || `<tr><td colspan="5">${empty("run: python -m collector.discovery --push")}</td></tr>`}</tbody>
      </table></div>
    </div>

    <div class="panel" data-setup="firms" ${tab === "firms" ? "" : "hidden"}>
      <h2>Prop firms</h2>
      <div class="scroll"><table>
        <thead><tr><th>Name</th><th>Platform</th><th>Phases</th><th class="num">Split</th>
          <th title="with it, the funded account links itself to the passed challenge"
            >Account name pattern</th>
          <th>Notes</th><th class="num">Plans</th><th></th></tr></thead>
        <tbody>${firmRows || `<tr><td colspan="8">${empty("no firms yet")}</td></tr>`}</tbody>
      </table></div>
      <div class="panel-body row">
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
          <button class="btn" id="add-firm">Add firm</button></div>
      </div>
    </div>

    <div class="panel" data-setup="plans" ${tab === "plans" ? "" : "hidden"}>
      <h2>Plans <span class="dim">${plans.length}</span></h2>
      <div class="panel-body" style="padding-bottom:0">
        <p class="muted" style="margin-top:0">
          The rules per account size. This is what lets the panel know, on its own,
          how far each account is from its target — every cell is editable.
        </p>
      </div>
      <div class="scroll"><table>
        <thead><tr><th>Firm</th><th>Model</th>
          <th title="decides which payout policies are available">Product</th>
          <th class="num">Size</th>
          <th class="num">Target</th><th class="num">Target P2</th>
          <th class="num">Drawdown</th><th>DD type</th><th class="num">Daily loss</th>
          <th class="num">Min days</th><th class="num">Consist.</th>
          <th class="num" title="cap with the add-on bought">Add-on</th>
          <th class="num">Split</th>
          <th class="num">Buffer &times;</th><th class="num">Buffer $</th>
          <th>Notes</th><th></th></tr></thead>
        <tbody>${planRows || `<tr><td colspan="15">${empty("no plans — add one below")}</td></tr>`}</tbody>
      </table></div>
      <div class="panel-body row">
        <div class="field"><label>Firm</label><select id="plan-firm">${
          firms.map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join("")
        }</select></div>
        <div class="field"><label>Model</label><input id="plan-name" placeholder="2 Step Standard"></div>
        <div class="field"><label>Size</label><input id="plan-size" type="number" placeholder="50000"></div>
        <div class="field"><label>Target</label><input id="plan-target" type="number" placeholder="3000"></div>
        <div class="field"><label>Drawdown</label><input id="plan-dd" type="number" placeholder="2000"></div>
        <div class="field auto"><label>&nbsp;</label>
          <button class="btn" id="add-plan">Add plan</button></div>
      </div>
    </div>

    <div class="panel" data-setup="account" ${tab === "account" ? "" : "hidden"}>
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
    </div>`);

  wireEditables(view, (field, id, value) => saveSetupField(field, id, value, accounts, plans));

  // Reabrir o aviso na mao. Ele so aparece sozinho quando surge pendencia
  // NOVA -- e quem clicou em "Later" uma vez ficava sem nenhuma porta para
  // voltar, com a resposta pendente e nada na tela oferecendo respondê-la.
  document.getElementById("open-pending").onclick = async () => {
    // Com `try`: um `onclick` async sem ele transforma qualquer erro em nada
    // acontecendo -- foi assim que este botao pareceu morto na primeira vez.
    try {
      const { items, plans, accounts: fresh } = await loadPending();
      state.pendingSetup = items.length;
      renderNav();
      if (!items.length) return toast("Nothing pending");
      openPendingForm(items, plans, fresh, items.map((i) => i.key).sort().join(","));
    } catch (err) {
      console.error("pending:", err);
      toast(`Pending failed: ${err.message}`);
    }
  };

  // A aba so troca a visibilidade: tudo ja esta montado e ligado, entao nao ha
  // consulta nem redesenho aqui.
  view.querySelectorAll("[data-setup-tab]").forEach((b) => {
    b.onclick = () => {
      state.setupTab = b.dataset.setupTab;
      view.querySelectorAll("[data-setup]").forEach((panel) => {
        panel.hidden = panel.dataset.setup !== state.setupTab;
      });
      view.querySelectorAll("[data-setup-tab]").forEach((other) => {
        other.setAttribute("aria-pressed", String(other.dataset.setupTab === state.setupTab));
      });
    };
  });

  const onboardPhases = document.getElementById("onboard-phases");
  const onboardStatus = document.getElementById("onboard-status");
  const onboardAccountSummary = document.getElementById("onboard-account-summary");
  const onboardOpenAccounts = document.getElementById("onboard-open-accounts");
  const onboardMt5Fields = document.getElementById("onboard-mt5-fields");
  const onboardFirm = document.getElementById("onboard-firm");
  const onboardButton = document.getElementById("register-prop");
  const selectedOnboardingValues = new Set();

  // O seletor pergunta o plano na ordem em que a mesa vende -- ver
  // `plan-picker.js`. Aqui fica o que o plano escolhido faz no formulário:
  // preenche tudo, e cada campo continua editável, porque a mesa muda preço e
  // regra sem avisar e o cadastro não pode virar refém do catálogo.
  const addonField = document.getElementById("onboard-addon");
  let chosenPlan = null;

  // O add-on tem preço próprio: soma no custo só quando marcado.
  const syncAddonCost = () => {
    const custo = document.getElementById("onboard-cost");
    const base = Number(chosenPlan?.price) || 0;
    if (!base || !custo) return;
    const extra = Number(chosenPlan.consistency_addon_price) || 0;
    custo.value = addonField?.checked ? base + extra : base;
  };

  const applyPlan = (pl) => {
    chosenPlan = pl;
    // Escreve MESMO vazio. Pular o que o plano nao tem deixava o valor do
    // plano anterior no campo: escolher Tradeify e trocar para Fundingpips
    // salvava o challenge com os 40% de consistencia e o preco da Tradeify.
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.value = value ?? "";
    };
    set("onboard-firm", pl.prop_firms?.name || "");
    set("onboard-model", pl.name || "");
    set("onboard-size", pl.account_size);
    set("onboard-phases", pl.eval_phases || 1);
    set("onboard-target-p1", pl.profit_target);
    set("onboard-target-p2", pl.profit_target_p2);
    set("onboard-drawdown", pl.max_drawdown);
    set("onboard-dd-type", pl.drawdown_type || "eod");
    set("onboard-daily-loss", pl.daily_loss_limit);
    set("onboard-min-days", pl.min_trading_days);
    set("onboard-consistency", pl.consistency_pct);
    set("onboard-consistency-addon", pl.consistency_addon_pct);
    set("onboard-split", pl.profit_split);
    set("onboard-buffer-mult", pl.buffer_multiplier);
    set("onboard-buffer-cash", pl.buffer_cash);
    set("onboard-cost", pl.price);

    // Trocar de tamanho no mesmo produto mantém o upgrade marcado, como na
    // tela da mesa; ir para um plano sem add-on desmarca, senão o challenge
    // sairia com uma regra que o plano não tem.
    if (addonField) {
      addonField.disabled = pl.consistency_addon_pct == null;
      if (addonField.disabled) addonField.checked = false;
      const etiqueta = addonField.parentElement?.querySelector("span");
      if (etiqueta) {
        etiqueta.textContent = pl.consistency_addon_pct == null
          ? "this firm offers none"
          : `${num(pl.consistency_addon_pct, 0)}% · ${
              daysForConsistency(pl.consistency_addon_pct)} days${
              pl.consistency_addon_price ? ` · +${money0(pl.consistency_addon_price)}` : ""}`;
      }
    }
    syncAddonCost();
    toast(`${pl.prop_firms?.name || "?"} ${pl.name || ""} ${money0(pl.account_size)} loaded`);
  };

  const pickerBox = document.getElementById("plan-picker");
  const planPicker = pickerBox
    ? mountPlanPicker(pickerBox, knownPlans, {
        daysFor: daysForConsistency,
        addonChecked: () => Boolean(addonField?.checked),
        onFirm: (name) => {
          pickerFirmName = name;
          pruneForFirm();
        },
        onPlan: applyPlan,
        onAddon: (checked) => {
          if (addonField) addonField.checked = checked;
          syncAddonCost();
        },
      })
    : null;
  // O campo do formulário e o botão do seletor são o mesmo add-on: mexer num
  // tem que aparecer no outro.
  if (addonField) {
    addonField.onchange = () => {
      syncAddonCost();
      planPicker?.redraw();
    };
  }

  const resolveOnboardingAccount = (value) => {
    const [kind, rawId] = (value || "").split(":");
    const id = Number(rawId);
    if (kind === "source") return { value, kind, row: discovered.find((d) => d.id === id) };
    if (kind === "account") return { value, kind, row: accounts.find((a) => a.id === id) };
    return { value, kind: null, row: null };
  };

  const selectedOnboardingAccounts = () => [...selectedOnboardingValues]
    .map((value) => resolveOnboardingAccount(value))
    .filter((selected) => selected.row);

  const mt5LoginFor = (selected) => [...onboardMt5Fields.querySelectorAll("[data-mt5-login]")]
    .find((input) => input.dataset.mt5Login === selected.value)?.value.trim() || "";

  const refreshOnboardingAccounts = () => {
    const previous = new Map([...onboardMt5Fields.querySelectorAll("[data-mt5-login]")]
      .map((input) => [input.dataset.mt5Login, input.value]));
    const mt5Sources = selectedOnboardingAccounts().filter((selected) =>
      selected.kind === "source" && selected.row.platform === "MT5");
    const selected = selectedOnboardingAccounts();
    const shown = selected.slice(0, 6).map((item) =>
      `${item.row.platform} ${accountShort(item.row.login_or_name)}`);
    const extra = selected.length > shown.length ? ` · +${selected.length - shown.length} more` : "";
    onboardAccountSummary.innerHTML = selected.length
      ? `<strong class="bright">${selected.length} account${selected.length === 1 ? "" : "s"} selected</strong><br>
         ${esc(shown.join(" · "))}${esc(extra)}`
      : "No accounts selected. Open the selector to choose one or more accounts.";
    const firm = accountsFirm();
    const livres = filterForFirm(onboardingOptions, firm).shown.length;
    onboardOpenAccounts.textContent = selected.length
      ? `Change accounts (${selected.length})`
      : firm ? `Select ${firm.name} accounts · ${livres} free` : "Select accounts";
    onboardMt5Fields.hidden = mt5Sources.length === 0;
    onboardMt5Fields.innerHTML = mt5Sources.map((selected) => `
      <div class="field" style="margin-bottom:6px">
        <label>MT5 login · ${esc(selected.row.label)} *</label>
        <input data-mt5-login="${esc(selected.value)}" inputmode="numeric"
               value="${esc(previous.get(selected.value) || "")}" placeholder="12345678">
      </div>`).join("");
  };

  const openAccountPicker = () => {
    const draft = new Set(selectedOnboardingValues);
    const firm = accountsFirm();
    const { shown, hidden, rule } = filterForFirm(onboardingOptions, firm);
    // Filtro com saída: conta nova cujo nome o padrão ainda não cobre não pode
    // ficar sem cadastro.
    let showAll = false;
    const filtered = () => rule !== null && !showAll;
    const visible = () => (filtered() ? shown : onboardingOptions);
    // Em massa, só o que está na tela. Sem mesa continua "todas do NinjaTrader":
    // misturar plataformas o cadastro recusa de qualquer jeito.
    const bulk = () => (filtered() ? shown
      : onboardingOptions.filter((o) => o.platform === "NT8"));

    modal.innerHTML = `
      <header><h1>Select accounts</h1><span class="spacer"></span>
        <span class="muted" id="picker-count"></span>
        <button class="btn ghost" id="picker-cancel">Cancel</button></header>
      <div style="padding:16px">
        <p class="muted" style="margin-top:0;line-height:1.7">
          Every account selected here will receive the <strong class="bright">same prop firm,
          model, account size, phase rules, current stage and purchase cost</strong> configured
          on the Setup screen. The app creates one separate challenge per account.
        </p>
        <div class="account-picker-filter" id="picker-filter"></div>
        <div class="account-picker-list" id="picker-list"></div>
        <div class="row" style="margin-top:12px">
          <button class="btn ghost" id="picker-all" type="button"></button>
          <button class="btn ghost" id="picker-clear" type="button">Clear</button>
          <span style="flex:1"></span>
          <button class="btn" id="picker-apply" type="button">Use selected accounts</button>
        </div>
      </div>`;

    const q = (id) => modal.querySelector(`#${id}`);
    const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

    const draw = () => {
      let aviso;
      if (!firm) {
        aviso = `<span class="muted">Pick the prop firm above to see only its accounts.</span>
          <span class="warn">Do not mix accounts from different firms, models or sizes.</span>`;
      } else if (showAll) {
        aviso = `<span><strong class="bright">All ${onboardingOptions.length} free accounts</strong>
          <span class="muted">— filter off. Pick only ${esc(firm.name)} accounts.</span></span>`;
      } else if (rule === "pattern") {
        aviso = `<span><strong class="bright">${esc(plural(shown.length, `${firm.name} account`))}</strong>
          <span class="muted">— names matching <code>${esc(firm.account_pattern)}</code></span></span>`;
      } else {
        const plataforma = firm.platform && firm.platform !== "Other" ? `${firm.platform} ` : "";
        aviso = `<span><strong class="bright">${esc(plural(shown.length, `${plataforma}account`))}</strong>
          <span class="muted">— ${esc(firm.name)} has no account name pattern.
          Add one under Firms to list only its accounts.</span></span>`;
      }
      if (firm && hidden.length) {
        aviso += `<button class="btn ghost" type="button" id="picker-toggle">${
          showAll ? `Only ${esc(firm.name)}` : `Show all ${onboardingOptions.length}`}</button>`;
      }
      q("picker-filter").innerHTML = aviso;

      const lista = visible();
      q("picker-list").innerHTML = lista.length
        ? lista.map((o) => `
          <label class="account-picker-option">
            <input type="checkbox" data-picker-account value="${esc(o.value)}"
                   ${draft.has(o.value) ? "checked" : ""}>
            <span>${esc(o.label)}</span>
          </label>`).join("")
        : `<div class="account-picker-empty muted">No free ${esc(firm?.name || "")} account found.${
            hidden.length ? " Show all to pick one the pattern missed." : ""}</div>`;

      modal.querySelectorAll("[data-picker-account]").forEach((input) => {
        input.onchange = () => {
          if (input.checked) draft.add(input.value);
          else draft.delete(input.value);
          refreshCount();
        };
      });
      const toggle = q("picker-toggle");
      if (toggle) toggle.onclick = () => { showAll = !showAll; draw(); };
      q("picker-all").textContent = filtered() ? `Select all ${firm.name}` : "Select all NT8";
      q("picker-all").disabled = !bulk().length;
      refreshCount();
    };
    const refreshCount = () => {
      q("picker-count").textContent = `${draft.size} selected`;
    };

    q("picker-cancel").onclick = () => modal.close();
    q("picker-all").onclick = () => {
      draft.clear();
      bulk().forEach((o) => draft.add(o.value));
      draw();
    };
    q("picker-clear").onclick = () => {
      draft.clear();
      draw();
    };
    q("picker-apply").onclick = () => {
      selectedOnboardingValues.clear();
      draft.forEach((value) => selectedOnboardingValues.add(value));
      modal.close();
      refreshOnboardingAccounts();
    };
    draw();
    modal.showModal();
  };

  const refreshOnboardingStages = () => {
    const phases = Number(onboardPhases.value);
    const previous = onboardStatus.value;
    const options = statusOptions(phases)
      .filter((o) => ["phase1", "phase2", "funded"].includes(o.value));
    onboardStatus.innerHTML = options.map((o) =>
      `<option value="${o.value}" ${o.value === previous ? "selected" : ""}>${
        esc(o.label)}</option>`).join("");
    document.getElementById("onboard-p2-field").hidden = phases !== 2;
  };

  const existingOnboardingFirm = () => {
    const wanted = onboardFirm.value.trim().toLocaleLowerCase();
    return firms.find((f) => f.name.trim().toLocaleLowerCase() === wanted);
  };

  onboardOpenAccounts.onclick = openAccountPicker;
  onboardPhases.onchange = refreshOnboardingStages;
  // A mesa que decide quais contas o seletor mostra. O clique no seletor de
  // plano vale antes do campo: na Fundingpips a mesa está escolhida muitos
  // cliques antes de o plano fechar e preencher o formulário. O clique NÃO
  // escreve no campo, porque o campo é o que vai para o cadastro -- a mesa
  // nova sairia com as regras do plano anterior ainda nos outros campos.
  let pickerFirmName = null;
  const accountsFirm = () => {
    const wanted = (pickerFirmName || "").trim().toLocaleLowerCase();
    return (wanted && firms.find((f) => f.name.trim().toLocaleLowerCase() === wanted))
      || existingOnboardingFirm();
  };

  // Trocar de mesa depois de marcar contas: as que não são da mesa nova
  // sairiam cadastradas com o plano dela.
  const pruneForFirm = () => {
    const firm = accountsFirm();
    if (firm && selectedOnboardingValues.size) {
      const daMesa = new Set(filterForFirm(onboardingOptions, firm).shown.map((o) => o.value));
      const fora = [...selectedOnboardingValues].filter((value) => !daMesa.has(value));
      fora.forEach((value) => selectedOnboardingValues.delete(value));
      if (fora.length) {
        toast(`${fora.length} selected account${fora.length === 1 ? " is" : "s are"} `
          + `not ${firm.name} — removed`);
      }
    }
    refreshOnboardingAccounts();
  };

  onboardFirm.onchange = () => {
    // Digitar a mesa é escolha mais recente que o clique no seletor.
    pickerFirmName = null;
    pruneForFirm();
    const firm = existingOnboardingFirm();
    if (!firm) return;
    onboardPhases.value = String(firm.eval_phases || 2);
    if (firm.default_split != null) {
      document.getElementById("onboard-split").value = firm.default_split;
    }
    refreshOnboardingStages();
  };
  refreshOnboardingAccounts();
  refreshOnboardingStages();

  onboardButton.onclick = async () => {
    const selected = selectedOnboardingAccounts();
    const firmName = onboardFirm.value.trim();
    const size = Number(document.getElementById("onboard-size").value);
    const drawdown = Number(document.getElementById("onboard-drawdown").value);
    const evalPhases = Number(onboardPhases.value);
    const status = onboardStatus.value;
    const numberOrNull = (id) => {
      const raw = document.getElementById(id).value.trim();
      return raw === "" ? null : Number(raw);
    };

    if (!selected.length) return toast("Choose at least one account");
    if (!firmName) return toast("Enter the prop firm name");
    // Clicou numa mesa no seletor e não fechou modelo e tamanho: as contas
    // escolhidas são da mesa nova, mas o formulário ainda tem a mesa e as
    // regras do plano anterior. Cadastrar assim grava conta da Tradeify com o
    // drawdown da FFF.
    const mesaDoSeletor = accountsFirm();
    if (pickerFirmName && mesaDoSeletor
        && mesaDoSeletor.name.trim().toLocaleLowerCase() !== firmName.toLocaleLowerCase()) {
      return toast(`Finish picking the ${mesaDoSeletor.name} plan — the form still has ${firmName}`);
    }
    if (!(size > 0)) return toast("Enter the account size");
    if (!(drawdown > 0)) return toast("Enter the max drawdown");

    const platforms = new Set(selected.map((item) => item.row.platform));
    if (platforms.size !== 1) {
      return toast("Select accounts from only one platform");
    }
    const platform = selected[0].row.platform;
    const mt5Logins = new Map();
    for (const item of selected) {
      if (item.kind !== "source" || item.row.platform !== "MT5") continue;
      const login = mt5LoginFor(item);
      if (!/^\d+$/.test(login)) return toast(`Enter the MT5 login for ${item.row.label}`);
      if ([...mt5Logins.values()].includes(login)) return toast(`MT5 login ${login} is duplicated`);
      mt5Logins.set(item.value, login);
    }

    const modelInput = document.getElementById("onboard-model").value.trim();
    const modelName = modelInput || `${evalPhases} Step`;
    const targetP1 = numberOrNull("onboard-target-p1");
    const targetP2 = evalPhases === 2 ? numberOrNull("onboard-target-p2") : null;
    const dailyLoss = numberOrNull("onboard-daily-loss");
    const minDays = numberOrNull("onboard-min-days");
    const consistency = numberOrNull("onboard-consistency");
    const consistencyAddon = numberOrNull("onboard-consistency-addon");
    const addon = document.getElementById("onboard-addon")?.checked || false;
    const split = numberOrNull("onboard-split");
    const bufferMultiplier = numberOrNull("onboard-buffer-mult");
    const bufferCash = numberOrNull("onboard-buffer-cash");
    const cost = numberOrNull("onboard-cost");
    const opened = document.getElementById("onboard-date").value || null;
    const notes = document.getElementById("onboard-notes").value.trim() || null;

    const nonNegative = [targetP1, targetP2, dailyLoss, minDays, consistency,
      split, bufferMultiplier, bufferCash, cost];
    if (nonNegative.some((value) => value != null
        && (!Number.isFinite(value) || value < 0))) {
      return toast("Rule values cannot be negative");
    }
    if (minDays != null && !Number.isInteger(minDays)) {
      return toast("Minimum trading days must be an integer");
    }
    if (consistency != null && consistency > 100) {
      return toast("Consistency must be between 0 and 100");
    }
    if (split != null && split > 100) {
      return toast("Payout split must be between 0 and 100");
    }

    const created = { firmId: null, planId: null, accountIds: [], challengeIds: [] };
    const originalAccountPlans = new Map();
    const linkedAccountIds = [];

    onboardButton.disabled = true;
    try {
      await guard(async () => {
        let firm = existingOnboardingFirm();
        if (firm && firm.platform !== platform
            && !(firm.platform === "Tradovate" && platform === "NT8")) {
          throw new Error(`${firm.name} is ${firm.platform}, but the account is ${platform}`);
        }
        if (!firm) {
          firm = await save.createFirm({
            name: firmName,
            platform,
            eval_phases: evalPhases,
            default_split: split,
          });
          created.firmId = firm.id;
        }

        let plan = plans.find((pl) => Number(pl.firm_id) === Number(firm.id)
          && Number(pl.account_size) === size
          && String(pl.name || "").trim().toLocaleLowerCase() === modelName.toLocaleLowerCase());
        if (plan) {
          const existingPhases = Number(plan.eval_phases ?? firm.eval_phases ?? 2);
          if (existingPhases !== evalPhases) {
            throw new Error(`${modelName} already exists with ${existingPhases} phase(s)`);
          }
        } else {
          plan = await save.createPlan({
            firm_id: firm.id,
            name: modelName,
            account_size: size,
            eval_phases: evalPhases,
            profit_target: targetP1,
            profit_target_p2: targetP2,
            max_drawdown: drawdown,
            drawdown_type: document.getElementById("onboard-dd-type").value,
            daily_loss_limit: dailyLoss,
            min_trading_days: minDays ?? 0,
            consistency_pct: consistency,
            consistency_addon_pct: consistencyAddon,
            profit_split: split,
            // Zero por padrao, em qualquer plataforma. O +0,03 que ficava aqui
            // para NT8 era a protecao de slippage da epoca em que o desconto do
            // spread era chutado; hoje ele e medido dos proprios pares e entra
            // como divisao pela `delivery`, que escala com o multiplicador. A
            // migration 0024 zerou o campo em todos os planos justamente por
            // isso -- e este default o ressuscitava a cada plano NT8 novo.
            //
            // Somar constante em cima de um desconto proporcional distorce mais
            // onde menos se precisa: 0,03 sobre 0,06 e +50%, sobre 0,50 e +6%.
            // Para proteger de proposito, use `buffer_cash`: entra no gasto
            // antes da divisao e escala junto.
            buffer_multiplier: bufferMultiplier ?? 0,
            buffer_cash: bufferCash ?? 0,
            notes,
          });
          created.planId = plan.id;
        }

        for (const item of selected) {
          if (item.kind === "source") {
            const source = item.row;
            const login = platform === "MT5"
              ? mt5Logins.get(item.value) : source.login_or_name;
            const account = await save.createAccount({
              kind: "prop",
              platform,
              login_or_name: login,
              label: source.label,
              terminal_hash: source.terminal_hash,
              terminal_path: source.terminal_path,
              broker_server: source.broker_server,
              magic_source_part: magicSourcePart(platform, login),
              plan_id: plan.id,
              plan_source: "manual",
            });
            linkedAccountIds.push(account.id);
            created.accountIds.push(account.id);
          } else {
            const accountId = item.row.id;
            originalAccountPlans.set(accountId, {
              plan_id: item.row.plan_id ?? null,
              plan_source: item.row.plan_source ?? null,
            });
            await save.account(accountId, { plan_id: plan.id, plan_source: "manual" });
            linkedAccountIds.push(accountId);
          }
        }

        const phase = { phase1: "P1", phase2: "P2", funded: "FUNDED" }[status];
        for (const accountId of linkedAccountIds) {
          const challenge = await save.createChallenge({
            firm_id: firm.id,
            plan_id: plan.id,
            date_open: opened,
            status,
            target: targetP1,
            split_pct: split,
            consistency_addon: addon,
            comments: notes,
          });
          created.challengeIds.push(challenge.id);

          await save.createPhase({
            challenge_id: challenge.id,
            phase,
            account_id: accountId,
            started_at: new Date().toISOString(),
            outcome: "active",
          });

          if (cost != null && cost !== 0) {
            await save.createCashEvent({
              challenge_id: challenge.id,
              kind: "cost",
              amount: signedCash("cost", cost),
              occurred_on: opened || new Date().toISOString().slice(0, 10),
              source: "manual",
            });
          }
        }
      }, `${selected.length} prop account${selected.length === 1 ? "" : "s"} registered`);
      renderConfig();
    } catch (error) {
      const rollbackErrors = [];
      const rollback = async (label, fn) => {
        try {
          await fn();
        } catch (rollbackError) {
          rollbackErrors.push(`${label}: ${rollbackError.message}`);
        }
      };
      for (const challengeId of [...created.challengeIds].reverse()) {
        await rollback(`challenge ${challengeId}`, () => save.deleteChallenge(challengeId));
      }
      for (const accountId of [...created.accountIds].reverse()) {
        await rollback(`account ${accountId}`, () => save.deleteAccount(accountId));
      }
      for (const [accountId, originalPlan] of originalAccountPlans) {
        await rollback(`account plan ${accountId}`, () => save.account(accountId, originalPlan));
      }
      if (created.planId) await rollback("plan", () => save.deletePlan(created.planId));
      if (created.firmId) await rollback("firm", () => save.deleteFirm(created.firmId));
      if (rollbackErrors.length) toast(`Rollback error: ${rollbackErrors.join("; ")}`);
    } finally {
      if (document.body.contains(onboardButton)) onboardButton.disabled = false;
    }
  };

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

  view.querySelectorAll("[data-archive]").forEach((b) => {
    b.onclick = async () => {
      const ativa = b.dataset.active === "true";
      await guard(() => save.account(Number(b.dataset.archive), { is_active: !ativa }),
        ativa ? "Account archived" : "Account back");
      renderConfig();
    };
  });

  view.querySelectorAll("[data-del-account]").forEach((b) => {
    const trades = Number(b.dataset.trades);
    armDelete(b, trades ? `Delete + ${trades} trades?` : "Delete?", async () => {
      await guard(() => save.deleteAccount(Number(b.dataset.delAccount)), "Account deleted");
      renderConfig();
    });
  });

  view.querySelectorAll("[data-del-firm]").forEach((b) => {
    armDelete(b, "Firm + its plans?", async () => {
      await guard(() => save.deleteFirm(Number(b.dataset.delFirm)), "Firm deleted");
      renderConfig();
    });
  });

  view.querySelectorAll("[data-del-plan]").forEach((b) => {
    armDelete(b, "Sure?", async () => {
      await guard(() => save.deletePlan(Number(b.dataset.delPlan)), "Plan deleted");
      renderConfig();
    });
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

  document.getElementById("add-plan").onclick = async () => {
    const size = Number(document.getElementById("plan-size").value);
    const target = Number(document.getElementById("plan-target").value);
    const drawdown = Number(document.getElementById("plan-dd").value);
    if (!firms.length) return toast("Add a firm first");
    if (!size) return toast("Enter the account size");
    // Alvo e drawdown são NOT NULL no banco: barrar aqui dá uma mensagem que se
    // entende, em vez do erro cru do Postgres.
    if (!target || !drawdown) return toast("Target and drawdown are required");

    await guard(() => save.createPlan({
      firm_id: Number(document.getElementById("plan-firm").value),
      name: document.getElementById("plan-name").value.trim() || null,
      account_size: size,
      profit_target: target,
      max_drawdown: drawdown,
    }), "Plan added");
    renderConfig();
  };
}

/**
 * Grava uma célula do Setup. O prefixo do campo diz a que tabela ela pertence
 * -- `wireEditables` liga a raiz inteira de uma vez, e a página tem três
 * tabelas editáveis.
 */
async function saveSetupField(field, id, raw, accounts, plans = []) {
  const [table, column] = field.split(":");
  const rowId = Number(id);
  const value = raw === "" ? null : raw;
  const number = () => (value === null ? null : Number(value));

  // Regex quebrada nao daria erro na hora: ela some dentro do coletor, o link
  // automatico simplesmente para de acontecer, e a pessoa fica esperando uma
  // ligacao que nunca vem. Conferir aqui custa uma linha.
  if (field === "firm:account_pattern" && value) {
    try {
      // O Python aceita `(?P<x>...)`; o JS so `(?<x>...)`. Traduzir antes de
      // testar evita reprovar um padrao valido no coletor.
      new RegExp(value.replace(/\(\?P</g, "(?<"));
    } catch (err) {
      return toast(`Invalid pattern: ${err.message}`);
    }
    // Padrão sem grupo também serve: ele separa as contas da mesa no
    // cadastro. Os grupos (?<funded>) e (?<size>) só acrescentam o link
    // automático da conta funded e o plano pelo nome -- a Blue Guardian não
    // escreve nenhum dos dois no nome da conta.
  }

  await guard(async () => {
    if (table === "firm") {
      const patch = ["eval_phases", "default_split"].includes(column)
        ? { [column]: number() } : { [column]: value };
      return save.firm(rowId, patch);
    }

    if (table === "plan") {
      const patch = ["drawdown_type", "name", "notes", "product"].includes(column)
        ? { [column]: value } : { [column]: number() };
      const salvo = await save.plan(rowId, patch);
      // Não é erro, é consequência: dizer na hora evita a pessoa procurar por
      // que a conta ainda pede dias depois de cumprir o mínimo digitado.
      if (["min_trading_days", "consistency_pct"].includes(column)) {
        const plano = { ...(plans.find((p) => p.id === rowId) || {}), ...patch };
        const nota = daysNote(plano.min_trading_days, plano.consistency_pct);
        if (nota) toast(nota);
      }
      return salvo;
    }

    // Conta: `cash_value` e `magic_source_part` são medidos/derivados, então a
    // correção precisa da marca -- sem ela o coletor devolve o valor antigo no
    // ciclo seguinte e a edição parece não ter funcionado.
    const account = accounts.find((a) => a.id === rowId) || {};
    const patch = ["cash_value", "magic_source_part"].includes(column)
      ? manualPatch(account, { [column]: number() })
      : { [column]: value };
    return save.account(rowId, patch);
  }, "Saved");

  renderConfig();
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
    ["cash_pnl", "Total PnL"],
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

// Telas que ja existiram: o reporte antigo continua mostrando o nome certo,
// mas ninguem escolhe elas de novo.
const AREAS_ANTIGAS = [["hedge", "Hedge"], ["calculator", "Calculator"]];

const AREAS = [
  ["challenges", "Challenges"],
  ["overview", "Overview"],
  ["unassigned", "Unassigned"],
  ["setup", "Setup"],
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

  const areaLabel = (v) => ([...AREAS, ...AREAS_ANTIGAS].find(([id]) => id === v) || [null, v])[1];
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
    <div class="tool">
      <h2>Open reports</h2>
      <span class="hint">a number showing wrong, or a field you cannot fix. To point
        at one exact row, open it and use the <b>Report</b> button inside — the report
        then carries that row and field with it.</span>
      <span class="right">
        <span class="n" style="font-size:11px;color:var(--color-neutral-600)">${
          open.length} open · ${closed.length} resolved</span>
        <button class="btn" id="new-issue">New report</button>
      </span>
    </div>

    <div class="panel" style="margin-top:0">
      <div class="scroll"><table class="dt">
        <thead>${head}</thead>
        <tbody>${open.map(row).join("") ||
          `<tr><td colspan="${cols}">${empty("nothing reported")}</td></tr>`}</tbody>
      </table></div>
    </div>

    ${closed.length ? `
    <div class="tool" style="margin-top:36px">
      <h2>Resolved</h2>
      <span class="hint n">${closed.length}</span>
    </div>
    <div class="panel" style="margin-top:0;opacity:.62">
      <div class="scroll"><table class="dt">
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

// ------------------------------------------------------ o que falta cadastrar
//
// Há coisas que o coletor não tem como descobrir sozinho: quanto o challenge
// custou (está no email da mesa, não na plataforma) e qual modelo a conta é
// quando dois têm o mesmo tamanho. Sem elas o painel calcula em cima de um
// buraco -- o multiplicador sai menor do que devia, o total ignora um custo que
// existiu -- e nada na tela denuncia isso.
//
// Por isso o aviso é ativo: aparece ao entrar, com o campo ali para preencher
// na hora. Some quando não há mais pendência, e não reaparece depois de
// dispensado -- só volta se surgir uma pendência NOVA, comparando a assinatura
// do que está pendente com a do que já foi visto.

const PENDING_SEEN = "tracking:pending-seen";

// NinjaTrader e Tradovate são a mesma conta por dois caminhos; a Tradeify
// cadastra a mesa como NT8 e o app aceita as duas grafias.
const FUTURES = new Set(["NT8", "Tradovate"]);

// Linha de produto da mesa. As regras de saque são DELA, não do texto que
// alguém digitou em `name` -- na base real havia um plano Select chamado
// "FLEX" e outro "1 Step". Lista curta de propósito: é chave de catálogo.
const PRODUCTS = [
  { value: "", label: "—" },
  { value: "select", label: "select" },
  { value: "growth", label: "growth" },
  { value: "lightning", label: "lightning" },
  { value: "other", label: "other" },
];

/**
 * Levanta o que só o usuário pode responder.
 *
 * Cada item traz o porquê junto: "falta o custo" não diz nada, "falta o custo,
 * e sem ele o multiplicador do hedge sai menor do que devia" diz.
 */
async function loadPending() {
  const [todoJournal, todoProgresso, todasContas, plans, todasFontes, phases,
         firms, policies] =
    await Promise.all([
      load.journal(), load.progress(), load.accounts(), load.plans(),
      load.discovered(), load.phasesOfPassed(), load.firms(),
      load.payoutPolicies().catch(() => [])]);

  // A pendência segue a máquina em foco: abrir o painel na VPS e ser cobrado
  // por uma conta que só existe no PC de casa é ruído, e ruído em aviso ensina
  // a ignorar o aviso.
  const accounts = keepOfMachine(todasContas, state.machine);
  const discovered = keepOfMachine(todasFontes, state.machine);
  const progress = keepByAccount(todoProgresso, todasContas, state.machine);
  const journal = keepChallenges(todoJournal, todoProgresso, todasContas, state.machine);

  // As políticas do plano daquele challenge: mesma mesa, mesmo produto, mesmo
  // tamanho. Sem `product` no plano não há como saber quais valem -- e chutar
  // ligaria regra de saque errada numa conta com dinheiro.
  const policiesFor = (challenge) => {
    const plano = plans.find((p) => p.id === challenge.plan_id);
    if (!plano?.product) return [];
    return policies.filter((pp) => pp.firm_id === plano.firm_id
      && pp.product === plano.product
      && Number(pp.account_size) === Number(plano.account_size));
  };

  const items = [];
  // Mesa sem padrao de nome nao consegue ligar a conta funded sozinha -- e a
  // pergunta vai voltar em toda aprovacao dela ate alguem preencher.
  const firmPattern = new Map(firms.map((f) => [f.name, Boolean(f.account_pattern)]));
  // Estes dois olham TODAS as contas de propósito: uma conta já cadastrada na
  // outra máquina continua cadastrada, e oferecê-la aqui criaria a mesma conta
  // duas vezes.
  const accountById = new Map(todasContas.map((a) => [a.id, a]));
  const claimed = new Set(todasContas.map((a) => `${a.platform}:${a.login_or_name}`));
  const inUse = new Set(progress.filter((p) => p.challenge_id).map((p) => p.account_id));
  const fundedPhase = new Set(phases.filter((p) => p.phase === "FUNDED")
    .map((p) => p.challenge_id));

  // Candidatas a conta funded: o que a descoberta achou e ninguem classificou,
  // mais conta ja registrada que nao pertence a challenge nenhum. Fonte MT5 nao
  // entra porque o login so aparece quando alguem digita -- essa fica no Setup.
  const freshAccounts = [
    ...discovered
      .filter((d) => d.platform !== "MT5" && !claimed.has(`${d.platform}:${d.login_or_name}`))
      .map((d) => ({ value: `source:${d.id}`, platform: d.platform,
                     name: d.login_or_name,
                     label: `${d.platform} · ${d.login_or_name} · found ${day(d.first_seen)}` })),
    ...accounts
      .filter((a) => a.kind === "prop" && a.is_active !== false && !inUse.has(a.id))
      .map((a) => ({ value: `account:${a.id}`, platform: a.platform,
                     name: a.login_or_name,
                     label: `${a.platform} · ${a.login_or_name} · registered` })),
  ];

  for (const c of journal) {
    const firmDaLinha = firms.find((f) => f.name === c.firm);
    // A conta que a mesa liberou já diz no nome como ela paga. Levar isso
    // junto na opção é o que permite preencher a política sozinho lá embaixo.
    const comPolitica = (lista) => lista.map((o) => ({
      ...o,
      policy: parseAccountName(o.name, firmDaLinha?.account_pattern)?.policy || null,
    }));

    // Bateu o alvo, o coletor NÃO aprovou por causa da consistência, e uma
    // conta funded daquela mesa apareceu na máquina. Duas evidências
    // independentes se contradizendo -- e é exatamente aí que vale perguntar
    // em vez de decidir.
    //
    // O caso real: plano cadastrado com mínimo de 2 dias e consistência de 40%,
    // que é uma combinação que ninguém passa nunca. A mesa aprovou, liberou a
    // conta funded, e o painel segurou a avaliação em `phase1` sem dizer por
    // quê. Aprovar sozinho seria pior: em plano cuja consistência é real, isso
    // daria alvo e multiplicador para uma conta reprovada.
    const travada = progress.find((p) => p.challenge_id === c.id
      && Number(p.target_left) <= 0
      && !p.blown
      && !Number(p.days_left)
      && p.consistency_pct != null
      && Number(p.best_day_pct) > Number(p.consistency_pct));

    if (travada && !fundedPhase.has(c.id)
        && ["phase1", "phase2"].includes(c.status)) {
      const tamanho = Number(plans.find((p) => p.id === c.plan_id)?.account_size) || null;
      const candidatas = freshAccounts.filter((op) => {
        const lido = parseAccountName(op.name, firmDaLinha?.account_pattern);
        return lido?.funded && (!lido.size || !tamanho || lido.size === tamanho);
      });
      if (candidatas.length) {
        items.push({
          key: `approved:${c.id}`,
          kind: "activation",
          id: c.id,
          options: comPolitica(candidatas),
          policies: policiesFor(c),
          title: `${c.account_ids || "?"} · ${c.firm || "?"}`,
          ask: "Hit the target, but consistency says no. Did the firm approve it?",
          why: `Profit is there (${num(travada.pnl, 0)} of `
            + `${num(travada.profit_target, 0)}), but the best day was `
            + `${num(travada.best_day_pct, 1)}% and this plan allows `
            + `${num(travada.consistency_pct, 0)}% — so the collector held it back.`
            + ` A funded account from ${c.firm} showed up on this PC anyway.`
            // A causa mais provável, e que se conserta de vez: a avaliação veio
            // com o add-on de consistência e ninguém marcou.
            + (!travada.consistency_addon && travada.consistency_addon_pct
              ? ` This plan offers a ${num(travada.consistency_addon_pct, 0)}%`
                + " add-on and this challenge is not marked as having it —"
                + " if you bought it, marking that fixes this for good."
              : "")
            + " Confirm and it becomes funded, linked to the account you pick.",
        });
      }
    }

    // Avaliação aprovada esperando a conta funded. A mesa libera uma conta
    // nova, com outro número, e é essa ligação que ninguém consegue deduzir.
    if (c.status === "passed" && !fundedPhase.has(c.id)) {
      items.push({
        key: `activation:${c.id}`,
        kind: "activation",
        id: c.id,
        options: comPolitica(freshAccounts),
        policies: policiesFor(c),
        title: `${c.account_ids || "?"} · ${c.firm || "?"}`,
        ask: "Passed. Which account did the firm activate?",
        why: !freshAccounts.length
          ? "No unassigned account showed up yet. When the firm activates it, the"
            + " collector finds it on its own and this question comes back."
          : "The collector already sees new accounts on this PC, but the funded"
            + " number does not derive from the evaluation one — only you know"
            + " which is which. Pick it and the challenge moves to funded, with"
            + " the new account carrying the funded phase."
            // Sem padrao a pergunta volta em TODA aprovacao desta mesa. Dizer
            // isso aqui e o que transforma um clique repetido num conserto.
            + (firmPattern.get(c.firm) === false
              ? ` — ${c.firm || "this firm"} has no account name pattern, so this`
                + " will be asked every time it passes. Fill the pattern in"
                + " Setup → Firms and the link happens on its own from then on."
              : ""),
      });
    }

    // Rede de segurança. Quem marca conta estourada é o coletor, no ciclo
    // seguinte ao estouro -- isto só aparece se ele estiver parado, e aí o
    // clique resolve na mão.
    if (c.drawdown_blown && c.status !== "failed") {
      items.push({
        key: `failed:${c.id}`,
        kind: "failed",
        id: c.id,
        title: `${c.account_ids || "?"} · ${c.firm || "?"}`,
        ask: "This account hit the drawdown floor.",
        why: `It is still marked as ${statusLabel(c.status, c.eval_phases)}, so`
          + " the panel keeps giving it a target and a multiplier as if it were"
          + " alive. The collector marks this on its own — seeing it here means"
          + " it is not running.",
      });
    }

    // Ciclo da Flex fechado e a conta voltou a operar. Quem opera essas contas
    // só volta depois que o dinheiro cai -- então o saque foi pago e ninguém
    // registrou. Enquanto não registrar, o relógio não zera, o sacável mostra
    // dinheiro que já saiu e a folga de drawdown fica maior do que é.
    if (c.traded_after_cycle && Number(c.payout_winning_days) > 0
        && Number(c.winning_days) >= Number(c.payout_winning_days)) {
      items.push({
        key: `payout:${c.id}:${c.cycle_closed_on}`,
        kind: "payout",
        id: c.id,
        title: `${c.account_ids || "?"} · ${c.firm || "?"}`,
        ask: "Did this account pay out?",
        why: `${c.payout_winning_days} winning days closed on `
          + `${day(c.cycle_closed_on)}, and it traded again on `
          + `${day(c.resumed_on)}.`,
        // Os tres campos ja vem preenchidos com o que a mesa liberava: o
        // normal e confirmar e salvar. A data e o dia em que voltou a operar,
        // porque e o primeiro dia em que o dinheiro comprovadamente ja tinha
        // caido -- e e ela que reinicia o ciclo.
        net: c.funded_withdrawable,
        gross: c.funded_gross_request,
        date: c.resumed_on,
      });
    }

    // Custo: linha importada da planilha já traz o número, então fica de fora --
    // o aviso é para o que o coletor criou e ninguém preencheu.
    if (c.import_source || Number(c.cost_entries) > 0) continue;
    items.push({
      key: `cost:${c.id}`,
      kind: "cost",
      id: c.id,
      title: `${c.account_ids || "?"} · ${c.firm || "?"}`,
      ask: "What did this challenge cost?",
      why: "It is the starting point of the hedge multiplier — without it the"
        + " panel recommends a smaller hedge than it should.",
      date: c.date_open,
    });
  }

  for (const a of progress) {
    const account = accountById.get(a.account_id) || {};
    if (!a.plan_id || a.plan_source === "inferred") {
      items.push({
        key: `plan:${a.account_id}`,
        kind: "plan",
        id: a.account_id,
        platform: account.platform,
        title: `${accountShort(a.login_or_name)} · ${a.login_or_name}`,
        ask: a.plan_id
          ? `Is this really ${a.plan_name || "?"} ${money0(a.account_size)}?`
          : "Which model is this account?",
        why: a.plan_id
          ? "Guessed from the balance. Two models can share a size with"
            + ` different drawdowns (${money0(a.max_drawdown)} here), and the`
            + " drawdown is what sets the multiplier."
          : "Without the plan there is no target and no drawdown to measure"
            + " against, so this account gets no multiplier at all.",
      });
      continue;
    }
    if (a.phase == null && Number(a.days_traded) > 0) {
      items.push({
        key: `challenge:${a.account_id}`,
        kind: "challenge",
        id: a.account_id,
        title: `${accountShort(a.login_or_name)} · ${a.login_or_name}`,
        ask: "This account has trades but no challenge.",
        why: `${a.days_traded} day(s) traded and ${cash(a.pnl)} of result are`
          + " sitting outside every total until it belongs to one.",
      });
    }
  }

  return { items, plans, accounts };
}

/** Roda depois da primeira tela: o aviso não pode atrasar o que já ia carregar. */
async function checkPending() {
  // Offline não é motivo para atrapalhar quem já está com a tela aberta. Mas
  // engolir calado também não serve: sem o console, uma falha aqui vira "o
  // aviso simplesmente nunca aparece", que foi exatamente o que aconteceu.
  const { items, plans, accounts } = await loadPending().catch((err) => {
    console.error("pending:", err);
    return { items: [], plans: [], accounts: [] };
  });
  state.pendingSetup = items.length;
  renderNav();
  if (!items.length) return;

  const signature = items.map((i) => i.key).sort().join(",");
  let seen = "";
  try {
    seen = localStorage.getItem(PENDING_SEEN) || "";
  } catch {
    seen = "";   // Janela anônima: mostra sempre, que é o lado seguro.
  }
  if (seen === signature) return;
  openPendingForm(items, plans, accounts, signature);
}

/**
 * Liga a conta funded ao challenge aprovado.
 *
 * A fase FUNDED nasce SEM `started_at`: ela cobre tudo o que a conta nova fez,
 * inclusive o que já foi operado antes de alguém abrir o painel. Uma janela
 * começando agora deixaria essas trades órfãs, e órfã não entra em total
 * nenhum -- é o buraco silencioso que este tracker existe para não ter.
 */
async function activateFunded(challengeId, choice, payoutPolicyId = null) {
  const [kind, rawId] = choice.split(":");
  const id = Number(rawId);
  let accountId = id;

  if (kind === "source") {
    const [discovered, journal] = await Promise.all([load.discovered(), load.journal()]);
    const source = discovered.find((d) => d.id === id);
    const challenge = journal.find((c) => c.id === challengeId) || {};
    const created = await save.createAccount({
      kind: "prop",
      platform: source.platform,
      login_or_name: source.login_or_name,
      label: source.label,
      terminal_hash: source.terminal_hash,
      terminal_path: source.terminal_path,
      broker_server: source.broker_server,
      magic_source_part: magicSourcePart(source.platform, source.login_or_name),
      // O plano é o mesmo do challenge: a conta funded segue as regras que a
      // avaliação seguia, e sem plano ela não teria drawdown para medir.
      plan_id: challenge.plan_id ?? null,
      plan_source: challenge.plan_id ? "manual" : null,
      payout_policy_id: payoutPolicyId,
    });
    accountId = created.id;
  } else if (payoutPolicyId) {
    // Conta que já existia: a política é a única coisa nova que ela ganha aqui.
    await save.account(accountId, { payout_policy_id: payoutPolicyId });
  }

  // Vindo de uma avaliação que o coletor NÃO conseguiu aprovar -- porque a
  // regra cadastrada reprovava e a mesa aprovou mesmo assim -- a fase da
  // avaliação ainda está aberta. Fechar aqui é o que `mark_challenge_passed`
  // teria feito: sem isso ela fica `active` para sempre e o challenge tem duas
  // fases vivas ao mesmo tempo.
  const abertas = await load.phases(challengeId);
  const avaliacao = abertas.find((p) => p.phase !== "FUNDED" && !p.ended_at);
  if (avaliacao) {
    await save.phase(avaliacao.id, {
      outcome: "passed",
      ended_at: new Date().toISOString(),
    });
  }

  await save.createPhase({
    challenge_id: challengeId,
    phase: "FUNDED",
    account_id: accountId,
    outcome: "active",
  });
  // O status por último: se a criação da fase falhar, o challenge continua em
  // `passed` e a pergunta volta no ciclo seguinte em vez de sumir pela metade.
  await save.challenge(challengeId, { status: "funded" });
}

function openPendingForm(items, plans, accounts, signature) {
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  // Plano só faz sentido dentro da mesma plataforma: um plano CFD não descreve
  // uma conta de futuros, por mais que os dois tamanhos sejam 50k.
  const plansFor = (platform) => plans.filter((pl) => {
    const firm = pl.prop_firms?.platform;
    if (!firm || !platform) return true;   // cadastro pela metade não esconde nada
    return FUTURES.has(platform) ? FUTURES.has(firm) : firm === platform;
  });

  const field = (item) => {
    if (item.kind === "cost") {
      return `<div class="row" style="margin-top:8px">
        <div class="field"><label>Cost paid</label>
          <input type="number" min="0" step="0.01" data-pending-cost="${item.id}"
                 placeholder="99.00" inputmode="decimal"></div>
        <div class="field auto"><label>&nbsp;</label>
          <button class="btn" data-save-cost="${item.id}"
                  data-date="${esc(item.date || "")}">Save</button></div>
      </div>`;
    }
    if (item.kind === "plan") {
      const account = accountById.get(item.id) || {};
      const options = plansFor(item.platform);
      return `<div class="row" style="margin-top:8px">
        <div class="field wide"><label>Model</label>
          <select data-pending-plan="${item.id}">
            <option value="">— pick the model —</option>
            ${options.map((pl) => `<option value="${pl.id}" ${
              pl.id === account.plan_id ? "selected" : ""}>${esc(
              `${pl.prop_firms?.name || "?"} · ${pl.name || "?"} · ${
                money0(pl.account_size)} · ${money0(pl.max_drawdown)} dd`)}</option>`).join("")}
          </select></div>
        <div class="field auto"><label>&nbsp;</label>
          <button class="btn" data-save-plan="${item.id}">Confirm</button></div>
      </div>`;
    }
    if (item.kind === "activation") {
      if (!item.options.length) return "";
      // A política de saque é escolha PERMANENTE da conta, feita neste
      // momento -- é o que a mesa pede ao ativar. E é ela que diz quanto do
      // lucro pode sair: sem ela o painel volta a contar dinheiro travado
      // como se fosse sacável.
      const politicas = item.policies || [];
      return `<div class="row" style="margin-top:8px">
        <div class="field wide"><label>Funded account</label>
          <select data-pending-activation="${item.id}">
            <option value="">— which one —</option>
            ${item.options.map((o) => `<option value="${esc(o.value)}" data-policy="${
              esc(o.policy || "")}">${esc(o.label)}</option>`).join("")}
          </select></div>
        ${politicas.length ? `<div class="field wide">
          <label>Payout policy · permanent</label>
          <select data-pending-policy="${item.id}">
            <option value="">— how it pays —</option>
            ${politicas.map((p) => `<option value="${p.id}" data-policy="${
              esc(p.policy || "")}" title="${esc(p.notes || "")}">${
              esc(`${p.label} · ${p.buffer > 0 ? `buffer ${money0(p.buffer)}` : "no buffer"}`
                  + `${p.winning_days_required
                      ? ` · ${p.winning_days_required} winning days` : " · pays daily"}`
                  + `${p.pct_of_total ? ` · ${num(p.pct_of_total, 0)}% of total` : ""}`
                  + `${p.cap ? ` · cap ${money0(p.cap)}` : ""}`)}</option>`).join("")}
          </select></div>` : ""}
        <div class="field auto"><label>&nbsp;</label>
          <button class="btn" data-save-activation="${item.id}">Activate</button></div>
      </div>`;
    }
    if (item.kind === "payout") {
      return `<div class="row" style="margin-top:8px">
        <div class="field"><label>Net received</label>
          <input type="number" min="0.01" step="0.01" inputmode="decimal"
                 data-pending-payout="${item.id}" value="${esc(item.net ?? "")}"></div>
        <div class="field"><label>Gross withdrawn</label>
          <input type="number" min="0.01" step="0.01" inputmode="decimal"
                 data-pending-gross="${item.id}" value="${esc(item.gross ?? "")}"></div>
        <div class="field"><label>Received on</label>
          <input type="date" data-pending-payout-date="${item.id}"
                 value="${esc(item.date || "")}"></div>
        <div class="field auto"><label>&nbsp;</label>
          <button class="btn" data-save-payout="${item.id}">Save</button></div>
      </div>`;
    }
    if (item.kind === "failed") {
      return `<div class="row" style="margin-top:8px">
        <div class="field auto"><button class="btn ghost danger"
          data-save-failed="${item.id}">Mark as failed</button></div>
      </div>`;
    }
    return `<div class="row" style="margin-top:8px">
      <div class="field auto"><button class="btn ghost" data-go-setup="1">
        Open Setup to register it</button></div>
    </div>`;
  };

  modal.innerHTML = `
    <header><h1>${items.length} thing${items.length === 1 ? "" : "s"} only you can fill in</h1>
      <span class="spacer"></span>
      <button class="btn ghost" id="pending-later">Later</button></header>
    <div style="padding:16px;max-height:74vh;overflow:auto">
      <p class="muted" style="margin-top:0;line-height:1.8">
        The collector reads the platforms on its own.
        <strong class="bright">This it cannot read.</strong>
      </p>
      ${items.map((item) => `
        <div class="pending-item">
          <div class="pending-head">
            <strong class="bright">${esc(item.title)}</strong>
            <span class="muted">${esc(item.ask)}</span>
          </div>
          <p class="pending-why">${esc(item.why)}</p>
          ${field(item)}
        </div>`).join("")}
      <p class="muted" style="font-size:9px;margin-bottom:0">
        Closing this is fine — it comes back only if something new shows up, and
        the Setup tab keeps the count.
      </p>
    </div>`;

  const remember = () => {
    try {
      localStorage.setItem(PENDING_SEEN, signature);
    } catch {
      // Sem armazenamento o aviso volta na próxima entrada. Chato, não errado.
    }
  };

  modal.querySelector("#pending-later").onclick = () => {
    remember();
    modal.close();
  };

  modal.querySelectorAll("[data-save-cost]").forEach((b) => {
    b.onclick = async () => {
      const id = Number(b.dataset.saveCost);
      const input = modal.querySelector(`[data-pending-cost="${id}"]`);
      const amount = Number(input.value);
      if (!amount) return toast("Enter the cost");
      await guard(() => save.createCashEvent({
        challenge_id: id,
        kind: "cost",
        amount: signedCash("cost", amount),
        occurred_on: b.dataset.date || new Date().toISOString().slice(0, 10),
        source: "manual",
      }), "Cost saved");
      finishPending();
    };
  });

  modal.querySelectorAll("[data-save-plan]").forEach((b) => {
    b.onclick = async () => {
      const id = Number(b.dataset.savePlan);
      const select = modal.querySelector(`[data-pending-plan="${id}"]`);
      if (!select.value) return toast("Pick the model");
      // `manual` trava a escolha: o coletor não a sobrepõe mais, e é isso que
      // faz o aviso sumir de vez para esta conta.
      await guard(() => save.account(id, {
        plan_id: Number(select.value),
        plan_source: "manual",
      }), "Model confirmed");
      finishPending();
    };
  });

  // Escolher a conta preenche a política que o NOME dela declara. Sem travar:
  // é sugestão, e quem já escolheu na mão manda. Era o passo que ficava em
  // branco -- e conta sem política faz o painel mostrar como sacável o lucro
  // inteiro, inclusive o que a mesa só libera no fim do ciclo.
  modal.querySelectorAll("[data-pending-activation]").forEach((select) => {
    select.onchange = () => {
      const politica = select.selectedOptions[0]?.dataset.policy;
      const campo = modal.querySelector(
        `[data-pending-policy="${select.dataset.pendingActivation}"]`);
      if (!politica || !campo || campo.value) return;
      const achou = [...campo.options].find((o) => o.dataset.policy === politica);
      if (!achou) return;
      campo.value = achou.value;
      toast(`The account name says ${politica} — payout policy filled in`);
    };
  });

  modal.querySelectorAll("[data-save-activation]").forEach((b) => {
    b.onclick = async () => {
      const id = Number(b.dataset.saveActivation);
      const select = modal.querySelector(`[data-pending-activation="${id}"]`);
      if (!select.value) return toast("Pick the account");
      // Só cobra a política quando há alguma cadastrada: mesa sem catálogo não
      // pode travar a ativação, que é o passo que realmente importa.
      const policy = modal.querySelector(`[data-pending-policy="${id}"]`);
      if (policy && !policy.value) return toast("Pick the payout policy — it is permanent");
      await guard(() => activateFunded(id, select.value,
        policy ? Number(policy.value) : null), "Funded");
      finishPending();
    };
  });

  modal.querySelectorAll("[data-save-payout]").forEach((b) => {
    b.onclick = async () => {
      const id = Number(b.dataset.savePayout);
      const valor = (attr) => Number(modal.querySelector(`[${attr}="${id}"]`).value);
      const net = valor("data-pending-payout");
      const gross = valor("data-pending-gross");
      const date = modal.querySelector(`[data-pending-payout-date="${id}"]`).value;
      if (!(net > 0)) return toast("Enter what you received");
      if (!(gross >= net)) return toast("Gross must cover what you received");
      if (!date) return toast("Enter the date you received it");
      // Sem redeposito aqui: é o caso raro, e ele se corrige na linha do
      // challenge. Perguntar tudo de uma vez é o que faz ninguém responder.
      await guard(() => save.createCashEvent({
        challenge_id: id,
        kind: "payout",
        amount: net,
        gross_amount: gross,
        redeposit_amount: 0,
        occurred_on: date,
        source: "manual",
      }), "Payout saved");
      finishPending();
    };
  });

  modal.querySelectorAll("[data-save-failed]").forEach((b) => {
    b.onclick = async () => {
      await guard(() => save.challenge(Number(b.dataset.saveFailed),
        { status: "failed" }), "Marked as failed");
      finishPending();
    };
  });

  modal.querySelectorAll("[data-go-setup]").forEach((b) => {
    b.onclick = () => {
      remember();
      modal.close();
      go("config");
    };
  });

  // Depois de gravar, refaz a lista: sobrou pendência, o aviso continua com o
  // que sobrou; acabou, fecha e o contador zera.
  async function finishPending() {
    const fresh = await loadPending();
    state.pendingSetup = fresh.items.length;
    renderNav();
    if (!fresh.items.length) {
      modal.close();
      return go(state.page);
    }
    openPendingForm(fresh.items, fresh.plans, fresh.accounts,
                    fresh.items.map((i) => i.key).sort().join(","));
  }

  modal.showModal();
}

// -------------------------------------------------------------- calculadora

// ------------------------------------------------------------------ router

const RENDERERS = {
  overview: renderOverview,
  challenges: renderChallenges,
  unassigned: renderUnassigned,
  config: renderConfig,
  issues: renderIssues,
};

function renderNav() {
  const abas = PAGES.map((p) => {
    const count = p.id === "issues" ? state.openIssues
      : p.id === "config" ? state.pendingSetup : 0;
    const label = count
      ? `${p.label} <span class="pill">${count}</span>`
      : esc(p.label);
    return `<button data-page="${p.id}" ${
      p.id === state.page ? 'aria-current="page"' : ""}>${label}</button>`;
  }).join("");

  // Só com duas máquinas ou mais: com uma, o seletor seria um controle que
  // nunca muda nada ocupando o menu.
  const seletor = state.machines.length > 1
    ? `<select id="machine-pick" title="Which machine's accounts to show">
         <option value="">All machines</option>
         ${state.machines.map((m) => `<option value="${esc(m)}" ${
           m === state.machine ? "selected" : ""}>${esc(m)}</option>`).join("")}
       </select>`
    : "";

  document.getElementById("nav").innerHTML = abas + seletor;
  document.querySelectorAll("[data-page]").forEach((b) => {
    b.onclick = () => go(b.dataset.page);
  });
  const pick = document.getElementById("machine-pick");
  if (pick) pick.onchange = () => setMachine(pick.value);
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

// Quem `boot` ja desenhou. `boot` refaz a tela inteira, entao so pode rodar
// quando muda a PESSOA -- nunca quando muda so o token.
let bootedFor;

/**
 * Quais máquinas existem nesta conta.
 *
 * Antes de desenhar o menu, de propósito: o seletor só aparece com duas
 * máquinas ou mais, e ele não pode nascer errado e se corrigir na frente de
 * quem está olhando. Falha de rede aqui não pode derrubar o login -- sem
 * lista, o painel mostra tudo, que é o que ele sempre fez.
 */
async function loadMachines(ownerId) {
  try {
    state.machines = machineNames(await load.machines(ownerId));
  } catch {
    state.machines = [];
  }
  // Máquina desinstalada (ou renomeada) some da lista: o filtro salvo no
  // navegador apontaria para nada e a tela ficaria vazia sem explicação.
  if (state.machine && !state.machines.includes(state.machine)) setMachineQuiet(ALL);
}

function setMachineQuiet(next) {
  state.machine = next || ALL;
  try {
    localStorage.setItem(MACHINE_KEY, state.machine);
  } catch {
    // Sem armazenamento: vale enquanto a aba estiver aberta.
  }
}

async function boot() {
  const user = await currentUser();
  bootedFor = user?.id ?? null;
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
  await loadMachines(user.id);
  renderNav();
  refreshIssueCount();
  const initial = location.hash.slice(1);
  await go(RENDERERS[initial] ? initial : "overview");
  // Depois da primeira tela, de propósito: o aviso do que falta cadastrar não
  // pode atrasar o que a pessoa entrou para ver.
  checkPending();
}

// `onAuthStateChange` dispara em TODO evento de auth, nao so login e logout. E
// o supabase-js, com autoRefreshToken ligado, revalida a sessao quando a aba
// volta a ficar visivel: sair da aba e voltar emitia TOKEN_REFRESHED, `boot`
// rodava, `go()` redesenhava a secao e o cadastro que estava sendo preenchido
// ia junto -- sem nada para salvar, porque formulario aberto nao e estado.
// Renovar token nao muda nada na tela; o supabase-js ja usa o token novo nas
// queries seguintes sozinho.
supabase.auth.onAuthStateChange((_event, session) => {
  const uid = session?.user?.id ?? null;
  if (uid === bootedFor) return;
  bootedFor = uid;
  boot();
});
boot();
