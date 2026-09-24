// De qual computador vem cada conta.
//
// Quem opera em várias máquinas -- um PC em casa, uma VPS para cada conjunto
// de contas -- via tudo empilhado numa lista só, e cadastrar a conta certa
// virava caça ao login. O coletor carimba o nome da máquina em cada fonte
// descoberta e em cada conta que lê (`collector_status.machine` é o mesmo
// nome), e aqui o painel usa esse carimbo para mostrar uma máquina de cada vez.
//
// REGRA DO CARIMBO VAZIO: linha sem máquina aparece em TODAS as seleções, não
// em nenhuma. Conta cadastrada à mão, conta antiga e conta que nenhum coletor
// enxerga não têm carimbo -- escondê-las tiraria dinheiro do total sem nada na
// tela dizendo que sumiu. Aparecer duas vezes se nota; sumir, não.

/** Nenhuma máquina escolhida: o painel mostra tudo. */
export const ALL = "";

/**
 * Os nomes que valem para o seletor.
 *
 * `statuses` é `collector_status` (uma linha por máquina instalada, existe
 * mesmo antes de a máquina ter conta classificada) e `accounts` completa com
 * máquina que parou de reportar mas ainda tem conta carimbada.
 */
export function machineNames(statuses = [], accounts = []) {
  const nomes = new Set();
  for (const lista of [statuses, accounts]) {
    for (const row of lista) if (row?.machine) nomes.add(row.machine);
  }
  return [...nomes].sort((a, b) => a.localeCompare(b));
}

/** A linha pertence à máquina escolhida? Sem carimbo pertence a todas. */
export function isFrom(row, machine) {
  if (!machine) return true;
  return !row?.machine || row.machine === machine;
}

/** Filtra linhas que trazem a coluna `machine` (contas, fontes descobertas). */
export function keep(rows, machine) {
  return machine ? rows.filter((r) => isFrom(r, machine)) : rows;
}

/**
 * Máquina de cada conta, por id.
 *
 * É o mapa que traduz qualquer linha com `account_id` -- progresso, trade
 * solta, fase -- para uma máquina.
 */
export function machineOfAccount(accounts = []) {
  return new Map(accounts.map((a) => [a.id, a.machine || null]));
}

/** Filtra linhas que apontam para uma conta em vez de trazer o carimbo. */
export function keepByAccount(rows, accounts, machine) {
  if (!machine) return rows;
  const de = machineOfAccount(accounts);
  return rows.filter((r) => {
    const nome = de.get(r.account_id);
    return !nome || nome === machine;
  });
}

/**
 * Filtra challenges pela máquina que lê as contas deles.
 *
 * O challenge não tem máquina: quem tem é a conta. `progress` (uma linha por
 * conta do challenge) faz a ponte. Challenge cujas contas não têm carimbo --
 * ou que nem aparece no progresso, como os encerrados -- fica visível em todas
 * as seleções, pela mesma razão da regra do carimbo vazio.
 */
export function keepChallenges(journal, progress, accounts, machine) {
  if (!machine) return journal;
  const de = machineOfAccount(accounts);
  const porChallenge = new Map();
  for (const p of progress) {
    const nomes = porChallenge.get(p.challenge_id) || [];
    nomes.push(de.get(p.account_id) || null);
    porChallenge.set(p.challenge_id, nomes);
  }
  return journal.filter((c) => {
    const nomes = porChallenge.get(c.id);
    if (!nomes || nomes.every((n) => !n)) return true;
    return nomes.includes(machine);
  });
}
