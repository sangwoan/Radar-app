// 메모리 가격 전망(TrendForce 공개 보도자료) — scripts/semi/outlook.py와 1:1. 정규식은 파이썬 원문을 E.pyRe로 옮겨 뜻을 맞춘다.
(function (G) {
  const TR = (G.TR = G.TR || {});
  const E = TR.semiEng, C = TR.core;
  const R = String.raw, re = (s, f = "") => E.pyRe(s, f);
  const BASE = "https://www.trendforce.com";
  const PARSER_V = 2;
  const SUBJECTS = [[R`enterprise SSD`, "기업용 SSD"], [R`HBM`, "HBM"], [R`server DRAM|RDIMM`, "서버 DRAM"],
    [R`mobile DRAM|LPDDR`, "모바일 DRAM"], [R`PC DRAM`, "PC DRAM"], [R`graphics DRAM|GDDR`, "그래픽 DRAM"],
    [R`consumer DRAM`, "컨슈머 DRAM"], [R`conventional DRAM`, "범용 DRAM"], [R`NOR Flash`, "NOR 플래시"],
    [R`NAND Flash wafer|wafer`, "NAND 웨이퍼"], [R`NAND`, "NAND"], [R`DRAM`, "DRAM"]].map(([p, l]) => [re(p, "i"), l]);
  const NUM = R`(\d+(?:\.\d+)?)`;
  const PCT = re(NUM + R`\s*(?:–|—|-|~|to)\s*` + NUM + R`\s*%|` + NUM + R`\s*%`);
  const UP = re(R`\b(rise|rises|rising|increase|increases|increasing|grow|grows|growth|climb|climbs|surge|surges|jump|jumps|upward|higher|gain|gains)\b`, "i");
  const DOWN = re(R`\b(decline|declines|declining|decrease|decreases|fall|falls|drop|drops|lower|slide|slides|dip|dips)\b`, "i");
  const EXCLUDE = re(R`revenue|shipment|market share|capex|account for|BOM|output|capacity|bit supply|bit demand|\bsales\b`, "i");
  const PERIOD = re(R`\b([1-4]Q\d{2}|[12]H\d{2}|20[2-3]\d)\b`, "g");
  const WORD_Q = re(R`\b(first|second|third|fourth)[- ]quarter\b`, "gi");
  const QN = { first: 1, second: 2, third: 3, fourth: 4 };
  const MONTHS = Object.fromEntries(["January", "February", "March", "April", "May", "June", "July", "August",
    "September", "October", "November", "December"].map((m, i) => [m, i + 1]));
  const LIST_RE = re(R`<a class="title-link" href="([^"]+)"><strong>(.*?)</strong></a></h3>\s*<h4[^>]*><strong>(.*?)</strong></h4>`, "gs");
  const PRICE_RE = re(R`\bprices?\b|\bASPs?\b|\bpricing\b`, "i"), ASP_RE = re(R`\bASPs?\b`), CONTRACT_RE = re(R`contract`, "i");
  const BASIS_RE = re(R`\b(QoQ|YoY|MoM)\b`), CUM_RE = re(R`cumulative`, "i");
  const SENT_SPLIT = re(R`(?<=[.;])\s+(?=[A-Z])`), CLAUSE_SPLIT = re(R`,\s*(?:while|whereas|and|but)\s+|;\s*|\s+while\s+|\s+whereas\s+`);
  const APPROX1 = re(R`\b(around|about|nearly|approximately|roughly)\s*$`, "i"), APPROX2 = re(R`\b(around|about|nearly|approximately|roughly)\b\W*$`, "i");
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const pad = (n) => String(n).padStart(2, "0");
  const all = (rx, s) => [...s.matchAll(rx)];
  const validDate = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pyFind = (s, sub, start = 0) => s.indexOf(sub, start < 0 ? Math.max(0, s.length + start) : start);   // str.find(sub, start)
  // 위치(파이썬은 코드 포인트): 서로게이트가 있을 때만 바꾼다
  const astral = /[\ud800-\udfff]/;
  const posFn = (s) => (astral.test(s) ? (i) => E.cpIndex(s, i) : (i) => i);

  async function listPage(ctx, n) {
    const out = [];
    for (const [, href, title, d] of all(LIST_RE, await ctx.net.get(`${BASE}/presscenter/news?page=${n}`))) {
      const m = /^(\d{1,2}) ([A-Za-z]+) (\d{4})$/.exec(E.strip(d.replace(/\s+/g, " ")));
      if (!m || !own(MONTHS, m[2])) continue;
      const y = +m[3], mo = MONTHS[m[2]], dd = +m[1];
      if (!validDate(y, mo, dd)) continue;
      out.push({ date: `${String(y).padStart(4, "0")}-${pad(mo)}-${pad(dd)}`, title: E.strip(E.unescape(title.replace(/<[^>]+>/g, ""))),
        url: href.startsWith("/") ? BASE + href : href });
    }
    return out;
  }
  async function paragraphs(ctx, url) {
    const page = await ctx.net.get(url);
    const s = pyFind(page, '<hr class="space m">', pyFind(page, "press-share"));
    const e = pyFind(page, "press-choose-post", s);
    if (s < 0) return [];
    const seg = page.slice(s, e > 0 ? e : s + 30000).replace(/<\/(p|li)>|<br\s*\/?>/g, "\n");
    const txt = E.unescape(seg.replace(/<[^>]+>/g, " "));
    return txt.split("\n").filter((x) => E.strip(x)).map((x) => E.squash(x));
  }

  function wordPeriod(text, rel) {
    const ms = all(WORD_Q, text);
    if (!ms.length) return null;
    const m = ms[ms.length - 1];
    const q = QN[m[1].toLowerCase()], rq = Math.floor((rel.month - 1) / 3) + 1;
    let year = rel.year;
    if (q === (rq % 4) + 1 && rq === 4) year += 1;
    else if (![rq - 1, rq, rq + 1].includes(q)) return null;
    return `${q}Q${pad(year % 100)}`;
  }
  function lastPeriod(text, rel) {
    let best = null, pos = -1;
    for (const m of all(PERIOD, text)) { best = m[1]; pos = m.index; }
    const ws = all(WORD_Q, text);
    if (ws.length && ws[ws.length - 1].index > pos) return wordPeriod(text.slice(ws[ws.length - 1].index), rel) || best;
    return best;
  }
  function nearPeriod(clause, m, rel) {
    const P = posFn(clause), mStart = P(m.index), mEnd = P(m.index + m[0].length);
    let cands = all(PERIOD, clause).map((t) => [P(t.index), P(t.index + t[0].length), t[1]]);
    cands = cands.concat(all(WORD_Q, clause).map((w) => [P(w.index), P(w.index + w[0].length), wordPeriod(w[0], rel)]));
    cands = cands.filter((c) => c[2]);
    if (!cands.length) return null;
    let best = null, bd = null;
    for (const c of cands) {
      const d = c[0] >= mEnd ? c[0] - mEnd : (mStart - c[1]) * 1.5;
      if (bd == null || d < bd) { best = c; bd = d; }
    }
    return best[2];
  }

  function figures(title, paras, rel) {
    const out = [], docs = [title, ...paras];
    docs.forEach((para, pi) => {
      const sents = para.split(SENT_SPLIT);
      sents.forEach((sent, si) => {
        for (const clause of sent.split(CLAUSE_SPLIT)) {
          if (!PRICE_RE.test(clause) || EXCLUDE.test(clause)) continue;
          const m = PCT.exec(clause);
          if (!m) continue;
          const [lo, hi] = m[1] != null ? [Number(m[1]), Number(m[2])] : [Number(m[3]), Number(m[3])];
          const before = clause.slice(0, m.index);
          const sb = SUBJECTS.find(([p]) => p.test(before)) || SUBJECTS.find(([p]) => p.test(clause));
          if (!sb) continue;
          const up = UP.exec(clause), down = DOWN.exec(clause);
          let sign;
          if (up && down) sign = up.index < down.index ? 1 : -1;
          else if (up || down) sign = up ? 1 : -1;
          else continue;
          const b = BASIS_RE.exec(clause);
          const basis = b ? b[1] : CUM_RE.test(clause) ? "누적" : null;
          let period = nearPeriod(clause, m, rel) || lastPeriod(sent, rel) || lastPeriod(sents.slice(0, si).join(" "), rel);
          for (let k = pi - 1; !period && k >= 0; k--) period = lastPeriod(docs[k], rel);
          const tail = E.cpSlice(E.strip(before), -20) + " ";
          const approx = APPROX1.test(tail) || APPROX2.test(before);
          out.push({ subject: sb[1], kind: CONTRACT_RE.test(clause) ? "고정가" : ASP_RE.test(clause) ? "평균판가" : "가격",
            low: sign * lo, high: sign * hi, basis, period: period || null, approx, clause: E.cpSlice(E.strip(clause), 0, 160) });
        }
      });
    });
    const merged = new Map();
    for (const f of out) {
      const key = [f.subject, f.kind, f.low + 0, f.high + 0].join("\u0000");
      if (!merged.has(key)) { merged.set(key, f); continue; }
      const g = merged.get(key);
      for (const fld of ["basis", "period"]) {
        if (!g[fld] && f[fld]) { g[fld] = f[fld]; if (fld === "basis") g.clause = f.clause; }
      }
    }
    return [...merged.values()];
  }

  function periodKey(p) {
    if (!p) return [0, 0];
    if (/^20\d{2}$/.test(p)) return [+p, 5];
    const y = 2000 + +p.slice(-2);
    return [y, p[1] === "Q" ? +p[0] : +p[0] * 2];
  }
  function forecasts(cache) {
    const best = new Map();
    for (const [url, c] of Object.entries(cache)) {
      for (const f of c.figures || []) {
        if (!f.period || !["QoQ", "YoY"].includes(f.basis)) continue;
        const k = [f.subject, f.kind, f.basis, f.period].join("\u0000");
        if (!best.has(k) || c.date > best.get(k).row.date) best.set(k, { g: [f.subject, f.kind, f.basis], row: { period: f.period, low: f.low, high: f.high, date: c.date, url } });
      }
    }
    const groups = new Map();
    for (const { g, row } of best.values()) {
      const gk = g.join("\u0000");
      if (!groups.has(gk)) groups.set(gk, { g, rows: [] });
      groups.get(gk).rows.push(row);
    }
    const order = ["범용 DRAM", "서버 DRAM", "모바일 DRAM", "PC DRAM", "HBM", "NAND", "기업용 SSD"];
    const out = [...groups.values()].map(({ g: [s, k, b], rows }) => ({ subject: s, kind: k, basis: b, rows: C.sortBy(rows, (r) => periodKey(r.period)) }));
    return C.sortBy(out, (g) => [order.includes(g.subject) ? order.indexOf(g.subject) : 99, g.kind]);
  }

  E.mods.outlook = async (ctx) => {
    const tc = E.cfg("sales").trendforce || {};
    const match = E.pyRe(tc.title_match || "DRAM|NAND|HBM|Memory|SSD|Flash", "i");
    const cache = {};
    for (const [u, c] of Object.entries((await ctx.store.get("trendforce", {})) || {})) if (c.v === PARSER_V) cache[u] = c;
    let rows = [];
    const errors = [];
    for (let n = 1; n <= (tc.pages ?? 6); n++) {
      try { rows = rows.concat(await listPage(ctx, n)); } catch (e) { errors.push(`목록${n}:${E.ename(e)}`); }
    }
    if (!rows.length) return ctx.envelope([], "error", ["trendforce"], errors.join(", ") || "목록 형식 변경", { forecasts: forecasts(cache) });
    for (const r of rows) {
      if (!match.test(r.title) || own(cache, r.url)) continue;
      let paras;
      try { paras = await paragraphs(ctx, r.url); } catch (e) { errors.push(`본문:${E.ename(e)}`); continue; }
      if (!paras.length) { errors.push("본문 형식 변경"); continue; }
      cache[r.url] = { v: PARSER_V, date: r.date, title: r.title, figures: figures(r.title, paras, { year: +r.date.slice(0, 4), month: +r.date.slice(5, 7) }) };
    }
    const keep = C.addDays(ctx.today, -(tc.keep_days ?? 400));
    const kept = {};
    for (const [u, c] of Object.entries(cache)) if (c.date >= keep) kept[u] = c;
    await ctx.store.set("trendforce", kept);
    const show = C.addDays(ctx.today, -(tc.show_days ?? 75));
    const items = E.sortDesc(Object.entries(kept).filter(([, c]) => c.date >= show)
      .map(([u, c]) => ({ id: u.slice(u.lastIndexOf("/") + 1).split(".")[0], date: c.date, title: c.title, url: u, figures: c.figures })), (i) => [i.date]);
    return ctx.envelope(items, errors.length ? "partial" : "ok", ["trendforce"], errors.join(", ") || null, { forecasts: forecasts(kept) });
  };
})(typeof window !== "undefined" ? window : globalThis);
