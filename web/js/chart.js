// 인터랙티브 캔들 차트(캔버스, 라이브러리 없음)
//  확대·축소: 마우스 휠·트랙패드 / 휴대폰 두 손가락 핀치 · 이동: 드래그(휴대폰은 좌우로, 위아래는 페이지 스크롤)
//  맞춤: 더블클릭·더블탭 · 크로스헤어: PC는 마우스 올리기, 휴대폰은 탭 · 빗각 그리기: 두 점 탭(그리는 중에도 드래그로 이동 가능)
// 가격 축은 보이는 구간에 맞춰 자동(로그·선형). 빗각은 오른쪽 미래 영역까지 연장해 그린다.
TR.chart = (() => {
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const DEFAULT_BARS = { "15m": 160, "1h": 150, "4h": 150, "1d": 130, "1w": 120 };

  function create(host, opt = {}) {
    host.innerHTML = `<div class="ch-ohlc num"></div><canvas class="ch-canvas" aria-label="캔들 차트"></canvas>`;
    const cv = host.querySelector("canvas"), g = cv.getContext("2d"), ohlc = host.querySelector(".ch-ohlc");
    let S = { bars: [], lines: [], series: [], log: true, volume: true, tf: "1d", draw: false };
    const view = { right: 0, width: 100 };
    let L = null, cross = null, anchor = null, raf = 0, lastTap = 0;
    const pointers = new Map();
    let gest = null;

    const n = () => S.bars.length;
    function reset() {
      const w = Math.max(12, Math.min(n(), DEFAULT_BARS[S.tf] || 130));
      view.width = w;
      view.right = n() - 1 + Math.max(2, w * 0.08);
    }
    function clampRight(r) { return Math.min(n() - 1 + view.width * 0.75, Math.max(view.width * 0.25, r)); }
    function zoomAt(w, px) {
      if (!L) return;
      const idx = L.left + (px - L.x0) / L.bw;
      const nw = Math.max(12, Math.min(n() + 60, w));
      const frac = (px - L.x0) / L.plotW;
      view.width = nw;
      view.right = clampRight(idx - frac * nw + nw);
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); opt.onView?.({ right: view.right, width: view.width }); }); };

    // ---------- 그리기 ----------
    function draw() {
      const W = Math.max(280, host.clientWidth || 600), H = opt.height || 480;
      const dpr = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
        cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
        cv.style.width = `${W}px`; cv.style.height = `${H}px`;
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const C = { bg: css("--card"), grid: css("--line"), axis: css("--muted"), text: css("--text"), text2: css("--text-2"), up: css("--up"),
                  down: css("--down"), sup: css("--series-3"), res: css("--series-2"), user: css("--accent"), font: css("--mono") || "monospace",
                  ma: [css("--series-1"), css("--series-4"), css("--series-5"), css("--series-7")] };
      g.fillStyle = C.bg; g.fillRect(0, 0, W, H);
      const N = n();
      if (!N) { g.fillStyle = C.axis; g.font = `13px ${C.font}`; g.fillText("데이터가 없습니다", 16, 30); return; }
      const axisR = W < 560 ? 58 : 72, axisB = 22, volH = S.volume && S.bars.some((b) => b.v) ? Math.round((H - axisB) * 0.15) : 0;
      const x0 = 4, plotW = W - axisR - x0, y0 = 6, mainH = H - axisB - y0 - (volH ? volH + 6 : 0), volTop = y0 + mainH + 6;
      const left = view.right - view.width, bw = plotW / view.width;
      const cx = (i) => x0 + (i + 0.5 - left) * bw;
      const iA = Math.max(0, Math.floor(left)), iB = Math.min(N - 1, Math.ceil(view.right));
      // 세로 범위: 보이는 봉 + 범위에서 너무 멀지 않은 선·이평
      let lo = Infinity, hi = -Infinity;
      for (let i = iA; i <= iB; i++) { lo = Math.min(lo, S.bars[i].l); hi = Math.max(hi, S.bars[i].h); }
      if (!isFinite(lo)) { lo = S.bars[N - 1].l; hi = S.bars[N - 1].h; }
      // 선·이평은 보이는 가격 범위 근처(범위 높이의 35% 안)일 때만 축을 넓힌다 — 멀리 있는 선 때문에 캔들이 눌리지 않게
      const span = Math.log(hi / lo) || 0.01, cLo = lo * Math.exp(-span * 0.35), cHi = hi * Math.exp(span * 0.35);
      let lo2 = lo, hi2 = hi;
      for (const s of S.series) for (let i = iA; i <= iB; i++) { const v = s.vals[i]; if (v != null && v > cLo && v < cHi) { lo2 = Math.min(lo2, v); hi2 = Math.max(hi2, v); } }
      for (const ln of S.lines) {
        for (const i of [Math.max(iA, ln.start), Math.min(view.right, N - 1)]) {
          const v = ln.valueAt(i);
          if (v != null && v > cLo && v < cHi) { lo2 = Math.min(lo2, v); hi2 = Math.max(hi2, v); }
        }
      }
      lo = lo2; hi = hi2;
      const log = S.log && lo > 0;
      const fy = log ? Math.log : (v) => v, inv = log ? Math.exp : (v) => v;
      const pad = (fy(hi) - fy(lo)) * 0.07 || Math.abs(fy(hi)) * 0.01 || 1;
      const f0 = fy(lo) - pad, f1 = fy(hi) + pad;
      const Y = (p) => y0 + (1 - (fy(p) - f0) / (f1 - f0)) * mainH;
      const P = (y) => inv(f0 + (1 - (y - y0) / mainH) * (f1 - f0));
      L = { x0, plotW, bw, left, y0, mainH, Y, P, cx, iA, iB };

      // 가격 눈금
      g.font = `10.5px ${C.font}`; g.textBaseline = "middle";
      const pLo = inv(f0), pHi = inv(f1), ticks = [];
      if (log) {
        const c = [];
        for (let e = Math.floor(Math.log10(pLo)) - 1; e <= Math.ceil(Math.log10(pHi)); e++)
          for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8]) { const v = m * 10 ** e; if (v >= pLo && v <= pHi) c.push(v); }
        const want = Math.max(3, Math.round(mainH / 70));
        for (let k = 0; k < want && c.length; k++) {
          const tgt = f0 + ((f1 - f0) * (k + 0.5)) / want;
          const best = c.reduce((a, b) => (Math.abs(fy(b) - tgt) < Math.abs(fy(a) - tgt) ? b : a));
          if (!ticks.includes(best)) ticks.push(best);
        }
      } else {
        const step0 = (pHi - pLo) / Math.max(3, Math.round(mainH / 70)), mag = 10 ** Math.floor(Math.log10(step0));
        const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= step0);
        for (let v = Math.ceil(pLo / step) * step; v <= pHi; v += step) ticks.push(+v.toPrecision(12));
      }
      g.strokeStyle = C.grid; g.lineWidth = 1; g.fillStyle = C.axis; g.textAlign = "left";
      for (const t of ticks) {
        const y = Math.round(Y(t)) + 0.5;
        g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + plotW, y); g.stroke();
        g.fillText(fmtAxis(t, W < 560), x0 + plotW + 6, y);
      }
      // 시간 눈금
      const every = Math.max(1, Math.ceil(84 / bw));
      g.textAlign = "center"; g.textBaseline = "alphabetic";
      for (let i = Math.ceil(left / every) * every; i <= iB; i += every) {
        if (i < 0) continue;
        const x = cx(i);
        if (x < x0 + 20 || x > x0 + plotW - 20) continue;
        g.strokeStyle = C.grid; g.beginPath(); g.moveTo(Math.round(x) + 0.5, y0); g.lineTo(Math.round(x) + 0.5, y0 + mainH); g.stroke();
        g.fillStyle = C.axis; g.fillText(fmtTime(S.bars[i], S.tf), x, H - 6);
      }

      g.save(); g.beginPath(); g.rect(x0, 0, plotW, H - axisB); g.clip();
      // 거래량
      if (volH) {
        let vm = 1;
        for (let i = iA; i <= iB; i++) vm = Math.max(vm, S.bars[i].v || 0);
        g.globalAlpha = 0.45;
        for (let i = iA; i <= iB; i++) {
          const b = S.bars[i], h = ((b.v || 0) / vm) * (volH - 2);
          g.fillStyle = b.c >= b.o ? C.up : C.down;
          g.fillRect(cx(i) - Math.max(1, bw * 0.7) / 2, volTop + volH - h, Math.max(1, bw * 0.7), h);
        }
        g.globalAlpha = 1;
      }
      // 이동평균
      S.series.forEach((s, k) => {
        g.strokeStyle = s.color || C.ma[k % 4]; g.lineWidth = 1.3; g.beginPath();
        let on = false;
        for (let i = Math.max(0, iA - 1); i <= Math.min(N - 1, iB + 1); i++) {
          const v = s.vals[i];
          if (v == null) { on = false; continue; }
          on ? g.lineTo(cx(i), Y(v)) : g.moveTo(cx(i), Y(v)); on = true;
        }
        g.stroke();
      });
      // 캔들
      const body = Math.max(1, Math.min(14, bw * 0.68));
      for (let i = iA; i <= iB; i++) {
        const b = S.bars[i], up = b.c >= b.o, x = Math.round(cx(i)) + 0.5;
        g.strokeStyle = g.fillStyle = up ? C.up : C.down; g.lineWidth = 1;
        g.beginPath(); g.moveTo(x, Y(b.h)); g.lineTo(x, Y(b.l)); g.stroke();
        if (bw >= 3) {
          const t = Y(Math.max(b.o, b.c)), bt = Y(Math.min(b.o, b.c));
          g.fillRect(x - body / 2, t, body, Math.max(1, bt - t));
        }
      }
      // 빗각: 시작점부터 오른쪽 끝(미래)까지
      const labels = [];
      for (const ln of S.lines) {
        const col = ln.kind === "user" ? C.user : ln.side === "sup" ? C.sup : C.res;
        g.strokeStyle = col; g.lineWidth = ln.width || 2; g.globalAlpha = ln.weak ? 0.45 : 1;
        g.setLineDash(ln.broken ? [6, 4] : []);
        // 지나갈 지점: 시작점 → 보이는 봉마다 → 마지막 봉 뒤 미래 영역(8등분, 선형 축에서도 곡선이 매끄럽게)
        const sI = Math.max(ln.start, left - 1), pts = [sI], stepB = Math.max(1, Math.floor(view.width / 400));
        for (let i = Math.max(0, Math.ceil(sI)); i <= Math.min(N - 1, Math.ceil(view.right) + 1); i += stepB) if (i > sI) pts.push(i);
        const fut = view.right + 2;
        if (fut > N - 1) for (let k = 1; k <= 8; k++) pts.push(N - 1 + ((fut - (N - 1)) * k) / 8);
        g.beginPath();
        let on = false;
        for (const i of pts) {
          const v = ln.valueAt(i);
          if (v == null || (log && !(v > 0))) { on = false; continue; }
          const x = cx(i), y = Y(v);
          on ? g.lineTo(x, y) : g.moveTo(x, y); on = true;
        }
        g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
        if (ln.label) {
          // 라벨 값 = 지금 봉(화면이 과거로 밀려 있으면 화면 오른쪽 끝 봉)에서의 선 가격 — 옆 패널·알림 숫자와 같다
          const iv = Math.min(Math.floor(view.right), N - 1), v = ln.valueAt(iv);
          if (v != null && iv >= ln.start) labels.push({ x: Math.min(x0 + plotW - 4, cx(iv) - 6), y: Y(v) - 6, col, text: `${ln.label} ${fmtAxis(v, W < 560)}` });
        }
      }
      // 끝 라벨 겹침 방지
      labels.sort((a, b) => a.y - b.y);
      for (let k = 1; k < labels.length; k++) if (labels[k].y - labels[k - 1].y < 13) labels[k].y = labels[k - 1].y + 13;
      g.font = `bold 10.5px ${C.font}`; g.textAlign = "right"; g.textBaseline = "alphabetic";
      for (const lb of labels) {
        if (lb.y < y0 + 8 || lb.y > y0 + mainH) continue;
        g.lineWidth = 3; g.strokeStyle = C.bg; g.strokeText(lb.text, lb.x, lb.y);
        g.fillStyle = lb.col; g.fillText(lb.text, lb.x, lb.y);
      }
      // 그리는 중인 임시 선
      if (anchor && cross) {
        g.strokeStyle = C.user; g.lineWidth = 2; g.setLineDash([5, 3]);
        g.beginPath(); g.moveTo(cx(anchor.i), Y(anchor.p)); g.lineTo(cross.x, cross.y); g.stroke(); g.setLineDash([]);
      }
      if (anchor) { g.fillStyle = C.user; g.beginPath(); g.arc(cx(anchor.i), Y(anchor.p), 4, 0, 7); g.fill(); }
      g.restore();

      // 현재가
      const last = S.bars[N - 1].c, yl = Math.round(Y(last)) + 0.5;
      if (yl > y0 && yl < y0 + mainH) {
        g.strokeStyle = C.text2; g.globalAlpha = 0.6; g.setLineDash([2, 2]); g.lineWidth = 1;
        g.beginPath(); g.moveTo(x0, yl); g.lineTo(x0 + plotW, yl); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
        tag(x0 + plotW + 1, yl, fmtAxis(last, W < 560), C.text, C.bg, axisR - 2);
      }
      // 크로스헤어
      let ci = N - 1;
      if (cross && cross.x >= x0 && cross.x <= x0 + plotW && cross.y >= y0 && cross.y <= y0 + mainH) {
        ci = Math.max(0, Math.min(N - 1, Math.floor(left + (cross.x - x0) / bw)));
        const x = Math.round(cx(ci)) + 0.5, y = Math.round(cross.y) + 0.5;
        g.strokeStyle = C.axis; g.lineWidth = 1; g.setLineDash([3, 3]);
        g.beginPath(); g.moveTo(x, y0); g.lineTo(x, H - axisB); g.moveTo(x0, y); g.lineTo(x0 + plotW, y); g.stroke(); g.setLineDash([]);
        tag(x0 + plotW + 1, y, fmtAxis(P(cross.y), W < 560), css("--accent"), "#fff", axisR - 2);
        const tl = fmtTime(S.bars[ci], S.tf, true);
        g.font = `10.5px ${C.font}`;
        const tw = g.measureText(tl).width + 10;
        g.fillStyle = css("--accent"); g.fillRect(Math.min(x0 + plotW - tw, Math.max(x0, x - tw / 2)), H - axisB + 2, tw, 18);
        g.fillStyle = "#fff"; g.textAlign = "center"; g.fillText(tl, Math.min(x0 + plotW - tw / 2, Math.max(x0 + tw / 2, x)), H - axisB + 15);
      }
      showOhlc(ci);

      function tag(x, y, text, bg, fg, w) {
        g.fillStyle = bg; g.fillRect(x, y - 9, w, 18);
        g.fillStyle = fg; g.font = `bold 10.5px ${C.font}`; g.textAlign = "left"; g.textBaseline = "middle"; g.fillText(text, x + 5, y + 0.5);
        g.textBaseline = "alphabetic";
      }
    }

    function showOhlc(i) {
      const b = S.bars[i], p = S.bars[i - 1];
      if (!b) return;
      const ch = p ? (b.c / p.c - 1) * 100 : 0, f = (v) => TR.util.price(v);
      ohlc.innerHTML = `<span class="muted">${fmtTime(b, S.tf, true)}</span> 시 ${f(b.o)} 고 ${f(b.h)} 저 ${f(b.l)} 종 <b>${f(b.c)}</b> <span class="${ch >= 0 ? "up" : "down"}">${ch >= 0 ? "+" : ""}${ch.toFixed(2)}%</span>`;
    }

    // ---------- 조작 ----------
    const local = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    cv.addEventListener("pointerdown", (e) => {
      cv.setPointerCapture?.(e.pointerId);
      const pt = local(e);
      pointers.set(e.pointerId, pt);
      if (pointers.size === 1) gest = { type: "tap", x0: pt.x, y0: pt.y, r0: view.right, t0: performance.now() };
      else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        gest = { type: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, w0: view.width, mx: (a.x + b.x) / 2 };
      }
    });
    cv.addEventListener("pointermove", (e) => {
      const pt = local(e);
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, pt);
      if (gest?.type === "pinch" && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        zoomAt(gest.w0 * gest.d0 / Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), gest.mx);
        schedule(); return;
      }
      if (gest && pointers.size === 1 && (gest.type === "tap" || gest.type === "pan")) {
        const dx = pt.x - gest.x0;
        if (gest.type === "tap" && Math.hypot(dx, pt.y - gest.y0) > 6) gest.type = "pan";
        if (gest.type === "pan" && L) { view.right = clampRight(gest.r0 - dx / L.bw); if (e.pointerType !== "mouse") cross = null; }
        if (e.pointerType === "mouse") cross = pt;
        schedule(); return;
      }
      if (e.pointerType === "mouse" || anchor) { cross = pt; schedule(); }
    });
    const end = (e) => {
      const wasTap = gest?.type === "tap" && e.type === "pointerup" && performance.now() - gest.t0 < 600;
      pointers.delete(e.pointerId);
      if (wasTap) onTap(local(e), e.pointerType);
      if (!pointers.size) gest = null;
      else if (pointers.size === 1) { const p = [...pointers.values()][0]; gest = { type: "pan", x0: p.x, y0: p.y, r0: view.right, t0: 0 }; }
    };
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);
    cv.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && !pointers.size && !anchor) { cross = null; schedule(); } });
    cv.addEventListener("wheel", (e) => {
      e.preventDefault();
      const pt = local(e);
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && !e.ctrlKey) { if (L) view.right = clampRight(view.right + e.deltaX / L.bw); }
      else zoomAt(view.width * Math.exp(e.deltaY * (e.ctrlKey ? 0.012 : 0.0016)), pt.x);
      schedule();
    }, { passive: false });
    cv.addEventListener("dblclick", () => { reset(); schedule(); });

    function onTap(pt, type) {
      const now = performance.now();
      if (!S.draw && now - lastTap < 320) { reset(); cross = null; lastTap = 0; schedule(); return; }     // 더블탭 → 맞춤
      lastTap = now;
      if (S.draw && L) {
        const i = Math.max(0, Math.min(n() - 1, Math.floor(L.left + (pt.x - L.x0) / L.bw)));
        const p = L.P(Math.max(L.y0, Math.min(L.y0 + L.mainH, pt.y)));
        if (!anchor) { anchor = { i, p }; cross = pt; }
        else if (i !== anchor.i) { const a = anchor; anchor = null; opt.onDraw?.(a.i < i ? a : { i, p }, a.i < i ? { i, p } : a); }
        schedule(); return;
      }
      if (type !== "mouse") { cross = cross ? null : pt; schedule(); }        // 휴대폰: 탭으로 크로스헤어 켜고 끄기
    }

    const ro = "ResizeObserver" in window ? new ResizeObserver(() => schedule()) : null;
    ro?.observe(host);

    return {
      setData(d, keepView) {
        S = { ...S, ...d };
        if (!keepView || !n()) reset();
        anchor = null;
        schedule();
      },
      setDraw(on) { S.draw = on; anchor = null; cv.classList.toggle("drawing", on); schedule(); },
      reset() { reset(); schedule(); },
      setView(v) { if (v && v.width > 0) { view.width = Math.max(12, Math.min(n() + 60, v.width)); view.right = clampRight(v.right); schedule(); } },
      destroy() { ro?.disconnect(); if (raf) cancelAnimationFrame(raf); },
    };
  }

  function fmtAxis(p, short) {
    if (short && p >= 10000) return p >= 1e6 ? `${+(p / 1e6).toPrecision(3)}M` : `${+(p / 1e3).toPrecision(3)}K`;
    return TR.util.price(p);
  }
  function fmtTime(b, tf, full) {
    if (!b) return "";
    if (tf === "1d" || tf === "1w") {
      const [y, m, d] = b.d.split("-");
      return full ? `${y}-${m}-${d}${tf === "1w" ? " 주" : ""}` : tf === "1w" ? `${y.slice(2)}.${m}` : `${m}.${d}`;
    }
    const t = new Date(b.t * 1000), p = (v) => String(v).padStart(2, "0");
    return `${p(t.getMonth() + 1)}.${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`;
  }
  return { create };
})();
