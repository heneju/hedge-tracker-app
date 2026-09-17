// The next order uses the current phase, never averages from historical pairs.
export function nextLiveLot(challenge, progress) {
  const phase = { phase1: "P1", phase2: "P2", funded: "FUNDED" }[challenge.status];
  if (!phase || challenge.drawdown_blown) return { lot: null, reason: "No next operation" };
  const account = progress.find((a) => Number(a.challenge_id) === Number(challenge.id) && a.phase === phase);
  if (!account || account.blown) return { lot: null, reason: "No active account for this phase" };
  if (phase !== "FUNDED") {
    const cost = Number(account.spent);
    // A folga, nao o drawdown do plano: o hedge devolve o gasto no dia em que
    // a conta morrer, e ela morre ao perder o que ainda tem. Enquanto o piso
    // persegue o pico os dois numeros sao o mesmo; depois que ele trava, nao.
    const drawdown = Number(account.drawdown_room);
    if (account.spent == null || !Number.isFinite(cost) || cost < 0
        || !Number.isFinite(drawdown) || drawdown <= 0) {
      return { lot: null, reason: "Recovery cost or room to blow unavailable" };
    }
    return {
      lot: Math.round(cost / drawdown * 100) / 100,
      reason: `Evaluation: total cost to recover ${cost.toFixed(2)} / ${drawdown.toFixed(2)} left to lose. No extra buffer or contract scaling.`,
    };
  }
  const contracts = Number(account.last_contracts);
  if (!(contracts > 0)) return { lot: null, reason: "Contract quantity unavailable" };
  const bufferedDaily = phase === "FUNDED"
    && String(challenge.firm).toLowerCase() === "tradeify"
    && String(account.product).toLowerCase() === "select"
    && challenge.payout_policy === "daily"
    && account.drawdown_locked
    && (Number(challenge.funded_gross_paid) > 0
      || (Number(challenge.payout_buffer) > 0
        && Number(challenge.funded_prop) >= Number(challenge.payout_buffer)));
  // Operator's post-buffer strategy; this is not a prop-firm requirement.
  const multiplier = bufferedDaily ? 0.25 : account.hedge_multiplier;
  if (multiplier == null || !Number.isFinite(Number(multiplier)) || Number(multiplier) < 0) {
    return { lot: null, reason: "Recommendation unavailable" };
  }
  // O stop que este numero assume e o CHAO: e ali que a conta morre e o hedge
  // precisa ter devolvido o gasto. Parar antes disso faz o hedge devolver mais
  // do que se perdeu -- nao e erro, e dinheiro parado na live.
  const room = Number(account.drawdown_room);
  const stop = bufferedDaily || !Number.isFinite(room) || room <= 0
    ? "" : ` Assumes the stop at the floor, ${room.toFixed(2)} away.`;
  return {
    lot: Math.round(Number(multiplier) * contracts * 100) / 100,
    reason: `${bufferedDaily ? "Post-buffer strategy" : "Recovery calculation"}: ${Number(multiplier)} per contract × ${contracts} contract(s). Assumes the same contract quantity as the last operation.${stop}`,
  };
}
