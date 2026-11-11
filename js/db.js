// Acesso ao Supabase. Toda leitura e escrita do app passa por aqui.
//
// O app usa a anon key: a RLS no banco e que garante que so as linhas do
// usuario logado aparecam. A service_role key nunca chega ao navegador -- ela
// fica so no coletor, no PC.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { CONFIG } from "./config.js?v=42e4644575";

export const supabase = createClient(CONFIG.url, CONFIG.anonKey);

export async function currentUser() {
  const { data } = await supabase.auth.getUser();
  return data?.user ?? null;
}

export async function signInWithPassword(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signInWithEmail(email) {
  // O link volta para a raiz, sem o hash da secao. Mandar `location.href` levaria
  // junto um `#challenges`, e o token viria para uma URL que ja tem fragmento.
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: location.origin + location.pathname },
  });
  if (error) throw error;
}

export async function changePassword(password) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
}

function unwrap({ data, error }) {
  if (error) throw new Error(error.message);
  return data ?? [];
}

// ------------------------------------------------------------------ leitura

export const load = {
  journal: () =>
    supabase.from("challenge_journal")
      .select("*").order("date_open", { ascending: false, nullsFirst: false })
      .then(unwrap),

  monthly: () =>
    supabase.from("journal_monthly").select("*").order("month").then(unwrap),

  firms: () =>
    supabase.from("prop_firms").select("*").order("name").then(unwrap),

  accounts: () =>
    supabase.from("accounts").select("*").order("kind").order("login_or_name").then(unwrap),

  // Regras da mesa por tamanho de conta.
  plans: () =>
    supabase.from("firm_plans")
      // A plataforma da mesa vem junto: e ela que diz se um plano pode
      // descrever uma conta -- CFD nao descreve conta de futuros.
      .select("*, prop_firms(name, platform)")
      .order("firm_id").order("account_size").then(unwrap),

  // Progresso de cada conta prop contra as regras da mesa.
  progress: () =>
    supabase.from("account_progress").select("*").order("short_id").then(unwrap),

  // Capital aportado e caixa de giro. Uma linha por dono, e pode não existir
  // ainda: o painel trata ausência como zero em vez de exigir cadastro antes
  // de mostrar qualquer coisa.
  settings: () =>
    supabase.from("operation_settings")
      .select("seed_capital, borrowed_capital, working_cash, theme, avatar_data, tour_seen_at, "
        + "goal_profit, goal_since, goal_payouts_week, evals_per_free_slot, max_committed_pct").maybeSingle()
      .then(({ data, error }) => {
        if (error) throw new Error(error.message);
        return data ?? { seed_capital: 0, borrowed_capital: 0, working_cash: 0, theme: null,
          avatar_data: null, tour_seen_at: null, goal_profit: null, goal_since: null,
          goal_payouts_week: 2, evals_per_free_slot: 3 };
      }),

  // Aba Plan: o que foi marcado a mão ("pedi o saque", "queimei"), o dinheiro
  // que entrou e saiu desde o início da meta, e o resultado da live no mesmo
  // período -- a meta é lucro de CAIXA, não o que está preso na mesa.
  planChecks: (since) =>
    supabase.from("plan_checks").select("session_day, task_key")
      .gte("session_day", since).then(unwrap),

  cashSince: (since) =>
    supabase.from("cash_events").select("challenge_id, kind, amount, occurred_on")
      .gte("occurred_on", since).then(unwrap),

  liveDaysSince: (since, accountIds) =>
    accountIds.length === 0
      ? Promise.resolve([])
      : supabase.from("account_days").select("account_id, day, day_pnl")
          .in("account_id", accountIds).gte("day", since).then(unwrap),

  // Challenges que o coletor cadastrou pelo nome da conta, ou cuja funded foi
  // ativada num plano com taxa de ativação, e que ainda esperam o dono dizer
  // quanto pagou. Saem desta lista quando o custo é gravado.
  costPending: () =>
    supabase.from("challenges")
      .select("id, date_open, cost_pending, activation_cost_due, reset_of, prop_firms(name), "
        + "firm_plans(name, account_size, price, activation_fee), "
        + "challenge_phases(phase, accounts(login_or_name))")
      .or("cost_pending.eq.true,activation_cost_due.not.is.null").order("id").then(unwrap),

  // Quais contas já foram operadas no dia de sessão corrente. O dia vem do
  // banco de propósito: ele vira às 17:00 de Nova York, então a trade da noite
  // já conta para o dia seguinte -- refazer esse cálculo no navegador erraria
  // toda vez que o horário de verão americano virasse.
  tradedToday: () =>
    supabase.from("account_today")
      .select("account_id, traded_today, trades_today, open_now, last_day").then(unwrap),

  // Contas com resultado e uso: é o que o seletor de fase precisa para o
  // usuário distinguir três contas da mesma mesa.
  accountStats: () =>
    supabase.from("account_stats").select("*").order("kind").order("short_id").then(unwrap),

  // Uma linha por maquina instalada -- e o que o seletor de maquina precisa.
  // Vem daqui, e nao das contas, porque a maquina existe no painel desde o
  // primeiro ciclo, antes de ter qualquer conta classificada.
  //
  // FILTRADO PELO DONO, de proposito: quem mantem o projeto le o status de
  // todo mundo (a politica `collector_status_admin_read` existe justamente
  // para isso), e sem este filtro o seletor ofereceria a VPS de OUTRA pessoa
  // -- escolher uma delas esvaziaria a tela sem explicacao.
  machines: (ownerId) =>
    supabase.from("collector_status").select("machine, last_cycle_at")
      .eq("owner_id", ownerId).order("machine").then(unwrap),

  // Contabilidade: a linha existir é o que liga a aba e os avisos. Quem não
  // tem recebe null e nunca vê nada disto.
  accountingSettings: () =>
    supabase.from("accounting_settings").select("*").maybeSingle()
      .then(({ data, error }) => {
        if (error) throw new Error(error.message);
        return data ?? null;
      }),

  // A fila de avisos. `pending` e `failed` são o que a faixa de alerta mostra;
  // o resto é histórico da aba.
  accountingOutbox: (since) =>
    supabase.from("accounting_outbox").select("*")
      .gte("created_at", since).order("id", { ascending: false }).then(unwrap),

  // O livro-caixa de um período: custos, ativações, saques e depósitos da live.
  accountingMoves: (from, to) =>
    supabase.from("accounting_moves").select("*")
      .gte("occurred_on", from).lt("occurred_on", to)
      .order("occurred_on").order("created_at").order("move_id").then(unwrap),

  // As notas de cada saque (0083), com o saque junto para a linha dizer a mesa e a conta.
  invoices: () =>
    supabase.from("accounting_invoices")
      .select("*, cash_events(id, occurred_on, amount, gross_amount, challenge_id, proof_path, proof_ref, proof_date)")
      .order("status").order("competence", { ascending: false }).order("id", { ascending: false })
      .then(unwrap),

  // Contas inteiras fora dos livros (0087): challenge:<id> ou account:<id>.
  excludedAccounts: () =>
    supabase.from("accounting_excluded_accounts")
      .select("account_key, label, created_at").order("created_at").then(unwrap),

  // O Excel que o coletor gerou, do bucket do dono (RLS pela pasta).
  accountingFile: async (path) => {
    const { data, error } = await supabase.storage.from("accounting").download(path);
    if (error) throw new Error(error.message);
    return data;
  },

  // Saude dos coletores para o aviso do Setup. Sem filtro de dono, ao
  // contrario de `machines`: o admin precisa ver a maquina parada dos outros;
  // quem nao e admin recebe so as suas pela RLS.
  collectorHealth: () =>
    supabase.from("collector_status")
      .select("owner_id, machine, commit_sha, update_blocked, last_cycle_at").then(unwrap),

  // Validade do token de atualizacao (`update_source`, so membros). A coluna
  // do token fica de fora: a tela nao precisa dele. `null` = nenhum publicado.
  updateTokenExpiry: () =>
    supabase.from("update_source").select("expires_on").limit(1)
      .then(unwrap).then((rows) => rows[0] ?? null),

  discovered: () =>
    supabase.from("discovered_sources").select("*").order("platform").order("label").then(unwrap),

  unassigned: () =>
    supabase.from("unassigned_trades")
      .select("*").order("exit_ts", { ascending: false }).limit(300).then(unwrap),

  // Fase e challenge de todas as linhas: e so o que o aviso de pendencias
  // precisa para saber se um challenge aprovado ja tem a conta funded ligada.
  // Retrato do que esta aberto. Nunca entra em soma -- ver a migration.
  openPositions: () =>
    supabase.from("open_positions").select("*").then(unwrap),

  phasesOfPassed: () =>
    supabase.from("challenge_phases").select("challenge_id, phase").then(unwrap),

  // Como cada produto da mesa paga. Catálogo: existe antes de qualquer conta,
  // e a conta funded aponta para a linha escolhida.
  payoutPolicies: () =>
    supabase.from("payout_policies").select("*")
      .order("account_size").order("policy").then(unwrap),

  // A linha crua do challenge. O journal entrega `split_pct` ja coalescido com
  // plano e mesa, e nao entrega `consistency_addon`: copiar de la, num reset,
  // gravaria o challenge novo com regra que ninguem escolheu.
  // Todas as tentativas de uma conta. O reset usa para saber se ESTE challenge
  // ainda e o que roda nela -- conta ja resetada tem fase mais nova.
  phasesOfAccount: (accountId) =>
    supabase.from("challenge_phases").select("id, challenge_id, started_at, ended_at")
      .eq("account_id", accountId).order("id").then(unwrap),

  challengeRow: (id) =>
    supabase.from("challenges").select("*").eq("id", id).single().then(unwrap),

  phases: (challengeId) =>
    supabase.from("challenge_phases")
      .select("*, accounts(login_or_name, label, platform)")
      .eq("challenge_id", challengeId).order("phase").then(unwrap),

  cashEventId: (challengeId, kind) =>
    supabase.from("cash_events").select("id")
      .eq("challenge_id", challengeId).eq("kind", kind).limit(1)
      .then(unwrap).then((rows) => rows[0]?.id ?? null),

  cashEvents: (challengeId) =>
    supabase.from("cash_events")
      .select("*").eq("challenge_id", challengeId).order("occurred_on").then(unwrap),

  // Trades de todas as fases de um challenge, com o par do outro lado.
  tradesForPhases: (phaseIds) =>
    phaseIds.length === 0
      ? Promise.resolve([])
      : supabase.from("trades")
          .select("*, accounts(kind, label, login_or_name)")
          .in("phase_id", phaseIds)
          .order("entry_ts", { ascending: false })
          .then(unwrap),

  // Reportes de problema. O admin recebe tambem os dos outros usuarios -- e a
  // politica no banco que decide isso, nao um filtro aqui.
  issues: () =>
    supabase.from("issues")
      .select("*")
      .order("status")
      .order("created_at", { ascending: false })
      .then(unwrap),

  // Só a contagem: o menu precisa do número, não das linhas.
  openIssueCount: () =>
    supabase.from("issues").select("id", { count: "exact", head: true }).eq("status", "open")
      .then(({ count, error }) => (error ? 0 : count ?? 0)),

  isAdmin: () =>
    supabase.rpc("is_admin").then(({ data, error }) => (error ? false : Boolean(data))),

  linksForTrades: (tradeIds) =>
    tradeIds.length === 0
      ? Promise.resolve([])
      : supabase.from("hedge_links")
          .select("*")
          .or(`prop_trade_id.in.(${tradeIds}),live_trade_id.in.(${tradeIds})`)
          .then(unwrap),
};

