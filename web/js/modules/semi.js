// 반도체: 형제 프로젝트 Daily Market Radar(DMR)의 반도체 정보를 폰에서 본다(읽기 전용). 데이터는 TR.semi(js/semi.js)가 받은 묶음.
//  아래 탭: 요약(브리프 · KPI · 시세) · 메모리(가격판 · 사이클 · 전망) · 뉴스(기업 집중 · 업계) · 일정(일정 · 수출 · 대만 월매출 · capex)
//  바깥 링크(뉴스 원문)는 앱에서 폰 브라우저로 연다(app.js의 바깥 링크 처리). 모든 바깥 글은 esc()를 거친다.
TR.modules.semi = (el) => {
  const { esc, load, save, toast } = TR.util;
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

  // ---------- 설정 안 됨 ----------
  function setup(msg = "") {
    return `<section class="panel semi">
      <div class="box">${H("📈 반도체 — Daily Market Radar 연결")}
        <p class="hint" style="margin-top:0">맥의 Daily Market Radar가 매일 올리는 데이터 묶음(비밀 gist)을 이 폰이 받아 보여 줍니다. 주소는 이 기기에만 저장됩니다.</p>
        <form class="form semi-url" data-form="semi-url">
          <label for="semi-url">gist 주소</label>
          <input id="semi-url" name="url" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false"
                 placeholder="https://gist.githubusercontent.com/…/raw/radar-bundle.json" value="${esc(TR.semi.url())}">
          ${msg ? `<p class="semi-err" role="alert">${esc(msg)}</p>` : ""}
          <div class="row"><button type="submit" class="btn primary">연결</button></div>
        </form>
        <details class="more"><summary>주소는 어디서 얻나요?</summary>
          <ol class="hint steps">
            <li>GitHub에서 <b>gist 권한만</b> 있는 토큰을 만든다</li>
            <li>맥 터미널(Daily Market Radar 폴더): <code>python3 scripts/keystore.py set GITHUB_TOKEN</code></li>
            <li><code>python3 scripts/publish.py --setup</code> → 나오는 주소(<code>config/settings.json</code>의 <code>remote.bundle_url</code>)를 여기에 붙여 넣기</li>
            <li>그 뒤로는 맥 에이전트의 매일 09:00 업데이트가 gist도 새로 고친다(맥이 꺼져 있던 날은 마지막 데이터)</li>
          </ol></details>
      </div></section>`;
  }

  // ---------- 머리 줄: 데이터 시각 · 신선도 · 새로 받기 ----------
  function head() {
    const b = res.bundle, upd = b?.data?.meta?.updated_at || b?.built_at;
    const hours = upd ? (Date.now() - Date.parse(upd)) / 3600000 : null;
    const stale = hours != null && hours > 30;
    const checks = b?.data?.meta?.checks;
    return `<div class="semi-head">
      <span class="clock">DMR ${upd ? `${fmtDate(upd)} 기준` : "—"}</span>
      ${stale ? `<span class="pill warn" title="맥의 Daily Market Radar 에이전트가 최근에 돌지 않았습니다">${hours > 48 ? `${Math.floor(hours / 24)}일 전 데이터` : "어제 데이터"}</span>` : ""}
      ${checks?.errors ? `<span class="pill warn" title="DMR 자체 점검">점검 오류 ${checks.errors}</span>` : ""}
      ${res.error ? `<span class="pill warn" title="${esc(res.error)}">받기 실패 · 보관본</span>` : ""}
      <span class="semi-acts"><button type="button" class="btn sm" data-semi-refresh title="gist에서 다시 받기">↻ 새로 받기</button></span>
    </div>`;
  }

  function page(msg) {
    if (!res.configured || msg) return setup(msg);
    if (!res.bundle) return setup(`데이터를 받지 못했습니다: ${res.error || "알 수 없는 오류"}`);
    const seg = `<div class="seg seg-full semi-subs" role="group" aria-label="반도체 화면">${SUBS.map(([k, l]) => `<button type="button" data-sub="${k}" aria-pressed="${st.sub === k}">${l}</button>`).join("")}</div>`;
    return `<section class="panel semi">${head()}${seg}<div class="semi-body" data-sub-body>${safe(SUBS.find((s) => s[0] === st.sub)?.[1] || "", () => S[st.sub](ctx()))}</div>
      <p class="hint semi-foot">출처: Daily Market Radar(맥) · 시세 Yahoo · 메모리 DRAMeXchange · 전망 TrendForce · 뉴스 각 언론사(제목 · 링크만). 개인 참고용.</p></section>`;
  }

  function draw(msg = "") {
    el.innerHTML = page(msg);
    el.querySelector('[data-form="semi-url"]')?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try { TR.semi.setUrl(new FormData(e.target).get("url")); }
      catch (err) { return draw(err.message); }
      el.innerHTML = `<p class="empty">반도체 데이터를 받는 중…</p>`;
      res = await TR.semi.load(true);
      if (res.bundle) toast("반도체 데이터를 연결했습니다");
      draw();
    });
    el.querySelector("[data-semi-refresh]")?.addEventListener("click", async (e) => {
      e.currentTarget.disabled = true;
      res = await TR.semi.load(true);
      toast(res.error ? `받기 실패: ${res.error}` : "새로 받았습니다");
      draw();
    });
    el.querySelectorAll("[data-sub]").forEach((b) => b.addEventListener("click", () => { st.sub = b.dataset.sub; keep(); draw(); window.scrollTo(0, 0); }));
    S.bind(el, { ...ctx(), draw });                                  // 섹션별 조작(회사 토글 등)
  }

  // 메모리에 있으면 바로 그리고(1분 새로고침에도 깜빡이지 않게), 오래됐으면 뒤에서 받아 바뀐 경우에만 다시 그린다
  const here = () => location.hash.replace(/^#/, "").split(/[/?]/)[0] === "semi" && el.isConnected;
  res = TR.semi.peek();
  if (res) draw(); else el.innerHTML = `<p class="empty">반도체 데이터를 불러오는 중…</p>`;
  if (!res || !TR.semi.fresh()) (async () => {
    const before = res;
    res = await TR.semi.load();
    if (!here()) return;                                           // 그동안 다른 화면으로 갔으면 그리지 않음
    if (!before || before.bundle?.built_at !== res.bundle?.built_at || before.error !== res.error) draw();
  })();
};
