// 대만 공급망 월매출 — scripts/semi/twrev.py와 1:1. TWSE · TPEx 공개 API(최신 1개월) → store 'twrev_history'에 월별로 쌓는다. 단위 천 NT$.
(function (G) {
  const TR = (G.TR = G.TR || {});
  const E = TR.semiEng, C = TR.core;
  const URLS = { twse: "https://openapi.twse.com.tw/v1/opendata/t187ap05_L", tpex: "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O" };
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  const ym = (roc) => { roc = E.strip(roc); return `${parseInt(roc.slice(0, -2), 10) + 1911}-${roc.slice(-2)}`; };   // 민국 '11509' → '2026-09'
  function shift(s, months) {
    const [y, m] = s.split("-").map(Number), n = y * 12 + (m - 1) + months;
    return `${Math.floor(n / 12)}-${String((((n % 12) + 12) % 12) + 1).padStart(2, "0")}`;
  }
  function num(v) {
    if (v == null || typeof v === "boolean") return null;
    const s = E.strip(String(v).replace(/,/g, ""));
    return /^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(s) ? Number(s) : null;
  }
  const pct = (a, b) => (a != null && b ? C.pyRound((a / b - 1) * 100, 2) : null);
  const g = (r, k) => (r[k] == null ? null : r[k]);

  E.mods.twrev = async (ctx) => {
    const groups = (E.cfg("sales").twrev || {}).groups || [];
    const raw = {}, errors = [], warns = [];
    const markets = [...new Set(groups.flatMap((gr) => gr.companies.map((c) => c.market)))].sort();
    for (const market of markets) {
      try {
        const rows = await ctx.net.json(URLS[market]);
        if (!Array.isArray(rows)) throw new Error("목록 아님");
        const byCode = new Map();
        for (const r of rows) byCode.set(E.strip(r["公司代號"] || ""), r);
        raw[market] = byCode;
      } catch (e) { errors.push(`${market}:${E.ename(e)}`); }
    }
    const hist = (await ctx.store.get("twrev_history", {})) || {};
    const items = [];
    for (const gr of groups) {
      for (const c of gr.companies) {
        const r = own(raw, c.market) ? raw[c.market].get(c.code) : null;
        if (!r) { if (own(raw, c.market)) errors.push(`${c.code} 없음`); continue; }
        if (E.strip(r["公司名稱"] || "") !== c.name) { errors.push(`${c.code} 회사명 불일치(${r["公司名稱"] ?? "None"})`); continue; }
        if (typeof r["資料年月"] !== "string") throw new Error("資料年月");
        const m = ym(r["資料年月"]);
        const cur = num(g(r, "營業收入-當月營收")), prev = num(g(r, "營業收入-上月營收")), lastY = num(g(r, "營業收入-去年當月營收"));
        const h = (hist[c.code] = hist[c.code] || {});
        for (const [k, v] of [[m, cur], [shift(m, -1), prev], [shift(m, -12), lastY]]) if (v != null) h[k] = v;
        const mom = pct(cur, prev), yoy = pct(cur, lastY);
        const cumYoy = pct(num(g(r, "累計營業收入-當月累計營收")), num(g(r, "累計營業收入-去年累計營收")));
        for (const [mine, theirs, lab] of [[mom, g(r, "營業收入-上月比較增減(%)"), "MoM"], [yoy, g(r, "營業收入-去年同月增減(%)"), "YoY"]]) {
          const t = num(theirs);
          if (mine != null && t != null && Math.abs(mine - t) > 0.1) warns.push(`${c.ko} ${lab} 계산 ${E.pyStr(mine)} vs 공시 ${E.fmt(t, 2)}`);
        }
        const remark = E.cpSlice(E.strip(r["備註"] || "").replace(/^[-－ ]+|[-－ ]+$/g, ""), 0, 80);
        items.push({ code: c.code, name: c.name, ko: c.ko, group: gr.id, ym: m, rev: cur, mom, yoy, cum_yoy: cumYoy, remark: remark || null,
          history: Object.keys(h).sort().slice(-25).map((k) => [k, h[k]]) });
      }
    }
    await ctx.store.set("twrev_history", hist);
    const outGroups = [];
    for (const gr of groups) {
      const rows = items.filter((i) => i.group === gr.id);
      if (!rows.length) continue;
      const m = rows.map((i) => i.ym).reduce((a, b) => (b > a ? b : a));
      const hs = rows.filter((i) => i.ym === m).map((i) => hist[i.code]);
      const tot = C.sum(hs.map((h) => h[m]));
      const pm = shift(m, -1), py = shift(m, -12);
      const mom = hs.every((h) => own(h, pm)) ? pct(tot, C.sum(hs.map((h) => h[pm]))) : null;
      const yoy = hs.every((h) => own(h, py)) ? pct(tot, C.sum(hs.map((h) => h[py]))) : null;
      outGroups.push({ id: gr.id, label: gr.label, ym: m, rev: tot, mom, yoy, n: hs.length, of: gr.companies.length });
    }
    const latest = items.length ? items.map((i) => i.ym).reduce((a, b) => (b > a ? b : a)) : null;
    if (latest && latest < shift(ctx.today.slice(0, 7), -2)) warns.push(`기준월 ${latest} — 두 달 넘게 지남`);
    const status = items.length && !errors.length ? "ok" : items.length ? "partial" : "error";
    return ctx.envelope(items, status, ["twse", "tpex"], errors.join(", ") || null, { groups: outGroups, warnings: warns, unit: "천 대만달러" });
  };
})(typeof window !== "undefined" ? window : globalThis);
