// 반도체 수집 공통(폰 엔진) — scripts/semi/base.py와 1:1. 네트워크(실제 · 재생), 기록 저장소, envelope, 날짜.
// 수집기: TR.semiEng.mods[name] = async (ctx) => envelope. ctx = { net, now(ms), store, results, keys }. 실행 순서는 run.js.
(function (G) {
  const TR = (G.TR = G.TR || {});
  const E = (TR.semiEng = TR.semiEng || { mods: {} });
  const SCHEMA_VERSION = 1;

  class NetError extends Error {
    constructor(status, message) { super(message || `HTTP ${status}`); this.status = status; }
  }
  // mode: live(TR.http) · replay(녹화본: { url: {status, body|b64} })
  function makeNet(mode = "live", tape = {}) {
    const calls = [];
    async function get(url, headers = null) {
      calls.push(url);
      if (mode === "replay") {
        const t = tape[url];
        if (!t) throw new NetError(0, `녹화 없음: ${url.slice(0, 80)}`);
        if (t.status !== 200) throw new NetError(t.status);
        return "b64" in t ? Buffer.from(t.b64, "base64").toString("utf8") : t.body;
      }
      try { return await TR.http.text(url, 20000, headers); }
      catch (e) { const m = /HTTP (\d+)/.exec(e.message || ""); throw new NetError(m ? +m[1] : 0, e.message); }
    }
    return { mode, tape, calls, get, json: async (url, headers) => JSON.parse(await get(url, headers)) };
  }

  // 오류 이름(envelope의 error 글자) — base.py ename()과 같게: 일부러 낸 오류(err)만 이름, 나머지는 ParseError
  const err = (pyName, message) => Object.assign(new Error(message || pyName), { pyName });
  const ename = (e) => (e instanceof NetError ? "NetError" : e && e.pyName ? e.pyName : "ParseError");
  // sorted(arr, key=key, reverse=True) — 같은 키끼리는 원래 순서 유지(파이썬과 같게)
  const sortDesc = (arr, key) => arr.map((v, i) => [key(v), i, v]).sort((p, q) => TR.core.cmpTuple(q[0], p[0]) || p[1] - q[1]).map((t) => t[2]);
  // ThreadPoolExecutor.map: 순서를 지키며 동시에 n개까지
  async function pool(items, n, fn) {
    const out = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
    }));
    return out;
  }

  // 설정(config/semi/*.json): 앱 = 같은 출처에서 받기, 노드 = 시험이 E.cfgData를 채운다
  E.cfgData = E.cfgData || {};
  const cfg = (name) => E.cfgData[name] || {};
  const CFG_NAMES = ["settings", "tickers", "memory", "feeds", "keywords", "company_watch", "sales", "events", "memory_prices"];
  async function loadCfg(base = "./config/semi/") {
    await Promise.all(CFG_NAMES.filter((n) => !E.cfgData[n]).map(async (n) => {
      const r = await fetch(`${base}${n}.json`, { cache: "no-store" });
      if (r.ok) E.cfgData[n] = await r.json();
    }));
  }

  const memStore = (init = {}) => {
    const d = JSON.parse(JSON.stringify(init));
    return { d, get: async (k, def = null) => (k in d ? JSON.parse(JSON.stringify(d[k])) : def), set: async (k, v) => { d[k] = JSON.parse(JSON.stringify(v)); } };
  };

  // 날짜: now는 epoch ms. KST 날짜 · ISO(+09:00, 초 단위) — 파이썬 now.isoformat(timespec="seconds")와 같은 글자
  const DAY = 864e5;
  const kstDate = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
  const isoKST = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 19) + "+09:00";

  function makeCtx({ net, now, store, results = {}, keys = {} }) {
    return {
      net, now, store, results, keys,
      get today() { return kstDate(now); },
      iso: (ms) => isoKST(ms ?? now),
      envelope: (items, status = "ok", sources = [], error = null, extra = {}) =>
        ({ schema_version: SCHEMA_VERSION, generated_at: isoKST(now), status, sources: sources || [], error, items, ...extra }),
    };
  }

  Object.assign(E, { err, ename, pool, sortDesc, NetError, makeNet, cfg, loadCfg, memStore, makeCtx, kstDate, isoKST, DAY, CFG_NAMES });
})(typeof window !== "undefined" ? window : globalThis);
