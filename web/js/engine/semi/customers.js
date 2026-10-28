// 고객사 동향 — scripts/semi/customers.py와 1:1. config/semi/customer_watch.json을 기업 뉴스와 같은 로직(E.collectWatch)으로 모은다.
(function (G) {
  const TR = (G.TR = G.TR || {});
  const E = TR.semiEng;
  E.mods.customers = (ctx) => E.collectWatch(ctx, E.cfg("customer_watch"), ["google-news"]);
})(typeof window !== "undefined" ? window : globalThis);
