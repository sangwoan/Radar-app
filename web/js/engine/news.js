// 종목 주요 소식 — 최근 30일 기사 중 '중요한 소식'만 고른다. 같은 규칙의 파이썬판: scripts/news.py(맥 서버 /api/news).
// 규칙(주제 점수 · 잡음 · 별칭 · 블로그)은 js/engine/news_rules.js 하나에 있고 두 쪽이 함께 읽는다.
// 1) 모으기: 구글 뉴스(한국어 · 영어) + 야후, 제목에 이 종목이 나오는 기사만, 블로그 제외
// 2) 묶기: 제목이 거의 같거나 같은 식별자(EIP-8363 · HBM4)를 4일 안에 쓴 기사는 한 소식
// 3) 점수: 주제 + 보도 매체 수 + 최근 + 주어 − 가격·시황 · 의견 · 시장 정리 (주제 2 미만 · 코인 문맥 없음 = 0)
// 4) 고르기: 4점 이상 점수순 최대 8개, 며칠 사이 몰린 낱말을 3일 안에 함께 쓴 소식은 하나로, 같은 낱말은 최대 2개 → 최신순
// 기사 본문은 가져오지 않는다(제목 · 출처 · 시각 · 링크만).
(function (G) {
  const TR = G.TR, R = TR.newsRules;
  const TTL = 30 * 60 * 1000, DAY = 86400000;
  const rx = (p) => new RegExp(p, "i");
  const TOPICS = Object.fromEntries(Object.entries(R.topics).map(([k, rows]) => [k, rows.map(([n, p, w]) => [n, rx(p), w])]));
  const KEY = R.key, NP = rx(R.noise_price), NO = rx(R.noise_opinion), NW = rx(R.noise_wrap), CTX = rx(R.crypto_ctx);
  const BLOG_S = rx(R.blog_source), BLOG_T = rx(R.blog_title), STOP = new Set(R.stop.split(/\s+/)), ALIAS = R.alias;
  const HANGUL = /[가-힣]/;
  const GENERIC = new Set(("advanced american analog applied automatic bank banco british canadian capital charles home international internet intuitive " +
                           "johnson royal southern taiwan texas union western world eli walt wells morgan philip phillips toronto progressive monster " +
                           "palo thermo general united first global digital energy bitcoin ethereum near").split(" "));
  const kind = (it) => (it.group === "crypto" ? "crypto" : it.group === "us" || it.group === "kr" ? "stock" : "other");
  const base = (sym) => sym.replace(/(USDT|USDC|-USD)$/i, "");
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const names = (it) => { const n = it.name || ""; return [n, ...ALIAS.filter(([a]) => n.includes(a)).map(([a, b]) => n.replace(a, b))]; };
  const inter = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n; };

  // ---------- 모으기 ----------
  function sources(it) {
    const gn = (q, lang) => ({ type: "rss", lang, url: `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:30d`)}&${lang === "ko" ? "hl=ko&gl=KR&ceid=KR:ko" : "hl=en-US&gl=US&ceid=US:en"}` });
    const yh = (s) => ({ type: "yahoo", lang: "en", url: `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(s)}&quotesCount=0&newsCount=12` });
    const ns = names(it), who = ns.length > 1 ? `(${ns.map((n) => `"${n}"`).join(" OR ")})` : `"${ns[0]}"`;
    if (it.group === "crypto") return [gn(`${who} (메인넷 OR 업그레이드 OR 하드포크 OR 개발 OR 업데이트 OR 테스트넷 OR 출시 OR 승인 OR 해킹)`, "ko"),
                                       gn(`"${it.en || base(it.sym)}" (mainnet OR upgrade OR "hard fork" OR testnet OR release OR developers OR launch OR approval OR hack)`, "en"),
                                       yh(`${base(it.sym)}-USD`)];
    if (it.group === "kr") return [gn(`${who} (신기술 OR 최초 OR 개발 OR 출시 OR 특허 OR 양산 OR 수주 OR 공개 OR 승인 OR 인수)`, "ko"), gn(who, "ko")];
    if (it.group === "us") return [gn(`${who} (신기술 OR 최초 OR 개발 OR 출시 OR 공개 OR 승인 OR 인수 OR AI OR 칩)`, "ko"),
                                   ...(it.en ? [gn(`"${it.en}" (technology OR launch OR unveil OR AI OR chip OR patent OR breakthrough OR acquisition OR approval)`, "en")] : []), yh(it.sym)];
    return [gn(who, "ko"), yh(it.ysym || it.sym)];
  }

  const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  const decode = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()] ?? m))
    .replace(/<[^>]+>/g, "").trim();
  const tagText = (block, tag) => { const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i")); return m ? decode(m[1]) : ""; };

  function parseRss(xml, lang) {
    const out = [];
    for (const block of xml.split(/<item>/i).slice(1)) {
      const source = tagText(block, "source");
      let title = tagText(block, "title");
      if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
      const t = Date.parse(tagText(block, "pubDate"));
      const link = tagText(block, "link");
      if (title && link) out.push({ title, link, source: source || "Google 뉴스", t: isFinite(t) ? t : null, lang });
    }
    return out;
  }
  const parseYahoo = (j) => (j.news || []).filter((x) => x.title && x.link).map((x) => ({ title: x.title, link: x.link, source: x.publisher || "Yahoo Finance",
                                                                                        t: x.providerPublishTime ? x.providerPublishTime * 1000 : null, lang: "en" }));

  // 제목에 이 종목이 나오는 기사만(검색은 본문까지 맞춰 다른 종목 기사가 섞인다). 한글 이름은 띄어쓰기 무시 포함('SK하이닉스' → '하이닉스'도),
  // 영문 이름은 단어 경계로(세 단어 이상이면 앞 두 단어, 흔한 낱말이 아니면 첫 단어도, 붙여 쓴 'JPMorgan'도), 티커는 대문자 그대로.
  function latinCands(n) {
    const w = n.toLowerCase().trim(), words = w.split(/\s+/), out = [w];
    if (words.length > 2 && /^[a-z][a-z.'-]{2,}$/.test(words[1])) out.push(`${words[0]} ${words[1]}`);
    if (words.length > 1 && words[0].length >= 4 && !GENERIC.has(words[0])) out.push(words[0]);
    return out;
  }
  function mentions(title, it) {
    const flat = title.replace(/\s+/g, ""), tflat = flat.toLowerCase(), t = ` ${title.toLowerCase()} `, ns = names(it);
    for (const n of ns.filter((x) => HANGUL.test(x))) {
      const ko = n.replace(/\s+/g, ""), tail = ko.match(/^[A-Za-z]+([가-힣]{4,}.*)$/);
      if (flat.includes(ko) || (tail && flat.includes(tail[1]))) return true;
    }
    for (const n of [it.en, ...ns.filter((x) => !HANGUL.test(x))].filter(Boolean))
      for (const c of latinCands(n)) {
        if (new RegExp(`[^a-z0-9]${esc(c)}[^a-z0-9]`).test(t)) return true;
        const nc = c.replace(/\s+/g, "");
        if (c.includes(" ") && nc.length >= 8 && tflat.includes(nc)) return true;
      }
    const tick = it.group === "crypto" ? base(it.sym) : it.sym;
    return /^[A-Z0-9]{2,6}$/.test(tick) && new RegExp(`(^|[^A-Za-z0-9])${esc(tick)}([^A-Za-z0-9]|$)`).test(title);
  }
  // 한글 이름을 글자 사이에 띄어 쓴 제목('이더 리움 스테이 킹') — 자동 생성 광고 글의 흔적
  const spaced = (title, it) => names(it).some((n) => (n.match(/[가-힣]{3,}/g) || []).some((run) => {
    const m = title.match(new RegExp([...run].join("\\s*")));
    return !!m && /\s/.test(m[0]);
  }));
  // 블로그 · 이름을 띄어 쓴 광고 글은 빼고, 제목에 이 종목이 나오는 기사만. 지수 · 원자재('금', '은')는 구글 결과를 거르지 않는다(검색어가 이미 정확한 이름)
  const keep = (x, it, s) => !(BLOG_S.test(x.source || "") || BLOG_T.test(x.title) || spaced(x.title, it)) && (s.type === "yahoo" || kind(it) !== "other" ? mentions(x.title, it) : true);

  // ---------- 중요도 ----------
  const tags = (title, k) => TOPICS[k].filter(([, re]) => re.test(title)).map(([n, , w]) => [n, w]);
  const noise = (title, k) => (NO.test(title) ? 2 : 0) + (k !== "other" ? (NP.test(title) ? 2 : 0) + (NW.test(title) ? 1 : 0) : 0);
  // 이 종목이 주어인 기사: 제목이 이름으로 시작하거나(머리말 [단독] · Exclusive: · 앞 따옴표 무시), 인용문 · 말줄임 뒤 첫머리에 이름이 오는 경우
  function subject(title, it) {
    const s = title.replace(/^\s*((\[[^\]]{1,12}\]|【[^】]{1,12}】|\([^)]{1,12}\))\s*|(exclusive|breaking|update|analysis)\s*[:\-–]\s*)+/i, "").toLowerCase();
    const flat = s.replace(/[\s"'“”‘’]/g, "");
    const tail = (it.name || "").replace(/ /g, "").match(/^[A-Za-z]+([가-힣]{4,}.*)$/), first = (it.en || "").split(" ")[0];
    const ns = [...names(it), it.en, first.length >= 4 && !GENERIC.has(first.toLowerCase()) ? first : null,
                it.group === "crypto" ? base(it.sym) : it.sym, tail ? tail[1] : null].filter((n) => n && n.length >= 2).map((n) => n.toLowerCase());
    if (ns.some((n) => flat.startsWith(n.replace(/ /g, "")))) return true;
    const head = Array.from(s).slice(0, 40).join("");
    return ns.some((n) => new RegExp(`(…|‥|⋯|\\.{2,}|["'”’]\\s)\\s*${esc(n)}([,\\s]|$)`).test(head));
  }
  function tokens(t) {
    const out = [];
    for (let w of t.split(/[^0-9A-Za-z가-힣]+/)) {
      if (!w) continue;
      if (HANGUL.test(w)) for (const p of R.particles) if (w.length > p.length + 1 && w.endsWith(p)) { w = w.slice(0, -p.length); break; }
      out.push(w);
    }
    return out;
  }
  const HYID = /(?<![A-Za-z0-9])[A-Za-z]{1,10}-[A-Za-z]?[0-9]+[A-Za-z0-9]*/g;
  // 식별자: 글자와 숫자가 섞인 3자 이상(HBM4 · S12 · 스마트태그3, 숫자+단위 '3nm' '7일' 제외)이나 zkAPI 같은 낱말
  const ident = (w) => w.length >= 3 && ((/[0-9]/.test(w) && /[A-Za-z가-힣]/.test(w) && !/^[0-9]+[A-Za-z가-힣]{0,3}$/.test(w)) || /[a-z][A-Z]{2,}/.test(w));
  const nameTokens = (it) => new Set([...names(it), it.en || "", it.group === "crypto" ? base(it.sym) : it.sym].flatMap((x) => tokens(x)).map((w) => w.toLowerCase()));
  function idset(t, nm) {
    const out = new Set([...t.matchAll(HYID)].map((m) => m[0].toLowerCase()));
    for (const w of tokens(t)) if (ident(w)) out.add(w.toLowerCase());
    for (const w of nm) out.delete(w);
    return out;
  }
  // 소식을 가르는 낱말: 식별자 + 한글 2자 이상 · 영문 4자 이상(이름 · 흔한 낱말 · 숫자+단위 제외)
  function kw(t, nm) {
    const out = idset(t, nm);
    for (const w of tokens(t)) {
      const lw = w.toLowerCase();
      if (nm.has(lw) || STOP.has(lw) || /^[0-9]+$/.test(lw)) continue;
      if ((HANGUL.test(w) && w.length >= 2 && !/^[0-9]+[가-힣]{0,3}$/.test(w)) || (/^[A-Za-z]+$/.test(w) && w.length >= 4)) out.add(lw);
    }
    return out;
  }
  function bigrams(t) {
    const s = t.toLowerCase().replace(/[^0-9a-z가-힣]+/g, ""), out = new Set();
    for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
    return out;
  }
  function ctxOk(m, it) {
    if (it.group !== "crypto") return true;
    const tick = new RegExp(`(^|[^A-Za-z0-9])${esc(base(it.sym))}([^A-Za-z0-9]|$)`);
    return m.some((x) => CTX.test(x.title) || tick.test(x.title));
  }

  // 기사 → 소식(묶음)별 점수. now는 epoch ms
  function stories(xs, it, now) {
    const k = kind(it), nm = nameTokens(it), groups = [];
    for (const x of xs.slice().sort((a, b) => (a.t || 0) - (b.t || 0))) {
      const b = bigrams(x.title), t = x.t || 0, ids = idset(x.title, nm);
      const g = groups.find((g) => { const n = inter(b, g.b); return n / Math.max(1, b.size + g.b.size - n) >= 0.33 || (inter(ids, g.ids) > 0 && Math.abs(t - g.last) <= 4 * DAY); });
      if (g) { g.m.push(x); for (const v of b) g.b.add(v); for (const v of ids) g.ids.add(v); g.last = Math.max(g.last, t); }
      else groups.push({ m: [x], b: new Set(b), ids: new Set(ids), last: t });
    }
    return groups.map((g) => {
      const m = g.m, tg = new Map();
      for (const x of m) for (const [n, w] of tags(x.title, k)) tg.set(n, Math.max(tg.get(n) || 0, w));
      const ws = [...tg.values()].sort((a, b) => b - a);
      const topic = (ws[0] || 0) + (ws.length >= 2 && ws[1] >= 2 ? 1 : 0);
      const srcs = new Set(m.map((x) => x.source));
      const cov = srcs.size >= 5 ? 3 : srcs.size >= 3 ? 2 : srcs.size >= 2 ? 1 : 0;
      const age = (now - g.last) / DAY, rec = age <= 3 ? 1 : age > 14 ? -1 : 0;
      const sub = k === "other" ? 0 : m.some((x) => subject(x.title, it)) ? 1 : -2;
      const rank = (x) => [Math.max(0, ...tags(x.title, k).map(([, w]) => w)) - noise(x.title, k) + (x.lang === "ko" ? 0.5 : 0) + (subject(x.title, it) ? 0.5 : 0), x.t || 0];
      let rep = m[0];
      for (const x of m.slice(1)) { const a = rank(x), b = rank(rep); if (a[0] > b[0] || (a[0] === b[0] && a[1] > b[1])) rep = x; }
      let score = topic + cov + rec + sub - noise(rep.title, k);
      if (topic < 2 || !ctxOk(m, it)) score = Math.min(score, 0);
      const K = new Set();
      for (const x of m) for (const w of kw(x.title, nm)) K.add(w);
      return { title: rep.title, link: rep.link, source: rep.source, t: rep.t, lang: rep.lang ?? null, last: g.last,
               tags: [...tg.keys()].sort((a, b) => tg.get(b) - tg.get(a)).slice(0, 3), score, srcs, K };
    });
  }

  // 중요 소식 고르기: 점수순, 며칠 사이 몰린 낱말을 3일 안에 함께 쓴 소식은 하나로(매체 수 합침), 같은 낱말 소식은 최대 2개
  function select(ss, th, mx) {
    const occ = new Map();
    for (const x of ss) for (const w of x.K) { if (!occ.has(w)) occ.set(w, []); occ.get(w).push(x.last); }
    const burst = new Set();
    for (const [w, list] of occ) {
      const ts = list.slice().sort((a, b) => a - b);
      if (ts.length < 2 || ts.length > 0.4 * ss.length) continue;
      if (Math.max(...ts.map((t0) => ts.filter((u) => t0 <= u && u <= t0 + 3 * DAY).length)) / ts.length >= 0.5) burst.add(w);
    }
    const out = [];
    for (const c of ss.filter((x) => x.score >= th).sort((a, b) => b.score - a.score || b.last - a.last)) {
      const sk = new Set([...c.K].filter((w) => burst.has(w)));
      const dup = out.find((x) => inter(sk, x.sk) > 0 && Math.abs(c.last - x.last) <= 3 * DAY);
      if (dup) { for (const s of c.srcs) dup.srcs.add(s); continue; }
      if ([...sk].some((w) => out.filter((x) => x.sk.has(w)).length >= 2)) continue;
      out.push({ ...c, sk, srcs: new Set(c.srcs) });
      if (out.length >= mx) break;
    }
    return out;
  }

  // 모은 기사 → 화면용 주요 소식(최신순)
  function pick(xs, it, now) {
    const k = kind(it), ss = stories(xs, it, now), sel = select(ss, R.threshold, R.max);
    const items = sel.slice().sort((a, b) => b.last - a.last).map((c) => ({ title: c.title, link: c.link, source: c.source, t: c.t, lang: c.lang, tags: c.tags,
      n: c.srcs.size, score: c.score, key: c.tags.some((t) => (KEY[k] || []).includes(t)) }));
    return { items, total: ss.length };
  }
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9가-힣]+/g, "").slice(0, 60);
  function dedupe(got) {
    const seen = new Set(), xs = [];
    for (const x of got.flat()) { const n = norm(x.title); if (n && !seen.has(n)) { seen.add(n); xs.push(x); } }
    return xs;
  }

  // 반환 { at, items: [{title, link, source, t, lang, tags, n(보도 매체 수), score, key}], total(최근 30일 소식 수), errors }
  async function get(it, store = null, force = false) {
    const ck = `news2:${it.sym}`;
    if (store && !force) {
      const hit = await store.kv(ck);
      if (hit && Date.now() - hit.at < TTL) return hit;
    }
    const errors = [];
    const got = await Promise.all(sources(it).map(async (s) => {
      try {
        const xs = s.type === "rss" ? parseRss(await TR.http.text(s.url, 15000), s.lang) : parseYahoo(await TR.http.json(s.url, 15000));
        return xs.filter((x) => keep(x, it, s));
      } catch (e) { errors.push(`${s.type}: ${e.message}`); return []; }
    }));
    const xs = dedupe(got), now = Date.now();
    const out = { at: now, ...pick(xs, it, now), errors };
    if (store && xs.length) await store.setKv(ck, out);
    return out;
  }

  TR.news = { get, sources, parseRss, parseYahoo, mentions, keep, tags, noise, subject, stories, select, pick, dedupe, KEY };
})(typeof window !== "undefined" ? window : globalThis);
