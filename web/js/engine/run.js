// 폰 엔진 실행부(TR.engine)와 화면용 로컬 API(TR.local).
// TR.engine.scan = scripts/scan.py의 run()과 같은 순서: 수집 → 종목 분석 → 알림 상태 머신 → 발송 → 저장.
// TR.local은 화면이 서버에 보내던 요청(/api/*)을 폰 안에서 처리한다 — 나중에 클라우드 서버로 바꿀 때는 TR.api가 서버로 보내면 된다.
(function (G) {
  const TR = G.TR;
  const LOCK_MS = 2 * 60 * 1000, LOG_MAX = 1500, SYM_RE = /^[A-Za-z0-9^=.\-]{1,20}$/, DATE_RE = /^\d{4}-\d{2}-\d{2}$/, TV_RE = /^[A-Z0-9_]{1,20}:[A-Z0-9_.!]{1,24}$/, HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  const GROUPS = ["crypto", "index", "macro", "us", "kr"];
  const itemsOf = (watch) => (watch?.groups || []).flatMap((g) => g.items.map((it) => ({ ...it, group: g.id })));
  const deliver = async (m) => TR.native.notify(m.title, m.body, m.sym);

  // 처음 실행: 앱에 들어 있는 기본 설정 · 종목 목록을 저장소로. 폰 기본값: 백그라운드 15분, 관심 종목만 즉시
  async function bootstrapDefaults() {
    if (!(await TR.db.kv("config"))) {
      const cfg = await (await fetch("./config/alerts.json")).json();
      Object.assign(cfg, { bg_minutes: 15, bg_exact: false, notify_scope: "fav", push_min_grade: "A" });
      await TR.db.setKv("config", cfg);
    }
    if (!(await TR.db.kv("watchlist"))) await TR.db.setKv("watchlist", await (await fetch("./config/watchlist.json")).json());
  }

  async function scan({ mode = "active", notify = true, nowMs = Date.now(), onProgress = null } = {}) {
    if (!(await TR.db.lock("scan", LOCK_MS))) return { busy: true };
    const beat = setInterval(() => TR.db.renew("scan", LOCK_MS).catch(() => {}), 30000);   // 도는 동안 연장 — 앱이 중간에 죽으면 2분 뒤 풀린다
    try {
      const t0 = Date.now(), cfg = await TR.db.kv("config"), items = itemsOf(await TR.db.kv("watchlist"));
      let failed = [];
      if (mode !== "none") {
        const have = new Set(await TR.db.keys("bars"));
        let todo = mode === "all" ? items : items.filter((it) => TR.markets.isActive(TR.markets.marketOf(it), nowMs));
        todo = todo.concat(items.filter((it) => !todo.includes(it) && !have.has(it.sym)));
        if (todo.length) failed = (await TR.fetch.update(todo, TR.db, { nowMs, onProgress })).failed;
      }
      const tFetch = (Date.now() - t0) / 1000;
      const user = (await TR.db.kv("lines")) || {}, state = (await TR.db.kv("state")) || {}, wcache = (await TR.db.kv("wcache")) || {};
      const registry = state.geo || (state.geo = {}), results = [], errors = [];
      for (const it of items) {
        const raw = await TR.db.getBars(it.sym);
        if (!raw || (raw.c || []).length < 60) { errors.push(it.sym); continue; }
        try {
          const r = TR.scan.analyze(it, raw, user[it.sym] || [], cfg, registry, wcache), b = TR.scan.barsOf(raw);
          r.break_vol = TR.scan.breakVol(r.live ? b.slice(0, -1) : b);
          results.push(r);
        } catch (e) { errors.push(`${it.sym}(${e.name}: ${e.message})`); }
      }
      const live = new Set(items.map((it) => it.sym));
      state.geo = Object.fromEntries(Object.entries(registry).filter(([, v]) => live.has(v.sym)));
      await TR.db.setKv("wcache", Object.fromEntries(Object.entries(wcache).filter(([k]) => live.has(k))));
      const events = TR.scan.updateState(results, state, cfg, nowMs, !notify);
      for (const r of results) if (r.state_error) errors.push(`${r.sym}(상태 오류: ${r.state_error})`);
      if (notify) {
        if (events.length) await TR.notify.dispatch(events, state, cfg, nowMs, deliver);
        else await TR.notify.flushPending(state, cfg, nowMs, deliver);
        await TR.notify.flushDigest(state, cfg, nowMs, deliver);
      } else for (const e of events) e.delivered = "app";
      state.last_scan = TR.core.isoKST(nowMs);
      await TR.db.setKv("state", state);
      if (events.length) await TR.db.setKv("log", events.slice().reverse().concat((await TR.db.kv("log")) || []).slice(0, LOG_MAX));
      TR.scan.finalize(results);
      const out = { generated_at: TR.core.isoKST(nowMs), markets: TR.markets.status(nowMs), items: results, errors, fetch_failed: failed, events,
                    config: cfg, timing: { fetch: +tFetch.toFixed(1), total: +((Date.now() - t0) / 1000).toFixed(1) } };
      await TR.db.setKv("scan", out);
      return out;
    } finally {
      clearInterval(beat);
      await TR.db.unlock("scan");
    }
  }

  // ---------- 설정 저장(scripts/serve.py save_config와 같은 검사 + 폰 전용 항목) ----------
  const num = (v, lo, hi) => {
    const x = Number(v);
    if (!(isFinite(x) && lo <= x && x <= hi)) throw new Error(`${v}는 ${lo}~${hi} 범위여야 합니다`);
    return x;
  };
  const hhmm = (v) => { if (!HM_RE.test(String(v))) throw new Error("시간은 HH:MM 형식"); return String(v); };
  async function saveConfig(body) {
    const cfg = { ...(await TR.db.kv("config")) };
    if ("mode" in body) { if (!["atr", "pct"].includes(body.mode)) throw new Error("기준은 atr 또는 pct"); cfg.mode = body.mode; }
    for (const [k, lo, hi] of [["approach_atr", 0.5, 6], ["near_atr", 0.2, 4], ["zone_atr", 0.1, 1.5], ["reset_atr", 1, 8], ["approach_pct", 0.5, 20], ["near_pct", 0.2, 15],
                                ["touch_pct", 0, 3], ["reset_pct", 1, 30], ["approach_cap_pct", 2, 50], ["near_cap_pct", 1, 30]]) if (k in body) cfg[k] = num(body[k], lo, hi);
    for (const [k, lo, hi] of [["scan_minutes", 5, 240], ["min_touches", 2, 6], ["min_quality", 0, 100]]) if (k in body) cfg[k] = Math.trunc(num(body[k], lo, hi));
    for (const k of ["include_auto", "include_user", "kakao", "mac_notify", "bg_exact"]) if (k in body) cfg[k] = !!body[k];
    if ("bg_minutes" in body) { const m = Math.trunc(Number(body.bg_minutes)); if (![0, 15, 30, 60].includes(m)) throw new Error("점검 주기는 끄기 · 15 · 30 · 60분"); cfg.bg_minutes = m; }
    if ("notify_scope" in body) { if (!["fav", "all"].includes(body.notify_scope)) throw new Error("알림 대상은 fav 또는 all"); cfg.notify_scope = body.notify_scope; }
    if ("push_min_grade" in body) { if (!["S", "A", "B"].includes(body.push_min_grade)) throw new Error("최소 등급은 S · A · B"); cfg.push_min_grade = body.push_min_grade; }
    if ("push" in body) cfg.push = Object.fromEntries(Object.keys(TR.notify.CATEGORY).map((k) => [k, !!(body.push[k] ?? (cfg.push || {})[k] ?? true)]));
    if ("push_groups" in body) cfg.push_groups = body.push_groups.filter((g) => GROUPS.includes(g));
    if ("digest" in body) {
      const d = body.digest;
      cfg.digest = { on: !!d.on, times: [...new Set((d.times || []).map(hhmm))].sort().slice(0, 6), min_grade: ["S", "A", "B", "C"].includes(d.min_grade) ? d.min_grade : "A",
                     types: (d.types || []).filter((t) => t in TR.notify.CATEGORY), max_items: Math.trunc(num(d.max_items ?? 15, 3, 40)) };
    }
    if ("volume" in body) {
      const v = body.volume;
      cfg.volume = { on: !!(v.on ?? true), lookback: Math.trunc(num(v.lookback ?? 3, 1, 5)), base_days: Math.trunc(num(v.base_days ?? 20, 10, 60)),
                     ratio: num(v.ratio ?? 3, 1.5, 10), max_move: num(v.max_move ?? 5, 1, 15), groups: (v.groups || []).filter((g) => GROUPS.includes(g)) };
    }
    if ("quiet" in body) cfg.quiet = { on: !!body.quiet.on, start: hhmm(body.quiet.start), end: hhmm(body.quiet.end) };
    if (!(cfg.zone_atr < cfg.near_atr && cfg.near_atr < cfg.approach_atr && cfg.approach_atr < cfg.reset_atr)) throw new Error("ATR 기준: 터치 존 < 근접 < 접근 < 초기화 순서여야 합니다");
    if (!(cfg.touch_pct < cfg.near_pct && cfg.near_pct < cfg.approach_pct && cfg.approach_pct < cfg.reset_pct)) throw new Error("% 기준: 터치 < 근접 < 접근 < 초기화 순서여야 합니다");
    await TR.db.setKv("config", cfg);
    TR.native.schedule(cfg.bg_minutes ?? 15, cfg.bg_exact);                // 백그라운드 점검 주기를 바로 반영
    return cfg;
  }

  async function setFavorite(body) {
    const sym = String(body.sym || "");
    if (!SYM_RE.test(sym)) throw new Error("잘못된 종목");
    const cfg = { ...(await TR.db.kv("config")) };
    cfg.favorites = (cfg.favorites || []).filter((s) => s !== sym).concat(body.on ? [sym] : []);
    await TR.db.setKv("config", cfg);
    return cfg.favorites;
  }

  async function saveLines(body) {
    const sym = body.sym || "";
    if (!SYM_RE.test(sym)) throw new Error("잘못된 종목");
    const out = [];
    for (const u of (body.lines || []).slice(0, 20)) {
      if (!(DATE_RE.test(u.d1 || "") && DATE_RE.test(u.d2 || "")) || u.d1 >= u.d2) throw new Error("선의 날짜가 올바르지 않습니다");
      out.push({ id: /^u-[a-z0-9]{4,20}$/.test(String(u.id || "")) ? u.id : `u-${Date.now().toString(16)}${out.length}`, d1: u.d1, p1: num(u.p1, 1e-12, 1e13),
                 d2: u.d2, p2: num(u.p2, 1e-12, 1e13), side: ["sup", "res"].includes(u.side) ? u.side : null, note: String(u.note || "").slice(0, 40),
                 created: u.created || TR.core.isoKST() });
    }
    const all = (await TR.db.kv("lines")) || {};
    if (out.length) all[sym] = out; else delete all[sym];
    await TR.db.setKv("lines", all);
    return out;
  }

  async function editWatchlist(body) {
    const cfg = JSON.parse(JSON.stringify(await TR.db.kv("watchlist"))), sym = String(body.sym || "").trim();
    if (!SYM_RE.test(sym)) throw new Error("티커 형식이 올바르지 않습니다 (예: NVDA, 005930.KS, BTCUSDT)");
    if (body.action === "remove") {
      for (const g of cfg.groups) g.items = g.items.filter((i) => i.sym !== sym);
      await TR.db.setKv("watchlist", cfg);
      await TR.db.delBars(sym);
      return cfg;
    }
    const group = cfg.groups.find((g) => g.id === body.group);
    if (!group) throw new Error("그룹을 선택하세요");
    if (cfg.groups.some((g) => g.items.some((i) => i.sym === sym))) throw new Error("이미 있는 종목입니다");
    const src = ["yahoo", "binance", "bybit", "naver"].includes(body.src) ? body.src : "yahoo", tv = String(body.tv || "").trim().toUpperCase();
    if (tv && !TV_RE.test(tv)) throw new Error("TradingView 심볼은 거래소:티커 형식 (예: NASDAQ:NVDA)");
    const item = { sym: ["binance", "bybit"].includes(src) ? sym.toUpperCase() : sym, name: String(body.name || sym).trim().slice(0, 30), src };
    if (src === "naver") {
      if (!/^\d{6}\.(KS|KQ)$/.test(sym)) throw new Error("한국 종목은 6자리코드.KS(코스피) 또는 .KQ(코스닥)");
      item.code = sym.slice(0, 6);
    }
    if (tv) item.tv = tv;
    item.market = TR.markets.marketOf({ ...item, group: group.id });
    const got = await TR.fetch.fetchOne(item, true);                     // 실제로 받아지는지 먼저 확인
    if (got.c.length < 60) throw new Error(`일봉이 ${got.c.length}개뿐이라 빗각을 계산하기 어렵습니다`);
    group.items.push(item);
    await TR.db.setKv("watchlist", cfg);
    return cfg;
  }

  // ---------- 화면용 API ----------
  const APP_V = () => (typeof document !== "undefined" ? (document.querySelector('script[src*="js/app.js"]')?.src.match(/[?&]v=([^&]+)/) || [])[1] || null : null);
  async function status() {
    const st = (await TR.db.kv("state")) || {}, cfg = (await TR.db.kv("config")) || {};
    return { app_version: APP_V(), local: true, mode: "phone", remote: false, now: TR.core.isoKST(), markets: TR.markets.status(),
             quiet: TR.notify.inQuiet(cfg, Date.now()), sched: { last: st.last_scan || null, next: null, running: false, last_error: null },
             native: TR.native.status(), kakao: { connected: false }, pending: (st.pending || []).length, digest: (st.digest || []).length };
  }
  async function loadAll() {
    await bootstrapDefaults();
    const [scanRes, lines, log, watch, alerts] = await Promise.all(["scan", "lines", "log", "watchlist", "config"].map((k) => TR.db.kv(k)));
    return { scan: scanRes, lines: lines || {}, log: log || [], watch, alerts, status: await status(), universe: null, bars: {} };
  }
  const findItem = async (sym) => {
    const it = itemsOf(await TR.db.kv("watchlist")).find((i) => i.sym === sym);
    if (!it) throw new Error("워치리스트에 없는 종목입니다");
    return it;
  };
  async function get(url) {
    const u = new URL(url, "https://radar.local/"), p = u.pathname, q = u.searchParams;
    if (p === "/api/status") return status();
    if (p === "/api/ping") return { ok: true };
    if (p === "/api/bars") return TR.fetch.tf(await findItem(q.get("sym") || ""), q.get("tf") || "1d", TR.db);
    if (p === "/api/news") return TR.news.get(await findItem(q.get("sym") || ""), TR.db, q.get("force") === "1");
    throw new Error("이 기능은 폰 앱에서 지원하지 않습니다");
  }
  async function post(url, body = {}) {
    const p = new URL(url, "https://radar.local/").pathname, t = Date.now();
    if (p === "/api/favorite") return { ok: true, favorites: await setFavorite(body) };
    if (p === "/api/config") { const cfg = await saveConfig(body); await scan({ mode: "none", notify: false }); return { ok: true, config: cfg }; }
    if (p === "/api/scan") { const r = await scan({ mode: body.all ? "all" : "active", notify: true }); if (r.busy) throw new Error("이미 스캔 중입니다. 잠시 후 다시 시도하세요."); return { ok: true, seconds: +((Date.now() - t) / 1000).toFixed(1) }; }
    if (p === "/api/lines") { const saved = await saveLines(body); await scan({ mode: "none", notify: false }); return { ok: true, lines: saved }; }
    if (p === "/api/watchlist") { const w = await editWatchlist(body); await scan({ mode: body.action === "remove" ? "none" : "active", notify: false }); return { ok: true, watchlist: w }; }
    throw new Error("이 기능은 폰 앱에서 지원하지 않습니다");
  }

  TR.engine = { scan, bootstrapDefaults, itemsOf };
  TR.local = { loadAll, get, post, status, saveConfig };
})(typeof window !== "undefined" ? window : globalThis);
