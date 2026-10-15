// 레이더(홈): 전 종목을 빗각까지의 거리(ATR)로 정렬. 카드(미니 차트) · 목록 두 가지 보기, 검색·필터, ★ 관심 종목.
TR.modules.grid = (el, D) => {
  const { esc, price, sgn, atr, STAGE, GROUP, roleText, stageLabel, ago, load, save, isMobile, lazy, toast } = TR.util;
  const scan = D.scan;
  if (!scan?.items?.length) { el.innerHTML = `<p class="empty fatal">아직 스캔 결과가 없습니다. 첫 스캔이 끝나면 자동으로 채워집니다(1분 안팎).</p>`; return; }

  const st = Object.assign({ group: "all", kind: "", side: "all", sort: "dist", q: "", view: isMobile() ? "list" : "card", tag: "", more: !isMobile() }, load("tr-grid", {}));
  delete st.min;                                                  // 예전 '접근+ · 근접+' 필터 → 위 요약 칩(kind)으로 바뀜
  const fav = new Set(D.alerts.favorites || []);
  const groups = (D.watch.groups || []).filter((g) => g.items.length);

  const lineSet = (it) => it.lines.filter((x) => x.status !== "expired" && x.alertable && (st.side === "all" || x.side === st.side));
  // 가장 가까운 선(보여 줄 단계: 근접·터치에 들어왔던 선은 접근 구간을 벗어날 때까지 유지 — TR.sticky)
  const near = (it) => TR.sticky.view(lineSet(it).sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap))[0]);
  const retestWait = (it) => it.lines.some((x) => x.status === "broken" && x.alertable);
  // 가장 가까운 선의 상태: 0 없음 · 1 접근 · 2 근접 · 3 터치 · 'pen' 장중 이탈·돌파 시도 · 'rt' 이탈한 선 리테스트
  const kindOf = (n) => (!n?.stage ? 0 : n.stage < 3 ? n.stage : n.status === "broken" ? "rt" : n.penetrating ? "pen" : 3);

  function list() {
    const q = st.q.trim().toLowerCase();
    let xs = scan.items.filter((it) => (st.group === "all" || (st.group === "fav" ? fav.has(it.sym) : it.group === st.group)));
    if (q) xs = xs.filter((it) => it.name.toLowerCase().includes(q) || it.sym.toLowerCase().includes(q));
    if (st.kind !== "") xs = xs.filter((it) => String(kindOf(near(it))) === String(st.kind));
    if (st.tag === "retest") xs = xs.filter(retestWait);
    if (st.tag === "vol") xs = xs.filter((it) => it.vol);
    if (st.sort === "dist") {
      // 근접 순위: 빗각까지의 거리를 구간으로 묶고(0.25·0.5·1·2 ATR), 같은 구간이면 시가총액 큰 순(지수·매크로는 시장 전체라 맨 앞)
      const band = (it) => { const g = Math.abs(near(it)?.gap ?? 99); return g < 0.25 ? 0 : g < 0.5 ? 1 : g < 1 ? 2 : g < 2 ? 3 : 4; };
      const cap = (it) => (it.group === "index" || it.group === "macro" ? Infinity : it.mcap_usd || 0);
      return xs.sort((a, b) => band(a) - band(b) || cap(b) - cap(a) || Math.abs(near(a)?.gap ?? 99) - Math.abs(near(b)?.gap ?? 99));
    }
    const key = { chg: (it) => -it.chg, name: (it) => it.name, vol: (it) => -(it.vol_ratio || 0) }[st.sort];
    return xs.sort((a, b) => { const p = key(a), r = key(b); return typeof p === "string" ? p.localeCompare(r, "ko") : p - r; });
  }

  // 미니 차트: 최근 60봉 + 빗각(서버가 계산한 선분) + 현재가
  function mini(it, W = 300, H = 110) {
    const m = it.mini, n = m.c.length;
    if (!n) return "";
    const segs = lineSet(it).concat(it.lines.filter((x) => x.kind === "user"));
    let lo = Math.min(...m.l), hi = Math.max(...m.h);
    // 큰 차트와 같은 규칙: 봉 범위의 35% 안에 있는 선만 세로 축을 늘린다(먼 선 때문에 봉이 납작해지지 않게, 먼 선은 잘려 보임)
    const r = Math.log(hi / lo) || 0.01, a = Math.log(lo) - 0.35 * r, z = Math.log(hi) + 0.35 * r;
    for (const x of segs) { const v = x.now; if (v > 0 && Math.log(v) > a && Math.log(v) < z) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
    const pad = (Math.log(hi) - Math.log(lo)) * 0.08 || 0.01, y0 = Math.log(lo) - pad, y1 = Math.log(hi) + pad;
    const cw = W / (n + 3), X = (i) => (i + 0.5) * cw, Y = (p) => (1 - (Math.log(p) - y0) / (y1 - y0)) * H, bw = Math.max(1, cw * 0.62);
    let s = "";
    for (let i = 0; i < n; i++) {
      const cls = m.c[i] >= m.o[i] ? "cd-up" : "cd-down", t = Y(Math.max(m.o[i], m.c[i])), b = Y(Math.min(m.o[i], m.c[i]));
      s += `<line class="${cls}" x1="${X(i).toFixed(1)}" x2="${X(i).toFixed(1)}" y1="${Y(m.h[i]).toFixed(1)}" y2="${Y(m.l[i]).toFixed(1)}"/><rect class="${cls}" x="${(X(i) - bw / 2).toFixed(1)}" y="${t.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.8, b - t).toFixed(1)}"/>`;
    }
    for (const x of segs) {
      const [x1, v1, x2, v2] = x.mini;
      const cls = x.kind === "user" ? "cd-user" : x.side === "sup" ? "cd-sup" : "cd-res";
      s += `<line class="cd-line ${cls}${x.status === "broken" ? " broken" : ""}${(x.dstage ?? x.stage) >= 2 ? " hot" : ""}" x1="${X(x1).toFixed(1)}" y1="${Y(v1).toFixed(1)}" x2="${X(x2).toFixed(1)}" y2="${Y(v2).toFixed(1)}"/>`;
    }
    const yl = Y(it.price).toFixed(1);
    return `<svg class="mini-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><g>${s}</g><line class="cd-last" x1="0" x2="${W}" y1="${yl}" y2="${yl}"/></svg>`;
  }

  const gradeTag = (x) => (x.kind === "user" ? `<span class="gr gr-u" title="내가 그린 선">내선</span>`
    : `<span class="gr gr-${x.grade}" title="신뢰도 ${Math.round(x.q)}점 · 터치 ${x.touches}회${x.tf === "1w" ? " · 주봉" : ""}">${x.grade}</span>`);
  const lineTxt = (x) => `${roleText(x)} <span class="num">${price(x.now)}</span> <b class="num">${sgn(x.gap_pct, 1)}</b> <span class="muted num">${atr(x.gap)}</span> ${gradeTag(x)}`;
  const rank = (it) => (st.sort === "dist" ? `<span class="rank num" title="빗각 근접 순위">${it._rank}</span>` : "");
  const star = (it) => `<button type="button" class="star${fav.has(it.sym) ? " on" : ""}" data-star="${esc(it.sym)}" aria-pressed="${fav.has(it.sym)}" aria-label="관심 종목">★</button>`;
  function tags(it) {
    const t = [];
    const n = near(it);
    if (n?.approaching) t.push(`<span class="tg appr">다가오는 중</span>`);
    if (retestWait(it)) t.push(`<span class="tg rt">리테스트 대기</span>`);
    const fresh = it.lines.find((x) => x.alertable && x.break_d && x.break_d >= it.closed_d);
    if (fresh) t.push(`<span class="tg brk">${fresh.orig === "sup" ? "종가 이탈" : "종가 돌파"}</span>`);
    if (it.vol) t.push(`<span class="tg vol">거래량 ${it.vol.ratio.toFixed(1)}배</span>`);
    if (it.stale) t.push(`<span class="tg stale">데이터 지연</span>`);
    return t.join("");
  }

  const badge = (n) => `<span class="stage st-${n.stage} side-${n.side}${n.held ? " held" : ""}"${n.held ? ` title="최근 ${esc(stageLabel(n))} — 접근 구간을 벗어날 때까지 표시 유지"` : ""}>${esc(stageLabel(n))}</span>`;

  function card(it) {
    const n = near(it), stage = n?.stage || 0;
    const more = lineSet(it).filter((x) => x !== n).sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap)).slice(0, 2);
    return `<div class="rc st-${stage} side-${n?.side || "none"}">
      <div class="rc-h">${rank(it)}${star(it)}
        <p class="rc-name"><a class="cover" href="#chart/${encodeURIComponent(it.sym)}"><b>${esc(it.name)}</b></a> <span class="code">${esc(it.sym)}</span></p>
        ${stage ? badge(n) : ""}
      </div>
      <p class="rc-px"><span class="num">${price(it.price)}</span> <span class="num ${it.chg >= 0 ? "up" : "down"}">${sgn(it.chg, 2)}</span>${it.live ? ` <span class="live" title="진행 중인 봉">●</span>` : ""}
        <span class="trend t${Math.sign(it.trend.score)}">${esc(it.trend.label)}</span></p>
      <div class="mini" data-mini="${esc(it.sym)}"></div>
      <p class="rc-near">${n ? lineTxt(n) : `<span class="muted">감시 중인 빗각 없음</span>`}</p>
      ${more.length ? `<p class="rc-more">${more.map((x) => `${roleText(x)} ${sgn(x.gap_pct, 1)}`).join(" · ")}</p>` : ""}
      <p class="tags">${tags(it)}</p>
    </div>`;
  }

  function row(it) {
    const n = near(it), stage = n?.stage || 0;
    return `<div class="lr st-${stage} side-${n?.side || "none"}">
      <span class="lr-lead">${rank(it)}${star(it)}</span>
      <span class="lr-name"><a class="cover" href="#chart/${encodeURIComponent(it.sym)}"><b>${esc(it.name)}</b></a><span class="code">${esc(it.sym)}</span></span>
      <span class="lr-px num">${price(it.price)}<span class="${it.chg >= 0 ? "up" : "down"}">${sgn(it.chg, 2)}</span></span>
      <span class="lr-line">${n ? `<span>${esc(roleText(n))}</span><b class="num">${sgn(n.gap_pct, 1)}</b><span class="muted num">${atr(n.gap)}</span>` : `<span class="muted">—</span>`}</span>
      <span class="lr-st">${stage ? badge(n) : ""}${it.vol ? `<span class="tg vol">${it.vol.ratio.toFixed(1)}배</span>` : ""}</span>
    </div>`;
  }

  // 목록 부분(검색 · 칩으로 바뀌는 곳)만 그린다. 검색 입력칸을 다시 만들면 한글 입력(조합 중인 글자)이 깨지므로 입력칸은 그대로 둔다.
  function drawResults() {
    const box = el.querySelector("[data-results]");
    if (!box) return;
    const xs = list();
    xs.forEach((it, i) => { it._rank = i + 1; });
    box.innerHTML = `
      ${xs.length !== scan.items.length ? `<p class="summary muted">${xs.length} / ${scan.items.length}종목 · <button type="button" class="linkbtn" data-clear-f>조건 지우기</button></p>` : ""}
      ${xs.length ? (st.view === "card" ? `<div class="rgrid">${xs.map(card).join("")}</div>` : `<div class="rlist">${xs.map(row).join("")}</div>`) : `<p class="empty">조건에 맞는 종목이 없습니다.</p>`}`;
    const bySym = Object.fromEntries(scan.items.map((it) => [it.sym, it]));
    lazy(box.querySelectorAll("[data-mini]"), (m) => { m.innerHTML = mini(bySym[m.dataset.mini]); });
    box.querySelector("[data-clear-f]")?.addEventListener("click", () => set({ kind: "", q: "", tag: "", side: "all", group: "all" }));
    box.querySelectorAll("[data-star]").forEach((b) => b.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); TR.toggleFav(b.dataset.star, b); }));
  }
  const set = (p) => { Object.assign(st, p); save("tr-grid", st); render(); };

  function render() {
    // 상단 집계(누르면 그 상태만 보기): 가장 가까운 선 기준. 터치는 성격이 다른 셋으로 나눈다 — 유효한 선에 닿음 / 장중에 선 너머로 밀고 들어감 / 이탈한 선 되돌아와 닿음
    const cnt = (k) => scan.items.filter((it) => kindOf(near(it)) === k).length;
    const extra = (st.side !== "all") + !!st.tag + (st.sort !== "dist");          // 접힌 줄에 걸려 있는 조건 수
    const chip = (k, cls, label, title) => { const n = cnt(k); return n || String(st.kind) === String(k) ? `<button type="button" class="stage ${cls} chipbtn" data-kind="${k}" aria-pressed="${String(st.kind) === String(k)}" title="${title}">${label} ${n}</button>` : ""; };
    const seg = (key, opts, attr) => `<div class="seg" role="group">${opts.map(([k, l]) => `<button type="button" data-${attr}="${esc(k)}" aria-pressed="${st[key] === k}">${l}</button>`).join("")}</div>`;
    const viewBtn = (v, label, svg) => `<button type="button" class="icon-btn${st.view === v ? " on" : ""}" data-view="${v}" aria-pressed="${st.view === v}" aria-label="${label}" title="${label}">${svg}</button>`;
    el.innerHTML = `
      <section class="panel">
        <div class="bar nowrap">
          <input class="search" type="search" placeholder="종목 검색 (이름·티커)" value="${esc(st.q)}" aria-label="종목 검색" autocomplete="off" autocorrect="off" spellcheck="false">
          ${viewBtn("list", "목록으로 보기", `<svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>`)}
          ${viewBtn("card", "카드(미니 차트)로 보기", `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`)}
        </div>
        <div class="bar scroll-x">
          ${seg("group", [["all", "전체"], ["fav", "★ 관심"], ...groups.map((g) => [g.id, GROUP[g.id] || g.label])], "g")}
        </div>
        <p class="summary chips-sum" role="group" aria-label="상태로 거르기">
          ${chip(3, "st-3", "터치", `유효한 빗각에 봉이 닿음(선 ±${esc(String(D.alerts.zone_atr ?? 0.5))} ATR)`)}${chip("pen", "st-3", "이탈·돌파 시도", "장중에 선 너머 0.5 ATR 넘게 들어감(종가 미확정)")}${chip("rt", "st-2", "리테스트", "이탈·돌파했던 선에 반대편에서 다시 닿음")}${chip(2, "st-2", "근접", "선까지 1 ATR 안")}${chip(1, "st-1", "접근", "선까지 2 ATR 안")}
          <button type="button" class="chipbtn ftog" data-ftog aria-expanded="${st.more}">${extra ? `정렬·필터 ${extra}` : "정렬·필터"} ${st.more ? "▴" : "▾"}</button>
        </p>
        ${st.more ? `<div class="bar scroll-x">
          ${seg("side", [["all", "지지·저항"], ["sup", "지지"], ["res", "저항"]], "side")}
          ${seg("tag", [["", "모든 상태"], ["retest", "리테스트 대기"], ["vol", "거래량 급증"]], "tag")}
          <select class="sel" data-sort aria-label="정렬">${[["dist", "빗각 가까운 순"], ["chg", "등락률순"], ["vol", "거래량(5/20일)순"], ["name", "이름순"]].map(([k, l]) => `<option value="${k}"${st.sort === k ? " selected" : ""}>${l}</option>`).join("")}</select>
        </div>` : ""}
        <div data-results></div>
        <p class="hint">순서: 알림 대상 빗각까지의 거리(0.25 · 0.5 · 1 · 2 ATR 구간)가 가까운 순, 같은 구간이면 시가총액 큰 순(지수 · 매크로 먼저). 거리 = 현재가와 선의 차이(%, 평소 하루 변동폭 ATR 배수).
          근접 · 터치까지 들어온 종목은 접근 구간(2 ATR)을 벗어날 때까지 그 색을 유지합니다(점선 배지 = 지금은 조금 멀어졌지만 유지 중).</p>
        ${scan.errors?.length ? `<p class="hint">데이터 부족·오류: ${esc(scan.errors.slice(0, 20).join(", "))}</p>` : ""}
      </section>`;
    drawResults();

    el.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => set({ view: b.dataset.view })));
    el.querySelectorAll("[data-g]").forEach((b) => b.addEventListener("click", () => set({ group: b.dataset.g })));
    el.querySelectorAll("[data-kind]").forEach((b) => b.addEventListener("click", () => set({ kind: String(st.kind) === b.dataset.kind ? "" : b.dataset.kind })));
    el.querySelector("[data-ftog]").addEventListener("click", () => set({ more: !st.more }));
    el.querySelectorAll("[data-side]").forEach((b) => b.addEventListener("click", () => set({ side: b.dataset.side })));
    el.querySelectorAll("[data-tag]").forEach((b) => b.addEventListener("click", () => set({ tag: b.dataset.tag })));
    el.querySelector("[data-sort]")?.addEventListener("change", (e) => set({ sort: e.target.value }));
    // 검색: 입력칸은 그대로 두고 목록만 바꾼다(한글 조합 중에도 안전). 조합이 끝날 때 한 번 더 반영
    const search = el.querySelector(".search");
    let t;
    const apply = () => { clearTimeout(t); t = setTimeout(() => { if (st.q === search.value) return; st.q = search.value; save("tr-grid", st); drawResults(); }, 150); };
    search.addEventListener("input", apply);
    search.addEventListener("compositionend", apply);
  }
  render();
};

// ★ 관심 종목 토글(서버에 저장). 버튼 모양만 바로 바꾸고 화면 전체는 다시 그리지 않는다.
TR.toggleFav = async (sym, btn) => {
  const D = TR.store.data, fav = new Set(D.alerts.favorites || []), on = !fav.has(sym);
  try {
    const r = await TR.api.post("/api/favorite", { sym, on });
    D.alerts.favorites = r.favorites;
    document.querySelectorAll(`[data-star="${CSS.escape(sym)}"]`).forEach((b) => { b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); });
    TR.util.toast(on ? "관심 종목에 추가 — 이 종목은 모든 알림을 실시간으로 받습니다" : "관심 종목에서 뺐습니다 — 핵심 알림만 세션 요약으로");
  } catch (e) { TR.util.toast(e.message); }
};
