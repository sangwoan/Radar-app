// 폰 저장소 — IndexedDB(앱의 앞 화면 웹뷰와 백그라운드 웹뷰가 같은 출처라 함께 쓴다). 노드에서는 메모리로 대신한다.
// bars: 종목별 일봉 기록(scripts/fetch.py의 data/bars/<sym>.json과 같은 모양) · kv: 설정 · 종목 목록 · 내 빗각 · 상태 · 알림 기록 · 스캔 결과 · 뉴스 캐시
(function (G) {
  const TR = G.TR;
  const hasIDB = typeof indexedDB !== "undefined";
  const mem = { bars: new Map(), kv: new Map() };
  let dbp = null;

  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open("radar", 1);
    r.onupgradeneeded = () => { for (const s of ["bars", "kv"]) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  function req(store, mode, make) {
    return open().then((db) => new Promise((res, rej) => {
      const tx = db.transaction(store, mode), rq = make(tx.objectStore(store));
      tx.oncomplete = () => res(rq ? rq.result : undefined);
      tx.onerror = tx.onabort = () => rej(tx.error || new Error("저장소 오류"));
    }));
  }
  const get = (s, k) => (hasIDB ? req(s, "readonly", (o) => o.get(k)) : Promise.resolve(mem[s].get(k)));
  const put = (s, k, v) => (hasIDB ? req(s, "readwrite", (o) => o.put(v, k)) : (mem[s].set(k, v), Promise.resolve()));
  const del = (s, k) => (hasIDB ? req(s, "readwrite", (o) => o.delete(k)) : (mem[s].delete(k), Promise.resolve()));
  const keys = (s) => (hasIDB ? req(s, "readonly", (o) => o.getAllKeys()) : Promise.resolve([...mem[s].keys()]));

  // 스캔이 앞 화면과 백그라운드에서 겹치지 않게: 한 트랜잭션 안에서 읽고 쓰므로 원자적이다. ms 지나면 저절로 풀린다(도는 동안 renew로 연장).
  async function lock(name, ms) {
    const key = `lock:${name}`, now = Date.now();
    if (!hasIDB) {
      const v = mem.kv.get(key);
      if (v && v > now) return false;
      mem.kv.set(key, now + ms);
      return true;
    }
    const db = await open();
    return new Promise((res, rej) => {
      const tx = db.transaction("kv", "readwrite"), o = tx.objectStore("kv"), g = o.get(key);
      let ok = false;
      g.onsuccess = () => { if (!(g.result && g.result > now)) { o.put(now + ms, key); ok = true; } };
      tx.oncomplete = () => res(ok);
      tx.onerror = tx.onabort = () => rej(tx.error);
    });
  }

  TR.db = {
    get, put, del, keys, lock, unlock: (name) => del("kv", `lock:${name}`),
    renew: (name, ms) => put("kv", `lock:${name}`, Date.now() + ms),
    getBars: (sym) => get("bars", sym), putBars: (sym, rec) => put("bars", sym, rec), delBars: (sym) => del("bars", sym),
    kv: async (k, d = null) => { const v = await get("kv", k); return v === undefined ? d : v; },
    setKv: (k, v) => put("kv", k, v),
  };
})(typeof window !== "undefined" ? window : globalThis);
