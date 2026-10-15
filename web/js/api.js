// 데이터 접근 단일 창구.
//  · remote(맥 서버 · 나중엔 클라우드 서버): 같은 서버의 정적 JSON + /api/* (상대 경로)
//  · local(폰 앱): 폰 안의 엔진(TR.local)이 같은 요청을 처리 — 화면 코드는 어느 쪽인지 몰라도 된다
//  맥 브라우저에서 폰 엔진을 시험하려면 주소에 ?engine=local (서버의 개발용 프록시로 시세를 받음)
TR.api = (() => {
  const local = !!window.RadarNative || new URLSearchParams(location.search).get("engine") === "local";
  if (local) {
    if (!window.RadarNative) TR.http.proxy = true;
    return { mode: "local", get: (url) => TR.local.get(url), post: (url, body = {}) => TR.local.post(url, body), loadAll: () => TR.local.loadAll(),
             bars: async (data, file) => data.bars[file] || (data.bars[file] = await TR.db.getBars(file)) };
  }
  async function get(url, ms = 20000) {
    const c = new AbortController(); const h = setTimeout(() => c.abort(), ms);
    try {
      const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, { cache: "no-store", signal: c.signal, credentials: "same-origin" });
      if (res.status === 401) throw new Error("접속 키가 필요합니다. 맥의 설정 화면 QR로 다시 여세요.");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally { clearTimeout(h); }
  }
  async function post(url, body = {}, ms = 180000) {
    const c = new AbortController(); const h = setTimeout(() => c.abort(), ms);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-TR": "1" }, body: JSON.stringify(body), signal: c.signal, credentials: "same-origin" });
      const out = await res.json().catch(() => ({}));
      if (res.status === 403) throw new Error("이 기능은 맥에서만 쓸 수 있습니다.");
      if (!res.ok || out.ok === false) throw new Error(out.message || `HTTP ${res.status}`);
      return out;
    } finally { clearTimeout(h); }
  }
  const soft = (p) => p.catch(() => null);
  async function loadAll() {
    const [scan, lines, log, watch, alerts, status, universe] = await Promise.all([
      soft(get("./data/scan.json", 40000)), soft(get("./data/lines.json")), soft(get("./data/alert_log.json")),
      get("./config/watchlist.json"), get("./config/alerts.json"), soft(get("/api/status")), soft(get("./data/universe_report.json")),
    ]);
    return { scan, lines: lines || {}, log: log || [], watch, alerts, status, universe, bars: {} };
  }
  // 상세 차트용 일봉(종목별 파일) — 한 번 받은 건 이번 데이터 세대 동안 재사용
  async function bars(data, file) {
    if (!data.bars[file]) data.bars[file] = await get(`./data/bars/${encodeURIComponent(file)}.json`);
    return data.bars[file];
  }
  return { mode: "remote", get, post, loadAll, bars };
})();
