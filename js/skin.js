// A casca do painel: tudo o que se move fora das telas.
//
//   - abas com a pilula branca que desliza, e que viram a notificacao por
//     alguns segundos (morph estilo Dynamic Island); com o mouse em cima da
//     barra a notificacao desce numa gaveta em vez de tomar as abas;
//   - cartao do perfil (tema, foto, senha, maquina, sair);
//   - temas: a pagina inteira e token, trocar e um atributo no <html>;
//   - odometro, particulas, halo de pouso e o braco de liquido (goo) que liga
//     o quadro do feed a pilula da conta.
//
// Nada aqui le o banco. O app chama e passa os dados.

export const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** requestAnimationFrame com rede: viewers embutidos seguram o rAF, o timer nao. */
export const raf = (fn) => {
  let done = false;
  const id = requestAnimationFrame((t) => { done = true; fn(t); });
  setTimeout(() => { if (!done) { cancelAnimationFrame(id); fn(performance.now()); } }, 48);
  return id;
};

const INK = () => getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#ffffff";
const rnd = (a, b) => a + Math.random() * (b - a);
const Bq = (p, a, b, c) => (1 - p) * (1 - p) * a + 2 * (1 - p) * p * b + p * p * c;

// ───────────────────────────────────────────────────────────── particulas
export function burst(x, y, color = INK(), n = 12) {
  if (reduce) return;
  for (let i = 0; i < n; i++) {
    const p = document.createElement("span");
    p.className = "pt";
    p.style.left = x + "px"; p.style.top = y + "px";
    p.style.background = color; p.style.boxShadow = `0 0 10px ${color}`;
    document.body.appendChild(p);
    const a = rnd(0, Math.PI * 2), d = rnd(26, 90);
    p.animate([
      { transform: "translate(-50%,-50%) scale(1)", opacity: 1 },
      { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px)) scale(.15)`, opacity: 0 },
    ], { duration: rnd(550, 950), easing: "cubic-bezier(.2,.8,.2,1)" }).onfinish = () => p.remove();
  }
}

/** Halo arredondado numa linha de conta: o evento pousou ali. */
export function landOn(row, color) {
  if (!row) return;
  const i = document.createElement("i");
  i.className = "land";
  i.style.setProperty("--c", color);
  row.appendChild(i);
  setTimeout(() => i.remove(), 1000);
}

// ─────────────────────────────────────────────────────────────── odometro
/** Cada digito e uma tira que rola ate o valor novo. */
export function odo(el, text) {
  const chars = [...text];
  const same = el.dataset.txt && el.dataset.txt.length === text.length
    && [...el.dataset.txt].every((c, i) => /\d/.test(c) === /\d/.test(chars[i]));
  if (!same) {
    el.innerHTML = chars.map((c) => /\d/.test(c)
      ? '<span class="d"><i>0<br>1<br>2<br>3<br>4<br>5<br>6<br>7<br>8<br>9</i></span>'
      : `<span class="s">${esc(c)}</span>`).join("");
    void el.offsetWidth;
  }
  [...el.children].forEach((sp, i) => {
    const c = chars[i];
    if (/\d/.test(c)) sp.firstElementChild.style.transform = `translateY(calc(-${c} * 1.14em))`;
    else sp.textContent = c;
  });
  el.dataset.txt = text;
}

// ─────────────────────────────────────────────────────────────────── abas
const tabsEl = () => $("#nav");
const pillEl = () => $("#tabPill");

export function placePill() {
  const nav = tabsEl(), pill = pillEl();
  if (!nav || !pill || nav.classList.contains("ntf-on")) return;
  const b = $(".tab[aria-selected=\"true\"]", nav);
  if (!b || !b.offsetWidth) { pill.style.width = "0px"; return; }
  // A primeira vez que ela aparece e no lugar, sem deslizar desde left:0:
  // abrir a pagina nao e trocar de aba.
  const primeira = !parseFloat(pill.style.width);
  if (primeira) pill.style.transition = "none";
  // offsetLeft ja conta o padding da barra; a pilula nasce em left:0, entao
  // o deslocamento e o proprio offsetLeft (o -4 antigo a jogava 4px pra esquerda).
  pill.style.width = b.offsetWidth + "px";
  pill.style.transform = `translateX(${b.offsetLeft}px)`;
  if (primeira) { void pill.offsetWidth; pill.style.transition = ""; }
}

/**
 * Desenha as abas. `pages` = [{id, label, count}], `current` = id ativo.
 * A pilula e a notificacao moram dentro da barra e sobrevivem ao redesenho.
 */
/**
 * Carregando: uma massa de liquido em loop (mesmo filtro gooey do braco do
 * Live feed). `cls`: "" tela inteira, "sm" dentro de folha/modal, "xs" inline.
 */
export function loader(cls = "") {
  return `<div class="loader ${cls}" role="status" aria-label="loading"><div class="blobs"><i></i><i></i><i></i><i></i><i></i></div>${
    cls.includes("xs") ? "" : "<span>loading</span>"}</div>`;
}

export function renderTabs(pages, current, onPick) {
  const nav = tabsEl();
  // Pilula e notificacao nascem uma vez e so os botoes sao trocados. Reescrever
  // a barra inteira recriava a pilula em left:0 a cada troca de aba -- ela
  // deslizava desde o comeco em vez de sair da aba anterior -- e no carregamento,
  // com a barra redesenhada a cada contador que chega, ia e voltava varias vezes.
  if (!pillEl()) nav.insertAdjacentHTML("afterbegin", '<span class="tab-pill" id="tabPill"></span>');
  if (!$("#ntf", nav)) {
    nav.insertAdjacentHTML("beforeend", '<div class="ntf" id="ntf"><span class="ic"></span><span class="tx"><b></b><small></small></span><span class="amt n"></span></div>');
  }
  nav.querySelectorAll(".tab").forEach((b) => b.remove());
  pillEl().insertAdjacentHTML("afterend", pages.map((p) => `<button type="button" class="tab" role="tab" data-v="${p.id}" aria-selected="${
    p.id === current}">${esc(p.label)}${p.count ? ` <span class="c">${p.count}</span>` : ""}</button>`).join(""));
  nav.onclick = (e) => { const b = e.target.closest(".tab"); if (b) onPick(b.dataset.v); };
  const m = $("#mtabs");
  if (m) {
    m.innerHTML = pages.map((p) => `<button type="button" data-v="${p.id}" aria-selected="${p.id === current}">${esc(p.label)}${
      p.count ? ` <span class="c">${p.count}</span>` : ""}</button>`).join("");
    m.onclick = (e) => { const b = e.target.closest("button"); if (b) onPick(b.dataset.v); };
  }
  requestAnimationFrame(placePill);
  // A fonte chega depois do primeiro desenho e muda a largura das abas.
  if (document.fonts?.ready) document.fonts.ready.then(placePill);
}

/** Contador numa aba (0 tira). */
export function tabCount(id, n) {
  const tab = $(`#nav .tab[data-v="${id}"]`);
  if (!tab) return;
  let c = $(".c", tab);
  if (n) {
    if (!c) { c = document.createElement("span"); c.className = "c"; tab.appendChild(c); }
    c.textContent = n;
  } else if (c) c.remove();
  placePill();
}

// ───────────────────────────────────────────────────────────── notificacao
let ntfT = 0, ntfW0 = 0, ntf2T = 0, lastEv = null, tabsHover = false;
const ntf2 = () => $("#ntf2");

function drawer(ev, color) {
  const nav = tabsEl(), d = ntf2();
  if (!nav || !d) return;
  // No celular a barra de abas nao existe: a gaveta vira uma pilula fixa no
  // alto da tela, em vez de pendurar numa barra de largura zero.
  const mob = getComputedStyle(nav).display === "none";
  d.classList.toggle("mob", mob);
  if (mob) {
    d.style.left = d.style.top = d.style.maxWidth = "";
  } else {
    const r = nav.getBoundingClientRect(), h = $(".top").getBoundingClientRect();
    d.style.left = (r.left - h.left + r.width / 2) + "px";
    d.style.top = (r.bottom - h.top - 10) + "px";
    d.style.maxWidth = (r.width - 52) + "px";
    nav.classList.add("dr");
  }
  const dot = $(".dot", d);
  dot.style.background = color; dot.style.boxShadow = `0 0 8px ${color}`;
  $("b", d).textContent = ev.title;
  $("small", d).textContent = ev.sub || "";
  const a = $(".amt", d);
  a.textContent = ev.amt != null ? (ev.amt > 0 ? "+" : "−") + "$" + Math.abs(Math.round(ev.amt)) : "";
  a.style.color = color;
  d.classList.add("on");
  clearTimeout(ntf2T);
  ntf2T = setTimeout(() => { d.classList.remove("on"); setTimeout(() => nav.classList.remove("dr"), 260); }, 3400);
}

function closeNtf() {
  const nav = tabsEl(), pill = pillEl();
  nav.classList.remove("ntf-on");
  nav.style.width = ntfW0 + "px"; nav.style.transform = "translateX(0)";
  pill.style.background = ""; pill.style.boxShadow = "";
  placePill();
  setTimeout(() => {
    if (!nav.classList.contains("ntf-on")) { nav.style.width = ""; nav.style.transform = ""; placePill(); }
  }, 760);
}

/**
 * A barra de abas vira a notificacao por 3,4 s e volta. Com o mouse em cima
 * da barra (ou sem barra, no celular) a mesma informacao desce numa gaveta.
 * `ev` = {kind, acc, title, sub, amt, ic}.
 */
export function notify(ev) {
  const nav = tabsEl(), pill = pillEl(), ntf = $("#ntf");
  if (!nav || !pill || !ntf) return;
  const color = ev.kind === "blown" || (ev.amt != null && ev.amt < 0) ? "#FF5A6A"
    : ev.kind === "passed" || ev.kind === "risk" ? "#FBBF24" : "#4ADE80";
  lastEv = { ev, color };
  if (getComputedStyle(nav).display === "none" || reduce || tabsHover || nav.matches(":hover")) {
    drawer(ev, color);
    return;
  }
  const open = nav.classList.contains("ntf-on");
  const fill = () => {
    $(".ic", ntf).textContent = ev.ic || "•";
    $("b", ntf).textContent = ev.title;
    $("small", ntf).textContent = ev.sub || "";
    const amt = $(".amt", ntf);
    amt.textContent = ev.amt != null ? (ev.amt > 0 ? "+" : "−") + "$" + Math.abs(Math.round(ev.amt)) : "";
    amt.style.color = color;
    ntf.classList.add("measure");
    const w1 = ntf.offsetWidth + 8;
    ntf.classList.remove("measure");
    nav.style.width = w1 + "px";
    nav.style.transform = `translateX(${-(w1 - ntfW0) / 2}px)`;
    pill.style.transform = "translateX(4px)"; pill.style.width = "36px";
    pill.style.background = color; pill.style.boxShadow = `0 0 22px ${color}99`;
  };
  clearTimeout(ntfT);
  ntfT = setTimeout(closeNtf, 3400);
  if (open) {
    nav.classList.remove("ntf-on");
    setTimeout(() => { fill(); nav.classList.add("ntf-on"); }, 190);
    return;
  }
  ntfW0 = nav.getBoundingClientRect().width;
  nav.style.width = ntfW0 + "px"; nav.style.transform = "translateX(0)";
  requestAnimationFrame(() => requestAnimationFrame(() => { nav.classList.add("ntf-on"); fill(); }));
}

export function initTabsHover() {
  const nav = tabsEl();
  nav.addEventListener("pointerenter", () => {
    tabsHover = true;
    if (nav.classList.contains("ntf-on") && lastEv) { clearTimeout(ntfT); closeNtf(); drawer(lastEv.ev, lastEv.color); }
  });
  nav.addEventListener("pointerleave", () => { tabsHover = false; });
}

// ────────────────────────────────────────────────────────────────── ilha
let sayT = 0, islandBase = "";
export function setIsland(text) {
  islandBase = text;
  const el = $("#islandTxt");
  if (el && !sayT) el.textContent = text;
}
/** A ilha digita o que aconteceu e volta ao texto de base. */
export function islandSay(text) {
  const el = $("#islandTxt");
  if (!el) return;
  clearTimeout(sayT);
  let i = 0;
  el.textContent = "";
  const type = () => {
    el.textContent = text.slice(0, ++i);
    if (i < text.length) sayT = setTimeout(type, 22);
    else sayT = setTimeout(() => { el.textContent = islandBase; sayT = 0; }, 3400);
  };
  type();
  const is = $("#status");
  if (is) { is.classList.remove("bump"); void is.offsetWidth; is.classList.add("bump"); setTimeout(() => is.classList.remove("bump"), 700); }
}

// ───────────────────────────────────────────────────────────────── temas
export const SKINS = ["wine", "moss", "midnight", "graphite", "royal", "lagoon", "noir", "paper"];
const SKIN_KEY = "tracking:skin";
let onThemeSave = null;

export function setSkin(k, save) {
  if (!SKINS.includes(k)) k = "wine";
  if (k === "wine") document.documentElement.removeAttribute("data-skin");
  else document.documentElement.setAttribute("data-skin", k);
  $$("#sw button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.skin === k)));
  const nm = $("#thmName");
  if (nm) nm.textContent = k[0].toUpperCase() + k.slice(1);
  if (save) {
    try { localStorage.setItem(SKIN_KEY, k); } catch { /* janela anonima */ }
    if (onThemeSave) onThemeSave(k);
  }
}
export function currentSkin() {
  return document.documentElement.getAttribute("data-skin") || "wine";
}

// ───────────────────────────────────────────────────────────────── perfil
const PHOTO_KEY = "tracking:avatar";
let onPhotoSave = null;

export function setPhoto(url, animate) {
  $$("#avatar,#picWrap").forEach((a) => {
    a.style.backgroundImage = url ? `url(${url})` : "";
    a.classList.toggle("has", Boolean(url));
    if (url && animate && !reduce) { a.classList.remove("reveal"); void a.offsetWidth; a.classList.add("reveal"); }
  });
  const row = $("#picRow");
  if (row) row.hidden = !url;
}

export function openProf() {
  const prof = $("#prof"), av = $("#avatar");
  const r = av.getBoundingClientRect();
  prof.style.top = (r.bottom + 10) + "px";
  prof.style.right = Math.max(16, innerWidth - r.right) + "px";
  prof.hidden = false;
  prof.classList.remove("closing");
  av.setAttribute("aria-expanded", "true");
}
export function closeProf() {
  const prof = $("#prof"), av = $("#avatar");
  if (!prof || prof.hidden || prof.classList.contains("closing")) return;
  prof.classList.add("closing");
  av.setAttribute("aria-expanded", "false");
  setTimeout(() => { prof.hidden = true; prof.classList.remove("closing"); }, reduce ? 0 : 170);
}

/**
 * Monta o cartao do perfil e liga o avatar.
 *
 *   email, role         o que mostrar no topo
 *   machines, machine   seletor de maquina (so com duas ou mais), onMachine(id)
 *   theme, photo        preferencia salva no banco (vence o localStorage)
 *   onTheme(k)          persiste o tema
 *   onPhoto(dataUrl)    persiste a foto (null = removeu)
 *   onPassword(pw)      troca a senha; onSignOut()
 */
export function initProfile(opts) {
  const prof = $("#prof"), av = $("#avatar");
  onThemeSave = opts.onTheme || null;
  onPhotoSave = opts.onPhoto || null;
  $("#profEmail").textContent = opts.email || "";
  $("#profRole").textContent = opts.role || "";
  av.textContent = (opts.email || "?")[0].toUpperCase();
  $("#picWrap").firstChild.textContent = av.textContent;

  const mp = $("#machineRow");
  if (opts.machines && opts.machines.length > 1) {
    mp.hidden = false;
    $("#machinePick").innerHTML = `<option value="">All machines</option>` + opts.machines.map((m) =>
      `<option value="${esc(m)}" ${m === opts.machine ? "selected" : ""}>${esc(m)}</option>`).join("");
    $("#machinePick").onchange = (e) => opts.onMachine && opts.onMachine(e.target.value);
  } else mp.hidden = true;

  // tema: banco > navegador > vinho
  let k = opts.theme;
  if (!k) { try { k = localStorage.getItem(SKIN_KEY); } catch { k = null; } }
  setSkin(k || "wine", false);
  if (!prof.dataset.wired) {
    prof.dataset.wired = "1";
    av.addEventListener("click", () => (prof.hidden ? openProf() : closeProf()));
    document.addEventListener("click", (e) => { if (!prof.hidden && !prof.contains(e.target) && !av.contains(e.target)) closeProf(); });
    addEventListener("keydown", (e) => { if (e.key === "Escape") closeProf(); });
    addEventListener("resize", () => { if (!prof.hidden) openProf(); });
    $("#sw").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      setSkin(b.dataset.skin, true);
      const r = b.getBoundingClientRect();
      burst(r.left + r.width / 2, r.top + r.height / 2, getComputedStyle(b).getPropertyValue("--d2").trim() || INK(), 12);
    });
    const pic = $("#pic");
    pic.addEventListener("change", () => {
      const f = pic.files && pic.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        const img = new Image();
        img.onload = () => {
          const S = 192, c = document.createElement("canvas");
          c.width = c.height = S;
          const x = c.getContext("2d"), m = Math.min(img.width, img.height);
          x.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, S, S);
          const u = c.toDataURL("image/jpeg", .86);
          setPhoto(u, true);
          try { localStorage.setItem(PHOTO_KEY, u); } catch { /* ok */ }
          if (onPhotoSave) onPhotoSave(u);
          const r = av.getBoundingClientRect();
          burst(r.left + r.width / 2, r.top + r.height / 2, INK(), 10);
        };
        img.src = rd.result;
      };
      rd.readAsDataURL(f);
      pic.value = "";
    });
    $("#picRm").addEventListener("click", () => {
      setPhoto("", false);
      try { localStorage.removeItem(PHOTO_KEY); } catch { /* ok */ }
      if (onPhotoSave) onPhotoSave(null);
    });
    $("#pw").addEventListener("input", (e) => { $("#pwGo").disabled = e.target.value.length < 8; });
    $("#pwGo").addEventListener("click", async () => {
      const v = $("#pw").value;
      if (v.length < 8 || !opts.onPassword) return;
      $("#pwGo").disabled = true;
      try {
        await opts.onPassword(v);
        $("#pw").value = "";
        $("#pwHint").innerHTML = '<span class="okmsg">✓ changed · the collector picks it up on the next cycle</span>';
      } catch (err) {
        $("#pwHint").innerHTML = `<span class="okmsg" style="color:var(--coral)">${esc(err.message)}</span>`;
        $("#pwGo").disabled = false;
      }
    });
    $("#signOut").addEventListener("click", () => opts.onSignOut && opts.onSignOut());
  }
  let photo = opts.photo;
  if (!photo) { try { photo = localStorage.getItem(PHOTO_KEY); } catch { photo = null; } }
  setPhoto(photo || "", false);
}