// ------------------------------------------------------------------ escrita
//
// O app escreve em tudo o que a tela mostra. Nos campos que o coletor MEDE
// (resultado de um trade, saldo, a fase a que ele pertence) a correcao passa
// por `manualPatch`, que marca a coluna: o gatilho no banco segura aquele valor
// e o coletor deixa de sobrescrever. Sem a marca, o coletor vence -- e assim
// que deve ser, porque a medicao e a fonte normal.

/**
 * Marca as colunas do patch como corrigidas a mao.
 *
 * `row` e a linha como esta na tela: as marcas anteriores tem que ir junto,
 * senao corrigir um segundo campo soltaria o primeiro de volta para o coletor.
 */
export function manualPatch(row, patch) {
  const marked = new Set([...(row.manual_cols || []), ...Object.keys(patch)]);
  return { ...patch, manual_cols: [...marked] };
}

// Custo gravado por qualquer caminho responde o "What did you pay?". So o
// quadro desligava a pergunta: quem informava o custo no modal do challenge,
// na celula ou no Pending do Setup via a mesma conta perguntada de novo.
async function costAnswered(challengeId, kind, amount) {
  if (kind !== "cost" || !challengeId || !Number(amount)) return;
  await supabase.from("challenges").update({ cost_pending: false })
    .eq("id", challengeId).eq("cost_pending", true).then(unwrap);
}

