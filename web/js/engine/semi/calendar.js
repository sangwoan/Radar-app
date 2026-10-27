// 일정 — scripts/semi/calendar.py와 1:1. FOMC(다음 2회) · 미국 실적(컨센서스 결과, 없으면 Nasdaq) · 미 CPI · 고용(FRED 키) ·
// 월말 메모리 고정가 발표(추정) · 수기 일정(config/semi/events.json, 같은 id면 수기 우선).
(function (G) {
  const TR = (G.TR = G.TR || {});
  const E = TR.semiEng, C = TR.core;
  const EARNINGS_DAYS = 60;
  const EARNINGS_URL = (sym) => `https://api.nasdaq.com/api/analyst/${sym}/earnings-date`;
  const KEY_EARNINGS = ["NVDA", "MU", "TSM", "MSFT", "META", "GOOGL", "AMZN"];
  const FRED_RELEASES = [[10, "미 CPI 발표", "한국시간 21:30경"], [50, "미 고용보고서", "한국시간 21:30경"]];
  const FED_URL = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm";
  const MONTHS = Object.fromEntries(["January", "February", "March", "April", "May", "June", "July", "August",
    "September", "October", "November", "December"].map((m, i) => [m, i + 1]));
  const FOMC_RE = E.pyRe(String.raw`fomc-meeting__month[^>]*>\s*<strong>([^<]+)</strong>.*?fomc-meeting__date[^>]*>([^<]+)<`, "gs");
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const pad = (n) => String(n).padStart(2, "0");
  const mkDate = (y, m, d) => (m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate() ? `${String(y).padStart(4, "0")}-${pad(m)}-${pad(d)}` : null);
  const weekday = (d) => (new Date(C.ymd(d)).getUTCDay() + 6) % 7;          // date.weekday(): 월 0 … 일 6
  function lastWeekday(y, m) {
    let d = C.addDays(mkDate(y + (m === 12 ? 1 : 0), (m % 12) + 1, 1), -1);
    while (weekday(d) >= 5) d = C.addDays(d, -1);
    return d;
  }

  async function fomc(ctx) {
    const page = await ctx.net.get(FED_URL), today = ctx.today, ty = +today.slice(0, 4);
    const out = [];
    for (const year of [ty, ty + 1]) {
      const start = page.indexOf(`${year} FOMC Meetings`);
      if (start < 0) continue;
      const end = page.indexOf("FOMC Meetings", start + 20);
      const seg = page.slice(start, end > 0 ? end : page.length);
      for (const [, rawMonth, days] of seg.matchAll(FOMC_RE)) {
        const month = E.strip(rawMonth.split("/").pop());
        const nums = days.match(/[0-9]+/g) || [];
        if (!own(MONTHS, month) || !nums.length) continue;
        let decision = mkDate(year, MONTHS[month], +nums[nums.length - 1]);
        if (!decision) continue;
        if (days.includes("/") || (nums.length === 2 && +nums[1] < +nums[0])) {
          decision = mkDate(year, (MONTHS[month] % 12) + 1, +nums[nums.length - 1]);
          if (!decision) continue;
        }
        const kst = C.addDays(decision, 1);
        if (kst < today) continue;
        out.push({ id: `fomc-${decision}`, date: kst, date_label: null, title: "FOMC 금리 결정" + (days.includes("*") ? " · 경제전망" : ""),
          category: "macro", importance: 3, note: "한국시간 새벽 발표", source: "federalreserve.gov" });
      }
    }
    return out;
  }
  function memoryRelease(today) {
    const y = +today.slice(0, 4), m = +today.slice(5, 7);
    let last = lastWeekday(y, m);
    if (last < today) last = m === 12 ? lastWeekday(y + 1, 1) : lastWeekday(y, m + 1);
    return { id: `mem-contract-${last.slice(0, 7)}`, date: last, date_label: null, title: `${+last.slice(5, 7)}월 D램·낸드 고정거래가 발표`,
      category: "semis", importance: 2, note: "TrendForce · 날짜 추정", source: "auto" };
  }
  const note = (n) => (n.confirmed ? "확정" : "추정일(Zacks)") + (n.timing === "after" ? " · 장 마감 후" : n.timing === "before" ? " · 장 시작 전" : "");
  function earnItem(ctx, tid, display, sym, n) {
    const kst = n.kst_date;
    if (typeof kst !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(kst)) throw new Error("kst_date");
    if (!(ctx.today <= kst && kst <= C.addDays(ctx.today, EARNINGS_DAYS))) return null;
    return { id: `earn-${tid}-${n.date}`, date: kst, date_label: null, sym: sym ?? null, title: `${display} 실적 발표`, category: "earnings",
      importance: KEY_EARNINGS.includes(tid) ? 3 : 2, note: note(n), source: "nasdaq" };
  }
  async function earnings(ctx) {
    const rows = await E.pool(E.usEquities(), 6, async ([tid, t]) => {
      let text;
      try { text = (((await ctx.net.json(EARNINGS_URL(t.sources.yfinance), E.NASDAQ_HEADERS)) || {}).data || {}).reportText || ""; } catch (e) { return null; }
      const n = E.nextDate(text);
      return n ? earnItem(ctx, tid, t.display, t.sources.yfinance, n) : null;
    });
    return rows.filter(Boolean);
  }
  function earningsFromConsensus(ctx, cons) {
    const T = E.cfg("tickers").tickers, out = [];
    for (const c of cons.items || []) {
      const e = c.next ? earnItem(ctx, c.id, (T[c.id] || {}).display ?? c.id, c.symbol, c.next) : null;
      if (e) out.push(e);
    }
    return out;
  }
  async function fredReleases(ctx) {
    const key = ctx.keys.FRED_API_KEY;
    if (!key) return [];
    const start = C.addDays(ctx.today, -1), out = [];
    for (const [rid, title, nt] of FRED_RELEASES) {
      const url = `https://api.stlouisfed.org/fred/release/dates?release_id=${rid}&api_key=${key}&file_type=json`
        + `&include_release_dates_with_no_data=true&realtime_start=${start}&sort_order=asc&limit=3`;
      for (const r of (await ctx.net.json(url)).release_dates || []) {
        if (r.date >= ctx.today) { out.push({ id: `fred-${rid}-${r.date}`, date: r.date, date_label: null, title, category: "macro", importance: 3, note: nt, source: "fred" }); break; }
      }
    }
    return out;
  }

  E.mods.calendar = async (ctx) => {
    let items = [];
    const errors = [];
    try {
      const cons = ctx.results.consensus;
      items = items.concat(cons && (cons.items || []).length ? earningsFromConsensus(ctx, cons) : await earnings(ctx));
    } catch (e) { errors.push(`실적:${E.ename(e)}`); }
    try { items = items.concat(await fredReleases(ctx)); } catch (e) { errors.push(`FRED:${E.ename(e)}`); }
    try { items = items.concat((await fomc(ctx)).slice(0, 2)); } catch (e) { errors.push(`FOMC:${E.ename(e)}`); }
    items.push(memoryRelease(ctx.today));
    items = items.concat((E.cfg("events").items || []).filter((e) => (e.date || "") >= ctx.today).map((e) => ({ ...e, source: "manual" })));
    const uniq = new Map();
    for (const e of items) uniq.set(e.id, e);                                     // 같은 id면 나중 것(수기)이 덮어씀
    items = C.sortBy([...uniq.values()], (e) => [e.date]);
    return ctx.envelope(items, errors.length ? "partial" : "ok", ["federalreserve.gov", "nasdaq", "fred", "auto", "manual"], errors.join(", ") || null);
  };
})(typeof window !== "undefined" ? window : globalThis);
