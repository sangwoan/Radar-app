// 폰 앱의 반도체 탭 — scripts/semi/service.py와 같은 응답({ ok, bundle, fetched_at, running, error }).
// 묶음은 IndexedDB(semi:bundle), 수집기 기록은 semi:s:<이름>, 데이터 출처 키는 semi:keys(이 기기에만). 없거나 30분 지났으면 뒤에서 새로 모은다.
(function (G) {
  const TR = (G.TR = G.TR || {});
  const E = TR.semiEng;
  const TTL = 30 * 60 * 1000, LOCK_MS = 10 * 60 * 1000;
  const NAMES = ["FRED_API_KEY", "FINNHUB_API_KEY", "EIA_API_KEY", "DART_API_KEY"], PREFIX = "RADARKEYS1:";
  const dbStore = { get: (k, d = null) => TR.db.kv("semi:s:" + k, d), set: (k, v) => TR.db.setKv("semi:s:" + k, v) };
  let running = null, lastError = null;

  async function collect() {
    if (!(await TR.db.lock("semi", LOCK_MS))) return;               // 다른 웹뷰(앞 화면 · 백그라운드)가 모으는 중
    try {
      await E.loadCfg();
      const keys = (await TR.db.kv("semi:keys")) || {};
      const bundle = await E.run({ net: E.makeNet("live"), now: Date.now(), store: dbStore, keys });
      await TR.db.setKv("semi:bundle", { bundle, at: Date.now() });
      lastError = null;
    } catch (e) {
      lastError = String(e && e.message || e).slice(0, 200);
    } finally { await TR.db.unlock("semi"); }
  }
  function start() {
    if (!running) running = collect().finally(() => { running = null; });
    return running;
  }
  async function get(force = false) {
    const c = await TR.db.kv("semi:bundle");
    if (force || !c || Date.now() - c.at > TTL) start();
    return { ok: true, bundle: c ? c.bundle : null, fetched_at: c ? c.at : null, running: !!running, error: lastError };
  }

  // ---------- 키(맥 설정 화면의 RADARKEYS1:… 글을 붙여 넣거나 하나씩) ----------
  const CODES = { F: "FRED_API_KEY", N: "FINNHUB_API_KEY", E: "EIA_API_KEY", D: "DART_API_KEY" };
  function decode(text) {                                          // RADARKEYS1:F=…;N=… (scripts/semi/keys.py export와 짝)
    const t = String(text || "").replace(/\s+/g, "");
    if (!t.startsWith(PREFIX)) throw new Error("맥 Radar 설정 화면의 'RADARKEYS1:…' 글을 통째로 붙여 넣어 주세요");
    const o = {};
    for (const part of t.slice(PREFIX.length).split(";").filter(Boolean)) {
      const i = part.indexOf("=");
      if (i < 1 || !CODES[part.slice(0, i)]) throw new Error("글이 잘렸거나 형식이 다릅니다");
      o[CODES[part.slice(0, i)]] = part.slice(i + 1);
    }
    return o;
  }
  const clean = (o) => {
    const out = {};
    for (const n of NAMES) if (typeof o[n] === "string" && /^[A-Za-z0-9_\-.]{8,128}$/.test(o[n].trim())) out[n] = o[n].trim();
    return out;
  };
  async function keyStatus() {
    const k = (await TR.db.kv("semi:keys")) || {};
    return { ok: true, names: Object.fromEntries(NAMES.map((n) => [n, !!k[n]])), sources: Object.fromEntries(NAMES.filter((n) => k[n]).map((n) => [n, "device"])) };
  }
  async function saveKeys(body) {
    if (body.clear) await TR.db.setKv("semi:keys", {});
    else {
      const add = clean(body.text ? decode(body.text) : body.keys || {});
      if (!Object.keys(add).length) throw new Error("넣을 키가 없습니다");
      await TR.db.setKv("semi:keys", { ...((await TR.db.kv("semi:keys")) || {}), ...add });
    }
    start();                                                         // 키가 바뀌었으니 새로 모은다
    return keyStatus();
  }

  E.service = { get, start, keyStatus, saveKeys, decode, NAMES, TTL };
})(typeof window !== "undefined" ? window : globalThis);
