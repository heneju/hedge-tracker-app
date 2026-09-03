// Exportação do journal para .xlsx.
//
// Por que ExcelJS e não SheetJS: a versão livre do SheetJS escreve só o dado
// cru -- fonte, cor, borda e largura de coluna são pagas. Aqui a planilha
// precisa sair com a cara do painel, então o estilo é o ponto.
//
// A biblioteca tem quase 1 MB e só serve a este botão: carrega na hora do
// clique, não no boot. Quem abre o painel para ver o multiplicador do dia não
// paga por isso.
//
// Arquivo aberto no Google Sheets também: Archivo está no catálogo de fontes
// dele, e os formatos numéricos usados aqui são os que o Sheets importa sem
// reinterpretar.

import { monthLabel } from "./util.js?v=8a1bc0d785";

const EXCELJS = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";

// Os mesmos tokens do painel, em hexadecimal sem alfa -- é o que o xlsx aceita.
const INK = "FF201E1D";
const PAPER = "FFF3F2F2";
const RULE = "FFBAB6B6";
const MUTED = "FF605D5D";
const GAIN = "FF0C6A49";
const LOSS = "FFAE1800";
const ACCENT = "FFEC3013";
const ACCENT_TINT = "FFFFE0D9";
const GAIN_TINT = "FFD9EDE5";
const NEUTRAL_TINT = "FFEAE7E7";

const MONEY = '$#,##0.00;-$#,##0.00';

let loading = null;

/** Carrega a biblioteca uma vez só, e devolve a mesma promessa nas seguintes. */
function loadExcel() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  loading ??= new Promise((resolve, reject) => {
    const tag = document.createElement("script");
    tag.src = EXCELJS;
    tag.onload = () => (window.ExcelJS ? resolve(window.ExcelJS)
      : reject(new Error("ExcelJS carregou mas não se registrou")));
    tag.onerror = () => {
      loading = null;   // deixa tentar de novo no próximo clique
      reject(new Error("não consegui baixar a biblioteca de planilha"));
    };
    document.head.appendChild(tag);
  });
  return loading;
}

/** Colunas na mesma ordem da tela. `p2` some quando nenhuma linha usa 2 fases. */
function columns(showP2) {
  return [
    { key: "acct", header: "Acct", width: 11 },
    { key: "firm", header: "Firm", width: 14 },
    { key: "platform", header: "Platform", width: 14 },
    { key: "opened", header: "Opened", width: 13, fmt: "yyyy-mm-dd" },
    { key: "status", header: "Status", width: 24 },
    { key: "mult", header: "Mult.", width: 11, fmt: "0.000" },
    { key: "eval_prop", header: "Prop eval", width: 15, fmt: MONEY, sign: true },
    { key: "funded_prop", header: "Prop funded", width: 17, fmt: MONEY, sign: true },
    { key: "cost", header: "Cost", width: 13, fmt: MONEY, sign: true },
    { key: "p1_live", header: "Phase 1 live", width: 18, fmt: MONEY, sign: true },
    ...(showP2
      ? [{ key: "p2_live", header: "Phase 2 live", width: 18, fmt: MONEY, sign: true }]
      : []),
    { key: "funded_live", header: "Funded live", width: 17, fmt: MONEY, sign: true },
    { key: "payout", header: "Payout", width: 13, fmt: MONEY, sign: true },
    { key: "pending", header: "Pending", width: 14, fmt: MONEY, sign: true },
    { key: "hedge", header: "Hedge", width: 14, fmt: MONEY, sign: true },
    { key: "total", header: "Total", width: 16, fmt: MONEY, sign: true, strong: true },
    { key: "notes", header: "Notes", width: 34 },
    { key: "trades", header: "Trades", width: 12, fmt: "0" },
  ];
}

const num = (v) => (v == null || v === "" ? null : Number(v));

// Uma data pura ("2026-08-31") não tem hora nem fuso, e o xlsx guarda data
// como número de dias. Montada com `Date.UTC` ela cai exatamente na
// meia-noite que o Excel espera; montada no fuso local (`new Date(y, m, d)`)
// ela chegaria com três horas de sobra no Brasil, e a célula carregaria um
// horário que ninguém pediu.
const asDate = (iso) => {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return d ? new Date(Date.UTC(y, m - 1, d)) : null;
};

const STATUS_FILL = {
  failed: ACCENT_TINT,
  passed: ACCENT_TINT,
  funded: GAIN_TINT,
};

/**
 * Gera e baixa o xlsx do que está na tela.
 *
 * `rows` são as linhas do journal já filtradas -- exporta o que se está
 * olhando, não a tabela inteira, e o cabeçalho registra qual filtro estava
 * valendo para o arquivo não virar um número sem procedência.
 */
