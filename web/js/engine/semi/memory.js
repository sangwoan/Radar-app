// 메모리 가격 — scripts/semi/memory.py와 1:1. 고정가(JSON) · 현물가(HTML 표) · 기록(store memory_history) · 가격판 · 현물 비율 · 수기 가격.
(function (G) {
  const TR = (G.TR = G.TR || {});
  const E = TR.semiEng, C = TR.core;
  const BASE = "https://www.dramexchange.com";
  const HIST_KEEP = 400;
  const MONTHS = Object.fromEntries(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((m, i) => [m, i + 1]));
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const sorted = (xs) => [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const keysSorted = (o) => sorted(Object.keys(o));
  const pad = (n) => String(n).padStart(2, "0");

  async function contracts(ctx) {
    const out = {};
    for (const src of ["NationalDramContract", "NationalFlashContract"]) {
      for (const r of JSON.parse(await ctx.net.get(`${BASE}/Home/HomePrice?Source=${src}`))) {
        const day = r.show_day;
        if (typeof day !== "string") throw new Error("show_day");
        out[E.squash(r.show_name)] = { price: E.pyFloat(r.show_avg), mom_pct: E.pyFloat(r.show_avg_change), as_of: day.slice(0, 10), month: day.slice(0, 7) };
      }
    }
    return out;
  }

  const cells = (row) => [...row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((m) => E.squash(E.unescape(m[1].replace(/<[^>]+>/g, " "))));
  function num(s) {
    s = E.strip(s);
    return /^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)$/.test(s) ? Number(s) : null;
  }

  async function spots(ctx) {
    const page = await ctx.net.get(BASE + "/");
    const out = {};
    let lastUpdate = null;
    for (const [table] of page.matchAll(/<table[\s\S]*?<\/table>/g)) {
      const rows = [...table.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) => cells(m[0]));
      for (const cs of rows) {
        const m = /Last Update:\s*([A-Za-z]{3})\.?\s*(\d{1,2})\s+(\d{4})/.exec(cs.join(" "));
        if (m && own(MONTHS, m[1])) lastUpdate = `${m[3]}-${pad(MONTHS[m[1]])}-${pad(+m[2])}`;
      }
      const header = rows.length ? rows[0] : [];
      const avgI = header.indexOf("Session Average");
      if (avgI < 0) continue;
      const chgI = avgI + 1;
      for (const cs of rows.slice(1)) {
        if (cs.length > chgI && cs[avgI]) {
          const price = num(cs[avgI]), chg = num(E.strip(cs[chgI].replace(/%/g, "")) || "0");
          if (price == null || chg == null) continue;
          out[cs[0]] = { price, change_pct: chg, as_of: lastUpdate, weekly: header.length > 1 && header[1].startsWith("Weekly") };
        }
      }
    }
    return out;
  }

  function prevMonth(ym) {
    const [y, m] = ym.split("-").map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
  }
  async function loadHistory(ctx) {
    const h = (await ctx.store.get("memory_history", {})) || {};
    if (!h.contract) h.contract = {};
    if (!h.spot) h.spot = {};
    return h;
  }
  async function updateHistory(ctx, cons, sps) {
    const h = await loadHistory(ctx);
    for (const [name, s] of Object.entries(sps)) if (s.as_of) (h.spot[name] = h.spot[name] || {})[s.as_of] = s.price;
    for (const [name, c] of Object.entries(cons)) {
      const series = (h.contract[name] = h.contract[name] || {});
      series[c.month] = c.price;
      const pm = prevMonth(c.month);                         // 전월 값이 없으면 MoM으로 역산해 1개 보충
      if (!own(series, pm) && c.mom_pct != null && c.mom_pct !== -100) series[pm] = C.pyRound(c.price / (1 + c.mom_pct / 100), 3);
    }
    await ctx.store.set("memory_history", h);
    return h;
  }

  function valueBefore(series, last, back, tol) {
    const target = C.addDays(last, -back);
    const cands = Object.keys(series).filter((d) => d <= target);
    if (!cands.length) return null;
    const d = cands.reduce((a, b) => (b > a ? b : a));
    return C.daysBetween(d, target) <= tol ? [d, series[d]] : null;
  }
  const pct = (now, before) => (before ? C.pyRound((now / before - 1) * 100, 2) : null);

  function board(ctx, sps, h) {
    const out = [], today = ctx.today;
    for (const g of E.cfg("memory").board || []) {
      const rows = [];
      for (const r of g.rows) {
        const row = { label: r.label, kind: r.kind ?? null, spot: null, contract: null, premium: null };
        const series = h.spot[r.spot || ""] || {};
        if (Object.keys(series).length) {
          const dates = keysSorted(series), last = dates[dates.length - 1];
          const fetched = sps[r.spot];
          let weekly;
          if (fetched) weekly = fetched.weekly;
          else {
            const recent = dates.slice(-7);
            const gaps = recent.slice(1).map((b, i) => C.daysBetween(recent[i], b)).sort((a, b) => a - b);
            weekly = gaps.length > 0 && gaps[gaps.length >> 1] >= 5;
          }
          const w1 = weekly ? null : valueBefore(series, last, 7, 3), m1 = valueBefore(series, last, 28, 7);
          row.spot = { name: r.spot, price: series[last], as_of: last, cadence: weekly ? "주간" : "일간",
            chg: fetched && fetched.as_of === last ? fetched.change_pct : null,
            w1: w1 ? pct(series[last], w1[1]) : null, m1: m1 ? pct(series[last], m1[1]) : null, m1_from: m1 ? m1[0] : null,
            stale: C.daysBetween(last, today) > (weekly ? 10 : 5) };
        }
        const cs = h.contract[r.contract || ""] || {};
        if (Object.keys(cs).length) {
          const months = keysSorted(cs), cur = months[months.length - 1];
          const prev = months.length > 1 && months[months.length - 2] === prevMonth(cur) ? months[months.length - 2] : null;
          row.contract = { name: r.contract, month: cur, price: cs[cur], mom: prev ? pct(cs[cur], cs[prev]) : null };
        }
        if (r.premium && row.spot && row.contract) row.premium = pct(row.spot.price, row.contract.price);
        rows.push(row);
      }
      out.push({ seg: g.seg, rows });
    }
    return out;
  }

  function ratios(h) {
    const out = [];
    for (const r of E.cfg("memory").ratios || []) {
      const a = h.spot[r.a] || {}, b = h.spot[r.b] || {};
      const common = keysSorted(a).filter((d) => own(b, d));
      if (!common.length) continue;
      const series = common.filter((d) => b[d]).map((d) => [d, C.pyRound(a[d] / b[d], 4)]);
      if (!series.length) continue;
      const [lastD, lastV] = series[series.length - 1];
      const m1 = valueBefore(Object.fromEntries(series), lastD, 28, 7);
      out.push({ id: r.id, label: r.label, note: r.note ?? null, value: lastV, as_of: lastD,
        a: { name: r.a, price: a[lastD] }, b: { name: r.b, price: b[lastD] },
        m1: m1 ? m1[1] : null, m1_from: m1 ? m1[0] : null, series: series.slice(-90) });
    }
    return out;
  }

  E.mods.memory = async (ctx) => {
    const products = E.cfg("memory").products || [];
    const manual = Object.fromEntries((E.cfg("memory_prices").items || []).map((m) => [m.product, m]));
    const errors = [];
    let cons = {}, sps = {};
    try { cons = await contracts(ctx); } catch (e) { cons = {}; errors.push(`contract:${E.ename(e)}`); }
    try { sps = await spots(ctx); } catch (e) { sps = {}; errors.push(`spot:${E.ename(e)}`); }
    const h = Object.keys(cons).length || Object.keys(sps).length ? await updateHistory(ctx, cons, sps) : await loadHistory(ctx);
    const items = [];
    for (const p of products) {
      const c = cons[p.contract_name || ""];
      const s = sps[p.spot_name || ""] || sps[p.wafer_name || ""];
      const spotName = sps[p.spot_name || ""] ? p.spot_name : p.wafer_name ?? null;
      const cser = h.contract[p.contract_name || ""] || {};
      const series = keysSorted(cser).map((k) => ({ month: k, price: cser[k] }));
      const latest = c ? { month: c.month, price: c.price, mom_pct: C.pyRound(c.mom_pct, 2), as_of: c.as_of } : null;
      const item = { product: p.product, label: p.label, unit: "USD", source: "DRAMeXchange", latest,
        spot: s ? { name: spotName, price: s.price, change_pct: s.change_pct, as_of: s.as_of } : null, series, quarterly: [] };
      const m = manual[p.product];
      if (m) {
        const ms = C.sortBy(m.series || [], (r) => [r.month]);
        if (ms.length && (!latest || ms[ms.length - 1].month > latest.month)) {
          const lastM = ms[ms.length - 1];
          const prev = ms.length > 1 ? ms[ms.length - 2].price : latest ? latest.price : null;
          item.latest = { month: lastM.month, price: lastM.price, as_of: lastM.month, mom_pct: prev ? C.pyRound((lastM.price / prev - 1) * 100, 2) : null };
          item.source = "수기(TrendForce)";
          const merged = {};
          for (const r of [...series, ...ms]) merged[r.month] = r.price;
          item.series = keysSorted(merged).map((k) => ({ month: k, price: merged[k] }));
        }
        item.quarterly = m.quarterly || [];
      }
      if (item.latest || item.spot) items.push(item);
    }
    const status = items.length && !errors.length ? "ok" : items.length ? "partial" : "error";
    // 현물 추이: 추세 품목 + 가격판 품목 전부(화면에서 품목을 누르면 차트) — 품목마다 최근 HIST_KEEP개
    const names = [...new Set([...(E.cfg("memory").trend_spot || []), ...(E.cfg("memory").board || []).flatMap((g) => g.rows.filter((r) => r.spot).map((r) => r.spot))])];
    const spotHistory = {};
    for (const n of names) if (h.spot[n] && Object.keys(h.spot[n]).length) spotHistory[n] = keysSorted(h.spot[n]).slice(-HIST_KEEP).map((d) => [d, h.spot[n][d]]);
    const contractHistory = {};
    for (const [n, v] of Object.entries(h.contract)) contractHistory[n] = keysSorted(v).map((k) => [k, v[k]]);
    return ctx.envelope(items, status, ["dramexchange", "manual"], errors.join(", ") || null,
      { spot_history: spotHistory, contract_history: contractHistory, board: board(ctx, sps, h), ratios: ratios(h) });
  };
})(typeof window !== "undefined" ? window : globalThis);
