// Tour guiado: uma saudacao em tela cheia e depois um holofote que leva a
// pessoa ate a foto da conta, abre o cartao e mostra onde ficam tema, senha e
// foto. Roda uma vez por conta (operation_settings.tour_seen_at) e pode ser
// repetido pelo link no cartao do perfil.
import { openProf, closeProf } from "./skin.js?v=6c3fbb5df5";

const $ = (s, r = document) => r.querySelector(s);
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms) => new Promise((r) => setTimeout(r, reduce ? 0 : ms));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Cada passo: alvo(s) na tela, titulo, texto e o que fazer antes de mostrar.
// `round` e o raio do recorte; a foto e redonda, o resto e um cartao.
const STEPS = [
  { at: ["#avatar"], round: 999,
    title: "This is your account",
    text: "Photo, theme and password all live behind this picture. Tap it any time." },
  { at: ["#sw"], before: async () => { openProf(); await wait(260); },
    title: "Pick a theme",
    text: "Eight skins. Tap one — it is saved to your account and follows you to every device." },
  { at: ["#pw", "#pwGo"],
    title: "Change your password",
    text: "Type a new one and press Change. The collector on your PC signs in with the same password, so update its .env afterwards." },
  { at: ["#picWrap"], round: 999,
    title: "Put a face on it",
    text: "Tap the photo to upload your own. It is cropped square and saved with your account." },
  { at: [], before: async () => { closeProf(); await wait(200); },
    title: "You're all set",
    text: "Take this tour again any time from the account card — the link sits next to Sign out." },
];