export async function exportChallenges(rows, { filters = {}, statusLabel, showP2 }) {
  const ExcelJS = await loadExcel();
  const wb = new ExcelJS.Workbook();
  wb.creator = "Tracking";
  wb.created = new Date();

  // Congela SO as linhas de cabeçalho. Congelar a coluna da conta junto
  // desenha uma barra cinza grossa entre A e B, do topo ao fim da planilha --
  // com a grade desligada ela fica sendo a única linha vertical da tela e
  // parece defeito, não recurso.
  const ws = wb.addWorksheet("Challenges", {
    views: [{ state: "frozen", ySplit: 4, showGridLines: false }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const cols = columns(showP2);
  ws.columns = cols.map((c) => ({ key: c.key }));
  const last = cols.length;

  // ------------------------------------------------------------- cabeçalho
  ws.mergeCells(1, 1, 1, last);
  const title = ws.getCell(1, 1);
  title.value = "TRACKING";
  title.font = { name: "Archivo", size: 20, bold: true, color: { argb: ACCENT } };
  ws.getRow(1).height = 30;

  const applied = [
    filters.status ? `status ${statusLabel(filters.status)}` : "all statuses",
    filters.firm || "all firms",
    filters.month ? monthLabel(filters.month) : "all months",
    filters.q ? `search “${filters.q}”` : null,
  ].filter(Boolean).join(" · ");

  ws.mergeCells(2, 1, 2, last);
  const sub = ws.getCell(2, 1);
  sub.value = `Challenges · ${rows.length} row${rows.length === 1 ? "" : "s"} · ${applied}`
    + ` · exported ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`;
  sub.font = { name: "Archivo", size: 10, color: { argb: MUTED } };
  ws.getRow(2).height = 16;
  ws.getRow(3).height = 6;

  // ------------------------------------------------------------- colunas
  const head = ws.getRow(4);
  cols.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.header.toUpperCase();
    cell.font = { name: "Archivo", size: 9, bold: true, color: { argb: PAPER } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
    cell.alignment = { vertical: "middle", horizontal: c.fmt ? "right" : "left" };
  });
  head.height = 22;

  // ---------------------------------------------------------------- dados
  rows.forEach((r) => {
    const dead = r.status === "failed" || r.drawdown_blown;
    const row = ws.addRow({
      acct: r.account_ids || "—",
      firm: r.firm || "—",
      platform: r.platform || "—",
      opened: asDate(r.date_open),
      status: statusLabel(r.status, r.eval_phases),
      mult: num(r.multipliers && !String(r.multipliers).includes("/") ? r.multipliers : null),
      eval_prop: r.prop_trades ? num(r.eval_prop) : null,
      funded_prop: r.prop_trades ? num(r.funded_prop) : null,
      cost: num(r.cost),
      p1_live: num(r.p1_live),
      ...(showP2 ? { p2_live: num(r.p2_live) } : {}),
      funded_live: num(r.funded_live),
      payout: num(r.funded_payout),
      pending: num(r.funded_pending) || null,
      hedge: num(r.lost_hedging),
      total: num(r.total_pnl),
      notes: r.comments || "",
      trades: num(r.trade_count) ?? 0,
    });

    row.height = 18;
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.border = { bottom: { style: "hair", color: { argb: RULE } } };
      cell.font = { name: "Archivo", size: 10, color: { argb: INK } };
      if (c.fmt) {
        cell.numFmt = c.fmt;
        cell.alignment = { horizontal: "right" };
      }
      // Perda no vermelho da marca e ganho no verde: é a mesma leitura da
      // tela, e num extrato de 18 colunas o sinal é o que se procura antes
      // do valor.
      if (c.sign && typeof cell.value === "number" && cell.value !== 0) {
        cell.font = {
          name: "Archivo", size: 10, bold: !!c.strong,
          color: { argb: cell.value < 0 ? LOSS : GAIN },
        };
      } else if (c.strong) {
        cell.font = { name: "Archivo", size: 10, bold: true, color: { argb: INK } };
      }
    });

    const status = row.getCell(cols.findIndex((c) => c.key === "status") + 1);
    const fill = STATUS_FILL[r.status] || NEUTRAL_TINT;
    status.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    status.font = { name: "Archivo", size: 9, bold: true, color: { argb: MUTED } };

    // Conta estourada riscada, como no painel.
    if (dead) {
      const acct = row.getCell(1);
      acct.font = { name: "Archivo", size: 10, strike: true, color: { argb: MUTED } };
    }
  });

  // --------------------------------------------------------------- totais
  const sum = (f) => rows.reduce((a, c) => a + Number(c[f] || 0), 0);
  const totals = ws.addRow({
    acct: "TOTAL",
    eval_prop: sum("eval_prop"),
    funded_prop: sum("funded_prop"),
    cost: sum("cost"),
    p1_live: sum("p1_live"),
    ...(showP2 ? { p2_live: sum("p2_live") } : {}),
    funded_live: sum("funded_live"),
    payout: sum("funded_payout"),
    pending: sum("funded_pending"),
    hedge: sum("lost_hedging"),
    total: sum("total_pnl"),
  });
  totals.height = 22;
  cols.forEach((c, i) => {
    const cell = totals.getCell(i + 1);
    cell.border = { top: { style: "medium", color: { argb: INK } } };
    const value = typeof cell.value === "number" ? cell.value : 0;
    cell.font = {
      name: "Archivo", size: 10, bold: true,
      color: { argb: c.sign && value !== 0 ? (value < 0 ? LOSS : GAIN) : INK },
    };
    if (c.fmt) {
      cell.numFmt = c.fmt;
      cell.alignment = { horizontal: "right" };
    }
  });

  // Filtro na linha de cabeçalho: no Sheets é o que transforma o arquivo de
  // retrato em ferramenta.
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + rows.length, column: last } };

  // Largura por último, uma coluna de cada vez.
  //
  // Duas armadilhas juntas. A primeira: passar `width` dentro de `ws.columns`
  // perde silenciosamente algumas colunas -- no primeiro arquivo exportado,
  // PROP FUNDED, FUNDED LIVE, PENDING e TRADES sairam na largura padrão e com
  // o nome cortado. `getColumn().width` depois das linhas escritas sempre
  // pega. A segunda: o botão de filtro do Sheets fica DENTRO da célula e come
  // umas três letras do título, então a largura mínima considera o cabeçalho
  // mais essa folga, e não só o número que eu achei bonito.
  cols.forEach((c, i) => {
    ws.getColumn(i + 1).width = Math.max(c.width, c.header.length + 6);
  });

  const buffer = await wb.xlsx.writeBuffer();
  download(buffer, `tracking-challenges-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function download(buffer, filename) {
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Soltar na hora cancelaria o download em alguns navegadores.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
