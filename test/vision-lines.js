/*
 * Google Vision 조각 → 보정 대상 글자 줄(visionLinesToTargets) 검사.
 *
 * 배경: 보정 화면은 글자 위치를 Tesseract 전체 스캔으로 잡았는데, 한글 간판 사진(푸른하늘서점)에서
 * "| Pureun Haneul Bookstore 1 해"·"A 푸른) 책하늘서점" 같은 깨진 줄과, 화면 절반 폭의 상자
 * (칠판 줄이 아이 둘 사이까지 55%)가 대상이 됐다. 이제 Vision이 준 조각을 같은 줄끼리 이어 붙여 쓴다.
 * Vision 응답은 실제 사진(2000x1092)에서 받은 것을 그대로 고정해 두었다 — 네트워크·비용 없음.
 *
 * 사용법: 이 폴더(test)에서 → node vision-lines.js   (프런트가 8000 또는 BASE_URL에서 돌고 있어야 함)
 */
const { chromium } = require('playwright');
const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

// [글자, x0, y0, x1, y1] — 푸른하늘서점 사진(2000x1092)에 Vision TEXT_DETECTION을 돌린 실제 응답
const 서점 = [
  ['HOSIS', 536, 744, 564, 750], ['푸른', 569, 78, 893, 232], ['하늘', 910, 78, 1231, 232], ['서점', 1245, 78, 1555, 232],
  ['푸른', 916, 249, 993, 289], ['책', 1023, 249, 1058, 289], ['하늘', 1069, 249, 1148, 289], ['서점', 1150, 249, 1226, 289],
  ['서', 780, 578, 786, 583], ['티비', 751, 614, 768, 623], ['포간', 774, 614, 795, 623], ['히', 796, 614, 805, 623],
  ['Pureun', 872, 368, 980, 393], ['Haneul', 991, 368, 1097, 393], ['Bookstore', 1105, 368, 1258, 393],
  ['서점', 1002, 414, 1034, 433], ['(', 1043, 414, 1049, 433], ['Bookstore', 1051, 413, 1141, 434], [')', 1141, 415, 1148, 434],
  ['푸른', 1345, 465, 1399, 492], ['하늘', 1408, 465, 1462, 492], ['서점', 1463, 465, 1514, 492],
  ['크', 1413, 807, 1433, 821], ['하느', 1436, 807, 1482, 822], ['서저', 1486, 808, 1530, 823],
  ['오늘', 1444, 844, 1482, 869], ['의', 1481, 844, 1503, 869], ['추천', 1445, 876, 1487, 904], ['도서', 1492, 876, 1531, 903], [':', 1530, 876, 1540, 903],
  ['하늘', 1445, 916, 1487, 943], ['을', 1484, 916, 1504, 942], ['나는', 1509, 916, 1550, 942], ['책방', 1496, 953, 1551, 986],
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(800);

  const run = (fn, arg) => page.evaluate(fn, arg);
  const lines = await run((서점) => {
    const T = window.__anshimTest;
    const words = T.visionWordsToPct(서점.map(([text, x0, y0, x1, y1]) => ({ text, x0, y0, x1, y1 })), 2000, 1092);
    const claude = [{ text: '푸른하늘서점', type: '상호명' }, { text: 'Pureun Haneul Bookstore', type: '영문 간판' }];
    return T.visionLinesToTargets(words, claude);
  }, 서점);
  const by = (re) => lines.filter((l) => re.test(l.text));
  const texts = lines.map((l) => l.text);
  console.log('만들어진 줄 (' + lines.length + '개): ' + texts.join(' | '));

  console.log('\n같은 줄의 조각이 한 줄로 이어진다');
  const big = lines.find((l) => l.text === '푸른하늘서점' && l.yPct < 20);
  ok(!!big, '큰 간판의 «푸른»«하늘»«서점»이 «푸른하늘서점» 한 줄이 된다');
  ok(big && Math.abs(big.wPct - 49.3) < 1.5 && Math.abs(big.yPct - 14.2) < 1.5, '그 상자가 큰 간판 글자를 정확히 감싼다', big ? `가로 ${big.wPct.toFixed(1)}% · 세로 중심 ${big.yPct.toFixed(1)}%` : '');
  const sub = lines.find((l) => /푸른.*책.*하늘서점/.test(l.text));
  ok(!!sub, '간판 아래 작은 줄 «푸른 책 하늘서점»은 따로 한 줄이다', sub && sub.text);
  ok(sub && big && Math.abs(sub.yPct - big.yPct) > 5, '그 작은 줄의 상자는 큰 간판의 상자와 다르다 (예전엔 같은 상자가 붙었다)', sub && big ? `세로 ${sub.yPct.toFixed(1)}% ≠ ${big.yPct.toFixed(1)}%` : '');
  ok(by(/Pureun Haneul Bookstore/).length === 1, '영문 간판은 «Pureun Haneul Bookstore» 한 줄이다 (영문끼리는 띄운다)');
  ok(by(/서점.*Bookstore/).length === 1, '«서점 (Bookstore)»도 한 줄이다');
  const win = lines.filter((l) => l.text === '푸른하늘서점');
  ok(win.length === 2, '오른쪽 유리창의 «푸른 하늘서점»도 따로 잡힌다 (Claude는 이걸 못 읽었다)', win.map((w) => w.yPct.toFixed(0) + '%').join(', '));

  console.log('\n칠판은 줄마다 좁은 상자다');
  const board = lines.filter((l) => l.xPct > 70 && l.yPct > 75);
  ok(board.length >= 4, '칠판 글자가 줄 단위로 잡힌다', board.map((b) => b.text).join(' | '));
  ok(board.every((b) => b.wPct < 8), '칠판 줄의 상자는 폭이 8% 미만이다 (예전엔 55%로 아이 사이까지 덮었다)', board.map((b) => b.wPct.toFixed(1)).join(', '));

  console.log('\n아이 얼굴·몸을 안 덮는다');
  // 두 아이: 가로 44~68%, 세로 62~96%
  const hitsKids = lines.filter((l) => {
    const x0 = l.xPct - l.wPct / 2, x1 = l.xPct + l.wPct / 2, y0 = l.yPct - l.hPct / 2, y1 = l.yPct + l.hPct / 2;
    return x1 > 44 && x0 < 68 && y1 > 62 && y0 < 96;
  });
  ok(hitsKids.length === 0, '어느 글자 상자도 두 아이가 서 있는 자리와 겹치지 않는다', hitsKids.map((h) => h.text).join(' | '));
  ok(lines.every((l) => l.wPct <= 55), '화면 절반을 넘는 넓은 상자가 없다', 'max ' + Math.max(...lines.map((l) => l.wPct)).toFixed(1) + '%');

  console.log('\n읽을 수 없는 잡음은 뺀다');
  ok(!texts.some((t) => /HOSIS|티비|포간/.test(t)), '높이 1% 미만(5~9픽셀) 조각은 대상이 아니다', texts.filter((t) => /HOSIS|티비|포간/.test(t)).join(','));
  ok(lines.every((l) => l.hPct >= 1), '남은 줄은 모두 높이가 사진의 1% 이상이다');

  console.log('\n속성');
  ok(lines.every((l) => l.approximate === false && l.source === 'vision'), '모두 정밀 위치(approximate:false)이고 출처가 vision이다');
  ok(big && big.type === '상호명', 'Claude가 읽은 글과 겹치면 종류(type)를 물려받는다', big && big.type);
  ok(lines.find((l) => /Pureun/.test(l.text)).type === '영문 간판', '영문 간판의 종류도 물려받는다');
  ok(lines.find((l) => /책방/.test(l.text)).type === '', '겹치는 글이 없으면 종류는 비워 둔다');
  ok(lines.every((l, i) => i === 0 || lines[i - 1].yPct <= l.yPct + 1e-9), '위에서 아래로 정렬돼 있다');

  console.log('\n진단 화면 핀 — Claude 글자의 위치를 Vision 줄의 정확한 상자로 바꾼다');
  const pin = await run((서점) => {
    const T = window.__anshimTest;
    const vl = T.visionLinesToTargets(T.visionWordsToPct(서점.map(([text, x0, y0, x1, y1]) => ({ text, x0, y0, x1, y1 })), 2000, 1092), []);
    // Claude가 주는 모양 그대로: 9분할 위치(상단 중앙=50,15 · 하단 우측=85,85) + 유형별 추정 크기, sizeEstimated:true
    const cw = (text, xPct, yPct, wPct, hPct) => ({ text, xPct, yPct, wPct, hPct, sizeEstimated: true, type: '상호명', source: 'claude' });
    const words = [
      cw('푸른하늘서점', 50, 15, 32, 9), cw('푸른 책 하늘서점', 50, 15, 32, 9), cw('Pureun Haneul Bookstore', 50, 50, 22, 6),
      cw('서점 (Bookstore)', 50, 50, 22, 6), cw('오늘의 추천 도서: 을 나는 책방', 85, 85, 22, 6), cw('완전히 다른 글자', 15, 85, 22, 6),
    ];
    const n = T.refineWordsWithVisionLines(words, vl);
    // 등급 순서: 한두 글자 다르게 읽은 글이 정확히 같은 글의 줄을 먼저 가져가면 안 된다
    const order = [
      { text: '푸른하늘서적', xPct: 50, yPct: 15, wPct: 32, hPct: 9, sizeEstimated: true },   // 오독(가까운 큰 간판에 끌린다)
      { text: '푸른하늘서점', xPct: 71, yPct: 44, wPct: 32, hPct: 9, sizeEstimated: true },   // 정확히 같은 글(유리창 근처)
    ];
    // 정확히 같은 글의 줄이 큰 간판 하나뿐인 상황: 오독한 글이 더 가까워도 그 줄은 정확한 글의 것이다
    const m = T.refineWordsWithVisionLines(order, vl.filter((l) => l.text === '푸른하늘서점' && l.yPct < 20));
    const tag = T.refineWordsWithVisionLines([{ text: '해샬어린이집', xPct: 50, yPct: 50, wPct: 22, hPct: 6, sizeEstimated: true }],
      T.visionLinesToTargets(T.visionWordsToPct([{ text: '햇살', x0: 100, y0: 100, x1: 190, y1: 140 }, { text: '어린이집', x0: 200, y0: 100, x1: 400, y1: 140 }], 1000, 500), []));
    return { n, words, m, order, tag };
  }, 서점);
  const [w0, w1, w2, w3, w4, w5] = pin.words;
  ok(pin.n === 5, '짝이 있는 글자 5개의 위치가 바뀐다 (짝 없는 1개는 그대로)', pin.n + '개');
  ok(Math.abs(w0.yPct - 14.2) < 1.5 && Math.abs(w0.wPct - 49.3) < 1.5, '«푸른하늘서점» → 큰 간판의 정확한 상자 (상단 중앙 근사 15%·32%가 아니라)', `세로 ${w0.yPct.toFixed(1)}% · 가로 ${w0.wPct.toFixed(1)}%`);
  ok(Math.abs(w1.yPct - 24.6) < 1.5, '«푸른 책 하늘서점» → 간판 아래 작은 줄 (큰 간판 상자가 아니라)', `세로 ${w1.yPct.toFixed(1)}%`);
  ok(Math.abs(w2.yPct - 34.8) < 1.5, '«Pureun Haneul Bookstore» → 영문 간판 줄', `세로 ${w2.yPct.toFixed(1)}%`);
  ok(Math.abs(w3.yPct - 38.8) < 1.5, '«서점 (Bookstore)» → 그 줄', `세로 ${w3.yPct.toFixed(1)}%`);
  ok(w4.xPct > 70 && w4.xPct < 78 && w4.yPct > 78 && w4.yPct < 88 && w4.wPct < 9 && w4.hPct > 8 && w4.hPct < 16,
    '여러 줄을 담은 칠판 글은 칠판 줄들을 묶은 상자다', `가운데 ${w4.xPct.toFixed(0)}%,${w4.yPct.toFixed(0)}% · ${w4.wPct.toFixed(1)}x${w4.hPct.toFixed(1)}%`);
  ok(w5.xPct === 15 && w5.yPct === 85 && w5.sizeEstimated === true && !w5.positionSource, '짝이 없는 글자는 근사 위치를 그대로 둔다');
  ok([w0, w1, w2, w3, w4].every((w) => w.sizeEstimated === false && w.positionSource === 'vision'), '바뀐 글자는 크기 추정이 아니라고 표시한다 (sizeEstimated:false, 위치 출처 vision)');
  ok(pin.words.every((w) => !('_refined' in w)), '임시 표시가 남지 않는다');
  ok(pin.m === 1 && Math.abs(pin.order[1].yPct - 14.2) < 1.5 && pin.order[0].yPct === 15 && pin.order[0].sizeEstimated === true,
    '한두 글자 오독한 글이 정확히 같은 글의 줄을 가로채지 않는다 (정확한 글이 큰 간판을 얻고, 오독한 글은 근사 위치 그대로)',
    `정확 ${pin.order[1].yPct.toFixed(0)}% · 오독 ${pin.order[0].yPct.toFixed(0)}%`);
  ok(pin.tag === 1, '한두 글자 다르게 읽은 «해샬어린이집»도 «햇살어린이집» 줄에 짝지어진다');

  console.log('\n경계 조건');
  const edge = await run(() => {
    const T = window.__anshimTest;
    const mk = (arr, W, H) => T.visionWordsToPct(arr.map(([text, x0, y0, x1, y1]) => ({ text, x0, y0, x1, y1 })), W, H);
    return {
      empty: T.visionLinesToTargets([], []).length,
      nul: T.visionLinesToTargets(null, null).length,
      // 멀리 떨어진 두 간판은 합쳐지지 않는다 (가로 틈이 글자 높이의 1.2배를 넘는다)
      far: T.visionLinesToTargets(mk([['햇살', 100, 100, 200, 140], ['어린이집', 600, 100, 800, 140]], 1000, 500), []).length,
      // 붙어 있으면 합친다
      near: T.visionLinesToTargets(mk([['햇살', 100, 100, 200, 140], ['어린이집', 210, 100, 410, 140]], 1000, 500), []).map((l) => l.text),
      // 위아래 두 줄은 합쳐지지 않는다
      stacked: T.visionLinesToTargets(mk([['원생', 100, 100, 200, 140], ['모집', 100, 150, 200, 190]], 1000, 500), []).length,
      // 공백만 있는 조각은 무시한다
      blank: T.visionLinesToTargets(mk([[' ', 100, 100, 200, 140]], 1000, 500), []).length,
    };
  });
  ok(edge.empty === 0 && edge.nul === 0, '빈 입력·null 입력은 빈 목록이다');
  ok(edge.far === 2, '멀리 떨어진 두 간판은 합치지 않는다', edge.far + '줄');
  ok(edge.near.length === 1 && edge.near[0] === '햇살어린이집', '붙어 있는 «햇살»«어린이집»은 «햇살어린이집»이 된다', edge.near.join());
  ok(edge.stacked === 2, '위아래 두 줄(«원생»/«모집»)은 합치지 않는다', edge.stacked + '줄');
  ok(edge.blank === 0, '공백뿐인 조각은 무시한다');

  ok(errs.length === 0, '페이지 에러 없음', errs.join(' | '));
  await browser.close();
  console.log(`\n${pass}개 통과, ${fail}개 실패`);
  process.exit(fail ? 1 : 0);
})();
