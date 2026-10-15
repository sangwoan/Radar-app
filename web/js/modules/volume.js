// 기관 거래량 포착(매집 후보): 최근 N세션 안에 거래량이 평소의 K배 이상 터졌는데 가격은 ±M% 안에서 버틴 종목.
// 서버가 보낸 최근 봉 요약(vstat)으로 화면에서 바로 다시 거른다 — 슬라이더를 움직이면 즉시 반영.
TR.modules.volume = (el, D) => {
  const { esc, num, price, sgn, GROUP, load, save, toast, isMobile } = TR.util;
  const items = (D.scan?.items || []).filter((it) => it.vstat);
  const cfg = D.alerts.volume || {};
  const st = Object.assign({ ratio: cfg.ratio ?? 3, move: cfg.max_move ?? 5, lookback: cfg.lookback ?? 3, group: "all", view: "all" }, load("tr-vol", {}));
  const fav = new Set(D.alerts.favorites || []);

  // 서버 volume.screen과 같은 정의(평소 = 구간 직전 20세션 평균)
  function screen(it) {
    const s = it.vstat, L = st.lookback, n = s.v.length;                // v: 최근 26봉, c: 27봉, o·h·l·d: 6봉
    const base = s.v.slice(n - L - 20, n - L);
    if (base.filter((x) => x > 0).length < 15) return null;             // 거래량 기록이 빈 날이 많으면 기준을 믿을 수 없음
    const avg = base.reduce((a, b) => a + b, 0) / base.length;
    if (!avg) return null;
    const P = s.c[s.c.length - 1], ref = s.c[s.c.length - 1 - L];
    const win = (P / ref - 1) * 100;
    if (Math.abs(win) > st.move) return null;
    let top = null, count = 0;
    for (let k = n - L; k < n; k++) {
      const r = s.v[k] / avg, chg = (s.c[k + 1] / s.c[k] - 1) * 100;
      if (r >= st.ratio && Math.abs(chg) <= st.move) {
        count++;
        const j = k - (n - 6), o = s.o[j], h = s.h[j], l = s.l[j], c = s.c[k + 1], rng = h - l;
        const cand = { d: s.d[j], ratio: r, chg, candle: c >= o ? "양봉" : "음봉", clv: rng ? (c - l) / rng : 0.5,
                       lw: rng ? (Math.min(o, c) - l) / rng : 0, uw: rng ? (h - Math.max(o, c)) / rng : 0, ago: n - 1 - k };
        if (!top || r > top.ratio) top = cand;
      }
    }
    if (!top) return null;
    const pos = s.hi1y > s.lo1y ? (P - s.lo1y) / (s.hi1y - s.lo1y) : 0.5;
    const view = pos >= 0.85 && (top.uw >= 0.45 || top.clv < 0.35) ? "분산 주의" : "매집 후보";
    const tags = [count >= 2 && "연속 급증", top.lw >= 0.45 && "긴 아래꼬리", pos <= 0.3 && "1년 하단권", pos >= 0.85 && "1년 상단권"].filter(Boolean);
    return { ...top, win, pos, view, tags, base: avg, count };
  }

  function volBars(it, hit) {
    const v = it.vstat.v, n = v.length, W = 120, H = 34, mx = Math.max(...v, 1);
    const base = v.slice(n - st.lookback - 20, n - st.lookback).reduce((a, b) => a + b, 0) / 20;
    const bw = W / n;
    const bars = v.map((x, i) => {
      const h = (x / mx) * (H - 2), hot = i >= n - st.lookback && x >= base * st.ratio;
      return `<rect class="${hot ? "vb-hot" : "vb"}" x="${(i * bw + 0.5).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${h.toFixed(1)}"/>`;
    }).join("");
    const by = (H - (base / mx) * (H - 2)).toFixed(1);
    return `<svg class="vbars" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${bars}<line class="vb-base" x1="0" x2="${W}" y1="${by}" y2="${by}"/></svg>`;
  }

  function row(it, h) {
    const n = it.nearest;
    const when = h.ago === 0 ? (it.live ? "오늘(장중)" : "오늘") : `${h.ago}일 전 ${h.d.slice(5)}`;
    return `<a class="vr" href="#chart/${encodeURIComponent(it.sym)}">
      <div class="vr-h"><span class="star${fav.has(it.sym) ? " on" : ""}" aria-hidden="true">★</span><b>${esc(it.name)}</b> <span class="code">${esc(it.sym)}</span>
        <span class="tg ${h.view === "매집 후보" ? "acc" : "dist"}">${h.view}</span></div>
      <div class="vr-b">
        <div class="vr-num"><b class="num">${num(h.ratio, 1)}배</b><span class="muted">${esc(when)}</span></div>
        <div class="vr-txt">
          <p>${h.candle} <span class="num ${h.chg >= 0 ? "up" : "down"}">${sgn(h.chg)}</span> · ${st.lookback}일 <span class="num">${sgn(h.win)}</span></p>
          <p>현재 <span class="num">${price(it.price)}</span>${n ? ` · ${n.side === "sup" ? "지지" : "저항"} 빗각 <span class="num">${sgn(n.gap_pct, 1)}</span>` : ""}</p>
          <p class="muted">1년 범위 ${num(h.pos * 100, 0)}% · 종가 위치 ${num(h.clv * 100, 0)}%${h.tags.length ? ` · ${esc(h.tags.join(", "))}` : ""}</p>
        </div>
        ${volBars(it, h)}
      </div>
    </a>`;
  }

  let critOpen = !isMobile();                                       // 기준(슬라이더)은 폰에서는 접어 둔다
  function render() {
    const hits = items.filter((it) => st.group === "all" || (st.group === "fav" ? fav.has(it.sym) : it.group === st.group))
      .map((it) => [it, screen(it)]).filter(([, h]) => h && (st.view === "all" || h.view === st.view))
      .sort((a, b) => b[1].ratio - a[1].ratio);
    const groups = [...new Set(items.map((it) => it.group))];
    const seg = (key, opts, attr) => `<div class="seg" role="group">${opts.map(([k, l]) => `<button type="button" data-${attr}="${esc(k)}" aria-pressed="${st[key] === k}">${l}</button>`).join("")}</div>`;
    el.innerHTML = `
      <section class="panel">
        <h2 class="h">기관 거래량 포착 <span class="muted">· 거래량은 터졌는데 가격은 버틴 종목</span></h2>
        <details class="box crit"${critOpen ? " open" : ""}>
          <summary class="box-h">기준 <span class="muted" data-crit>거래량 ${num(st.ratio, 1)}배↑ · 가격 ±${num(st.move, 1)}% · 최근 ${st.lookback}세션</span></summary>
          <div class="sliders">
            <label><span>거래량 <b data-v>${num(st.ratio, 1)}배</b> 이상</span><input type="range" min="1.5" max="8" step="0.5" value="${st.ratio}" data-k="ratio"></label>
            <label><span>가격 변동 <b data-v>±${num(st.move, 1)}%</b> 이내</span><input type="range" min="1" max="10" step="0.5" value="${st.move}" data-k="move"></label>
            <label><span>최근 <b data-v>${st.lookback}세션</b> 안</span><input type="range" min="1" max="5" step="1" value="${st.lookback}" data-k="lookback"></label>
          </div>
          <div class="row"><button type="button" class="btn" data-save title="이 기준으로 새 급증을 알림">이 기준으로 알림 받기</button></div>
        </details>
        <div class="bar scroll-x">
          ${seg("group", [["all", "전체"], ["fav", "★ 관심"], ...groups.map((g) => [g, GROUP[g] || g])], "g")}
          ${seg("view", [["all", "모두"], ["매집 후보", "매집 후보"], ["분산 주의", "분산 주의"]], "view")}
        </div>
        <p class="summary"><span class="stage st-2">${hits.length}종목</span></p>
        ${hits.length ? `<div class="vlist">${hits.map(([it, h]) => row(it, h)).join("")}</div>` : `<p class="empty">지금 기준에 맞는 종목이 없습니다. 기준을 열어 거래량 배수를 낮추거나 기간을 늘려 보세요.</p>`}
        <p class="hint">해석: 큰 거래량에도 가격이 버티면 누군가 물량을 받아냈을 수 있습니다(매집·손바뀜). 1년 상단권에서 윗꼬리·약한 마감이면 반대로 물량 넘김(분산)일 수 있어 '분산 주의'로 표시합니다. 방향은 빗각 지지·저항과 함께 판단하세요.
          평소 = 구간 직전 20세션 평균 · 가격 변동 = 급증일 등락률과 구간 누적 등락률 모두 · 장중엔 누적 거래량 기준 · 거래량 없는 지수·환율 제외.</p>
      </section>`;
    let t;
    el.querySelectorAll("input[type=range]").forEach((r) => r.addEventListener("input", () => {
      st[r.dataset.k] = +r.value;
      r.parentElement.querySelector("[data-v]").textContent = r.dataset.k === "ratio" ? `${num(st.ratio, 1)}배` : r.dataset.k === "move" ? `±${num(st.move, 1)}%` : `${st.lookback}세션`;
      clearTimeout(t); t = setTimeout(() => { save("tr-vol", st); critOpen = true; render(); }, 250);
    }));
    el.querySelector("details.crit").addEventListener("toggle", (e) => { critOpen = e.currentTarget.open; });
    el.querySelectorAll("[data-g]").forEach((b) => b.addEventListener("click", () => { st.group = b.dataset.g; save("tr-vol", st); render(); }));
    el.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => { st.view = b.dataset.view; save("tr-vol", st); render(); }));
    el.querySelector("[data-save]").addEventListener("click", async (ev) => {
      ev.currentTarget.disabled = true;
      try {
        await TR.api.post("/api/config", { volume: { ...cfg, on: true, ratio: st.ratio, max_move: st.move, lookback: st.lookback } });
        await TR.reload();
        toast(`거래량 ${st.ratio}배 · ±${st.move}% · ${st.lookback}세션 기준으로 새 급증을 알립니다`);
      } catch (e) { toast(e.message); }
    });
  }
  render();
};
