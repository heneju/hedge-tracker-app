// Comprovante do saque: o print do Payout Certificate (Lucid) ou o PDF da
// invoice (Rise, no caso da Top One). O dono cola no formulario e o painel
// tira dali o bruto, a data e o numero -- valor pre-split para a nota, data
// para a competencia, numero para a descricao da NFS-e. Tudo no navegador:
// PDF pelo pdf.js e imagem por OCR (tesseract.js), os dois carregados so
// quando alguem cola. `parseProof` e puro (tests/proof.mjs); o resto mexe no DOM.

const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
const TESSERACT = "https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/tesseract.min.js";

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MONTH_RE = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
const WEEKDAY_RE = "(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\\s*)?";

// ------------------------------------------------------------------ valor
// "$1,996", "US$ 1,996.00", "1350.00 USD"; "S1,996" e o OCR perdendo o cifrao.
const MONEY = /(?:US\$|\$)\s?(\d[\d,]*(?:\.\d{1,3})?)|(\d[\d,]*(?:\.\d{1,3})?)\s?(?:USD|usd)\b|(?:^|[\s(])S(\d[\d,]*(?:\.\d{1,3})?)\b/g;
const AMOUNT_LABELS = [/payout\s+amount/i, /amount\s+paid/i, /\btotal\b/i, /\bamount\b/i, /\bpaid\b/i];

function toNumber(s) {
  let t = String(s).replace(/\s/g, "");
  // "1.996" sem centavos e com tres casas depois do ponto e milhar: o OCR trocou a virgula.
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  t = t.replace(/,/g, "");
  const v = Number(t);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function amounts(flat) {
  const out = [];
  for (const m of flat.matchAll(MONEY)) {
    const v = toNumber(m[1] ?? m[2] ?? m[3]);
    if (v != null) out.push({ v, at: m.index });
  }
  return out;
}

export function findAmount(flat) {
  const all = amounts(flat);
  if (!all.length) return null;
  for (const label of AMOUNT_LABELS) {
    const m = flat.match(label);
    if (!m) continue;
    const hit = all.find((a) => a.at >= m.index && a.at - m.index <= 40);
    if (hit) return hit.v;
  }
  return Math.max(...all.map((a) => a.v));
}

// ------------------------------------------------------------------- data
const DATE_PATTERNS = [
  // November 04, 2026 · Nov 04, Wed 2026 (Rise poe o dia da semana no meio) · Nov 4 2026
  { re: new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s*${WEEKDAY_RE}(\\d{4})\\b`, "ig"),
    pick: (m) => [m[3], MONTHS[m[1].toLowerCase().slice(0, 3)], m[2]] },
  // 04 November 2026
  { re: new RegExp(`\\b(\\d{1,2})\\s+${MONTH_RE},?\\s+(\\d{4})\\b`, "ig"),
    pick: (m) => [m[3], MONTHS[m[2].toLowerCase().slice(0, 3)], m[1]] },
  // 2026-11-04
  { re: /\b(\d{4})-(\d{2})-(\d{2})\b/g, pick: (m) => [m[1], m[2], m[3]] },
  // 11/04/2026: mesa americana, mes/dia; se o primeiro passa de 12 e dia/mes.
  { re: /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g,
    pick: (m) => (Number(m[1]) > 12 ? [m[3], m[2], m[1]] : [m[3], m[1], m[2]]) },
];
const DATE_LABELS = [/paid\s+on/i, /payment\s+date/i, /payout\s+date/i, /date\s+paid/i, /\bdate\b/i];

function iso(y, mo, d) {
  const yy = Number(y), m = Number(mo), dd = Number(d);
  if (!(m >= 1 && m <= 12 && dd >= 1 && dd <= 31 && yy >= 2000 && yy <= 2100)) return null;
  return `${yy}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function dates(flat) {
  const out = [];
  for (const { re, pick } of DATE_PATTERNS) {
    for (const m of flat.matchAll(re)) {
      const v = iso(...pick(m));
      if (v) out.push({ v, at: m.index });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

export function findDate(flat) {
  const all = dates(flat);
  if (!all.length) return null;
  for (const label of DATE_LABELS) {
    const m = flat.match(label);
    if (!m) continue;
    const hit = all.find((a) => a.at >= m.index && a.at - m.index <= 30);
    if (hit) return hit.v;
  }
  return all[0].v;
}

// ----------------------------------------------------------------- numero
const REF_PATTERNS = [
  /(\d{12,})\s*Invoice\s*Number/i,                                                  // Rise: numero colado antes do rotulo
  /Invoice\s*(?:Number|No\.?|#|ID)[:\s#]*(?=[A-Z0-9-]*\d)([A-Z0-9][A-Z0-9-]{3,})/i,
  /(?:Certificate|Verification|Reference|Receipt|Transaction)\s*(?:ID|No\.?|#|Code|Number)[:\s#]*(?=[A-Z0-9-]*\d)([A-Z0-9][A-Z0-9-]{3,})/i,
  // codigo do certificado da Lucid; o OCR as vezes poe um espaco dentro do
  // grupo ou em volta do traco (18/11: "360B-16SK-QT OP-WCGP-ZCGG")
  /\b([A-Z0-9](?: ?[A-Z0-9]){3}(?: ?- ?[A-Z0-9](?: ?[A-Z0-9]){3}){3,})\b/,
];

export function findRef(flat) {
  for (const re of REF_PATTERNS) {
    const m = flat.match(re);
    if (m) return m[1].replace(/\s+/g, "");
  }
  return null;
}

// O codigo da Lucid e base32 de Crockford: sem I, L, O e U (nenhuma nos tres
// certificados ate 18/11). O OCR le o zero como O -- normaliza como a spec.
export function lucidCode(ref) {
  if (!/^[A-Z0-9]{4}(?:-[A-Z0-9]{4}){4}$/.test(ref || "")) return ref;
  return ref.replace(/O/g, "0").replace(/[IL]/g, "1");
}

export function findSource(flat) {
  if (/lucid/i.test(flat)) return "Lucid";
  if (/rise\s*works/i.test(flat)) return "Rise";
  return null;
}

export function parseProof(raw) {
  const flat = String(raw || "").replace(/\s+/g, " ").trim();
  const source = findSource(flat);
  const ref = findRef(flat);
  return { amount: findAmount(flat), date: findDate(flat), ref: source === "Lucid" ? lucidCode(ref) : ref, source, text: flat };
}

// ------------------------------------------------------------------- nota
// A nota do saque = certificado x split, como a view `accounting_moves` faz
// (round 2). O que caiu na carteira nunca passa dela: a taxa de transferencia
// so tira. Liquido acima da nota e o valor pedido digitado no lugar do que
// caiu (18/11: 1.800 contra 1.998 x 90% = 1.798,20) e a view usaria o maior.
export function noteOf(gross, split) {
  const g = Number(gross), s = Number(split);
  if (!(g > 0) || !(s > 0)) return null;
  // Em centavos x centesimos do split: o meio centavo fica exato e sobe, como
  // o round(numeric, 2) da view. Em float, 2100.45 x 90 dava 189040.4999...
  return Math.round(Math.round(g * 100) * Math.round(s * 100) / 10000) / 100;
}

// O bruto que o comprovante diz. Certificado da Lucid = bruto antes do split.
// Invoice da Rise (Top One) = o que a mesa pagou, ja depois do split -- a
// propria nota (NF 1 e 3: $1.350 = 1.500 x 90%); o bruto e valor ÷ split, e
// sem split nao ha como saber. null = nao mexer no bruto.
export function grossFromProof(r, split) {
  if (r?.amount == null) return null;
  if (r.source !== "Rise") return r.amount;
  const s = Number(split);
  return s > 0 ? Math.round(Math.round(r.amount * 100) * 100 / s) / 100 : null;
}

// A nota, quando o liquido passa dela; senao null (inclusive sem split).
export function netAboveNote(net, gross, split) {
  const nota = noteOf(gross, split);
  return nota != null && Number(net) > nota + 0.005 ? nota : null;
}

// ---------------------------------------------------------------- leitura
export async function readProof(file, onStatus = () => {}) {
  const pdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
  onStatus(pdf ? "reading the PDF…" : "loading the OCR engine…");
  const text = pdf ? await pdfText(file) : await imageText(file, onStatus);
  return { kind: pdf ? "pdf" : "image", ...parseProof(text) };
}

async function pdfText(file) {
  const pdfjs = await import(PDFJS);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [];
  for (let i = 1; i <= Math.min(doc.numPages, 3); i += 1) {
    const content = await (await doc.getPage(i)).getTextContent();
    // Itens na mesma altura ficam na mesma linha; o rotulo e o valor se encontram.
    const lines = [];
    let y = null;
    for (const item of content.items) {
      if (typeof item.str !== "string") continue;
      const iy = Math.round(item.transform[5]);
      if (y === null || Math.abs(iy - y) > 2) lines.push([]);
      lines[lines.length - 1].push(item.str);
      y = iy;
    }
    pages.push(lines.map((l) => l.join(" ")).join("\n"));
  }
  return pages.join("\n");
}

// Duas passadas: a imagem inteira le o valor grande; o rodape ampliado le o
// codigo e a data pequenos do certificado da Lucid, que a passada inteira
// perde mesmo a 2x. A segunda so roda quando a primeira nao achou data ou numero.
async function imageText(file, onStatus) {
  await script(TESSERACT);
  const bmp = await createImageBitmap(file);
  const dark = isDark(bmp);
  let text = await ocr(readable(bmp, 0, 0, bmp.width, bmp.height, Math.max(1, 3000 / bmp.width), dark), onStatus, "");
  const got = parseProof(text);
  if (got.date == null || got.ref == null) {
    const y = Math.round(bmp.height * 0.7);
    const strip = readable(bmp, 0, y, bmp.width, bmp.height - y, Math.max(1, 4500 / bmp.width), dark);
    text += `\n${await ocr(strip, onStatus, " · details")}`;
  }
  return text;
}

async function ocr(canvas, onStatus, suffix) {
  const { data } = await window.Tesseract.recognize(canvas, "eng", {
    logger: (m) => {
      if (m.status === "recognizing text") onStatus(`reading the image${suffix}… ${Math.round((m.progress || 0) * 100)}%`);
      else if (m.status) onStatus(`${m.status}…`);
    },
  });
  return data.text;
}

// Fundo escuro (certificado da Lucid)? Amostra pequena da imagem inteira.
function isDark(bmp) {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d");
  ctx.drawImage(bmp, 0, 0, 64, 64);
  const d = ctx.getImageData(0, 0, 64, 64).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
  return sum / (d.length / 4) < 112;
}

// Tesseract quer texto preto em fundo branco e letras grandes: amplia o
// recorte, passa para cinza, inverte quando o fundo e escuro e binariza.
// Sem o preto-e-branco ele devolvia lixo no texto pequeno sobre o degrade.
function readable(bmp, sx, sy, sw, sh, scale, invert) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    let v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (invert) v = 255 - v;
    v = v < 140 ? 0 : 255;
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

const loaded = new Map();
function script(url) {
  if (!loaded.has(url)) {
    loaded.set(url, new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = url;
      el.onload = resolve;
      el.onerror = () => {
        loaded.delete(url);
        reject(new Error("could not load the OCR engine"));
      };
      document.head.appendChild(el);
    }));
  }
  return loaded.get(url);
}

// ----------------------------------------------------------------- a caixa
// `host` recebe a caixa de colar; `pasteTarget` e quem escuta o Ctrl+V (o
// modal ou a aba inteira, quando so ha uma caixa ali); `confirmPaste(file)`,
// quando dado, pergunta antes de aceitar o Ctrl+V que nao caiu na caixa;
// `onRead(result, file)` recebe o que foi lido. Devolve o arquivo que entrou
// para quem for gravar e `reading`, a leitura em andamento -- quem grava
// espera por ela.
export function mountProofZone(host, { pasteTarget = null, confirmPaste = null, onRead = () => {}, compact = false } = {}) {
  const prompt = compact
    ? "paste the certificate / invoice here (Ctrl+V) or"
    : "paste the payout certificate or the Rise invoice here (Ctrl+V), drop the file, or";
  host.innerHTML = `<div class="proof-zone${compact ? " compact" : ""}" tabindex="0" role="button">
      <span class="pz-text">${prompt}</span><u class="pz-pick">choose a file</u>
      <input type="file" accept="image/*,application/pdf" hidden></div>
    <div class="pz-read" hidden></div>`;
  const zone = host.querySelector(".proof-zone");
  const text = host.querySelector(".pz-text");
  const input = host.querySelector("input[type=file]");
  const read = host.querySelector(".pz-read");
  const state = { file: null, result: null, reading: null };
  const status = (msg) => {
    read.hidden = !msg;
    read.textContent = msg || "";
  };

  const readFile = async (file) => {
    zone.classList.add("busy");
    text.textContent = file.name && file.name !== "image.png" ? file.name
      : (file.type || "").startsWith("image/") ? "pasted image" : "file";
    try {
      // O progresso de uma leitura velha (colou outro, ou reset) nao escreve
      // por cima da linha "read: …" da atual.
      const r = await readProof(file, (m) => { if (state.file === file) status(m); });
      if (state.file !== file) return;   // colou outro no meio da leitura: vale o novo
      state.result = r;
      const parts = [r.amount != null ? `$${r.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : null,
        r.date, r.ref].filter(Boolean);
      status(parts.length ? `read: ${parts.join(" · ")} — check and fix if needed`
        : "could not read a value — fill the fields by hand; the file is still attached");
      await onRead(r, file);
    } catch (err) {
      if (state.file !== file) return;
      status(`could not read it (${err.message}) — fill the fields by hand; the file is still attached`);
      await onRead({ amount: null, date: null, ref: null, text: "" }, file);
    } finally {
      if (state.file === file) zone.classList.remove("busy");
    }
  };
  const take = (file) => {
    if (!file) return;
    state.file = file;
    state.result = null;
    const p = readFile(file);
    state.reading = p;
    p.finally(() => { if (state.reading === p) state.reading = null; });
  };
  const clipboardFile = (e) => [...(e.clipboardData?.files || [])][0]
    || [...(e.clipboardData?.items || [])].filter((i) => i.kind === "file").map((i) => i.getAsFile())[0];
  const fromClipboard = (e) => {
    const file = clipboardFile(e);
    if (!file) return;
    e.preventDefault();
    take(file);
  };
  // Clicar na caixa so a foca, e o Ctrl+V vai para ela; o seletor de arquivo
  // abre pelo "choose a file" (ou Enter/Espaco). Antes o clique abria o
  // seletor e nao havia como focar a caixa para colar. No toque (celular) nao
  // ha Ctrl+V: o toque em qualquer ponto da caixa abre o seletor.
  const coarse = typeof matchMedia === "function" ? matchMedia("(hover: none), (pointer: coarse)") : null;
  zone.onclick = (e) => {
    if (e.target === input) return;
    const toque = e.pointerType === "touch" || e.pointerType === "pen" || (!e.pointerType && coarse?.matches);
    if (toque || e.target.closest(".pz-pick")) input.click();
    else zone.focus();
  };
  zone.onkeydown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      input.click();
    }
  };
  input.onchange = () => take(input.files[0]);
  zone.onpaste = fromClipboard;
  zone.ondragover = (e) => {
    e.preventDefault();
    zone.classList.add("over");
  };
  zone.ondragleave = () => zone.classList.remove("over");
  zone.ondrop = (e) => {
    e.preventDefault();
    zone.classList.remove("over");
    take(e.dataTransfer?.files?.[0]);
  };
  if (pasteTarget) {
    // Ctrl+V em qualquer lugar do modal/aba: so quando e arquivo (num campo de
    // texto o Ctrl+V continua sendo texto) e a caixa ainda nao pegou. O modal
    // e a aba sao os MESMOS elementos a cada abertura: o ouvinte de uma caixa
    // que ja saiu da tela se desliga e deixa o arquivo para a de agora. Antes
    // o primeiro ouvinte registrado, de uma caixa velha fora da tela, pegava o
    // Ctrl+V e a caixa visivel nao via nada (18/11: colou e nada aconteceu).
    const onPaste = (e) => {
      if (!zone.isConnected) {
        pasteTarget.removeEventListener("paste", onPaste);
        return;
      }
      if (e.defaultPrevented || !clipboardFile(e)) return;
      // Colar num campo de texto com texto na area de transferencia continua
      // sendo texto: o Excel e o Word poem tambem um bitmap das celulas.
      const campo = e.target?.closest?.("input, textarea, select, [contenteditable]");
      if (campo && !zone.contains(campo) && [...(e.clipboardData?.types || [])].includes("text/plain")) return;
      if (confirmPaste && !confirmPaste(clipboardFile(e))) return;
      fromClipboard(e);
    };
    pasteTarget.addEventListener("paste", onPaste);
  }
  return {
    get file() { return state.file; },
    get result() { return state.result; },
    get reading() { return state.reading; },
    reset() {
      state.file = null;
      state.result = null;
      state.reading = null;
      input.value = "";
      text.textContent = prompt;
      zone.classList.remove("busy");
      status(null);
    },
    attached(path) {
      state.file = null;
      state.result = null;
      state.reading = null;
      input.value = "";
      text.textContent = path ? `attached: ${path.split("/").pop()} — paste another to replace it` : prompt;
      zone.classList.remove("busy");
      status(null);
    },
  };
}
