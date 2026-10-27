// 반도체 탭 데이터 — 형제 프로젝트 Daily Market Radar(sangwoan/semicon-news)가 비밀 gist에 올리는 묶음(radar-bundle.json)을 받아 쓴다.
//  · 묶음 = { built_at, config: { settings, tickers }, data: { meta, snapshot, news, calendar, memory, cycle, … } } (DMR scripts/build_bundle.py)
//  · 주소는 이 기기에만 둔다(localStorage tr-semi-url). 배포 저장소(radar-app)는 공개라 코드에 넣지 않는다.
//  · 폰 앱 = 네이티브 다리(TR.http), 그 밖 = 브라우저 fetch(gist raw는 CORS *). 받은 묶음은 차트(charts)를 빼고 IndexedDB에 보관 → 꺼져 있어도 마지막 것을 보여 준다.
TR.semi = (() => {
  const KEY = "tr-semi-url", CACHE = "semi:bundle", TTL = 30 * 60 * 1000;
  const MODULES = ["meta", "brief", "snapshot", "news", "calendar", "memory", "cycle", "company", "outlook", "exports", "twrev", "capex", "consensus"];
  let mem = null;                                                  // { bundle, fetchedAt, error }

  // gist 페이지 주소(gist.github.com/<owner>/<id>)도 받아 raw 주소로 바꾼다. 그 밖의 호스트는 받지 않는다.
  function normalize(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";
    let u;
    try { u = new URL(s); } catch { throw new Error("주소 형식이 아닙니다"); }
    if (u.protocol !== "https:") throw new Error("https 주소만 됩니다");
    const parts = u.pathname.split("/").filter(Boolean);
    if (u.hostname === "gist.github.com" && parts.length >= 2 && /^[0-9a-f]{20,40}$/i.test(parts[1]))
      return `https://gist.githubusercontent.com/${parts[0]}/${parts[1]}/raw/radar-bundle.json`;
    if (u.hostname === "gist.githubusercontent.com" && parts.length >= 3) return `https://gist.githubusercontent.com${u.pathname}`;
    throw new Error("Daily Market Radar의 gist 주소(gist.githubusercontent.com)를 넣어 주세요");
  }
  const url = () => { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } };
  function setUrl(raw) {
    const u = normalize(raw);
    try { u ? localStorage.setItem(KEY, u) : localStorage.removeItem(KEY); } catch { /* 저장 불가(사생활 모드) — 이번 화면에서만 */ }
    mem = null;
    return u;
  }

  // 화면에 필요한 것만 남긴다(차트 2년치 OHLCV는 Radar 차트가 있으니 뺀다)
  function slim(b) {
    if (!b || typeof b !== "object" || !b.data || typeof b.data !== "object" || !b.data.meta) throw new Error("Daily Market Radar 묶음이 아닙니다");
    const data = {};
    for (const k of MODULES) data[k] = b.data[k] || null;
    return { built_at: b.built_at || b.data.meta.updated_at || null, config: { settings: b.config?.settings || {}, tickers: b.config?.tickers || {} }, data };
  }

  async function fetchText(u) {
    if (TR.native?.available) return TR.http.text(u, 30000);
    const c = new AbortController(), h = setTimeout(() => c.abort(), 30000);
    try {
      const res = await fetch(u, { cache: "no-store", signal: c.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } finally { clearTimeout(h); }
  }
  const store = {
    get: async () => { try { return TR.db ? await TR.db.kv(CACHE) : null; } catch { return null; } },
    put: async (v) => { try { if (TR.db) await TR.db.setKv(CACHE, v); } catch { /* 보관 실패는 무시 */ } },
  };

  // → { bundle, fetchedAt, error, configured }. 보관본이 TTL 안이면 받지 않는다(force면 받는다). 받기에 실패하면 보관본 + error.
  async function load(force = false) {
    const u = url();
    if (!u) return { bundle: null, fetchedAt: null, error: null, configured: false };
    if (!mem) {
      const c = await store.get();
      if (c && c.url === u && c.bundle) mem = { bundle: c.bundle, fetchedAt: c.fetchedAt, error: null };
    }
    if (mem && !force && Date.now() - mem.fetchedAt < TTL) return { ...mem, configured: true };
    try {
      const bundle = slim(JSON.parse(await fetchText(u)));
      mem = { bundle, fetchedAt: Date.now(), error: null };
      await store.put({ url: u, bundle, fetchedAt: mem.fetchedAt });
    } catch (e) {
      const m = e.message || String(e);
      const msg = e instanceof SyntaxError ? "받은 내용이 JSON이 아닙니다"
        : e.name === "AbortError" ? "응답이 늦습니다(30초)" : /HTTP 404/.test(m) ? "gist를 찾을 수 없습니다(HTTP 404) — 주소를 확인하세요"
        : /Failed to fetch|NetworkError|network|UnknownHost|ConnectException|SocketTimeout|Load failed/i.test(m) ? "인터넷에 연결되지 않았거나 gist에 닿지 못했습니다" : m;
      mem = mem ? { ...mem, error: msg } : { bundle: null, fetchedAt: null, error: msg };
    }
    return { ...mem, configured: true };
  }

  // 지금 메모리에 있는 것(없으면 null) — 화면을 다시 그릴 때 깜빡이지 않게 바로 쓴다
  const peek = () => (mem && url() ? { ...mem, configured: true } : null);
  const fresh = () => !!mem && Date.now() - mem.fetchedAt < TTL;
  return { normalize, url, setUrl, load, peek, fresh, slim, MODULES, TTL };
})();
