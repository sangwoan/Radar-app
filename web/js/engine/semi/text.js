// 반도체 수집 공통 글 처리(폰 엔진) — scripts/semi/text.py와 1:1(정규식 · 규칙을 똑같이 둔다).
// 글자 단위는 코드 포인트(파이썬 str): 길이 · 자르기는 cp* 도구로. 공백은 파이썬 str.isspace()와 같은 집합(WS).
(function (G) {
  const TR = (G.TR = G.TR || {});
  const E = (TR.semiEng = TR.semiEng || { mods: {} });

  const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", hellip: "…",
    ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
    laquo: "«", raquo: "»", copy: "©", reg: "®", trade: "™", bull: "•", deg: "°",
    times: "×", divide: "÷", euro: "€", pound: "£", yen: "¥", cent: "¢", sect: "§",
    para: "¶", shy: "­" };
  const XML_ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  const ENT_RE = /&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z]{2,8});/g;
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  // 파이썬 str.isspace() 집합(JS \s와 달리 \x1c-\x1f · \x85 포함, ﻿ 제외)
  const WS = "\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
  const WS_RUN = new RegExp(`[${WS}]+`, "g"), WS_EDGE = new RegExp(`^[${WS}]+|[${WS}]+$`, "g");
  const strip = (s) => String(s ?? "").replace(WS_EDGE, "");
  const squash = (s) => strip(String(s ?? "").replace(WS_RUN, " "));     // re.sub(r"\s+", " ", s).strip()

  // 코드 포인트 기준 길이 · 자르기 · 정규식 위치(파이썬 m.start())
  const cpLen = (s) => Array.from(s).length;
  const cpSlice = (s, a, b) => Array.from(s).slice(a, b).join("");
  const cpIndex = (s, cu) => Array.from(s.slice(0, cu)).length;

  function code(ref) {
    const n = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    if (!isFinite(n)) return null;
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : null;
  }
  function unescape(s, table = ENT) {
    return String(s ?? "").replace(ENT_RE, (m0, ref) => {
      const v = ref[0] === "#" ? code(ref) : own(table, ref) ? table[ref] : null;
      return v == null ? m0 : v;
    });
  }
  const stripTags = (s) => String(s ?? "").replace(/<[^>]+>/g, "");
  const clean = (t) => squash(unescape(stripTags(t)));

  function xmlText(inner) {
    let out = "", pos = 0;
    for (const m of inner.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)) {
      out += unescape(inner.slice(pos, m.index), XML_ENT) + m[1];
      pos = m.index + m[0].length;
    }
    return out + unescape(inner.slice(pos), XML_ENT);
  }
  function tag(block, name) {
    const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(block);
    return m ? xmlText(m[1]) : null;
  }
  // RSS item · Atom entry → [[title, link, date]] (items 먼저, 그다음 entries)
  function parseFeed(xml) {
    const out = [];
    for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)) {
      const b = m[1];
      out.push([tag(b, "title"), tag(b, "link"), tag(b, "pubDate") || tag(b, "dc:date")]);
    }
    for (const m of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/g)) {
      const b = m[1], h = /<link\b[^>]*?\bhref="([^"]*)"/.exec(b);
      out.push([tag(b, "title"), h ? unescape(h[1], XML_ENT) : null, tag(b, "published") || tag(b, "updated")]);
    }
    return out;
  }

  const MON = Object.fromEntries(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].map((m, i) => [m, i + 1]));
  const ZONES = { GMT: 0, UT: 0, UTC: 0, Z: 0, EST: -5, EDT: -4, CST: -6, CDT: -5, MST: -7, MDT: -6, PST: -8, PDT: -7 };
  const RFC = /^(?:[A-Za-z]{3},?\s*)?([0-9]{1,2})\s+([A-Za-z]{3})[A-Za-z]*\.?\s+([0-9]{2,4})\s+([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?\s*([+-][0-9]{4}|[A-Za-z]{1,5})?/;
  const ISO = /^([0-9]{4})-([0-9]{2})-([0-9]{2})(?:[T ]([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\.[0-9]+)?)?)?\s*(Z|[+-][0-9]{2}:?[0-9]{2})?$/;
  const leap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const mdays = (y, m) => [31, leap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

  function zone(z) {                       // 분 단위 UTC 차이, 모르면 null(→ KST)
    if (!z) return null;
    if (z[0] === "+" || z[0] === "-") {
      const d = z.slice(1).replace(/:/g, ""), mins = +d.slice(0, 2) * 60 + (+d.slice(2, 4) || 0);
      return z[0] === "+" ? mins : -mins;
    }
    const h = ZONES[z.toUpperCase()];
    return h == null ? null : h * 60;
  }
  // datetime(...)가 ValueError를 내는 값이면 null
  function epoch(y, mo, d, hh, mm, ss, off) {
    if (y < 1 || y > 9999 || mo < 1 || mo > 12 || d < 1 || d > mdays(y, mo) || hh > 23 || mm > 59 || ss > 59) return null;
    const ms = Date.UTC(y, mo - 1, d, hh, mm, ss) - (off == null ? 540 : off) * 60000;
    return Math.floor(ms / 1000);
  }
  // → epoch 초(정수) 또는 null
  function parseDate(s) {
    s = strip(s);
    if (!s) return null;
    let m = RFC.exec(s);
    if (m) {
      const mon = m[2].toLowerCase();
      if (!own(MON, mon)) return null;
      let y = +m[3];
      if (y < 100) y += y > 68 ? 1900 : 2000;
      return epoch(y, MON[mon], +m[1], +m[4], +m[5], +(m[6] || 0), zone(m[7]));
    }
    m = ISO.exec(s);
    if (m) return epoch(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), zone(m[7]));
    return null;
  }
  const isoKst = (sec) => E.isoKST(sec * 1000);

  // SHA-1(UTF-8) 16진수 — 동기(WebCrypto는 비동기라 직접 계산)
  function sha1(str) {
    const b = Array.from(new TextEncoder().encode(str)), l = b.length * 8;
    b.push(0x80);
    while (b.length % 64 !== 56) b.push(0);
    for (let i = 7; i >= 0; i--) b.push(i >= 4 ? 0 : (l >>> (i * 8)) & 0xff);
    let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
    const w = new Array(80);
    for (let o = 0; o < b.length; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = (b[o + 4 * i] << 24) | (b[o + 4 * i + 1] << 16) | (b[o + 4 * i + 2] << 8) | b[o + 4 * i + 3];
      for (let i = 16; i < 80; i++) { const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]; w[i] = (x << 1) | (x >>> 31); }
      let a = h0, bb = h1, c = h2, d = h3, e = h4;
      for (let i = 0; i < 80; i++) {
        const f = i < 20 ? (bb & c) | (~bb & d) : i < 40 ? bb ^ c ^ d : i < 60 ? (bb & c) | (bb & d) | (c & d) : bb ^ c ^ d;
        const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6;
        const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) | 0;
        e = d; d = c; c = (bb << 30) | (bb >>> 2); bb = a; a = t;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + bb) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
    }
    return [h0, h1, h2, h3, h4].map((v) => (v >>> 0).toString(16).padStart(8, "0")).join("");
  }

  // urllib.parse.quote(s, safe="/") — 영숫자 · _.-~ 와 safe만 그대로
  const quote = (s, safe = "/") => Array.from(new TextEncoder().encode(String(s)))
    .map((b) => { const c = String.fromCharCode(b); return /[A-Za-z0-9_.~-]/.test(c) || (b < 128 && safe.includes(c)) ? c : "%" + b.toString(16).toUpperCase().padStart(2, "0"); }).join("");

  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  // 짧은 영문 대문자 약어(AI · GPU …)는 대소문자 구분 + 앞뒤 영문자 아님, 나머지는 대소문자 무시 부분 일치
  function kwPattern(words) {
    const isAbbr = (w) => /^[A-Z0-9]{2,5}$/.test(w);
    const abbr = words.filter(isAbbr).map(reEsc), rest = words.filter((w) => !isAbbr(w)).map(reEsc);
    const pats = [];
    if (abbr.length) pats.push(new RegExp(`(?<![A-Za-z])(?:${abbr.join("|")})(?![A-Za-z])`, "u"));
    if (rest.length) pats.push(new RegExp(rest.join("|"), "iu"));
    return (text) => pats.some((p) => p.test(text));
  }
  const wordStrip = (s) => s.replace(/[^\p{L}\p{N}]+/gu, "");      // re.sub(r"[\W_]+", "", s)

  // format(v, "+,.{d}f") — 파이썬처럼 정확히 가운데는 짝수 쪽(pyRound), -0도 부호 유지
  function fmt(v, d, sign = false, comma = false) {
    const neg = v < 0 || Object.is(v, -0);
    let body = TR.core.pyRound(Math.abs(v), d).toFixed(d);
    if (comma) { const [i, f] = body.split("."); body = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f != null ? "." + f : ""); }
    return (neg ? "-" : sign ? "+" : "") + body;
  }
  // 설정 파일의 파이썬 정규식 → JS(u 플래그). \b · \d · \w를 파이썬의 유니코드 뜻으로 바꾼다(JS는 ASCII 뜻이라
  // 'students은'처럼 영문 뒤에 한글이 붙으면 결과가 갈림). 문자 집합 안은 \d · \w만 바꾼다.
  const W = "\\p{L}\\p{N}_";
  const BOUND = `(?:(?<=[${W}])(?![${W}])|(?<![${W}])(?=[${W}]))`, NBOUND = `(?:(?<=[${W}])(?=[${W}])|(?<![${W}])(?![${W}]))`;
  function pyRe(src, flags = "") {
    let out = "", inClass = false;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (c === "\\" && i + 1 < src.length) {
        const n = src[++i];
        if (!inClass && n === "b") out += BOUND;
        else if (!inClass && n === "B") out += NBOUND;
        else if (n === "d") out += "\\p{Nd}";
        else if (n === "D" && !inClass) out += "\\P{Nd}";
        else if (n === "w") out += inClass ? W : `[${W}]`;
        else if (n === "W" && !inClass) out += `[^${W}]`;
        else out += "\\" + n;
        continue;
      }
      if (c === "[" && !inClass) inClass = true;
      else if (c === "]" && inClass) inClass = false;
      out += c;
    }
    return new RegExp(out, flags.includes("u") ? flags : flags + "u");
  }

  // 파이썬 float(v): 숫자는 그대로, 글자는 앞뒤 공백을 떼고 숫자 모양일 때만(아니면 오류)
  function pyFloat(v) {
    if (typeof v === "number") return v;
    if (typeof v !== "string") throw new Error("float");
    const s = strip(v).replace(/_/g, "");
    if (!/^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?$/.test(s)) throw new Error(`float: ${v}`);
    return Number(s);
  }
  // 파이썬 str(float) / repr(float)(정수값이면 '.0'을 붙임)
  const pyStr = (v) => (Number.isInteger(v) && Math.abs(v) < 1e16 ? `${v}.0` : String(v));

  Object.assign(E, { ENT, XML_ENT, WS, strip, squash, cpLen, cpSlice, cpIndex, unescape, stripTags, clean, parseFeed, parseDate, isoKst,
    sha1, quote, reEsc, kwPattern, wordStrip, fmt, pyStr, pyFloat, pyRe });
})(typeof window !== "undefined" ? window : globalThis);
