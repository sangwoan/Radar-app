// 반도체 사이클 지표 11개와 종합 국면 — scripts/semi/cycle.py와 1:1. 메모리 기록(store memory_history)은 memory 모듈이 먼저 쓴다.
(function (G) {
  const TR = (G.TR = G.TR || {});
  const E = TR.semiEng, C = TR.core;
  const FRED_API = (sid, key, start) => `https://api.stlouisfed.org/fred/series/observations?series_id=${sid}&api_key=${key}&file_type=json&observation_start=${start}`;
  const FRED_CSV = (sid, start) => `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${sid}&cosd=${start}`;
  const SIA_LIST = ["https://www.semiconductors.org/news-events/latest-news/",
    "https://www.semiconductors.org/category/press-releases/",
    "https://www.semiconductors.org/category/press-releases/page/2/"];
  const MONTHS = Object.fromEntries(["January", "February", "March", "April", "May", "June", "July", "August",
    "September", "October", "November", "December"].map((m, i) => [m, i + 1]));
  const SIGNAL_SCORE = { expand: 1, neutral: 0, slow: -1 };
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const pad = (n) => String(n).padStart(2, "0");
  const items2 = (o) => Object.keys(o).sort().map((k) => [k, o[k]]);          // sorted(d.items()) (키는 날짜 글자)
  const last = (a) => a[a.length - 1];
  const splitlines = (s) => { const a = s.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/); if (a.length && a[a.length - 1] === "") a.pop(); return a; };
  const pct = (v, d) => E.fmt(v, d, true);

  async function fred(ctx, sid, years = 4) {
    const start = `${+ctx.today.slice(0, 4) - years}-01-01`;
    const key = ctx.keys.FRED_API_KEY;
    if (key) {
      const d = await ctx.net.json(FRED_API(sid, key, start));
      if (!d || !Array.isArray(d.observations)) throw new Error("observations");
      return d.observations.filter((o) => o.value !== "." && o.value !== "").map((o) => [o.date.slice(0, 7), E.pyFloat(o.value)]);
    }
    const out = [];
    for (const line of splitlines(await ctx.net.get(FRED_CSV(sid, start))).slice(1)) {
      const parts = E.strip(line).split(",");
      if (parts.length === 2 && /^\d{4}-\d{2}-\d{2}$/.test(parts[0]) && /^-?\d+(\.\d+)?$/.test(parts[1])) out.push([parts[0].slice(0, 7), Number(parts[1])]);
    }
    if (!out.length) throw new Error("FRED CSV 형식");
    return out;
  }
  function yoy(series) {
    const m = Object.fromEntries(series), out = [];
    for (const [ym, v] of series) {
      const [y, mo] = ym.split("-"), prev = m[`${+y - 1}-${mo}`];
      if (prev) out.push([ym, C.pyRound((v / prev - 1) * 100, 2)]);
    }
    return out;
  }
  const ma = (s, n) => { const out = []; for (let i = n - 1; i < s.length; i++) out.push([s[i][0], C.sum(s.slice(i - n + 1, i + 1).map((x) => x[1])) / n]); return out; };
  const item = (kw) => ({ unit: "", series: [], note: null, as_of: null, ...kw });

  async function siaMonths(ctx) {
    const cache = (await ctx.store.get("sia", { pages: {}, months: {} })) || { pages: {}, months: {} };
    const links = [];
    for (const u of SIA_LIST) {
      let page;
      try { page = await ctx.net.get(u); } catch (e) { continue; }
      for (const m of page.matchAll(/href="(https:\/\/www\.semiconductors\.org\/[^"]*semiconductor-sales[^"]*)"/g)) if (!links.includes(m[1])) links.push(m[1]);
    }
    for (const link of links) {
      if (own(cache.pages, link)) continue;
      let text;
      try { text = E.unescape((await ctx.net.get(link)).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " "); } catch (e) { continue; }
      const found = {};
      for (const m of text.matchAll(/\$([\d.]+) billion (?:during|in) the month of (\w+) (\d{4})/g)) if (own(MONTHS, m[2])) found[`${m[3]}-${pad(MONTHS[m[2]])}`] = E.pyFloat(m[1]);
      for (const m of text.matchAll(/the (\w+) (\d{4}) total of \$([\d.]+) billion/g)) {
        const k = `${m[2]}-${pad(MONTHS[m[1]])}`;
        if (own(MONTHS, m[1]) && !own(found, k)) found[k] = E.pyFloat(m[3]);
      }
      cache.pages[link] = found;
      Object.assign(cache.months, found);
    }
    await ctx.store.set("sia", cache);
    return cache.months;
  }
  const sigLevel = (v, hi, lo) => (v >= hi ? "expand" : v < lo ? "slow" : "neutral");

  E.mods.cycle = async (ctx) => {
    const snap = ctx.results.snapshot || {};
    const q = {};
    for (const i of snap.items || []) q[i.id] = i;
    const memHist = (await ctx.store.get("memory_history", {})) || {};
    const memSpot = memHist.spot || {}, memCon = memHist.contract || {};
    const items = [], errors = [];

    // ① ② 현물-고정가 프리미엄
    for (const [iid, name, spotN, conN] of [["dram_premium", "DRAM 현물 프리미엄", "DDR4 8Gb (1Gx8) 3200", "DDR4 8Gb 1Gx8"],
      ["nand_premium", "NAND 현물 프리미엄", "MLC 64Gb 8GBx8", "NAND 64Gb 8Gx8 Speedns"]]) {
      const spot = items2(memSpot[spotN] || {}), con = items2(memCon[conN] || {});
      if (spot.length && con.length) {
        const prem = C.pyRound((last(spot)[1] / last(con)[1] - 1) * 100, 1);
        items.push(item({ id: iid, group: "가격", name, value: prem, unit: "%", display: pct(prem, 0) + "%",
          signal: prem > 15 ? "expand" : prem < 0 ? "slow" : "neutral",
          rule: "현물가가 고정가보다 15%↑ 비싸면 공급 부족(확장), 현물이 고정가 아래로 내려가면 둔화 경고",
          lead: "1~2분기 선행", as_of: last(spot)[0], source: "DRAMeXchange",
          note: `현물 ${spotN} $${E.fmt(last(spot)[1], 2)} vs 고정 ${conN.replaceAll(" Speedns", "")} $${E.fmt(last(con)[1], 2)}(${last(con)[0]})`,
          series: spot.slice(-60).map(([d, v]) => [d, C.pyRound((v / last(con)[1] - 1) * 100, 1)]) }));
      }
    }
    // ③ 고정가 MoM
    const con = items2(memCon["DDR4 8Gb 1Gx8"] || {});
    if (con.length >= 2) {
      const moms = con.slice(1).map((c, i) => [c[0], C.pyRound((c[1] / con[i][1] - 1) * 100, 1)]);
      const lv = last(moms)[1], decel = moms.length >= 2 && lv < moms[moms.length - 2][1];
      items.push(item({ id: "contract_mom", group: "가격", name: "DRAM 고정가 MoM", value: lv, unit: "%", display: pct(lv, 1) + "%",
        signal: lv < 0 ? "slow" : decel || lv < 5 ? "neutral" : "expand",
        rule: "월 상승률 5%↑이면 확장, 상승 폭이 줄면(감속) 후반, 하락 전환하면 둔화",
        lead: "동행(가격 사이클 본체)", as_of: last(con)[0], source: "DRAMeXchange",
        note: moms.length >= 2 ? (decel ? "상승 폭 축소 중" : "상승 폭 유지·확대") : "월별 이력 누적 중(감속 판정은 3개월치부터)",
        series: moms.map(([m, v]) => [m, v]) }));
    }
    // ④ ⑥ ⑦ ⑧ FRED
    try {
      const ppi = yoy(await fred(ctx, "PCU334413334413", 6));
      const v = last(ppi)[1], base = C.sum(ppi.slice(-36).map((x) => x[1])) / Math.min(36, ppi.length);
      items.push(item({ id: "ppi_yoy", group: "가격", name: "미 반도체 생산자물가 YoY", value: v, unit: "%", display: pct(v, 1) + "%",
        signal: v > base + 1 ? "expand" : v < base - 1 ? "slow" : "neutral",
        rule: "품질조정 때문에 평소에도 하락하는 지수라, 자기 3년 평균 증가율보다 1%p↑ 높으면 확장, 1%p↓ 낮으면 둔화",
        lead: "동행", as_of: last(ppi)[0], source: "FRED PCU334413334413", series: ppi.slice(-36).map(([m, x]) => [m, x]),
        note: `3년 평균 ${pct(base, 1)}%` }));
    } catch (e) { errors.push(`PPI:${E.ename(e)}`); }
    try {
      const ip = yoy(await fred(ctx, "IPG3344S"));
      const v = last(ip)[1], peak = Math.max(...ip.slice(-12).map((x) => x[1]));
      items.push(item({ id: "ip_yoy", group: "수요", name: "미 반도체 산업생산 YoY", value: v, unit: "%", display: pct(v, 1) + "%",
        signal: v < 0 ? "slow" : v < peak * 0.6 ? "neutral" : "expand",
        rule: "플러스이면서 최근 12개월 고점의 60% 이상이면 확장, 고점 대비 크게 꺾이면 후반, 마이너스면 둔화",
        lead: "동행", as_of: last(ip)[0], source: "FRED IPG3344S", series: ip.slice(-36).map(([m, x]) => [m, x]),
        note: `최근 12개월 고점 ${pct(peak, 1)}%` }));
    } catch (e) { errors.push(`IP:${E.ename(e)}`); }
    try {
      const no = Object.fromEntries(await fred(ctx, "A34SNO")), vs = Object.fromEntries(await fred(ctx, "A34SVS"));
      const ratio = Object.keys(no).sort().filter((m) => own(vs, m)).map((m) => [m, no[m] / vs[m]]);
      const r3 = ma(ratio, 3);
      const avg12 = C.sum(r3.slice(-12).map((x) => x[1])) / Math.min(12, r3.length);
      const v = C.pyRound(last(r3)[1], 3);
      items.push(item({ id: "orders_ratio", group: "재고·수주", name: "신규수주/출하 (컴퓨터·전자)", value: v, unit: "", display: E.fmt(v, 3),
        signal: v > avg12 * 1.005 ? "expand" : v < avg12 * 0.99 ? "slow" : "neutral",
        rule: "3개월 평균이 12개월 평균보다 높으면 수주 개선(확장), 낮으면 둔화 (반도체 자체 수주는 미공개라 상위 업종으로 대용)",
        lead: "1~2분기 선행", as_of: last(r3)[0], source: "FRED A34SNO/A34SVS",
        series: r3.slice(-36).map(([m, x]) => [m, C.pyRound(x, 3)]), note: `12개월 평균 ${E.fmt(avg12, 3)}` }));
    } catch (e) { errors.push(`수주:${E.ename(e)}`); }
    try {
      const inv = await fred(ctx, "A34SIS");
      const avg12 = C.sum(inv.slice(-12).map((x) => x[1])) / 12, v = last(inv)[1];
      items.push(item({ id: "inv_ratio", group: "재고·수주", name: "재고/출하 비율 (컴퓨터·전자)", value: v, unit: "개월", display: E.fmt(v, 2),
        signal: v < avg12 * 0.98 ? "expand" : v > avg12 * 1.02 ? "slow" : "neutral",
        rule: "12개월 평균보다 낮으면 재고 타이트(확장), 높아지면 재고 쌓임(둔화)",
        lead: "1~2분기 선행(상승 시 경고)", as_of: last(inv)[0], source: "FRED A34SIS",
        series: inv.slice(-36).map(([m, x]) => [m, x]), note: `12개월 평균 ${E.fmt(avg12, 2)}` }));
    } catch (e) { errors.push(`재고:${E.ename(e)}`); }
    // ⑤ SIA
    try {
      const months = items2(await siaMonths(ctx)), y = yoy(months);
      if (y.length) {
        const y3 = y.length >= 3 ? ma(y, 3) : y;
        const v = C.pyRound(last(y3)[1], 1);
        const [peakM, peakV] = y3.reduce((a, b) => (b[1] > a[1] ? b : a));
        const lm = last(y3)[0];
        const since = (+lm.slice(0, 4) - +peakM.slice(0, 4)) * 12 + +lm.slice(5) - +peakM.slice(5);
        items.push(item({ id: "sia_yoy", group: "수요", name: "세계 반도체 매출 YoY (3개월 평균)", value: v, unit: "%", display: pct(v, 0) + "%",
          signal: v < 0 ? "slow" : since >= 2 && v < peakV * 0.8 ? "neutral" : "expand",
          rule: "증가율이 계속 오르면 확장, 고점을 찍고 2개월 이상 꺾이면 후반(역사적으로 매출 증가율 고점 ≈ 사이클 고점), 마이너스면 둔화",
          lead: "고점이 사이클 고점과 거의 일치", as_of: lm, source: "SIA(WSTS) 보도자료",
          series: y3.slice(-24).map(([m, x]) => [m, C.pyRound(x, 1)]),
          note: `월 매출 $${E.fmt(last(months)[1], 1)}B(${last(months)[0]}) · 증가율 고점 ${pct(peakV, 0)}%(${peakM}), ${since}개월 경과` }));
      }
    } catch (e) { errors.push(`SIA:${E.ename(e)}`); }
    // ⑨ ⑩ ⑪ 시장
    const sox = q.SOX || {};
    if (sox.ma200_gap != null) {
      const v = sox.ma200_gap;
      items.push(item({ id: "sox_ma200", group: "시장", name: "SOX 200일선 이격", value: v, unit: "%", display: pct(v, 1) + "%",
        signal: sigLevel(v, 5, -5), rule: "200일 이동평균보다 5%↑ 위면 상승 추세(확장), 5%↓ 아래면 추세 이탈(둔화)",
        lead: "펀더멘털에 6~9개월 선행", as_of: sox.trade_date ?? null, source: "Yahoo ^SOX" }));
    }
    const r3m = (i) => ((q[i] || {}).ret || {})["3m"];
    const memIds = ["SKHYNIX", "SAMSUNG", "MU"].filter((i) => r3m(i) && r3m(i).length);
    const sox3 = (sox.ret || {})["3m"];
    if (memIds.length && sox3 && sox3.length) {
      const rel = C.pyRound(C.sum(memIds.map((i) => q[i].ret["3m"][0])) / memIds.length - sox3[0], 1);
      items.push(item({ id: "mem_rel", group: "시장", name: "메모리주 vs SOX (3개월)", value: rel, unit: "%p", display: pct(rel, 0) + "%p",
        signal: rel > 0 ? "expand" : rel < -10 ? "slow" : "neutral",
        rule: "메모리 3사가 SOX보다 강하면 확장, 10%p 넘게 약하면 시장이 메모리 피크를 선반영(둔화)",
        lead: "메모리 가격에 1~2분기 선행", as_of: sox.trade_date ?? null, source: "Yahoo",
        note: memIds.map((i) => `${i} ${pct(q[i].ret["3m"][0], 0)}%`).join(" · ") + ` · SOX ${pct(sox3[0], 0)}%` }));
    }
    const hx = q.SKHYNIX || {};
    if (hx.price && hx.high_52w) {
      const dd = C.pyRound((hx.price / hx.high_52w - 1) * 100, 1);
      items.push(item({ id: "hynix_dd", group: "시장", name: "SK하이닉스 52주 고점 대비", value: dd, unit: "%", display: pct(dd, 0) + "%",
        signal: dd > -15 ? "expand" : dd < -30 ? "slow" : "neutral",
        rule: "고점 대비 -15% 이내면 확장, -30%보다 깊으면 시장이 하강을 반영(둔화)",
        lead: "이익 피크에 2~3분기 선행", as_of: hx.trade_date ?? null, source: "Yahoo 000660.KS" }));
    }
    const tally = (groups) => {
      const sel = items.filter((i) => groups.includes(i.group));
      return { n: sel.length, expand: sel.filter((i) => i.signal === "expand").length, neutral: sel.filter((i) => i.signal === "neutral").length,
        slow: sel.filter((i) => i.signal === "slow").length, score: C.sum(sel.map((i) => SIGNAL_SCORE[i.signal])) };
    };
    const fund = tally(["가격", "수요", "재고·수주"]), mkt = tally(["시장"]);
    const score = fund.score + mkt.score, n = Math.max(1, fund.n + mkt.n), ratio = score / n;
    const stage = ratio >= 0.45 ? "expand" : ratio >= 0.1 ? "late" : ratio > -0.35 ? "peak" : "down";
    const label = { expand: "확장 지속", late: "확장 후반 — 둔화 신호 혼재", peak: "피크 논쟁 구간", down: "하강 국면" }[stage];
    const fTxt = fund.score > 0 ? "펀더멘털은 아직 확장" : fund.score < 0 ? "펀더멘털도 둔화" : "펀더멘털은 혼조";
    const mTxt = mkt.score > 0 ? "시장(주가)은 추세 유지" : mkt.score < 0 ? "시장(주가)은 이미 피크를 반영" : "시장(주가)은 방향 탐색";
    const sig = Object.fromEntries(items.map((i) => [i.id, i.signal]));
    const checklist = [
      { step: 1, name: "메모리주가 SOX 대비 약세 전환", on: sig.mem_rel === "slow", ids: ["mem_rel"] },
      { step: 2, name: "SK하이닉스 고점 대비 -30% 이상 하락", on: sig.hynix_dd === "slow", ids: ["hynix_dd"] },
      { step: 3, name: "현물가 프리미엄 소멸(현물 < 고정가)", on: sig.dram_premium === "slow" || sig.nand_premium === "slow", ids: ["dram_premium", "nand_premium"] },
      { step: 4, name: "고정가 상승률 둔화·하락", on: ["neutral", "slow"].includes(sig.contract_mom), ids: ["contract_mom"] },
      { step: 5, name: "재고/출하 비율 상승·수주 둔화", on: sig.inv_ratio === "slow" || sig.orders_ratio === "slow", ids: ["inv_ratio", "orders_ratio"] },
      { step: 6, name: "세계 반도체 매출 증가율 고점 통과", on: ["neutral", "slow"].includes(sig.sia_yoy), ids: ["sia_yoy"] },
      { step: 7, name: "반도체 지수 200일선 이탈", on: sig.sox_ma200 === "slow", ids: ["sox_ma200"] },
    ];
    for (const c of checklist) c.available = c.ids.some((i) => own(sig, i));
    const status = items.length && !errors.length ? "ok" : items.length ? "partial" : "error";
    return ctx.envelope(items, status, ["fred", "sia", "dramexchange", "yahoo"], errors.join(", ") || null,
      { summary: { stage, stage_label: label, score, n, fundamental: fund, market: mkt, text: `${fTxt} · ${mTxt}` }, checklist });
  };
})(typeof window !== "undefined" ? window : globalThis);
