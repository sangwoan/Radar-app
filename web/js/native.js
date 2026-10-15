// 앱 껍데기(안드로이드)와의 다리 + 외부 HTTP 창구.
// 폰 앱 안이면 window.RadarNative(자바)로 네이티브 HTTP · 폰 알림 · 백그라운드 예약 · 배터리 설정을 쓴다.
// 맥 브라우저에서 폰 엔진을 시험할 때는 서버의 개발용 프록시(/api/proxy, 이 맥에서만)로, 노드에서는 fetch로 부른다.
(function (G) {
  const TR = (G.TR = G.TR || {});
  const N = typeof window !== "undefined" ? window.RadarNative : null;
  const pending = new Map();
  let seq = 0;
  if (N) {
    window.__radarCb = (id, ok, payload) => {
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (ok) p.res(payload); else p.rej(new Error(payload || "네이티브 호출 실패"));
    };
  }
  const call = (fn) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    try { fn(id); } catch (e) { pending.delete(id); rej(e); }
  });
  const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

  TR.native = {
    available: !!N,
    background: !!(N && N.isBackground && N.isBackground()),
    http: (url, ms) => call((id) => N.http(id, url, ms | 0)).then((p) => parse(p, { status: 0, body: "" })),
    notify: (title, body, sym) => { if (N) N.notify(String(title), String(body), sym || ""); },
    schedule: (minutes, exact) => { if (N) N.schedule(minutes | 0, !!exact); },
    status: () => (N ? parse(N.status(), null) : null),           // {notifications, battery_unrestricted, exact_allowed, version, interval, exact, mode, next_run}
    requestNotifications: () => N && N.requestNotifications(),
    requestBattery: () => N && N.requestBattery(),
    requestExact: () => N && N.requestExact(),
    openExternal: (url) => (N ? N.openExternal(url) : window.open(url, "_blank", "noopener,noreferrer")),
    bgDone: (summary) => { if (N) N.bgDone(JSON.stringify(summary || {})); },
    log: (msg) => { if (N && N.log) N.log(String(msg)); },
    theme: (dark) => { if (N && N.theme) N.theme(!!dark); },           // 상태 표시줄 색을 화면 테마에 맞춤
    // 앱 새 버전(맥 서버의 dist/latest.json): 확인 → {enabled, current, latest, available, error}, 설치 → {needPermission | started | latest}
    checkUpdate: () => (N && N.checkUpdate ? call((id) => N.checkUpdate(id)).then((p) => parse(p, null)) : Promise.resolve(null)),
    installUpdate: () => call((id) => N.installUpdate(id)).then((p) => parse(p, {})),
    // 화면 바로 업데이트(배포 저장소 web/): 지금 확인 → {applied, web, latest, error}. bootOk = 화면이 끝까지 떴다(새 화면 안전장치 해제)
    checkWeb: () => (N && N.checkWeb ? call((id) => N.checkWeb(id)).then((p) => parse(p, null)) : Promise.resolve(null)),
    bootOk: () => { if (N && N.bootOk) N.bootOk(); },
  };

  async function text(url, ms = 20000) {
    if (TR.native.available) {
      const r = await TR.native.http(url, ms);
      if (!r.status || r.status >= 400) throw new Error(`HTTP ${r.status || "실패"}`);
      return r.body;
    }
    const c = new AbortController(), h = setTimeout(() => c.abort(), ms);
    try {
      const viaProxy = typeof window !== "undefined" && TR.http.proxy;
      const res = await fetch(viaProxy ? `/api/proxy?url=${encodeURIComponent(url)}` : url, viaProxy ? { signal: c.signal, headers: { "X-TR": "1" } } : { signal: c.signal, headers: { "User-Agent": "Mozilla/5.0" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } finally { clearTimeout(h); }
  }
  TR.http = { proxy: false, text, json: async (url, ms) => JSON.parse(await text(url, ms)) };
})(typeof window !== "undefined" ? window : globalThis);
