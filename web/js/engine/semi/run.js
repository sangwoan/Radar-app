// 반도체 탭 수집 실행 — scripts/semi/run.py와 1:1(DMR update_all.py 순서). 실패한 모듈은 store의 이전 결과(out_<이름>)를 그대로 둔다.
// 결과 묶음 = { built_at, config{settings, tickers}, data{meta, <모듈>…} } (화면 TR.semi가 그대로 읽는 모양)
(function (G) {
  const TR = (G.TR = G.TR || {});
  const E = TR.semiEng;
  E.MODULES = ["snapshot", "news", "consensus", "calendar", "memory", "cycle", "company", "outlook", "capex", "twrev", "exports", "brief"];

  E.run = async ({ net, now, store, keys = {}, only = null, log = null }) => {
    const ctx = E.makeCtx({ net, now, store, results: {}, keys });
    const data = {}, meta = { updated_at: ctx.iso(), modules: {} };
    for (const name of E.MODULES) {
      const prev = await store.get("out_" + name, null);
      if (only && !only.includes(name)) { if (prev != null) data[name] = prev; continue; }
      let result;
      try {
        if (!E.mods[name]) throw new Error("모듈 없음");
        result = await E.mods[name](ctx);
      } catch (e) { result = ctx.envelope([], "error", [], `${E.ename(e)}: 모듈 실패`); }
      ctx.results[name] = result;
      meta.modules[name] = { status: result.status, error: result.error ?? null };
      if (result.status === "error" && prev != null) data[name] = prev;          // 이전 결과 유지, meta에만 기록
      else { await store.set("out_" + name, result); data[name] = result; }
      if (log) log(`[semi:${name}] ${result.status} (${(result.items || []).length})${result.error ? " — " + result.error : ""}`);
    }
    data.meta = meta;
    return { built_at: ctx.iso(), config: { settings: E.cfg("settings"), tickers: E.cfg("tickers") }, data };
  };
})(typeof window !== "undefined" ? window : globalThis);
