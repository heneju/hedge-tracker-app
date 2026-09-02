// Células editáveis, para a tabela se comportar como a planilha que ela
// substitui.
//
// A regra que separa o que dá para editar do que não dá: **um campo é editável
// quando não há medição por trás dele**. O custo é uma decisão sua, então
// edita. O resultado da perna live, quando existem trades pareadas, é medido —
// editá-lo seria mentir para si mesmo, e o campo fica travado mostrando de onde
// veio. Para as linhas importadas da planilha não há trade nenhuma, então
// aquele mesmo campo volta a ser editável.

import { esc } from "./util.js?v=e8607d028f";

/**
 * Marca uma célula como editável. O HTML fica com os dados no dataset e o
 * comportamento é ligado depois por `wireEditables`, para funcionar em tabelas
 * redesenhadas por innerHTML.
 */
export function cell(value, { type = "text", field, id, options, format, title, align }) {
  const shown = format ? format(value) : (value ?? "");
  return `<td class="editable${align ? " num" : ""}"
    data-edit-field="${esc(field)}"
    data-edit-id="${esc(String(id))}"
    data-edit-type="${esc(type)}"
    data-edit-value="${esc(value ?? "")}"
    ${options ? `data-edit-options="${esc(JSON.stringify(options))}"` : ""}
    ${title ? `title="${esc(title)}"` : ""}
  >${shown}</td>`;
}

/** Célula travada: mostra o valor e explica por que não dá para mexer. */
export function locked(shown, why) {
  return `<td class="num locked" title="${esc(why)}">${shown}</td>`;
}

function inputFor(td) {
  const type = td.dataset.editType;
  const value = td.dataset.editValue ?? "";

  if (type === "select") {
    const options = JSON.parse(td.dataset.editOptions || "[]");
    const el = document.createElement("select");
    el.innerHTML = options
      .map((o) => `<option value="${esc(o.value)}" ${
        String(o.value) === String(value) ? "selected" : ""}>${esc(o.label)}</option>`)
      .join("");
    return el;
  }

  const el = document.createElement("input");
  el.type = type === "number" ? "number" : type === "date" ? "date" : "text";
  if (type === "number") el.step = "any";
  el.value = value;
  return el;
}

/**
 * Liga a edição nas células marcadas.
 *
 * `onSave(field, id, value)` deve devolver uma promessa. Enquanto ela não
 * resolve a célula fica em espera; se rejeitar, o valor antigo volta -- nunca
 * deixar a tela mostrando algo que o banco não aceitou.
 */
export function wireEditables(root, onSave) {
  root.querySelectorAll("td.editable").forEach((td) => {
    td.onclick = (event) => {
      if (td.querySelector("input, select")) return;
      event.stopPropagation(); // não abrir o drill-down ao clicar para editar

      const previousHtml = td.innerHTML;
      const previousValue = td.dataset.editValue ?? "";
      const input = inputFor(td);

      let done = false;
      const finish = async (commit) => {
        if (done) return;
        done = true;
        const next = commit ? input.value : previousValue;

        if (!commit || String(next) === String(previousValue)) {
          td.innerHTML = previousHtml;
          return;
        }

        td.textContent = "…";
        try {
          await onSave(td.dataset.editField, td.dataset.editId, next);
        } catch {
          td.innerHTML = previousHtml; // o banco recusou: a tela volta atrás
        }
      };

      input.onblur = () => finish(true);
      input.onkeydown = (e) => {
        if (e.key === "Enter") { e.preventDefault(); input.blur(); }
        if (e.key === "Escape") { e.preventDefault(); finish(false); }
      };
      if (input.tagName === "SELECT") input.onchange = () => input.blur();

      td.innerHTML = "";
      td.appendChild(input);
      input.focus();
      if (input.select) input.select();
    };
  });
}
