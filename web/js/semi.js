// 반도체 탭 데이터 — 이 앱이 직접 모은다(Daily Market Radar 수집기를 옮긴 것: 맥 = scripts/semi, 폰 = js/engine/semi).
//  · 묶음 = { built_at, config: { settings, tickers }, data: { meta, snapshot, news, calendar, memory, cycle, … } }
//  · TR.api.get("/api/semi") → { bundle, fetched_at, running, error }. 맥 서버든 폰 엔진이든 없거나 30분 지났으면 뒤에서 새로 모으고
//    지금 있는 묶음을 바로 준다(running=true면 화면이 몇 초 뒤 다시 묻는다).
//  · 데이터 출처 키(FRED 등)는 맥 = 키체인, 폰 = 이 기기(IndexedDB)에만. 설정 화면에서 맥 → 폰으로 옮긴다.
TR.semi = (() => {
  const TTL = 30 * 60 * 1000;
  let mem = null;                                                  // { bundle, fetchedAt, running, error }

  const msg = (e) => {
    const m = e?.message || String(e);
    return /Failed to fetch|NetworkError|network|Load failed|AbortError/i.test(m) ? "서버(또는 인터넷)에 닿지 못했습니다" : m;
  };
  async function load(force = false) {
    try {
      const r = await TR.api.get(`/api/semi${force ? "?force=1" : ""}`);
      mem = { bundle: r.bundle || null, fetchedAt: r.fetched_at || null, running: !!r.running, error: r.error || null };
    } catch (e) {
      mem = { bundle: mem?.bundle || null, fetchedAt: mem?.fetchedAt || null, running: false, error: msg(e) };
    }
    return mem;
  }
  // 지금 메모리에 있는 것(없으면 null) — 화면을 다시 그릴 때 깜빡이지 않게 바로 쓴다
  const peek = () => mem;
  const fresh = () => !!mem?.bundle && !mem.running && !!mem.fetchedAt && Date.now() - mem.fetchedAt < TTL;
  const keys = {
    status: () => TR.api.get("/api/semi/keys"),
    save: (body) => TR.api.post("/api/semi/keys", body),            // 폰 앱: { text: "RADARKEYS1:…" } · { clear: true }
    exportText: () => TR.api.post("/api/semi/keys/export", {}),     // 이 맥에서만
  };
  return { load, peek, fresh, keys, TTL };
})();
