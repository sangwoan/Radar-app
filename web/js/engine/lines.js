// 빗각 탐지 · 다듬기 · 평가 · 신뢰도 — scripts/lines.py를 1:1로 옮긴 것(폰 앱 엔진).
// 둘 중 하나를 고치면 다른 쪽도 고치고 `python3 scripts/engine_parity.py`로 일치를 확인한다.
(function (G) {
  const TR = G.TR;
  const { pyRound, bisectLeft, median, cmpTuple, sortBy, sum, daysBetween, isoWeek } = TR.core;
  const { atr: atrSeries, pivots, trendlines } = TR.ta;

  const ZONE = 0.5, RETEST_BARS = 30, TRACK_BARS = 5, CLEAN_EPS = 0.03, CLEAN_SHIFT = 1.0;
  const flip = (s) => (s === "sup" ? "res" : "sup");
  const priceAt = (L, i) => (L.log ? Math.exp(L.ya + L.m * (i - L.a)) : L.ya + L.m * (i - L.a));

  function tolFor(bars, det) {
    const a = atrSeries(bars), pct = [];
    for (let i = Math.max(0, bars.length - 252); i < bars.length; i++) if (a[i] && bars[i].c) pct.push(a[i] / bars[i].c);
    const m = pct.length ? median(pct) : 0.02;
    return Math.min(det.tol_max, Math.max(det.tol_min, det.tol_atr * m));
  }

  const windowsFor = (market, det) => {
    const ws = market === "crypto" ? det.windows_crypto : det.windows_stock;
    return [["단기", ws[0]], ["장기", ws[1]]];
  };

  class Line {
    constructor(geo, dates) {
      this.i1 = bisectLeft(dates, geo.d1);
      this.i2 = bisectLeft(dates, geo.d2);
      this.ok = this.i2 > this.i1 && geo.p1 > 0 && geo.p2 > 0;
      if (this.ok) {
        this.lp1 = Math.log(geo.p1);
        this.m = (Math.log(geo.p2) - this.lp1) / (this.i2 - this.i1);
      }
    }
    logAt(i) { return this.lp1 + this.m * (i - this.i1); }
    at(i) { return Math.exp(this.logAt(i)); }
  }

  // ---------- 탐지 ----------
  function detect(sym, closed, market, tol, det) {
    const found = new Map(), nAll = closed.length;
    for (const [wname, W] of windowsFor(market, det)) {
      const win = closed.slice(-W);
      if (win.length < 60) continue;
      const tl = trendlines(win, { k: det.k, tol, log: true, minSpan: det.min_span });
      for (const side of ["sup", "res"]) {
        for (const L of tl[side]) {
          const d1 = win[L.a].d, d2 = win[L.b].d, gid = `${sym}:${side}:${d1}:${d2}`;
          const g = found.get(gid);
          if (g) {
            if (!g.window.includes(wname)) g.window = `${g.window}·${wname}`;
            g.score = Math.max(g.score, L.score);
            continue;
          }
          found.set(gid, { id: gid, kind: "auto", side, d1, p1: priceAt(L, L.a), d2, p2: priceAt(L, L.b), window: wname, tf: "1d", score: L.score });
        }
      }
    }
    const dates = closed.map((b) => b.d), out = [];
    for (const side of ["sup", "res"]) {
      const cands = sortBy([...found.values()].filter((g) => g.side === side), (g) => [-g.score]);
      const kept = [];
      for (const g of cands) {
        const ln = new Line(g, dates);
        if (!ln.ok) continue;
        const now = ln.logAt(nAll - 1);
        if (kept.every((k) => Math.abs(now - k[1]) > tol * 1.5 || (ln.m > 0) !== (k[2] > 0))) kept.push([g, now, ln.m]);
        if (kept.length >= det.lines_per_side) break;
      }
      out.push(...kept.map((k) => k[0]));
    }
    return out;
  }

  function lowerHull(pts) {
    const h = [];
    for (const p of pts) {
      while (h.length >= 2) {
        const a = h[h.length - 2], b = h[h.length - 1];
        if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) <= 0) h.pop(); else break;
      }
      h.push(p);
    }
    return h;
  }

  // 깨끗한 선: 확정된 과거에서 꼬리가 선 너머로 살짝(≤0.5 ATR) 나온 봉이 없게 볼록 껍질 변으로 옮김(lines.py envelope와 같음)
  function envelope(geo, closed, atrs, k, minSpan, piv = null, tolLog = 0, dates = null) {
    dates = dates || closed.map((b) => b.d);
    const ln = new Line(geo, dates);
    if (!ln.ok) return null;
    const sup = geo.side === "sup", s = sup ? 1 : -1, key = sup ? "l" : "h";
    const hist = closed.length - 1 - k, i1 = ln.i1;
    let i2 = ln.i2;
    if (i2 > hist) return geo;
    let A = null;
    for (let j = atrs.length - 1; j >= 0; j--) if (atrs[j]) { A = atrs[j]; break; }
    if (A == null) A = closed[closed.length - 1].c * 0.02;
    const y = new Array(hist + 1);
    for (let j = 0; j <= hist; j++) y[j] = j >= i1 ? s * Math.log(closed[j][key]) : 0;
    let c0 = s * ln.lp1, m0 = s * ln.m, anchors = null;
    const oc = c0, om = m0, pset = new Set(piv || []);
    const price = (j) => Math.exp(s * (c0 + m0 * (j - i1)));
    for (let it = 0; it < 30; it++) {
      const js = [];
      let status = "valid", brk = null;
      for (let j = i1; j <= hist; j++) {
        if (j > i2) {
          const L = price(j), a = atrs[j] || A, c = closed[j].c;
          if (status === "valid" && (sup ? c < L - ZONE * a : c > L + ZONE * a)) { status = "broken"; brk = j; }
          else if (status === "broken") {
            if (sup ? c > L + ZONE * a : c < L - ZONE * a) status = "valid";
            else if (j - brk > RETEST_BARS) break;
          }
        }
        if (status === "valid") js.push(j);
      }
      const depth = new Map();
      let any = false;
      for (const j of js) {
        const dp = (sup ? price(j) - closed[j][key] : closed[j][key] - price(j)) / (atrs[j] || A);
        depth.set(j, dp);
        if (CLEAN_EPS < dp && dp <= ZONE) any = true;
      }
      if (!any) break;
      const hull = lowerHull(js.filter((j) => depth.get(j) <= ZONE).map((j) => [j, y[j]]));
      const last = js[js.length - 1], cand = js.filter((j) => pset.has(j));
      const limit = CLEAN_SHIFT * (1 + (last - i1) / 250);
      let best = null;
      for (let h = 0; h + 1 < hull.length; h++) {
        const [xa, ya] = hull[h], [xb, yb] = hull[h + 1];
        if (xb - xa < minSpan) continue;
        const m = (yb - ya) / (xb - xa);
        let dev = -Infinity;
        for (const x of [i1, last]) dev = Math.max(dev, Math.abs(ya + m * (x - xa) - (oc + om * (x - i1))) / ((atrs[x] || A) / closed[x].c));
        if (dev > limit) continue;
        const touch = new Set([xa, xb]);
        for (const j of cand) if (Math.abs(y[j] - (ya + m * (j - xa))) <= tolLog) touch.add(j);
        const kk = [-touch.size, dev];
        if (best == null || cmpTuple(kk, best.k) < 0) best = { k: kk, xa, xb, first: Math.min(...touch) };
      }
      if (best == null) return null;
      m0 = (y[best.xb] - y[best.xa]) / (best.xb - best.xa);
      c0 = y[best.xa] + m0 * (i1 - best.xa);
      anchors = [best.first, best.xb];
      i2 = best.xb;
    }
    if (anchors == null) return geo;
    const [first, xb] = anchors, d1 = dates[first], d2 = dates[xb];
    const cut = geo.id.lastIndexOf(":", geo.id.lastIndexOf(":") - 1);
    return { ...geo, id: `${geo.id.slice(0, cut)}:${d1}:${d2}`, d1, p1: Math.exp(s * (c0 + m0 * (first - i1))), d2, p2: closed[xb][key], cleaned: true };
  }

  // ---------- 보조 지표 ----------
  const smaAt = (closes, n, i) => (i + 1 >= n ? sum(closes.slice(i - n + 1, i + 1)) / n : null);

  function trendScore(closed) {
    const c = closed.map((b) => b.c), n = c.length, parts = [];
    const m20 = smaAt(c, 20, n - 1), m60 = smaAt(c, 60, n - 1), m60p = smaAt(c, 60, n - 11);
    if (m60) parts.push(c[n - 1] > m60 ? 1 : -1);
    if (m60 && m60p) {
      const sl = (m60 / m60p - 1) * 100;
      parts.push(sl > 0.5 ? 1 : sl < -0.5 ? -1 : 0);
    }
    if (m20 && m60) parts.push(m20 > m60 ? 1 : -1);
    const pv = pivots(closed.slice(-252), 5), base = Math.max(0, n - 252);
    const H = pv.highs.slice(-2), L = pv.lows.slice(-2);
    if (H.length === 2 && L.length === 2) {
      const hh = closed[base + H[1]].h > closed[base + H[0]].h, hl = closed[base + L[1]].l > closed[base + L[0]].l;
      parts.push(hh && hl ? 1 : !hh && !hl ? -1 : 0);
    }
    const s = sum(parts);
    const label = s >= 3 ? "강한 상승" : s >= 1 ? "상승 우위" : s <= -3 ? "강한 하락" : s <= -1 ? "하락 우위" : "중립";
    return { score: s, label };
  }

  function levels(closed, band) {
    const win = closed.slice(-252), pv = pivots(win, 5);
    const pts = [...pv.highs.map((i) => win[i].h), ...pv.lows.map((i) => win[i].l)].sort((a, b) => a - b);
    const out = [];
    for (const p of pts) {
      const o = out[out.length - 1];
      if (o && p <= o.avg * (1 + band)) { o.n += 1; o.sum += p; o.avg = o.sum / o.n; }
      else out.push({ n: 1, sum: p, avg: p });
    }
    return out.filter((o) => o.n >= 2).map((o) => ({ price: o.avg, touches: o.n }));
  }

  // ---------- 평가 ----------
  function evaluate(geo, ctx) {
    const { bars, closed, dates } = ctx;
    const ln = new Line(geo, dates);
    if (!ln.ok) return null;
    const nC = closed.length, t = bars.length - 1, atrs = ctx.atrs, A = ctx.atr, side = geo.side;
    let start = ln.i2 + 1;
    if (geo.kind === "user" && geo.created) start = Math.max(start, bisectLeft(dates, geo.created.slice(0, 10)));
    let status = "valid", brk = null, fail = null, confirm = null, retestC = null;
    for (let j = start; j < nC; j++) {
      const L = ln.at(j), a = atrs[j] || A, c = closed[j].c, lo = closed[j].l, hi = closed[j].h;
      if (status === "valid") {
        if (side === "sup" ? c < L - ZONE * a : c > L + ZONE * a) { status = "broken"; brk = j; continue; }
        if (side === "sup" ? lo <= L + ZONE * a && c > L : hi >= L - ZONE * a && c < L) confirm = j;
      } else if (status === "broken") {
        if (side === "sup" ? c > L + ZONE * a : c < L - ZONE * a) { status = "valid"; fail = j; brk = null; continue; }
        if (j - brk > RETEST_BARS) { status = "expired"; continue; }
        if (side === "sup" ? hi >= L - ZONE * a && c < L : lo <= L + ZONE * a && c > L) retestC = j;
      }
    }
    const eff = status === "valid" ? side : flip(side);
    const Lnow = ln.at(t), P = ctx.P, last = ctx.last;
    let gap, gx, gapPct, gxPct;
    if (eff === "sup") {
      gap = (P - Lnow) / A; gx = (last.l - Lnow) / A;
      gapPct = (P / Lnow - 1) * 100; gxPct = (last.l / Lnow - 1) * 100;
    } else {
      gap = (Lnow - P) / A; gx = (Lnow - last.h) / A;
      gapPct = (1 - P / Lnow) * 100; gxPct = (1 - last.h / Lnow) * 100;
    }
    const cfg = ctx.cfg;
    let metric, mx, thr;
    if (cfg.mode === "pct") { metric = gapPct; mx = gxPct; thr = [cfg.touch_pct, cfg.near_pct, cfg.approach_pct]; }
    else {
      const ap = ctx.atr_pct || 1;
      thr = [cfg.zone_atr, Math.min(cfg.near_atr, (cfg.near_cap_pct ?? 99) / ap), Math.min(cfg.approach_atr, (cfg.approach_cap_pct ?? 99) / ap)];
      metric = gap; mx = gx;
    }
    let stage = mx <= thr[0] ? 3 : metric <= thr[1] ? 2 : metric <= thr[2] ? 1 : 0;
    if (status === "expired" || (status === "broken" && brk === t)) stage = 0;

    const tolLog = Math.log(1 + ctx.tol * ((cfg.detect || {}).touch_tol ?? 1.5));
    const key = side === "sup" ? "l" : "h";
    const end = brk != null ? brk : nC - 1;
    const hist = Math.min(end, nC - 1 - ctx.k);
    const cand = side === "sup" ? ctx.pivots.lows : ctx.pivots.highs;
    let touchIdx = cand.filter((j) => ln.i1 <= j && j <= hist && Math.abs(Math.log(closed[j][key]) - ln.logAt(j)) <= tolLog);
    if (geo.kind === "auto") {
      const set = new Set(touchIdx);
      for (const j of [ln.i1, ln.i2]) if (j <= hist && Math.abs(Math.log(closed[j][key]) - ln.logAt(j)) <= tolLog) set.add(j);
      touchIdx = [...set].sort((a, b) => a - b);
    }
    const touches = touchIdx.length, lastTouch = touches ? touchIdx[touches - 1] : null;
    const q = quality(ln, closed, atrs, A, side, touchIdx, hist, brk, geo.tf === "1w");
    const perBar = (Math.exp(ln.m) - 1) * 100, bpm = ctx.market === "crypto" ? 30 : 21;
    const grade = geo.kind === "user" ? "U" : q.grade;
    const events = [], jL = nC - 1, dL = nC ? closed[jL].d : null;
    if (brk === jL) events.push({ type: "break", d: dL });
    if (fail === jL) events.push({ type: "fail", d: dL });
    if (confirm === jL && status === "valid") events.push({ type: "confirm", d: dL });
    if (retestC === jL && status === "broken") events.push({ type: "retest_confirm", d: dL });
    return {
      id: geo.id, kind: geo.kind, orig: side, side: eff, status, window: geo.window ?? "내 빗각",
      d1: geo.d1, p1: geo.p1, d2: geo.d2, p2: geo.p2, note: geo.note ?? "",
      now: Lnow, gap, gap_pct: gapPct, stage,
      penetrating: !!(ctx.live && gap < -ZONE && status === "valid"),
      touches, grade, q: q.score, qd: q.detail, tf: geo.tf ?? "1d",
      last_touch_d: lastTouch != null ? closed[lastTouch].d : null,
      slope_month: (Math.exp(ln.m * bpm) - 1) * 100, steep: Math.abs(perBar) > 0.5 * ctx.atr_pct,
      break_d: brk != null ? closed[brk].d : null, fail_d: fail != null ? closed[fail].d : null,
      close_events: events, _ln: ln,
    };
  }

  function quality(ln, closed, atrs, A, side, touchIdx, end, brk, weekly) {
    const n = closed.length;
    const a = (j) => (j < atrs.length && atrs[j] ? atrs[j] : A);
    const key = side === "sup" ? "l" : "h";
    const conf = touchIdx.filter((j) => j !== ln.i1 && j !== ln.i2);
    const errs = conf.map((j) => Math.abs(closed[j][key] - ln.at(j)) / a(j)).sort((p, q) => p - q);
    const err = errs.length ? errs[errs.length >> 1] : null;
    const moves = [];
    for (const j of touchIdx) {
      if (j > n - 3 || (brk != null && j >= brk)) continue;
      const seg = closed.slice(j + 1, Math.min(n, j + 6));
      const mv = side === "sup" ? Math.max(...seg.map((b) => b.h)) - ln.at(j) : ln.at(j) - Math.min(...seg.map((b) => b.l));
      moves.push(Math.min(3.0, Math.max(0.0, mv / a(j))));
    }
    const react = moves.length ? sum(moves) / moves.length : 0.0;
    let pierce = 0;
    for (let j = ln.i1 + 1; j <= Math.min(end, n - 1); j++) {
      if (brk != null && j >= brk) break;
      const L = ln.at(j);
      if (side === "sup" ? closed[j].l < L - 0.5 * a(j) : closed[j].h > L + 0.5 * a(j)) pierce += 1;
    }
    const span = touchIdx.length >= 2 ? daysBetween(closed[touchIdx[0]].d, closed[touchIdx[touchIdx.length - 1]].d) : 0;
    const sTouch = Math.min(1.0, conf.length / 3);
    const sPrec = err == null ? 0.0 : Math.min(1.0, Math.max(0.0, 1 - err / 0.4));
    const sSpan = Math.min(1.0, Math.max(0.0, Math.log(Math.max(span, 1) / 30) / Math.log(720 / 30)));
    const sReact = Math.min(1.0, Math.max(0.0, (react - 2.0) / 0.9));
    let score = 100 * (0.30 * sTouch + 0.25 * sPrec + 0.30 * sSpan + 0.15 * sReact) - Math.min(45, 7 * pierce) + (weekly ? 5 : 0);
    score = pyRound(Math.max(0.0, Math.min(100.0, score)), 1);
    const t = touchIdx.length;
    let grade = score >= 75 && t >= 4 ? "S" : score >= 60 && t >= 3 ? "A" : score >= 40 && t >= 3 ? "B" : "C";
    if (pierce >= t) grade = "C";
    return { score, grade, detail: { err: err == null ? null : pyRound(err, 2), react: pyRound(react, 2), pierce, span, weekly } };
  }

  function weeklyBars(closed, liveD = null) {
    const out = [];
    let cur = null, ck = null;
    for (const b of closed) {
      const k = isoWeek(b.d);
      if (cur != null && k === ck) {
        if (b.h > cur.h) { cur.h = b.h; cur.hd = b.d; }
        if (b.l < cur.l) { cur.l = b.l; cur.ld = b.d; }
        cur.c = b.c;
      } else {
        if (cur != null) out.push(cur);
        cur = { d: b.d, o: b.o, h: b.h, l: b.l, c: b.c, hd: b.d, ld: b.d };
        ck = k;
      }
    }
    if (cur != null && (liveD == null || isoWeek(liveD) !== ck)) out.push(cur);
    return out;
  }

  function detectWeekly(sym, closed, liveD, det) {
    const wk = weeklyBars(closed, liveD).slice(-156);
    if (wk.length < 60) return [];
    const wa = atrSeries(wk), pct = [];
    for (let i = 0; i < wk.length; i++) if (wa[i] && wk[i].c) pct.push(wa[i] / wk[i].c);
    pct.sort((p, q) => p - q);
    const wtol = Math.min(0.05, Math.max(0.006, det.tol_atr * (pct.length ? pct[pct.length >> 1] : 0.05)));
    const tl = trendlines(wk, { k: 3, tol: wtol, log: true, minSpan: 6 }), out = [];
    for (const side of ["sup", "res"]) {
      for (const L of tl[side]) {
        const [ka, kd] = side === "sup" ? ["l", "ld"] : ["h", "hd"];
        const a = wk[L.a], b = wk[L.b];
        if (a[kd] >= b[kd]) continue;
        out.push({ id: `${sym}:${side}:W:${a[kd]}:${b[kd]}`, kind: "auto", side, d1: a[kd], p1: a[ka], d2: b[kd], p2: b[ka], window: "주봉", tf: "1w", score: L.score });
      }
    }
    return out;
  }

  function confluence(x, ctx, lvls, others) {
    const A = ctx.atr, L = x.now, out = [];
    for (const p of [20, 60, 120, 200]) { const v = ctx.ma[p]; if (v && Math.abs(v - L) <= ZONE * A) out.push(`MA${p}`); }
    out.push(...lvls.filter((lv) => Math.abs(lv.price - L) <= ZONE * A).map((lv) => `수평${lv.price < ctx.P ? "지지" : "저항"}(${lv.touches})`).slice(0, 1));
    const n = others.filter((o) => o !== x && o.side === x.side && o.status !== "expired" && Math.abs(o.now - L) <= ZONE * A).length;
    if (n) out.push(`빗각 겹침 ${n + 1}`);
    return out;
  }

  function plan(x, ctx, lines, lvls) {
    if (x.side !== "sup") return null;
    const A = ctx.atr, P = ctx.P, stop = x.now - ZONE * A;
    const targets = [...lines.filter((o) => o.side === "res" && o.status !== "expired" && o.now > P + ZONE * A).map((o) => [o.now, "저항 빗각"]),
      ...lvls.filter((lv) => lv.price > P + ZONE * A).map((lv) => [lv.price, "수평 저항"])];
    let tgt = targets.length ? sortBy(targets, (t) => [t[0], t[1]])[0] : null;
    if (!tgt && x.kind === "auto" && x.status === "valid" && x._ln.m > 0) {
      const ln = x._ln, closed = ctx.closed;
      let off = -Infinity;
      for (let i = ln.i1; i < closed.length; i++) off = Math.max(off, Math.log(closed[i].h) - ln.logAt(i));
      const ch = Math.exp(ln.logAt(ctx.bars.length - 1) + off);
      if (P + ZONE * A < ch && ch <= P + 6 * A) tgt = [ch, "채널 상단"];
    }
    if (!tgt) {
      const hi = Math.max(...ctx.closed.slice(-252).map((b) => b.h));
      if (hi > P + ZONE * A) tgt = [hi, "기간 고점"];
    }
    const rr = tgt && P > stop ? (tgt[0] - P) / (P - stop) : null;
    return { stop, target: tgt ? tgt[0] : null, target_kind: tgt ? tgt[1] : null, rr };
  }

  function miniSegment(x, nBars, width) {
    const ln = x._ln, s0 = nBars - width, a = Math.max(ln.i1, s0), b = nBars - 1 + 2;
    return [a - s0, pyRound(ln.at(a), 10), b - s0, pyRound(ln.at(b), 10)];
  }

  function context(bars, live, market, det, cfg) {
    const closed = live && bars.length > 1 ? bars.slice(0, -1) : bars;
    const atrs = atrSeries(closed);
    const A = atrs[atrs.length - 1] || closed[closed.length - 1].c * 0.02;
    const P = bars[bars.length - 1].c, closes = bars.map((b) => b.c);
    const ma = {};
    for (const p of [20, 60, 120, 200]) ma[p] = smaAt(closes, p, closes.length - 1);
    return { bars, closed, dates: bars.map((b) => b.d), atrs, atr: A, atr_pct: (A / P) * 100, pivots: pivots(closed, det.k), k: det.k,
             tol: tolFor(closed, det), cfg, market, live: !!(live && bars.length > 1), P, last: bars[bars.length - 1], ma };
  }

  TR.lines = { ZONE, RETEST_BARS, TRACK_BARS, CLEAN_EPS, CLEAN_SHIFT, flip, priceAt, tolFor, windowsFor, Line, detect, lowerHull, envelope,
               smaAt, trendScore, levels, evaluate, quality, weeklyBars, detectWeekly, confluence, plan, miniSegment, context };
})(typeof window !== "undefined" ? window : globalThis);
