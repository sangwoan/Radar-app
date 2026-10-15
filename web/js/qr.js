// QR 코드 생성(바이트 모드 · 오류정정 M · 버전 1~9, 최대 180바이트) → SVG 문자열.
// 휴대폰 접속 주소를 맥 화면에서 카메라로 찍게 하려는 최소 구현(외부 라이브러리 없이). ISO/IEC 18004 절차를 따른다.
TR.qr = (() => {
  // 오류정정 M: [전체 코드워드, 블록당 EC 코드워드, 블록 수]
  const M = [null, [26, 10, 1], [44, 16, 1], [70, 26, 1], [100, 18, 2], [134, 24, 2], [172, 16, 4], [196, 18, 4], [242, 22, 4], [292, 22, 5], [346, 26, 5]];
  const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
  const MASKS = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];

  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xff;
  }
  function rsDivisor(deg) {
    const r = new Array(deg).fill(0);
    r[deg - 1] = 1;
    let root = 1;
    for (let i = 0; i < deg; i++) {
      for (let j = 0; j < r.length; j++) {
        r[j] = gfMul(r[j], root);
        if (j + 1 < r.length) r[j] ^= r[j + 1];
      }
      root = gfMul(root, 0x02);
    }
    return r;
  }
  function rsRemainder(data, div) {
    const r = div.map(() => 0);
    for (const b of data) {
      const f = b ^ r.shift();
      r.push(0);
      div.forEach((c, i) => { r[i] ^= gfMul(c, f); });
    }
    return r;
  }

  function matrix(text) {
    const bytes = Array.from(new TextEncoder().encode(text));
    let ver = 1;
    while (ver <= 9 && 12 + bytes.length * 8 > (M[ver][0] - M[ver][1] * M[ver][2]) * 8) ver++;
    if (ver > 9) throw new Error("QR: 주소가 너무 깁니다");   // 버전 10부터는 길이 필드가 16비트라 여기선 9까지만
    const [tot, ecLen, nb] = M[ver];
    const cap = (tot - ecLen * nb) * 8;
    const bits = [];
    const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
    put(4, 4); put(bytes.length, 8); bytes.forEach((b) => put(b, 8));
    put(0, Math.min(4, cap - bits.length));
    while (bits.length % 8) bits.push(0);
    for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

    // 블록 나누기 + 오류정정 + 끼워 넣기
    const numShort = nb - (tot % nb), shortLen = Math.floor(tot / nb), div = rsDivisor(ecLen), blocks = [];
    for (let i = 0, k = 0; i < nb; i++) {
      const dat = data.slice(k, k + shortLen - ecLen + (i < numShort ? 0 : 1));
      k += dat.length;
      const ecc = rsRemainder(dat, div);
      if (i < numShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    const cw = [];
    for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - ecLen || j >= numShort) cw.push(b[i]); });

    // 기능 패턴
    const size = ver * 4 + 17;
    const mod = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, v) => { mod[y][x] = v; fn[y][x] = true; };
    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    const al = ALIGN[ver], last = al.length - 1;
    al.forEach((a, i) => al.forEach((b, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(a + dx, b + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
    const format = (mask) => {
      const dat = mask;                                   // 오류정정 M = 00
      let rem = dat;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const b = ((dat << 10) | rem) ^ 0x5412, bit = (i) => ((b >>> i) & 1) === 1;
      for (let i = 0; i <= 5; i++) set(8, i, bit(i));
      set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
      set(8, size - 8, true);
    };
    format(0);
    if (ver >= 7) {
      let rem = ver;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const b = (ver << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const v = ((b >>> i) & 1) === 1, a = size - 11 + (i % 3), c = Math.floor(i / 3);
        set(a, c, v); set(c, a, v);
      }
    }
    // 데이터 배치(지그재그)
    let bi = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
        if (!fn[y][x] && bi < cw.length * 8) { mod[y][x] = ((cw[bi >>> 3] >>> (7 - (bi & 7))) & 1) === 1; bi++; }
      }
    }
    // 마스크 고르기(벌점 최소)
    const apply = (m) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[m](x, y)) mod[y][x] = !mod[y][x]; };
    let best = 0, bestScore = Infinity;
    for (let m = 0; m < 8; m++) {
      apply(m); format(m);
      const s = penalty(mod, size);
      if (s < bestScore) { bestScore = s; best = m; }
      apply(m);
    }
    apply(best); format(best);
    return mod;
  }

  function penalty(mod, size) {
    let s = 0, dark = 0;
    const lines = [];
    for (let y = 0; y < size; y++) lines.push(mod[y].map((v) => (v ? "1" : "0")).join(""));
    for (let x = 0; x < size; x++) lines.push(mod.map((r) => (r[x] ? "1" : "0")).join(""));
    for (const ln of lines) {
      for (const run of ln.match(/0{5,}|1{5,}/g) || []) s += 3 + run.length - 5;
      let i = -1;
      while ((i = ln.indexOf("1011101", i + 1)) !== -1) {
        if (ln.slice(Math.max(0, i - 4), i) === "0000" || ln.slice(i + 7, i + 11) === "0000") s += 40;
      }
    }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (mod[y][x]) dark++;
      if (x < size - 1 && y < size - 1) { const v = mod[y][x]; if (mod[y][x + 1] === v && mod[y + 1][x] === v && mod[y + 1][x + 1] === v) s += 3; }
    }
    s += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
    return s;
  }

  function svg(text, px = 220) {
    const m = matrix(text), n = m.length, q = 4;
    let d = "";
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) d += `M${x + q} ${y + q}h1v1h-1z`;
    return `<svg class="qr" viewBox="0 0 ${n + q * 2} ${n + q * 2}" width="${px}" height="${px}" shape-rendering="crispEdges" role="img" aria-label="QR 코드"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }
  return { svg, matrix };
})();