// ─────────────────────────────────────────────────────── braco de liquido
const NS = "http://www.w3.org/2000/svg";
let gsvg = null;
function goo() {
  if (gsvg) return gsvg;
  gsvg = document.createElementNS(NS, "svg");
  gsvg.setAttribute("class", "goo");
  gsvg.innerHTML = '<defs><filter id="goo" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur in="SourceGraphic" stdDeviation="9" result="b"/><feColorMatrix in="b" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8" result="g"/><feComposite in="SourceGraphic" in2="g" operator="atop"/></filter><mask id="gmask" maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%"><rect width="100%" height="100%" fill="#fff"/><rect id="gcut" fill="#000" rx="19"/></mask></defs>';
  document.body.appendChild(gsvg);
  return gsvg;
}

/**
 * O quadro do feed estica um braco de liquido preto ate a pilula da conta,
 * despeja a informacao nela e e sugado de volta. `box` e o quadro, `ex` o
 * ponto de saida {x, y} dentro dele, `pill` o alvo.
 */
export function blob({ box, ex, pill, ev, color, done }) {
  if (!box || !pill || reduce) { done && done(); return; }
  const svg = goo(), cut = $("#gcut");
  const R = [17, 13, 11, 9, 7.5, 6.5, 5.5, 4.5];
  const g = document.createElementNS(NS, "g");
  g.setAttribute("mask", "url(#gmask)");
  g.style.filter = `url(#goo) drop-shadow(0 0 10px ${color}99)`;
  g.innerHTML = '<rect rx="20" fill="#000"/><rect fill="#000"/>' + R.map((r) => `<circle r="${r}" fill="#000"/>`).join("");
  svg.appendChild(g);
  const [boxR, pillR] = g.children, drops = [...g.querySelectorAll("circle")];
  const mk = (cls) => { const t = document.createElementNS(NS, "text"); t.setAttribute("text-anchor", "middle"); t.setAttribute("dominant-baseline", "central"); t.setAttribute("class", cls); svg.appendChild(t); return t; };
  const grains = document.createElementNS(NS, "g");
  grains.innerHTML = Array.from({ length: 14 }, () => `<circle r="${1.2 + Math.random() * 1.3}" fill="${color}" opacity="${.5 + Math.random() * .5}"/>`).join("");
  svg.appendChild(grains);
  const lab = mk("glab"); lab.setAttribute("fill", color);
  lab.textContent = ev.amt != null ? (ev.amt > 0 ? "+" : "−") + "$" + Math.abs(Math.round(ev.amt)) : (ev.tag || ev.kind);
  const keep = mk("gkeep");
  const ps = getComputedStyle(pill);
  keep.setAttribute("fill", ps.color); keep.style.font = ps.font; keep.textContent = pill.textContent.trim();
  const gr = [...grains.children].map((c) => ({ c, off: Math.random() * .4, side: (Math.random() - .5) * 10 }));
  let x0, y0, x1, y1, cx, cy;
  const measure = () => {
    const fr = box.getBoundingClientRect(), pr = pill.getBoundingClientRect();
    cut.setAttribute("x", fr.left + 1); cut.setAttribute("y", fr.top + 1);
    cut.setAttribute("width", Math.max(0, fr.width - 2)); cut.setAttribute("height", Math.max(0, fr.height - 2));
    boxR.setAttribute("x", fr.left); boxR.setAttribute("y", fr.top); boxR.setAttribute("width", fr.width); boxR.setAttribute("height", fr.height);
    pillR.setAttribute("x", pr.left); pillR.setAttribute("y", pr.top); pillR.setAttribute("width", pr.width); pillR.setAttribute("height", pr.height); pillR.setAttribute("rx", pr.height / 2);
    x0 = fr.left + ex.x; y0 = fr.top + ex.y;
    x1 = pr.left + pr.width / 2; y1 = pr.top + pr.height / 2;
    cx = (x0 + x1) / 2; cy = Math.min(y0, y1) - 44;
    keep.setAttribute("x", x1); keep.setAttribute("y", y1);
  };
  const t0 = performance.now(), D1 = 1050, D2 = 560;
  const E = (p) => (p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
  const place = (c, p) => { c.setAttribute("cx", Bq(p, x0, cx, x1)); c.setAttribute("cy", Bq(p, y0, cy, y1)); };
  let hit = false;
  const step = (now) => {
    if (!box.isConnected || !pill.isConnected) { g.remove(); lab.remove(); keep.remove(); grains.remove(); done && done(); return; }
    measure();
    const el = now - t0;
    if (el < D1) {
      const p = E(Math.min(1, el / D1)), wob = 1 + Math.sin(el / 70) * .08;
      drops.forEach((c, k) => { place(c, Math.max(0, p - k * .075)); if (!k) c.setAttribute("r", R[0] * wob); });
      gr.forEach((o) => {
        const gp = Math.max(0, p - o.off * p);
        o.c.setAttribute("cx", Bq(gp, x0, cx, x1) + o.side * Math.sin(el / 90 + o.off * 9));
        o.c.setAttribute("cy", Bq(gp, y0, cy, y1) + o.side * Math.cos(el / 110 + o.off * 7));
      });
      const lp = Math.max(0, p - .03);
      lab.setAttribute("x", Bq(lp, x0, cx, x1)); lab.setAttribute("y", Bq(lp, y0, cy, y1) - 24);
      raf(step);
      return;
    }
    if (!hit) {
      hit = true;
      lab.setAttribute("opacity", 0);
      done && done();
      pill.style.transformOrigin = x0 < x1 ? "left center" : "right center";
      pill.style.transition = "transform .14s ease-out";
      pill.style.transform = "scale(1.3,.78)";
      setTimeout(() => { pill.style.transition = "transform .6s var(--spring)"; pill.style.transform = ""; }, 150);
    }
    const q = Math.min(1, (el - D1) / D2);
    drops.forEach((c, k) => { const base = Math.max(0, 1 - k * .075); place(c, base + (1 - base) * q); c.setAttribute("r", R[k] * (1 - q)); });
    gr.forEach((o) => { const f = Math.max(0, 1 - q * 2.2); o.c.setAttribute("cx", x1 + o.side * f); o.c.setAttribute("cy", y1 + o.side * f); o.c.setAttribute("opacity", f); o.c.setAttribute("r", 1.4 * f); });
    if (q < 1) raf(step);
    else { g.remove(); lab.remove(); keep.remove(); grains.remove(); }
  };
  raf(step);
}

/** Chip "+$214" que nasce sob o numero herói, flutua e some. */
export function deltaChip(host, amt) {
  if (!host || reduce) return;
  const chip = document.createElement("span");
  chip.className = "dchip" + (amt < 0 ? " loss" : "");
  chip.textContent = (amt > 0 ? "+" : "−") + "$" + Math.abs(Math.round(amt));
  host.appendChild(chip);
  setTimeout(() => chip.remove(), 1600);
}
