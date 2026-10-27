// 시세(반도체 탭 요약) — scripts/semi/snapshot.py와 1:1. config/semi/tickers.json의 id 기준, primary → fallback(fred · finnhub는 키가 있을 때만).
(function (G) {
  const TR = (G.TR = G.TR || {});
  const E = TR.semiEng, C = TR.core;
  const CHART_URL = (sym) => `https://query1.finance.yahoo.com/v8/finance/chart/${E.quote(sym)}?range=1y&interval=1d`;
  const FRED_URL = (sid, key) => `https://api.stlouisfed.org/fred/series/observations?series_id=${sid}&api_key=${key}&file_type=json&sort_order=desc&limit=30`;
  const FINNHUB_URL = (sym, key) => `https://finnhub.io/api/v1/quote?symbol=${E.quote(sym)}&token=${key}`;
  const HORIZONS = [["1w", 5], ["1m", 21], ["3m", 63]];
  const need = (o, k) => { if (o == null || !(k in o)) throw new Error(`없음: ${k}`); return o[k]; };

  function returns(dates, closes, price) {
    const bases = [];
    for (const [k, n] of HORIZONS) if (closes.length > n) bases.push([k, closes[closes.length - 1 - n]]);
    const year = dates.length ? dates[dates.length - 1].slice(0, 4) : null;
    const prior = year ? closes.filter((c, i) => dates[i].slice(0, 4) < year) : [];
    if (prior.length) bases.push(["ytd", prior[prior.length - 1]]);
    if (closes.length) bases.push(["1y", closes[0]]);
    const out = {};
    for (const [k, b] of bases) if (b) out[k] = [C.pyRound((price / b - 1) * 100, 2), C.pyRound(price - b, 6)];
    return out;
  }

  async function yahoo(ctx, sym) {
    const r = need(need(await ctx.net.json(CHART_URL(sym)), "chart"), "result")[0];
    const m = need(r, "meta"), off = m.gmtoffset ?? 0;
    const ts = r.timestamp ?? [], cl = need(need(r, "indicators"), "quote")[0].close;
    const pairs = [];
    for (let i = 0; i < Math.min(ts.length, cl.length); i++) if (cl[i] != null) pairs.push([new Date((ts[i] + off) * 1000).toISOString().slice(0, 10), cl[i]]);
    const dates = pairs.map((p) => p[0]), closes = pairs.map((p) => p[1]);
    const price = need(m, "regularMarketPrice");
    let pct = m.regularMarketChangePercent ?? null;
    if (pct == null) {
      const p0 = closes.length > 1 ? closes[closes.length - 2] : null;
      pct = p0 ? (price / p0 - 1) * 100 : null;
    }
    const prev = pct != null ? price / (1 + pct / 100) : null;
    const t = need(m, "regularMarketTime") * 1000;
    const weekly = [];
    for (let i = pairs.length - 1; i >= 0; i -= 5) weekly.unshift(pairs[i]);
    const last200 = closes.slice(-200);
    return {
      price, prev_close: prev, change: prev ? price - prev : null,
      change_pct: pct, spark: closes.slice(-22).map((c) => C.pyRound(c, 4)),
      ret: returns(dates, closes, price),
      ma200_gap: closes.length >= 200 ? C.pyRound((price / (C.sum(last200) / 200) - 1) * 100, 2) : null,
      hist: weekly.map(([d, c]) => [d, C.pyRound(c, 4)]),
      as_of: E.isoKST(t), trade_date: E.kstDate(t),
      high_52w: m.fiftyTwoWeekHigh ?? null, name: m.shortName ?? null,
    };
  }

  async function fred(ctx, sid) {
    const key = ctx.keys.FRED_API_KEY;
    if (!key) throw E.err("LookupError", "FRED_API_KEY 없음");
    const obs = need(await ctx.net.json(FRED_URL(sid, key)), "observations").filter((o) => o.value !== ".");
    const vals = [...obs].reverse().map((o) => { const v = Number(E.strip(o.value)); if (!isFinite(v) || E.strip(o.value) === "") throw new Error("값"); return v; });
    if (vals.length < 2) throw new Error("값 부족");
    const price = vals[vals.length - 1], prev = vals[vals.length - 2];
    return { price, prev_close: prev, change: price - prev, change_pct: (price / prev - 1) * 100,
      spark: vals, as_of: `${obs[0].date}T00:00:00+09:00`, trade_date: obs[0].date, high_52w: null, name: sid };
  }

  async function finnhub(ctx, sym) {
    const key = ctx.keys.FINNHUB_API_KEY;
    if (!key) throw E.err("LookupError", "FINNHUB_API_KEY 없음");
    const d = await ctx.net.json(FINNHUB_URL(sym, key));
    if (!d.c) throw E.err("RuntimeError", "빈 응답");
    const t = d.t ? d.t * 1000 : null;
    return { price: d.c, prev_close: d.pc ?? null, change: d.d ?? null, change_pct: d.dp ?? null, spark: [],
      as_of: t != null ? E.isoKST(t) : null, trade_date: t != null ? E.kstDate(t) : null, high_52w: null, name: sym };
  }

  const FETCHERS = { yfinance: yahoo, fred, finnhub };
  const r6 = (v) => (typeof v === "number" ? C.pyRound(v, 6) : v);

  async function one(ctx, tid, t) {
    const errors = [];
    for (const src of [t.primary, ...(t.fallback || [])]) {
      const sym = (t.sources || {})[src];
      if (!sym || !FETCHERS[src]) continue;
      try {
        const q = await FETCHERS[src](ctx, sym), o = { id: tid };
        for (const [k, v] of Object.entries(q)) o[k] = r6(v);
        o.source = src;
        return o;
      } catch (e) { errors.push(`${src}:${E.ename(e)}`); }
    }
    return { id: tid, price: null, change_pct: null, spark: [], error: errors.join(", ") || "소스 없음" };
  }

  E.mods.snapshot = async (ctx) => {
    const tickers = E.cfg("tickers").tickers || {};
    const items = await E.pool(Object.entries(tickers), 8, ([k, t]) => one(ctx, k, t));
    const ok = items.filter((i) => i.price != null).length, failed = items.filter((i) => i.price == null).map((i) => i.id);
    return ctx.envelope(items, ok === items.length ? "ok" : ok ? "partial" : "error", ["yahoo-chart"], failed.length ? `실패: ${failed.join(", ")}` : null);
  };
})(typeof window !== "undefined" ? window : globalThis);
