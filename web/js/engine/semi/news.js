// 뉴스 피드 — scripts/semi/news.py와 1:1. RSS/Atom → 키워드 태그 → 같은 제목 하나만 → 최신 60개 → 톱뉴스 1개.
(function (G) {
  const TR = (G.TR = G.TR || {});
  const E = TR.semiEng, C = TR.core;
  const ALERTS = ["HBM", "ERCOT", "interconnection"];

  E.fetchFeed = async (ctx, url) => E.parseFeed(await ctx.net.get(url));

  E.mods.news = async (ctx) => {
    const fc = E.cfg("feeds"), feeds = fc.feeds || [];
    const patterns = Object.entries(E.cfg("keywords").tags || {}).map(([tag, words]) => [tag, E.kwPattern(words)]);
    const watch = [];
    for (const t of Object.values(E.cfg("tickers").tickers || {})) {
      if (t.type !== "equity") continue;
      for (const w of [t.display, t.name.split(" (")[0]]) if (E.cpLen(w) >= 3 && !watch.includes(w.toLowerCase())) watch.push(w.toLowerCase());
    }
    const nowS = Math.floor(ctx.now / 1000), cutoff = nowS - (fc.max_age_hours ?? 72) * 3600;
    const gx = fc.exclude_title ? E.pyRe(fc.exclude_title, "i") : null;
    const results = await E.pool(feeds, 6, async (feed) => {
      try { return [feed, await E.fetchFeed(ctx, feed.url), null]; } catch (e) { return [feed, [], `${feed.id}:${E.ename(e)}`]; }
    });
    let items = [];
    const seen = new Set(), errors = [];
    for (const [feed, entries, err] of results) {
      if (err) errors.push(err);
      const ex = feed.exclude ? E.pyRe(feed.exclude, "i") : null;
      for (const [rawTitle, rawLink, d] of entries) {
        const title = E.clean(rawTitle), link = E.strip(rawLink || "");
        const ts = E.parseDate(d);
        if (!title || !(link.startsWith("http://") || link.startsWith("https://")) || (ts != null && ts < cutoff)) continue;
        if ((ex && ex.test(title)) || (gx && gx.test(title))) continue;
        const key = E.wordStrip(title.toLowerCase());
        if (seen.has(key)) continue;
        let tags = patterns.filter(([, hit]) => hit(title)).map(([tag]) => tag);
        const req = feed.require_tags;
        if (req && req.length && !req.some((r) => tags.includes(r))) continue;
        if (feed.topical) tags = [...new Set([...(feed.tags || []), ...tags])];
        else if (!tags.length) continue;
        seen.add(key);
        const low = title.toLowerCase();
        const hits = ALERTS.filter((k) => low.includes(k.toLowerCase()));
        const w = watch.filter((x) => low.includes(x)).length;
        items.push({ id: E.sha1(link).slice(0, 16), title, url: link, source: feed.name, tags,
          published_at: ts != null ? E.isoKst(ts) : null, summary: null, top: false, major: false, alert: hits,
          _score: hits.length * 4 + Math.min(w, 2) * 2 + tags.length + (feed.topical ? 1 : 0) });
      }
    }
    items = E.sortDesc(items, (n) => [n.published_at || ""]);
    items = items.slice(0, fc.max_items ?? 60);
    const recent = E.isoKst(nowS - 36 * 3600);
    let cands = items.filter((n) => n.published_at && n.published_at >= recent);
    if (!cands.length) cands = items;
    if (cands.length) {
      let best = cands[0];
      for (const n of cands.slice(1)) if (C.cmpTuple([n._score, n.published_at || ""], [best._score, best.published_at || ""]) > 0) best = n;
      best.top = true;
    }
    for (const n of items) delete n._score;
    return ctx.envelope(items, !errors.length ? "ok" : items.length ? "partial" : "error", feeds.map((f) => f.id),
      errors.length ? `피드 실패: ${errors.join(", ")}` : null);
  };
})(typeof window !== "undefined" ? window : globalThis);
