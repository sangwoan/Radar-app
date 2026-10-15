// 뉴스 중요도 규칙 — 주제 점수 · 잡음(가격·시황 · 의견) · 코인 문맥 · 별칭 · 블로그 · 묶기용 낱말.
// js/engine/news.js(폰)와 scripts/news.py(맥 서버)가 이 파일 하나를 함께 읽는다(파이썬은 아래 JSON 표시 주석 사이를 json으로 읽음).
// 정규식은 파이썬 re와 JS RegExp가 똑같이 읽는 문법만 쓴다: \b 대신 (?<![A-Za-z0-9_]) · (?![A-Za-z0-9_]), \d 대신 [0-9], 대소문자 무시,
// 뒤돌아보기(lookbehind)는 길이가 고정된 것만. 고친 뒤에는 python3 -m unittest tests.test_news(두 쪽 결과 비교)를 돌린다.
(function (G) {
  (G.TR = G.TR || {}).newsRules = /*JSON*/{
 "threshold": 4,
 "max": 8,
 "alias": [
  [
   "POSCO",
   "포스코"
  ],
  [
   "NAVER",
   "네이버"
  ],
  [
   "S-Oil",
   "에쓰오일"
  ],
  [
   "LS ELECTRIC",
   "LS일렉트릭"
  ]
 ],
 "blog_source": "블로그|blog|티스토리|tistory|브런치|brunch|카페|(?<![A-Za-z0-9_])cafe",
 "blog_title": ":\\s*(네이버 블로그|티스토리|브런치)\\s*$",
 "topics": {
  "crypto": [
   [
    "메인넷",
    "메인넷|mainnet",
    3
   ],
   [
    "업그레이드",
    "업그레이드|하드\\s?포크|hard\\s?fork|upgrade|(?<![A-Za-z0-9_])(EIP|BIP|SIMD)-?[0-9]+",
    3
   ],
   [
    "승인",
    "승인|허가|인가|approv",
    3
   ],
   [
    "개발",
    "테스트넷|testnet|devnet|데브넷|개발|developer|로드맵|roadmap|릴리스|(?<![A-Za-z0-9_])release|프로토콜|protocol|레이어\\s?2|(?<![A-Za-z0-9_])L2(?![A-Za-z0-9_])|롤업|rollup|(?<![A-Za-z0-9_])zk|영지식|검증자|validator|스케일링|scaling|암호학|cryptograph|깃허브|github|(?<![A-Za-z0-9_])core(?![A-Za-z0-9_])|라이트닝|lightning|소프트웨어|software|패치|(?<![A-Za-z0-9_])patch|노드|(?<![A-Za-z0-9_])nodes?(?![A-Za-z0-9_])",
    2
   ],
   [
    "출시",
    "출시|런칭|론칭|(?<![A-Za-z0-9_])launch|(?<!비)공개|unveil|introduc|도입",
    2
   ],
   [
    "상장",
    "상장(?!지수)|listing|(?<![A-Za-z0-9_])list(s|ed)(?![A-Za-z0-9_])",
    2
   ],
   [
    "보안",
    "해킹|(?<![A-Za-z0-9_])hack|exploit|취약점|도난|stolen|breach|(?<![A-Za-z0-9_])attack",
    2
   ],
   [
    "인수",
    "인수|합병|acqui|merger",
    2
   ],
   [
    "ETF",
    "(?<![A-Za-z0-9_])ETF",
    1
   ],
   [
    "규제",
    "규제|(?<![A-Za-z0-9_])SEC(?![A-Za-z0-9_])|regulat|법안|소송|lawsuit|판결|ruling|(?<![A-Za-z0-9_])CFTC",
    1
   ],
   [
    "제휴",
    "파트너십|partnership|제휴|협력|채택|(?<![A-Za-z0-9_])adopt|통합|integrat",
    1
   ]
  ],
  "stock": [
   [
    "신기술",
    "신기술|최초|차세대|혁신|breakthrough|first-ever|world'?s first|new technology|innovation",
    3
   ],
   [
    "승인",
    "승인|허가|approv|(?<![A-Za-z0-9_])FDA(?![A-Za-z0-9_])|임상|clinical",
    3
   ],
   [
    "인수",
    "인수|합병|acqui|merger|(?<![A-Za-z0-9_])M&A",
    3
   ],
   [
    "출시",
    "출시|(?<!기준 )(?<!정보 )(?<!명단 )(?<!결과 )(?<!내역 )(?<!비)공개|선보|(?<!실적)(?<!실적 )발표|(?<![A-Za-z0-9_])launch|unveil|introduc|debut|신제품|(?<![A-Za-z0-9_])release",
    2
   ],
   [
    "개발",
    "개발|develop|R&D|연구(?!원)|양산(?=\\s?(돌입|개시|시작|체제|라인|성공|계획|착수|준비|공급|물량|단계|적용|확대))|본격\\s?양산|대량\\s?양산|양산형|mass production|시제품|prototype",
    2
   ],
   [
    "특허",
    "특허|patent",
    2
   ],
   [
    "수주",
    "수주|계약|contract|(?<![A-Za-z0-9_])deal(?![A-Za-z0-9_])|공급\\s?(계약|협약|확대|개시|시작|합의)|(단독|독점)\\s?공급|공급(?=한다|키로|하기로)|supply (deal|agreement|contract)|to supply|(?<![A-Za-z0-9_])orders?(?![A-Za-z0-9_])",
    2
   ],
   [
    "제휴",
    "파트너십|partnership|제휴|협력|협업|collaborat|(?<![A-Za-z0-9_])MOU(?![A-Za-z0-9_])",
    1
   ],
   [
    "실적",
    "실적|earnings|매출|revenue|영업이익|guidance|어닝",
    1
   ],
   [
    "AI·반도체",
    "(?<![A-Za-z0-9_])AI(?![A-Za-z0-9_])|인공지능|GPU|HBM|반도체|(?<![A-Za-z0-9_])chips?(?![A-Za-z0-9_])|파운드리|foundry",
    1
   ]
  ],
  "other": [
   [
    "정책",
    "금리\\s?(결정|인하|인상|동결)|FOMC|연준|(?<![A-Za-z0-9_])Fed(?![A-Za-z0-9_])|기준금리|rate (cut|hike)|OPEC|감산|증산|중앙은행|central bank|(?<![A-Za-z0-9_])(BOJ|ECB)(?![A-Za-z0-9_])|한국은행",
    3
   ],
   [
    "지표",
    "(?<![A-Za-z0-9_])(CPI|PCE|GDP|PMI)(?![A-Za-z0-9_])|고용|payroll|물가|inflation|실업|unemployment",
    2
   ],
   [
    "지정학",
    "관세|tariff|제재|sanction|전쟁|(?<![A-Za-z0-9_])war(?![A-Za-z0-9_])|휴전|ceasefire|지정학",
    2
   ]
  ]
 },
 "key": {
  "crypto": [
   "메인넷",
   "업그레이드",
   "개발"
  ],
  "stock": [
   "신기술",
   "출시",
   "개발",
   "특허",
   "승인"
  ],
  "other": [
   "정책"
  ]
 },
 "noise_price": "가격|시세|주가|급등|급락|상승세|하락세|강세|약세|랠리|반등|신고가|최고가|최저가|목표\\s?주?가|지지선|저항선|돌파(?!구)|[0-9]+만\\s*([0-9]+천\\s*)?달러|\\$[0-9]{1,3}(,[0-9]{3})+(?!\\s*(billion|million))|\\$[0-9]+(\\.[0-9]+)?[kK](?![A-Za-z0-9_])|(?<![A-Za-z0-9_])price|predict|forecast|(?<![A-Za-z0-9_])(surges?|soars?|plunges?|tumbles?|rally|rallies|jumps?|slips?|nears|climbs?|sinks?|rebound(s|ed|ing)?|recover(s|y|ed|ing)?)(?![A-Za-z0-9_])|outlook|technical analysis|analyst|(?<![A-Za-z0-9_])rating(?![A-Za-z0-9_])|downgrade|(?<![A-Za-z0-9_])target(?![A-Za-z0-9_])|자금\\s?(유입|유출|이탈)|inflows?|outflows?|폭등|폭락|출고가|[0-9][0-9,.]*\\s?달러\\s?(선|대|서|를|에|까지|회복|돌파|붕괴|아래|위)|bull run|bullish|bearish|강세장|약세장|불장",
 "noise_opinion": "should you|buy now|to buy|too late|here'?s why|what to know|[0-9]+ (stocks|coins|cryptos|altcoins)|(?<![A-Za-z0-9_])top [0-9]+|(?<![A-Za-z0-9_])best(?![A-Za-z0-9_])|관련주|수혜주|추천|[?？]\\s*$|price prediction|price analysis|price forecast|가격 예측|가격 전망|remittix|알공|뉴스\\s?모음|주요 뉴스|헤드라인|headlines|roundup|wrap-up|\\[[^\\]]*(브리핑|종합|모음)[^\\]]*\\]|성과급|임금|임단협|노조|파업|연봉|보너스|(?<![A-Za-z0-9_])bonus|노동자|교섭|presale|프리세일|^\\s*crypto news\\s*:",
 "noise_wrap": "코스피|코스닥|증시|(?<![A-Za-z0-9_])(daily|weekly|recap|morning)(?![A-Za-z0-9_])|오늘의|이번 주|주간|브리핑|briefing|마감|장중|특징주|시황",
 "crypto_ctx": "블록체인|코인|토큰|가상자산|암호화폐|디파이|거래소|지갑|네트워크|체인|메인넷|테스트넷|업그레이드|하드포크|스테이킹|검증자|노드|레이어|재단|ETF|blockchain|crypto|(?<![A-Za-z0-9_])coin|token|defi|(?<![A-Za-z0-9_])nft|web3|wallet|exchange|network|chain|mainnet|testnet|upgrade|fork|staking|validator|(?<![A-Za-z0-9_])nodes?(?![A-Za-z0-9_])|protocol|ledger|layer|(?<![A-Za-z0-9_])L[12](?![A-Za-z0-9_])|rollup|dapp|smart contract|transaction|finality|(?<![A-Za-z0-9_])TPS(?![A-Za-z0-9_])|foundation",
 "particles": [
  "에서",
  "으로",
  "까지",
  "부터",
  "에게",
  "은",
  "는",
  "이",
  "가",
  "을",
  "를",
  "의",
  "에",
  "로",
  "와",
  "과",
  "도",
  "만",
  "서"
 ],
 "stop": "출시 공개 개발 신규 확대 강화 추진 예정 발표 기술 서비스 시장 투자 지원 협력 글로벌 차세대 최초 신제품 제품 기업 국내 해외 미국 중국 한국 일본 유럽 세계 올해 내년 이번 최대 최고 역대 전격 본격 기반 위한 통해 관련 대한 업계 업그레이드 메인넷 테스트넷 네트워크 반도체 인공지능 수주 계약 단독 속보 종합 코인 가상자산 암호화폐 블록체인 with from that this will into over after amid ahead about more than their they says said launch launches launched unveil unveils unveiled first upgrade upgrades update updates mainnet testnet network release releases released developer developers plans plan report reports could would chip chips stock stocks shares company market price crypto token tokens blockchain foundation global record deal billion million year week today news exclusive what when where which while your have been just also next other team users data support platform"
}/*END*/;
})(typeof window !== "undefined" ? window : globalThis);
