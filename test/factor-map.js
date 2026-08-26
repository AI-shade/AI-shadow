// 아이섀도우 — 위험 요소 지도(renderFactorMap) 테스트
//
// 사용법: 이 폴더(test)에서 → node factor-map.js
//   프론트가 http://localhost:8000 에서 돌고 있어야 합니다. AI 호출 없음 (비용 0).
//
// 왜 필요한가: 점수만 보여주면 "왜 62점인지"가 숫자로만 남는다. 받은 피드백대로
// 항목이 사진의 어느 자리를 보고 매겨진 점수인지 이어 보여준다.
//
// 이 테스트가 지키는 것:
//   ① 점수가 0인 항목은 사진에 상자를 두르지 않는다. 위험하지 않다고 판단한 자리에
//      상자를 두르면 "여기가 위험하다"는 뜻으로 읽힌다 — 없는 위험을 지어내는 셈이다.
//   ② 캡션·게시 습관은 "사진 밖"으로 밝힌다. 두 항목이 최대 34점(전체의 1/3)인데
//      사진에 아무 표시가 없으면 사진을 보고 매긴 점수로 오해된다.
//   ③ 기다리는 동안에도 줄을 미리 깔아 카드 높이가 안 튄다(test/settle.js와 같은 규칙).
//      이때는 상자를 그리지 않는다 — 점수가 없는데 위험하다고 두를 수 없다.
//   ④ 항목을 고르면 그 자리만 밝고 나머지는 죽는다.
//   ⑤ 자리가 근사치인 글자(Claude가 9분할 위치만 준 것)는 점선으로 구분한다.

const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';

// 서버(server.js의 RISK_FACTORS)와 같은 5개·같은 상한
const CAPS = [
  { 항목: '간판·주소 노출', 상한: 26 },
  { 항목: '소속 노출', 상한: 22 },
  { 항목: '인물 식별성', 상한: 18 },
  { 항목: '캡션 노출', 상한: 18 },
  { 항목: '게시 습관', 상한: 16 },
];

// 얼굴 2개 · 글자 3개(장소로 분류된 것 2개 + 아닌 것 1개)
const FACE = {
  faces: [
    { xPct: 30, yPct: 40, wPct: 12, hPct: 14, confidence: 0.9, rollDeg: 0, yawDeg: 0, areaRatioPct: 1.7 },
    { xPct: 62, yPct: 40, wPct: 12, hPct: 14, confidence: 0.9, rollDeg: 0, yawDeg: 0, areaRatioPct: 1.7 },
  ],
};
const OCR = {
  words: [
    { text: '햇살어린이집', type: '상호명', xPct: 40, yPct: 12, wPct: 30, hPct: 8, approximate: false },
    { text: '02-1234-5678', type: '전화번호', xPct: 75, yPct: 60, wPct: 22, hPct: 5, approximate: true },
    { text: 'hello', type: '', xPct: 50, yPct: 90, wPct: 10, hPct: 4, approximate: false },
  ],
  visualClues: [{ 종류: '교복', 근거: '같은 색 상의', 확신: '추정' }],
};

let pass = 0;
let fail = 0;

function check(label, ok, detail) {
  if (ok) {
    pass++;
    console.log('  PASS  ' + label + (detail ? '  (' + detail + ')' : ''));
  } else {
    fail++;
    console.log('  FAIL  ' + label + (detail ? '  (' + detail + ')' : ''));
  }
}

