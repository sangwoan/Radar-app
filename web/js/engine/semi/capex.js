// 빅테크 설비투자 — scripts/semi/capex.py와 1:1. SEC EDGAR XBRL companyconcept(연락처 User-Agent 필수). 누적값 차분으로 분기값.
(function (G) {
  const TR = (G.TR = G.TR || {});
  const E = TR.semiEng, C = TR.core;
  const URL = (cik, concept) => `https://data.sec.gov/api/xbrl/companyconcept/CIK${String(cik).padStart(10, "0")}/us-gaap/${concept}.json`;
  const FORMS = ["10-Q", "10-K", "10-Q/A", "10-K/A"];

  // 공시 사실 → [Map(분기말 → 값), 경고]. 같은 (시작, 끝)은 가장 늦게 제출된 값.
  function quarters(facts) {
    const latest = new Map();
    for (const f of C.sortBy(facts, (f) => [f.filed ?? ""])) {
      if (!("start" in f) || !("end" in f) || !("val" in f)) throw new Error("사실 형식");
      latest.set(`${f.start}|${f.end}`, [f.start, f.end, f.val]);
    }
    const direct = new Map(), derived = new Map(), warns = [], byStart = new Map();
    for (const [s, e, v] of latest.values()) { if (!byStart.has(s)) byStart.set(s, []); byStart.get(s).push([e, v]); }
    for (const [s, rows] of byStart) {
      const sortedRows = C.sortBy(rows, (r) => [r[0]]);
      let prevEnd = s, prevVal = null;
      for (const [e, v] of sortedRows) {
        const span = C.daysBetween(prevEnd, e);
        if (prevVal == null && C.daysBetween(s, e) >= 80 && C.daysBetween(s, e) <= 100) direct.set(e, v);
        else if (prevVal != null && span >= 80 && span <= 100) derived.set(e, v - prevVal);
        prevEnd = e; prevVal = v;
      }
    }
    const out = new Map(derived);
    for (const [e, v] of direct) {
      if (derived.has(e) && Math.abs(derived.get(e) - v) > Math.abs(v) * 0.01) warns.push(`${e} 직접 ${E.fmt(v / 1e9, 1)} vs 계산 ${E.fmt(derived.get(e) / 1e9, 1)}`);
      out.set(e, v);
    }
    for (const e of [...out].filter(([, v]) => v <= 0).map(([e]) => e)) { warns.push(`${e} 값 ${out.get(e)} (0 이하 제외)`); out.delete(e); }
    return [out, warns];
  }
  const maxKey = (m) => [...m.keys()].reduce((a, b) => (b > a ? b : a));

  async function one(ctx, c, ua) {
    let best = null;
    for (const concept of c.concepts) {
      let d;
      try { d = await ctx.net.json(URL(c.cik, concept), { "User-Agent": ua }); } catch (e) { continue; }
      const facts = (((d || {}).units || {}).USD || []).filter((f) => FORMS.includes(f.form));
      const [q, warns] = quarters(facts);
      if (q.size && (best == null || maxKey(q) > best.latest_end)) {
        best = { concept, q, warns, latest_end: maxKey(q), filed: facts.map((f) => f.filed ?? "").reduce((a, b) => (b > a ? b : a), "") };
      }
    }
    if (!best) throw E.err("RuntimeError", `${c.id} 데이터 없음`);
    const qs = [...best.q].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).slice(-16);
    return { id: c.id, name: c.name, concept: best.concept, note: c.note ?? null, quarters: qs.map(([e, v]) => [e, C.pyRound(v)]),
      latest_end: best.latest_end, filed: best.filed, warnings: best.warns };
  }

  E.mods.capex = async (ctx) => {
    const cc = E.cfg("sales").capex || {};
    const ua = cc.user_agent || "DailyMarketRadar/1.0";
    const items = [], errors = [];
    const res = await E.pool(cc.companies || [], 3, async (c) => { try { return [await one(ctx, c, ua), null]; } catch (e) { return [null, `${c.id}:${E.ename(e)}`]; } });
    for (const [item, err] of res) { if (item) items.push(item); if (err) errors.push(err); }
    const big4 = cc.big4 || [];
    const byId = {};
    for (const i of items) { byId[i.id] = {}; for (const [e, v] of i.quarters) byId[i.id][e.slice(0, 7)] = v; }
    const totals = [];
    if (big4.length && big4.every((b) => b in byId)) {
      const months = Object.keys(byId[big4[0]]).filter((m) => big4.every((b) => m in byId[b])).sort();
      for (const m of months) {
        const total = C.sum(big4.map((b) => byId[b][m]));
        const prev = `${+m.slice(0, 4) - 1}-${m.slice(5)}`;
        const prevTotal = big4.every((b) => prev in byId[b]) ? C.sum(big4.map((b) => byId[b][prev])) : null;
        totals.push({ end: m, total, yoy: prevTotal ? C.pyRound((total / prevTotal - 1) * 100, 1) : null });
      }
    }
    const status = items.length && !errors.length ? "ok" : items.length ? "partial" : "error";
    return ctx.envelope(items, status, ["sec-edgar"], errors.join(", ") || null, { big4: totals.slice(-8), big4_ids: big4 });
  };
})(typeof window !== "undefined" ? window : globalThis);
