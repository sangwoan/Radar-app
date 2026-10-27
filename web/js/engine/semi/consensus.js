// 실적 컨센서스(미국 상장 추적 종목) — scripts/semi/consensus.py와 1:1. Nasdaq 공개 API(Origin · Referer · UA가 있어야 답함).
// 발표 당일 전후 Nasdaq이 지우는 실적일은 store 'earnings'에 두고 발표 후 3일까지 쓴다.
(function (G) {
  const TR = (G.TR = G.TR || {});
  const E = TR.semiEng, C = TR.core;
  const BASE = "https://api.nasdaq.com/api";
  E.UA_BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36";
  E.NASDAQ_HEADERS = { Accept: "application/json", Origin: "https://www.nasdaq.com", Referer: "https://www.nasdaq.com/", "User-Agent": E.UA_BROWSER };
  const pad = (n) => String(n).padStart(2, "0");

  const get = async (ctx, p) => ((await ctx.net.json(BASE + p, E.NASDAQ_HEADERS)) || {}).data || {};
  function num(v) {
    if (v == null || typeof v === "boolean") return null;
    const s = E.strip(String(v).replace(/\$/g, "").replace(/,/g, ""));
    return /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(s) ? Number(s) : null;
  }
  E.nextDate = (text) => {
    const m = /report earnings on\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text);
    if (!m) return null;
    const y = +m[3], mo = +m[1], d = +m[2];
    if (!(y >= 1 && mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate())) return null;
    const day = `${String(y).padStart(4, "0")}-${pad(mo)}-${pad(d)}`, low = text.toLowerCase(), after = low.includes("after market close");
    return { date: day, kst_date: after ? C.addDays(day, 1) : day, confirmed: !low.includes("estimated"),
      timing: after ? "after" : low.includes("before market open") ? "before" : null };
  };
  const q = (r) => ({ fiscal_end: r.fiscalEnd ?? null, eps: num(r.consensusEPSForecast), high: num(r.highEPSForecast), low: num(r.lowEPSForecast),
    n: num(r.noOfEstimates), up: num(r.up), down: num(r.down) });

  async function one(ctx, tid, sym) {
    let text = "", rows = [], srows = [];
    try { text = (await get(ctx, `/analyst/${sym}/earnings-date`)).reportText || ""; } catch (e) { text = ""; }
    try { rows = ((await get(ctx, `/analyst/${sym}/earnings-forecast`)).quarterlyForecast || {}).rows || []; } catch (e) { rows = []; }
    try { srows = ((await get(ctx, `/company/${sym}/earnings-surprise`)).earningsSurpriseTable || {}).rows || []; } catch (e) { srows = []; }
    if (!(text || rows.length || srows.length)) return null;
    const quarter = rows.length ? q(rows[0]) : null;
    const yoy = /same quarter last year was \$?(-?\d+(?:\.\d+)?)/.exec(text);
    const yoyEps = yoy ? Number(yoy[1]) : null;
    let growth = null;
    if (quarter && quarter.eps != null && yoyEps && yoyEps > 0) growth = C.pyRound((quarter.eps / yoyEps - 1) * 100, 1);
    return { id: tid, symbol: sym, next: text ? E.nextDate(text) : null, quarter, next_quarter: rows.length > 1 ? q(rows[1]) : null,
      yoy_eps: yoyEps, yoy_growth: growth,
      surprises: srows.slice(0, 4).map((r) => ({ fiscal_end: r.fiscalQtrEnd ?? null, reported: r.dateReported ?? null, eps: num(r.eps),
        consensus: num(r.consensusForecast), surprise_pct: num(r.percentageSurprise) })) };
  }
  async function keepKnownDates(ctx, items) {
    const cache = (await ctx.store.get("earnings", {})) || {};
    const floor = C.addDays(ctx.today, -3);
    for (const i of items) {
      if (i.next) cache[i.symbol] = i.next;
      else if (((cache[i.symbol] || {}).kst_date || "") >= floor) i.next = { ...cache[i.symbol], cached: true };
    }
    await ctx.store.set("earnings", cache);
  }
  E.usEquities = () => Object.entries(E.cfg("tickers").tickers).filter(([, v]) => v.type === "equity" && v.currency === "USD");

  E.mods.consensus = async (ctx) => {
    const us = E.usEquities().map(([k, v]) => [k, v.sources.yfinance]);
    const items = (await E.pool(us, 4, async ([k, s]) => { try { return await one(ctx, k, s); } catch (e) { return null; } })).filter(Boolean);
    await keepKnownDates(ctx, items);
    const got = new Set(items.map((i) => i.id));
    const missing = us.map(([k]) => k).filter((k) => !got.has(k)).sort();
    const status = items.length && !missing.length ? "ok" : items.length ? "partial" : "error";
    return ctx.envelope(items, status, ["nasdaq/zacks"], missing.length ? `컨센서스 없음: ${missing.join(", ")}` : null);
  };
})(typeof window !== "undefined" ? window : globalThis);
