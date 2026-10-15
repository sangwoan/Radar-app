// 알림: 알림 기록(기본, 받은 편지함처럼 최신순) + 지금 경보 구간에 있는 선. 이 화면을 열면 아래 탭바의 '안 읽은 알림' 수가 0이 된다.
TR.modules.alerts = (el, D) => {
  const { esc, price, sgn, atr, roleText, stageLabel, ago, load, save } = TR.util;
  const items = D.scan?.items || [];
  const fav = new Set(D.alerts.favorites || []), phone = TR.api.mode === "local";
  const st = Object.assign({ tab: "log", cat: "all", route: "all", favOnly: false }, load("tr-alerts", {}));
  const CAT = { approach: "접근", near: "근접", touch: "터치", confirm: "반응 확인", break: "이탈·돌파", fail: "실패(복귀)", retest: "리테스트", volume: "거래량" };
  const DELIVER = { phone: "폰 알림", kakao: "카톡", mac: "맥 알림", failed: "발송 실패", queued: "조용한 시간 대기", digest: "세션 요약", app: "앱에만", none: "기록만", off: "알림 꺼짐" };
  const ROUTES = phone ? [["phone", "폰 알림"], ["digest", "세션 요약"], ["queued", "대기"], ["app", "앱에만"]]
    : [["kakao", "카톡"], ["mac", "맥 알림"], ["digest", "세션 요약"], ["queued", "대기"], ["app", "앱에만"]];
  if (st.route !== "all" && !ROUTES.some(([k]) => k === st.route)) st.route = "all";
  const catOf = (e) => (e.type === "volume" ? "volume" : e.type === "retest_confirm" || (e.type === "stage" && e.status === "broken") ? "retest"
    : ["confirm", "break", "fail"].includes(e.type) ? e.type : ({ 1: "approach", 2: "near", 3: "touch" })[e.stage]);
  // ✅는 '확인 마감'(종가로 확인된 것)에만. 리테스트 터치는 아직 확인 전이라 지지·저항 색으로
  const icon = (e) => e.type === "volume" ? "📊" : ["confirm", "retest_confirm"].includes(e.type) ? "✅" : e.type === "fail" ? "↩️"
    : e.type === "break" ? (e.orig === "res" ? "🚀" : "⚠️") : e.side === "sup" ? "🟢" : "🔴";
  const lineWord = (e) => e.kind === "user" ? "내 빗각" : e.status === "broken" && e.type !== "break" ? (e.orig === "res" ? "돌파한 저항선" : "이탈한 지지선")
    : e.orig === "sup" ? "지지 빗각" : "저항 빗각";
  // 지금 설정이 알림을 어떻게 보내는지 한 줄로(설정 화면과 같은 규칙)
  const A = D.alerts, G = { S: "S등급", A: "A등급 이상", B: "B등급 이상" };
  const how = A.notify_scope === "all" ? `전체 종목의 ${G[A.push_min_grade || "A"] || "A등급 이상"} 빗각 · ★ 관심 종목은 모든 알림을 바로`
    : `★ 관심 종목은 바로, 나머지는 핵심 알림만 세션 요약`;

  function nowTab() {
    const rows = items.flatMap((it) => it.lines.filter((x) => (x.dstage ?? x.stage) > 0 && x.status !== "expired" && x.alertable).map((x) => ({ it, x: TR.sticky.view(x) })))
      .filter(({ it }) => !st.favOnly || fav.has(it.sym))
      .sort((a, b) => b.x.stage - a.x.stage || Math.abs(a.x.gap) - Math.abs(b.x.gap));
    if (!rows.length) return `<p class="empty">경보 구간(접근 이상)에 들어온 빗각이 없습니다.</p>`;
    return `<div class="alist">${rows.map(({ it, x }) => `
      <a class="ar st-${x.stage} side-${x.side}" href="#chart/${encodeURIComponent(it.sym)}">
        <span class="ar-name">${fav.has(it.sym) ? "★ " : ""}<b>${esc(it.name)}</b> <span class="code">${esc(it.sym)}</span></span>
        <span class="ar-line">${esc(roleText(x))} <span class="gr gr-${x.kind === "user" ? "u" : x.grade}">${x.kind === "user" ? "내선" : x.grade}</span>${x.approaching ? ` <span class="appr">다가오는 중</span>` : ""}</span>
        <span class="ar-num num"><span class="muted">선</span> ${price(x.now)} <b>${sgn(x.gap_pct, 1)}</b> <span class="muted">${atr(x.gap)}</span></span>
        <span class="stage st-${x.stage} side-${x.side}">${esc(stageLabel(x))}</span>
      </a>`).join("")}</div>`;
  }

  function logTab() {
    const seen = TR.alertsSeen?.() || "";
    const log = (D.log || []).filter((e) => (st.cat === "all" || catOf(e) === st.cat) && (st.route === "all" || (e.delivered || "app") === st.route)
      && (!st.favOnly || fav.has(e.sym))).slice(0, 300);
    if (!log.length) return `<p class="empty">${D.log?.length ? "조건에 맞는 알림이 없습니다." : "아직 기록된 알림이 없습니다. 처음 보는 선은 기준만 잡고, 그다음부터 변화가 생길 때 기록합니다."}</p>`;
    return `<ul class="feed">${log.map((e) => `
      <li class="${e.type === "break" ? "brk" : e.type === "volume" ? "vol" : `side-${e.side}`}${seen && e.at > seen ? " new" : ""}">
        <a href="#chart/${encodeURIComponent(e.sym)}">
          <p>${icon(e)} <b>${esc(e.name)}</b> ${e.type === "volume" ? "" : esc(lineWord(e))} <b>${esc(e.label)}</b>
            ${e.type === "volume" ? "" : `<span class="num">${sgn(e.gap_pct, 1)}</span>`} ${e.grade && e.grade !== "V" ? `<span class="gr gr-${e.grade === "U" ? "u" : e.grade}">${e.grade === "U" ? "내선" : e.grade}</span>` : ""}</p>
          <p class="muted num">${esc(e.at.slice(5, 16).replace("T", " "))} · 현재 ${price(e.price)}${e.line ? ` · 선 ${price(e.line)}` : ""} · ${esc(e.trend || "")}${e.conf?.length ? ` · 합류 ${esc(e.conf.join(","))}` : ""} · <span class="dv dv-${esc(e.delivered || "app")}">${esc(DELIVER[e.delivered] || e.delivered || "앱에만")}</span></p>
        </a>
      </li>`).join("")}</ul>`;
  }

  function render() {
    const pend = D.status?.pending || 0, dg = D.status?.digest || 0;
    const seg = (key, opts, attr) => `<div class="seg" role="group">${opts.map(([k, l]) => `<button type="button" data-${attr}="${esc(k)}" aria-pressed="${st[key] === k}">${l}</button>`).join("")}</div>`;
    el.innerHTML = `
      <section class="panel">
        <div class="bar scroll-x">
          ${seg("tab", [["log", "알림 기록"], ["now", "지금 경보 구간"]], "tab")}
          <label class="chk"><input type="checkbox" data-fav${st.favOnly ? " checked" : ""}> ★ 관심만</label>
        </div>
        ${st.tab === "log" && D.log?.length ? `<div class="bar scroll-x">${seg("cat", [["all", "모든 종류"], ...Object.entries(CAT)], "cat")}</div>
          <div class="bar scroll-x">${seg("route", [["all", "모든 경로"], ...ROUTES], "route")}</div>` : ""}
        <p class="summary muted">${pend ? `조용한 시간 대기 ${pend}건 · ` : ""}${dg ? `다음 세션 요약에 ${dg}건 · ` : ""}스캔 ${ago(D.scan?.generated_at)} · ${how} <a class="linkbtn" href="#settings">변경</a></p>
        ${st.tab === "now" ? nowTab() : logTab()}
      </section>`;
    const set = (p) => { Object.assign(st, p); save("tr-alerts", st); render(); };
    el.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => set({ tab: b.dataset.tab })));
    el.querySelectorAll("[data-cat]").forEach((b) => b.addEventListener("click", () => set({ cat: b.dataset.cat })));
    el.querySelectorAll("[data-route]").forEach((b) => b.addEventListener("click", () => set({ route: b.dataset.route })));
    el.querySelector("[data-fav]").addEventListener("change", (e) => set({ favOnly: e.target.checked }));
  }
  render();
  TR.markAlertsSeen?.();                                        // 이 화면을 봤으면 '안 읽은 알림' 배지를 비운다(이번에 그린 '새' 표시는 남김)
};