// A nota `todo` do saque segue o comprovante (0085): a data do certificado vira
// a competencia e o numero vira a referencia. Nota emitida ou pulada nao muda.
async function proofToInvoice(cashEventId, row) {
  const patch = {};
  if (row.proof_date) patch.competence = row.proof_date;
  if (row.proof_ref) patch.invoice_ref = row.proof_ref;
  if (!Object.keys(patch).length) return;
  await supabase.from("accounting_invoices").update({ ...patch, updated_at: new Date().toISOString() })
    .eq("cash_event_id", cashEventId).eq("status", "todo").then(unwrap);
}

export const save = {
  challenge: (id, patch) =>
    supabase.from("challenges").update(patch).eq("id", id).then(unwrap),

  createChallenge: (row) =>
    supabase.from("challenges").insert(row).select().single().then(unwrap),

  deleteChallenge: (id) =>
    supabase.from("challenges").delete().eq("id", id).then(unwrap),

  // Excluir a tentativa aberta num reset (0088) desfaz o reset: a fase velha,
  // fechada no instante em que a nova abriu, reabre; o challenge velho ganha
  // `reset_dismissed_at` (0089) para o coletor nao abrir de novo; e a nova sai.
  undoReset: async (row, phases) => {
    for (const f of phases.filter((x) => x.account_id && x.started_at)) {
      await supabase.from("challenge_phases").update({ ended_at: null, outcome: "active" })
        .eq("challenge_id", row.reset_of).eq("account_id", f.account_id)
        .eq("ended_at", f.started_at).then(unwrap);
    }
    await supabase.from("challenges").update({ reset_dismissed_at: new Date().toISOString() })
      .eq("id", row.reset_of).then(unwrap);
    return supabase.from("challenges").delete().eq("id", row.id).then(unwrap);
  },

  // Conta fora dos livros (0087) passa a exclusao para o reset dela.
  carryExclusion: async (oldId, newId) => {
    const rows = await supabase.from("accounting_excluded_accounts").select("label")
      .eq("account_key", `challenge:${oldId}`).limit(1).then(unwrap);
    if (!rows?.length) return null;
    const user = await currentUser();
    if (!user) throw new Error("sessão expirada");
    return supabase.from("accounting_excluded_accounts")
      .upsert({ owner_id: user.id, account_key: `challenge:${newId}`, label: rows[0].label },
        { onConflict: "owner_id,account_key" })
      .then(unwrap);
  },

  phase: (id, patch) =>
    supabase.from("challenge_phases").update(patch).eq("id", id).then(unwrap),

  createPhase: (row) =>
    supabase.from("challenge_phases").insert(row).select().single().then(unwrap),

  deletePhase: (id) =>
    supabase.from("challenge_phases").delete().eq("id", id).then(unwrap),

  // `activation`: o lancamento e a taxa de ativacao da funded, que tem a
  // pergunta dela (`activation_cost_due`) e nao responde a da avaliacao.
  createCashEvent: async (row, { activation = false } = {}) => {
    // A marca é o que separa ativação de compra no livro-caixa da contabilidade.
    if (activation && !row.ref) row = { ...row, ref: "activation" };
    const criado = await supabase.from("cash_events").insert(row).select().single().then(unwrap);
    if (!activation) await costAnswered(row.challenge_id, row.kind, row.amount);
    return criado;
  },

  updateCashEvent: async (id, row) => {
    const salvo = await supabase.from("cash_events").update(row).eq("id", id).select().single().then(unwrap);
    await costAnswered(salvo?.challenge_id, salvo?.kind, salvo?.amount);
    if (salvo?.kind === "payout") await proofToInvoice(id, row);
    return salvo;
  },

  deleteCashEvent: (id) =>
    supabase.from("cash_events").delete().eq("id", id).then(unwrap),

  account: (id, patch) =>
    supabase.from("accounts").update(patch).eq("id", id).then(unwrap),

  createAccount: (row) =>
    supabase.from("accounts").insert(row).select().single().then(unwrap),

  createFirm: (row) =>
    supabase.from("prop_firms").insert(row).select().single().then(unwrap),

  firm: (id, patch) =>
    supabase.from("prop_firms").update(patch).eq("id", id).then(unwrap),

  // Leva junto os planos da mesa (cascade). Os challenges dela ficam, com a
  // mesa em branco -- perder o historico por causa de um cadastro seria pior.
  deleteFirm: (id) =>
    supabase.from("prop_firms").delete().eq("id", id).then(unwrap),

  createPlan: (row) =>
    supabase.from("firm_plans").insert(row).select().single().then(unwrap),

  plan: (id, patch) =>
    supabase.from("firm_plans").update(patch).eq("id", id).then(unwrap),

  policy: (id, patch) =>
    supabase.from("payout_policies").update(patch).eq("id", id).then(unwrap),

  // Check de tarefa da aba Plan. A chave é do dono + dia + tarefa: marcar duas
  // vezes não duplica, desmarcar apaga.
  planCheck: async (sessionDay, taskKey, done) => {
    if (!done) {
      return supabase.from("plan_checks").delete()
        .eq("session_day", sessionDay).eq("task_key", taskKey).then(unwrap);
    }
    // `owner_id` explícito pelo mesmo motivo do `settings`: é parte da chave
    // do conflito, e deixá-lo para o default não dá ao upsert o que casar.
    const user = await currentUser();
    if (!user) throw new Error("sessão expirada");
    return supabase.from("plan_checks")
      .upsert({ owner_id: user.id, session_day: sessionDay, task_key: taskKey },
              { onConflict: "owner_id,session_day,task_key" }).then(unwrap);
  },

  deletePlan: (id) =>
    supabase.from("firm_plans").delete().eq("id", id).then(unwrap),

  // "Tentar de novo" volta a linha para a fila zerada; "mandei na mão" fecha
  // sem o coletor. As duas saem da faixa de alerta na hora.
  outboxRetry: (id) =>
    supabase.from("accounting_outbox")
      .update({ status: "pending", attempts: 0, last_attempt_at: null, last_error: null })
      .eq("id", id).then(unwrap),

  outboxManual: (id) =>
    supabase.from("accounting_outbox")
      .update({ status: "manual", sent_at: new Date().toISOString(), last_error: null })
      .eq("id", id).then(unwrap),

  // A NFS-e de um saque (0083): competencia, referencia do invoice, numero,
  // chave, data e status. O coletor refaz PTAX/R$/descricao no proximo ciclo
  // quando a competencia muda.
  invoice: (id, patch) =>
    supabase.from("accounting_invoices")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id).select().single().then(unwrap),

  // PDF da nota ou comprovante da mesa, na pasta do dono do bucket.
  invoiceFile: async (name, file) => {
    const user = await currentUser();
    if (!user) throw new Error("sessão expirada");
    const path = `${user.id}/nf/${name}`;
    const { error } = await supabase.storage.from("accounting")
      .upload(path, file, { contentType: file.type || "application/pdf", upsert: true });
    if (error) throw new Error(error.message);
    return path;
  },

  // Comprovante do saque (print do certificado / PDF da invoice, 0085), na
  // pasta do dono. O coletor nao le o arquivo: o que vale e o que o painel
  // tirou dele (`proof_date`, `proof_ref` no cash_event).
  proofFile: async (name, file) => {
    const user = await currentUser();
    if (!user) throw new Error("sessão expirada");
    const path = `${user.id}/comprovantes/${name}`;
    const { error } = await supabase.storage.from("accounting")
      .upload(path, file, { contentType: file.type || "application/pdf", upsert: true });
    if (error) throw new Error(error.message);
    return path;
  },

  // Comprovante colado depois do saque gravado (aba Accounting): a nota `todo`
  // recebe a competencia e a referencia na hora; o coletor refaz PTAX, R$ e
  // descricao no ciclo seguinte.
  cashProof: async (cashEventId, patch) => {
    await supabase.from("cash_events").update(patch).eq("id", cashEventId).then(unwrap);
    await proofToInvoice(cashEventId, patch);
  },

  // Excecoes por linha a `notify_since` (0081), em lote. `include` null apaga
  // as excecoes e a data volta a mandar. Os ids sao o `override_id` da view: a
  // taxa do saque segue a excecao do proprio saque.
  accountingOverrides: async (ids, include) => {
    if (!ids.length) return null;
    if (include == null) {
      return supabase.from("accounting_overrides").delete().in("move_id", ids).then(unwrap);
    }
    const user = await currentUser();
    if (!user) throw new Error("sessão expirada");
    return supabase.from("accounting_overrides")
      .upsert(ids.map((moveId) => ({ owner_id: user.id, move_id: moveId, include })),
        { onConflict: "owner_id,move_id" })
      .then(unwrap);
  },

  // Conta inteira fora dos livros (0087): o que ela lancar depois tambem fica
  // de fora. `rows` = [{ account_key, label }].
  excludeAccounts: async (rows) => {
    if (!rows.length) return null;
    const user = await currentUser();
    if (!user) throw new Error("sessão expirada");
    return supabase.from("accounting_excluded_accounts")
      .upsert(rows.map((r) => ({ owner_id: user.id, ...r })), { onConflict: "owner_id,account_key" })
      .then(unwrap);
  },

  includeAccounts: async (keys) => {
    if (!keys.length) return null;
    return supabase.from("accounting_excluded_accounts").delete().in("account_key", keys).then(unwrap);
  },

  // Mesmo desenho de `settings`: upsert pelo dono, que é a chave do conflito.
  accountingSettings: async (patch) => {
    const user = await currentUser();
    if (!user) throw new Error("sessão expirada");
    const { data, error } = await supabase.from("accounting_settings")
      .upsert({ owner_id: user.id, ...patch, updated_at: new Date().toISOString() },
              { onConflict: "owner_id" })
      .select().single();
    if (error) throw new Error(error.message);
    return data;
  },

  // Apaga tambem as execucoes e trades da conta (cascade). Quem chama avisa.
  deleteAccount: (id) =>
    supabase.from("accounts").delete().eq("id", id).then(unwrap),

  trade: (id, patch) =>
    supabase.from("trades").update(patch).eq("id", id).then(unwrap),

  deleteLink: (id) =>
    supabase.from("hedge_links").delete().eq("id", id).then(unwrap),

  createLink: (row) =>
    supabase.from("hedge_links").insert(row).select().single().then(unwrap),

  phaseByChallenge: (challengeId, phase, patch) =>
    supabase.from("challenge_phases").update(patch)
      .eq("challenge_id", challengeId).eq("phase", phase).then(unwrap),

  // O total de custo/payout da linha vira UM lancamento -- e assim que a
  // planilha trata: uma celula, um numero. O detalhe por parcela continua no
  // drill-down, e por isso a celula so aceita edicao quando ha no maximo um
  // lancamento; com varios ela fica travada para nao apagar o historico.
  setCashTotal: async (challengeId, kind, amount, existingId) => {
    const feito = existingId
      ? await supabase.from("cash_events").update({ amount }).eq("id", existingId).then(unwrap)
      : await supabase.from("cash_events").insert({
        challenge_id: challengeId, kind, amount,
        occurred_on: new Date().toISOString().slice(0, 10), source: "manual",
      }).then(unwrap);
    await costAnswered(challengeId, kind, amount);
    return feito;
  },

  // Upsert pelo dono: a linha nasce no primeiro salvamento. O `owner_id` vai
  // explícito porque ele é a chave do conflito -- deixá-lo para o default da
  // tabela faria o PostgREST não ter o que casar, e cada salvamento tentaria
  // INSERT de novo. A RLS continua sendo a barreira: gravar o id de outra
  // pessoa seria recusado pelo `with check` da política.
  settings: async (patch) => {
    const user = await currentUser();
    if (!user) throw new Error("sessão expirada");
    const { data, error } = await supabase.from("operation_settings")
      .upsert({ owner_id: user.id, ...patch, updated_at: new Date().toISOString() },
              { onConflict: "owner_id" })
      .select();
    if (error) throw new Error(error.message);
    return data ?? [];
  },

  createIssue: (row) =>
    supabase.from("issues").insert(row).select().single().then(unwrap),

  setIssueStatus: (id, status) =>
    supabase.from("issues")
      .update({ status, resolved_at: status === "resolved" ? new Date().toISOString() : null })
      .eq("id", id).then(unwrap),

  deleteIssue: (id) =>
    supabase.from("issues").delete().eq("id", id).then(unwrap),

  // Classificacao manual de um trade que o coletor nao atribuiu. A fase vai
  // marcada em `manual_cols`, como no editor do challenge: o coletor reenvia a
  // janela de backfill a cada reinicio com a fase que ELE calculou -- nenhuma,
  // para um trade da fila -- e sem a marca a escolha voltava para a fila sozinha.
  // A fila nao traz `manual_cols`, entao le antes para nao soltar outra marca.
  assignTrade: async (tradeId, phaseId) => {
    const row = await supabase.from("trades").select("manual_cols")
      .eq("id", tradeId).single().then(unwrap);
    return supabase.from("trades").update(manualPatch(row, { phase_id: phaseId }))
      .eq("id", tradeId).then(unwrap);
  },
};
