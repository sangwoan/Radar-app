// 반도체: Daily Market Radar(DMR)의 반도체 정보를 이 앱이 직접 모아 보여 준다(읽기 전용). 데이터는 TR.semi(js/semi.js) → /api/semi.
//  아래 탭: 요약(브리프 · KPI · 시세) · 메모리(가격판 · 사이클 · 전망) · 뉴스(기업 집중 · 업계) · 일정(일정 · 수출 · 대만 월매출 · capex)
//  바깥 링크(뉴스 원문)는 앱에서 폰 브라우저로 연다(app.js의 바깥 링크 처리). 모든 바깥 글은 esc()를 거친다.
TR.modules.semi = (el) => {
  const { esc, load, save } = TR.util;
  const st = Object.assign({ sub: "sum", co: "skhynix", coTab: "top", newsTag: "semis" }, load("tr-semi", {}));
  const SUBS = [["sum", "요약"], ["mem", "메모리"], ["news", "뉴스"], ["cal", "일정·지표"]];
  const keep = () => save("tr-semi", st);
  let res = null;

  // ---------- 공통 ----------
  const H = (t, extra = "") => `<p class="box-h">${t}${extra ? ` <span class="muted">${extra}</span>` : ""}</p>`;
  const link = (u, t) => (/^https?:\/\//i.test(u || "") ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(t)}</a>` : esc(t));
  const fmtDate = (iso) => (iso ? `${iso.slice(5, 10).replace("-", "/")} ${iso.slice(11, 16)}` : "—");
  const empty = (m) => `<p class="muted sm-empty">${esc(m)}</p>`;
  const mod = (k) => res?.bundle?.data?.[k] || null;
  const items = (k) => (Array.isArray(mod(k)?.items) ? mod(k).items : []);
  // 섹션 하나가 깨져도 탭 전체가 멈추지 않게
  const ctx = () => ({ mod, items, H, link, empty, fmtDate, safe, st, keep, bundle: res.bundle });
  const safe = (name, fn) => { try { return fn(); } catch (e) { console.error(e); return `<div class="box">${H(name)}${empty(`표시하지 못했습니다: ${e.message}`)}</div>`; } };

  // ---------- 섹션: js/modules/semi_view.js(TR.semiView.sum · mem · news · cal · bind) ----------
  const S = TR.semiView;

  // ---------- 머리 줄: 데이터 시각 · 신선도 · 일부 출처 실패 · 새로 받기 ----------
  function head() {
    const b = res.bundle, upd = b?.data?.meta?.updated_at || b?.built_at;
    const hours = upd ? (Date.now() - Date.parse(upd)) / 3600000 : null;
    const failed = Object.entries(b?.data?.meta?.modules || {}).filter(([, v]) => v.status === "error").map(([k]) => NAMES[k] || k);
    return `<div class="semi-head">
      <span class="clock">${upd ? `${fmtDate(upd)} 기준` : "—"}</span>
      ${res.running ? `<span class="pill" data-semi-running>새로 받는 중…</span>`
        : hours != null && hours > 2 ? `<span class="pill warn">${hours >= 48 ? `${Math.floor(hours / 24)}일 전` : `${Math.floor(hours)}시간 전`} 데이터</span>` : ""}
      ${failed.length ? `<span class="pill warn" title="${esc(failed.join(" · "))}">일부 출처 실패 ${failed.length}</span>` : ""}
      ${res.error ? `<span class="pill warn" title="${esc(res.error)}">받기 실패 · 보관본</span>` : ""}
      <span class="semi-acts"><button type="button" class="btn sm" data-semi-refresh title="지금 새로 받기"${res.running ? " disabled" : ""}>↻ 새로 받기</button></span>
    </div>`;
  }
  const NAMES = { snapshot: "시세", news: "업계 뉴스", consensus: "컨센서스", calendar: "일정", memory: "메모리 가격", cycle: "사이클",
    company: "기업 뉴스", customers: "고객사 뉴스", outlook: "가격 전망", capex: "설비투자", twrev: "대만 월매출", exports: "수출 속보", brief: "브리프" };

  function page() {
    if (!res.bundle) {
      return `<section class="panel semi"><div class="box">${H("📈 반도체")}
        ${res.running ? `<p class="empty" data-semi-running>처음 데이터를 모으는 중입니다… (보통 30초~1분)</p>`
          : `<p class="semi-err" role="alert">데이터를 모으지 못했습니다: ${esc(res.error || "알 수 없는 오류")}</p>
             <div class="row"><button type="button" class="btn primary" data-semi-refresh>다시 시도</button></div>`}
        <p class="hint">시세 · 메모리 가격 · 사이클 지표 · 뉴스 · 일정을 이 ${TR.api.mode === "local" ? "폰이" : "맥이"} 직접 모읍니다(30분마다 새로).</p></div></section>`;
    }
    const seg = `<div class="seg seg-full semi-subs" role="group" aria-label="반도체 화면">${SUBS.map(([k, l]) => `<button type="button" data-sub="${k}" aria-pressed="${st.sub === k}">${l}</button>`).join("")}</div>`;
    return `<section class="panel semi">${head()}${seg}<div class="semi-body" data-sub-body>${safe(SUBS.find((s) => s[0] === st.sub)?.[1] || "", () => S[st.sub](ctx()))}</div>
      <p class="hint semi-foot">출처: 시세 Yahoo · 메모리 DRAMeXchange · 전망 TrendForce · 실적 Nasdaq(Zacks) · 설비투자 SEC · 대만 TWSE/TPEx · 뉴스 각 언론사(제목 · 링크만). 규칙은 Daily Market Radar와 같음. 개인 참고용.</p></section>`;
  }

  function draw() {
    el.innerHTML = page();
    el.querySelectorAll("[data-semi-refresh]").forEach((btn) => btn.addEventListener("click", async (e) => {
      e.currentTarget.disabled = true;
      res = await TR.semi.load(true);
      draw();
      poll();
    }));
    el.querySelectorAll("[data-sub]").forEach((b) => b.addEventListener("click", () => { st.sub = b.dataset.sub; keep(); draw(); window.scrollTo(0, 0); }));
    if (res.bundle) S.bind(el, { ...ctx(), draw });                  // 섹션별 조작(회사 토글 등)
  }

  // 모으는 중이면 몇 초마다 다시 묻고, 끝나면(또는 묶음이 바뀌면) 다시 그린다
  let timer = null;
  function poll() {
    clearTimeout(timer);
    if (!res?.running) return;
    timer = setTimeout(async () => {
      if (!here()) return;
      const before = res;
      res = await TR.semi.load();
      if (!here()) return;
      if (before.bundle?.built_at !== res.bundle?.built_at || before.running !== res.running || before.error !== res.error) draw();
      poll();
    }, 4000);
  }

  // 메모리에 있으면 바로 그리고(1분 새로고침에도 깜빡이지 않게), 오래됐으면 뒤에서 받아 바뀐 경우에만 다시 그린다
  const here = () => location.hash.replace(/^#/, "").split(/[/?]/)[0] === "semi" && el.isConnected;
  res = TR.semi.peek();
  if (res) draw(); else el.innerHTML = `<p class="empty">반도체 데이터를 불러오는 중…</p>`;
  if (!res || !TR.semi.fresh()) (async () => {
    const before = res;
    res = await TR.semi.load();
    if (!here()) return;                                           // 그동안 다른 화면으로 갔으면 그리지 않음
    if (!before || before.bundle?.built_at !== res.bundle?.built_at || before.error !== res.error || before.running !== res.running) draw();
    poll();
  })();
};
