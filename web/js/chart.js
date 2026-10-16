// 인터랙티브 캔들 차트 — 엔진: TradingView Lightweight Charts(js/vendor, Radar 수정판) + 빗각 플러그인(이 파일)
//  보기 모드(기본): 핀치 · 휠 확대, 드래그 이동(관성), 가격 · 시간 축 끌어 늘리기, 두 번 탭 · 더블클릭 맞춤. 휴대폰 세로 밀기 = 페이지 스크롤.
//    내 빗각은 건드려지지 않는다(잘못 눌러 옮겨지지 않게).
//  그리기 모드(setDraw): 한 손가락 = 그리기 · 고치기, 두 손가락 = 이동 · 확대(엔진의 이동 · 확대는 끈다).
//    빈 곳에서 끌기(또는 두 점 탭) → 새 빗각. 선을 누르면 선택 → 손잡이로 끝점, 선을 끌면 통째 이동, '선 지우기'.
//    자석(setMagnet): 손가락에서 가장 가까운 봉의 고가(위) · 저가(아래) 중 가까운 쪽에 늘 붙는다.
//    저장은 화면(detail.js)이 차례로 하고, 차트는 결과를 기다리지 않고 바로 보여 준다(local: id → 끝점 | 지움).
// 봉 위치는 '봉 번호'(logical)로 다룬다 — 선(valueAt)과 그리기 결과({i, p})가 같은 좌표다.
TR.chart = (() => {
  const LW = window.LightweightCharts;
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const DEFAULT_BARS = { "15m": 160, "1h": 150, "4h": 150, "1d": 130, "1w": 120 };
  const HIT = 16, HANDLE = 22, MOVE = 7;                        // 선 잡기 · 손잡이 · 끌기 시작 거리(px)
  const newId = () => `u-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;   // 서버 · 폰 엔진이 그대로 쓰는 형식(u-[a-z0-9]{4,20})

  function colors() {
    return { bg: css("--card"), grid: css("--line"), axis: css("--muted"), text: css("--text"), text2: css("--text-2"), up: css("--up"),
             down: css("--down"), sup: css("--series-3"), res: css("--series-2"), user: css("--accent"), font: css("--mono") || "monospace",
             ma: [css("--series-1"), css("--series-4"), css("--series-5"), css("--series-7")] };
  }

  let hintedAt = 0, lastCur = null;                             // 그리기 안내를 마지막으로 보인 때 · 손가락 커서의 마지막 자리
  const coarse = () => window.matchMedia("(pointer: coarse)").matches;                                             // 그리기 안내를 마지막으로 보인 때
  const live = new Set();                                       // 다시 그리면서 화면에서 빠진 차트는 엔진까지 정리(메모리 · 리사이즈 감시)
  function create(host, opt = {}) {
    for (const c of live) if (!c.host.isConnected) c.destroy();
    host.innerHTML = `<div class="ch-ohlc num"></div>
      <div class="ch-wrap"><div class="ch-lw" aria-label="캔들 차트"></div>
        <button type="button" class="btn sm ch-del" hidden>🗑 선 지우기</button><p class="ch-hint" hidden></p></div>`;
    const box = host.querySelector(".ch-lw"), ohlc = host.querySelector(".ch-ohlc"), delBtn = host.querySelector(".ch-del"), hint = host.querySelector(".ch-hint");
    box.style.height = `${opt.height || 480}px`;
    let S = { bars: [], lines: [], series: [], log: true, volume: true, tf: "1d", draw: false, magnet: true };
    let C = colors(), sel = null, gest = null, anchor = null, ghost = null, pending = null, lastTap = 0, quiet = false;
    const local = new Map();                                      // 그리기 결과(저장 전): id → {a, b} | null(지움)
    const n = () => S.bars.length;

    const chart = LW.createChart(box, {
      autoSize: true,
      layout: { background: { type: "solid", color: C.bg }, textColor: C.axis, fontFamily: C.font, fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.06, bottom: 0.2 } },
      timeScale: { borderVisible: false, rightOffset: 6, minBarSpacing: 0.4, shiftVisibleRangeOnNewBar: false, tickMarkFormatter: tick,
                   maxFutureRatio: 0.5 },                         // 엔진 수정: 미래 빈 영역은 화면 절반까지만(밀어도 빈 화면만 남지 않게)
      trackingMode: { exitMode: LW.TrackingModeExitMode.OnTouchEnd },   // 길게 눌러 본 크로스헤어는 손을 떼면 사라지고 다음 밀기는 이동
      localization: { locale: "ko-KR", priceFormatter: (p) => TR.util.price(p), timeFormatter: (t) => fmtTime(t, true) },
      crosshair: { mode: LW.CrosshairMode.Normal, vertLine: { labelBackgroundColor: C.user }, horzLine: { labelBackgroundColor: C.user } },
      kineticScroll: { touch: true, mouse: false },
    });
    const NAV = {                                                 // 보기 모드의 엔진 조작(그리기 모드에서는 끈다)
      on: { handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
            handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: { time: true, price: true }, axisDoubleClickReset: { time: true, price: true } } },
      off: { handleScroll: { mouseWheel: true, pressedMouseMove: false, horzTouchDrag: false, vertTouchDrag: false },
             handleScale: { mouseWheel: true, pinch: false, axisPressedMouseMove: { time: true, price: true }, axisDoubleClickReset: { time: true, price: true } } },
    };
    chart.applyOptions(NAV.on);
    const candle = chart.addSeries(LW.CandlestickSeries, {
      upColor: C.up, downColor: C.down, wickUpColor: C.up, wickDownColor: C.down, borderVisible: false,
      priceLineColor: C.text2, priceFormat: { type: "custom", formatter: (p) => TR.util.price(p), minMove: 1e-8 },
    });
    const vol = chart.addSeries(LW.HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 }, visible: false });
    const mas = [];
    const noScale = () => null;                                   // 이평은 축을 직접 늘리지 않음(플러그인이 가까운 것만 넣음)

    // ---------- 시간 표시: 봉 시각을 UTC 숫자로 넣고(장중은 폰 시간대로 옮김) UTC 필드로 읽는다 ----------
    const timeOf = (b) => (b.d && (S.tf === "1d" || S.tf === "1w") ? Date.UTC(+b.d.slice(0, 4), +b.d.slice(5, 7) - 1, +b.d.slice(8, 10)) / 1000
      : b.t - new Date(b.t * 1000).getTimezoneOffset() * 60);
    function tick(t, type) {
      const d = new Date(t * 1000), p = (v) => String(v).padStart(2, "0");
      if (type === 0) return String(d.getUTCFullYear());
      if (type === 1) return `${d.getUTCMonth() + 1}월`;
      if (type === 2) return String(d.getUTCDate());
      return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
    }
    function fmtTime(t, full) {
      const d = new Date(t * 1000), p = (v) => String(v).padStart(2, "0");
      const ymd = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
      if (S.tf === "1d") return ymd;
      if (S.tf === "1w") return `${ymd} 주`;
      return full ? `${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` : `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
    }

    // ---------- 좌표 ----------
    const ts = () => chart.timeScale();
    const X = (i) => ts().logicalToCoordinate(i);
    const Y = (p) => candle.priceToCoordinate(p);
    const plotW = () => ts().width();
    function at(pt, snap) {                                       // 화면 점 → {i(봉 번호), p(가격)}
      const N = n(), x0 = X(0), sp = X(1) - x0;
      // 가장 가까운 봉 — 엔진의 coordinateToLogical은 올림이라 봉의 오른쪽 절반을 누르면 다음 봉이 잡힌다
      let i = sp > 0 ? Math.round((pt.x - x0) / sp) : N - 1;
      i = Math.max(0, Math.min(N - 1, i));
      let p = candle.coordinateToPrice(pt.y);
      if (snap && S.magnet && S.bars[i]) {                         // 자석: 그 봉의 고가(위) · 저가(아래) 중 손가락에 가까운 쪽
        const b = S.bars[i], yh = Y(b.h), yl = Y(b.l);
        p = yh == null || yl == null ? p : Math.abs(yh - pt.y) <= Math.abs(yl - pt.y) ? b.h : b.l;
      }
      return p > 0 ? { i, p } : null;
    }
    // 두 점(봉 번호 · 가격)을 지나는 선의 값 — 로그 가격에서 직선(서버 선과 같은 방식)
    const through = (a, b) => (i) => Math.exp(Math.log(a.p) + ((Math.log(b.p) - Math.log(a.p)) / (b.i - a.i || 1)) * (i - a.i));

    // 그릴 선 목록: 서버 선 + 저장 전 결과(local) + 끄는 중 · 그리는 중
    function items() {
      const out = [];
      for (const ln of S.lines) {
        const id = ln.id;
        if (id != null && local.has(id)) {
          const e = local.get(id);
          if (e) out.push({ ln, id, a: e.a, b: e.b, valueAt: through(e.a, e.b), start: Math.min(e.a.i, e.b.i) });
        } else out.push({ ln, id, a: ln.a, b: ln.b, valueAt: ln.valueAt, start: ln.start });
      }
      for (const [id, e] of local) {
        if (e && !S.lines.some((l) => l.id === id)) out.push({ ln: { kind: "user", width: 2.4, label: "내 빗각" }, id, a: e.a, b: e.b, valueAt: through(e.a, e.b), start: e.a.i });
      }
      if (gest?.edit) {
        const k = out.findIndex((x) => x.id === gest.edit.id);
        if (k >= 0) out[k] = { ...out[k], a: gest.edit.a, b: gest.edit.b, valueAt: through(gest.edit.a, gest.edit.b), start: Math.min(gest.edit.a.i, gest.edit.b.i) };
      }
      if (ghost) out.push({ ln: { kind: "user", ghost: true, width: 2 }, id: null, a: ghost.a, b: ghost.b, valueAt: through(ghost.a, ghost.b), start: Math.min(ghost.a.i, ghost.b.i) });
      return out;
    }
    const editableItem = (x) => x.ln.kind === "user" && x.id != null && x.a && x.b;

    // ---------- 빗각 플러그인 ----------
    const lineColor = (ln) => (ln.kind === "user" ? C.user : ln.side === "sup" ? C.sup : C.res);
    const prim = {
      paths: [], axis: [], labels: [], api: null,
      attached(p) { this.api = p; },
      detached() { this.api = null; },
      request() { this.api?.requestUpdate(); },
      updateAllViews() {
        const N = n(), r = ts().getVisibleLogicalRange();
        this.paths = []; this.labels = [];
        const axis = [];
        if (!N || !r) { this.axis = axis; return; }
        const right = r.to, left = r.from, step = Math.max(1, Math.floor((right - left) / 300));
        for (const x of items()) {
          const sI = Math.max(x.start, left - 1), idx = [sI];
          for (let i = Math.max(0, Math.ceil(sI)); i <= Math.min(N - 1, Math.ceil(right) + 1); i += step) if (i > sI) idx.push(i);
          const fut = right + 2;
          if (fut > N - 1) for (let k = 1; k <= 8; k++) idx.push(N - 1 + ((fut - (N - 1)) * k) / 8);
          const pts = [];
          for (const i of idx) {
            const v = x.valueAt(i), px = X(i), py = v > 0 ? Y(v) : null;
            pts.push(px == null || py == null ? null : [px, py]);
          }
          const isSel = S.draw && x.id != null && x.id === sel;
          const handles = isSel && x.a && x.b ? [x.a, x.b].map((h) => [X(h.i), Y(h.p)]) : [];
          this.paths.push({ item: x, ln: x.ln, pts, col: lineColor(x.ln), sel: isSel, handles });
          if (x.ln.label || x.ln.ghost) {
            const iv = Math.min(Math.floor(right), N - 1), v = x.valueAt(iv);
            if (v > 0 && iv >= x.start) {
              const y = Y(v);
              if (y != null) {
                axis.push({ coordinate: () => y, text: () => TR.util.price(v), textColor: () => "#fff", backColor: () => lineColor(x.ln), visible: () => true, tickVisible: () => true });
                if (x.ln.label) this.labels.push({ x: Math.min(plotW() - 6, (X(iv) ?? plotW()) - 6), y: y - 6, col: lineColor(x.ln), text: x.ln.label });
              }
            }
          }
        }
        for (const lb of this.labels) lb.y = Math.max(12, lb.y);
        this.labels.sort((a, b) => a.y - b.y);
        for (let k = 1; k < this.labels.length; k++) if (this.labels[k].y - this.labels[k - 1].y < 13) this.labels[k].y = this.labels[k - 1].y + 13;
        this.axis = axis;
      },
      priceAxisViews() { return this.axis; },
      paneViews() { return this._views || (this._views = [{ zOrder: () => "top", renderer: () => ({ draw: (target) => target.useMediaCoordinateSpace(({ context: g }) => this.draw(g)) }) }]); },
      draw(g) {
        for (const p of this.paths) {
          g.strokeStyle = p.col; g.lineWidth = (p.ln.width || 2) + (p.sel ? 1.2 : 0); g.globalAlpha = p.ln.weak ? 0.45 : 1;
          g.setLineDash(p.ln.broken ? [6, 4] : p.ln.ghost ? [5, 3] : []);
          g.beginPath();
          let on = false;
          for (const q of p.pts) { if (!q) { on = false; continue; } on ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); on = true; }
          g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
          for (const h of p.handles) {
            if (h[0] == null || h[1] == null) continue;
            g.fillStyle = C.bg; g.strokeStyle = p.col; g.lineWidth = 2;
            g.beginPath(); g.arc(h[0], h[1], 6, 0, 7); g.fill(); g.stroke();
          }
        }
        if (anchor) { const x = X(anchor.i), y = Y(anchor.p); if (x != null && y != null) { g.fillStyle = C.user; g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); } }
        if (S.draw && cur) {                                        // 손가락 커서: 자석이 붙은 자리에 고리
          const q = at(cur, true), x = q && X(q.i), y = q && Y(q.p);
          if (x != null && y != null) {
            g.strokeStyle = C.user; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 9, 0, 7); g.stroke();
            g.fillStyle = C.user; g.beginPath(); g.arc(x, y, 2.5, 0, 7); g.fill();
          }
        }
        g.font = `bold 10.5px ${C.font}`; g.textAlign = "right"; g.textBaseline = "alphabetic";
        for (const lb of this.labels) {
          g.lineWidth = 3; g.strokeStyle = C.bg; g.strokeText(lb.text, lb.x, lb.y);
          g.fillStyle = lb.col; g.fillText(lb.text, lb.x, lb.y);
        }
      },
      // 세로 축: 보이는 봉 범위의 35% 안에 있는 선 · 이평만 넣는다(멀리 있는 선 때문에 캔들이 눌리지 않게)
      autoscaleInfo(from, to) {
        const N = n();
        if (!N) return null;
        const iA = Math.max(0, Math.ceil(from)), iB = Math.min(N - 1, Math.floor(to));
        let lo = Infinity, hi = -Infinity;
        for (let i = iA; i <= iB; i++) { lo = Math.min(lo, S.bars[i].l); hi = Math.max(hi, S.bars[i].h); }
        if (!isFinite(lo)) return null;
        const span = Math.log(hi / lo) || 0.01, cLo = lo * Math.exp(-span * 0.35), cHi = hi * Math.exp(span * 0.35);
        const take = (v) => { if (v != null && v > cLo && v < cHi) { lo = Math.min(lo, v); hi = Math.max(hi, v); } };
        for (const s of S.series) for (let i = iA; i <= iB; i++) take(s.vals[i]);
        for (const ln of S.lines) for (const i of [Math.max(iA, ln.start), Math.min(to, N - 1)]) take(ln.valueAt(i));
        return { priceRange: { minValue: lo, maxValue: hi } };
      },
    };
    candle.attachPrimitive(prim);

    // ---------- 보기 범위 ----------
    function reset() {
      const N = n();
      if (!N) return;
      const w = Math.max(12, Math.min(N, DEFAULT_BARS[S.tf] || 130));
      ts().setVisibleLogicalRange({ from: N - w, to: N - 1 + Math.max(2, w * 0.08) });
      chart.priceScale("right").applyOptions({ autoScale: true });
    }
    ts().subscribeVisibleLogicalRangeChange((r) => { if (r && !quiet) opt.onView?.({ right: r.to, width: r.to - r.from }); });

    // ---------- 시 · 고 · 저 · 종 ----------
    function showOhlc(i) {
      const b = S.bars[i], p = S.bars[i - 1];
      if (!b) { ohlc.textContent = ""; return; }
      const ch = p ? (b.c / p.c - 1) * 100 : 0, f = (v) => TR.util.price(v);
      const when = fmtTime(timeOf(b), true);                      // 폰(좁은 차트): 연도를 빼서 등락률이 잘리지 않게
      ohlc.innerHTML = `<span class="muted">${box.clientWidth < 500 ? when.replace(/^\d{4}-/, "") : when}</span> 시 ${f(b.o)} 고 ${f(b.h)} 저 ${f(b.l)} 종 <b>${f(b.c)}</b> <span class="${ch >= 0 ? "up" : "down"}">${ch >= 0 ? "+" : ""}${ch.toFixed(2)}%</span>`;
    }
    chart.subscribeCrosshairMove((param) => {
      const N = n();
      showOhlc(param.logical == null ? N - 1 : Math.max(0, Math.min(N - 1, Math.round(param.logical))));
      if (S.draw && anchor && !gest && !cur && param.point) { const b = at(param.point, true); ghost = b ? { a: anchor, b } : null; prim.request(); }   // PC: 두 번째 점 미리 보기
    });

    // ---------- 그리기 모드: 엔진보다 먼저(capture) 받는다 ----------
    const pos = (e) => { const r = box.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    function segDist(p, a, b) {
      const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
      const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
      return dist(p, [a[0] + t * dx, a[1] + t * dy]);
    }
    function hitLine(pt) {                                         // 손가락 가까운 내 선
      const q = [pt.x, pt.y];
      let best = null;
      for (const p of prim.paths) {
        if (!editableItem(p.item)) continue;
        for (let k = 1; k < p.pts.length; k++) {
          if (!p.pts[k - 1] || !p.pts[k]) continue;
          const d = segDist(q, p.pts[k - 1], p.pts[k]);
          if (d <= HIT && (!best || d < best.d)) best = { d, item: p.item };
        }
      }
      return best?.item || null;
    }
    function select(id) {
      sel = id;
      delBtn.hidden = !(S.draw && id != null && opt.onDelete);
      opt.onSelect?.(id);
      prim.request();
    }
    const fingers = new Map();                                    // 그리기 모드에서 닿아 있는 손가락(두 손가락 = 이동 · 확대)
    // 손가락 그리기는 트레이딩뷰 휴대폰처럼 '십자선 커서'로 한다: 끌면 커서가 손가락이 움직인 만큼 따라오고(손가락이 점을 가리지 않음),
    // 톡 누르면 커서 자리에 점이 찍힌다(시작점 → 끝점). 닿는 순간 점이 생기지 않는다. 마우스는 누른 자리에 바로.
    let cur = null;                                               // 커서(차트 안 화면 좌표) — 손가락 그리기 모드에서만
    const clampCur = (q) => ({ x: Math.max(4, Math.min(plotW() - 4, q.x)), y: Math.max(4, Math.min(box.clientHeight - 30, q.y)) });
    function showCursor() {                                       // 커서 자리(자석 적용)를 엔진 십자선으로도 보여 준다(축에 가격 · 날짜)
      if (!cur || !S.draw || !n()) { chart.clearCrosshairPosition(); return; }
      const q = at(cur, true);
      if (q && S.times?.[q.i] != null) chart.setCrosshairPosition(q.p, S.times[q.i], candle);
      if (anchor && q) ghost = q.i !== anchor.i ? { a: anchor, b: q } : null;
      lastCur = cur;
      prim.request();
    }

    function down(e) {
      if (!S.draw || e.button > 0 || !n()) return;                // 보기 모드는 엔진이 다 맡는다
      const pt = pos(e);
      if (pt.x > plotW()) return;                                  // 가격 축은 엔진(축 끌어 늘리기)
      e.stopPropagation();
      touch.mine = true;
      fingers.set(e.pointerId, pt);
      if (fingers.size === 2) {                                    // 두 번째 손가락: 하던 것은 취소하고 이동 · 확대
        const [p1, p2] = [...fingers.values()], r = ts().getVisibleLogicalRange();
        gest = r && { type: "nav", d0: Math.max(10, Math.hypot(p1.x - p2.x, p1.y - p2.y)), m0: (p1.x + p2.x) / 2, from: r.from, w: r.to - r.from };
        prim.request();
        return;
      }
      if (fingers.size > 2) return;
      const mouse = e.pointerType === "mouse";
      const selP = sel != null && prim.paths.find((p) => p.item.id === sel);
      const r = mouse ? HANDLE : HANDLE * 1.4;
      const h = selP ? selP.handles.findIndex((q) => q[0] != null && dist(q, [pt.x, pt.y]) <= r) : -1;
      const hit = h >= 0 ? selP.item : hitLine(pt);
      const base = { x0: pt.x, y0: pt.y, moved: false, hadSel: sel != null };
      if (h >= 0) gest = { ...base, type: h === 0 ? "a" : "b", item: hit, h0: { x: selP.handles[h][0], y: selP.handles[h][1] } };   // 손잡이: 손가락이 움직인 만큼(가리지 않게)
      else if (hit && (hit.id === sel || mouse)) {                  // 고른 선(마우스는 아무 선) 끌기 = 통째 이동
        if (hit.id !== sel) select(hit.id);
        gest = { ...base, type: "move", item: hit, start: at(pt, false) };
      } else if (hit) gest = { ...base, type: "pick", item: hit, cur0: cur || pt };   // 안 고른 선: 톡 = 고르기, 끌기 = 커서 이동
      else if (mouse) { const a0 = at(pt, true); gest = a0 && { ...base, type: "draw", a: a0 }; }
      else gest = { ...base, type: "cursor", cur0: cur || pt };
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", up, true);
      window.addEventListener("pointercancel", up, true);
    }
    function move(e) {
      if (!fingers.has(e.pointerId)) return;
      const pt = pos(e);
      fingers.set(e.pointerId, pt);
      if (!gest) return;
      if (gest.type === "nav") {
        if (fingers.size < 2) return;
        const [p1, p2] = [...fingers.values()], d = Math.max(10, Math.hypot(p1.x - p2.x, p1.y - p2.y)), m = (p1.x + p2.x) / 2, W = plotW() || 1;
        const w = Math.max(12, Math.min(n() * 1.5, gest.w * gest.d0 / d));
        const L = gest.from + (gest.m0 / W) * gest.w;               // 처음 두 손가락 가운데에 있던 봉이 지금 가운데로
        const from = L - (m / W) * w;
        ts().setVisibleLogicalRange({ from, to: from + w });
        showCursor();
        return;
      }
      gest.last = pt;                                              // 손을 뗄 때의 좌표는 기기마다 믿기 어려워 마지막 이동 위치를 쓴다
      const dx = pt.x - gest.x0, dy = pt.y - gest.y0;
      if (!gest.moved && Math.hypot(dx, dy) < MOVE) return;
      gest.moved = true;
      if (gest.type === "cursor" || gest.type === "pick") { cur = clampCur({ x: gest.cur0.x + dx, y: gest.cur0.y + dy }); showCursor(); return; }
      if (gest.type === "draw") {
        const b2 = at(pt, true);
        ghost = b2 && b2.i !== gest.a.i ? { a: gest.a, b: b2 } : null;
      } else {
        const it = gest.item;
        if (gest.type === "move") {
          const c = at(pt, false);
          if (!c || !gest.start) return;
          const di = c.i - gest.start.i, k = c.p / gest.start.p;
          gest.edit = { id: it.id, a: { i: it.a.i + di, p: it.a.p * k }, b: { i: it.b.i + di, p: it.b.p * k } };
        } else {
          const q = at(e.pointerType === "mouse" ? pt : { x: gest.h0.x + dx, y: gest.h0.y + dy }, true);
          if (!q) return;
          gest.edit = { id: it.id, a: gest.type === "a" ? q : it.a, b: gest.type === "b" ? q : it.b };
        }
      }
      prim.request();
    }
    function finish() {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      fingers.clear();
      const g = gest;
      gest = null;
      if (!cur) ghost = null;
      if (pending) { const [d, k] = pending; pending = null; setData(d, k); }
      prim.request();
      return g;
    }
    function placePoint(q) {                                       // 점 찍기: 첫 점 → 둘째 점이면 선
      if (!q) return;
      if (!anchor) { anchor = q; hintText("끌어서 십자선을 끝점으로 옮긴 뒤 톡 누르세요 · 같은 봉에서 다시 누르면 취소"); }
      else if (q.i === anchor.i) { anchor = null; ghost = null; hintText(""); }
      else { const a = anchor; anchor = null; ghost = null; emitDraw(a, q); }
      prim.request();
    }
    function up(e) {
      if (!fingers.has(e.pointerId)) return;
      e.stopPropagation();
      fingers.delete(e.pointerId);
      if (gest?.type === "nav") { if (!fingers.size) finish(); return; }   // 두 손가락을 다 뗄 때까지 이동 · 확대
      if (fingers.size) return;
      const g = finish();
      if (!g || e.type === "pointercancel") return;
      if (g.type === "cursor" || g.type === "pick") {
        if (g.moved) return;                                       // 커서만 옮김
        if (g.type === "pick") return select(g.item.id);           // 톡 = 선 고르기
        if (g.hadSel && !anchor) return select(null);              // 톡 = 선택 풀기
        if (!cur) { cur = clampCur({ x: g.x0, y: g.y0 }); showCursor(); return; }   // 커서가 없으면 처음 톡은 커서만 놓는다
        return placePoint(at(cur, true));
      }
      if (g.type === "draw") {                                     // 마우스
        const b2 = g.moved ? at(g.last || pos(e), true) : null;
        if (b2 && b2.i !== g.a.i) { anchor = null; return emitDraw(g.a, b2); }
        if (g.moved) { TR.util.toast("봉이 있는 곳에서 두 날짜에 걸쳐 그리세요"); return; }
        if (g.hadSel && !anchor) return select(null);
        return placePoint(g.a);
      }
      if (g.moved && g.edit) {
        let { a, b } = g.edit;
        if (a.i === b.i) return;
        if (a.i > b.i) [a, b] = [b, a];
        if (a.i < 0 || b.i > n() - 1) { TR.util.toast("선 끝점은 차트 안의 봉에 두세요"); return; }
        local.set(g.item.id, { a, b });
        prim.request();
        if (opt.onEdit?.(g.item.id, a, b) === false) { local.delete(g.item.id); prim.request(); }
      }
    }
    function emitDraw(a, b) {                                     // 새 선: 바로 보이고 선택된다(저장은 화면이 뒤에서 차례로)
      if (a.i > b.i) [a, b] = [b, a];
      const id = newId();
      local.set(id, { a, b });
      hintText("");
      select(id);
      if (opt.onDraw?.(a, b, id) === false) { local.delete(id); select(null); }
    }
    delBtn.addEventListener("click", () => {
      const id = sel;
      if (id == null) return;
      local.set(id, null);                                         // 저장을 기다리지 않고 바로 지운다(방금 그린 선도)
      select(null);
      opt.onDelete?.(id);
    });
    // 엔진이 터치 · 마우스 호환 이벤트로도 받으므로, 우리가 맡은 제스처 동안은 그것도 막는다(세로 스크롤 포함)
    const block = (e) => { if (fingers.size) { e.stopPropagation(); if (e.cancelable && e.type === "touchmove") e.preventDefault(); } };
    for (const t of ["touchstart", "touchmove", "touchend", "mousedown", "mousemove", "mouseup"]) box.addEventListener(t, block, { capture: true, passive: false });
    // 맞춤: 더블클릭 · 두 번 탭(보기 모드). 탭 = 손가락 하나 · 짧게 · 거의 안 움직임 — 핀치 뒤 두 손가락을 떼는 것을 두 번 탭으로 보면 화면이 처음으로 돌아간다
    box.addEventListener("dblclick", (e) => { if (!S.draw && pos(e).x <= plotW()) { reset(); } });
    const touch = { ids: new Set(), multi: false, mine: false, t0: 0, x0: 0, y0: 0, moved: false };
    box.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse") return;
      if (!touch.ids.size) Object.assign(touch, { multi: false, mine: false, t0: performance.now(), x0: e.clientX, y0: e.clientY, moved: false });
      else touch.multi = true;
      touch.ids.add(e.pointerId);
    }, true);
    const touchMove = (e) => {
      if (touch.ids.has(e.pointerId) && Math.hypot(e.clientX - touch.x0, e.clientY - touch.y0) > 10) touch.moved = true;
    };
    const touchEnd = (e) => {
      if (!touch.ids.delete(e.pointerId) || touch.ids.size) return;
      const tap = e.type === "pointerup" && !touch.multi && !touch.moved && !touch.mine && performance.now() - touch.t0 < 300;
      touch.mine = false;
      if (!tap || S.draw) { lastTap = 0; return; }
      const now = performance.now();
      if (lastTap && now - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) { lastTap = 0; reset(); }
      else lastTap = { t: now, x: e.clientX, y: e.clientY };
    };
    // 떼기는 창(window)에서 받는다 — 우리 제스처 처리(up)가 이벤트를 막아도 손가락 수를 놓치지 않게(먼저 등록돼 먼저 불림)
    window.addEventListener("pointermove", touchMove, true);
    window.addEventListener("pointerup", touchEnd, true);
    window.addEventListener("pointercancel", touchEnd, true);
    box.addEventListener("pointerdown", down, true);

    const drawHint = () => (coarse()
      ? "끌어서 십자선 이동 · 톡 = 점(시작 → 끝) · 선 톡 = 고르기 · 두 손가락 = 이동·확대"
      : "빈 곳에서 드래그하면 새 빗각 · 선을 클릭하면 선택(손잡이 = 끝점, 선 끌기 = 통째) · 휠 = 확대, 축 끌기 = 이동");
    let hintTimer = 0;
    function hintText(t, ms = 0) {                                // ms: 그만큼 뒤에 저절로 숨김(차트 아래쪽을 오래 가리지 않게)
      clearTimeout(hintTimer);
      hint.hidden = !t; hint.textContent = t || "";
      if (t && ms) hintTimer = setTimeout(() => { hint.hidden = true; }, ms);
    }

    // ---------- 데이터 ----------
    function setData(d, keepView) {
      if (!live.has(api)) return;                                  // 정리된 차트(빨리 넘긴 종목 · 시간 단위의 늦게 온 데이터)는 무시
      if (gest) { pending = [d, keepView]; return; }               // 끄는 중에는 미뤘다가 놓은 뒤에
      const hadBars = n() > 0;
      S = { ...S, ...d };
      C = colors();
      const times = [];
      let last = -Infinity;
      const keep = [];
      S.bars.forEach((b, i) => { const t = timeOf(b); if (t > last) { times.push(t); keep.push(i); last = t; } });
      if (keep.length !== S.bars.length) S = { ...S, bars: keep.map((i) => S.bars[i]) };   // 시각이 겹치는 봉은 버림(엔진은 증가하는 시각만 받음)
      quiet = !keepView;
      S.times = times;
      candle.setData(S.bars.map((b, i) => ({ time: times[i], open: b.o, high: b.h, low: b.l, close: b.c })));
      const showVol = S.volume && S.bars.some((b) => b.v);
      vol.setData(showVol ? S.bars.map((b, i) => ({ time: times[i], value: b.v || 0, color: b.c >= b.o ? `${C.up}73` : `${C.down}73` })) : []);
      chart.priceScale("right").applyOptions({ mode: S.log ? LW.PriceScaleMode.Logarithmic : LW.PriceScaleMode.Normal, scaleMargins: { top: 0.06, bottom: showVol ? 0.2 : 0.06 } });
      S.series.forEach((s, k) => {
        if (!mas[k]) mas[k] = chart.addSeries(LW.LineSeries, { lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false, autoscaleInfoProvider: noScale });
        mas[k].applyOptions({ color: s.color || C.ma[k % 4], visible: true });
        mas[k].setData(S.bars.map((b, i) => (s.vals[i] == null ? { time: times[i] } : { time: times[i], value: s.vals[i] })));
      });
      for (let k = S.series.length; k < mas.length; k++) { mas[k].setData([]); mas[k].applyOptions({ visible: false }); }
      chart.applyOptions({ layout: { background: { type: "solid", color: C.bg }, textColor: C.axis }, grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } } });
      candle.applyOptions({ upColor: C.up, downColor: C.down, wickUpColor: C.up, wickDownColor: C.down, priceLineColor: C.text2 });
      // 저장 전 결과 중 새 데이터에 이미 반영된 것은 정리(지운 선이 없어졌거나, 옮긴 · 새 선의 끝점이 같으면)
      for (const [id, e] of local) {
        const ln = S.lines.find((l) => l.id === id);
        if (e === null ? !ln : ln && ln.a && Math.abs(ln.a.i - e.a.i) < 0.5 && Math.abs(ln.b.i - e.b.i) < 0.5 && Math.abs(ln.a.p / e.a.p - 1) < 1e-6 && Math.abs(ln.b.p / e.b.p - 1) < 1e-6) local.delete(id);
      }
      if (sel != null && !items().some((x) => x.id === sel)) select(null);
      if (!keepView || !hadBars) reset();
      quiet = false;
      anchor = null;
      showOhlc(n() - 1);
      if (S.draw && cur) showCursor();
      prim.request();
    }

    const api = {
      host,
      setData,
      setDraw(on) {
        S.draw = !!on; anchor = null; ghost = null;
        // 손가락 기기는 커서를 띄운다(지난번 자리 또는 차트 가운데) — 저장 뒤 다시 그려도 그 자리에
        cur = on && coarse() ? (lastCur || { x: (plotW() || box.clientWidth * 0.8) * 0.55, y: box.clientHeight * 0.45 }) : null;
        if (on && cur) setTimeout(showCursor, 0); else chart.clearCrosshairPosition();
        chart.applyOptions(on ? NAV.off : NAV.on);
        if (!on) select(null);
        box.classList.toggle("drawing", !!on);
        if (on && Date.now() - hintedAt > 60000) { hintedAt = Date.now(); hintText(drawHint(), 6000); }   // 저장 뒤 다시 그릴 때마다 뜨지 않게 1분에 한 번
        else if (!on) hintText("");
        prim.request();
      },
      setMagnet(on) { S.magnet = !!on; },
      select(id) { if (live.has(api) && S.draw && (id == null || items().some((x) => x.id === id))) select(id); },
      reset() { if (live.has(api)) reset(); },
      setView(v) { if (live.has(api) && v && v.width > 0) ts().setVisibleLogicalRange({ from: v.right - v.width, to: v.right }); },
      debug: () => ({ n: n(), sel, draw: S.draw, magnet: S.magnet, cur, anchor, curAt: cur && at(cur, true), range: ts().getVisibleLogicalRange(),
                      paths: prim.paths.map((p) => ({ id: p.item.id ?? null, kind: p.ln.kind, a: p.item.a || null, b: p.item.b || null, pts: p.pts })) }),   // 자동 시험용(읽기 전용)
      destroy() {
        if (!live.delete(api)) return;
        finish();
        window.removeEventListener("pointermove", touchMove, true);
        window.removeEventListener("pointerup", touchEnd, true);
        window.removeEventListener("pointercancel", touchEnd, true);
        chart.remove();
      },
    };
    live.add(api);
    return api;
  }

  return { create, current: () => [...live].reverse().find((c) => c.host.isConnected) || null };   // current: 지금 화면의 차트(자동 시험용)
})();
