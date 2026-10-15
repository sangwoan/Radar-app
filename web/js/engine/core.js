// 엔진 공통 도구 — 폰 앱(웹뷰) · 맥 브라우저 · 노드(검증)에서 똑같이 돈다. 파이썬 엔진과 결과가 같아야 하므로
// 반올림 · 정렬 · 날짜 · 시간대 처리를 파이썬 규칙에 맞춘다(round = 짝수 반올림, sorted = 안정 정렬, isocalendar 등).
(function (G) {
  const TR = (G.TR = G.TR || {});

  // 파이썬 round(x, nd): 정확히 가운데(이진수 값 기준)일 때만 짝수 쪽, 나머지는 보통 반올림
  function pyRound(x, nd = 0) {
    if (x == null || !isFinite(x)) return x;
    const neg = x < 0, s = Math.abs(x).toFixed(nd + 20);
    const cut = s.indexOf(".") + 1 + nd;
    if (!/^50*$/.test(s.slice(cut))) return Number(x.toFixed(nd));
    const kept = s.slice(0, nd === 0 ? cut - 1 : cut);
    let r = Number(kept);
    if (+kept[kept.length - 1] % 2 === 1) r = Number((r + Math.pow(10, -nd)).toFixed(nd));
    return neg ? -r : r;
  }

  // 파이썬 float(f"{v:.7g}") — 유효숫자 sig자리
  const sig = (v, n = 7) => (v == null ? null : Number(Number(v).toPrecision(n)));

  // 파이썬 bisect_left
  function bisectLeft(a, x) {
    let lo = 0, hi = a.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (a[mid] < x) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  // 파이썬 statistics.median
  function median(xs) {
    const a = [...xs].sort((p, q) => p - q), n = a.length;
    if (!n) return null;
    return n % 2 ? a[(n - 1) >> 1] : (a[n / 2 - 1] + a[n / 2]) / 2;
  }

  // 튜플 비교(파이썬 sorted의 key가 튜플일 때): 불리언은 false < true
  function cmpTuple(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const x = a[i], y = b[i];
      if (x === y) continue;
      if (x === undefined) return -1;
      if (y === undefined) return 1;
      const xv = typeof x === "boolean" ? +x : x, yv = typeof y === "boolean" ? +y : y;
      if (xv < yv) return -1;
      if (xv > yv) return 1;
    }
    return 0;
  }
  const sortBy = (arr, key) => arr.map((v, i) => [key(v), i, v]).sort((p, q) => cmpTuple(p[0], q[0]) || p[1] - q[1]).map((t) => t[2]);
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);                // 파이썬 sum과 같은 순서(왼→오)

  // ---------- 날짜 ----------
  const DAY = 86400000;
  const ymd = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  const daysBetween = (a, b) => Math.round((ymd(b) - ymd(a)) / DAY);                 // (date(b) - date(a)).days
  const addDays = (d, n) => new Date(ymd(d) + n * DAY).toISOString().slice(0, 10);
  function isoWeek(d) {                                                              // date.isocalendar()[:2] → "YYYY-WW"
    const t = new Date(ymd(d));
    t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + 3);                    // 그 주 목요일
    const y = t.getUTCFullYear(), w1 = new Date(Date.UTC(y, 0, 4));
    w1.setUTCDate(w1.getUTCDate() - ((w1.getUTCDay() + 6) % 7) + 3);                // 1주차 목요일
    return `${y}-${String(1 + Math.round((t - w1) / (7 * DAY))).padStart(2, "0")}`;
  }

  // ---------- 시간대(인텔 API: 서머타임 자동) ----------
  const fmts = {};
  function parts(epochMs, tz) {
    const f = fmts[tz] || (fmts[tz] = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short",
    }));
    const o = {};
    for (const p of f.formatToParts(new Date(epochMs))) o[p.type] = p.value;
    const wd = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[o.weekday];
    return { date: `${o.year}-${o.month}-${o.day}`, hour: +o.hour % 24, minute: +o.minute, second: +o.second, weekday: wd };
  }
  const dateIn = (epochSec, tz) => parts(epochSec * 1000, tz).date;                  // datetime.fromtimestamp(t, tz).strftime("%Y-%m-%d")
  const kstDate = (ms = Date.now()) => parts(ms, "Asia/Seoul").date;
  function isoKST(ms = Date.now()) {                                                  // now.isoformat(timespec="seconds") (KST)
    const p = parts(ms, "Asia/Seoul");
    const hh = String(p.hour).padStart(2, "0"), mm = String(p.minute).padStart(2, "0"), ss = String(p.second).padStart(2, "0");
    return `${p.date}T${hh}:${mm}:${ss}+09:00`;
  }

  TR.core = { pyRound, sig, bisectLeft, median, cmpTuple, sortBy, sum, ymd, daysBetween, addDays, isoWeek, parts, dateIn, kstDate, isoKST, DAY };
})(typeof window !== "undefined" ? window : globalThis);
