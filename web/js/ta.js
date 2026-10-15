// 기술적 분석 엔진 — 지표 계산 + 빗각(추세선) 자동 탐지 + 수평 지지·저항 + 지지 추세매매 요약.
// 입력 bars: [{ d: "YYYY-MM-DD", o, h, l, c, v }] (오래된 → 최신). 순수 계산만 하고 화면은 모른다.
TR.ta = (() => {
  // ---------- 지표 ----------
  function sma(a, n) {
    const out = Array(a.length).fill(null);
    let s = 0;
    for (let i = 0; i < a.length; i++) {
      s += a[i];
      if (i >= n) s -= a[i - n];
      if (i >= n - 1) out[i] = s / n;
    }
    return out;
  }
  function ema(a, n) {
    const out = Array(a.length).fill(null), k = 2 / (n + 1);
    let prev = null;
    for (let i = 0; i < a.length; i++) {
      if (a[i] == null) continue;
      prev = prev == null ? a[i] : a[i] * k + prev * (1 - k);
      out[i] = prev;
    }
    return out;
  }
  function rsi(c, n = 14) {
    const out = Array(c.length).fill(null);
    let g = 0, l = 0;
    for (let i = 1; i < c.length; i++) {
      const d = c[i] - c[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
      if (i <= n) { g += up; l += dn; if (i === n) { g /= n; l /= n; out[i] = 100 - 100 / (1 + g / (l || 1e-9)); } continue; }
      g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n;      // Wilder 평활
      out[i] = 100 - 100 / (1 + g / (l || 1e-9));
    }
    return out;
  }
  function macd(c, f = 12, s = 26, sig = 9) {
    const ef = ema(c, f), es = ema(c, s);
    const m = c.map((_, i) => (i >= s - 1 ? ef[i] - es[i] : null));
    const sg = ema(m.map((v) => v), sig);
    return { macd: m, signal: m.map((v, i) => (v == null ? null : sg[i])), hist: m.map((v, i) => (v == null || sg[i] == null ? null : v - sg[i])) };
  }
  function bb(c, n = 20, k = 2) {
    const mid = sma(c, n);
    const up = [], lo = [];
    for (let i = 0; i < c.length; i++) {
      if (mid[i] == null) { up.push(null); lo.push(null); continue; }
      let v = 0;
      for (let j = i - n + 1; j <= i; j++) v += (c[j] - mid[i]) ** 2;
      const sd = Math.sqrt(v / n);
      up.push(mid[i] + k * sd); lo.push(mid[i] - k * sd);
    }
    return { mid, up, lo };
  }

  // ---------- 봉 변환 ----------
  function weekly(bars) {
    const out = [];
    for (const b of bars) {
      const dt = new Date(b.d + "T00:00:00Z");
      const monday = new Date(dt - ((dt.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
      const w = out[out.length - 1];
      if (w && w.wk === monday) { w.h = Math.max(w.h, b.h); w.l = Math.min(w.l, b.l); w.c = b.c; w.v += b.v || 0; w.dEnd = b.d; }
      else out.push({ wk: monday, d: b.d, dEnd: b.d, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 });
    }
    return out;
  }

  // ---------- 스윙 고점·저점 ----------
  function pivots(bars, k) {
    const highs = [], lows = [];
    for (let i = k; i < bars.length - k; i++) {
      let hi = true, lo = true;
      for (let j = i - k; j <= i + k; j++) {
        if (j === i) continue;
        if (bars[j].h > bars[i].h) hi = false;
        if (bars[j].l < bars[i].l) lo = false;
      }
      if (hi) highs.push(i);
      if (lo) lows.push(i);
    }
    // 최근 k봉 안의 극값은 아직 확정 전 → 기준점으로는 쓰지 않고 '터치' 판정에만 쓴다
    const n = bars.length, tail = bars.slice(n - k), tailHighs = [], tailLows = [];
    if (tail.length) {
      const li = n - k + tail.reduce((m, b, j) => (b.l < tail[m].l ? j : m), 0);
      const hi = n - k + tail.reduce((m, b, j) => (b.h > tail[m].h ? j : m), 0);
      if (bars.slice(Math.max(0, li - k), li).every((b) => b.l >= bars[li].l)) tailLows.push(li);
      if (bars.slice(Math.max(0, hi - k), hi).every((b) => b.h <= bars[hi].h)) tailHighs.push(hi);
    }
    return { highs, lows, tailHighs, tailLows };
  }

  // ---------- 빗각(추세선) 자동 탐지 ----------
  // 두 스윙 저점(고점)을 잇는 선 중, 그 뒤 종가가 선을 뚫지 않은 선을 후보로 하고
  // 터치 횟수·길이·최근성으로 점수를 매긴다. log=true면 로그 가격 공간에서 직선.
  function trendlines(bars, { k = 5, tol = 0.012, log = false, minSpan = 8 } = {}) {
    const f = log ? Math.log : (x) => x, n = bars.length;
    const { highs, lows, tailHighs, tailLows } = pivots(bars, k);
    const tolY = (p) => (log ? Math.log(1 + tol) : p * tol);
    const last = bars[n - 1].c, near = (v) => v > last * 0.65 && v < last * 1.35;   // 현재가 ±35% 밖의 선은 무의미
    const build = (idx, side, touchIdx) => {
      const out = [];
      const val = (i) => (side === "sup" ? bars[i].l : bars[i].h);
      for (let x = 0; x < idx.length; x++) for (let y = x + 1; y < idx.length; y++) {
        const a = idx[x], b = idx[y];
        if (b - a < minSpan) continue;
        const ya = f(val(a)), m = (f(val(b)) - ya) / (b - a);
        const at = (i) => ya + m * (i - a);
        let broken = null, violations = 0;
        for (let i = a + 1; i < n; i++) {
          const c = f(bars[i].c), t = tolY(bars[i].c);
          const bad = side === "sup" ? c < at(i) - t : c > at(i) + t;
          if (bad) {
            if (i <= b) { violations = 99; break; }           // 두 기준점 사이에서 뚫리면 무효
            if (++violations >= 2 && broken == null) broken = i;
          } else violations = 0;
        }
        if (violations >= 99) continue;
        if (broken != null && broken < n - 15) continue;       // 오래전에 깨진 선은 버림(최근 이탈만 표시)
        const touches = touchIdx.filter((p) => p >= a && Math.abs(f(val(p)) - at(p)) <= tolY(val(p)) * 1.5).length;
        if (touches < 2) continue;
        const nowP = log ? Math.exp(at(n - 1)) : at(n - 1);
        if (!near(nowP)) continue;
        const score = touches * 3 + (b - a) / 15 + (b / n) * 4 - (broken != null ? 3 : 0);
        out.push({ side, a, b, ya, m, touches, broken, score, log });
      }
      out.sort((p, q) => q.score - p.score);
      // 거의 같은 선은 하나만
      const picked = [];
      for (const L of out) {
        const now = L.ya + L.m * (n - 1 - L.a);
        if (picked.every((P) => Math.abs((P.ya + P.m * (n - 1 - P.a)) - now) > tolY(bars[n - 1].c) * 3 || Math.sign(P.m) !== Math.sign(L.m))) picked.push(L);
        if (picked.length >= 3) break;
      }
      return picked;
    };
    const sup = build(lows, "sup", [...lows, ...tailLows]), res = build(highs, "res", [...highs, ...tailHighs]);
    const inv = log ? Math.exp : (x) => x;
    const priceAt = (L, i) => inv(L.ya + L.m * (i - L.a));
    // 지지선에 평행한 채널 상단
    const channel = (L) => {
      let off = -Infinity;
      for (let i = L.a; i < n; i++) off = Math.max(off, f(bars[i].h) - (L.ya + L.m * (i - L.a)));
      return { ...L, side: "chan", ya: L.ya + off, touches: 0 };
    };
    return { sup, res, priceAt, channel, pivots: { highs, lows } };
  }

  // ---------- 수평 지지·저항 ----------
  function levels(bars, { k = 5, band = 0.015 } = {}) {
    const { highs, lows } = pivots(bars, k);
    const pts = [...highs.map((i) => bars[i].h), ...lows.map((i) => bars[i].l)].sort((a, b) => a - b);
    const out = [];
    for (const p of pts) {
      const last = out[out.length - 1];
      if (last && p <= last.avg * (1 + band)) { last.n++; last.sum += p; last.avg = last.sum / last.n; }
      else out.push({ n: 1, sum: p, avg: p });
    }
    return out.filter((x) => x.n >= 2).map((x) => ({ price: x.avg, touches: x.n }));
  }

  // ---------- 피보나치 ----------
  function fib(bars) {
    let hi = 0, lo = 0;
    bars.forEach((b, i) => { if (b.h > bars[hi].h) hi = i; if (b.l < bars[lo].l) lo = i; });
    const H = bars[hi].h, L = bars[lo].l, up = hi > lo;         // 저점→고점이면 상승 후 되돌림
    const ratios = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
    return { up, H, L, hi, lo, levels: ratios.map((r) => ({ r, price: up ? H - (H - L) * r : L + (H - L) * r })) };
  }

  // ---------- ATR (Wilder 14) ----------
  function atr(bars, n = 14) {
    const out = Array(bars.length).fill(null);
    let a = null;
    for (let i = 1; i < bars.length; i++) {
      const b = bars[i], p = bars[i - 1].c;
      const tr = Math.max(b.h - b.l, Math.abs(b.h - p), Math.abs(b.l - p));
      a = a == null ? tr : (a * (n - 1) + tr) / n;
      if (i >= n) out[i] = a;
    }
    return out;
  }

  // ---------- 추세 점수 (-4 ~ +4) ----------
  // 현재가 vs MA60 · MA60 기울기(10봉) · MA20 vs MA60 · 스윙 구조(고점·저점이 높아지는지)
  function trendScore(bars, ma, piv) {
    const n = bars.length, c = bars[n - 1].c, m20 = ma[20][n - 1], m60 = ma[60][n - 1], m60p = ma[60][n - 11];
    const parts = [];
    if (m60 != null) parts.push(["현재가 vs MA60", c > m60 ? 1 : -1]);
    if (m60 != null && m60p != null) { const sl = (m60 / m60p - 1) * 100; parts.push(["MA60 기울기", sl > 0.5 ? 1 : sl < -0.5 ? -1 : 0]); }
    if (m20 != null && m60 != null) parts.push(["MA20 vs MA60", m20 > m60 ? 1 : -1]);
    const H = piv.highs.slice(-2), L = piv.lows.slice(-2);
    if (H.length === 2 && L.length === 2) {
      const hh = bars[H[1]].h > bars[H[0]].h, hl = bars[L[1]].l > bars[L[0]].l;
      parts.push(["스윙 구조", hh && hl ? 1 : !hh && !hl ? -1 : 0]);
    }
    const score = parts.reduce((a, p) => a + p[1], 0);
    const label = score >= 3 ? "강한 상승" : score >= 1 ? "상승 우위" : score <= -3 ? "강한 하락" : score <= -1 ? "하락 우위" : "중립·횡보";
    return { score, label, parts };
  }

  // ---------- 지지 추세매매 관점 요약 ----------
  // 기준 지지 = 내 빗각 → 자동 빗각(3 ATR 이내) → 가장 가까운 수평 지지·이평. 관찰 구간·무효화·목표는 ATR로 변동성에 맞춘다.
  function tradeView(bars, ctx) {
    const n = bars.length, c = bars[n - 1].c;
    const A = atr(bars)[n - 1] || c * 0.02, atrPct = (A / c) * 100;
    const ma60 = ctx.ma[60], ma20 = ctx.ma[20];
    const slope60 = ma60[n - 1] != null && ma60[n - 11] != null ? (ma60[n - 1] / ma60[n - 11] - 1) * 100 : null;
    const ts = trendScore(bars, ctx.ma, ctx.tl.pivots);
    const trend = ts.score >= 1 ? "상승" : ts.score <= -1 ? "하락" : "횡보";

    const lines = [
      ...ctx.userLines.map((u) => ({ kind: "내 빗각", price: u.now, line: true, user: true, broken: c < u.now - A })),
      ...ctx.tl.sup.map((L) => ({ kind: L.m >= 0 ? "상승 빗각" : "하락 빗각", price: ctx.tl.priceAt(L, n - 1), line: true, broken: L.broken != null, touches: L.touches })),
    ];
    const others = [
      ...ctx.lv.map((x) => ({ kind: `수평 지지(${x.touches}회)`, price: x.price })),
      ...[[60, "MA60"], [120, "MA120"]].filter(([p]) => ctx.ma[p]?.[n - 1] != null && ts.score >= 1).map(([p, k]) => ({ kind: k, price: ctx.ma[p][n - 1] })),
    ];
    const below = (arr) => arr.filter((x) => x.price <= c * 1.003 && !x.broken).sort((a, b) => b.price - a.price);
    const lineSup = below(lines.filter((x) => x.user))[0] || below(lines)[0] || null;       // 빗각 중 가장 가까운 것(내 빗각 우선)
    const nearest = below([...lines, ...others])[0] || null;
    const sup = lineSup && (lineSup.user || c - lineSup.price <= 3 * A) ? lineSup : nearest;
    const brokenRecent = lines.filter((x) => x.broken).sort((a, b) => Math.abs(a.price - c) - Math.abs(b.price - c))[0];

    const resists = [
      ...ctx.tl.res.filter((L) => L.broken == null).map((L) => ({ kind: "저항 빗각", price: ctx.tl.priceAt(L, n - 1) })),
      ...ctx.lv.map((x) => ({ kind: `수평 저항(${x.touches}회)`, price: x.price })),
    ].filter((x) => x.price > c + A * 0.8).sort((a, b) => a.price - b.price);
    let target = resists[0] || null;
    // 위쪽 저항이 없으면(신고가권) 상승 지지 빗각의 평행 채널 상단을 대안 목표로
    const hi52 = Math.max(...bars.map((b) => b.h));
    if (!target && hi52 > c + A * 0.8) target = { kind: "직전 고점", price: hi52 };   // 탐지된 저항이 없으면 기간 내 최고가
    const athZone = !target && c >= hi52 * 0.9;
    if (!target) {
      const up = ctx.tl.sup.find((L) => L.m > 0 && L.broken == null);
      if (up) {
        const ch = ctx.tl.channel(up), p = ctx.tl.priceAt(ch, n - 1);
        if (p > c + A * 0.8 && p <= c + A * 6) target = { kind: "채널 상단", price: p };   // 너무 먼 채널(6 ATR 초과)은 목표로 무의미
      }
    }

    const dist = sup ? (c / sup.price - 1) * 100 : null;
    const near = sup && c - sup.price <= 1.5 * A;
    let state = "기준 지지 없음 — 관망", tone = "neutral";
    if (sup && near) {
      if (ts.score >= 0) { state = "지지 근접 — 반등 확인 구간"; tone = "expand"; }
      else { state = "하락 추세 속 지지 근접 — 역추세 주의"; tone = "neutral"; }
    } else if (sup) { state = ts.score >= 1 ? "지지 위 추세 진행 — 눌림 대기" : "지지와 거리 있음 — 관망"; tone = "neutral"; }
    if (brokenRecent && !sup) { state = "빗각 지지 이탈 — 재지지 확인 전까지 관망"; tone = "slow"; }
    else if (brokenRecent && brokenRecent.price > sup.price) {           // 더 가까운 빗각이 최근 깨졌고 아래 지지가 남아 있음
      state = ts.score >= 1 ? "단기 빗각 이탈 — 아래 지지 확인 구간" : "빗각 이탈 + 약한 추세 — 관망";
      tone = ts.score >= 1 ? "neutral" : "slow";
    }

    const stop = sup ? sup.price - A : null;
    const rr = sup && target && c > stop ? (target.price - c) / (c - stop) : null;

    // 저항 돌파 + 거래량 확인(돌파 봉 거래량 / 직전 20봉 평균)
    const bL = ctx.tl.res.find((L) => L.broken != null);
    let breakout = null;
    if (bL) {
      const i = bL.broken, vAvg = bars.slice(Math.max(0, i - 20), i).reduce((a, b) => a + (b.v || 0), 0) / Math.min(20, i || 1);
      breakout = { price: ctx.tl.priceAt(bL, n - 1), ago: n - 1 - i, volRatio: vAvg && bars[i].v ? bars[i].v / vAvg : null };
    }
    return { trend, trendScore: ts, slope60, atr: A, atrPct, sup, lineSup, dist, near, target, athZone, hi52, stop, rr, state, tone, brokenRecent, breakout,
             zone: sup ? [sup.price, sup.price + A] : null,
             aboveMA20: ma20[n - 1] != null ? (c / ma20[n - 1] - 1) * 100 : null };
  }

  return { sma, ema, rsi, macd, bb, atr, weekly, pivots, trendlines, levels, fib, trendScore, tradeView };
})();
