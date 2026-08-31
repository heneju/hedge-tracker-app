// Formatacao e o calculo do magic, espelhando collector/core/magic.py.

export const money = (v) =>
  (Number(v) || 0).toLocaleString("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: 2,
  });

export const money0 = (v) =>
  (Number(v) || 0).toLocaleString("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  });

export const num = (v, d = 2) =>
  (Number(v) || 0).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

export const pct = (v, d = 0) =>
  v == null || !Number.isFinite(v) ? "—" : `${Number(v).toFixed(d)}%`;

export const signClass = (v) => (Number(v) > 0 ? "pos" : Number(v) < 0 ? "neg" : "muted");

// Colunas `date` do Postgres chegam como "2026-08-31", sem hora. Passar isso
// pelo construtor de Date faz o navegador ler como meia-noite UTC e exibir no
// fuso local -- no Brasil, o dia anterior. Datas puras sao formatadas pelos
// proprios campos, sem nenhuma conversao de fuso.
const DATE_ONLY = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/;

export const day = (iso) => {
  if (!iso) return "—";
  const m = DATE_ONLY.exec(iso);
  // ISO curto: a data ja e legivel e sem ambiguidade entre dd/mm e mm/dd.
  if (m) return m[3] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[1]}-${m[2]}`;
  return new Date(iso).toISOString().slice(0, 10);
};

// Timestamps tem fuso de verdade, entao aqui a conversao para a hora local e
// justamente o que se quer.
export const stamp = (iso) =>
  iso
    ? new Date(iso).toLocaleString("en-GB", {
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
        hour12: false,
      })
    : "—";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun",
                "jul", "aug", "sep", "oct", "nov", "dec"];

export const monthLabel = (iso) => {
  const m = DATE_ONLY.exec(String(iso).slice(0, 10));
  if (!m) return String(iso);
  return `${MONTHS[Number(m[2]) - 1]}/${m[1].slice(2)}`;
};

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Os 4 últimos dígitos: é assim que o NinjaTrader identifica a conta na própria
// interface, e é o que distingue contas da mesma mesa, cujos números só diferem
// no fim.
export const accountShort = (loginOrName) =>
  String(loginOrName ?? "").slice(-4) || "—";

export const STATUS_LABEL = {
  phase1: "Phase 1", phase2: "Phase 2", funded: "Funded",
  failed: "Failed", closed: "Closed",
};

export const PHASE_LABEL = { P1: "Phase 1", P2: "Phase 2", FUNDED: "Funded" };

// Mesa de uma etapa so (Tradeify) nao tem "fase 1" e "fase 2" -- tem avaliacao.
// Chamar de "Phase 1" sugere uma fase 2 que nunca vai existir.
export const phaseLabel = (phase, evalPhases = 2) =>
  Number(evalPhases) === 1 && phase === "P1" ? "Evaluation" : PHASE_LABEL[phase] ?? phase;

export const statusLabel = (status, evalPhases = 2) =>
  Number(evalPhases) === 1 && status === "phase1" ? "Evaluation" : STATUS_LABEL[status] ?? status;

// Status oferecidos por mesa: sem fase 2 quando a mesa avalia em uma etapa.
export const statusOptions = (evalPhases = 2) =>
  (Number(evalPhases) === 1
    ? ["phase1", "funded", "failed", "closed"]
    : ["phase1", "phase2", "funded", "failed", "closed"]
  ).map((value) => ({ value, label: statusLabel(value, evalPhases) }));

export const phasesFor = (evalPhases = 2) =>
  Number(evalPhases) === 1 ? ["P1", "FUNDED"] : ["P1", "P2", "FUNDED"];

// FNV-1a 32-bit, igual ao Copyator_Sender_NT8.cs. Precisa existir tambem aqui
// porque a conta NT8 e classificada pelo app, e o coletor depende deste valor
// para traduzir o magic de um deal na conta live de volta para a conta prop.
export function fnv1a32(text) {
  let h = 2166136261 >>> 0;
  const bytes = new TextEncoder().encode(text);
  for (const b of bytes) {
    h = (h ^ b) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export const nt8SenderId = (accountName) => fnv1a32(accountName) & 0x7fffffff;

// contaOrigem cabe em 32 bits nos dois casos, entao source_part e ela mesma:
// NT8 usa o senderId; MT5, o numero de login.
export function magicSourcePart(platform, loginOrName) {
  if (platform === "NT8") return nt8SenderId(loginOrName);
  const login = Number(loginOrName);
  return Number.isFinite(login) ? login : null;
}
