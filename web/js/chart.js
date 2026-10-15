// 인터랙티브 캔들 차트 — 엔진: TradingView Lightweight Charts(js/vendor, Apache-2.0) + 빗각 플러그인(이 파일)
//  조작(엔진): 핀치 · 휠 확대, 드래그 이동(관성), 가격 · 시간 축을 끌어 늘리기, 축 더블클릭 맞춤. 휴대폰은 세로 밀기 = 페이지 스크롤.
//  맞춤: 차트 더블클릭 · 두 번 탭. 크로스헤어 위치의 시 · 고 · 저 · 종은 위 줄(ch-ohlc)에.
//  빗각(플러그인): 서버가 고른 선 + 내 선을 시작점부터 미래 영역까지, 오른쪽 가격 축에 선 값 표시. 멀리 있는 선 · 이평은 세로 축을 늘리지 않는다.
//  그리기 모드: 시작점에서 끝점까지 끌기, 또는 두 점을 차례로 탭. 봉의 고가 · 저가 가까이면 붙는다(자석).
//  내 선 고치기: 선을 누르면 선택(양 끝 손잡이) → 손잡이를 끌어 끝점 이동, 선을 끌어 통째로 이동, '선 지우기'.
// 봉 위치는 '봉 번호'(logical)로 다룬다 — 선(valueAt)과 그리기 결과({i, p})가 예전 차트와 같은 좌표다.
TR.chart = (() => {
  const LW = window.LightweightCharts;
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const DEFAULT_BARS = { "15m": 160, "1h": 150, "4h": 150, "1d": 130, "1w": 120 };
  const SNAP = 14, HIT = 14, HANDLE = 22, MOVE = 7;           // 자석 · 선 잡기 · 손잡이 · 끌기 시작 거리(px)

  function colors() {
    return { bg: css("--card"), grid: css("--line"), axis: css("--muted"), text: css("--text"), text2: css("--text-2"), up: css("--up"),
             down: css("--down"), sup: css("--series-3"), res: css("--series-2"), user: css("--accent"), font: css("--mono") || "monospace",
             ma: [css("--series-1"), css("--series-4"), css("--series-5"), css("--series-7")] };
  }

  const live = new Set();                                       // 다시 그리면서 화면에서 빠진 차트는 엔진까지 정리(메모리 · 리사이즈 감시)
  function create(host, opt = {}) {
    for (const c of live) if (!c.host.isConnected) c.destroy();
    host.innerHTML = `<div class="ch-ohlc num"></div>
      <div class="ch-wrap"><div class="ch-lw" aria-label="캔들 차트"></div>
        <button type="button" class="btn sm ch-del" hidden>선 지우기</button><p class="ch-hint" hidden></p></div>`;
    const box = host.querySelector(".ch-lw"), ohlc = host.querySelector(".ch-ohlc"), delBtn = host.querySelector(".ch-del"), hint = host.querySelector(".ch-hint");
    box.style.height = `${opt.height || 480}px`;
    let S = { bars: [], lines: [], series: [], log: true, volume: true, tf: "1d", draw: false };
    let C = colors(), sel = null, gest = null, anchor = null, ghost = null, pending = null, lastTap = 0, quiet = false;
    let saving = null;                                            // 저장 중인 선({id?, a, b}) — 새 데이터가 올 때까지 그 자리에 보여 준다
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
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: { time: true, price: true }, axisDoubleClickReset: { time: true, price: true } },
      kineticScroll: { touch: true, mouse: false },
    });
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
    function at(pt, snap) {                                       // 화면 점 → {i(봉 번호), p(가격)}, 자석: 고가 · 저가 가까이면 붙임
      const N = n();
      let i = Math.round(ts().coordinateToLogical(pt.x) ?? N - 1);
      i = Math.max(0, Math.min(N - 1, i));
      let p = candle.coordinateToPrice(pt.y);
      if (snap && S.bars[i]) {
        const b = S.bars[i], yh = Y(b.h), yl = Y(b.l);
        const dh = yh == null ? 1e9 : Math.abs(yh - pt.y), dl = yl == null ? 1e9 : Math.abs(yl - pt.y);
        if (Math.min(dh, dl) <= SNAP) p = dh <= dl ? b.h : b.l;
      }
      return p > 0 ? { i, p } : null;
    }
    // 두 점(봉 번호 · 가격)을 지나는 선의 값 — 로그 가격에서 직선(서버 선과 같은 방식)
    const through = (a, b) => (i) => Math.exp(Math.log(a.p) + ((Math.log(b.p) - Math.log(a.p)) / (b.i - a.i || 1)) * (i - a.i));

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
        const list = S.lines.map((ln) => ({ ln, valueAt: ln.valueAt, start: ln.start }));
        for (const ed of [gest?.edit, saving?.id != null ? saving : null]) {   // 끄는 중 · 저장 중인 내 선은 새 위치로
          if (!ed) continue;
          const k = list.findIndex((x) => x.ln.id === ed.id);
          if (k >= 0) list[k] = { ln: list[k].ln, valueAt: through(ed.a, ed.b), start: Math.min(ed.a.i, ed.b.i), a: ed.a, b: ed.b };
        }
        if (saving && saving.id == null) list.push({ ln: { kind: "user", width: 2.4 }, valueAt: through(saving.a, saving.b), start: saving.a.i, a: saving.a, b: saving.b });
        if (ghost) list.push({ ln: { kind: "user", ghost: true, width: 2 }, valueAt: through(ghost.a, ghost.b), start: Math.min(ghost.a.i, ghost.b.i), a: ghost.a, b: ghost.b });
        for (const x of list) {
          const sI = Math.max(x.start, left - 1), idx = [sI];
          for (let i = Math.max(0, Math.ceil(sI)); i <= Math.min(N - 1, Math.ceil(right) + 1); i += step) if (i > sI) idx.push(i);
          const fut = right + 2;
          if (fut > N - 1) for (let k = 1; k <= 8; k++) idx.push(N - 1 + ((fut - (N - 1)) * k) / 8);
          const pts = [];
          for (const i of idx) {
            const v = x.valueAt(i), px = X(i), py = v > 0 ? Y(v) : null;
            pts.push(px == null || py == null ? null : [px, py]);
          }
          const isSel = x.ln.id != null && x.ln.id === sel;
          const handles = isSel ? [x.a || x.ln.a, x.b || x.ln.b].filter(Boolean).map((h) => [X(h.i), Y(h.p)]) : [];
          this.paths.push({ ln: x.ln, pts, col: lineColor(x.ln), sel: isSel, handles });
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
      ohlc.innerHTML = `<span class="muted">${fmtTime(timeOf(b), true)}</span> 시 ${f(b.o)} 고 ${f(b.h)} 저 ${f(b.l)} 종 <b>${f(b.c)}</b> <span class="${ch >= 0 ? "up" : "down"}">${ch >= 0 ? "+" : ""}${ch.toFixed(2)}%</span>`;
    }
    chart.subscribeCrosshairMove((param) => {
      const N = n();
      showOhlc(param.logical == null ? N - 1 : Math.max(0, Math.min(N - 1, Math.round(param.logical))));
      if (S.draw && anchor && !gest && param.point) { const b = at(param.point, true); ghost = b ? { a: anchor, b } : null; prim.request(); }   // PC: 두 번째 점 미리 보기
    });

    // ---------- 그리기 · 고치기: 엔진보다 먼저(capture) 받아서, 우리가 맡은 동작이면 엔진에 넘기지 않는다 ----------
    const local = (e) => { const r = box.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    function segDist(p, a, b) {
      const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
      const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
      return dist(p, [a[0] + t * dx, a[1] + t * dy]);
    }
    function hitLine(pt) {                                         // 내 선 중 손가락 가까운 것(편집 가능한 것만)
      const q = [pt.x, pt.y];
      let best = null;
      for (const p of prim.paths) {
        if (p.ln.kind !== "user" || p.ln.id == null || !p.ln.a) continue;
        for (let k = 1; k < p.pts.length; k++) {
          if (!p.pts[k - 1] || !p.pts[k]) continue;
          const d = segDist(q, p.pts[k - 1], p.pts[k]);
          if (d <= HIT && (!best || d < best.d)) best = { d, ln: p.ln };
        }
      }
      return best?.ln || null;
    }
    function select(id) {
      sel = id;
      delBtn.hidden = !id || !opt.onDelete;
      prim.request();
    }
    const editable = () => S.tf === "1d" || S.tf === "1w";

    function down(e) {
      if (e.button > 0 || !n()) return;
      const pt = local(e);
      if (pt.x > plotW()) return;                                  // 가격 축은 엔진(축 끌어 늘리기)
      if (gest) { gest = null; ghost = null; prim.request(); return; }          // 두 번째 손가락 → 엔진(핀치)에 맡김
      if (S.draw) {
        const a = at(pt, true);
        if (!a) return;
        gest = { type: "draw", x0: pt.x, y0: pt.y, a, moved: false };
      } else if (editable()) {
        const selP = sel != null && prim.paths.find((p) => p.ln.id === sel);
        const r = e.pointerType === "mouse" ? HANDLE : HANDLE * 1.4;
        const h = selP ? selP.handles.findIndex((q) => q[0] != null && dist(q, [pt.x, pt.y]) <= r) : -1;
        const ln = h >= 0 ? selP.ln : hitLine(pt);
        if (!ln) { if (sel != null) select(null); return; }       // 빈 곳 → 엔진(이동 · 크로스헤어)
        if (ln.id !== sel) select(ln.id);
        gest = { type: h === 0 ? "a" : h === 1 ? "b" : "move", x0: pt.x, y0: pt.y, ln, moved: false, start: at(pt, false) };
      } else return;
      touch.mine = true;
      e.stopPropagation();
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", up, true);
      window.addEventListener("pointercancel", cancel, true);
    }
    function move(e) {
      if (!gest) return;
      const pt = local(e);
      gest.last = pt;                                             // 손을 뗄 때의 좌표는 기기마다 믿기 어려워 마지막 이동 위치를 쓴다
      if (!gest.moved && Math.hypot(pt.x - gest.x0, pt.y - gest.y0) < MOVE) return;
      gest.moved = true;
      if (gest.type === "draw") {
        const b = at(pt, true);
        ghost = b && b.i !== gest.a.i ? { a: gest.a, b } : null;
      } else {
        const ln = gest.ln;
        if (gest.type === "move") {
          const cur = at(pt, false);
          if (!cur || !gest.start) return;
          const di = cur.i - gest.start.i, r = cur.p / gest.start.p;
          gest.edit = { id: ln.id, a: { i: ln.a.i + di, p: ln.a.p * r }, b: { i: ln.b.i + di, p: ln.b.p * r } };
        } else {
          const q = at(pt, true);
          if (!q) return;
          gest.edit = { id: ln.id, a: gest.type === "a" ? q : ln.a, b: gest.type === "b" ? q : ln.b };
        }
      }
      prim.request();
    }
    function finish() {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancel, true);
      const g = gest;
      gest = null; ghost = null;
      if (pending) { const [d, k] = pending; pending = null; setData(d, k); }
      prim.request();
      return g;
    }
    function up(e) {
      const g = finish();
      if (!g) return;
      e.stopPropagation();
      if (g.type === "draw") {
        const b = g.moved ? at(g.last || local(e), true) : null;
        if (b && b.i !== g.a.i) { anchor = null; return emitDraw(g.a, b); }
        if (g.moved) { TR.util.toast("봉이 있는 곳에서 두 날짜에 걸쳐 그리세요"); return; }
        if (!g.moved) {                                           // 탭: 첫 점 → 두 번째 점
          if (!anchor) { anchor = g.a; hintText("두 번째 점을 누르세요 · 같은 곳을 다시 누르면 취소"); }
          else if (g.a.i === anchor.i) { anchor = null; hintText(); }
          else { const a = anchor; anchor = null; emitDraw(a, g.a); }
          prim.request();
        }
        return;
      }
      if (g.moved && g.edit) {
        let { a, b } = g.edit;
        if (a.i === b.i) return;
        if (a.i > b.i) [a, b] = [b, a];
        if (a.i < 0 || b.i > n() - 1) { TR.util.toast("선 끝점은 차트 안의 봉에 두세요"); return; }
        saving = { id: g.ln.id, a, b };
        hintText("저장 중…");
        prim.request();
        opt.onEdit?.(g.ln.id, a, b);
      }
    }
    function cancel() { finish(); }
    function emitDraw(a, b) {                                     // 한 줄 그렸으면 그리기 모드를 끝내고(저장하는 몇 초 동안 또 그려지지 않게) 저장 중 표시
      if (a.i > b.i) [a, b] = [b, a];
      saving = { a, b };
      S.draw = false; box.classList.remove("drawing");
      hintText("저장 중…");
      prim.request();
      opt.onDraw?.(a, b);
    }
    // 엔진이 터치 · 마우스 호환 이벤트로도 받으므로, 우리가 맡은 제스처 동안은 그것도 막는다(세로 스크롤 포함)
    const block = (e) => { if (gest) { e.stopPropagation(); if (e.cancelable && e.type === "touchmove") e.preventDefault(); } };
    for (const t of ["touchstart", "touchmove", "touchend", "mousedown", "mousemove", "mouseup"]) box.addEventListener(t, block, { capture: true, passive: false });
    // 맞춤: 더블클릭 · 두 번 탭(그리기 모드 아닐 때). 탭 = 손가락 하나 · 짧게 · 거의 안 움직임 — 핀치 뒤 두 손가락을 떼는 것을 두 번 탭으로 보면 화면이 처음으로 돌아간다
    box.addEventListener("dblclick", (e) => { if (!S.draw && local(e).x <= plotW()) { reset(); } });
    const touch = { ids: new Set(), multi: false, t0: 0, x0: 0, y0: 0, moved: false };
    box.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse") return;
      if (!touch.ids.size) Object.assign(touch, { multi: false, t0: performance.now(), x0: e.clientX, y0: e.clientY, moved: false });
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
    delBtn.addEventListener("click", () => { const id = sel; select(null); if (id != null) opt.onDelete?.(id); });

    const drawHint = () => (window.matchMedia("(pointer: coarse)").matches ? "시작점에서 끝점까지 끌거나 두 점을 차례로 누르세요 · 고가 · 저가 근처는 자동으로 붙습니다"
      : "시작점에서 끝점까지 드래그하거나 두 점을 차례로 클릭 · 고가 · 저가 근처는 자동으로 붙습니다");
    function hintText(t) { hint.hidden = !t; hint.textContent = t || ""; }

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
      if (sel != null && !S.lines.some((l) => l.id === sel)) select(null);
      if (!keepView || !hadBars) reset();
      quiet = false;
      anchor = null;
      if (saving) { saving = null; hintText(S.draw ? drawHint() : ""); }
      showOhlc(n() - 1);
      prim.request();
    }

    const api = {
      host,
      setData,
      setDraw(on) {
        S.draw = on; anchor = null; ghost = null;
        if (on) select(null);
        box.classList.toggle("drawing", on);
        hintText(on ? drawHint() : "");
        prim.request();
      },
      reset() { if (live.has(api)) reset(); },
      setView(v) { if (live.has(api) && v && v.width > 0) ts().setVisibleLogicalRange({ from: v.right - v.width, to: v.right }); },
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

  return { create };
})();
