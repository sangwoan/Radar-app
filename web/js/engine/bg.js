// 백그라운드 점검(bg.html): 장이 열린 시장(코인은 늘)만 새로 받아 스캔하고 알림을 보낸 뒤 네이티브에 끝을 알린다.
// 앱을 처음 열어 전 종목 데이터를 받기(첫 동기화) 전에는 아무것도 하지 않는다. 앞 화면이 스캔 중이면 엔진 잠금으로 건너뛴다.
(async (G) => {
  const TR = G.TR, t0 = Date.now();
  let out;
  try {
    await TR.engine.bootstrapDefaults();
    if (!(await TR.db.kv("scan"))) out = { skipped: "first-sync" };
    else {
      const r = await TR.engine.scan({ mode: "active", notify: true });
      out = r.busy ? { busy: true } : { events: r.events.length, errors: r.errors.length, failed: r.fetch_failed.length, seconds: r.timing.total };
    }
  } catch (e) {
    out = { error: `${e.name}: ${e.message}` };
  }
  out.ms = Date.now() - t0;
  TR.native.log(`bg ${JSON.stringify(out)}`);
  TR.native.bgDone(out);
})(window);
