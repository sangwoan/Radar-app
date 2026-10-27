// 오늘의 브리프(규칙 기반 3줄) — scripts/semi/brief.py와 1:1. 숫자만 쓰고 해석은 하지 않는다.
(function (G) {
  const TR = (G.TR = G.TR || {});
  const E = TR.semiEng, C = TR.core;
  const pct = (v) => (v != null ? `${E.fmt(v, 2, true)}%` : "—");

  E.mods.brief = async (ctx) => {
    const snap = ctx.results.snapshot || {}, news = ctx.results.news || {};
    if (!Object.keys(snap).length || !["ok", "partial"].includes(snap.status)) return ctx.envelope([], "empty");
    const tickers = E.cfg("tickers"), T = tickers.tickers;
    const names = Object.fromEntries(Object.entries(T).map(([k, v]) => [k, v.display]));
    const q = {};
    for (const i of snap.items) if (i.change_pct != null) q[i.id] = i;
    const groupOf = {};
    for (const g of tickers.groups) for (const tid of g.tickers) groupOf[tid] = g;
    const lines = [];
    // 1) 가장 크게 움직인 주식
    const movers = C.sortBy(Object.values(q).filter((i) => T[i.id].type === "equity"), (i) => [-Math.abs(i.change_pct)]);
    if (movers.length) {
      const m = movers[0], g = groupOf[m.id] || {};
      const peers = (g.tickers || []).filter((t) => t in q && t !== m.id).map((t) => q[t].change_pct);
      const peer = peers.length ? ` (${g.label} 평균 ${pct(C.sum(peers) / peers.length)})` : "";
      const second = movers.slice(1, 3).map((i) => `${names[i.id]} ${pct(i.change_pct)}`).join(", ");
      lines.push({ headline: `${names[m.id]} ${pct(m.change_pct)}`, detail: `추적 종목 중 최대 변동${peer} · 그다음 ${second}`, tags: [g.id ?? ""] });
    }
    // 2) 반도체 · 메모리
    const sox = q.SOX;
    const mem = ["SKHYNIX", "SAMSUNG", "MU"].filter((t) => t in q).map((t) => `${names[t]} ${pct(q[t].change_pct)}`);
    if (sox || mem.length) lines.push({ headline: `반도체 지수 ${sox ? pct(sox.change_pct) : "—"}`, detail: "메모리: " + mem.join(", "), tags: ["semis"] });
    // 3) 매크로
    const parts = [];
    if ("VIX" in q) { const v = q.VIX.price; parts.push(`VIX ${E.fmt(v, 1)}(${v >= 30 ? "공포" : v >= 20 ? "경계" : "안정"})`); }
    if ("US10Y" in q) {
      const bp = C.pyRound((q.US10Y.change || 0) * 100);
      parts.push(`미 10년물 ${E.fmt(q.US10Y.price, 2)}% (${bp >= 0 ? "+" : "-"}${Math.abs(bp)}bp)`);
    }
    if ("WTI" in q) parts.push(`WTI ${pct(q.WTI.change_pct)}`);
    if ("USDKRW" in q) parts.push(`원/달러 ${E.fmt(q.USDKRW.price, 1, false, true)}`);
    const top = (news.items || []).find((n) => n.top) || null;
    const detail = top ? `톱뉴스: ${top.title}` : "";
    if (parts.length) lines.push({ headline: parts.slice(0, 2).join(" · "), detail: [...parts.slice(2), ...(detail ? [detail] : [])].join(" · "), tags: ["macro"] });
    return ctx.envelope(lines.slice(0, 3), lines.length ? "ok" : "empty", ["rule"]);
  };
})(typeof window !== "undefined" ? window : globalThis);
