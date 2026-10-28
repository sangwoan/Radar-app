// 기업 집중 뉴스(SK하이닉스 · 삼성전자 · 마이크론 · CXMT) — scripts/semi/company.py와 1:1.
// 공식 뉴스룸 + Google News 검색 RSS. 제목 키워드로 분류, 같은 사건은 묶고(개념 사전 · 글자 2-gram), 중요도 점수로 남긴다.
(function (G) {
  const TR = (G.TR = G.TR || {});
  const E = TR.semiEng, C = TR.core;
  const AUTO_CONCEPT = E.pyRe(String.raw`(20[2-3]\d)년?|(\d+(?:\.\d+)?)\s?(배|%|조)`, "g");
  const NAME_RE = E.pyRe(String.raw`(SK\s?하이닉스|하이닉스|삼성전자|삼성|SK hynix|Samsung)`, "gi");
  const SPLIT_RE = E.pyRe(String.raw`^(.*\S)\s+-\s+([^-]{2,60})$`, "s");
  const signed = (n) => (n >= 0 ? "+" : "-") + Math.abs(n);           // f"{n:+d}"

  // Google News 제목 'Title - Publisher' → [Title, Publisher]
  function splitPublisher(title) {
    const m = SPLIT_RE.exec(title);
    return m ? [m[1], E.strip(m[2])] : [title, null];
  }
  E.splitPublisher = splitPublisher;
  const norm = (t) => E.cpSlice(E.wordStrip(t.toLowerCase()), 0, 60);

  function conceptsFn(concepts) {
    const pats = Object.entries(concepts).filter(([cid]) => !cid.startsWith("_")).map(([cid, words]) => [cid, E.kwPattern(words)]);
    return (title) => {
      const found = pats.filter(([, hit]) => hit(title)).map(([cid]) => cid);
      for (const m of title.matchAll(AUTO_CONCEPT)) {
        const k = m[1] ? `y${m[1]}` : `n${m[2]}${m[3]}`;
        if (!found.includes(k)) found.push(k);
      }
      return found;
    };
  }
  function bigrams(title) {
    const t = Array.from(E.wordStrip(title.replace(NAME_RE, " ").toLowerCase())), out = [];
    for (let i = 0; i < t.length - 1; i++) { const g = t[i] + t[i + 1]; if (!out.includes(g)) out.push(g); }
    return out;
  }
  const inter = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n; };

  // 같은 사건 = (같은 분류 또는 둘 다 사업 분류 + 개념 2개↑) 또는 개념 3개↑ 또는 제목 2-gram 유사도 0.35↑
  function cluster(items, conceptsOf, businessIds) {
    const heads = [];
    for (const it of items) {
      const cs = new Set(conceptsOf(it.title)), bg = new Set(bigrams(it.title));
      let joined = false;
      for (const h of heads) {
        const sameBucket = h.category === it.category || (businessIds.has(h.category) && businessIds.has(it.category));
        const overlap = inter(cs, h._cs);
        const both = inter(bg, h._bg);
        const sim = bg.size && h._bg.size ? both / (bg.size + h._bg.size - both) : 0;
        if ((sameBucket && overlap >= 2) || overlap >= 3 || sim >= 0.35) {
          h.related.push({ title: it.title, url: it.url, source: it.source });
          h.related_count += 1;
          if (it.official && !h.official) Object.assign(h, { title: it.title, url: it.url, source: it.source, official: it.official });
          joined = true;
          break;
        }
      }
      if (!joined) heads.push({ ...it, related: [], related_count: 0, _cs: cs, _bg: bg });
    }
    for (const h of heads) { delete h._cs; delete h._bg; h.related = h.related.slice(0, 5); }
    return heads;
  }

  function tier(source, imp) {
    const src = source.toLowerCase();
    if ((imp.source_tier_a || []).some((a) => src.includes(a.toLowerCase()))) return imp.source_tier_points.a;
    if ((imp.source_tier_c || []).some((c) => src.includes(c.toLowerCase()))) return imp.source_tier_points.c;
    return 0;
  }
  function score(ctx, h, imp, businessIds, fact, opinion) {
    const reasons = [];
    let pts = imp.category[h.category] ?? 0;
    reasons.push(`분류 ${signed(pts)}`);
    if (h.official) {
      const o = businessIds.has(h.category) ? imp.official_business : imp.official_other;
      pts += o;
      reasons.push(`공식 ${signed(o)}`);
    }
    const cv = imp.coverage.find(([n]) => h.related_count >= n), cov = cv ? cv[1] : 0;
    if (cov) { pts += cov; reasons.push(`보도 ${h.related_count + 1}곳 ${signed(cov)}`); }
    const t = Math.max(tier(h.source, imp), ...h.related.map((r) => tier(r.source, imp)));
    if (t) { pts += t; reasons.push(`출처 ${signed(t)}`); }
    const age = h._ts != null ? (ctx.now / 1000 - h._ts) / 3600 : 1e9;
    const rr = imp.recency_hours.find(([limit]) => age < limit), rec = rr ? rr[1] : -2;
    if (rec) { pts += rec; reasons.push(`최신성 ${signed(rec)}`); }
    if (fact.test(h.title)) { pts += imp.fact_bonus; reasons.push(`구체적 사실 ${signed(imp.fact_bonus)}`); }
    if (opinion.test(h.title)) { pts += imp.opinion_penalty; reasons.push(`의견·질문형 ${signed(imp.opinion_penalty)}`); }
    return [pts, reasons];
  }
  const top = (rows, n = null) => { const out = E.sortDesc(rows, (h) => [h.score, h.published_at || ""]); return n == null ? out : out.slice(0, n); };

  E.mods.company = (ctx) => collectWatch(ctx, E.cfg("company_watch"), ["newsroom", "google-news"]);
  // 회사 목록(company_watch · customer_watch 같은 모양) → 회사별 뉴스. 고객사 동향(customers.js)도 이 함수를 쓴다.
  async function collectWatch(ctx, cw, sources) {
    const cats = (cw.categories || []).map((c) => [c.id, E.kwPattern(c.keywords), c.not && c.not.length ? E.kwPattern(c.not) : () => false]);
    const exclude = cw.exclude_title ? E.pyRe(cw.exclude_title, "i") : null;
    const badSources = new Set((cw.exclude_sources || []).map((s) => s.toLowerCase()));
    const cutoff = ctx.now / 1000 - (cw.max_age_days ?? 7) * 86400;
    const conceptsOf = conceptsFn(cw.concepts || {});
    const businessIds = new Set((cw.categories || []).filter((c) => c.business).map((c) => c.id));
    const imp = cw.importance;
    const fact = E.pyRe(imp.fact_pattern, "i"), opinion = E.pyRe(imp.opinion_pattern, "i");
    const dropped = {}, errors = [];
    let items = [];
    for (const comp of cw.companies || []) {
      const match = new RegExp(comp.match.map(E.reEsc).join("|"), "u");
      const notThis = comp.exclude_match && comp.exclude_match.length ? new RegExp(comp.exclude_match.map(E.reEsc).join("|"), "u") : null;
      const results = await E.pool(comp.feeds, 4, async (feed) => {
        try { return [feed, await E.fetchFeed(ctx, feed.url), null]; } catch (e) { return [feed, [], `${feed.id}:${E.ename(e)}`]; }
      });
      const seen = new Set();
      let compItems = [];
      for (const [feed, entries, err] of C.sortBy(results, (r) => [!r[0].official])) {          // 공식 뉴스룸 먼저
        if (err) errors.push(err);
        for (const [rawTitle, rawLink, d] of entries) {
          let title = E.clean(rawTitle), source = feed.name;
          const link = E.strip(rawLink || "");
          if (feed.publisher_in_title) { const [t, pub] = splitPublisher(title); title = t; source = pub || source; }
          const ts = E.parseDate(d);
          if (!title || !(link.startsWith("http://") || link.startsWith("https://")) || (ts != null && ts < cutoff)) continue;
          if (!feed.official && !match.test(title)) continue;
          if (notThis && notThis.test(title) && !/삼성전자|Samsung Electronics/.test(title)) continue;
          if ((exclude && exclude.test(title)) || badSources.has(source.toLowerCase())) continue;
          if (source === "v.daum.net") source = "다음뉴스";
          const key = norm(title);
          if (seen.has(key)) continue;
          seen.add(key);
          const cat = cats.find(([, hit, notHit]) => hit(title) && !notHit(title));
          compItems.push({ id: E.sha1(comp.id + link).slice(0, 16), company: comp.id, title, url: link, source,
            official: !!feed.official, category: cat ? cat[0] : "other", published_at: ts != null ? E.isoKst(ts) : null, _ts: ts });
        }
      }
      compItems = E.sortDesc(compItems, (n) => [n.published_at || ""]);
      const heads = cluster(compItems, conceptsOf, businessIds);
      for (const h of heads) { [h.score, h.score_reasons] = score(ctx, h, imp, businessIds, fact, opinion); delete h._ts; }
      const biz = top(heads.filter((h) => businessIds.has(h.category) && h.score >= imp.min_score));
      const other = top(heads.filter((h) => !businessIds.has(h.category) && h.score >= imp.min_score_other), imp.keep_max_other);
      let kept;
      if (comp.focus) {
        const inFocus = E.kwPattern(comp.focus.match);
        for (const h of [...biz, ...other]) h.focus = [h.title, ...h.related.map((r) => r.title)].some((t) => inFocus(t));
        kept = top([...top([...biz, ...other].filter((h) => h.focus), imp.keep_max), ...top([...biz, ...other].filter((h) => !h.focus), comp.focus.keep_other ?? 6)]);
      } else kept = top([...biz, ...other], imp.keep_max);
      items = items.concat(kept);
      dropped[comp.id] = heads.length - kept.length;
    }
    const labels = new Map();
    for (const c of cw.categories || []) if (!labels.has(c.id)) labels.set(c.id, { id: c.id, label: c.label, business: c.business ?? false });
    return ctx.envelope(items, !errors.length ? "ok" : items.length ? "partial" : "error", sources,
      errors.length ? `피드 실패: ${errors.join(", ")}` : null,
      { categories: [...labels.values(), { id: "other", label: "기타", business: false }],
        companies: (cw.companies || []).map((c) => ({ id: c.id, name: c.name, dropped: dropped[c.id] ?? 0, min_items: c.min_items ?? 5, focus_label: (c.focus || {}).label ?? null,
          group: c.group ?? null, basis: c.basis ?? null, basis_url: c.basis_url ?? null })),
        groups: cw.groups || [], top_n: imp.top_n ?? 10 });
  }
  E.collectWatch = collectWatch;
})(typeof window !== "undefined" ? window : globalThis);
