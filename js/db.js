// Acesso ao Supabase. Toda leitura e escrita do app passa por aqui.
//
// O app usa a anon key: a RLS no banco e que garante que so as linhas do
// usuario logado aparecam. A service_role key nunca chega ao navegador -- ela
// fica so no coletor, no PC.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { CONFIG } from "./config.js?v=f5327951fd";

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

  // Contas com resultado e uso: é o que o seletor de fase precisa para o
  // usuário distinguir três contas da mesma mesa.
  accountStats: () =>
    supabase.from("account_stats").select("*").order("kind").order("short_id").then(unwrap),

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

export const save = {
  challenge: (id, patch) =>
    supabase.from("challenges").update(patch).eq("id", id).then(unwrap),

  createChallenge: (row) =>
    supabase.from("challenges").insert(row).select().single().then(unwrap),

  deleteChallenge: (id) =>
    supabase.from("challenges").delete().eq("id", id).then(unwrap),

  phase: (id, patch) =>
    supabase.from("challenge_phases").update(patch).eq("id", id).then(unwrap),

  createPhase: (row) =>
    supabase.from("challenge_phases").insert(row).select().single().then(unwrap),

  deletePhase: (id) =>
    supabase.from("challenge_phases").delete().eq("id", id).then(unwrap),

  createCashEvent: (row) =>
    supabase.from("cash_events").insert(row).select().single().then(unwrap),

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

  deletePlan: (id) =>
    supabase.from("firm_plans").delete().eq("id", id).then(unwrap),

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
    if (existingId) {
      return supabase.from("cash_events").update({ amount })
        .eq("id", existingId).then(unwrap);
    }
    return supabase.from("cash_events").insert({
      challenge_id: challengeId, kind, amount,
      occurred_on: new Date().toISOString().slice(0, 10), source: "manual",
    }).then(unwrap);
  },

  createIssue: (row) =>
    supabase.from("issues").insert(row).select().single().then(unwrap),

  setIssueStatus: (id, status) =>
    supabase.from("issues")
      .update({ status, resolved_at: status === "resolved" ? new Date().toISOString() : null })
      .eq("id", id).then(unwrap),

  deleteIssue: (id) =>
    supabase.from("issues").delete().eq("id", id).then(unwrap),

  // Classificacao manual de um trade live que o coletor nao atribuiu.
  assignTrade: (tradeId, phaseId) =>
    supabase.from("trades").update({ phase_id: phaseId }).eq("id", tradeId).then(unwrap),
};