// 화면 상태를 한 번에 읽어온다
function snapshot(page) {
  return page.evaluate(() => {
    const layer = document.getElementById('riskRegions');
    return {
      hidden: document.getElementById('factorMap').hidden,
      focusing: layer.classList.contains('focusing'),
      showingOutside: layer.classList.contains('showing-outside'),
      outsideNote: document.getElementById('rgnOutside').textContent,
      boxes: Array.from(layer.querySelectorAll('.rgn')).map((e) => ({
        factor: e.dataset.factor,
        rough: e.classList.contains('rough'),
        on: e.classList.contains('on'),
        opacity: getComputedStyle(e).opacity,
        bg: getComputedStyle(e).backgroundColor,
      })),
      rows: Array.from(document.querySelectorAll('.fm-row')).map((e) => ({
        name: e.querySelector('.fm-name').textContent,
        score: e.querySelector('.fm-score').textContent,
        where: e.querySelector('.fm-where').textContent,
        outside: e.classList.contains('outside'),
        none: e.classList.contains('none'),
        disabled: e.disabled,
        hasSkel: !!e.querySelector('.fm-skel'),
      })),
    };
  });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 1400 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.__anshimTest && window.__anshimTest.renderFactorMap));

  const render = (factors, pending) => page.evaluate((a) => {
    const T = window.__anshimTest;
    T.showScreenForTest('result');
    T.renderFactorMap(a[0], a[1], a[2], a[3]);
  }, [factors, FACE, OCR, pending]);

  // ── 기다리는 동안 ────────────────────────────────────────────────────────
  console.log('\n점수를 기다리는 동안');
  await render(CAPS, true);
  let s = await snapshot(page);
  check('항목 5줄이 미리 깔린다', s.rows.length === 5, s.rows.length + '줄');
  check('점수 자리는 뼈대 막대다', s.rows.every((r) => r.hasSkel), '5줄 모두');
  check('상자는 아직 그리지 않는다', s.boxes.length === 0, s.boxes.length + '개');
  check('아직 누를 수 없다', s.rows.every((r) => r.disabled));
  check('자리는 이미 알 수 있는 것만 적는다',
    s.rows[0].where === '사진에서 2곳' && s.rows[2].where === '사진에서 2곳',
    s.rows[0].where + ' / ' + s.rows[2].where);
  check('점수를 모르는 동안 "해당 없음"이라고 하지 않는다',
    !s.rows.some((r) => r.where === '해당 없음'));

  // ── 결과가 도착한 뒤 ────────────────────────────────────────────────────
  console.log('\n결과가 도착한 뒤');
  const RESULT = [
    { 항목: '간판·주소 노출', 점수: 22, 상한: 26, 근거: 'x' },
    { 항목: '소속 노출', 점수: 12, 상한: 22, 근거: 'x' },
    { 항목: '인물 식별성', 점수: 14, 상한: 18, 근거: 'x' },
    { 항목: '캡션 노출', 점수: 6, 상한: 18, 근거: 'x' },
    { 항목: '게시 습관', 점수: 0, 상한: 16, 근거: 'x' },
  ];
  await render(RESULT, false);
  s = await snapshot(page);
  const byFactor = s.boxes.reduce((a, b) => { a[b.factor] = (a[b.factor] || 0) + 1; return a; }, {});
  check('장소로 분류된 글자만 상자를 받는다', byFactor['간판·주소 노출'] === 2,
    byFactor['간판·주소 노출'] + '개 (글자 3개 중 상호명·전화번호만)');
  check('얼굴마다 상자가 하나씩', byFactor['인물 식별성'] === 2, byFactor['인물 식별성'] + '개');
  check('점수 자리에 실제 숫자가 들어온다',
    s.rows[0].score.indexOf('22') === 0 && !s.rows[0].hasSkel, s.rows[0].score);
  check('상자 안쪽은 비어 있다(얼굴이 가려지지 않는다)',
    s.boxes.every((b) => b.bg === 'rgba(0, 0, 0, 0)'), s.boxes[0].bg);
  check('자리가 근사치인 글자는 점선', s.boxes.filter((b) => b.rough).length === 1,
    '점선 ' + s.boxes.filter((b) => b.rough).length + '개 (전화번호만 approximate)');

  console.log('\n점수가 0인 항목');
  check('사진에 상자를 두르지 않는다', !byFactor['게시 습관'], '게시 습관 0점');
  const zero = s.rows.find((r) => r.name === '게시 습관');
  check('줄은 남기고 흐리게 둔다', !!zero && zero.none, zero && zero.score);

  console.log('\n사진 밖 항목');
  const cap = s.rows.find((r) => r.name === '캡션 노출');
  const hab = s.rows.find((r) => r.name === '게시 습관');
  check('캡션 노출은 "사진 밖"', cap.where === '사진 밖' && cap.outside, cap.where);
  check('게시 습관은 "사진 밖"', hab.where === '사진 밖' && hab.outside, hab.where);
  check('사진 밖 항목에는 상자가 없다',
    !byFactor['캡션 노출'] && !byFactor['게시 습관']);

  console.log('\n항목을 고르면');
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('.fm-row'))
      .find((b) => b.querySelector('.fm-name').textContent === '인물 식별성').click();
  });
  // 흐려지는 전환(0.22s)이 끝날 때까지 기다린다. 고정 대기로는 전환 중간값이 잡힌다.
  await page.waitForFunction(() => Array.from(document.querySelectorAll('#riskRegions .rgn'))
    .filter((e) => !e.classList.contains('on'))
    .every((e) => Number(getComputedStyle(e).opacity) < 0.3), { timeout: 5000 })
    .catch(() => {});
  s = await snapshot(page);
  const on = s.boxes.filter((b) => b.on);
  const off = s.boxes.filter((b) => !b.on);
  check('고른 항목만 밝다', on.length === 2 && on.every((b) => b.opacity === '1'),
    on.length + '개 밝음');
  check('나머지는 죽는다', off.length > 0 && off.every((b) => Number(b.opacity) < 0.3),
    'focusing=' + s.focusing + ' / ' + off.map((b) => b.factor + '=' + b.opacity).join(', '));

  console.log('\n사진 밖 항목을 고르면');
  await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.fm-row'));
    rows.find((b) => b.querySelector('.fm-name').textContent === '인물 식별성').click(); // 해제
    rows.find((b) => b.querySelector('.fm-name').textContent === '캡션 노출').click();
  });
  await page.waitForFunction(() => Array.from(document.querySelectorAll('#riskRegions .rgn'))
    .every((e) => Number(getComputedStyle(e).opacity) < 0.3), { timeout: 5000 }).catch(() => {});
  s = await snapshot(page);
  check('사진에 "사진 밖"이라고 밝힌다', s.showingOutside, s.outsideNote.slice(0, 30) + '…');
  check('그 설명이 캡션 이야기다', s.outsideNote.indexOf('캡션') >= 0);
  check('사진의 상자는 모두 죽는다', s.boxes.every((b) => !b.on && Number(b.opacity) < 0.3));

  console.log('\n경계 조건');
  await render([], false);
  s = await snapshot(page);
  check('항목이 없으면 지도를 감춘다', s.hidden === true);
  await render(RESULT, false);
  await page.evaluate(() => window.__anshimTest.renderFactorMap([
    { 항목: '간판·주소 노출', 점수: 22, 상한: 26 },
  ], { faces: [] }, { words: [] }, false));
  s = await snapshot(page);
  check('두 번 그려도 상자가 쌓이지 않는다', s.boxes.length === 0,
    '글자·얼굴이 없으니 0개 (' + s.boxes.length + ')');
  check('모르는 항목 이름은 줄을 만들지 않는다', s.rows.length === 1, s.rows.length + '줄');

  check('콘솔 에러가 없다', errs.length === 0, errs.join(' | '));

  console.log('\n결과: ' + pass + '/' + (pass + fail) + ' 통과');
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})();
