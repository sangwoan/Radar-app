// 설정: (폰 앱) 이 폰 · (맥 서버) 휴대폰 접속 · 카카오톡 — 공통: 알림(주기 · 강도 · 대상) · 빗각 기준 · 종목 목록 · 상태.
TR.modules.settings = (el, D, route) => {
  const { esc, num, hm, ago, toast, GROUP } = TR.util;
  const A = D.alerts, st = D.status, k = st?.kakao || {}, local = st?.local !== false;
  const phone = TR.api.mode === "local", nat = phone ? TR.native.status() : null, upd = phone ? TR.update?.info : null;
  const msg = route.query.get("kakao") || "";
  const redirect = st?.redirect_uri || "http://localhost:8766/oauth/kakao";
  const groups = D.watch.groups || [];
  const CAT = { approach: "접근", near: "근접", touch: "터치", confirm: "반응 확인", break: "이탈·돌파", fail: "실패(복귀)", retest: "리테스트", volume: "거래량 급증" };
  const chk = (name, on, label, extra = "") => `<label class="chk"><input type="checkbox" name="${name}"${on ? " checked" : ""}${extra}> ${label}</label>`;

  const phoneBox = `
    <details class="box" open id="phone">
      <summary class="box-h">📱 휴대폰에서 보기 <span class="pill ${st?.remote ? "ok" : "warn"}">${st?.remote ? "켜짐" : "꺼짐"}</span></summary>
      ${local ? `
        <p class="hint" style="margin-top:.4rem">휴대폰 브라우저로 이 앱을 그대로 씁니다. 맥이 켜져 있고 이 앱이 실행 중이어야 합니다. 이 맥이 아닌 기기는 접속 키가 있어야 열 수 있습니다.</p>
        <div class="row">
          <button type="button" class="btn ${st?.remote ? "" : "primary"}" data-remote="${st?.remote ? "off" : "on"}">${st?.remote ? "휴대폰 접속 끄기" : "휴대폰 접속 켜기"}</button>
          ${st?.remote ? `<button type="button" class="btn" data-rotate>접속 키 바꾸기(기존 폰 끊김)</button>` : ""}
        </div>
        <div class="qrs" data-qrs>${st?.remote ? `<p class="muted">주소 확인 중…</p>` : ""}</div>
        <ol class="steps">
          <li><b>앱으로 설치(권장)</b>: '앱으로 설치' QR을 갤럭시 카메라로 찍기 → 크롬에서 열림 → 메뉴(⋮) → <b>앱 설치</b>. 홈 화면·앱 서랍에 아이콘이 생기고 주소창 없이 열립니다. 갤럭시와 맥이 같은 Tailscale에 있으면 LTE·밖에서도 됩니다.</li>
          <li><b>바로 열기</b>: 'Tailscale' 또는 'Wi-Fi' QR — 크롬에서 열리고, 메뉴(⋮) → <b>홈 화면에 추가</b>로 바로가기를 만들 수 있습니다(주소창 보임).</li>
          <li>QR은 한 번만 찍으면 됩니다(접속 키가 1년짜리 쿠키로 저장). 맥이 켜져 있고 이 앱이 실행 중이어야 합니다.</li>
        </ol>` : `<p class="okmsg">지금 휴대폰으로 접속 중입니다. 접속 설정·카카오 연결은 맥에서 바꿀 수 있습니다.</p>
        <p class="hint">앱으로 설치: 크롬 메뉴(⋮) → <b>앱 설치</b>(HTTPS 주소일 때) 또는 <b>홈 화면에 추가</b></p>`}
    </details>`;

  // 맥 서버 화면에서: 폰 앱(APK) 받기 — android/build.sh가 dist/에 만든 최신본을 /download/Radar.apk로(접속 키가 있는 폰만)
  const ap = st?.apk, mb = ap ? `${(ap.size / 1048576).toFixed(1)}MB` : "";
  const apkBox = `
    <details class="box"${ap && !local ? " open" : ""}>
      <summary class="box-h">📲 폰 앱 — 맥 없이 동작 <span class="pill ${ap ? "ok" : ""}">${ap ? esc(ap.name.replace(/^Radar-|\.apk$/g, "")) : "빌드 전"}</span></summary>
      <p class="hint" style="margin-top:.4rem">안드로이드 폰이 직접 시세를 받고 빗각을 계산해 폰 알림을 보내는 앱입니다. 맥이 꺼져 있어도, Tailscale 없이도 동작합니다.</p>
      ${!ap ? `<p class="hint">맥 터미널에서 <code>android/build.sh</code>로 만들면 여기에 받기 버튼이 생깁니다.</p>`
        : local ? `<dl class="kv"><dt>파일</dt><dd>${esc(ap.name)} · ${mb} · ${esc(ap.built.slice(0, 16).replace("T", " "))} 빌드</dd></dl>
          <p class="hint">휴대폰의 Radar(이 화면)에서 <b>설정 → 📲 폰 앱 → APK 받기</b>를 누르세요. 접속 키가 있는 폰만 받을 수 있습니다.</p>`
        : `<div class="row"><a class="btn primary" href="/download/Radar.apk" download>APK 받기 (${mb})</a></div>
          <ol class="steps">
            <li>받기가 끝나면 알림에서 <b>열기</b> → '출처를 알 수 없는 앱'을 물으면 <b>이 출처 허용</b> → <b>설치</b>. Play 프로텍트 경고가 뜨면 <b>세부정보 → 무시하고 설치</b>(직접 만든 앱이라 구글 검사 기록이 없어서입니다).</li>
            <li>앱을 처음 열면 1~2분 동안 전 종목 데이터를 받습니다. <b>알림 허용</b>을 누르세요.</li>
            <li>앱 설정 → 📱 이 폰에서 배터리를 <b>제한 없음</b>으로 바꾸면 화면이 꺼져 있어도 제때 점검합니다.</li>
            <li>★ 관심 종목 · 알림 설정은 설치할 때 이 맥의 설정을 가져가고, 그 뒤로는 앱 안에 따로 저장됩니다. 카카오 알림과 겹치면 한쪽을 끄세요.</li>
            <li>그다음부터는 앱을 열 때 새 버전이 있으면 <b>'앱 새 버전 · 눌러서 업데이트'</b> 배너가 뜹니다. 누르면 앱 안에서 받아 설치합니다(데이터 유지).</li>
          </ol>`}
    </details>`;

  const kakaoBox = `
    <details class="box"${k.connected ? "" : " open"}>
      <summary class="box-h">💬 카카오톡 알림 <span class="pill ${k.connected ? "ok" : "warn"}">${k.connected ? "연결됨" : k.needs_reconnect ? "재연결 필요" : "미연결"}</span></summary>
      ${msg ? `<p class="${msg === "ok" ? "okmsg" : "warnmsg"}">${msg === "ok" ? "카카오 연결 완료! '테스트 보내기'로 카톡 수신을 확인하세요." : esc(msg)}</p>` : ""}
      ${k.connected ? `<dl class="kv"><dt>연결</dt><dd>${esc((k.connected_at || "").replace("T", " "))}</dd>
          <dt>토큰</dt><dd>${k.refresh_days_left != null ? `${k.refresh_days_left}일 남음 (앱이 켜져 있으면 자동 연장)` : "—"}</dd>
          <dt>최근 발송</dt><dd>${k.last_ok ? esc(k.last_ok.replace("T", " ")) : "—"}</dd></dl>` : ""}
      ${k.last_error ? `<p class="warnmsg">${esc(k.last_error)}</p>` : ""}
      <div class="row">
        ${k.has_key && local ? `<a class="btn primary" href="/oauth/kakao/start">${k.connected ? "다시 연결" : "카카오 연결"}</a>` : ""}
        ${k.connected ? `<button type="button" class="btn" data-k="test">테스트 보내기</button>` : ""}
        ${k.connected && local ? `<button type="button" class="btn" data-k="disconnect">연결 해제</button>` : ""}
      </div>
      ${local ? `<details${k.has_key ? "" : " open"}>
        <summary>${k.has_key ? "REST API 키 바꾸기 · 설정 방법" : "처음 설정하기 (5분)"}</summary>
        <ol class="steps">
          <li><a href="https://developers.kakao.com/console/app" target="_blank" rel="noopener noreferrer">Kakao Developers ↗</a>에 카카오 계정으로 로그인 → <b>애플리케이션 추가</b> (이름 예: Radar)</li>
          <li><b>앱 설정 → 앱 키</b>에서 <b>REST API 키</b>를 복사해 아래에 붙여넣고 저장</li>
          <li><b>제품 설정 → 카카오 로그인</b>: 활성화 ON, <b>Redirect URI</b>에 <code class="copy" data-copy="${esc(redirect)}">${esc(redirect)}</code> 등록</li>
          <li><b>카카오 로그인 → 동의항목</b>: <b>카카오톡 메시지 전송(talk_message)</b>을 '선택 동의'로 설정</li>
          <li><b>앱 설정 → 플랫폼 → Web</b>: 사이트 도메인에 <code class="copy" data-copy="http://localhost:8766">http://localhost:8766</code> 과 <code class="copy" data-copy="https://www.tradingview.com">https://www.tradingview.com</code> 등록 (알림을 누르면 TradingView 차트가 열림)</li>
          <li>(선택) <b>보안 → Client Secret</b>을 켰다면 그 값도 아래에 입력</li>
          <li>이 화면에서 <b>카카오 연결</b> → 카카오 로그인·동의 → 자동으로 돌아오면 끝</li>
        </ol>
        <form class="form" data-form="key" autocomplete="off">
          <label>REST API 키 <input name="rest_key" type="password" required pattern="[0-9a-f]{32}" placeholder="32자리" spellcheck="false"></label>
          <label>Client Secret <span class="muted">(선택)</span> <input name="client_secret" type="password" spellcheck="false"></label>
          <button class="btn primary" type="submit">키 저장</button>
        </form>
        <p class="hint">키와 토큰은 이 맥의 키체인(암호화)에만 저장됩니다.</p>
      </details>` : ""}
    </details>`;

  const okPill = (on, a, b) => `<span class="pill ${on ? "ok" : "warn"}">${on ? a : b}</span>`;
  const phoneAppBox = !phone ? "" : `
    <details class="box" open>
      <summary class="box-h">📱 이 폰 ${okPill(nat?.notifications && nat?.battery_unrestricted && (!A.bg_exact || nat?.exact_allowed), "준비됨", "확인 필요")}</summary>
      <p class="hint" style="margin-top:.4rem">맥 없이 이 폰이 직접 시세를 받고 빗각을 계산해 알림을 보냅니다. 화면을 꺼 두어도 정해 둔 주기마다 점검합니다.</p>
      <dl class="kv mid">
        <dt>알림 권한</dt><dd>${okPill(nat?.notifications, "허용됨", "꺼짐")} ${nat?.notifications ? "" : `<button type="button" class="btn sm" data-n="notif">허용하기</button>`}</dd>
        <dt>배터리</dt><dd>${okPill(nat?.battery_unrestricted, "제한 없음", "제한됨")} ${nat?.battery_unrestricted ? "" : `<button type="button" class="btn sm" data-n="battery">제한 풀기</button>`}</dd>
        ${A.bg_exact ? `<dt>정확한 알람</dt><dd>${okPill(nat?.exact_allowed, "허용됨", "필요")} ${nat?.exact_allowed ? "" : `<button type="button" class="btn sm" data-n="exact">허용하기</button>`}</dd>` : ""}
        <dt>점검</dt><dd>${A.bg_minutes ? `${A.bg_minutes}분마다${nat?.mode === "exact" ? "(정확히)" : "(절전, 늦어질 수 있음)"}` : "꺼짐"}${nat?.next_run ? ` · 다음 ${esc(hm(nat.next_run))}` : ""}</dd>
        <dt>마지막 점검</dt><dd>${nat?.last_bg_at ? `${esc(ago(nat.last_bg_at))}${nat.last_bg?.error ? ` · <span class="down">오류 ${esc(nat.last_bg.error)}</span>` : nat.last_bg?.busy ? " · 앱에서 스캔 중이라 건너뜀" : ` · 알림 ${nat.last_bg?.events ?? 0}건`}` : "아직 없음"}</dd>
        <dt>앱</dt><dd>${esc(nat?.web || nat?.version || "-")}${nat?.web && nat.web !== nat.version ? ` <span class="muted">(앱 ${esc(nat.version)})</span>` : ""} ${upd?.available ? `<button type="button" class="btn sm primary" data-n="upd">새 버전 ${esc(upd.latest)} 설치</button>`
          : `<span class="muted">${upd?.error ? "업데이트 확인 실패(인터넷 연결?)" : upd?.enabled === false ? "" : upd?.latest ? "최신" : ""}</span> <button type="button" class="btn sm" data-n="updcheck">업데이트 확인</button>`}</dd>
      </dl>
      ${nat?.battery_unrestricted ? "" : `<p class="hint">삼성 폰은 배터리 제한이 걸린 앱을 '절전 앱'으로 재워 알림이 늦거나 빠질 수 있습니다. '제한 풀기' → <b>제한 없음</b>을 고르세요.</p>`}
      <div class="row"><button type="button" class="btn" data-n="test">테스트 알림 보내기</button></div>
    </details>`;

  const P = A.push || {}, G = A.digest || {}, V = A.volume || {};
  const strength = Object.entries(TR.notify.STRENGTH).find(([, cats]) => Object.keys(CAT).every((c) => (P[c] !== false) === cats.includes(c)))?.[0];
  const freqBox = phone
    ? `<label>점검 주기 <select name="bg_minutes">${[[0, "끄기"], [15, "15분"], [30, "30분"], [60, "1시간"]].map(([v, l]) => `<option value="${v}"${(A.bg_minutes ?? 15) === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>
       <label class="chk"><input type="checkbox" name="bg_exact"${A.bg_exact ? " checked" : ""}> 정확한 시각에 점검 <span class="muted">(배터리 조금 더)</span></label>`
    : `<label>점검 주기 <select name="scan_minutes">${[[15, "15분"], [30, "30분"], [60, "1시간"]].map(([v, l]) => `<option value="${v}"${(A.scan_minutes ?? 15) === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>`;
  const pushBox = `
    <details class="box" open>
      <summary class="box-h">🔔 알림 — 주기 · 강도 · 대상</summary>
      <form class="form" data-form="push">
        <div class="grid2">${freqBox}</div>
        <p class="sub-h">알림 강도 <span class="muted">— 어떤 단계부터 받을지</span></p>
        <div class="seg" role="group" aria-label="알림 강도">${[["low", "약하게", "확인·이탈/돌파·리테스트만"], ["mid", "보통", "+ 터치"], ["high", "강하게", "+ 근접·접근"]].map(([v, l, d]) =>
          `<button type="button" data-strength="${v}" aria-pressed="${strength === v}" title="${d}">${l}</button>`).join("")}</div>
        <div class="chips-in">${Object.entries(CAT).filter(([c]) => c !== "volume").map(([c, l]) => chk(`push_${c}`, P[c] !== false, l)).join("")}</div>
        <p class="sub-h">즉시 알림 대상</p>
        <div class="seg" role="group">${[["fav", `★ 관심 종목만 (${(A.favorites || []).length})`], ["all", "전체 종목"]].map(([v, l]) =>
          `<label class="segl"><input type="radio" name="notify_scope" value="${v}"${(A.notify_scope || "fav") === v ? " checked" : ""}> ${l}</label>`).join("")}</div>
        <div class="grid2"><label>전체 종목일 때 최소 등급 <select name="push_min_grade">${[["S", "S만"], ["A", "A 이상"], ["B", "B 이상"]].map(([v, l]) =>
          `<option value="${v}"${(A.push_min_grade || "A") === v ? " selected" : ""}>${l}</option>`).join("")}</select></label></div>
        <p class="hint">관심 종목(★)은 등급과 관계없이 위에서 고른 종류를 모두 바로 받습니다. '관심 종목만'이면 나머지 종목은 아래 세션 요약으로 모입니다.</p>
        <p class="sub-h">나머지 종목 — 세션 요약</p>
        <div class="chips-in">${chk("dg_on", G.on, "요약 받기")}${["confirm", "break", "retest", "fail", "touch", "near"].map((c) => chk(`dg_${c}`, (G.types || []).includes(c), CAT[c])).join("")}</div>
        <div class="grid2">
          <label>요약 시각 <input name="dg_times" value="${esc((G.times || []).join(", "))}" placeholder="07:05, 09:15, 15:50"></label>
          <label>최소 등급 <select name="dg_grade">${[["S", "S만"], ["A", "A 이상"], ["B", "B 이상"]].map(([v, l]) => `<option value="${v}"${G.min_grade === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>
        </div>
        <p class="sub-h">거래량 급증(매집 후보) — 모든 종목 실시간</p>
        <div class="chips-in">${chk("vol_on", V.on !== false && P.volume !== false, "알림 받기")}${["us", "kr", "crypto"].map((g) => chk(`vg_${g}`, (V.groups || []).includes(g), GROUP[g])).join("")}</div>
        <div class="grid3">
          <label>거래량 배수 <input name="vol_ratio" type="number" step="0.5" min="1.5" max="10" value="${V.ratio ?? 3}"></label>
          <label>가격 변동 ±% <input name="vol_move" type="number" step="0.5" min="1" max="15" value="${V.max_move ?? 5}"></label>
          <label>최근 세션 <input name="vol_lb" type="number" step="1" min="1" max="5" value="${V.lookback ?? 3}"></label>
        </div>
        <p class="sub-h">공통</p>
        <div class="chips-in">${Object.keys(GROUP).map((g) => chk(`pg_${g}`, (A.push_groups || []).includes(g), GROUP[g])).join("")}</div>
        <div class="chips-in">${phone ? "" : chk("kakao", A.kakao, "카카오톡") + chk("mac_notify", A.mac_notify, "맥 알림센터")}${chk("quiet_on", A.quiet?.on, "조용한 시간(모았다가 끝나면 한 번에)")}</div>
        <span class="row"><input name="quiet_start" type="time" value="${esc(A.quiet?.start || "00:30")}" aria-label="조용한 시간 시작"> ~ <input name="quiet_end" type="time" value="${esc(A.quiet?.end || "07:00")}" aria-label="조용한 시간 끝"></span>
        <button class="btn primary" type="submit">저장</button>
      </form>
      <p class="hint">과거 재생 기준 하루 평균(관심 종목만 · 보통): 즉시 약 5건 · 세션 요약 항목 약 14건(요약 3번) · 앱에만 기록 약 32건. '전체 종목'이나 '강하게'로 바꾸면 크게 늘어납니다.</p>
    </details>`;

  const lineBox = `
    <details class="box">
      <summary class="box-h">📐 빗각 기준</summary>
      <form class="form" data-form="line">
        <div class="seg" role="group">${[["atr", "ATR 기준(권장)"], ["pct", "% 기준"]].map(([v, l]) => `<label class="segl"><input type="radio" name="mode" value="${v}"${A.mode === v ? " checked" : ""}> ${l}</label>`).join("")}</div>
        <div class="grid2">
          <label>접근 (ATR) <input name="approach_atr" type="number" step="0.1" value="${A.approach_atr}"></label>
          <label>근접 (ATR) <input name="near_atr" type="number" step="0.1" value="${A.near_atr}"></label>
          <label>터치 존 (±ATR) <input name="zone_atr" type="number" step="0.05" value="${A.zone_atr}"></label>
          <label>초기화 (ATR) <input name="reset_atr" type="number" step="0.1" value="${A.reset_atr}"></label>
          <label>접근 상한 (%) <input name="approach_cap_pct" type="number" step="0.5" value="${A.approach_cap_pct ?? 10}"></label>
          <label>근접 상한 (%) <input name="near_cap_pct" type="number" step="0.5" value="${A.near_cap_pct ?? 5}"></label>
          <label>접근 (%) <input name="approach_pct" type="number" step="0.1" value="${A.approach_pct}"></label>
          <label>근접 (%) <input name="near_pct" type="number" step="0.1" value="${A.near_pct}"></label>
          <label>터치 (%) <input name="touch_pct" type="number" step="0.1" value="${A.touch_pct}"></label>
          <label>초기화 (%) <input name="reset_pct" type="number" step="0.5" value="${A.reset_pct}"></label>
          <label>알림 최소 등급 <select name="min_quality">${[[40, "B 이상 (40점↑)"], [60, "A 이상 (60점↑)"], [75, "S만 (75점↑)"]].map(([v, l]) => `<option value="${v}"${(A.min_quality ?? 40) === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>
        </div>
        <div class="chips-in">${chk("include_auto", A.include_auto, "자동 빗각 알림")}${chk("include_user", A.include_user, "내 빗각 알림")}</div>
        <button class="btn primary" type="submit">저장</button>
      </form>
      <p class="hint">ATR 기준: 종목마다 평소 하루 변동폭(ATR 14)으로 거리를 잽니다. 지수(ATR 1%)와 알트코인(ATR 6%)을 같은 눈금으로 보기 위해서입니다. 보통 종목(ATR 2.5%)에서 접근 2ATR ≈ 5%, 근접 1ATR ≈ 2.5%. 변동성이 아주 큰 종목은 접근 10%·근접 5% 상한을 넘지 않습니다. 선 존 ±0.5ATR · 종가가 선 너머 0.5ATR이면 이탈·돌파(당신의 lynx 관례와 같음). 이탈·돌파·반응 확인은 항상 ATR 기준입니다.</p>
    </details>`;

  const U = D.universe;
  const exBy = {};
  for (const x of U?.excluded || []) { const r = x.reason.split("(")[0]; (exBy[r] = exBy[r] || []).push(x); }
  const uniBox = `
    <details class="box">
      <summary class="box-h">🗂 종목 목록 <span class="muted">${groups.reduce((a, g) => a + g.items.length, 0)}종목</span></summary>
      <p class="hint">시가총액·거래대금이 충분한 종목만 자동으로 고릅니다: 코인 상위 50(스테이블·래핑·토큰화 펀드·거래소 토큰 제외) · 미국 시총 1,000억 달러↑ · 한국 시총 10조 원↑ · 주요 지수·매크로. 매주 자동 갱신${U?.built_at ? ` · 마지막 ${esc(U.built_at.slice(0, 16).replace("T", " "))}` : ""}.</p>
      ${phone ? "" : `<div class="row"><button type="button" class="btn" data-k="universe">지금 다시 고르기(1~2분)</button>${st?.sched?.universe === "running" ? `<span class="muted">갱신 중…</span>` : ""}</div>`}
      ${Object.keys(exBy).length ? `<details><summary>제외된 후보 ${U.excluded.length}개와 이유</summary><ul class="plain">${Object.entries(exBy).sort((a, b) => b[1].length - a[1].length).map(([r, xs]) =>
        `<li><b>${esc(r)}</b> ${xs.length} — <span class="muted">${esc(xs.slice(0, 15).map((x) => x.name || x.sym).join(", "))}${xs.length > 15 ? " …" : ""}</span></li>`).join("")}</ul></details>` : ""}
      ${groups.map((g) => `<details><summary>${esc(GROUP[g.id] || g.label)} <span class="muted">${g.items.length}</span></summary><ul class="chips">${g.items.map((i) =>
        `<li>${i.auto ? "" : "✎ "}${esc(i.name)} <span class="code">${esc(i.sym)}</span><button type="button" class="x" data-rm="${esc(i.sym)}" aria-label="${esc(i.name)} 빼기">×</button></li>`).join("")}</ul></details>`).join("")}
      <form class="form grid2" data-form="add" autocomplete="off">
        <label>그룹 <select name="group">${groups.map((g) => `<option value="${esc(g.id)}">${esc(GROUP[g.id] || g.label)}</option>`).join("")}</select></label>
        <label>데이터 <select name="src"><option value="yahoo">Yahoo (미국·해외)</option><option value="naver">네이버 (한국 6자리.KS/.KQ)</option><option value="binance">Binance (코인)</option><option value="bybit">Bybit (코인)</option></select></label>
        <label>티커 <input name="sym" required placeholder="NVDA · 005930.KS · BTCUSDT" spellcheck="false"></label>
        <label>이름 <input name="name" placeholder="표시 이름"></label>
        <label>TradingView <span class="muted">(선택)</span> <input name="tv" placeholder="NASDAQ:NVDA" spellcheck="false"></label>
        <button class="btn primary" type="submit">추가</button>
      </form>
      <p class="hint">✎ = 직접 추가한 종목(자동 갱신에도 유지). 자동 종목을 빼면 다음 갱신 때도 다시 넣지 않습니다.</p>
    </details>`;

  const theme = TR.themeMode?.() || "system";
  const themeBox = `
    <div class="box themebox"><p class="box-h">🎨 화면 테마</p>
      <div class="seg" role="group" aria-label="화면 테마">${[["system", "시스템 설정"], ["light", "라이트"], ["dark", "다크"]].map(([v, l]) =>
        `<button type="button" data-theme-set="${v}" aria-pressed="${theme === v}">${l}</button>`).join("")}</div></div>`;

  const sc = st?.sched || {};
  const sysBox = `
    <details class="box">
      <summary class="box-h">⚙️ 상태</summary>
      <dl class="kv">
        <dt>${phone ? "엔진" : "서버"}</dt><dd>${phone ? "이 폰" : st ? "실행 중" : "<span class='down'>연결 안 됨</span>"}</dd>
        <dt>마지막 스캔</dt><dd>${esc(hm(D.scan?.generated_at))} (${esc(ago(D.scan?.generated_at))}) · ${esc(String(D.scan?.timing?.total ?? "—"))}s</dd>
        ${phone ? "" : `<dt>다음 스캔</dt><dd>${esc(hm(sc.next))}</dd>`}
        <dt>요약 대기</dt><dd>${st?.digest ?? 0}건 · 조용한 시간 대기 ${st?.pending ?? 0}건</dd>
        ${sc.last_error ? `<dt>오류</dt><dd class="down">${esc(sc.last_error)}</dd>` : ""}
        ${D.scan?.fetch_failed?.length ? `<dt>수집 실패</dt><dd>${esc(D.scan.fetch_failed.join(", "))}</dd>` : ""}
      </dl>
      <div class="row"><button type="button" class="btn" data-k="scan">지금 스캔 (전 종목)</button>${local && !phone ? `<button type="button" class="btn" data-k="mac">맥 알림 테스트</button>` : ""}</div>
    </details>`;

  el.innerHTML = `<section class="panel settings">${phone ? phoneAppBox : phoneBox + apkBox + kakaoBox}${pushBox}${lineBox}${uniBox}${themeBox}${sysBox}
    <p class="hint">차트 엔진: <a href="https://www.tradingview.com/" target="_blank" rel="noopener">TradingView Lightweight Charts™</a> · Apache-2.0 (js/vendor)</p></section>
    <div class="savebar" hidden role="region" aria-label="저장하지 않은 변경"><span>저장하지 않은 변경이 있어요</span><button type="button" class="btn primary" data-savebar>저장</button></div>`;

  // ---------- 동작 ----------
  const run = async (btn, fn, okMsg) => {
    if (btn) btn.disabled = true;
    try { const r = await fn(); if (okMsg) toast(typeof okMsg === "function" ? okMsg(r) : okMsg); await TR.reload(); }
    catch (e) { toast(e.message, 5000); }
    finally { if (btn) btn.disabled = false; }
  };
  el.querySelectorAll("[data-k]").forEach((b) => b.addEventListener("click", async () => {
    const a = b.dataset.k;
    if (a === "test") run(b, () => TR.api.post("/api/kakao/test"), "테스트 메시지를 보냈습니다. 카카오톡 '나와의 채팅'을 확인하세요.");
    if (a === "disconnect" && await TR.util.ask("카카오 연결을 해제할까요? 토큰이 키체인에서 삭제됩니다.", "해제")) run(b, () => TR.api.post("/api/kakao/disconnect"), "연결을 해제했습니다");
    if (a === "scan") run(b, () => TR.api.post("/api/scan", { all: true }), (r) => `스캔 완료 · ${r.seconds}s`);
    if (a === "mac") run(b, () => TR.api.post("/api/notify/test-mac"), "맥 알림을 보냈습니다 (안 보이면 시스템 설정 → 알림에서 '스크립트 편집기' 허용)");
    if (a === "universe") run(b, () => TR.api.post("/api/universe"), (r) => r.message);
  }));
  el.querySelectorAll(".copy").forEach((c) => c.addEventListener("click", () => { navigator.clipboard?.writeText(c.dataset.copy).then(() => toast("복사했습니다")); }));
  // 이 폰: 권한 · 배터리 · 테스트 알림 (설정 앱을 다녀오면 다시 그려 상태를 갱신)
  el.querySelectorAll("[data-n]").forEach((b) => b.addEventListener("click", () => {
    const a = b.dataset.n;
    if (a === "notif") TR.native.requestNotifications();
    if (a === "battery") TR.native.requestBattery();
    if (a === "exact") TR.native.requestExact();
    if (a === "upd") TR.update.install();
    if (a === "updcheck") {
      b.disabled = true;
      TR.native.checkWeb().then((w) => {                            // 화면 바로 업데이트 먼저(받았으면 다시 불러옴), 다음 APK
        if (w?.applied) return window.__radarWebUpdated(w.web);
        return TR.update.check(true).then((u) => {
          toast(!u ? "확인하지 못했습니다" : u.available ? `새 버전 ${u.latest}이 있습니다 — 위 배너를 누르세요` : (u.error || w?.error) ? "업데이트 서버에 연결하지 못했습니다 — 인터넷 연결을 확인하세요" : `최신 버전입니다 (${w?.web || u.current})`);
          TR.render();
        });
      });
    }
    if (a === "test") { TR.native.notify("📐 Radar 테스트 알림", "알림이 잘 옵니다. 빗각에 닿으면 이렇게 알려 드립니다.", ""); toast("테스트 알림을 보냈습니다"); }
  }));
  // 저장 안 한 변경: 알림 · 빗각 기준 폼을 바꾸면 아래에 '저장' 막대(맨 아래 저장 버튼을 놓치지 않게). 저장하면 화면을 새로 그려 사라진다
  const bar = el.querySelector(".savebar");
  const dirty = (f) => { f.dataset.dirty = "1"; bar.hidden = false; };
  el.querySelectorAll('form[data-form="push"], form[data-form="line"]').forEach((f) => { f.addEventListener("input", () => dirty(f)); f.addEventListener("change", () => dirty(f)); });
  bar.querySelector("[data-savebar]").addEventListener("click", () => {
    const f = el.querySelector("form[data-dirty]");
    f?.requestSubmit(f.querySelector('button[type="submit"]'));
  });
  // 알림 강도 빠른 선택 → 아래 종류 체크를 맞춤
  el.querySelectorAll("[data-strength]").forEach((b) => b.addEventListener("click", () => {
    const cats = TR.notify.STRENGTH[b.dataset.strength];
    for (const c of Object.keys(CAT)) { const box = el.querySelector(`[name="push_${c}"]`); if (box) box.checked = cats.includes(c); }
    el.querySelectorAll("[data-strength]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    dirty(b.closest("form"));
  }));
  el.querySelectorAll("[data-theme-set]").forEach((b) => b.addEventListener("click", () => TR.setTheme(b.dataset.themeSet)));

  // 휴대폰 접속: 켜기/끄기 → 서버가 바인딩을 바꾸려고 재시작 → 다시 붙으면 새로고침
  async function waitServer() {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try { await TR.api.get("/api/ping", 2000); location.reload(); return; } catch {}
    }
    toast("서버가 다시 켜지지 않았습니다. 'Radar 열기'로 다시 실행하세요.", 8000);
  }
  el.querySelector("[data-remote]")?.addEventListener("click", async (ev) => {
    const on = ev.currentTarget.dataset.remote === "on";
    ev.currentTarget.disabled = true;
    try { await TR.api.post("/api/remote", { on }); toast(on ? "휴대폰 접속을 켜는 중… (서버 재시작)" : "휴대폰 접속을 끄는 중…", 4000); waitServer(); }
    catch (e) { toast(e.message); ev.currentTarget.disabled = false; }
  });
  el.querySelector("[data-rotate]")?.addEventListener("click", async (ev) => {
    if (!(await TR.util.ask("접속 키를 바꾸면 이미 연결한 휴대폰은 QR로 다시 연결해야 합니다. 바꿀까요?", "바꾸기"))) return;
    ev.currentTarget.disabled = true;
    try { await TR.api.post("/api/remote", { on: true, rotate: true }); toast("새 접속 키로 재시작 중…"); waitServer(); } catch (e) { toast(e.message); }
  });
  const qrs = el.querySelector("[data-qrs]");
  const qrCard = (title, url, n, note = "") => {
    const full = `${url}${n.key_param}`;
    return `<figure class="qr-card">${TR.qr.svg(full, 170)}<figcaption><b>${esc(title)}</b><br><span class="code">${esc(url)}</span>${note ? `<br><span class="muted">${note}</span>` : ""}<br><button type="button" class="btn" data-copyurl="${esc(full)}">링크 복사</button></figcaption></figure>`;
  };
  function drawNet(n) {
    const ts = n.ts, cards = [];
    if (ts?.serving && ts.https_url) cards.push(qrCard("📲 앱으로 설치 (HTTPS · 어디서나)", ts.https_url, n, "크롬 ⋮ → 앱 설치"));
    if (ts?.http_url) cards.push(qrCard("Tailscale (어디서나)", ts.http_url, n, "바로가기"));
    n.lan.forEach((u) => cards.push(qrCard("Wi-Fi (같은 공유기)", u, n, "바로가기")));
    let https = "";
    if (ts && !ts.serving) {
      https = `<div class="box-in"><p><b>📲 앱으로 설치하려면 HTTPS 주소가 필요합니다</b> — Tailscale이 이 맥에 <code>https://${esc(ts.dns || "…")}</code> 주소를 만들어 줍니다(내 Tailscale 기기에서만 열림).</p>
        <div class="row"><button type="button" class="btn primary" data-serve>HTTPS 주소 켜기</button><span class="muted" data-serve-msg></span></div></div>`;
    } else if (ts?.serving) {
      https = `<p class="hint">HTTPS 주소 켜짐 · <button type="button" class="linkbtn" data-serve-off>끄기</button></p>`;
    } else if (!ts) {
      https = `<p class="hint">앱으로 설치(HTTPS)하려면 맥과 갤럭시에 <a href="https://tailscale.com/download" target="_blank" rel="noopener noreferrer">Tailscale ↗</a>을 설치하고 같은 계정으로 로그인하세요. 지금은 같은 Wi-Fi에서 바로가기로만 열 수 있습니다.</p>`;
    }
    const phones = ts?.phones?.length ? `<p class="hint">Tailscale에 연결된 휴대폰: ${ts.phones.map((p) => `${esc(p.name)} ${p.online ? "🟢" : "⚪"}`).join(", ")}</p>` : "";
    qrs.innerHTML = https + (cards.length ? cards.join("") : `<p class="warnmsg">네트워크 주소를 찾지 못했습니다. Wi-Fi 연결을 확인하세요.</p>`) + phones;
    qrs.querySelectorAll("[data-copyurl]").forEach((b) => b.addEventListener("click", () => navigator.clipboard?.writeText(b.dataset.copyurl).then(() => toast("접속 링크를 복사했습니다(키 포함 — 남에게 보내지 마세요)"))));
    qrs.querySelector("[data-serve]")?.addEventListener("click", async (ev) => {
      const b = ev.currentTarget, m = qrs.querySelector("[data-serve-msg]");
      b.disabled = true; m.textContent = "켜는 중… (최대 20초)";
      try {
        const r = await TR.api.post("/api/tailscale/serve", { on: true }, 60000);
        if (r.ok) { toast("HTTPS 주소를 켰습니다 — '앱으로 설치' QR을 찍으세요"); drawNet({ ...n, ts: r.tailscale }); return; }
        m.innerHTML = r.enable_url
          ? `Tailscale에서 HTTPS를 먼저 켜야 합니다 → <a href="${esc(r.enable_url)}" target="_blank" rel="noopener noreferrer">여기서 켜기 ↗</a> 후 다시 누르세요.`
          : `실패: ${esc((r.output || "").slice(-200))}`;
      } catch (e) { m.textContent = e.message; }
      b.disabled = false;
    });
    qrs.querySelector("[data-serve-off]")?.addEventListener("click", async () => {
      if (!(await TR.util.ask("HTTPS 주소를 끌까요? 휴대폰에 설치한 앱은 다시 켤 때까지 열리지 않습니다.", "끄기"))) return;
      try { const r = await TR.api.post("/api/tailscale/serve", { on: false }, 60000); drawNet({ ...n, ts: r.tailscale }); } catch (e) { toast(e.message); }
    });
  }
  if (qrs && st?.remote && local) {
    TR.api.get("/api/network").then(drawNet).catch((e) => { qrs.innerHTML = `<p class="warnmsg">${esc(e.message)}</p>`; });
  }

  el.querySelector('[data-form="key"]')?.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    run(e.submitter, () => TR.api.post("/api/kakao/key", { rest_key: f.get("rest_key").trim(), client_secret: f.get("client_secret").trim() }), "키를 저장했습니다. 이제 '카카오 연결'을 누르세요.");
  });
  el.querySelector('[data-form="push"]').addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target), has = (n) => f.has(n);
    const push = Object.fromEntries(Object.keys(CAT).filter((c) => c !== "volume").map((c) => [c, has(`push_${c}`)]));
    push.volume = has("vol_on");
    run(e.submitter, () => TR.api.post("/api/config", {
      push, push_groups: Object.keys(GROUP).filter((g) => has(`pg_${g}`)), notify_scope: f.get("notify_scope") || "fav", push_min_grade: f.get("push_min_grade") || "A",
      ...(phone ? { bg_minutes: +f.get("bg_minutes"), bg_exact: has("bg_exact") } : { kakao: has("kakao"), mac_notify: has("mac_notify"), scan_minutes: +f.get("scan_minutes") }),
      quiet: { on: has("quiet_on"), start: f.get("quiet_start"), end: f.get("quiet_end") },
      digest: { on: has("dg_on"), times: String(f.get("dg_times")).split(/[,\s]+/).filter(Boolean), min_grade: f.get("dg_grade"),
                types: ["confirm", "break", "retest", "fail", "touch", "near"].filter((c) => has(`dg_${c}`)), max_items: G.max_items || 15 },
      volume: { on: has("vol_on"), ratio: +f.get("vol_ratio"), max_move: +f.get("vol_move"), lookback: +f.get("vol_lb"), base_days: V.base_days || 20,
                groups: ["us", "kr", "crypto"].filter((g) => has(`vg_${g}`)) },
    }), "알림 규칙을 저장했습니다");
  });
  el.querySelector('[data-form="line"]').addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target), n = (k2) => Number(f.get(k2));
    run(e.submitter, () => TR.api.post("/api/config", {
      mode: f.get("mode"), approach_atr: n("approach_atr"), near_atr: n("near_atr"), zone_atr: n("zone_atr"), reset_atr: n("reset_atr"),
      approach_cap_pct: n("approach_cap_pct"), near_cap_pct: n("near_cap_pct"),
      approach_pct: n("approach_pct"), near_pct: n("near_pct"), touch_pct: n("touch_pct"), reset_pct: n("reset_pct"),
      min_quality: n("min_quality"), include_auto: f.has("include_auto"), include_user: f.has("include_user"),
    }), "빗각 기준을 저장했습니다");
  });
  el.querySelector('[data-form="add"]').addEventListener("submit", (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    run(e.submitter, () => TR.api.post("/api/watchlist", { action: "add", ...f }), `${f.name || f.sym} 추가 완료`);
  });
  el.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", async () => {
    if (await TR.util.ask(`${b.dataset.rm}를 목록에서 뺄까요?`, "빼기")) run(b, () => TR.api.post("/api/watchlist", { action: "remove", sym: b.dataset.rm }), "뺐습니다");
  }));
};
