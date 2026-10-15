// 알림 문구 · 경로 · 조용한 시간 · 세션 요약 — scripts/notify.py를 옮긴 것. 폰 앱은 카카오 대신 폰 알림으로 보낸다.
// 경로(route)
//   · 관심 종목(★): 켜 둔 종류는 모두 즉시
//   · 거래량 급증: 켜 두면 모든 종목 즉시
//   · 나머지: 알림 대상이 '전체'면 켜 둔 종류 · 최소 등급 이상을 즉시, '관심만'이면 요약 대상 종류 · 등급만 세션 요약으로
(function (G) {
  const TR = G.TR;
  const CATEGORY = { approach: "접근", near: "근접", touch: "터치", confirm: "반응 확인", break: "종가 이탈·돌파", fail: "이탈·돌파 실패", retest: "리테스트", volume: "거래량 급증(매집 후보)" };
  const PRIORITY = { retest: 6, confirm: 5, break: 5, touch: 4, volume: 4, fail: 3, near: 2, approach: 1 };
  const GRADE_RANK = { S: 4, A: 3, U: 3, V: 3, B: 2, C: 1 };
  // 알림 강도 단계 → 받을 종류(설정 화면의 빠른 선택)
  const STRENGTH = {
    low: ["confirm", "break", "retest", "fail", "volume"],
    mid: ["touch", "confirm", "break", "retest", "fail", "volume"],
    high: ["approach", "near", "touch", "confirm", "break", "retest", "fail", "volume"],
  };

  const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }), nf2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function fmt(p) {
    if (p == null) return "-";
    if (p >= 1000) return nf0.format(p);
    if (p >= 1) return nf2.format(p);
    if (p <= 0) return String(p);
    return p.toFixed(Math.max(2, -Math.floor(Math.log10(p)) + 3));
  }
  const sgn = (v, d = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}`;

  function category(e) {
    const t = e.type;
    if (t === "volume") return "volume";
    if (t === "retest_confirm" || (t === "stage" && e.status === "broken")) return "retest";
    if (t === "confirm" || t === "break" || t === "fail") return t;
    return { 1: "approach", 2: "near", 3: "touch" }[e.stage];
  }

  function route(e, cfg) {
    const c = category(e);
    if (!(cfg.push_groups || [e.group]).includes(e.group)) return "app";
    const push = cfg.push || {};
    if (c === "volume") return (push.volume ?? true) ? "realtime" : "app";
    if ((cfg.favorites || []).includes(e.sym)) return (push[c] ?? true) ? "realtime" : "app";
    if (cfg.notify_scope === "all" && (push[c] ?? true) && (GRADE_RANK[e.grade] || 0) >= (GRADE_RANK[cfg.push_min_grade || "A"] || 3)) return "realtime";
    const d = cfg.digest || {};
    if (d.on && (d.types || []).includes(c) && (GRADE_RANK[e.grade] || 0) >= (GRADE_RANK[d.min_grade || "A"] || 3)) return "digest";
    return "app";
  }

  function lineWord(e) {
    if (e.kind === "user") return "내 빗각";
    if (e.status === "broken" && e.type !== "break") return e.orig === "res" ? "돌파한 저항선" : "이탈한 지지선";
    return e.orig === "sup" ? "지지 빗각" : "저항 빗각";
  }
  function icon(e) {
    const c = category(e);
    if (c === "volume") return "📊";
    if ((c === "confirm" || c === "retest") && e.type !== "stage") return "✅";
    if (c === "break") return e.orig === "res" ? "🚀" : "⚠️";
    if (c === "fail") return "↩️";
    return e.side === "sup" ? "🟢" : "🔴";
  }
  const dist = (e) => `${sgn(e.gap_pct)}%·${e.gap.toFixed(1)}ATR`;
  const headline = (e) => `${icon(e)} ${e.name} ${lineWord(e)} ${e.label}`;

  function volDetail(e) {
    const v = e.vol, when = v.live ? "오늘(장중)" : v.days_ago === 0 ? "오늘" : `${v.days_ago}일 전`;
    const out = [`${when} ${v.candle} ${sgn(v.day_chg)}% · 3일 ${sgn(v.window_chg)}% · 현재 ${fmt(e.price)}`,
                 `1년 범위 ${(v.pos_1y * 100).toFixed(0)}% 위치${v.vs_ma120 != null ? ` · MA120 ${sgn(v.vs_ma120)}%` : ""}${v.tags.length ? ` · ${v.tags.join(",")}` : ""}`];
    if (e.near_line) out.push(`가까운 ${e.near_line.side === "sup" ? "지지" : "저항"} 빗각 ${sgn(e.near_line.gap_pct)}%`);
    return out;
  }
  function short(e) {
    if (e.type === "volume") return `📊 ${e.name} 거래량 ${e.vol.ratio.toFixed(1)}배 ${sgn(e.vol.day_chg)}% ·${e.vol.view}`;
    const tail = e.type === "break" || e.type === "fail" ? "" : ` ${sgn(e.gap_pct)}%`;
    return `${icon(e)} ${e.name} ${e.label}${tail} ·${e.kind === "auto" ? e.grade : "내선"}${e.counter_trend ? "·역추세" : ""}`;
  }
  function detailLines(e) {
    if (e.type === "volume") return volDetail(e);
    const out = [`현재 ${fmt(e.price)} · 선 ${fmt(e.line)} (${dist(e)})`], q = [];
    if (e.kind === "auto") q.push(`${e.window} ${e.grade}등급 터치${e.touches}`);
    q.push(e.trend + (e.counter_trend ? " 역추세" : ""));
    if (e.conf && e.conf.length) q.push("합류 " + e.conf.slice(0, 2).join(","));
    if (e.vol_ratio) q.push(`거래량 ${e.vol_ratio.toFixed(1)}배`);
    out.push(q.join(" · "));
    const p = e.plan;
    if (e.type === "break" && e.orig === "sup") out.push("→ 재지지 전까지 관망 · 되돌림 시 저항 전환 확인");
    else if (e.type === "break") out.push("→ 추격 대신 리테스트(선 부근) 대기");
    else if (e.type === "fail") out.push("→ 가짜 이탈·돌파: 원래 방향 복귀");
    else if (p && p.stop) out.push(`손절 ${fmt(p.stop)}${p.target ? ` · 목표 ${fmt(p.target)}` : ""}${p.rr ? ` · 손익비 ${p.rr.toFixed(1)}` : ""}`);
    else if (e.side === "res") out.push("→ 익절·경계 · 돌파 마감 시 추세 전환");
    if (e.note) out.push(`메모: ${e.note}`);
    return out;
  }
  const rank = (e) => [-(PRIORITY[category(e)] || 0), -(GRADE_RANK[e.grade] || 0), Math.abs(e.gap || 0)];

  // 이벤트 → 폰 알림 한 통 { title, body, sym }
  function compose(events, title = "") {
    if (events.length === 1 && !title) {
      const e = events[0];
      return { title: e.type === "volume" ? `📊 ${e.name} 거래량 ${e.vol.ratio.toFixed(1)}배 · ${e.vol.view}` : headline(e), body: detailLines(e).join("\n"), sym: e.sym };
    }
    const order = TR.core.sortBy(events, rank), lines = order.slice(0, 12).map(short);
    if (order.length > 12) lines.push(`…외 ${order.length - 12}건은 앱에서 확인`);
    return { title: title || `📐 빗각 알림 ${events.length}건`, body: lines.join("\n"), sym: order.length ? order[0].sym : null };
  }

  function inQuiet(cfg, nowMs) {
    const q = cfg.quiet || {};
    if (!q.on) return false;
    const p = TR.core.parts(nowMs, "Asia/Seoul"), t = p.hour * 60 + p.minute;
    const hm = (s) => +s.slice(0, 2) * 60 + +s.slice(3, 5), s = hm(q.start), e = hm(q.end);
    return s <= e ? s <= t && t < e : t >= s || t < e;
  }
  const ageHours = (e, nowMs) => { const t = Date.parse(e.at); return isFinite(t) ? (nowMs - t) / 3600000 : 999; };

  // 이번 스캔 이벤트를 경로별로 처리. deliver({title, body, sym}) 로 실제 발송. 각 이벤트에 delivered를 적는다.
  async function dispatch(events, state, cfg, nowMs, deliver) {
    const rt = events.filter((e) => route(e, cfg) === "realtime"), dg = events.filter((e) => route(e, cfg) === "digest");
    for (const e of events) e.delivered = "app";
    if (dg.length) {
      state.digest = (state.digest || []).concat(dg).slice(-400);
      for (const e of dg) e.delivered = "digest";
    }
    if (inQuiet(cfg, nowMs)) {
      if (rt.length) {
        state.pending = (state.pending || []).concat(rt).slice(-150);
        for (const e of rt) e.delivered = "queued";
      }
      return "queued";
    }
    const pending = (state.pending || []).filter((e) => ageHours(e, nowMs) < 12);
    delete state.pending;
    if (pending.length) await deliver(compose(pending, `🌙 밤사이 알림 ${pending.length}건`));
    if (rt.length) {
      await deliver(compose(rt));
      for (const e of rt) e.delivered = "phone";
    }
    return rt.length ? "phone" : "none";
  }

  function dueDigest(state, cfg, nowMs) {
    const d = cfg.digest || {};
    if (!d.on) return null;
    const p = TR.core.parts(nowMs, "Asia/Seoul"), t = p.hour * 60 + p.minute, sent = state.digest_sent || {};
    let due = null;
    for (const hm of [...(d.times || [])].sort()) {
      const s = +hm.slice(0, 2) * 60 + +hm.slice(3, 5), e = Math.min(23, +hm.slice(0, 2) + 3) * 60 + +hm.slice(3, 5);
      if (s <= t && t < e && sent[hm] !== p.date) due = hm;
    }
    return due;
  }
  async function flushDigest(state, cfg, nowMs, deliver) {
    const hm = dueDigest(state, cfg, nowMs);
    if (!hm) return null;
    (state.digest_sent || (state.digest_sent = {}))[hm] = TR.core.kstDate(nowMs);
    const items = state.digest || [];
    delete state.digest;
    if (!items.length) return "empty";
    const uniq = new Map();
    for (const e of items) uniq.set(`${e.sym}|${e.line_id}|${e.type}`, e);
    const list = [...uniq.values()], cnt = {};
    for (const e of list) cnt[CATEGORY[category(e)]] = (cnt[CATEGORY[category(e)]] || 0) + 1;
    const max = (cfg.digest || {}).max_items || 15, top = TR.core.sortBy(list, rank).slice(0, max);
    const msg = compose(top, `📐 빗각 요약 ${hm} · ${Object.entries(cnt).map(([k, v]) => `${k} ${v}`).join(" · ")}`.slice(0, 60));
    await deliver(msg);
    return "phone";
  }
  async function flushPending(state, cfg, nowMs, deliver) {
    if ((state.pending || []).length && !inQuiet(cfg, nowMs)) return dispatch([], state, cfg, nowMs, deliver);
    return null;
  }

  TR.notify = { CATEGORY, PRIORITY, GRADE_RANK, STRENGTH, fmt, category, route, short, headline, detailLines, compose, inQuiet, dispatch, flushDigest, flushPending };
})(typeof window !== "undefined" ? window : globalThis);
