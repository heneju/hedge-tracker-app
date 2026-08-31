// Formatacao e o calculo do magic, espelhando collector/core/magic.py.

export const money = (v) =>
  (Number(v) || 0).toLocaleString("pt-BR", {
    style: "currency", currency: "USD", minimumFractionDigits: 2,
  });

export const money0 = (v) =>
  (Number(v) || 0).toLocaleString("pt-BR", {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  });

export const num = (v, d = 2) =>
  (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });

export const signClass = (v) => (Number(v) > 0 ? "pos" : Number(v) < 0 ? "neg" : "muted");

// Colunas `date` do Postgres chegam como "2026-08-31", sem hora. Passar isso
// pelo construtor de Date faz o navegador ler como meia-noite UTC e exibir no
// fuso local -- no Brasil, o dia anterior. Datas puras sao formatadas pelos
// proprios campos, sem nenhuma conversao de fuso.
const DATE_ONLY = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/;

export const day = (iso) => {
  if (!iso) return "—";
  const m = DATE_ONLY.exec(iso);
  if (m) return `${m[3] ?? "01"}/${m[2]}/${m[1]}`;
  return new Date(iso).toLocaleDateString("pt-BR");
};

// Timestamps tem fuso de verdade, entao aqui a conversao para a hora local e
// justamente o que se quer.
export const stamp = (iso) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
      })
    : "—";

const MONTHS_PT = ["jan", "fev", "mar", "abr", "mai", "jun",
                   "jul", "ago", "set", "out", "nov", "dez"];

export const monthLabel = (iso) => {
  const m = DATE_ONLY.exec(String(iso).slice(0, 10));
  if (!m) return String(iso);
  return `${MONTHS_PT[Number(m[2]) - 1]}/${m[1].slice(2)}`;
};

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const STATUS_LABEL = {
  phase1: "Fase 1", phase2: "Fase 2", funded: "Funded",
  failed: "Perdida", closed: "Encerrada",
};

export const PHASE_LABEL = { P1: "Fase 1", P2: "Fase 2", FUNDED: "Funded" };

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
