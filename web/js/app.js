// 앱 뼈대: 데이터 로드, 화면 전환(#radar · #chart/SYM · #volume · #alerts · #settings), 머리글 상태, 1분마다 새 스캔 확인.
(() => {
  const { esc, hm, toast, load, save } = TR.util;
  const SEEN = "tr-alerts-seen", PUSHED = new Set(["phone", "kakao", "mac", "digest", "queued"]);
  TR.alertsSeen = () => load(SEEN, "");
  TR.markAlertsSeen = () => { const last = S.data?.log?.[0]?.at; if (last && last > TR.alertsSeen()) save(SEEN, last); if (S.data) header(); };
  const S = (TR.store = { data: null, busy: false });
  const main = document.getElementById("main");
  const PAGES = { radar: "grid", chart: "detail", volume: "volume", alerts: "alerts", settings: "settings" };
  const TITLES = { radar: "레이더", chart: "차트", volume: "거래량", alerts: "알림", settings: "설정" };

  function route() {
    const h = location.hash.replace(/^#/, "");
    const [head, query = ""] = h.split("?");
    const [page, ...rest] = head.split("/");
    return { page: PAGES[page] ? page : "radar", arg: rest.length ? decodeURIComponent(rest.join("/")) : "", query: new URLSearchParams(query) };
  }
  TR.route = route;

  function header() {
    const d = S.data, st = d.status, scan = d.scan;
    const mk = st?.markets || scan?.markets || {};
    const dot = (k, l) => `<span class="mk ${mk[k] ? "on" : ""}" title="${mk[k] ? "장중" : "장 마감"}">${l}</span>`;
    const k = st?.kakao, phone = TR.api.mode === "local";
    const kk = phone ? (st?.native && !st.native.notifications ? `<a class="pill warn" href="#settings">알림 꺼짐</a>` : "")
      : !st ? `<span class="pill warn">서버 연결 끊김</span>`
      : k?.connected ? `<span class="pill ok desk-only" title="리프레시 토큰 ${k.refresh_days_left ?? "?"}일 남음">카톡 연결됨</span>`
      : st.local ? `<a class="pill warn" href="#settings">카톡 ${k?.needs_reconnect ? "재연결 필요" : "미연결"}</a>` : "";
    document.getElementById("status").innerHTML = `
      <span class="mks desk-only">${dot("crypto", "코인")}${dot("krx", "한국")}${dot("us", "미국")}</span>
      <span class="clock" title="마지막 스캔 시각">${scan?.generated_at ? `${hm(scan.generated_at)} 기준` : "—"}${st?.sched?.running ? " · 스캔 중" : st?.sched?.next ? ` · 다음 ${hm(st.sched.next)}` : ""}${st?.quiet ? ` · <span title="조용한 시간 — 알림을 모았다가 끝나면 한 번에">🌙</span>` : ""}</span>${kk}`;
    const r = route();
    document.querySelectorAll("[data-page]").forEach((a) => a.setAttribute("aria-current", a.dataset.page === r.page ? "page" : "false"));
    // 배지: 레이더 = ★ 관심 종목 중 지금 근접·터치, 거래량 = 급증 종목, 알림 = 안 읽은 알림(바로 보낸 · 요약 · 대기 알림)
    const fav = new Set(d.alerts?.favorites || []);
    const nearOf = (it) => it.lines.filter((x) => x.status !== "expired" && x.alertable).sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap))[0];
    const hot = (scan?.items || []).filter((x) => { const n = nearOf(x); return fav.has(x.sym) && (n?.dstage ?? n?.stage ?? 0) >= 2; }).length;
    const vol = (scan?.items || []).filter((x) => x.vol).length;
    let seen = TR.alertsSeen();
    if (!seen) { seen = d.log?.[0]?.at || TR.core.isoKST(); save(SEEN, seen); }        // 처음엔 지난 기록을 읽은 것으로
    const unread = (d.log || []).filter((e) => e.at > seen && PUSHED.has(e.delivered)).length;
    const badge = (page, n, label) => document.querySelectorAll(`[data-page="${page}"] .cnt`).forEach((e) => { e.textContent = n ? (n > 99 ? "99+" : n) : ""; e.title = n ? label : ""; });
    badge("radar", hot, "★ 관심 종목 중 근접 · 터치");
    badge("volume", vol, "거래량 급증 종목");
    badge("alerts", unread, "안 읽은 알림");
  }
  TR.header = () => S.data && header();

  let pendingRender = false;
  const editing = () => { const a = document.activeElement; return (a && main.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) || !!main.querySelector("form[data-dirty]")
    || (!!S.drawSym && location.hash === `#chart/${encodeURIComponent(S.drawSym)}`); };   // 빗각 그리기 모드 중에는 1분 새로고침으로 차트를 다시 그리지 않는다
  // 백그라운드 스캔으로 새 결과가 왔을 때: 입력 중이면 머리글만 바꾸고 화면은 입력이 끝난 뒤에
  function quietRender() { if (editing()) { pendingRender = true; header(); } else render(); }
  main.addEventListener("focusout", () => setTimeout(() => { if (pendingRender && !editing()) render(); }, 400));

  function render() {
    if (!S.data) return;
    pendingRender = false;
    header();
    const r = route();
    document.title = `${TITLES[r.page]} · Radar`;
    try { TR.modules[PAGES[r.page]](main, S.data, r); }
    catch (e) { console.error(e); main.innerHTML = `<p class="empty fatal">화면을 그리지 못했습니다: ${esc(e.message)}</p>`; }
  }
  TR.render = render;

  async function reload(quiet = false) {
    S.data = await TR.api.loadAll();
    TR.sticky.apply(S.data.scan);                                    // 근접·터치 표시 유지(접근 구간을 벗어날 때까지)
    if (TR.api.mode === "local" && !S.data.scan) return firstSync();
    quiet ? quietRender() : render();
    if (!S.data.scan) setTimeout(() => reload(true).catch(() => {}), 5000);   // 서버 첫 스캔이 끝나기 전이면 곧 다시
  }
  TR.reload = reload;

  // 폰 앱 첫 실행: 전 종목 5년치를 받고(약 1~2분) 기준만 잡는 첫 스캔(알림 없음)
  let syncing = false;
  async function firstSync() {
    if (syncing) return;
    syncing = true; S.busy = true;
    main.innerHTML = `<section class="panel sync"><h2>📐 처음 데이터를 받는 중</h2><p class="muted">전 종목의 5년치 일봉을 이 폰에 받습니다. 한 번만 하면 되고 1~2분 걸립니다. 와이파이를 권장합니다.</p>
      <div class="bar-prog"><i style="width:0%"></i></div><p class="sync-msg num">준비 중…</p></section>`;
    const bar = main.querySelector(".bar-prog i"), msg = main.querySelector(".sync-msg");
    try {
      for (;;) {
        const r = await TR.engine.scan({ mode: "all", notify: false, onProgress: (n, total, it) => {
          bar.style.width = `${Math.round((n / total) * 100)}%`;
          msg.textContent = `${n} / ${total} · ${it.name}`;
        } });
        if (!r.busy) break;
        // 앞서 끊긴 실행의 잠금(최대 2분)이나 백그라운드 점검이 끝나기를 기다렸다가 이어서 받는다(받아 둔 종목은 다시 받지 않음)
        msg.textContent = "다른 작업이 데이터를 받는 중 — 끝나면 이어서 받습니다…";
        await new Promise((res) => setTimeout(res, 4000));
      }
      msg.textContent = "빗각 계산 완료";
    } catch (e) {
      main.innerHTML = `<div class="empty fatal"><p>데이터를 받지 못했습니다: ${esc(e.message)}</p><p>인터넷 연결을 확인하세요. 받은 종목은 남아 있어 이어서 받습니다.</p>
        <div class="row center"><button type="button" class="btn primary" data-retry>다시 시도</button></div></div>`;
      main.querySelector("[data-retry]").addEventListener("click", () => reload().catch(() => {}));
      return;
    } finally { syncing = false; S.busy = false; }
    return reload();
  }

  // 지금 화면 버전(이 파일 주소의 ?v=) — 서버가 알려 주는 버전과 다르면 새 버전이 배포된 것
  const APP_V = (document.querySelector('script[src*="js/app.js"]')?.src.match(/[?&]v=([^&]+)/) || [])[1] || null;
  let resumed = false;
  function newVersion(v) {
    if (resumed && !S.busy) { location.reload(); return; }        // 앱을 다시 열었을 때 → 바로 새 버전으로
    if (document.querySelector(".upd")) return;
    const b = document.createElement("button");
    b.type = "button"; b.className = "upd";
    b.innerHTML = `✨ 새 버전(${v})이 있어요 · <b>눌러서 업데이트</b>`;
    b.addEventListener("click", () => location.reload());
    document.body.appendChild(b);
  }

  async function poll() {
    if (document.hidden) return;
    try {
      const st = await TR.api.get("/api/status");
      if (st?.app_version && APP_V && st.app_version !== APP_V) newVersion(st.app_version);
      resumed = false;
      const changed = st?.sched?.last && st.sched.last !== S.data?.scan?.generated_at;
      if (changed && !S.busy) await reload(true);
      else if (S.data) { S.data.status = st; header(); }
    } catch { if (S.data) { S.data.status = null; header(); } }
  }

  document.getElementById("refresh").addEventListener("click", async (ev) => {
    const b = ev.currentTarget;
    b.disabled = true; b.classList.add("spinning");
    try {
      const r = await TR.api.post("/api/scan", { all: TR.api.mode !== "local" });     // 폰은 장이 열린 시장만(전체는 설정 → 지금 스캔)
      await reload();
      toast(`스캔 완료 · ${r.seconds}s${r.events ? ` · 알림 ${r.events}건` : ""}${r.failed?.length ? ` · 실패 ${r.failed.length}` : ""}`);
    } catch (e) { toast(e.message); }
    finally { b.disabled = false; b.classList.remove("spinning"); }
  });
  // 테마: system(폰 · 맥 설정을 따름) · light · dark — localStorage 'tr-theme'은 index.html 첫 줄이 그대로 읽는 값(JSON 아님)
  const mq = matchMedia("(prefers-color-scheme: dark)");
  const syncBars = () => TR.native.theme((document.documentElement.dataset.theme || (mq.matches ? "dark" : "light")) === "dark");   // 폰 앱 상태 표시줄 색
  TR.themeMode = () => document.documentElement.dataset.theme || "system";
  TR.setTheme = (mode) => {
    if (mode === "light" || mode === "dark") { document.documentElement.dataset.theme = mode; try { localStorage.setItem("tr-theme", mode); } catch {} }
    else { delete document.documentElement.dataset.theme; try { localStorage.removeItem("tr-theme"); } catch {} }
    syncBars();
    render();
  };
  document.getElementById("theme").addEventListener("click", () => {
    TR.setTheme((document.documentElement.dataset.theme || (mq.matches ? "dark" : "light")) === "dark" ? "light" : "dark");
  });
  if (TR.native.available) { syncBars(); mq.addEventListener("change", syncBars); }
  // '시스템' 테마일 때 폰 · 맥이 다크 모드로 바뀌면 화면을 다시 그린다 — 차트(캔버스)는 그릴 때 색을 읽으므로 그대로면 예전 색이 남는다
  mq.addEventListener("change", () => { if (!document.documentElement.dataset.theme && S.data) quietRender(); });
  let lastPage = route().page;
  window.addEventListener("hashchange", () => {
    const p = route().page;
    render();
    if (p !== lastPage) window.scrollTo(0, 0);
    lastPage = p;
  });
  let rw, lastW = innerWidth;
  window.addEventListener("resize", () => {
    if (Math.abs(innerWidth - lastW) < 40) return;           // 모바일 주소창이 접히며 생기는 작은 변화는 무시
    lastW = innerWidth;
    clearTimeout(rw); rw = setTimeout(() => { if (!S.busy) render(); }, 250);
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { resumed = true; poll(); } });
  TR.checkUpdate = poll;

  reload().then(() => {
    if (TR.api.mode === "local" && TR.native.available && S.data?.alerts) TR.native.schedule(S.data.alerts.bg_minutes ?? 15, S.data.alerts.bg_exact);   // 백그라운드 점검 예약 유지
  }).catch((e) => { main.innerHTML = `<p class="empty fatal">데이터를 불러오지 못했습니다: ${esc(e.message)}<br>${TR.api.mode === "local" ? "앱을 다시 열어 보세요." : "맥에서 Radar 서버가 켜져 있는지 확인하세요."}</p>`; });
  setInterval(poll, 60000);
  // 화면 바로 업데이트: 네이티브(WebUpdate)가 새 화면 파일을 받아 두면 부른다 → 입력 중이 아니면 바로 다시 불러온다(데이터 · 설정은 그대로)
  window.__radarWebUpdated = (ver) => {
    const go = () => { toast(`새 버전 ${ver} 적용`); setTimeout(() => location.reload(), 600); };
    if (!editing()) return go();
    main.addEventListener("focusout", function once() { setTimeout(() => { if (!editing()) { main.removeEventListener("focusout", once); go(); } }, 400); });
  };
  // 폰 앱(APK) 새 버전 — 네이티브 기능이 바뀐 드문 경우만: 앱을 열 때 · 다시 열 때(30분마다) 배포 저장소(또는 맥 서버)에 묻고, 있으면 배너 → 받아서 안드로이드 설치 화면으로
  const UPD_EVERY = 30 * 60 * 1000;
  TR.update = {
    info: null, at: 0,
    async check(force = false) {
      if (!TR.native.available || (!force && Date.now() - this.at < UPD_EVERY)) return this.info;
      this.at = Date.now();
      try { this.info = await TR.native.checkUpdate(); } catch { this.info = null; }
      if (this.info?.available) updBanner(this.info);
      return this.info;
    },
    async install() {
      const b = updBanner(this.info || {});
      b.disabled = true;
      b.textContent = "새 버전을 받는 중…";
      window.__radarUpd = (pct) => { if (pct >= 0) b.textContent = `새 버전을 받는 중… ${pct}%`; };
      try {
        const r = await TR.native.installUpdate();
        if (r.needPermission) { b.disabled = false; b.innerHTML = "‘이 출처 허용’을 켜고 돌아오면 이어서 설치합니다 · <b>다시 누르기</b>"; return; }
        if (r.latest) { b.remove(); toast("이미 최신 버전입니다"); return; }
        b.disabled = false;
        b.innerHTML = "설치 화면에서 <b>업데이트</b>를 누르세요 · 안 보이면 여기를 다시 누르기";
      } catch (e) { b.disabled = false; b.innerHTML = `업데이트 실패: ${esc(e.message)} · <b>다시 누르기</b>`; }
    },
  };
  function updBanner(u) {
    let b = document.querySelector(".upd");
    if (!b) {
      b = document.createElement("button");
      b.type = "button"; b.className = "upd";
      b.addEventListener("click", () => TR.update.install());
      document.body.appendChild(b);
    }
    if (u.latest) b.innerHTML = `✨ 앱 새 버전(${esc(u.latest)})이 있어요 · <b>눌러서 업데이트</b>`;
    return b;
  }
  if (TR.native.available) {
    setTimeout(() => TR.update.check(true), 2500);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) TR.update.check(); });
  }
  window.__radarOpen = (sym) => { location.hash = sym ? `#chart/${encodeURIComponent(sym)}` : "#radar"; };   // 알림을 눌러 앱이 열렸을 때(네이티브가 부름)
  if (TR.native.available) {                                   // 앱 안: 바깥 링크(뉴스 원문 · TradingView)는 폰 브라우저로
    document.addEventListener("click", (e) => {
      const a = e.target.closest("a[href]");
      if (a && /^https?:/i.test(a.href) && new URL(a.href).origin !== location.origin) { e.preventDefault(); TR.native.openExternal(a.href); }
    });
  }
  // 서비스 워커는 휴대폰 '앱 설치'용(HTTPS)에서만. 이 맥(localhost)·http 주소에서는 예전에 등록된 것까지 정리한다
  //  — 맥에서는 쓸모가 없고, 멈춘 워커가 예전 화면을 계속 내놓는 일을 막기 위해서다.
  if ("serviceWorker" in navigator && !TR.native.available) {
    if (location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
    else {
      navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
      if (window.caches) caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => {});
    }
  }
  if (TR.native.available) TR.native.bootOk();                     // 여기까지 왔으면 화면이 뜬 것(새로 받은 화면의 안전장치 해제)
})();
