// 반도체 화면의 섹션들(js/modules/semi.js가 부른다). 각 함수는 ctx = { mod, items, H, link, empty, fmtDate, safe, st, keep, bundle }를 받아 HTML을 돌려준다.
// 숫자 · 표시 규칙은 Daily Market Radar(DMR)와 같게: 금리는 bp, 등락 색은 한국식(상승 빨강), 시세 소수 자리는 DMR tickers.json의 decimals.
TR.semiView = (() => {
  const { esc, num } = TR.util;
  const dir = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");
  const arrow = (v) => (v > 0 ? "▲" : v < 0 ? "▼" : "");
  const signed = (v, d) => (v > 0 ? "+" : "") + num(v, d);
  const pct = (v, d = 1, suffix = "%") => (v == null ? "—" : `${arrow(v)} ${signed(v, d)}${suffix}`);
  const md = (iso) => (iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}` : "");
  const todayKST = () => TR.core?.isoKST ? TR.core.isoKST().slice(0, 10) : new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

  // 시세 등락: 금리는 bp, 나머지는 %
  function change(q, t) {
    if (!q || q.change_pct == null) return { html: "—", cls: "" };
    if (t?.type === "rate") { const bp = Math.round((q.change ?? 0) * 100); return { html: `${arrow(bp)} ${bp > 0 ? "+" : ""}${bp}bp`, cls: dir(bp) }; }
    return { html: pct(q.change_pct, 2), cls: dir(q.change_pct) };
  }
  function spark(values, w = 84, h = 22) {
    const v = (values || []).filter((x) => x != null && isFinite(x));
    if (v.length < 2) return "";
    const lo = Math.min(...v), span = Math.max(...v) - lo || 1;
    const pts = v.map((x, i) => `${((i / (v.length - 1)) * w).toFixed(1)},${(h - 2 - ((x - lo) / span) * (h - 4)).toFixed(1)}`).join(" ");
    return `<svg class="sm-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" vector-effect="non-scaling-stroke"/></svg>`;
  }
  const quotesOf = (c) => Object.fromEntries(c.items("snapshot").map((q) => [q.id, q]));
  const tickersOf = (c) => c.bundle.config.tickers?.tickers || {};

  // Radar가 감시하는 종목이면 Radar 차트(빗각 포함)로, 아니면 야후로
  function radarItem(yf) {
    const scan = TR.store?.data?.scan?.items || [];
    return yf ? scan.find((x) => x.sym === yf) : null;
  }
  function nearTag(it) {
    const n = it?.lines?.filter((x) => x.status !== "expired" && x.alertable).sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap))[0];
    const stg = n ? TR.sticky.view(n) : null;
    return stg && stg.stage > 0 ? ` <span class="stage st-${stg.stage} side-${stg.side}" title="Radar 빗각">${esc(TR.util.stageLabel(stg))}</span>` : "";
  }

  // ---------- 요약 ----------
  function brief(c) {
    const its = c.items("brief");
    if (!its.length) return "";
    return `<div class="box">${c.H("📰 오늘의 브리프", "숫자만 · 규칙 기반")}
      <ol class="sm-brief">${its.slice(0, 3).map((b) => `<li><b>${esc(b.headline)}</b>${b.detail ? `<span class="muted"> — ${esc(b.detail)}</span>` : ""}</li>`).join("")}</ol></div>`;
  }

  function kpis(c) {
    const T = tickersOf(c), Q = quotesOf(c), today = todayKST();
    const mem = Object.fromEntries(c.items("memory").map((m) => [m.product, m]));
    const cards = (c.bundle.config.settings?.kpis || []).map((k) => {
      if (k.type === "ticker") {
        const t = T[k.id], q = Q[k.id];
        if (!t) return "";
        const ch = change(q, t), notes = [];
        if (q?.trade_date && q.trade_date !== today) notes.push(`${md(q.trade_date)} 종가`);
        if (q?.high_52w && q.price) notes.push(`52주 고점 ${signed((q.price / q.high_52w - 1) * 100, 1)}%`);
        return `<div class="sm-kpi"><p class="sm-kpi-l">${esc(t.display)}</p>
          <p class="sm-kpi-v"><span class="num">${num(q?.price, t.type === "index" ? 0 : t.decimals)}</span> <span class="num sm-chg ${ch.cls}">${ch.html}</span></p>
          <p class="sm-kpi-s muted">${esc(notes.join(" · ")) || "&nbsp;"}</p></div>`;
      }
      const m = mem[k.product];
      if (!m || (!m.latest && !m.spot)) return `<div class="sm-kpi"><p class="sm-kpi-l">${esc(k.product)}</p><p class="sm-kpi-s muted">가격 데이터 없음</p></div>`;
      const main = m.latest ? { l: `${m.label} · ${Number(m.latest.month.slice(5, 7))}월`, p: m.latest.price, c: m.latest.mom_pct, u: "% MoM" }
        : { l: `${m.label} · ${md(m.spot.as_of)}`, p: m.spot.price, c: m.spot.change_pct, u: "% 전일" };
      const spot = m.latest && m.spot ? `현물 <span class="num">$${num(m.spot.price, 2)}</span> <span class="num ${dir(m.spot.change_pct)}">${pct(m.spot.change_pct, 2)}</span> ${md(m.spot.as_of)}` : "&nbsp;";
      return `<div class="sm-kpi" title="${esc(m.source || "")}"><p class="sm-kpi-l">${esc(main.l)}</p>
        <p class="sm-kpi-v"><span class="num">$${num(main.p, 2)}</span> <span class="num sm-chg ${dir(main.c)}">${pct(main.c, 1, main.u)}</span></p>
        <p class="sm-kpi-s muted">${spot}</p></div>`;
    }).join("");
    return cards ? `<div class="sm-kpis">${cards}</div>` : "";
  }

  function snapshot(c) {
    const T = tickersOf(c), Q = quotesOf(c), snap = c.mod("snapshot");
    const groups = (c.bundle.config.tickers?.groups || []).filter((g) => g.panel === "snapshot");
    if (!groups.length || !snap) return "";
    const hl = c.bundle.config.settings?.highlight_pct ?? 2;
    const row = (id) => {
      const t = T[id], q = Q[id];
      if (!t) return "";
      const yf = t.sources?.yfinance || "", rit = radarItem(yf), ch = change(q, t);
      const hot = q && t.type !== "rate" && Math.abs(q.change_pct) >= hl;
      const href = rit ? `#chart/${encodeURIComponent(rit.sym)}` : `https://finance.yahoo.com/quote/${encodeURIComponent(yf)}`;
      const ext = rit ? "" : ` target="_blank" rel="noopener noreferrer"`;
      return `<li class="sm-row${hot ? " hot" : ""}"${q?.error ? ` title="수집 실패: ${esc(q.error)}"` : ""}>
        <a class="sm-nm" href="${esc(href)}"${ext}><b>${esc(t.display)}</b>${rit ? nearTag(rit) : ` <span class="muted ext">↗</span>`}</a>
        <span class="num sm-px">${num(q?.price, t.decimals)}</span><span class="num sm-chg ${ch.cls}">${ch.html}</span>${spark(q?.spark)}</li>`;
    };
    return `<div class="box">${c.H("📊 시세", `${snap.generated_at ? `${c.fmtDate(snap.generated_at)} · ` : ""}±${hl}% 강조 · 1개월 추세 · 이름 = Radar 차트`)}
      ${snap.status !== "ok" ? `<p class="semi-err">시세 일부 지연(${esc(snap.status)})</p>` : ""}
      <div class="sm-groups">${groups.map((g) => `<div><p class="sm-grp">${esc(g.label)}</p><ul class="sm-list">${g.tickers.map(row).join("")}</ul></div>`).join("")}</div></div>`;
  }

  const sum = (c) => [c.safe("브리프", () => brief(c)), c.safe("KPI", () => kpis(c)), c.safe("시세", () => snapshot(c))].join("") || c.empty("요약 데이터가 없습니다.");
  // ---------- 메모리: 사이클 판단 · 가격판 · 전망 ----------
  const usd = (v) => (v == null ? "—" : `$${num(v, v >= 1000 ? 0 : 2)}`);
  const pc = (v, d = 1) => (v == null ? `<span class="muted">—</span>` : `<span class="${dir(v)}">${v > 0 ? "+" : ""}${num(v, d)}%</span>`);
  const SIG = { expand: ["▲", "확장"], neutral: ["■", "중립"], slow: ["▼", "둔화"] };
  const STAGES = [["expand", "확장 지속"], ["late", "확장 후반"], ["peak", "피크 논쟁"], ["down", "하강 국면"]];
  const chip = (sg) => (SIG[sg] ? `<span class="sig sig-${sg}"><b aria-hidden="true">${SIG[sg][0]}</b>${SIG[sg][1]}</span>` : "");
  const when = (a) => (!a ? "" : a.length === 7 ? `${a.slice(2, 4)}.${a.slice(5, 7)}월` : md(a));

  function cycle(c) {
    const env = c.mod("cycle"), its = c.items("cycle"), sm = env?.summary;
    if (!its.length || !sm) return `<div class="box">${c.H("🔄 반도체 사이클")}${c.empty("사이클 지표가 아직 없습니다.")}</div>`;
    const tally = (t) => `${chip("expand")} ${t.expand} · ${chip("neutral")} ${t.neutral} · ${chip("slow")} ${t.slow}`;
    const ck = env.checklist || [], fired = ck.filter((x) => x.on).length;
    const card = (i) => `<details class="cy-card"><summary><span class="cy-name">${esc(i.name)}</span>${chip(i.signal)}<span class="cy-val num">${esc(i.display)}</span></summary>
        ${(i.series || []).length >= 3 ? spark(i.series.map((q) => q[1]), 160, 26) : ""}
        <p class="cy-meta muted">${esc(i.lead || "")}${i.as_of ? ` · ${esc(when(i.as_of))}` : ""}${i.source ? ` · ${esc(i.source)}` : ""}</p>
        ${i.note ? `<p class="cy-note">${esc(i.note)}</p>` : ""}${i.rule ? `<p class="cy-rule">판정 기준: ${esc(i.rule)}</p>` : ""}</details>`;
    const groups = ["가격", "수요", "재고·수주", "시장"];
    return `<div class="box">${c.H("🔄 반도체 사이클 판단", "11개 지표 · 경험칙 · DYOR")}
      <p class="cy-now">${esc(sm.stage_label)}</p>
      <div class="cy-gauge" role="img" aria-label="현재 국면: ${esc(sm.stage_label)}">${STAGES.map(([k, l]) => `<span class="${k === sm.stage ? "on" : ""}">${l}</span>`).join("")}</div>
      <p class="cy-text">${esc(sm.text || "")}</p>
      <dl class="kv cy-split"><dt>펀더멘털</dt><dd>${tally(sm.fundamental || {})}</dd><dt>시장(주가)</dt><dd>${tally(sm.market || {})}</dd></dl>
      <p class="sm-grp">전환 신호 <b class="num">${fired}</b> / ${ck.length} 점등 <span class="muted">· 보통 먼저 켜지는 순서</span></p>
      <ol class="cy-steps">${ck.map((x) => `<li class="${x.on ? "on" : ""}${x.available ? "" : " na"}"><span class="cy-dot" aria-hidden="true">${x.on ? "●" : "○"}</span><span>${esc(x.name)}${x.available ? "" : ` <span class="muted">(데이터 없음)</span>`}</span></li>`).join("")}</ol>
      <details class="more"><summary>지표 ${its.length}개 보기 (눌러서 판정 기준)</summary>
        ${groups.map((g) => { const l = its.filter((i) => i.group === g); return l.length ? `<p class="sm-grp">${esc(g)}</p><div class="cy-cards">${l.map(card).join("")}</div>` : ""; }).join("")}
      </details></div>`;
  }

  function board(c) {
    const m = c.mod("memory"), bd = m?.board || [];
    const ratios = (m?.ratios || []).map((r) => `<div class="pb-ratio"><p><span class="muted">${esc(r.label)}</span> <b class="num">${num(r.value, 2)}배</b>
        ${r.m1 != null ? `<span class="muted">· 한 달 전(${md(r.m1_from)}) ${num(r.m1, 2)}배</span>` : ""}</p>${spark((r.series || []).map((q) => q[1]), 120, 22)}
        ${r.note ? `<p class="hint pb-note">${esc(r.note)}</p>` : ""}</div>`).join("");
    const row = (r) => {
      const sp = r.spot, ct = r.contract, open = c.st.pb === r.label;
      return `<li class="pb-row" data-pbkey="${esc(r.label)}" role="button" tabindex="0" aria-expanded="${open}" title="눌러서 가격 추이">
        <span class="pb-item">${esc(r.label)} <span class="tg">${esc(r.kind || "")}</span> <span class="pb-open" aria-hidden="true">${open ? "▴" : "▾"}</span></span>
        <span class="pb-spot num">${sp ? `${usd(sp.price)}${sp.cadence === "주간" ? `<span class="pb-cad" title="주간 시세">주</span>` : ""}` : `<span class="muted">—</span>`}
          ${sp ? `<small>1개월 ${pc(sp.m1)}${sp.stale ? ` <span class="pb-stale" title="원 출처 기준일이 오래됨">⚠ ${md(sp.as_of)}</span>` : ""}</small>` : ""}</span>
        <span class="pb-ct num">${ct ? `${usd(ct.price)} <span class="muted">${Number(ct.month.slice(5))}월</span><small>MoM ${pc(ct.mom)}${r.premium != null ? ` · 프리미엄 ${pc(r.premium, 0)}` : ""}</small>` : `<span class="muted">—</span>`}</span></li>${open ? c.safe("가격 추이", () => pbChart(c, r)) : ""}`;
    };
    const latest = bd.flatMap((g) => g.rows).map((r) => r.spot?.as_of).filter(Boolean).sort().pop();
    return `<div class="box">${c.H("💾 메모리 가격판", `DRAMeXchange 공개 시세 · USD · 최신 ${latest ? md(latest) : "—"}`)}
      ${ratios ? `<div class="pb-ratios">${ratios}</div>` : ""}
      ${bd.length ? `<div class="pb-head muted"><span>품목</span><span>현물</span><span>고정가</span></div>${bd.map((g) => `<p class="sm-grp">${esc(g.seg)}</p><ul class="pb-list">${g.rows.map(row).join("")}</ul>`).join("")}` : c.empty("가격 데이터가 없습니다.")}
      <p class="hint">품목을 누르면 현물 · 고정가 추이 차트. 현물 = 세션 평균(주 = 주간 시세). 1개월은 매일 쌓은 기록과 비교(기록이 없으면 —). 고정가 = 공개분(회원 공개보다 한 달가량 늦음). 프리미엄 = 현물 ÷ 고정가 − 1(같은 규격만).</p></div>`;
  }


  // ---------- 가격판 품목 추이(누르면 펼침): 현물 · 고정가는 단위 · 규격이 다를 수 있어 따로 그린다 ----------
  const RANGES = [["1m", "1개월", 31], ["3m", "3개월", 92], ["1y", "1년", 366], ["all", "전체", 1e5]];
  const monthEnd = (ym) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
  const tOf = (d) => Date.parse(`${d}T00:00:00Z`);
  function lineChart(pts, cls) {
    const W = 340, H = 120, L = 4, R = 54, T = 8, B = 18, n = pts.length;
    const t0 = tOf(pts[0][0]), t1 = Math.max(tOf(pts[n - 1][0]), t0 + 864e5);
    let lo = Math.min(...pts.map((p) => p[1])), hi = Math.max(...pts.map((p) => p[1]));
    const pad = (hi - lo || Math.abs(hi) * 0.05 || 1) * 0.08; lo -= pad; hi += pad;
    const X = (d) => L + ((tOf(d) - t0) / (t1 - t0)) * (W - L - R), Y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const line = pts.map(([d, v], i) => `${i ? "L" : "M"}${X(d).toFixed(1)},${Y(v).toFixed(1)}`).join("");
    const yrs = pts[0][0].slice(0, 4) !== pts[n - 1][0].slice(0, 4), dl = (d) => (yrs ? `${d.slice(2, 4)}.` : "") + md(d);
    const last = pts[n - 1], ytxt = (v) => usd(v).replace("$", "");
    return `<svg class="pbc-svg ${cls}" viewBox="0 0 ${W} ${H}" role="img" aria-label="가격 추이 ${esc(dl(pts[0][0]))}~${esc(dl(last[0]))}"
        data-pts="${esc(JSON.stringify(pts))}" data-geo="${[L, R, T, B, W, H, t0, t1, lo, hi].join(",")}">
      <line class="grid" x1="${L}" x2="${W - R}" y1="${T}" y2="${T}"/><line class="grid" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>
      <text class="ax" x="${W - R + 4}" y="${T + 4}">${esc(ytxt(hi - pad))}</text><text class="ax" x="${W - R + 4}" y="${H - B}">${esc(ytxt(lo + pad))}</text>
      <path class="ln" d="${line}"/>${n <= 40 ? pts.map(([d, v]) => `<circle class="dot" cx="${X(d).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="2.2"/>`).join("") : ""}
      <circle class="last" cx="${X(last[0]).toFixed(1)}" cy="${Y(last[1]).toFixed(1)}" r="3.2"/>
      <text class="ax" x="${L}" y="${H - 4}">${esc(dl(pts[0][0]))}</text><text class="ax" x="${W - R}" y="${H - 4}" text-anchor="end">${esc(dl(last[0]))}</text>
      <line class="cur" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/><circle class="cur" r="3.6" visibility="hidden"/></svg>`;
  }
  function seriesBox(label, pts, cls) {
    if (pts.length < 2) return `<p class="pbc-few"><b>${esc(label)}</b> <span class="muted">기록 ${pts.length}개${pts[0] ? ` (${md(pts[0][0])} ${usd(pts[0][1])})` : ""} — 쌓이는 중</span></p>`;
    const a = pts[0], z = pts[pts.length - 1];
    return `<div class="pbc"><p class="pbc-h"><b>${esc(label)}</b> <span class="num">${usd(a[1])} → ${usd(z[1])}</span> <b class="num">${pc((z[1] / a[1] - 1) * 100)}</b>
        <span class="muted">${md(a[0])}~${md(z[0])} · ${pts.length}개</span></p><p class="pbc-read muted num" aria-live="polite">&nbsp;</p>${lineChart(pts, cls)}</div>`;
  }
  function pbChart(c, r) {
    const m = c.mod("memory") || {}, rg = RANGES.find((x) => x[0] === c.st.pbRange) || RANGES[3];
    const spot = r.spot ? (m.spot_history?.[r.spot.name] || []) : [], con = r.contract ? (m.contract_history?.[r.contract.name] || []).map(([ym, v]) => [monthEnd(ym), v]) : [];
    const ends = [spot, con].filter((x) => x.length).map((x) => x[x.length - 1][0]).sort(), from = ends.length ? TR.core.addDays(ends[ends.length - 1], -rg[2]) : "";
    const cut = (x) => x.filter((p) => p[0] >= from);
    const first = [spot[0]?.[0], con[0]?.[0]].filter(Boolean).sort()[0];
    return `<li class="pb-chart"><div class="seg pbc-rng" role="group" aria-label="기간">${RANGES.map(([k, l]) => `<button type="button" data-pbrange="${k}" aria-pressed="${rg[0] === k}">${l}</button>`).join("")}</div>
      ${r.spot ? seriesBox(`현물(${r.spot.cadence}) ${r.spot.name}`, cut(spot), "s1") : ""}
      ${r.contract ? seriesBox(`고정가(월간) ${r.contract.name}`, cut(con), "s2") : ""}
      <p class="hint">기록 시작 ${first ? md(first) : "—"}${first && first.slice(0, 4) !== todayKST().slice(0, 4) ? ` (${first.slice(0, 4)})` : ""} · 과거 시세는 DRAMeXchange 회원 전용이라 이 앱이 모은 날부터 쌓입니다(맥은 Daily Market Radar가 쌓은 기록도 합침). 차트를 누르면 그날 값.</p></li>`;
  }

  function outlook(c) {
    const env = c.mod("outlook"), its = c.items("outlook");
    if (!env) return "";
    const sg = (v) => `${v > 0 ? "+" : ""}${num(v, v % 1 ? 1 : 0)}`;
    const rng = (f) => (f.low === f.high ? `${sg(f.low)}%` : `${sg(f.low)}~${f.low > 0 ? num(f.high, f.high % 1 ? 1 : 0) : sg(f.high)}%`);
    const traj = (env.forecasts || []).filter((g) => g.rows?.length).map((g) => `<div class="ol-traj"><span class="ol-subj">${esc(g.subject)} ${esc(g.kind)} <span class="muted">${esc(g.basis)}</span></span>
      <span class="ol-chips">${g.rows.map((r, i) => { const pv = g.rows[i - 1], mid = (r.low + r.high) / 2, pm = pv ? (pv.low + pv.high) / 2 : null;
        const tag = pv == null ? "" : mid < pm ? ` <span class="tg stale">둔화</span>` : mid > pm ? ` <span class="tg appr">가속</span>` : "";
        return `${i ? `<span class="muted" aria-hidden="true">→</span>` : ""}${c.link(r.url, `${r.period} ${rng(r)}`)}${tag}`; }).join(" ")}</span></div>`).join("");
    const withFig = its.filter((it) => it.figures?.length);
    const rel = withFig.map((it) => `<li><p>${c.link(it.url, it.title)}</p><p class="muted sm-meta">${md(it.date)}</p>
      ${it.figures.map((f) => `<details class="ol-fig"><summary>${esc(f.subject)} ${esc(f.kind)} ${f.period ? `<b>${esc(f.period)}</b>` : `<span class="muted">기간 미표기</span>`} <span class="num">${f.approx ? "약 " : ""}${rng(f)}</span>${f.basis ? ` <span class="muted">${esc(f.basis)}</span>` : ""}<span class="more-mk">근거 ▾</span></summary>
        <p class="hint">근거: “${esc(f.clause || "")}”</p></details>`).join("")}</li>`).join("");
    return `<div class="box">${c.H("🔮 가격 전망 · TrendForce", "공개 보도자료 자동 추출 · 눌러서 근거 문장")}
      ${traj ? `<p class="sm-grp">분기 전망 변화</p><div class="ol-trajs">${traj}</div>` : ""}
      <p class="sm-grp">최근 메모리 보도자료</p>${rel ? `<ul class="sm-news">${rel}</ul>` : c.empty("가격 수치가 담긴 최근 보도자료가 없습니다.")}</div>`;
  }

  const mem = (c) => [c.safe("사이클", () => cycle(c)), c.safe("가격판", () => board(c)), c.safe("전망", () => outlook(c))].join("");
  // ---------- 뉴스: 기업 집중(회사 토글 · 주요/최신) · 업계 뉴스(태그) ----------
  const ago = (iso) => (iso ? TR.util.ago(iso) : "");
  // 기사 한 줄(기업 집중 · 고객사 동향 공통): 분류 · 공식 · 중요도 · 제목 · 출처 · 관련 보도
  const newsItem = (c, n, label, who = "") => `<li><p class="sm-tags"><span class="tg">${esc(label[n.category] || "기타")}</span>${who ? `<span class="tg cu">${esc(who)}</span>` : ""}${n.official ? `<span class="tg appr">공식</span>` : ""}${n.score != null ? `<span class="sm-score" title="중요도 ${n.score}점">${"●".repeat(Math.max(1, Math.min(5, Math.round(n.score / 3))))}</span>` : ""}</p>
        <p>${c.link(n.url, n.title)}</p><p class="muted sm-meta">${esc(n.source || "")} · ${esc(ago(n.published_at))}</p>
        ${n.related_count ? `<details class="sm-rel"><summary>관련 보도 ${n.related_count}건</summary><ul>${(n.related || []).map((r) => `<li>${c.link(r.url, r.title)} <span class="muted">· ${esc(r.source || "")}</span></li>`).join("")}${n.related_count > (n.related || []).length ? `<li class="muted">외 ${n.related_count - n.related.length}건</li>` : ""}</ul></details>` : ""}</li>`;
  function company(c) {
    const env = c.mod("company"), all = c.items("company");
    if (!env) return "";
    const cos = env.companies?.length ? env.companies : [{ id: "skhynix", name: "SK하이닉스" }];
    if (!cos.some((x) => x.id === c.st.co)) c.st.co = cos[0].id;
    const cur = cos.find((x) => x.id === c.st.co), focus = !!cur.focus_label && c.st[`focus_${cur.id}`] !== false;
    const label = Object.fromEntries((env.categories || []).map((x) => [x.id, x.label]));
    const mine = all.filter((n) => (n.company || "skhynix") === cur.id && (!focus || n.focus !== false));
    const topN = env.top_n || 10;
    const rows = c.st.coTab === "latest" ? [...mine].sort((a, b) => (b.published_at || "").localeCompare(a.published_at || ""))
      : [...mine].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (b.published_at || "").localeCompare(a.published_at || "")).slice(0, topN);
    const shown = c.st.coMore ? rows : rows.slice(0, 12);
    const item = (n) => newsItem(c, n, label);
    return `<div class="box">${c.H(`🏢 ${esc(cur.name)} 집중`, `중요도 기준 · 최근 5일${cur.dropped ? ` · 덜 중요한 ${cur.dropped}건 제외` : ""}`)}
      <div class="bar scroll-x sm-cos" role="group" aria-label="회사">${cos.map((x) => `<button type="button" class="chipbtn${x.id === cur.id ? " on" : ""}" data-co="${esc(x.id)}" aria-pressed="${x.id === cur.id}">${esc(x.name)} <span class="muted">${all.filter((n) => (n.company || "skhynix") === x.id).length}</span></button>`).join("")}</div>
      <div class="sm-ctl"><div class="seg" role="group">${[["top", `주요 ${Math.min(topN, mine.length)}`], ["latest", `최신 ${mine.length}`]].map(([k, l]) => `<button type="button" data-cotab="${k}" aria-pressed="${(c.st.coTab || "top") === k}">${l}</button>`).join("")}</div>
        ${cur.focus_label ? `<label class="chk"><input type="checkbox" data-cofocus ${focus ? "checked" : ""}> ${esc(cur.focus_label)}</label>` : ""}</div>
      ${shown.length ? `<ul class="sm-news">${shown.map(item).join("")}</ul>` : c.empty("해당 기사가 없습니다.")}
      ${rows.length > shown.length ? `<button type="button" class="btn" data-comore>더 보기 (${rows.length - shown.length})</button>` : ""}</div>`;
  }

  // 고객사 동향: 묶음(AI 가속기 · 하이퍼스케일러 · 서버/PC/모바일) → 고객사 칩 → 점수순. 선정 근거(공시 · 실적 발표)는 펼쳐 본다
  function customers(c) {
    const env = c.mod("customers"), all = c.items("customers");
    if (!env) return "";
    const cos = env.companies || [], groups = [{ id: "all", label: "전체" }, ...(env.groups || [])];
    const label = Object.fromEntries((env.categories || []).map((x) => [x.id, x.label])), nameOf = Object.fromEntries(cos.map((x) => [x.id, x.name]));
    const grp = groups.some((g) => g.id === c.st.cuGrp) ? c.st.cuGrp : "all";
    const inGrp = cos.filter((x) => grp === "all" || x.group === grp);
    const cu = inGrp.some((x) => x.id === c.st.cu) ? c.st.cu : "all";
    const cnt = (ids) => all.filter((n) => ids.includes(n.company)).length;
    const pool = all.filter((n) => (cu === "all" ? inGrp.some((x) => x.id === n.company) : n.company === cu));
    // 여러 고객사가 함께 나온 기사(예: 오픈AI · 구글 · 오라클)는 '전체'에서 한 줄로 합치고 고객사 이름을 모두 단다
    const byUrl = new Map();
    for (const n of [...pool].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (b.published_at || "").localeCompare(a.published_at || ""))) {
      const k = cu === "all" ? n.url : n.id;
      if (byUrl.has(k)) byUrl.get(k).who.push(nameOf[n.company]); else byUrl.set(k, { n, who: [nameOf[n.company]] });
    }
    const rows = [...byUrl.values()];
    const shown = c.st.cuMore ? rows : rows.slice(0, 12), sel = cos.find((x) => x.id === cu);
    const basis = (x) => `<li><b>${esc(x.name)}</b> — ${esc(x.basis || "")}${x.basis_url ? ` ${c.link(x.basis_url, "근거")}` : ""}</li>`;
    return `<div class="box">${c.H("🤝 고객사 동향", "메모리 영업 관점 · 최근 7일 · 중요도순")}
      <div class="seg seg-full sm-cugrp" role="group" aria-label="고객 묶음">${groups.map((g) => `<button type="button" data-cugrp="${esc(g.id)}" aria-pressed="${g.id === grp}">${esc(g.label)} <span class="muted">${cnt(cos.filter((x) => g.id === "all" || x.group === g.id).map((x) => x.id))}</span></button>`).join("")}</div>
      <div class="bar scroll-x sm-cos" role="group" aria-label="고객사">${[{ id: "all", name: "전체" }, ...inGrp].map((x) => { const n = x.id === "all" ? cnt(inGrp.map((y) => y.id)) : cnt([x.id]);
        return `<button type="button" class="chipbtn${x.id === cu ? " on" : ""}" data-cu="${esc(x.id)}" aria-pressed="${x.id === cu}">${esc(x.name)} <span class="muted">${n}</span></button>`; }).join("")}</div>
      ${sel?.basis ? `<p class="hint sm-basis">선정 근거: ${esc(sel.basis)}${sel.basis_url ? ` ${c.link(sel.basis_url, "근거")}` : ""}</p>` : ""}
      ${shown.length ? `<ul class="sm-news">${shown.map(({ n, who }) => newsItem(c, n, label, cu === "all" ? who.filter(Boolean).join(" · ") : "")).join("")}</ul>` : c.empty("최근 7일 이 고객사의 메모리 · AI 칩 · 투자 · 실적 · 계약 기사가 없습니다.")}
      ${rows.length > shown.length ? `<button type="button" class="btn" data-cumore>더 보기 (${rows.length - shown.length})</button>` : ""}
      <details class="more"><summary>고객사 선정 근거 (${cos.length}곳)</summary><ul class="sm-basis-l">${cos.map(basis).join("")}</ul>
        <p class="hint">SK하이닉스는 고객 이름을 공시하지 않습니다(매출 10% 이상 고객 수 · 비중만). 이름은 업계 추정 · 고객사 실적 발표 · 공식 협약으로 확인한 것입니다. 분류: 메모리 조달 · AI 칩 · 투자/데이터센터 · 실적 · 계약만 남기고 증권가 · 주가 기사는 뺍니다.</p></details></div>`;
  }
  function industry(c) {
    const its = c.items("news");
    if (!c.mod("news")) return "";
    const L = c.bundle.config.settings?.tag_labels || {};
    const TAGS = [["semis", "반도체"], ["ai", "AI"], ["datacenter", "데이터센터"], ["all", "전체"]];
    const tag = TAGS.some((t) => t[0] === c.st.newsTag) ? c.st.newsTag : "semis";
    const rows = its.filter((n) => tag === "all" || (n.tags || []).includes(tag)).sort((a, b) => (b.published_at || "").localeCompare(a.published_at || "")).slice(0, 25);
    return `<div class="box">${c.H("📰 업계 뉴스", "RSS 9곳 · 제목 · 링크만")}
      <div class="seg" role="group" aria-label="분야">${TAGS.map(([k, l]) => `<button type="button" data-ntag="${k}" aria-pressed="${tag === k}">${l} <span class="muted">${k === "all" ? its.length : its.filter((n) => (n.tags || []).includes(k)).length}</span></button>`).join("")}</div>
      ${rows.length ? `<ul class="sm-news">${rows.map((n) => `<li><p>${n.major ? "⭐ " : ""}${c.link(n.url, n.title)}</p><p class="muted sm-meta">${esc(n.source || "")} · ${esc(ago(n.published_at))}${(n.tags || []).length ? ` · ${n.tags.map((t) => esc(L[t] || t)).join(" · ")}` : ""}</p>${n.summary ? `<p class="hint">${esc(n.summary)}</p>` : ""}</li>`).join("")}</ul>` : c.empty("이 분야 뉴스가 없습니다.")}</div>`;
  }
  const news = (c) => [c.safe("기업 집중", () => company(c)), c.safe("고객사 동향", () => customers(c)), c.safe("업계 뉴스", () => industry(c))].join("");

  // ---------- 일정 · 지표: 일정(D-day) · 수출 속보 · 대만 월매출 · 빅테크 capex ----------
  const CAT = { earnings: "실적", macro: "매크로", semis: "반도체", conference: "학회·전시", memory: "메모리", policy: "정책" };
  function dday(date) {
    const t = Date.parse(`${todayKST()}T00:00:00Z`), d = Date.parse(`${date}T00:00:00Z`);
    const n = Math.round((d - t) / 864e5);
    return n === 0 ? "D-DAY" : n > 0 ? `D-${n}` : `D+${-n}`;
  }
  function calendar(c) {
    const today = todayKST();
    const rows = c.items("calendar").filter((e) => e.scope !== "sales" && (e.date || "") >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 20);
    if (!c.mod("calendar")) return "";
    return `<div class="box">${c.H("📅 다가오는 일정", "KST · ★ 중요도")}
      ${rows.length ? `<ul class="sm-cal">${rows.map((e) => `<li class="${e.date === today ? "today" : ""}"><span class="sm-dd num">${dday(e.date)}</span>
        <span class="sm-ev"><b>${esc(e.title)}</b> <span class="sm-star" aria-label="중요도 ${e.importance || 1}">${"★".repeat(e.importance || 1)}</span>
          <span class="muted sm-meta">${md(e.date)}${e.date_label ? ` ${esc(e.date_label)}` : ""} · ${esc(CAT[e.category] || e.category || "")}${e.note ? ` · ${esc(e.note)}` : ""}${e.source_url ? ` · ${c.link(e.source_url, "근거")}` : ""}</span></span></li>`).join("")}</ul>` : c.empty("다가오는 일정이 없습니다.")}</div>`;
  }
  function exportsFlash(c) {
    const its = c.items("exports").slice(0, 3);
    if (!its.length) return "";
    const M = [["semi_yoy", "반도체 수출", "%"], ["semi_amt", "반도체 금액", "억$"], ["total_yoy", "전체 수출", "%"], ["total_amt", "전체 금액", "억$"]];
    const val = (m, u) => (m ? `<b class="num ${u === "%" ? dir(m.value) : ""}">${u === "%" ? `${m.value > 0 ? "+" : ""}${num(m.value, 1)}%` : `${num(m.value, 0)}억$`}</b>${m.conflict ? ` <span class="pb-stale" title="언론 보도 값이 서로 다름">⚠</span>` : ""}${m.n === 1 ? ` <span class="muted">1곳</span>` : ""}` : "");
    return `<div class="box">${c.H("🚢 한국 수출 속보", "관세청 · 산업부 발표 보도 제목에서 숫자만 · 전년 대비")}
      <ul class="sm-exp">${its.map((it) => `<li><p class="sm-exp-h"><b>${esc(it.label)}</b></p>
        <p class="sm-exp-m">${M.filter(([k]) => it.metrics?.[k]).map(([k, l, u]) => `<span>${l} ${val(it.metrics[k], u)}</span>`).join("")}</p>
        ${it.articles?.[0] ? `<p class="muted sm-meta">${c.link(it.articles[0].url, it.articles[0].title)} · ${esc(it.articles[0].source || "")}</p>` : ""}</li>`).join("")}</ul></div>`;
  }
  function twrev(c) {
    const env = c.mod("twrev"), its = c.items("twrev");
    if (!env || !its.length) return "";
    const eok = (v) => (v == null ? "—" : `${num(v / 1e5, 0)}억`);                       // 천 NT$ → 억 NT$
    const gs = env.groups || [];
    return `<div class="box">${c.H("🇹🇼 대만 공급망 월매출", `TWSE · TPEx 공시 · NT$ · ${esc(gs[0]?.ym || its[0].ym || "")}`)}
      <ul class="sm-tw">${gs.map((g) => `<li><span><b>${esc(g.label)}</b> <span class="muted">${g.n}/${g.of}사</span></span><span class="num">${eok(g.rev)}</span><span class="num">MoM ${pc(g.mom)}</span><span class="num">YoY ${pc(g.yoy)}</span></li>`).join("")}</ul>
      <details class="more"><summary>회사별 ${its.length}곳</summary><ul class="sm-tw">${its.map((it) => `<li><span>${esc(it.ko || it.name)} <span class="muted">${esc(it.code)}</span></span><span class="num">${eok(it.rev)}</span><span class="num">MoM ${pc(it.mom)}</span><span class="num">YoY ${pc(it.yoy)}</span></li>`).join("")}</ul></details>
      ${env.warnings?.length ? `<p class="semi-err">${esc(env.warnings.join(" · "))}</p>` : ""}</div>`;
  }
  function capex(c) {
    const env = c.mod("capex"), its = c.items("capex");
    if (!env || !its.length) return "";
    const b = (v) => (v == null ? "—" : `$${num(v / 1e9, 1)}B`);
    const big4 = env.big4 || [], last = big4[big4.length - 1];
    const lastQ = (it) => (it.quarters || []).slice(-1)[0];
    return `<div class="box">${c.H("🏗️ 빅테크 설비투자", "SEC XBRL · 분기 유형자산 취득 · 금융리스 제외")}
      ${last ? `<p class="sm-capex"><span class="muted">빅4 합계 ${esc(last.end)}</span> <b class="num">${b(last.total)}</b> <span class="num">YoY ${pc(last.yoy)}</span>${spark(big4.map((x) => x.total), 120, 24)}</p>` : ""}
      <ul class="sm-tw">${its.map((it) => { const q = lastQ(it), prev = (it.quarters || []).slice(-5, -4)[0];
        return `<li><span>${esc(it.name)}</span><span class="num">${b(q?.[1])}</span><span class="num muted">${q ? esc(q[0].slice(0, 7)) : ""}</span><span class="num">YoY ${pc(prev && q ? (q[1] / prev[1] - 1) * 100 : null)}</span></li>`; }).join("")}</ul></div>`;
  }
  const cal = (c) => [c.safe("일정", () => calendar(c)), c.safe("수출 속보", () => exportsFlash(c)), c.safe("대만 월매출", () => twrev(c)), c.safe("capex", () => capex(c))].join("");

  // ---------- 조작(뉴스 탭) ----------
  function bind(el, c) {
    const set = (patch) => { Object.assign(c.st, patch); c.keep(); c.draw(); };
    el.querySelectorAll("[data-co]").forEach((x) => x.addEventListener("click", () => set({ co: x.dataset.co, coTab: "top", coMore: false })));
    el.querySelectorAll("[data-cotab]").forEach((x) => x.addEventListener("click", () => set({ coTab: x.dataset.cotab, coMore: false })));
    el.querySelectorAll("[data-ntag]").forEach((x) => x.addEventListener("click", () => set({ newsTag: x.dataset.ntag })));
    el.querySelector("[data-comore]")?.addEventListener("click", () => set({ coMore: true }));
    el.querySelector("[data-cofocus]")?.addEventListener("change", (e) => set({ [`focus_${c.st.co}`]: e.target.checked, coMore: false }));
    el.querySelectorAll("[data-cugrp]").forEach((x) => x.addEventListener("click", () => set({ cuGrp: x.dataset.cugrp, cu: "all", cuMore: false })));
    el.querySelectorAll("[data-cu]").forEach((x) => x.addEventListener("click", () => set({ cu: x.dataset.cu, cuMore: false })));
    el.querySelector("[data-cumore]")?.addEventListener("click", () => set({ cuMore: true }));
    // 메모리 가격판: 품목 누르면 추이 펼침/접기 · 기간 · 차트 누르면 그날 값
    el.querySelectorAll("[data-pbkey]").forEach((x) => {
      const toggle = () => set({ pb: c.st.pb === x.dataset.pbkey ? null : x.dataset.pbkey });
      x.addEventListener("click", toggle);
      x.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
    });
    el.querySelectorAll("[data-pbrange]").forEach((x) => x.addEventListener("click", () => set({ pbRange: x.dataset.pbrange })));
    el.querySelectorAll(".pbc-svg").forEach((svg) => {
      const pts = JSON.parse(svg.dataset.pts), [L, R, T, B, W, H, t0, t1, lo, hi] = svg.dataset.geo.split(",").map(Number);
      const read = svg.closest(".pbc").querySelector(".pbc-read"), [vl, dot] = svg.querySelectorAll(".cur");
      const show = (e) => {
        const b = svg.getBoundingClientRect(), x = ((e.clientX - b.left) / b.width) * W, t = t0 + ((x - L) / (W - L - R)) * (t1 - t0);
        const p = pts.reduce((a, q) => (Math.abs(tOf(q[0]) - t) < Math.abs(tOf(a[0]) - t) ? q : a));
        const px = L + ((tOf(p[0]) - t0) / (t1 - t0)) * (W - L - R), py = T + (1 - (p[1] - lo) / (hi - lo)) * (H - T - B);
        vl.setAttribute("x1", px); vl.setAttribute("x2", px); dot.setAttribute("cx", px); dot.setAttribute("cy", py);
        vl.setAttribute("visibility", "visible"); dot.setAttribute("visibility", "visible");
        const z = pts[pts.length - 1];
        read.innerHTML = `${esc(p[0])} <b>${usd(p[1])}</b> · 지금 대비 ${pc((z[1] / p[1] - 1) * 100)}`;
      };
      svg.addEventListener("pointerdown", show);
      svg.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse" || e.buttons) show(e); });
    });
  }
  return { sum, mem, news, cal, bind, _: { change, pct, md, dir, signed, spark } };
})();
