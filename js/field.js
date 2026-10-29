// O quadro vivo do feed: curvas de nivel de um relevo que nunca para de
// derivar. Cada conta prop e um morro; a conta live e um vale para onde tudo
// converge. Um evento sobe o morro da conta (afunda, quando estoura) e as
// curvas florescem para fora. Canvas 2D puro, ~60 fps; quando o viewer segura
// o requestAnimationFrame, um timer mantem o quadro respirando.

const FC = {
  phase1: "#4ADE80", phase2: "#4ADE80", funded: "#4ADE80",
  passed: "#FBBF24", failed: "#FF5A6A",
};
const GX = 60, GY = 44, LV = 11;
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

let el = null, cv = null, fx = null, FW = 0, FH = 0;
let nodes = [];
const hub = { x: 0, y: 0, ring: 0, rings: [], flash: 0, label: "live" };
let field = new Float32Array(0);
let running = false;

const raf = (fn) => {
  let done = false;
  const id = requestAnimationFrame((t) => { done = true; fn(t); });
  setTimeout(() => { if (!done) { cancelAnimationFrame(id); fn(performance.now()); } }, 48);
  return id;
};

const nz = (x, y, t) =>
  Math.sin(x * .9 + t * .0005) * Math.cos(y * .8 - t * .0004)
  + Math.sin(x * .5 + y * .7 + t * .0003) * .7
  + Math.cos(x * .3 - y * .4 - t * .0002) * .5;

function label(x, y, html, cls = "") {
  const l = document.createElement("span");
  l.className = "lbl " + cls;
  l.style.left = x + "px";
  l.style.top = y + "px";
  l.innerHTML = html;
  el.appendChild(l);
}

function layout() {
  if (!el || !FW) return;
  el.querySelectorAll(".lbl").forEach((l) => l.remove());
  hub.x = FW - 70;
  hub.y = FH / 2;
  const n = nodes.length || 1;
  nodes.forEach((nd, i) => {
    nd.x = 54 + (i % 2) * 30;
    nd.y = 26 + (i + .5) * ((FH - 52) / n);
    label(nd.x, nd.y + 10, `<b>${nd.label}</b>`);
  });
  label(hub.x, hub.y + 28, `<b>${hub.label}</b>`, "hubl");
}

/** Mede a caixa e redimensiona o canvas. Chamar de novo quando a tela mudar. */
export function fieldSize() {
  if (!el || !el.isConnected) return;
  const r = el.getBoundingClientRect();
  if (!r.width) return;
  const dpr = Math.min(2, devicePixelRatio || 1);
  FW = r.width;
  FH = r.height;
  cv.width = FW * dpr;
  cv.height = FH * dpr;
  fx.setTransform(dpr, 0, 0, dpr, 0, 0);
  layout();
}

function hubDraw() {
  hub.ring = (hub.ring + .011) % 1;
  fx.globalAlpha = (1 - hub.ring) * .5;
  fx.strokeStyle = "#fff";
  fx.lineWidth = 1;
  fx.beginPath();
  fx.arc(hub.x, hub.y, 10 + hub.ring * 30, 0, Math.PI * 2);
  fx.stroke();
  for (const rg of hub.rings) {
    rg.r += 2; rg.a *= .94;
    fx.globalAlpha = rg.a; fx.strokeStyle = rg.color; fx.lineWidth = 1.5;
    fx.beginPath(); fx.arc(hub.x, hub.y, rg.r, 0, Math.PI * 2); fx.stroke();
  }
  hub.rings = hub.rings.filter((rg) => rg.a > .03);
  fx.lineWidth = 1;
  hub.flash *= .9;
  fx.globalAlpha = 1; fx.fillStyle = "#fff"; fx.shadowColor = "#fff";
  fx.shadowBlur = 20 + hub.flash * 34;
  fx.beginPath(); fx.arc(hub.x, hub.y, 6 + hub.flash * 3, 0, Math.PI * 2); fx.fill();
  fx.shadowBlur = 0;
}

