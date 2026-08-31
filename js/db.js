// Acesso ao Supabase. Toda leitura e escrita do app passa por aqui.
//
// O app usa a anon key: a RLS no banco e que garante que so as linhas do
// usuario logado aparecam. A service_role key nunca chega ao navegador -- ela
// fica so no coletor, no PC.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { CONFIG } from "./config.js?v=cf2f7a771a";

export const supabase = createClient(CONFIG.url, CONFIG.anonKey);

export async function currentUser() {
  const { data } = await supabase.auth.getUser();
  return data?.user ?? null;
}

export async function signInWithEmail(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.href },
  });
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
      .select("*, prop_firms(name)").order("firm_id").order("account_size").then(unwrap),

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
    supabase.from("unassigned_live_trades")
      .select("*").order("exit_ts", { ascending: false }).limit(300).then(unwrap),

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
// O app so escreve nos campos manuais. Execucoes, trades e vinculos sao
// territorio do coletor -- por isso nao ha nenhum save() para eles aqui.

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

  // Classificacao manual de um trade live que o coletor nao atribuiu.
  assignTrade: (tradeId, phaseId) =>
    supabase.from("trades").update({ phase_id: phaseId }).eq("id", tradeId).then(unwrap),
};
