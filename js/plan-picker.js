// Seletor de plano do cadastro: mesa, modelo, tamanho e add-on, um passo
// depois do outro -- a ordem em que a propria mesa vende.
//
// Antes o catalogo inteiro virava botao solto: 30 planos lado a lado, sem
// caminho obvio, e a Fundingpips sozinha ocupava quatro linhas. Aqui so
// aparece o passo seguinte ao que ja foi escolhido.
//
// O modulo so escolhe. O que o plano faz no formulario fica em quem monta o
// seletor (`onPlan`), porque e o formulario que sabe quais campos existem.

import { esc, money0, num } from "./util.js?v=7b60df4171";

const firmOf = (pl) => pl.prop_firms?.name || "?";

// O modelo e o nome sem caixa: "1 step" e "1 Step" sao o mesmo produto
// cadastrado duas vezes. O `product` fica fora da chave de proposito -- no
// catalogo real o Select de 50K antigo nao tem `product` e os outros tamanhos
// tem, e separar por ele partia um produto em dois botoes com o mesmo nome.
const modelOf = (pl) => String(pl.name || "—").trim().toLowerCase();

const sizeOf = (pl) => String(Number(pl.account_size));

const sizeShort = (v) => {
  const n = Number(v);
  return n >= 1000 ? `${num(n / 1000, n % 1000 ? 1 : 0)}K` : num(n, 0);
};

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const k = key(row);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  }
  return map;
}

export function rulesLine(pl) {
  const target = pl.profit_target_p2
    ? `target ${money0(pl.profit_target)} / ${money0(pl.profit_target_p2)}`
    : pl.profit_target ? `target ${money0(pl.profit_target)}` : null;
  return [
    target,
    pl.max_drawdown ? `dd ${money0(pl.max_drawdown)}${
      pl.drawdown_type ? ` ${String(pl.drawdown_type).toUpperCase()}` : ""}` : null,
    pl.consistency_pct ? `${num(pl.consistency_pct, 0)}% consistency` : null,
    pl.profit_split ? `${num(pl.profit_split, 0)}% split` : null,
    pl.price ? money0(pl.price) : null,
  ].filter(Boolean).join(" · ");
}

/**
 * Monta o seletor em `container`.
 *
 * - `daysFor(pct)`: dias que uma consistencia exige (vem do app, para haver
 *   uma conta so desse numero no painel inteiro).
 * - `addonChecked()`: estado atual do add-on no formulario.
 * - `onPlan(plano)`: chamado quando um plano fica escolhido -- uma vez por
 *   plano, para nao reescrever por cima do que a pessoa editou a mao.
 * - `onAddon(marcado)`: o botao de upgrade do seletor mudou.
 *
 * Devolve `{ redraw }`, para o formulario avisar quando o add-on mudou por la.
 */