function draw(t) {
  const cw = FW / GX, ch = FH / GY, W1 = GX + 1;
  if (field.length !== W1 * (GY + 1)) field = new Float32Array(W1 * (GY + 1));
  for (let j = 0; j <= GY; j++) {
    for (let i = 0; i <= GX; i++) {
      const x = i * cw, y = j * ch;
      let v = nz(i * .22, j * .22, t) * .55;
      for (const nd of nodes) {
        const dx = x - nd.x, dy = y - nd.y;
        v += Math.exp(-(dx * dx + dy * dy) / 1400) * (1.2 + nd.peak * 2.5);
      }
      const dx = x - hub.x, dy = y - hub.y;
      v -= Math.exp(-(dx * dx + dy * dy) / 3000) * 2.2;
      field[j * W1 + i] = v;
    }
  }
  fx.clearRect(0, 0, FW, FH);
  fx.globalCompositeOperation = "lighter";
  fx.lineWidth = 1;
  const lerp = (p, q, iso) => (iso - p) / (q - p || 1e-6);
  for (let l = 0; l < LV; l++) {
    const iso = -2.2 + l * .45;
    fx.globalAlpha = .1 + (l / LV) * .35;
    fx.strokeStyle = iso > 1.2 ? "#4ADE80" : iso < -1.2 ? "#67E8F9" : "#FFE9C4";
    fx.beginPath();
    for (let j = 0; j < GY; j++) {
      for (let i = 0; i < GX; i++) {
        const a = field[j * W1 + i], b = field[j * W1 + i + 1];
        const c = field[(j + 1) * W1 + i + 1], d = field[(j + 1) * W1 + i];
        const idx = (a > iso ? 1 : 0) | (b > iso ? 2 : 0) | (c > iso ? 4 : 0) | (d > iso ? 8 : 0);
        if (!idx || idx === 15) continue;
        const x0 = i * cw, y0 = j * ch;
        const T = [x0 + cw * lerp(a, b, iso), y0];
        const R = [x0 + cw, y0 + ch * lerp(b, c, iso)];
        const B = [x0 + cw * lerp(d, c, iso), y0 + ch];
        const L = [x0, y0 + ch * lerp(a, d, iso)];
        const segs = {
          1: [L, T], 2: [T, R], 3: [L, R], 4: [R, B], 5: [L, T, R, B], 6: [T, B], 7: [L, B],
          8: [B, L], 9: [T, B], 10: [T, R, B, L], 11: [R, B], 12: [L, R], 13: [T, R], 14: [L, T],
        }[idx];
        for (let k = 0; k < segs.length; k += 2) {
          fx.moveTo(segs[k][0], segs[k][1]);
          fx.lineTo(segs[k + 1][0], segs[k + 1][1]);
        }
      }
    }
    fx.stroke();
  }
  for (const nd of nodes) {
    nd.peak *= .96;
    fx.globalAlpha = 1; fx.fillStyle = nd.color; fx.shadowColor = nd.color;
    fx.shadowBlur = 8 + Math.abs(nd.peak) * 20;
    fx.beginPath(); fx.arc(nd.x, nd.y, 2.5 + Math.abs(nd.peak) * 2, 0, Math.PI * 2); fx.fill();
    fx.shadowBlur = 0;
  }
  hubDraw();
  fx.globalCompositeOperation = "source-over";
  fx.globalAlpha = 1;
}

function loop(t) {
  if (el && el.isConnected && FW && !reduce) {
    try { draw(t); } catch { /* um quadro perdido nao pode matar o loop */ }
  }
  raf(loop);
}

/**
 * Pendura o quadro em `container` com as contas dadas. Chamado toda vez que a
 * Overview e desenhada: o container anterior morreu com o innerHTML, e o loop
 * so desenha enquanto o atual esta na pagina.
 */
export function mountField(container, { nodes: list = [], hubLabel = "live" } = {}) {
  el = container;
  el.innerHTML = '<canvas aria-hidden="true"></canvas>';
  cv = el.firstElementChild;
  fx = cv.getContext("2d");
  hub.label = hubLabel;
  hub.rings = [];
  setNodes(list);
  fieldSize();
  if (reduce && FW) draw(performance.now());
  if (!running) {
    running = true;
    raf(loop);
    addEventListener("resize", fieldSize);
  }
}

/** Contas prop em jogo: `{id, status, label}`. Mantem o estado das que ja existiam. */
export function setNodes(list) {
  nodes = list.slice(0, 8).map((n, i) =>
    Object.assign(nodes.find((o) => o.id === n.id) || { id: n.id, peak: 0 }, {
      i, n: list.length, status: n.status,
      color: FC[n.status] || "#4ADE80", label: n.label || n.id,
    }));
  layout();
}

/** Um evento chegou: o morro da conta reage. */
export function fieldEvent(ev, color) {
  const nd = nodes.find((n) => n.id === ev.acc) || null;
  if (nd) {
    nd.peak = ev.kind === "blown" ? -1 : 1;
    if (ev.kind === "blown") nd.color = "#FF5A6A";
    else if (ev.kind === "passed") nd.color = "#FBBF24";
  }
  if (ev.kind === "paired" || ev.kind === "banked" || ev.kind === "mt5") {
    hub.flash = 1;
    hub.rings.push({ r: 8, a: ev.kind === "mt5" ? .7 : 1, color });
  }
}

/** Onde o braco de liquido sai do quadro: na altura da conta, pela borda esquerda. */
export function fieldExit(acc) {
  const nd = nodes.find((n) => n.id === acc);
  return { x: 3, y: nd && nd.y != null ? nd.y : FH / 2 };
}

export function fieldBox() {
  return el && el.isConnected ? el : null;
}
