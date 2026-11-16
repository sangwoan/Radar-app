// 폰 앱의 반도체 탭 — scripts/semi/service.py와 같은 응답({ ok, bundle, fetched_at, running, error, progress }).
// 묶음은 IndexedDB(semi:bundle), 수집기 기록은 semi:s:<이름>, 데이터 출처 키는 semi:keys(이 기기에만). 없거나 30분 지났으면 뒤에서 새로 모은다.
(function (G) {
  const TR = (G.TR = G.TR || {});
  const E = TR.semiEng;
  const TTL = 30 * 60 * 1000, LOCK_MS = 90 * 1000, RENEW_MS = 30 * 1000, DEADLINE_MS = 8 * 60 * 1000;
  const NAMES = ["FRED_API_KEY", "FINNHUB_API_KEY", "EIA_API_KEY", "DART_API_KEY"], PREFIX = "RADARKEYS1:";
  const dbStore = { get: (k, d = null) => TR.db.kv("semi:s:" + k, d), set: (k, v) => TR.db.setKv("semi:s:" + k, v) };
  let running = null, lastError = null, progress = null, waiting = false;

  // 잠금은 짧게 잡고(90초) 도는 동안 30초마다 늘린다 — 수집 중에 앱이 죽어도 금방 풀려 '새로 받기'가 다시 된다.
  // 모듈이 끝날 때마다 묶음을 써서 끝난 것부터 화면에 보이고, 전체 한도(8분)를 넘기면 그만 기다린다.
  async function collect() {
    if (!(await TR.db.lock("semi", LOCK_MS))) { waiting = true; return; }   // 다른 웹뷰가 모으는 중(또는 죽은 실행의 잠금) → 풀리면 get()이 다시 시작
    waiting = false;
    const renew = setInterval(() => { TR.db.renew("semi", LOCK_MS).catch(() => {}); }, RENEW_MS);
    let over = false, timer = null;
    try {
      await E.loadCfg();
      const keys = (await TR.db.kv("semi:keys")) || {};
      progress = [0, E.MODULES.length];
      const work = E.run({ net: E.makeNet("live"), now: Date.now(), store: dbStore, keys,
        onModule: async (bundle, done, total) => { if (over) return; progress = [done, total]; await TR.db.setKv("semi:bundle", { bundle, at: Date.now() }); } });
      const bundle = await Promise.race([work, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("너무 오래 걸려 멈췄습니다 — 받은 데까지만 보여 줍니다")), DEADLINE_MS); })]);
      const mods = Object.values(bundle.data.meta.modules);
      lastError = mods.length && mods.every((m) => m.status === "error") ? "모든 출처에 닿지 못했습니다 — 인터넷 연결을 확인하세요" : null;
    } catch (e) {
      over = true;
      lastError = String(e && e.message || e).slice(0, 200);
    } finally { clearTimeout(timer); clearInterval(renew); progress = null; await TR.db.unlock("semi").catch(() => {}); }
  }
  function start() {
    if (!running) running = collect().catch((e) => { lastError = String(e && e.message || e).slice(0, 200); }).finally(() => { running = null; });
    return running;
  }
  async function get(force = false) {
    const c = await TR.db.kv("semi:bundle");
    if (force || waiting || !c || Date.now() - c.at > TTL) start();
    return { ok: true, bundle: c ? c.bundle : null, fetched_at: c ? c.at : null, running: !!running || waiting, error: lastError, progress };
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
