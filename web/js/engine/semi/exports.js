// 한국 반도체 수출 속보 — scripts/semi/exports.py와 1:1. 관세청 · 산업부 '보도 제목'(Google News)에서 숫자만 뽑는다.
// 정규식은 파이썬 원문을 E.pyRe로 옮긴다(유니코드 뜻 · 코드 포인트 위치를 맞춤).
(function (G) {
  const TR = (G.TR = G.TR || {});
  const E = TR.semiEng, C = TR.core;
  const R = String.raw;
  const UP = R`(?:↑|증가|늘어|늘|급증|폭증|상승|증|껑충|뛰|확대)`;
  const DOWN = R`(?:↓|감소|줄어|줄|급감|하락|감|축소)`;
  const Q = R`['‘’"“”]?`;
  const NUM = R`([0-9]+(?:\.[0-9]+)?)`;
  const AMT = R`(?:([0-9])?천\s*)?([0-9][0-9,]*(?:\.[0-9]+)?)\s*억\s*(?:달러|弗|불|\$)`;
  const SEMI_PCT = E.pyRe(R`(?<!비)반도체(?!\s*비중)(?:\s*수출)?(?:은|이|도)?\s*(?:` + AMT + R`\s*[,·]?\s*)?` + Q + R`\s*` + NUM + R`\s*%(?!\s*p)\s*` + Q + R`\s*(` + UP + "|" + DOWN + ")", "d");
  const TOTAL_PCT = E.pyRe(R`(?<!반도체 )(?<!반도체)수출(?:액|은|이)?\s*(?:,\s*)?(?:` + AMT + R`\s*[,·]?\s*)?(?:전년\S*\s*(?:대비|비)\s*)?` + Q + R`\s*` + NUM + R`\s*%(?!\s*p)\s*` + Q + R`\s*(` + UP + "|" + DOWN + ")", "d");
  const EXACT = R`(?!\s*(?:첫\s*)?(?:육박|안팎|근접|돌파|넘|상회|가까이|이상|대(?![0-9A-Za-z_가-힣])|시대))`;
  const TOTAL_AMT = E.pyRe(R`(?<!반도체 )(?<!반도체)수출(?:액|은|이)?\s*` + AMT + EXACT, "d");
  const SEMI_AMT = E.pyRe(R`(?<!비)반도체(?!\s*비중)(?:\s*수출)?(?:은|이|도)?\s*` + AMT + EXACT, "d");
  const SPAN = [[E.pyRe(R`1\s*[~∼-]\s*10\s*일|초순`), "10"], [E.pyRe(R`1\s*[~∼-]\s*20\s*일|중순|초중순`), "20"]];
  const MONTH = E.pyRe(R`(?<![0-9])(1[0-2]|[1-9])월`);
  const DOWN_RE = E.pyRe("^" + DOWN + "$");
  const LABEL = { 10: "1~10일", 20: "1~20일", month: "월간" };
  const ORDER = { 10: 1, 20: 2, month: 3 };
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  function amt(m) {
    if (m[2] == null) return null;
    let v = Number(m[2].replace(/,/g, ""));
    if (m[1] != null || m[0].slice(0, m.indices[2][0] - m.index).includes("천")) v += Number(m[1] ?? 1) * 1000;
    return v;
  }
  const sign = (w) => (DOWN_RE.test(w) ? -1 : 1);

  function period(title, pub) {                 // pub = {year, month, day}(KST) → [year, month, span] 또는 null
    const m = MONTH.exec(title);
    if (!m) return null;
    const month = +m[1];
    const sp = SPAN.find(([p]) => p.test(title));
    const year = month <= pub.month ? pub.year : pub.year - 1;
    if (sp) return [year, month, sp[1]];
    if (month === pub.month) {
      if (pub.day >= 11 && pub.day <= 19) return [year, month, "10"];
      if (pub.day >= 21) return [year, month, "20"];
      return null;
    }
    const prev = pub.month === 1 ? 12 : pub.month - 1;
    if (month === prev && pub.day <= 5) return [year, month, "month"];
    return null;
  }
  function parse(title, pub) {
    const per = period(title, pub);
    if (!per) return null;
    const out = {};
    const daily = (m) => { const s = E.cpIndex(title, m.index); return E.cpSlice(title, Math.max(0, s - 12), s).includes("일평균"); };
    let m = SEMI_PCT.exec(title);
    if (m && !title.slice(0, m.index).includes("일평균")) out.semi_yoy = sign(m[4]) * Number(m[3]);
    m = TOTAL_PCT.exec(title);
    if (m && !daily(m)) out.total_yoy = sign(m[4]) * Number(m[3]);
    m = TOTAL_AMT.exec(title);
    if (m && !daily(m)) out.total_amt = amt(m);
    m = SEMI_AMT.exec(title);
    if (m && !daily(m)) out.semi_amt = amt(m);
    return Object.keys(out).length ? { period: per, metrics: out } : null;
  }
  E.exportsParse = parse;

  const prec = (v) => { const s = String(v); return s.includes(".") && !s.includes("e") ? s.split(".")[1].replace(/0+$/, "").length : 0; };
  const tol = (v, small, frac) => (Math.abs(v) < 1000 ? small : Math.abs(v) * frac);
  function consensus(vals) {
    let best = null;
    for (const [v] of vals) {
      const t = tol(v, 1.0, 0.01);
      const group = [...new Set(vals.filter(([w]) => Math.abs(w - v) <= t).map(([, s]) => s))];
      const key = [group.length, prec(v)];
      if (best == null || C.cmpTuple(key, best[0]) > 0) best = [key, v, group];
    }
    const [[n], v, group] = best;
    const inside = vals.filter(([w, s]) => group.includes(s) && Math.abs(w - v) <= tol(v, 1.0, 0.01)).map(([w]) => w);
    const counts = new Map();
    for (const w of inside) counts.set(w, (counts.get(w) || 0) + 1);
    let mode = null;
    for (const [w, c] of counts) if (mode == null || c > counts.get(mode)) mode = w;               // 같으면 먼저 나온 값
    const close = [...counts.keys()].filter((w) => Math.abs(w - mode) <= tol(mode, 0.5, 0.005));
    let rep = null;
    for (const w of close) if (rep == null || C.cmpTuple([prec(w), counts.get(w)], [prec(rep), counts.get(rep)]) > 0) rep = w;
    return { value: rep, n, conflict: new Set(vals.map(([, s]) => s)).size > n };
  }

  E.mods.exports = async (ctx) => {
    const ec = E.cfg("sales").exports || {};
    const cutoff = ctx.now / 1000 - (ec.days ?? 75) * 86400;
    const seen = new Set(), rows = {}, errors = [];
    for (const q of ec.queries || []) {
      const url = "https://news.google.com/rss/search?q=" + E.quote(q) + "&hl=ko&gl=KR&ceid=KR:ko";
      let entries;
      try { entries = await E.fetchFeed(ctx, url); } catch (e) { errors.push(`${E.cpSlice(q, 0, 10)}:${E.ename(e)}`); continue; }
      for (const [raw, link, d] of entries) {
        const [title, source] = E.splitPublisher(E.clean(raw));
        const ts = E.parseDate(d);
        const sk = JSON.stringify([title, source]);
        if (ts == null || ts < cutoff || !title.includes("수출") || seen.has(sk)) continue;
        seen.add(sk);
        const kd = E.kstDate(ts * 1000);
        const p = parse(title, { year: +kd.slice(0, 4), month: +kd.slice(5, 7), day: +kd.slice(8, 10) });
        if (!p) continue;
        const [y, mo, span] = p.period;
        const key = `${y}-${String(mo).padStart(2, "0")}|${span}`;
        const r = own(rows, key) ? rows[key] : (rows[key] = { year: y, month: mo, span, vals: {}, articles: [] });
        for (const [k, v] of Object.entries(p.metrics)) if (v != null) (r.vals[k] = r.vals[k] || []).push([v, source || link]);
        const ks = Object.keys(p.metrics);
        r.articles.push({ title, url: link, source, published_at: E.isoKst(ts), n: ks.filter((k) => k.startsWith("semi")).length * 2 + ks.length });
      }
    }
    let items = [];
    for (const [key, r] of Object.entries(rows)) {
      const metrics = {};
      for (const [k, v] of Object.entries(r.vals)) metrics[k] = consensus(v);
      if (!("semi_yoy" in metrics) && !("semi_amt" in metrics)) continue;
      const arts = E.sortDesc(r.articles, (a) => [a.n, a.published_at]).slice(0, 6);
      items.push({ id: key, year: r.year, month: r.month, span: r.span, label: `${r.month}월 ${LABEL[r.span]}`, metrics,
        articles: arts.map(({ n, ...a }) => a) });
    }
    items = E.sortDesc(items, (i) => [i.year, i.month, ORDER[i.span]]);
    const status = items.length && !errors.length ? "ok" : items.length ? "partial" : "error";
    return ctx.envelope(items.slice(0, ec.keep ?? 6), status, ["google-news(관세청·산업부 보도)"], errors.join(", ") || (items.length ? null : "수출 속보 보도 없음"));
  };
})(typeof window !== "undefined" ? window : globalThis);
