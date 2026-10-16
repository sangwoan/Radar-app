// 공용 유틸. 빌드 도구 없이 동작하도록 ES 모듈 대신 전역 네임스페이스(window.TR)를 쓴다.
window.TR = window.TR || { modules: {} };

TR.util = (() => {
  // 외부 데이터(종목명·메모 등)를 innerHTML에 넣기 전에 반드시 거친다.
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const num = (v, d = 2) =>
    v == null || Number.isNaN(v) ? "—" : Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  // 가격: 1000↑ 정수 · 1↑ 소수 2자리 · 그 아래는 유효숫자 4자리(지수 표기 없이: 0.00001234)
  function price(p) {
    if (p == null || Number.isNaN(p)) return "—";
    if (p >= 1000) return num(p, 0);
    if (p >= 1) return num(p, 2);
    if (p <= 0) return String(p);
    const d = Math.max(2, -Math.floor(Math.log10(p)) + 3);
    return p.toFixed(Math.min(d, 12));
  }
  const decimalsOf = (p) => (p >= 1000 ? 0 : p >= 1 ? 2 : Math.min(12, Math.max(2, -Math.floor(Math.log10(p)) + 3)));
  // 반올림하면 0이 되는 값은 부호 없이 0으로(−0.0% 방지)
  const zero = (v, d) => Math.abs(v) < 0.5 * 10 ** -d;
  const sgn = (v, d = 1) => (v == null ? "—" : zero(v, d) ? `${num(0, d)}%` : `${v > 0 ? "+" : ""}${num(v, d)}%`);
  const atr = (v) => (v == null ? "—" : zero(v, 1) ? "0.0ATR" : `${v > 0 ? "" : "−"}${num(Math.abs(v), 1)}ATR`);
  const hm = (iso) => (iso ? iso.slice(11, 16) : "—");
  function ago(iso) {
    if (!iso) return "—";
    const min = (Date.now() - Date.parse(iso)) / 60000;
    if (min < 1) return "방금";
    if (min < 60) return `${Math.floor(min)}분 전`;
    if (min < 1440) return `${Math.floor(min / 60)}시간 전`;
    return iso.slice(5, 10).replace("-", "/");
  }
  const STAGE = { 0: "", 1: "접근", 2: "근접", 3: "터치" };
  const GROUP = { crypto: "코인", index: "지수", macro: "원자재·환율·금리", us: "미국 대형주", kr: "한국 대형주" };
  const lineWord = (x) => (x.kind === "user" ? "내 빗각" : x.orig === "sup" ? "지지 빗각" : "저항 빗각");
  // 선의 현재 역할을 사람이 읽는 말로: '지지 빗각' / '저항→지지 전환(리테스트 대기)'
  function roleText(x) {
    if (x.status === "broken") return `${x.orig === "sup" ? "지지→저항" : "저항→지지"} 전환`;
    if (x.status === "expired") return `${x.orig === "sup" ? "이탈" : "돌파"} 후 만료`;
    return lineWord(x);
  }
  function stageLabel(x) {
    if (!x.stage) return "";
    let s = STAGE[x.stage];
    if (x.penetrating && x.stage === 3) s = x.side === "sup" ? "이탈 시도" : "돌파 시도";
    return x.status === "broken" ? `리테스트 ${s}` : s;
  }
  // 날짜 → 봉 인덱스(이진 탐색, 없는 날짜면 그 다음 봉) — 서버의 bisect_left와 같다
  function idxOfDate(dates, d) {
    let lo = 0, hi = dates.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (dates[mid] < d) lo = mid + 1; else hi = mid; }
    return lo;
  }
  const barsOf = (raw) => raw.d.map((d, i) => ({ d, o: raw.o[i], h: raw.h[i], l: raw.l[i], c: raw.c[i], v: raw.v ? raw.v[i] : 0 }));
  function toast(msg, ms = 3200) {
    let t = document.querySelector(".toast");
    if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("show");
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), ms);
  }
  // 확인 창 — 브라우저 confirm()은 안드로이드 앱 웹뷰에서 뜨지 않고 늘 '취소'가 된다(그래서 '모두 지우기'가 안 됐다). 결과는 Promise<boolean>
  function ask(msg, ok = "확인", danger = true) {
    return new Promise((done) => {
      const w = document.createElement("div");
      w.className = "ask"; w.setAttribute("role", "dialog"); w.setAttribute("aria-modal", "true");
      w.innerHTML = `<div class="ask-box"><p>${esc(msg)}</p><div class="row"><button type="button" class="btn" data-no>취소</button><button type="button" class="btn ${danger ? "danger" : "primary"}" data-yes>${esc(ok)}</button></div></div>`;
      const end = (v) => { w.remove(); done(v); };
      w.addEventListener("click", (e) => { if (e.target === w) end(false); });
      w.querySelector("[data-no]").addEventListener("click", () => end(false));
      w.querySelector("[data-yes]").addEventListener("click", () => end(true));
      document.body.appendChild(w);
      w.querySelector("[data-yes]").focus();
    });
  }
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const isMobile = () => matchMedia("(max-width: 767px)").matches;
  // 화면에 들어올 때 한 번만 그리기(수백 개 카드의 SVG를 처음부터 다 그리지 않게)
  function lazy(els, draw) {
    if (!("IntersectionObserver" in window)) { els.forEach(draw); return; }
    const io = new IntersectionObserver((ents) => ents.forEach((e) => { if (e.isIntersecting) { io.unobserve(e.target); draw(e.target); } }), { rootMargin: "300px 0px" });
    els.forEach((el) => io.observe(el));
  }
  return { esc, num, price, decimalsOf, sgn, atr, hm, ago, STAGE, GROUP, lineWord, roleText, stageLabel, idxOfDate, barsOf, toast, ask, load, save, isMobile, lazy };
})();

