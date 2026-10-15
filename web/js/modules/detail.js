// 종목 상세: 인터랙티브 차트(15분·1시간·4시간·일봉·주봉) + 서버가 고른 빗각(알림 기준과 같은 선) + 내 빗각 그리기 + 매매 관점·선 품질.
// 빗각은 '일봉 인덱스' 위의 로그 직선이라, 다른 시간 단위에서는 각 봉의 거래일 위치(장중이면 그날 안의 비율)로 옮겨 그린다
//  → 15분봉 위의 선도 알림이 쓰는 값과 정확히 같다.
TR.modules.detail = (el, D, route) => {
  const { esc, num, price, sgn, atr, idxOfDate, toast, roleText, stageLabel, GROUP, load, save, isMobile, ago } = TR.util;
  const items = D.scan?.items || [];
  if (!items.length) { el.innerHTML = `<p class="empty fatal">아직 스캔 결과가 없습니다.</p>`; return; }
  const bySym = Object.fromEntries(items.map((it) => [it.sym, it]));
  const st = Object.assign({ tf: "1d", ma: true, vol: true, log: true, weak: false }, load("tr-detail", {}), { draw: false });
  const last = load("tr-last-sym", null);
  const sym = bySym[route.arg] ? route.arg : bySym[last] ? last : items[0].sym;
  save("tr-last-sym", sym);
  const TFS = [["15m", "15분"], ["1h", "1시간"], ["4h", "4시간"], ["1d", "일봉"], ["1w", "주봉"]];
  if (!TFS.some(([k]) => k === st.tf)) st.tf = "1d";
  const groups = (D.watch.groups || []).filter((g) => g.items.length);
  const order = groups.flatMap((g) => g.items.map((i) => i.sym)).filter((s) => bySym[s]);
  const fav = () => new Set(D.alerts.favorites || []);
  const it = bySym[sym];
  const persist = () => save("tr-detail", { ...st, draw: false });
  const helpSeen = load("tr-chart-help", 0);                     // 조작 안내는 처음 몇 번만 보여 준다
  save("tr-chart-help", helpSeen + 1);
  let chart = null, cur = null;                                   // cur = { tf, data, daily }

  // ---------- 데이터 ----------
  D.tfbars = D.tfbars || {};
  async function getBars(tf) {
    const k = `${sym}:${tf}`, hit = D.tfbars[k], ttl = tf === "1d" || tf === "1w" ? 600000 : 60000;
    if (!hit || Date.now() - hit.at > ttl) D.tfbars[k] = { at: Date.now(), data: await TR.api.get(`/api/bars?sym=${encodeURIComponent(sym)}&tf=${tf}`, 40000) };
    return D.tfbars[k].data;
  }
  const toBars = (r) => r.t.map((t, i) => ({ t, d: r.d[i], o: r.o[i], h: r.h[i], l: r.l[i], c: r.c[i], v: r.v ? r.v[i] : 0 }));

  // 각 봉의 '일봉 인덱스'(소수): 일봉은 그날, 주봉은 그 주 첫 거래일, 장중은 그날 위치 + 그날 안의 순서 비율
  function dailyIndex(bars, dd, tf) {
    const out = new Array(bars.length);
    if (tf === "1d" || tf === "1w") { bars.forEach((b, i) => { out[i] = idxOfDate(dd, b.d); }); return out; }
    const cnt = {};
    for (const b of bars) cnt[b.d] = (cnt[b.d] || 0) + 1;
    const vals = Object.values(cnt).sort((a, b) => a - b), typical = vals[Math.floor(vals.length / 2)] || 1;
    const seen = {};
    bars.forEach((b, i) => { const k = (seen[b.d] = (seen[b.d] ?? -1) + 1); out[i] = idxOfDate(dd, b.d) + k / Math.max(cnt[b.d], typical); });
    return out;
  }
  function mapper(dIdx) {
    const n = dIdx.length, m = Math.min(60, n - 1), dpb = m > 0 ? (dIdx[n - 1] - dIdx[n - 1 - m]) / m || 1 : 1;
    return (i) => {
      if (i <= 0) return dIdx[0] + i * dpb;
      if (i >= n - 1) return dIdx[n - 1] + (i - (n - 1)) * dpb;
      const lo = Math.floor(i), f = i - lo;
      return dIdx[lo] + (dIdx[lo + 1] - dIdx[lo]) * f;
    };
  }
  function chartLine(x, dd, dIdx, D_) {
    const i1 = idxOfDate(dd, x.d1), i2 = idxOfDate(dd, x.d2);
    if (i2 <= i1) return null;
    const lp1 = Math.log(x.p1), m = (Math.log(x.p2) - lp1) / (i2 - i1);
    let lo = 0, hi = dIdx.length - 1;                            // 시작 = 첫 앵커가 있는 봉
    while (lo < hi) { const mid = (lo + hi) >> 1; if (dIdx[mid] < i1 - 1e-9) lo = mid + 1; else hi = mid; }
    const start = dIdx[lo] >= i1 - 1e-9 ? lo : dIdx.length - 1;
    let lo2 = start, hi2 = dIdx.length - 1;                       // 둘째 앵커가 있는 봉(내 선 손잡이 위치)
    while (lo2 < hi2) { const mid = (lo2 + hi2) >> 1; if (dIdx[mid] < i2 - 1e-9) lo2 = mid + 1; else hi2 = mid; }
    const label = x.kind === "user" ? "내 빗각" : `${x.status === "broken" ? "전환" : x.side === "sup" ? "지지" : "저항"} ${x.grade}`;
    return { id: x.kind === "user" ? x.id : null, a: { i: start, p: x.p1 }, b: { i: lo2, p: x.p2 }, kind: x.kind, side: x.side, broken: x.status === "broken", weak: !x.alertable && x.kind !== "user",
             width: x.grade === "S" ? 2.6 : x.kind === "user" ? 2.4 : 2, label: x.alertable || x.kind === "user" ? label : "", start,
             valueAt: (i) => { const di = D_(i); return di < i1 - 1e-9 ? null : Math.exp(lp1 + m * (di - i1)); } };
  }

  async function loadChart(keepView) {
    const box = el.querySelector(".chart-box");
    try {
      if (!cur || cur.tf !== st.tf) {
        box.classList.add("loading");
        const [data, daily] = await Promise.all([getBars(st.tf), getBars("1d")]);
        if (TR.route().page !== "chart" || (TR.route().arg && TR.route().arg !== sym)) return;
        cur = { tf: st.tf, bars: toBars(data), daily };
        keepView = false;
      }
      applyChart(keepView);
    } catch (e) {
      box.querySelector(".ch-ohlc") && (box.querySelector(".ch-ohlc").textContent = `차트를 불러오지 못했습니다: ${e.message}`);
    } finally { box.classList.remove("loading"); }
  }
  function applyChart(keepView) {
    if (!cur) return;
    const bars = cur.bars, dd = cur.daily.d, dIdx = dailyIndex(bars, dd, cur.tf), D_ = mapper(dIdx);
    const lines = it.lines.filter((x) => x.status !== "expired" && (st.weak || x.alertable || x.kind === "user"))
      .map((x) => chartLine(x, dd, dIdx, D_)).filter(Boolean);
    const closes = bars.map((b) => b.c);
    const series = st.ma ? [20, 60, 120, 200].map((p) => ({ vals: TR.ta.sma(closes, p) })) : [];
    chart.setData({ bars, lines, series, log: st.log, volume: st.vol, tf: cur.tf, draw: st.draw }, keepView);
    const saved = TR.store.chartView;
    if (!keepView && saved && saved.key === `${sym}:${cur.tf}`) chart.setView(saved.v);
  }

  // ---------- 옆 패널 ----------
  function sideList() {
    const q = (load("tr-detail-q", "") || "").toLowerCase();
    return groups.map((g) => {
      const its = g.items.filter((i) => bySym[i.sym] && (!q || i.name.toLowerCase().includes(q) || i.sym.toLowerCase().includes(q)));
      if (!its.length) return "";
      return `<div class="dl-grp"><p class="dl-grp-h">${esc(GROUP[g.id] || g.label)}</p>${its.map((i) => {
        const x = bySym[i.sym], n = x.nearest;
        return `<a class="dl-sym${i.sym === sym ? " on" : ""}" href="#chart/${encodeURIComponent(i.sym)}"><span>${fav().has(i.sym) ? "★ " : ""}${esc(x.name)}</span>
          <span class="num ${n?.stage ? `st-t${n.stage}` : "muted"}">${n ? sgn(n.gap_pct, 1) : "—"}</span></a>`;
      }).join("")}</div>`;
    }).join("");
  }

  function planBox(lines) {
    const sup = lines.filter((x) => x.side === "sup" && x.status !== "expired" && x.alertable && x.plan).sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap))[0];
    const res = lines.filter((x) => x.side === "res" && x.status !== "expired" && x.alertable).sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap))[0];
    const ts = it.trend;
    const rows = [["추세", `<span class="trend t${Math.sign(ts.score)}">${esc(ts.label)}</span> <span class="muted">(${ts.score > 0 ? "+" : ""}${ts.score}/4)</span>`],
                  ["일간 변동폭", `${num(it.atr_pct, 2)}% <span class="muted">(ATR 14)</span>`]];
    if (sup) {
      const p = sup.plan, A = it.atr;
      rows.push(["기준 지지", `${esc(roleText(sup))} <span class="gr gr-${sup.kind === "user" ? "u" : sup.grade}">${sup.kind === "user" ? "내선" : sup.grade}</span> ${price(sup.now)} <span class="muted">(${sgn(sup.gap_pct)} · ${atr(sup.gap)})</span>`]);
      rows.push(["관찰 구간", `${price(sup.now)} ~ ${price(sup.now + 0.5 * A)} <span class="muted">(선 ~ +0.5ATR)</span>`]);
      rows.push(["손절", `${price(p.stop)} 종가 이탈 <span class="muted">(선 −0.5ATR · ${sgn((p.stop / it.price - 1) * 100)})</span>`]);
      rows.push(["목표", p.target ? `${esc(p.target_kind)} ${price(p.target)} <span class="muted">(${sgn((p.target / it.price - 1) * 100)})</span>` : "—"]);
      rows.push(["손익비", p.rr != null ? `${num(p.rr, 2)} : 1${p.rr < 1.5 ? ` <span class="muted">— 매력 낮음</span>` : p.rr >= 2 ? ` <span class="muted">— 양호</span>` : ""}` : "—"]);
    }
    if (res) rows.push(["위 저항", `${esc(roleText(res))} ${price(res.now)} <span class="muted">(${sgn(-res.gap_pct)})</span>`]);
    const warn = ts.score <= -2 && sup ? `<p class="warnmsg">하락 추세 속 지지 — 역추세 자리입니다. 반응 확인 마감을 보고 판단하세요.</p>` : "";
    return `<div class="box"><p class="box-h">매매 관점 <span class="muted">· 알림 전용, 판단은 본인 몫</span></p>${warn}
      <dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl></div>`;
  }

  function lineRow(x) {
    const cls = x.kind === "user" ? "lg-user" : x.side === "sup" ? "lg-sup" : "lg-res";
    const status = x.status === "broken" ? `<span class="tg rt">${x.orig === "sup" ? "이탈" : "돌파"} ${esc((x.break_d || "").slice(5))} · 리테스트 대기</span>`
      : x.stage ? `<span class="stage st-${x.stage} side-${x.side}">${esc(stageLabel(x))}</span>` : `<span class="muted">대기</span>`;
    const qd = x.qd || {};
    const q = x.kind === "user" ? `<span class="gr gr-u">내선</span>`
      : `<span class="gr gr-${x.grade}">${x.grade}</span> <b class="num">${num(x.q, 0)}</b>점 · 터치 ${x.touches}회${qd.err != null ? ` · 오차 ${num(qd.err, 2)}ATR` : ""} · 반응 ${num(qd.react, 1)}ATR · 기간 ${qd.span}일${qd.pierce ? ` · 꼬리 뚫림 ${qd.pierce}` : ""}`;
    return `<li class="ln${x.status !== "valid" ? " broken" : ""}${x.alertable ? "" : " weak"}">
      <div class="ln-h"><i class="lg ${cls}${x.status === "broken" ? " dash" : ""}"></i><b>${esc(roleText(x))}</b> <span class="muted">${esc(x.window)}</span> ${status}
        ${x.kind === "user" ? `<button type="button" class="x" data-del="${esc(x.id)}" aria-label="이 선 지우기">×</button>` : ""}</div>
      <p class="num">${price(x.now)} <b>${sgn(x.gap_pct, 2)}</b> · ${atr(x.gap)} · 월 ${sgn(x.slope_month, 1)}${x.steep ? ` <span class="tg stale" title="하루에 0.5ATR 넘게 움직이는 가파른 선">가파름</span>` : ""}</p>
      <p>${q}</p>
      <p>${x.last_touch_d ? `마지막 터치 ${esc(x.last_touch_d.slice(5))}` : ""}${x.conf?.length ? ` · 합류 <b>${esc(x.conf.join(", "))}</b>` : ""}${x.approaching ? ` · <span class="appr">다가오는 중</span>` : ""}${x.alertable ? "" : ` · <span class="muted">알림 제외(신뢰도 낮음)</span>`}</p>
      ${x.note ? `<p class="muted">메모: ${esc(x.note)}</p>` : ""}
    </li>`;
  }

  // ---------- 화면 ----------
  function page() {
    const lines = it.lines.slice().sort((a, b) => (a.status === "valid" ? 0 : 1) - (b.status === "valid" ? 0 : 1) || (b.alertable - a.alertable) || Math.abs(a.gap) - Math.abs(b.gap));
    const mine = D.lines[sym] || [];
    const tvUrl = it.tv ? `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(it.tv)}` : null;
    const i = order.indexOf(sym), prev = order[(i - 1 + order.length) % order.length], next = order[(i + 1) % order.length];
    const v = it.vol, canDraw = st.tf === "1d" || st.tf === "1w";
    const tog = (k, label, on) => `<button type="button" class="btn sm${on ? " on" : ""}" data-t="${k}" aria-pressed="${on}">${label}</button>`;
    el.innerHTML = `
      <section class="panel dt">
        <aside class="dl desk-only"><input class="search" type="search" placeholder="종목 검색" value="${esc(load("tr-detail-q", ""))}" data-dq aria-label="종목 검색"><div class="dl-list">${sideList()}</div></aside>
        <div class="dt-main">
          <div class="bar dt-top">
            <a class="icon-btn" href="#chart/${encodeURIComponent(prev)}" aria-label="이전 종목">‹</a>
            <select class="sel dt-pick" data-pick aria-label="종목">${groups.map((g) => `<optgroup label="${esc(GROUP[g.id] || g.label)}">${g.items.filter((x) => bySym[x.sym]).map((x) => `<option value="${esc(x.sym)}"${x.sym === sym ? " selected" : ""}>${esc(x.name)} (${esc(x.sym)})</option>`).join("")}</optgroup>`).join("")}</select>
            <a class="icon-btn" href="#chart/${encodeURIComponent(next)}" aria-label="다음 종목">›</a>
          </div>
          <div class="dt-title">
            <button type="button" class="star${fav().has(sym) ? " on" : ""}" data-star="${esc(sym)}" aria-pressed="${fav().has(sym)}" aria-label="관심 종목">★</button>
            <b class="desk-only">${esc(it.name)}</b> <span class="code desk-only">${esc(sym)}</span> <span class="num dt-px">${price(it.price)}</span> <span class="num ${it.chg >= 0 ? "up" : "down"}">${sgn(it.chg, 2)}</span>
            ${it.live ? `<span class="live" title="진행 중인 봉">●</span>` : ""}
            ${tvUrl ? `<a class="btn sm dt-tv" href="${esc(tvUrl)}" target="_blank" rel="noopener noreferrer" title="TradingView에서 열기">TradingView ↗</a>` : ""}
          </div>
          <div class="seg seg-full" role="group" aria-label="시간 단위">${TFS.map(([k, l]) => `<button type="button" data-tf="${k}" aria-pressed="${st.tf === k}">${l}</button>`).join("")}</div>
          <div class="bar scroll-x dt-tools">
            <button type="button" class="btn sm${st.draw ? " on" : ""}" data-draw aria-pressed="${st.draw}"${canDraw ? "" : " disabled title=\"빗각 그리기는 일봉·주봉에서\""}>✏️ ${st.draw ? "그리는 중" : "빗각 그리기"}</button>
            ${mine.length ? `<button type="button" class="btn sm" data-clear>내 빗각 지우기 ${mine.length}</button>` : ""}
            ${tog("log", "로그", st.log)}${tog("ma", "이평", st.ma)}${tog("vol", "거래량", st.vol)}${tog("weak", "약한 선", st.weak)}
            <button type="button" class="btn sm" data-fit title="화면 맞춤(더블클릭·두 번 탭과 같음)">⟲ 맞춤</button>
          </div>
          ${st.draw ? `<p class="drawhint">차트에서 시작점과 끝점을 차례로 ${isMobile() ? "탭" : "클릭"}하세요(그리는 중에도 드래그로 이동 가능). 선은 오른쪽으로 연장되고 저장되어 알림 대상이 됩니다.</p>` : ""}
          <div class="chart-box"></div>
          ${helpSeen < 3 ? `<p class="hint ch-help">${isMobile() ? "두 손가락으로 확대·축소 · 좌우로 밀어 이동 · 가격 축을 위아래로 끌면 세로 확대 · 두 번 탭하면 맞춤 · 내 빗각을 누르면 끝점 옮기기·지우기" : "휠로 확대·축소 · 드래그로 이동 · 가격·시간 축을 끌어 늘리기 · 더블클릭으로 맞춤 · 내 빗각을 클릭하면 끝점 옮기기·지우기"}${canDraw ? "" : " · 빗각 그리기는 일봉·주봉에서"}</p>` : ""}
          <div class="legend"><span><i class="lg lg-sup"></i>지지 빗각</span><span><i class="lg lg-res"></i>저항 빗각</span><span><i class="lg lg-sup dash"></i>역할 전환(리테스트 대기)</span><span><i class="lg lg-user"></i>내 빗각</span>
            ${st.ma ? `<span><i class="lg lg-ma20"></i>MA20</span><span><i class="lg lg-ma60"></i>MA60</span><span><i class="lg lg-ma120"></i>MA120</span><span><i class="lg lg-ma200"></i>MA200</span>` : ""}</div>
        </div>
        <aside class="dt-side">
          ${planBox(lines)}
          <div class="box">
            <p class="box-h">빗각 ${lines.length}개 <span class="muted">· 알림 기준과 같은 선</span></p>
            <ul class="lns">${lines.map(lineRow).join("") || `<li class="muted">뚜렷한 빗각이 없습니다</li>`}</ul>
            <details class="more"><summary>등급은 어떻게 매기나요?</summary>
              <p class="hint">신뢰도 0~100점 = 터치(여러 번) · 정밀도(작은 오차) · 시간 범위(길수록) · 반응(닿고 되돌림) − 꼬리 뚫림. 주봉에서 찾은 선은 가산점.
              등급 S 75↑(터치 4회↑) · A 60↑ · B 40↑(터치 3회↑) · C는 알림 제외. 과거 검증에서 등급이 '선이 지켜질 확률'을 높이진 않았으니, 깔끔한 선을 고르는 기준으로 보세요.</p></details>
          </div>
          ${v ? `<div class="box"><p class="box-h">📊 거래량 급증 <span class="tg vol">${esc(v.view)}</span></p>
            <p>${esc(v.spike_d)} 거래량 <b>${num(v.ratio, 1)}배</b> · ${esc(v.candle)} ${sgn(v.day_chg)} · 3일 ${sgn(v.window_chg)}</p>
            <p class="muted">1년 범위 ${num(v.pos_1y * 100, 0)}% 위치${v.vs_ma120 != null ? ` · MA120 ${sgn(v.vs_ma120)}` : ""}${v.tags.length ? ` · ${esc(v.tags.join(", "))}` : ""}</p></div>` : ""}
          <div class="box news" data-news><p class="box-h">📰 주요 소식 <span class="muted">불러오는 중…</span></p></div>
          <div class="box">
            <p class="box-h">참고</p>
            <dl class="kv">
              <dt>MA20 / 60</dt><dd class="num">${it.ma["20"] ? sgn((it.price / it.ma["20"] - 1) * 100) : "—"} / ${it.ma["60"] ? sgn((it.price / it.ma["60"] - 1) * 100) : "—"}</dd>
              <dt>MA120 / 200</dt><dd class="num">${it.ma["120"] ? sgn((it.price / it.ma["120"] - 1) * 100) : "—"} / ${it.ma["200"] ? sgn((it.price / it.ma["200"] - 1) * 100) : "—"}</dd>
              <dt>거래량</dt><dd>${it.vol_ratio ? `최근 5일 = 20일 평균의 ${num(it.vol_ratio, 2)}배` : "데이터 없음"}</dd>
              <dt>데이터</dt><dd>${esc({ binance: "Binance", bybit: "Bybit", naver: "네이버", yahoo: "Yahoo" }[it.src] || it.src)} 일봉 · ${esc(it.date)}${it.live ? " (진행 중)" : ""}${it.stale ? ` · <span class="stale">수집 실패, 이전 데이터</span>` : ""}</dd>
            </dl>
          </div>
        </aside>
      </section>`;

    // 차트의 두 점(봉 번호 · 가격) → 저장할 내 선. 그린 시점의 위치로 역할 결정: 현재가가 선 위면 지지, 아래면 저항
    function userLine(a, b) {
      if (!cur || !(cur.tf === "1d" || cur.tf === "1w")) return null;
      const d1 = cur.bars[a.i]?.d, d2 = cur.bars[b.i]?.d;
      if (!d1 || !d2 || d1 >= d2) { toast("서로 다른 두 날짜를 선택하세요"); return null; }
      const dd = cur.daily.d, i1 = idxOfDate(dd, d1), i2 = idxOfDate(dd, d2);
      const now = Math.exp(Math.log(a.p) + ((Math.log(b.p) - Math.log(a.p)) / (i2 - i1 || 1)) * (dd.length - 1 - i1));
      return { d1, p1: a.p, d2, p2: b.p, side: it.price >= now ? "sup" : "res" };
    }
    chart?.destroy();
    chart = TR.chart.create(el.querySelector(".chart-box"), {
      height: isMobile() ? 380 : 520,
      onView: (v) => { if (cur) TR.store.chartView = { key: `${sym}:${cur.tf}`, v }; },       // 15분마다 새로 그려도 보던 범위 유지
      onDraw: async (a, b) => {
        const ln = userLine(a, b);
        if (ln) await saveLines([...mine, ln]);
      },
      onEdit: async (id, a, b) => {                                 // 내 선 끝점 · 통째 이동
        const ln = userLine(a, b);
        if (ln) await saveLines(mine.map((u) => (u.id === id ? { ...u, ...ln } : u)));
      },
      onDelete: (id) => saveLines(mine.filter((u) => u.id !== id)),
    });
    chart.setDraw(st.draw);
    if (cur) applyChart(false);
    loadChart(false);

    el.querySelectorAll("[data-tf]").forEach((b) => b.addEventListener("click", () => {
      st.tf = b.dataset.tf; if (!(st.tf === "1d" || st.tf === "1w")) st.draw = false; persist(); TR.store.busy = st.draw; page();
    }));
    el.querySelectorAll("[data-t]").forEach((b) => b.addEventListener("click", () => {
      st[b.dataset.t] = !st[b.dataset.t]; persist();
      b.classList.toggle("on", st[b.dataset.t]); b.setAttribute("aria-pressed", st[b.dataset.t]);
      applyChart(true);
    }));
    el.querySelector("[data-fit]").addEventListener("click", () => chart.reset());
    el.querySelector("[data-draw]").addEventListener("click", () => { st.draw = !st.draw; TR.store.busy = st.draw; persist(); page(); });
    el.querySelector("[data-pick]").addEventListener("change", (e) => { location.hash = `#chart/${encodeURIComponent(e.target.value)}`; });
    el.querySelector("[data-clear]")?.addEventListener("click", () => { if (confirm(`${it.name}의 내 빗각 ${mine.length}개를 모두 지울까요?`)) saveLines([]); });
    el.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => saveLines(mine.filter((u) => u.id !== b.dataset.del))));
    el.querySelectorAll("[data-star]").forEach((b) => b.addEventListener("click", () => TR.toggleFav(b.dataset.star, b)));
    const dq = el.querySelector("[data-dq]");
    dq?.addEventListener("input", () => { save("tr-detail-q", dq.value); el.querySelector(".dl-list").innerHTML = sideList(); });
    el.querySelector(".dl-sym.on")?.scrollIntoView({ block: "nearest" });
    loadNews();
  }

  // ---------- 주요 소식(최근 30일 중 중요한 소식만 · 30분 캐시, 고르는 규칙은 js/engine/news.js · scripts/news.py) ----------
  async function loadNews(force = false) {
    const box = el.querySelector("[data-news]");
    if (!box) return;
    try {
      const r = await TR.api.get(`/api/news?sym=${encodeURIComponent(sym)}${force ? "&force=1" : ""}`, 30000);
      if (box.isConnected) drawNews(box, r);
    } catch (e) {
      if (box.isConnected) box.innerHTML = `<p class="box-h">📰 주요 소식</p><p class="muted">소식을 불러오지 못했습니다: ${esc(e.message)}</p>`;
    }
  }
  function drawNews(box, r) {
    const items = r.items || [], keyTags = TR.newsRules.key[it.group === "crypto" ? "crypto" : it.group === "us" || it.group === "kr" ? "stock" : "other"] || [];
    box.innerHTML = `<p class="box-h">📰 주요 소식 <span class="muted">${items.length ? `${items.length}건` : ""}${r.total ? ` · 최근 30일 소식 ${r.total}건 중` : ""}</span>
        <button type="button" class="linkbtn" data-nr title="다시 불러오기">↻</button></p>
      <ul class="news-list">${items.map((x) => `<li class="${x.key ? "key" : ""}"><a href="${esc(x.link)}" target="_blank" rel="noopener noreferrer">${esc(x.title)}</a>
        <span class="muted">${esc(x.source)}${x.t ? ` · ${esc(ago(new Date(x.t).toISOString()))}` : ""}</span>${x.n >= 2 ? `<span class="tg cov" title="같은 소식을 다룬 매체 수">보도 ${x.n}곳</span>` : ""}${(x.tags || []).map((t) => `<span class="tg${keyTags.includes(t) ? " appr" : ""}">${esc(t)}</span>`).join("")}</li>`).join("")
        || `<li class="muted">최근 30일 동안 눈에 띄는 소식이 없습니다.</li>`}</ul>
      <details class="more"><summary>어떤 소식을 고르나요?</summary><p class="hint">${it.group === "crypto" ? "메인넷 · 업그레이드 · 개발 · 승인 · 보안" : it.group === "us" || it.group === "kr" ? "신기술 · 출시 · 개발 · 특허 · 승인 · 인수 · 수주" : "금리 결정 · 지표 · 관세 같은 정책"} 소식 중 여러 매체가 다룬 것을 골랐습니다. 가격 · 시황 기사는 뺍니다. 제목 · 출처만 보여 주고, 누르면 원문이 열립니다.</p></details>`;
    box.querySelector("[data-nr]").addEventListener("click", () => { box.querySelector(".box-h .muted").textContent = "불러오는 중…"; loadNews(true); });
  }

  async function saveLines(list) {
    try {
      await TR.api.post("/api/lines", { sym, lines: list });
      st.draw = false; TR.store.busy = false; persist();
      await TR.reload();
      toast(list.length ? "내 빗각을 저장했습니다 · 다음 스캔부터 알림 대상" : "내 빗각을 지웠습니다");
    } catch (e) { toast(`저장 실패: ${e.message}`); }
  }
  TR.store.busy = st.draw;
  page();
};
