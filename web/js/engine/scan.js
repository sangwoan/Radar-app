// 종목 분석(선 후보 → 다듬기 → 평가 → 선 고르기)과 알림 상태 머신 — scripts/scan.py의 analyze · update_state를 1:1로 옮긴 것.
(function (G) {
  const TR = G.TR;
  const { sig, sortBy, sum, pyRound, kstDate, addDays } = TR.core;
  const LN = TR.lines;
  const STATE_VERSION = 2, STAGES = { 0: "", 1: "접근", 2: "근접", 3: "터치" }, MINI = 60;

  function cleanOhlc(o, h, l, c) {
    if (c == null || c <= 0) return null;
    o = o != null && o > 0 ? o : c;
    h = Math.max(...[h, o, c].filter((x) => x != null && x > 0));
    l = Math.min(...[l, o, c].filter((x) => x != null && x > 0));
    return [o, h, l, c];
  }

  function barsOf(raw) {
    const v = raw.v || raw.c.map(() => 0), out = [];
    for (let i = 0; i < raw.c.length; i++) {
      const f = cleanOhlc(raw.o[i], raw.h[i], raw.l[i], raw.c[i]);
      if (f) out.push({ d: raw.d[i], o: f[0], h: f[1], l: f[2], c: f[3], v: v[i] || 0 });
    }
    return out;
  }

  const safeName = (sym) => sym.replace(/[^A-Za-z0-9.\-]/g, "_");
  const hasV = (raw) => !!(raw.v && raw.v.length);                // 파이썬 raw.get("v") — 빈 목록은 거짓

  function labelOf(x, typ) {
    if (typ === "break") return x.orig === "sup" ? "종가 이탈" : "종가 돌파";
    if (typ === "fail") return x.orig === "sup" ? "이탈 실패(복귀)" : "돌파 실패(복귀)";
    if (typ === "confirm") return x.side === "sup" ? "지지 확인 마감" : "저항 확인 마감";
    if (typ === "retest_confirm") return "리테스트 확인";
    let base = STAGES[x.stage];
    if (x.penetrating && x.stage === 3) base = x.side === "sup" ? "이탈 시도" : "돌파 시도";
    return x.status === "broken" ? `리테스트 ${base}` : base;
  }

  function analyze(item, raw, userLines, cfg, registry, wcache = null) {
    const det = cfg.detect, market = TR.markets.marketOf(item), bars = barsOf(raw);
    const ctx = LN.context(bars, !!raw.live, market, det, cfg), closed = ctx.closed, sym = item.sym;
    const lastClosedD = closed[closed.length - 1].d;
    const trackFrom = closed.length > LN.TRACK_BARS ? closed[closed.length - LN.TRACK_BARS - 1].d : closed[0].d;
    let cands = LN.detect(sym, closed, market, ctx.tol, { ...det, lines_per_side: det.candidates_per_side ?? 4 });
    const wk = LN.weeklyBars(closed, bars[bars.length - 1].d), wkey = wk.length ? wk[wk.length - 1].d : null;
    if (wcache && wcache[sym] && wcache[sym].key === wkey) cands = cands.concat(wcache[sym].geos);
    else {
      const wg = LN.detectWeekly(sym, closed, bars[bars.length - 1].d, det);
      cands = cands.concat(wg);
      if (wcache) wcache[sym] = { key: wkey, geos: wg };
    }
    const k = det.k, span = det.min_span, atrs = ctx.atrs, dates = closed.map((b) => b.d);
    const tlog = Math.log(1 + ctx.tol * (det.touch_tol ?? 1.5));
    const env = (g) => LN.envelope(g, closed, atrs, k, span, ctx.pivots[g.side === "sup" ? "lows" : "highs"], tlog, dates);
    const geos = new Map();
    for (const g of cands) {
      const g2 = env(g);
      if (g2 && !geos.has(g2.id)) geos.set(g2.id, g2);
    }
    for (const [gid, reg] of Object.entries(registry)) {
      if (reg.sym !== sym || geos.has(gid) || !((reg.seen || "") >= trackFrom || reg.broken_watch)) continue;
      const g2 = env({ id: gid, kind: "auto", tracked: true, window: reg.window ?? "장기", tf: reg.tf ?? "1d", side: reg.side, d1: reg.d1, p1: reg.p1, d2: reg.d2, p2: reg.p2 });
      if (g2 == null) { delete registry[gid]; continue; }
      if (g2.id !== gid) {
        delete registry[gid];
        registry[g2.id] = { ...reg, d1: g2.d1, p1: g2.p1, d2: g2.d2, p2: g2.p2 };
      }
      if (!geos.has(g2.id)) geos.set(g2.id, g2);
    }
    for (const u of userLines) {
      const g = { id: u.id, kind: "user", side: u.side || "sup", d1: u.d1, p1: u.p1, d2: u.d2, p2: u.p2, note: u.note || "", created: u.created, window: "내 빗각" };
      geos.set(u.id, g);
      if (!u.side) {
        const ln = new LN.Line(g, ctx.dates);
        if (ln.ok) g.side = ctx.P >= ln.at(bars.length - 1) ? "sup" : "res";
      }
    }
    let evals = [];
    for (const g of geos.values()) {
      const x = LN.evaluate(g, ctx);
      if (!x) continue;
      x.tracked = !!g.tracked;
      evals.push(x);
    }
    const uniq = [];
    for (const x of sortBy(evals.filter((x) => x.kind === "auto"), (x) => [-x.q])) {
      if (!uniq.some((u) => u.orig === x.orig && u.status === x.status && Math.abs(u.now - x.now) <= 0.3 * ctx.atr && (u._ln.m > 0) === (x._ln.m > 0))) uniq.push(x);
    }
    evals = uniq.concat(evals.filter((x) => x.kind === "user"));

    const maxLines = det.max_lines ?? 2, showMin = det.show_min_quality ?? 35, minQ = cfg.min_quality ?? 40, minT = cfg.min_touches;
    const band = det.relevance_atr ?? 3;
    const good = (x) => x.q >= minQ && x.touches >= minT;
    const out = evals.filter((x) => x.kind === "user");
    const pool = evals.filter((x) => x.kind === "auto" && x.touches >= minT && ((x.status === "valid" && x.q >= showMin) || (x.status === "broken" && good(x))));
    const rank = (x) => [!good(x), Math.abs(x.gap) > band, -x.q];
    const dup = (x, o) => x === o || (x.side === o.side && Math.abs(x.now - o.now) <= ctx.atr);
    const picked = [];
    for (const side of ["sup", "res"]) {
      const c = sortBy(pool.filter((x) => x.side === side && good(x)), rank);
      if (c.length) picked.push(c[0]);
    }
    for (const x of sortBy(pool, rank)) {
      if (picked.length >= maxLines) break;
      if (!picked.some((o) => dup(x, o))) picked.push(x);
    }
    out.push(...picked.slice(0, maxLines));
    const kept = new Set(out.map((x) => x.id));
    for (const x of evals) {
      if (x.kind !== "auto") continue;
      if (kept.has(x.id)) {
        const reg = registry[x.id] || (registry[x.id] = { d1: x.d1, p1: x.p1, d2: x.d2, p2: x.p2, side: x.orig, sym, first: lastClosedD });
        Object.assign(reg, { seen: lastClosedD, window: x.window, tf: x.tf, broken_watch: x.status === "broken" });
      } else if (x.tracked && (x.status === "expired" || x.q < showMin)) delete registry[x.id];
    }
    for (const x of out) x.alertable = (x.kind === "user" && cfg.include_user) || (x.kind === "auto" && cfg.include_auto && x.q >= minQ && x.touches >= cfg.min_touches);
    const lvls = LN.levels(closed, (LN.ZONE * ctx.atr_pct) / 100);
    for (const x of out) {
      x.conf = LN.confluence(x, ctx, lvls, out);
      x.plan = LN.plan(x, ctx, out, lvls);
      x.mini = LN.miniSegment(x, bars.length, Math.min(MINI, bars.length));
    }
    const order = { valid: 0, broken: 1, expired: 2 };
    const outSorted = sortBy(out, (x) => [order[x.status], Math.abs(x.gap)]);
    const ts = LN.trendScore(closed);
    const alive = outSorted.filter((x) => x.status !== "expired" && x.alertable);
    const near = alive.length ? alive.reduce((m, x) => (Math.abs(x.gap) < Math.abs(m.gap) ? x : m), alive[0]) : null;
    const P = ctx.P, prev = bars.length > 1 ? bars[bars.length - 2].c : P;
    const vol = bars.map((b) => b.v).filter((v) => v);
    const vr = vol.length >= 20 && sum(vol.slice(-20)) ? (sum(vol.slice(-5)) / 5) / (sum(vol.slice(-20)) / 20) : null;
    const m = bars.slice(-MINI), vcfg = cfg.volume || {};
    const pick = (o, ks) => Object.fromEntries(ks.map((k2) => [k2, o[k2]]));
    return {
      sym, name: item.name, group: item.group, src: item.src || "yahoo", tv: item.tv ?? null, market, file: safeName(sym), live: ctx.live, stale: !!raw.stale,
      fetched_at: raw.fetched_at ?? null, date: bars[bars.length - 1].d, closed_d: lastClosedD, price: P, chg: (P / prev - 1) * 100,
      atr: ctx.atr, atr_pct: ctx.atr_pct, tol: ctx.tol, trend: ts, ma: Object.fromEntries(Object.entries(ctx.ma).map(([k2, v]) => [String(k2), v])),
      vol_ratio: vr, lines: outSorted, nearest: near ? pick(near, ["id", "gap", "gap_pct", "stage", "side", "kind", "status"]) : null,
      stage: Math.max(0, ...alive.map((x) => x.stage)), mcap: item.mcap ?? null, mcap_cur: market === "krx" ? "KRW" : "USD",
      vol: hasV(raw) && (vcfg.groups || []).includes(item.group) ? TR.volume.screen(bars, ctx.live, vcfg) : null,
      mini: { d0: m[0].d, o: m.map((b) => sig(b.o, 6)), h: m.map((b) => sig(b.h, 6)), l: m.map((b) => sig(b.l, 6)), c: m.map((b) => sig(b.c, 6)) },
      vstat: hasV(raw) && ["us", "kr", "crypto"].includes(item.group) ? {
        d: bars.slice(-6).map((b) => b.d), v: bars.slice(-26).map((b) => b.v), c: bars.slice(-27).map((b) => sig(b.c, 6)),
        o: bars.slice(-6).map((b) => sig(b.o, 6)), h: bars.slice(-6).map((b) => sig(b.h, 6)), l: bars.slice(-6).map((b) => sig(b.l, 6)),
        hi1y: sig(Math.max(...bars.slice(-252).map((b) => b.h)), 6), lo1y: sig(Math.min(...bars.slice(-252).map((b) => b.l)), 6),
      } : null,
    };
  }

  function makeEvent(r, x, typ, at) {
    const ts = r.trend.score;
    const withTrend = typ === "break" ? (x.orig === "res" && ts >= 1) || (x.orig === "sup" && ts <= -1) : (x.side === "sup" && ts >= 1) || (x.side === "res" && ts <= -1);
    const e = { at, type: typ, label: labelOf(x, typ), sym: r.sym, name: r.name, group: r.group, market: r.market, tv: r.tv, line_id: x.id, kind: x.kind,
                side: x.side, orig: x.orig, status: x.status, window: x.window, grade: x.grade, q: x.q ?? null, touches: x.touches, stage: x.stage,
                price: r.price, line: x.now, gap: pyRound(x.gap, 2), gap_pct: pyRound(x.gap_pct, 2), atr_pct: pyRound(r.atr_pct, 2),
                trend: r.trend.label, trend_score: ts, with_trend: withTrend,
                counter_trend: (x.side === "sup" && ts <= -2) || (x.side === "res" && ts >= 2),
                conf: x.conf || [], plan: x.plan ?? null, note: x.note || "", steep: x.steep || false };
    if (typ === "break") e.vol_ratio = r.break_vol ?? null;
    return e;
  }

  function volEvent(r, at) {
    const v = r.vol, near = r.nearest;
    return { at, type: "volume", label: `거래량 ${v.ratio.toFixed(1)}배 · 등락 ${v.day_chg >= 0 ? "+" : ""}${v.day_chg.toFixed(1)}%`, sym: r.sym, name: r.name, group: r.group,
             market: r.market, tv: r.tv, kind: "volume", side: "sup", orig: "sup", status: "valid", grade: "V", touches: null, stage: 0, price: r.price,
             line: null, gap: near ? Math.abs(near.gap) : 99, gap_pct: 0, atr_pct: pyRound(r.atr_pct, 2), trend: r.trend.label, trend_score: r.trend.score,
             with_trend: false, counter_trend: false, conf: [], plan: null, note: "", vol: v,
             near_line: near ? { side: near.side, gap: near.gap, gap_pct: near.gap_pct } : null };
  }

  function breakVol(closed) {
    const v = closed.map((b) => b.v);
    if (v.length < 21 || !v[v.length - 1] || !sum(v.slice(-21, -1))) return null;
    return v[v.length - 1] / (sum(v.slice(-21, -1)) / 20);
  }

  const GR = { S: 4, A: 3, U: 3, B: 2 };
  function dedupeZone(evs, r, Z, day) {
    const out = [], A = r.atr;
    for (const e of sortBy(evs, (e) => [-(GR[e.grade] ?? 1), -(e.q || 0)])) {
      const key = `${r.sym}:${e.side}:${e.label}`, zones = Z[key] || (Z[key] = []);
      const d = out.find((o) => o.side === e.side && o.label === e.label && Math.abs(o.line - e.line) <= LN.ZONE * A);
      if (d) { d.overlap = (d.overlap || 1) + 1; continue; }
      if (zones.some((z) => z[1] === day && Math.abs(z[0] - e.line) <= LN.ZONE * A)) continue;
      zones.push([e.line, day]);
      out.push(e);
    }
    return out;
  }

  // nowMs: 이번 스캔 시각(ms). 반환: 새 알림 이벤트 목록(state 제자리 갱신)
  function updateState(results, state, cfg, nowMs = Date.now(), silent = false) {
    const seed = state.v !== STATE_VERSION;
    if (seed) for (const k of ["lines", "events", "zones", "pending", "digest"]) delete state[k];
    const L = state.lines || (state.lines = {});
    for (const k of Object.keys(L)) if (!L[k] || typeof L[k] !== "object" || !("eff" in L[k])) delete L[k];
    const E = state.events || (state.events = {}), Z = state.zones || (state.zones = {});
    const pct = cfg.mode === "pct";
    const fullReset = pct ? cfg.reset_pct : cfg.reset_atr, partReset = pct ? cfg.near_pct + 1.5 : cfg.near_atr + 0.5;
    const at = TR.core.isoKST(nowMs), events = [];

    const one = (r) => {
      const day = r.date, mine = [];
      for (const x of r.lines) {
        let s = L[x.id];
        if (s && !("eff" in s)) s = undefined;
        const metric = pct ? x.gap_pct : x.gap;
        x.approaching = !!(s && s.gap != null && x.gap < s.gap - 0.1);
        if (s == null || seed) {
          const sent = {};
          for (let k = 1; k <= x.stage; k++) sent[String(k)] = day;
          L[x.id] = { stage: x.stage, gap: pyRound(x.gap, 3), day, eff: x.side, episode: false, sent, seen: day };
          for (const ce of x.close_events) E[`${x.id}:${ce.type}:${ce.d}`] = day;
          continue;
        }
        if (silent || r.stale) continue;
        s.day = day;
        if (s.eff !== x.side) Object.assign(s, { eff: x.side, stage: 2, episode: false, sent: {} });
        if (x.status !== "broken") {
          if (metric >= fullReset) { s.stage = 0; s.episode = false; }
          else if (metric >= partReset && s.stage > 1) { s.stage = 1; s.episode = false; }
        }
        let fired = null;
        const sameBar = x.status === "broken" && x.break_d && day <= x.break_d;
        if (!sameBar && x.stage > s.stage && s.sent[String(x.stage)] !== day) {
          if (x.alertable) { fired = makeEvent(r, x, "stage", at); mine.push(fired); }
          s.sent[String(x.stage)] = day;
          s.stage = x.stage;
          if (x.stage === 3) s.episode = true;
        }
        for (const ce of x.close_events) {
          const k = `${x.id}:${ce.type}:${ce.d}`;
          if (k in E) continue;
          E[k] = day;
          if (ce.type === "confirm" || ce.type === "retest_confirm") {
            if (!s.episode) continue;
            s.episode = false;
          }
          if (x.alertable) {
            if (fired && mine.includes(fired) && (ce.type === "confirm" || ce.type === "retest_confirm")) mine.splice(mine.indexOf(fired), 1);
            mine.push(makeEvent(r, x, ce.type, at));
          }
        }
        s.gap = pyRound(x.gap, 3);
        s.seen = day;
      }
      const out = dedupeZone(mine, r, Z, day);
      const v = r.vol;
      if (v) {
        const k = `${r.sym}:volume:${v.spike_d}`;
        if (!(k in E)) {
          E[k] = day;
          if (!seed && !silent && !r.stale) out.push(volEvent(r, at));
        }
      }
      return out;
    };

    for (const r of results) {
      try { events.push(...one(r)); }
      catch (e) {
        r.state_error = `${e.name}: ${e.message}`.slice(0, 200);
        for (const x of r.lines || []) if (x && typeof x === "object") delete L[x.id];
      }
    }
    const cut = addDays(kstDate(nowMs), -45);
    state.lines = Object.fromEntries(Object.entries(L).filter(([, v]) => (v.seen ?? "9999") >= cut));
    state.events = Object.fromEntries(Object.entries(E).filter(([, v]) => v >= cut));
    state.zones = Object.fromEntries(Object.entries(Z).map(([k, v]) => [k, v.filter((z) => z[1] >= cut)]).filter(([, v]) => v.length));
    state.v = STATE_VERSION;
    return events;
  }

  // 화면용 정리(scan.py run()의 마지막 단계와 같음)
  function finalize(results) {
    for (const r of results) {
      for (const x of r.lines) {
        delete x._ln;
        for (const k of ["now", "p1", "p2"]) x[k] = sig(x[k]);
        for (const k of ["gap", "gap_pct", "slope_month"]) x[k] = pyRound(x[k], 3);
        if (x.plan) x.plan = Object.fromEntries(Object.entries(x.plan).map(([k, v]) => [k, typeof v === "number" ? sig(v) : v]));
      }
    }
    const krwItem = results.find((r) => r.sym === "KRW=X"), krw = krwItem ? krwItem.price : 1400.0;
    for (const r of results) {
      const m = r.mcap;
      r.mcap_usd = m ? (r.mcap_cur === "KRW" ? m / krw : m) : null;
    }
    return results;
  }

  TR.scan = { STATE_VERSION, STAGES, MINI, cleanOhlc, barsOf, safeName, labelOf, analyze, makeEvent, volEvent, breakVol, dedupeZone, updateState, finalize };
})(typeof window !== "undefined" ? window : globalThis);
