// 기관 거래량 포착(매집 후보) · 장 시간 판정 — scripts/volume.py · markets.py를 그대로 옮긴 것.
(function (G) {
  const TR = G.TR;
  const { sum, parts } = TR.core;

  function screen(bars, live, cfg) {
    if (!(cfg.on ?? true)) return null;
    const lb = Math.trunc(cfg.lookback ?? 3), baseN = Math.trunc(cfg.base_days ?? 20);
    const ratio = Number(cfg.ratio ?? 3.0), maxMove = Number(cfg.max_move ?? 5.0), n = bars.length;
    if (n < lb + baseN + 1 || !bars.slice(-(lb + baseN)).some((b) => b.v)) return null;
    const baseVols = bars.slice(n - lb - baseN, n - lb).map((b) => b.v);
    if (baseVols.filter((v) => v).length < baseN * 0.75) return null;
    const base = sum(baseVols) / baseN;
    if (base <= 0) return null;
    const ref = bars[n - lb - 1].c, P = bars[n - 1].c, windowChg = (P / ref - 1) * 100, spikes = [];
    for (let i = n - lb; i < n; i++) {
      const b = bars[i], prev = bars[i - 1].c, r = b.v ? b.v / base : 0, chg = (b.c / prev - 1) * 100;
      if (r >= ratio && Math.abs(chg) <= maxMove) {
        const rng = b.h - b.l;
        spikes.push({ d: b.d, ratio: r, chg, range_pct: (rng / prev) * 100, clv: rng ? (b.c - b.l) / rng : 0.5,
                      lower_wick: rng ? (Math.min(b.o, b.c) - b.l) / rng : 0, upper_wick: rng ? (b.h - Math.max(b.o, b.c)) / rng : 0,
                      candle: b.c >= b.o ? "양봉" : "음봉", days_ago: n - 1 - i, live: live && i === n - 1 });
      }
    }
    if (!spikes.length || Math.abs(windowChg) > maxMove) return null;
    const top = spikes.reduce((m, s) => (s.ratio > m.ratio ? s : m), spikes[0]);
    const yr = bars.slice(-252), hi = Math.max(...yr.map((b) => b.h)), lo = Math.min(...yr.map((b) => b.l));
    const pos = hi > lo ? (P - lo) / (hi - lo) : 0.5, closes = bars.map((b) => b.c), ma = {};
    for (const p of [60, 120]) if (closes.length >= p) ma[p] = sum(closes.slice(-p)) / p;
    const tags = [];
    if (spikes.length >= 2) tags.push("연속 급증");
    if (top.lower_wick >= 0.45) tags.push("긴 아래꼬리");
    if (pos <= 0.3) tags.push("1년 하단권"); else if (pos >= 0.85) tags.push("1년 상단권");
    const view = pos >= 0.85 && (top.upper_wick >= 0.45 || top.clv < 0.35) ? "분산 주의" : "매집 후보";
    return { spike_d: top.d, ratio: top.ratio, day_chg: top.chg, window_chg: windowChg, range_pct: top.range_pct, clv: top.clv, candle: top.candle,
             days_ago: top.days_ago, live: top.live, count: spikes.length, base_vol: base, spike_vol: bars[n - 1 - top.days_ago].v,
             pos_1y: pos, vs_ma60: 60 in ma ? (P / ma[60] - 1) * 100 : null, vs_ma120: 120 in ma ? (P / ma[120] - 1) * 100 : null,
             tags, view, spikes: spikes.map((s) => ({ d: s.d, ratio: s.ratio, chg: s.chg, candle: s.candle })) };
  }

  // ---------- 장 시간(공휴일은 따로 다루지 않음 — 휴장일엔 새 봉이 없어 알림이 생기지 않는다) ----------
  const HOURS = { krx: ["Asia/Seoul", 9 * 60, 15 * 60 + 30], us: ["America/New_York", 9 * 60 + 30, 16 * 60] };
  const LABEL = { crypto: "코인", krx: "한국장", us: "미국장", global: "해외·매크로" };
  const AFTER_CLOSE = 45;

  function marketOf(item) {
    if (item.market) return item.market;
    if (item.src === "binance" || item.src === "bybit" || item.group === "crypto") return "crypto";
    const sym = item.sym.toUpperCase();
    if (item.src === "naver" || sym.endsWith(".KS") || sym.endsWith(".KQ") || ["^KS11", "^KQ11", "^KS200"].includes(sym)) return "krx";
    if (sym.endsWith("=F") || sym.endsWith("=X") || item.group === "macro") return "global";
    return "us";
  }
  function globalOn(ms) {
    const k = parts(ms, "Asia/Seoul"), t = k.hour * 60 + k.minute;
    if (k.weekday === 5) return t < 7 * 60;
    if (k.weekday === 6) return false;
    if (k.weekday === 0) return t >= 6 * 60;
    return true;
  }
  function inSession(market, ms, extra = 0) {
    const [tz, s, e] = HOURS[market], p = parts(ms, tz), t = p.hour * 60 + p.minute + p.second / 60;
    return p.weekday < 5 && s <= t && t < e + extra;
  }
  const isOpen = (market, ms = Date.now()) => (market === "crypto" ? true : market === "global" ? globalOn(ms) : inSession(market, ms));
  const isActive = (market, ms = Date.now()) => (market === "crypto" || market === "global" ? isOpen(market, ms) : inSession(market, ms, AFTER_CLOSE));
  const status = (ms = Date.now()) => ({ crypto: isOpen("crypto", ms), krx: isOpen("krx", ms), us: isOpen("us", ms), global: isOpen("global", ms) });

  TR.volume = { screen };
  TR.markets = { HOURS, LABEL, marketOf, isOpen, isActive, status };
})(typeof window !== "undefined" ? window : globalThis);
