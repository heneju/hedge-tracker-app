// Quais contas livres pertencem a uma mesa -- para o cadastro não oferecer
// conta da Tradeify a quem escolheu a Blue Guardian.
//
// O critério é o que a própria mesa escreve no nome da conta
// (`prop_firms.account_pattern`), o mesmo padrão que o coletor usa para ligar
// a conta funded. E a plataforma: a Fundingpips é MT5 e não tem o que fazer
// com uma conta do NinjaTrader.

// NinjaTrader e Tradovate são a mesma conta por dois caminhos.
const FUTURES = new Set(["NT8", "Tradovate"]);

function samePlatform(firmPlatform, accountPlatform) {
  if (!firmPlatform || firmPlatform === "Other") return true;
  if (FUTURES.has(firmPlatform)) return FUTURES.has(accountPlatform);
  return firmPlatform === accountPlatform;
}

/**
 * Compila o padrão aceitando `(?P<x>)`, a grafia do Python.
 *
 * Padrão quebrado vira null, e null quer dizer "sem filtro por nome" -- não
 * "nenhuma conta". Uma regex digitada errado no Setup não pode esvaziar o
 * cadastro.
 */
export function compilePattern(pattern) {
  if (!pattern) return null;
  try {
    return new RegExp(pattern.replace(/\(\?P</g, "(?<"));
  } catch {
    return null;
  }
}

/**
 * Separa `options` (`{ platform, name }`) em contas da mesa e o resto.
 *
 * `rule` diz o que filtrou: "pattern" (nome e plataforma), "platform" (a mesa
 * não tem padrão de nome) ou null (nenhuma mesa escolhida -- tudo aparece).
 *
 * O nome não é conferido no MT5: ali a fonte descoberta é o hash do terminal e
 * a conta registrada é o login numérico. Nenhum dos dois é o nome que a mesa dá.
 */
export function filterForFirm(options, firm) {
  if (!firm) return { shown: options, hidden: [], rule: null };
  const rx = firm.platform === "MT5" ? null : compilePattern(firm.account_pattern);
  const shown = [];
  const hidden = [];
  for (const o of options) {
    const ok = samePlatform(firm.platform, o.platform)
      && (!rx || o.platform === "MT5" || rx.test(String(o.name || "").trim()));
    (ok ? shown : hidden).push(o);
  }
  return { shown, hidden, rule: rx ? "pattern" : "platform" };
}