export function mountPlanPicker(container, plans, { daysFor, addonChecked, onPlan, onAddon }) {
  const pick = { firm: null, model: null, size: null, planId: null };
  let applied = null;

  const levels = () => {
    const firms = groupBy(plans, firmOf);
    const models = groupBy(firms.get(pick.firm) || [], modelOf);
    const sizes = groupBy(models.get(pick.model) || [], sizeOf);
    const variants = sizes.get(pick.size) || [];
    return { firms, models, sizes, variants };
  };

  // Passo com uma opcao so se escolhe sozinho: perguntar o obvio e clique a
  // mais, e na Tradeify ha modelo com um tamanho so. A MESA nunca se escolhe
  // sozinha -- preencheria o formulario sem ninguem ter clicado em nada.
  const settle = () => {
    const only = (map) => (map.size === 1 ? [...map.keys()][0] : null);
    let lv = levels();
    if (pick.firm && !pick.model) pick.model = only(lv.models);
    lv = levels();
    if (pick.model && !pick.size) pick.size = only(lv.sizes);
    lv = levels();
    if (pick.size && !pick.planId && lv.variants.length === 1) pick.planId = lv.variants[0].id;
    return levels();
  };

  const chosen = () => plans.find((p) => p.id === pick.planId) || null;

  const button = (attr, key, active, inner) => `
    <button type="button" class="btn ghost plan-tile${active ? " active" : ""}"
            ${attr}="${esc(key)}" aria-pressed="${active}">${inner}</button>`;

  const step = (n, label, body) => `
    <div class="pick-step">
      <div class="pick-label"><span class="pick-n">${n}</span>${esc(label)}</div>
      <div class="pick-options">${body}</div>
    </div>`;

  function draw() {
    const lv = settle();
    const pl = chosen();
    let n = 0;

    let html = step(++n, "Prop firm", [...lv.firms].map(([firm, rows]) =>
      button("data-pick-firm", firm, firm === pick.firm,
        `<strong class="bright">${esc(firm)}</strong>
         <span class="sub">${rows.length} plan${rows.length === 1 ? "" : "s"}</span>`)).join(""));

    if (pick.firm) {
      html += step(++n, "Account type", [...lv.models].map(([key, rows]) => {
        const sizes = [...new Set(rows.map((r) => Number(r.account_size)))].sort((a, b) => a - b);
        return button("data-pick-model", key, key === pick.model,
          `<strong class="bright">${esc(rows[0].name || "—")}</strong>
           <span class="sub">${sizes.map(sizeShort).join(" · ")}</span>`);
      }).join(""));
    }

    if (pick.model) {
      // Ordem numerica explicita: os grupos saem na ordem do catalogo, e ali
      // um cadastro antigo de 50K vinha antes do 25K.
      const bySize = [...lv.sizes].sort(([a], [b]) => Number(a) - Number(b));
      html += step(++n, "Size", bySize.map(([key, rows]) => {
        const prices = new Set(rows.map((r) => Number(r.price) || 0));
        const price = prices.size === 1 ? [...prices][0] : 0;
        return button("data-pick-size", key, key === pick.size,
          `<strong class="bright">${money0(rows[0].account_size)}</strong>
           <span class="sub">${price ? money0(price)
             : rows.length > 1 ? `${rows.length} variants` : "&nbsp;"}</span>`);
      }).join(""));
    }

    // Mesmo modelo e tamanho com regras diferentes existe no catalogo real --
    // um cadastro antigo ao lado do atual. Escolher um deles em silencio
    // aplicaria a regra errada sem ninguem perceber.
    if (pick.size && lv.variants.length > 1) {
      html += step(++n, "Rules", lv.variants.map((v) =>
        button("data-pick-plan", String(v.id), v.id === pick.planId,
          `<span>${esc(rulesLine(v))}</span>`)).join(""));
    }

    if (pl && pl.consistency_addon_pct != null) {
      const on = Boolean(addonChecked());
      const extra = Number(pl.consistency_addon_price) || 0;
      html += step(++n, "Upgrade", `
        <label class="btn ghost plan-tile pick-addon${on ? " active" : ""}">
          <input type="checkbox" data-pick-addon ${on ? "checked" : ""}>
          <span>
            <strong class="bright">Pass in ${daysFor(pl.consistency_addon_pct)} days</strong>${
              extra ? ` <strong class="bright">+${money0(extra)}</strong>` : ""}
            <span class="sub">consistency ${num(pl.consistency_pct, 0)}% → ${
              num(pl.consistency_addon_pct, 0)}%</span>
          </span>
        </label>`);
    }

    if (pl) {
      html += `
        <div class="pick-summary">
          <strong class="bright">${esc(firmOf(pl))} · ${esc(pl.name || "")} · ${money0(pl.account_size)}</strong>
          <span class="muted">${esc(rulesLine(pl))}</span>
        </div>`;
    }

    container.innerHTML = html;
    wire();
  }

  function select(patch) {
    Object.assign(pick, patch);
    settle();
    const pl = chosen();
    if (pl && pl.id !== applied) {
      applied = pl.id;
      onPlan(pl);
    }
    draw();
  }

  function wire() {
    const on = (selector, fn) => container.querySelectorAll(selector)
      .forEach((el) => { el.onclick = () => fn(el.dataset); });
    on("[data-pick-firm]", (d) => d.pickFirm !== pick.firm
      && select({ firm: d.pickFirm, model: null, size: null, planId: null }));
    on("[data-pick-model]", (d) => d.pickModel !== pick.model
      && select({ model: d.pickModel, size: null, planId: null }));
    on("[data-pick-size]", (d) => d.pickSize !== pick.size
      && select({ size: d.pickSize, planId: null }));
    on("[data-pick-plan]", (d) => select({ planId: Number(d.pickPlan) }));
    const addon = container.querySelector("[data-pick-addon]");
    if (addon) addon.onchange = () => { onAddon(addon.checked); draw(); };
  }

  draw();
  return { redraw: draw };
}
