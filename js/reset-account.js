// Reset de conta estourada: a mesa devolve a MESMA conta, com o mesmo número,
// e o placar tem que voltar do zero.
//
// Aqui só se decide O QUE escrever. Quem escreve é o app, e a ordem importa:
// fechar a tentativa velha ANTES de abrir a nova. Duas fases abertas na mesma
// conta deixariam o coletor sem saber em qual carimbar o trade que chegar.
//
// Nada é apagado. As trades da tentativa velha continuam nela, com o mesmo
// `phase_id`, e o challenge velho segue mostrando o que aquela tentativa
// custou. Quem separa as duas é a janela de tempo da fase -- ver a migration
// 0051 e `PhaseWindow` no coletor.

export const PHASE_OF_STATUS = { phase1: "P1", phase2: "P2", funded: "FUNDED" };

/**
 * A fase que a conta está rodando: a última que tem conta ligada.
 *
 * Um challenge de duas etapas tem P1 numa conta e P2 em outra. Quem estourou é
 * a da etapa corrente, e é ela que a mesa reseta.
 */
export function currentPhase(phases) {
  return [...phases]
    .filter((p) => p.account_id)
    .sort((a, b) => Number(a.id) - Number(b.id))
    .pop() || null;
}

/**
 * A tentativa que a conta está rodando agora, quando não é esta.
 *
 * Uma conta pode ser resetada mais de uma vez. Abrir o challenge da PRIMEIRA
 * tentativa e mandar resetar de novo deixaria duas fases abertas na mesma
 * conta, e o coletor carimbaria o trade na que tivesse começado por último.
 */
export function newerAttempt(attempts, phaseId) {
  const ultima = [...attempts].sort((a, b) => Number(a.id) - Number(b.id)).pop();
  return ultima && Number(ultima.id) !== Number(phaseId) ? ultima : null;
}

/**
 * O que um reset escreve, sem escrever nada.
 *
 * `at` é o instante do reset: ele fecha a tentativa velha e abre a nova no
 * mesmo ponto, para não existir buraco entre as duas.
 */
export function planReset(challenge, phases, { at, restartAs = "phase1", cost = null, date }) {
  const alvo = currentPhase(phases);
  if (!alvo) throw new Error("this challenge has no account to reset");
  const phase = PHASE_OF_STATUS[restartAs];
  if (!phase) throw new Error(`unknown stage: ${restartAs}`);

  const valor = Number(cost);
  return {
    account_id: alvo.account_id,
    // Fase sem `ended_at` é fase aberta. Fechar as duas de um challenge de
    // duas etapas evita deixar a P1 eternamente aberta numa conta reusada.
    close: phases
      .filter((p) => p.account_id && !p.ended_at)
      .map((p) => ({ id: p.id, patch: { outcome: "failed", ended_at: at } })),
    // O challenge velho é histórico: ele fica reprovado, não some.
    challengePatch: challenge.status === "failed" ? null : { status: "failed" },
    challenge: {
      firm_id: challenge.firm_id ?? null,
      plan_id: challenge.plan_id ?? null,
      date_open: date,
      status: restartAs,
      target: challenge.target ?? null,
      split_pct: challenge.split_pct ?? null,
      consistency_addon: Boolean(challenge.consistency_addon),
    },
    phase: {
      phase,
      account_id: alvo.account_id,
      started_at: at,
      outcome: "active",
    },
    // O reset costuma ter preço, e é ele que o hedge da tentativa nova precisa
    // devolver. Sem preço não se inventa lançamento.
    cash: Number.isFinite(valor) && valor !== 0
      ? { kind: "cost", amount: -Math.abs(valor), occurred_on: date, source: "manual" }
      : null,
  };
}