// 화면 단계 유지: 근접 · 터치까지 들어온 선은 접근 구간을 완전히 벗어날 때(단계 0)까지 그 단계로 보여 준다.
// 15분 스캔마다 가격이 선 근처에서 조금 움직여 색 · 배지가 바뀌었다 돌아오는 깜빡임을 막기 위해서다(화면 표시만, 알림 판단과는 별개).
// 선의 역할이 바뀌면(이탈 · 돌파) 새로 센다. 너무 오래된 표시는 5일이 지나면 지금 단계로 돌아간다. 기록은 이 기기의 localStorage.
// 각 선에 dstage(보여 줄 단계) · dpen(이탈·돌파 시도) · held(지금보다 높은 단계를 유지 중)를 붙인다.
TR.sticky = (() => {
  const KEY = "tr-held", MAX_MS = 5 * 864e5;
  function apply(scan) {
    if (!scan?.items) return;
    const mem = TR.util.load(KEY, {}), next = {}, now = Date.parse(scan.generated_at) || Date.now();
    for (const it of scan.items) for (const x of it.lines || []) {
      x.dstage = x.stage || 0; x.dpen = !!x.penetrating; x.held = false;
      if (!x.stage || x.status === "expired") continue;                     // 접근 구간 밖 → 유지 해제
      const k = `${it.sym}|${x.id}`, r = mem[k];
      const keep = r && r.status === x.status && now - r.since < MAX_MS;
      if (keep && r.stage > x.stage) {
        x.dstage = r.stage; x.dpen = r.pen; x.held = true;
        next[k] = r;
      } else {
        next[k] = { stage: x.stage, pen: !!x.penetrating, status: x.status, since: keep && r.stage === x.stage ? r.since : now };
      }
    }
    TR.util.save(KEY, next);
  }
  // 보여 줄 모양(단계 · 이탈 시도만 바꾼 복사본)
  const view = (x) => (x && x.held ? { ...x, stage: x.dstage, penetrating: x.dpen } : x);
  return { apply, view };
})();
