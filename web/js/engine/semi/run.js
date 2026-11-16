// 반도체 탭 수집 실행 — scripts/semi/run.py와 1:1(DMR update_all.py 순서). 실패한 모듈은 store의 이전 결과(out_<이름>)를 그대로 둔다.
// 결과 묶음 = { built_at, config{settings, tickers}, data{meta, <모듈>…} } (화면 TR.semi가 그대로 읽는 모양)
(function (G) {
  const TR = (G.TR = G.TR || {});
  const E = TR.semiEng;
  // 순서 · 의존은 run.py와 같다(자주 보는 것 먼저, 느리거나 자주 막히는 SEC · Nasdaq은 뒤). 모듈이 끝날 때마다 onModule(묶음, 끝난 수, 전체)
  E.MODULES = ["snapshot", "news", "brief", "memory", "cycle", "company", "customers", "outlook", "exports", "twrev", "capex", "consensus", "calendar"];

  E.run = async ({ net, now, store, keys = {}, only = null, log = null, onModule = null }) => {
    const ctx = E.makeCtx({ net, now, store, results: {}, keys });
    const data = {}, meta = { updated_at: ctx.iso(), modules: {} };
    const todo = E.MODULES.filter((n) => !only || only.includes(n));
    const bundle = () => ({ built_at: ctx.iso(), config: { settings: E.cfg("settings"), tickers: E.cfg("tickers") }, data: { ...data, meta } });
    for (const name of E.MODULES) {                                  // 아직 안 돈 모듈은 이전 결과로 채워 둔다
      const prev = await store.get("out_" + name, null);
      if (prev != null) data[name] = prev;
    }
    for (let k = 0; k < todo.length; k++) {
      const name = todo[k];
      let result;
      try {
        if (!E.mods[name]) throw new Error("모듈 없음");
        result = await E.mods[name](ctx);
      } catch (e) { result = ctx.envelope([], "error", [], `${E.ename(e)}: 모듈 실패`); }
      ctx.results[name] = result;
      meta.modules[name] = { status: result.status, error: result.error ?? null };
      if (!(result.status === "error" && name in data)) { await store.set("out_" + name, result); data[name] = result; }   // 실패면 이전 결과 유지
      if (log) log(`[semi:${name}] ${result.status} (${(result.items || []).length})${result.error ? " — " + result.error : ""}`);
      if (onModule) await onModule(bundle(), k + 1, todo.length);
    }
    return bundle();
  };
})(typeof window !== "undefined" ? window : globalThis);
