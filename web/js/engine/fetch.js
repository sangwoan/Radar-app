// 시세 수집 — scripts/fetch.py를 옮긴 것. 폰 앱은 기기에서 직접 받는다(네이티브 HTTP라 CORS 제한 없음).
// HTTP는 TR.http(앱: 네이티브 다리 · 맥 브라우저: 서버의 개발용 프록시 · 노드: fetch)로만 부른다.
(function (G) {
  const TR = G.TR;
  const { sig, dateIn, kstDate, addDays, daysBetween, isoWeek, isoKST } = TR.core;
  const KEYS = ["d", "o", "h", "l", "c", "v"];
  const YAHOO = (sym, rng) => `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${rng}&interval=1d`;
  const BINANCE = [(sym, n) => `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(sym)}&interval=1d&limit=${n}`,
                   (sym, n) => `https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(sym)}&interval=1d&limit=${n}`];
  const BYBIT = (sym, n) => `https://api.bybit.com/v5/market/kline?category=spot&symbol=${encodeURIComponent(sym)}&interval=D&limit=${n}`;
  const NAVER_DAY = (kind, code, s, e) => `https://api.stock.naver.com/chart/domestic/${kind}/${code}/day?startDateTime=${s}0000&endDateTime=${e}2359`;
  const NAVER_RT = (kind, codes) => `https://polling.finance.naver.com/api/realtime/domestic/${kind}/${codes}`;
  const FULL_EVERY = 7;            // 폰은 일주일에 한 번 전체(5년)를 새로 받는다. 그 사이엔 최근 봉만(분할은 merge가 잡아 전체 재수집)
  const empty = () => ({ d: [], o: [], h: [], l: [], c: [], v: [] });
  const r7 = (v) => (v == null ? null : sig(Number(v), 7));

  async function retry(fn, times, wait = 1500) {
    let err;
    for (let i = 0; i < times; i++) {
      try { return await fn(); } catch (e) { err = e; if (i < times - 1) await new Promise((r) => setTimeout(r, wait * (i + 1))); }
    }
    throw err;
  }

  // ---------- Yahoo ----------
  function yahooParse(r, nowMs = Date.now()) {
    const q = r.indicators.quote[0], m = r.meta, tz = m.exchangeTimezoneName || "UTC", out = empty(), ts = r.timestamp || [];
    const rmtD = m.regularMarketTime ? dateIn(m.regularMarketTime, tz) : null;
    for (let i = 0; i < ts.length; i++) {
      const d = dateIn(ts[i], tz);
      let o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i], v = (q.volume || [])[i] ?? null;
      if (c == null && d === rmtD && m.regularMarketPrice) {
        c = m.regularMarketPrice;
        h = Math.max(...[h, m.regularMarketDayHigh, c].filter((x) => x != null));
        l = Math.min(...[l, m.regularMarketDayLow, c].filter((x) => x != null));
        o = o != null ? o : c;
        v = v || m.regularMarketVolume;
      }
      const f = TR.scan.cleanOhlc(o, h, l, c);
      if (!f) continue;
      if (out.d.length && out.d[out.d.length - 1] === d) for (const k of KEYS) out[k].pop();
      out.d.push(d);
      out.o.push(r7(f[0])); out.h.push(r7(f[1])); out.l.push(r7(f[2])); out.c.push(r7(f[3]));
      out.v.push(Math.trunc(v || 0));
    }
    if (!out.v.some(Boolean)) out.v = null;
    const reg = (m.currentTradingPeriod || {}).regular || {}, now = nowMs / 1000;
    const live = out.d.length > 0 && (reg.start ?? 0) <= now && now < (reg.end ?? 0) && out.d[out.d.length - 1] === dateIn(reg.start, tz);
    const price = m.regularMarketPrice, n = out.d.length;
    if (live && price) {
      out.c[n - 1] = r7(price);
      out.h[n - 1] = Math.max(out.h[n - 1], out.c[n - 1]);
      out.l[n - 1] = Math.min(out.l[n - 1], out.c[n - 1]);
    }
    return { ...out, live, currency: m.currency ?? null, price: price ?? null };
  }
  const fetchYahoo = (sym, full) => retry(async () => yahooParse((await TR.http.json(YAHOO(sym, full ? "5y" : "1mo"), 20000)).chart.result[0]), 3);

  // ---------- Binance / Bybit ----------
  async function fetchBinance(sym, full) {
    const rows = await retry(async () => {
      let err;
      for (const u of BINANCE) { try { return await TR.http.json(u(sym, full ? 1000 : 20), 15000); } catch (e) { err = e; } }
      throw err;
    }, 2);
    const out = empty();
    for (const k of rows) {
      out.d.push(new Date(k[0]).toISOString().slice(0, 10));
      out.o.push(r7(k[1])); out.h.push(r7(k[2])); out.l.push(r7(k[3])); out.c.push(r7(k[4]));
      out.v.push(r7(k[7]));
    }
    return { ...out, live: rows.length > 0 && rows[rows.length - 1][6] > Date.now(), currency: "USDT" };
  }
  async function fetchBybit(sym, full) {
    const res = await retry(() => TR.http.json(BYBIT(sym, full ? 1000 : 20), 15000), 2);
    if (res.retCode !== 0) throw new Error(`bybit: ${res.retMsg}`);
    const rows = [...res.result.list].sort((a, b) => Number(a[0]) - Number(b[0])), out = empty();
    for (const k of rows) {
      out.d.push(new Date(Number(k[0])).toISOString().slice(0, 10));
      out.o.push(r7(k[1])); out.h.push(r7(k[2])); out.l.push(r7(k[3])); out.c.push(r7(k[4]));
      out.v.push(r7(k[6]));
    }
    return { ...out, live: rows.length > 0 && Number(rows[rows.length - 1][0]) + 86400000 > Date.now(), currency: "USDT" };
  }

  // ---------- Naver(한국) ----------
  const naverCode = (it) => (it.kind === "index" ? ["index", it.code] : ["item", it.code || it.sym.split(".")[0]]);
  async function fetchNaver(it, full) {
    const [kind, code] = naverCode(it), end = kstDate(), start = addDays(end, full ? -1850 : -45);
    const rows = await retry(() => TR.http.json(NAVER_DAY(kind, code, start.replace(/-/g, ""), end.replace(/-/g, "")), 15000), 3);
    const out = empty();
    for (const x of rows) {
      const o = x.openPrice, h = x.highPrice, l = x.lowPrice, c = x.closePrice;
      if (!c || o == null || h == null || l == null) continue;
      const d = x.localDate;
      out.d.push(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`);
      out.o.push(r7(o || c)); out.h.push(r7(h || c)); out.l.push(r7(l || c)); out.c.push(r7(c));
      out.v.push(Math.trunc(x.accumulatedTradingVolume || 0));
    }
    if (kind === "index" || !out.v.some(Boolean)) out.v = kind === "index" ? null : out.v;
    return { ...out, live: false, currency: "KRW" };
  }
  async function naverRealtime(items) {
    const out = {}, groups = { stock: items.filter((i) => i.kind !== "index"), index: items.filter((i) => i.kind === "index") };
    for (const [kind, its] of Object.entries(groups)) {
      const byCode = Object.fromEntries(its.map((i) => [naverCode(i)[1], i.sym])), codes = Object.keys(byCode);
      for (let k = 0; k < codes.length; k += 40) {
        let res;
        try { res = await TR.http.json(NAVER_RT(kind, codes.slice(k, k + 40).join(",")), 15000); } catch { continue; }
        for (const x of res.datas || []) {
          const sym = byCode[x.itemCode || x.symbolCode], t = (x.localTradedAt || "").slice(0, 10);
          try {
            const bar = { d: t, o: parseFloat(x.openPriceRaw), h: parseFloat(x.highPriceRaw), l: parseFloat(x.lowPriceRaw), c: parseFloat(x.closePriceRaw),
                          v: Math.trunc(parseFloat(x.accumulatedTradingVolumeRaw || 0)) };
            if ([bar.o, bar.h, bar.l, bar.c].some((v) => !isFinite(v))) continue;
            if (sym && t) out[sym] = bar;
          } catch { continue; }
        }
      }
    }
    return out;
  }
  function applyBar(b, bar) {
    if (!bar.c || bar.d < (b.d.length ? b.d[b.d.length - 1] : "")) return;
    if (b.d.length && b.d[b.d.length - 1] === bar.d) for (const k of KEYS) if (b[k] != null) b[k].pop();
    b.d.push(bar.d);
    for (const k of ["o", "h", "l", "c"]) b[k].push(r7(bar[k] || bar.c));
    if (b.v != null) b.v.push(bar.v || 0);
  }

  function fetchOne(it, full) {
    const src = it.src || "yahoo";
    if (src === "binance") return fetchBinance(it.sym, full);
    if (src === "bybit") return fetchBybit(it.sym, full);
    if (src === "naver") return fetchNaver(it, full);
    return fetchYahoo(it.ysym || it.sym, full);
  }

  // 최근 봉(neu)을 기존 기록(old)에 합침. 겹치는 과거 봉 종가가 3% 넘게 다르면 null(분할·수정 → 전체 재수집)
  function merge(old, neu) {
    const idx = new Map(old.d.map((d, i) => [d, i]));
    for (let j = 0; j < neu.d.length - 2; j++) {
      const i = idx.get(neu.d[j]);
      if (i !== undefined && old.c[i] && Math.abs(neu.c[j] / old.c[i] - 1) > 0.03) return null;
    }
    const rows = new Map();
    old.d.forEach((d, i) => rows.set(d, KEYS.slice(1).map((k) => (old[k] != null ? old[k][i] : null))));
    neu.d.forEach((d, j) => rows.set(d, KEYS.slice(1).map((k) => (neu[k] != null ? neu[k][j] : null))));
    const ds = [...rows.keys()].sort(), out = { d: ds };
    KEYS.slice(1).forEach((k, n) => { out[k] = ds.map((d) => rows.get(d)[n]); });
    if (old.v == null && neu.v == null) out.v = null;
    else if (out.v != null) out.v = out.v.map((x) => x || 0);
    return out;
  }

  // items를 받아 저장소의 종목별 기록을 갱신. 반환 { ok, failed }
  async function update(items, store, { full = false, nowMs = Date.now(), onProgress = null, workers = 6 } = {}) {
    const today = kstDate(nowMs), stamp = isoKST(nowMs), failed = [], naver = [];
    let ok = 0, done = 0;
    const one = async (it) => {
      const old = await store.getBars(it.sym);
      const needFull = full || !old || !old.full_at || daysBetween(old.full_at, today) >= FULL_EVERY || old.src !== (it.src || "yahoo") || (old.d || []).length < 30;
      try {
        let got = await fetchOne(it, needFull), isFull = needFull;
        if (!got.d.length) throw new Error("빈 응답");
        if (!needFull) {
          const merged = merge(old, got);
          if (merged == null) { got = await fetchOne(it, true); isFull = true; }
          else got = { ...got, ...merged };
        }
        const rec = { sym: it.sym, src: it.src || "yahoo", d: got.d, o: got.o, h: got.h, l: got.l, c: got.c, v: got.v, live: got.live,
                      currency: got.currency ?? null, full_at: isFull ? today : old.full_at, fetched_at: stamp, stale: false, error: null };
        ok++;
        if (rec.src === "naver") naver.push([it, rec]); else await store.putBars(it.sym, rec);
      } catch (e) {
        failed.push(it.sym);
        if (old) await store.putBars(it.sym, { ...old, stale: true, error: `${e.name}: ${e.message}`.slice(0, 200) });
      } finally {
        done++;
        if (onProgress) onProgress(done, items.length, it);
      }
    };
    const queue = [...items];
    await Promise.all(Array.from({ length: Math.min(workers, queue.length) }, async () => { while (queue.length) await one(queue.shift()); }));
    if (naver.length) {
      const rt = TR.markets.isActive("krx", nowMs) ? await naverRealtime(naver.map(([it]) => it)) : {};
      for (const [it, rec] of naver) {
        const bar = rt[it.sym];
        if (bar && bar.d === today) applyBar(rec, bar);
        rec.live = TR.markets.isOpen("krx", nowMs) && rec.d.length > 0 && rec.d[rec.d.length - 1] === today;
        await store.putBars(it.sym, rec);
      }
    }
    return { ok, failed };
  }

  // ---------- 차트용 시간 단위(15분 · 1시간 · 4시간 · 일봉 · 주봉) ----------
  const TFS = ["15m", "1h", "4h", "1d", "1w"];
  const rowsOut = (rows) => ({ t: rows.map((r) => r[0]), d: rows.map((r) => r[1]), o: rows.map((r) => r7(r[2])), h: rows.map((r) => r7(r[3])),
                               l: rows.map((r) => r7(r[4])), c: rows.map((r) => r7(r[5])), v: rows.map((r) => r[6] || 0) });
  async function yahooRows(sym, iv, rng) {
    const r = (await TR.http.json(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=${iv}&range=${rng}`, 20000)).chart.result[0];
    const q = r.indicators.quote[0], tz = r.meta.exchangeTimezoneName || "UTC", vol = q.volume || [], rows = [];
    (r.timestamp || []).forEach((t, i) => {
      const f = TR.scan.cleanOhlc(q.open[i], q.high[i], q.low[i], q.close[i]);
      if (f) rows.push([t, dateIn(t, tz), ...f, (i < vol.length ? vol[i] : 0) || 0]);
    });
    return rows;
  }
  function group(rows, key) {
    const out = [];
    let cur = null, ck;
    for (const r of rows) {
      const k = key(r);
      if (cur && k === ck) { cur[3] = Math.max(cur[3], r[3]); cur[4] = Math.min(cur[4], r[4]); cur[5] = r[5]; cur[6] = (cur[6] || 0) + (r[6] || 0); }
      else { if (cur) out.push(cur); cur = [...r]; ck = k; }
    }
    if (cur) out.push(cur);
    return out;
  }
  function agg4h(rows) {
    const first = {};
    for (const r of rows) if (!(r[1] in first)) first[r[1]] = r[0];
    return group(rows, (r) => `${r[1]}|${Math.floor((r[0] - first[r[1]]) / 14400)}`);
  }
  const aggWeek = (rows) => group(rows, (r) => isoWeek(r[1]));

  async function tf(item, tfName, store) {
    if (!TFS.includes(tfName)) throw new Error("시간 단위는 15m · 1h · 4h · 1d · 1w");
    const src = item.src || "yahoo";
    if ((tfName === "1d" || tfName === "1w") && !(tfName === "1w" && ["binance", "bybit", "yahoo"].includes(src))) {
      const raw = (await store.getBars(item.sym)) || {}, rows = [];
      (raw.d || []).forEach((d, i) => {
        const f = TR.scan.cleanOhlc(raw.o[i], raw.h[i], raw.l[i], raw.c[i]);
        if (f) rows.push([Math.floor(Date.parse(`${d}T00:00:00Z`) / 1000), d, ...f, (raw.v ? raw.v[i] : 0) || 0]);
      });
      return rowsOut(tfName === "1d" ? rows : aggWeek(rows));
    }
    if (src === "binance" || src === "bybit") {
      let rows;
      if (src === "binance") {
        const iv = { "15m": "15m", "1h": "1h", "4h": "4h", "1w": "1w" }[tfName];
        const ks = await TR.http.json(`https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(item.sym)}&interval=${iv}&limit=1000`, 20000);
        rows = ks.map((k) => [Math.floor(k[0] / 1000), new Date(k[0]).toISOString().slice(0, 10), +k[1], +k[2], +k[3], +k[4], +k[7]]);
      } else {
        const iv = { "15m": "15", "1h": "60", "4h": "240", "1w": "W" }[tfName];
        const res = await TR.http.json(`https://api.bybit.com/v5/market/kline?category=spot&symbol=${encodeURIComponent(item.sym)}&interval=${iv}&limit=1000`, 20000);
        rows = [...res.result.list].sort((a, b) => Number(a[0]) - Number(b[0])).map((k) => [Math.floor(Number(k[0]) / 1000), new Date(Number(k[0])).toISOString().slice(0, 10), +k[1], +k[2], +k[3], +k[4], +k[6]]);
      }
      return rowsOut(rows);
    }
    const ysym = item.ysym || item.sym;
    if (tfName === "15m") return rowsOut(await yahooRows(ysym, "15m", "60d"));
    if (tfName === "1h") return rowsOut(await yahooRows(ysym, "60m", "730d"));
    if (tfName === "4h") return rowsOut(agg4h(await yahooRows(ysym, "60m", "730d")));
    return rowsOut(await yahooRows(ysym, "1wk", "10y"));
  }

  TR.fetch = { KEYS, FULL_EVERY, yahooParse, fetchOne, merge, update, naverRealtime, applyBar, TFS, tf, agg4h, aggWeek };
})(typeof window !== "undefined" ? window : globalThis);