/** Abre o tour e resolve quando a pessoa termina ou pula. */
export function startTour({ email } = {}) {
  return new Promise((resolve) => {
    if ($(".tour-hi") || $(".tour-sp")) { resolve(); return; }
    scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    document.documentElement.classList.add("tour-lock");

    // ── saudacao ──────────────────────────────────────────────────────────
    const hi = document.createElement("div");
    hi.className = "tour-hi";
    hi.innerHTML = `
      <div class="hi-in">
        <span class="hi-eye">Trackator</span>
        <h1 aria-label="Welcome">${[..."Welcome"].map((c, i) => `<i style="--i:${i}">${c}</i>`).join("")}</h1>
        <span class="hi-line"></span>
        <span class="hi-mail">${esc(email || "")}</span>
        <p class="hi-sub">Your hedge, in one place. Let me show you where your account lives — it takes twenty seconds.</p>
        <div class="hi-act"><button type="button" class="cta" id="tourGo">Show me around</button><button type="button" class="ghost" id="tourSkip">Skip</button></div>
      </div>`;
    document.body.appendChild(hi);

    const finish = () => {
      removeEventListener("keydown", onKey);
      removeEventListener("resize", place);
      removeEventListener("scroll", place, true);
      document.documentElement.classList.remove("tour-lock");
      hi.remove();
      if (sp) { sp.classList.remove("on"); setTimeout(() => sp.remove(), reduce ? 0 : 320); }
      closeProf();
      resolve();
    };

    // ── holofote ──────────────────────────────────────────────────────────
    let sp = null, hole = null, tip = null, blk = [], step = -1, busy = false;
    let cur = { x: innerWidth / 2, y: innerHeight / 2, w: 0, h: 0 };

    const build = () => {
      sp = document.createElement("div");
      sp.className = "tour-sp";
      sp.innerHTML = `
        <div class="sp-blk"></div><div class="sp-blk"></div><div class="sp-blk"></div><div class="sp-blk"></div>
        <div class="sp-hole"></div>
        <div class="sp-tip" role="dialog" aria-live="polite">
          <span class="sp-n"></span><b></b><p></p>
          <div class="sp-act"><button type="button" class="ghost sp-skip">Skip</button><button type="button" class="cta sp-next">Next</button></div>
        </div>`;
      document.body.appendChild(sp);
      hole = $(".sp-hole", sp); tip = $(".sp-tip", sp); blk = [...sp.querySelectorAll(".sp-blk")];
      // Fora do recorte nada responde, e o clique nao chega ao documento (que fecharia o cartao).
      for (const b of blk) b.addEventListener("click", (e) => { e.stopPropagation(); });
      tip.addEventListener("click", (e) => { e.stopPropagation(); });
      $(".sp-next", sp).addEventListener("click", next);
      $(".sp-skip", sp).addEventListener("click", finish);
      setHole(cur);
      requestAnimationFrame(() => requestAnimationFrame(() => sp.classList.add("on")));
    };

    const rectOf = (sels) => {
      const rs = sels.map((s) => $(s)).filter(Boolean).map((e) => e.getBoundingClientRect()).filter((r) => r.width || r.height);
      if (!rs.length) return null;
      const l = Math.min(...rs.map((r) => r.left)), t = Math.min(...rs.map((r) => r.top));
      const r = Math.max(...rs.map((r) => r.right)), b = Math.max(...rs.map((r) => r.bottom));
      return { x: l - 8, y: t - 8, w: r - l + 16, h: b - t + 16 };
    };

    const setHole = (r, round = 16) => {
      cur = r;
      hole.style.top = r.y + "px"; hole.style.left = r.x + "px";
      hole.style.width = r.w + "px"; hole.style.height = r.h + "px";
      hole.style.borderRadius = round + "px";
      hole.classList.toggle("none", !r.w);
      const W = innerWidth, H = innerHeight;
      const box = (el, t, l, w, h) => { el.style.top = t + "px"; el.style.left = l + "px"; el.style.width = Math.max(0, w) + "px"; el.style.height = Math.max(0, h) + "px"; };
      box(blk[0], 0, 0, W, r.y);
      box(blk[1], r.y + r.h, 0, W, H - r.y - r.h);
      box(blk[2], r.y, 0, r.x, r.h);
      box(blk[3], r.y, r.x + r.w, W - r.x - r.w, r.h);
    };

    const placeTip = (r) => {
      const W = innerWidth, H = innerHeight, tw = tip.offsetWidth, th = tip.offsetHeight;
      let top, left;
      if (!r.w) { top = (H - th) / 2; left = (W - tw) / 2; }
      else {
        top = r.y + r.h + 14;
        if (top + th > H - 16) top = r.y - 14 - th;
        if (top < 16) top = Math.min(H - th - 16, r.y + r.h + 14);
        left = Math.min(Math.max(16, r.x + r.w / 2 - tw / 2), W - 16 - tw);
      }
      tip.style.top = top + "px"; tip.style.left = left + "px";
    };

    function place() {
      if (!sp || step < 0) return;
      const s = STEPS[step];
      const r = rectOf(s.at) || { x: innerWidth / 2, y: innerHeight / 2, w: 0, h: 0 };
      setHole(r, s.round || 16);
      placeTip(r);
    }

    const show = async (i) => {
      step = i;
      const s = STEPS[i];
      tip.classList.add("swap");
      if (s.before) await s.before();
      await wait(140);
      $(".sp-n", tip).textContent = `${i + 1} / ${STEPS.length}`;
      $("b", tip).textContent = s.title;
      $("p", tip).textContent = s.text;
      $(".sp-next", tip).textContent = i === STEPS.length - 1 ? "Done" : "Next";
      $(".sp-skip", tip).hidden = i === STEPS.length - 1;
      place();
      tip.classList.remove("swap");
    };

    async function next() {
      if (busy) return;
      busy = true;
      try {
        if (step >= STEPS.length - 1) finish();
        else await show(step + 1);
      } finally { busy = false; }
    }

    const begin = async () => {
      hi.classList.add("out");
      await wait(300);
      hi.remove();
      build();
      addEventListener("resize", place);
      addEventListener("scroll", place, true);
      await wait(80);
      await show(0);
    };

    function onKey(e) {
      if (e.key === "Escape") { e.stopPropagation(); finish(); }
      else if (sp && (e.key === "Enter" || e.key === "ArrowRight")) next();
      else if (!sp && e.key === "Enter") begin();
    }
    addEventListener("keydown", onKey);
    $("#tourGo", hi).addEventListener("click", begin);
    $("#tourSkip", hi).addEventListener("click", finish);
  });
}
