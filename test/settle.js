/*
 * 결과 화면이 "제자리에 멈춰 있는가" 검증.
 *
 * 사진·핀은 바로 뜨지만 점수·조치·스케줄은 Claude를 기다린다. 그동안 자리를
 * 비워두면 답이 도착하는 순간 페이지가 통째로 밀린다 — 읽던 줄이 눈앞에서
 * 달아난다. 실측 +263px이었다(권장 조치 빈 채로 73px, 패턴·예측은 자리 없음).
 *
 * 여기서는 대기 상태와 결과 상태의 카드 높이를 재서, 카드마다 4px 이내인지 본다.
 */
const { chromium } = require('playwright');
const URL = process.env.ANSHIM_URL || 'http://localhost:8000/index.html';
const 허용 = 4; // 반올림 오차

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  // 통과해도 잰 값을 같이 보여준다 — "0px"라는 사실 자체가 이 테스트의 결과다
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

const 카드 = {
  '종합 점수': '.rcard-score',
  '감지 항목': '.rcard-detect',
  '장소 특정': '.rcard-location',
  '스케줄 경고': '#scheduleCard',
  '권장 조치': '#actionCard',
  '캡션 제안': '#captionCard',
};

const OCR = { words: [], visualClues: [{ 종류: '교복', 근거: '교복' }] };
const FACE = { faces: [{
  rollDeg: 3.2, yawDeg: -8.1, areaRatioPct: 12.4, confidence: 0.93,
  xPct: 42, yPct: 31,
}] };

function 결과(patterns) {
  return {
    score: 45, grade: '중',
    // 서버(server.js의 RISK_FACTORS)와 같은 5개·같은 상한이어야 한다.
    // normalizeRiskFactors가 그 목록을 훑어 항상 5개를 돌려주므로 이보다 적은 응답은
    // 실제로 나오지 않는다. 항목 수가 화면 높이를 정하는 테스트라서, 개수가 틀리면
    // 없는 어긋남을 테스트가 만들어낸다.
    riskFactors: [
      { 항목: '간판·주소 노출', 점수: 0, 상한: 26, 근거: '간판이나 주소로 읽히는 글자가 없어요.' },
      { 항목: '소속 노출', 점수: 23, 상한: 22, 근거: '교복이 보여 다니는 기관이 좁혀져요.' },
      { 항목: '인물 식별성', 점수: 10, 상한: 18, 근거: '얼굴이 정면으로 크게 나와요.' },
      { 항목: '캡션 노출', 점수: 0, 상한: 18, 근거: '캡션에서 위치나 시간을 특정할 만한 표현을 찾지 못했어요.' },
      { 항목: '게시 습관', 점수: 12, 상한: 16, 근거: '전체공개, 실시간 업로드예요.' },
    ],
    uploadTiming: '실시간 업로드', privacySetting: '전체공개',
    locationScore: 65,
    locationEvidence: '교복으로 다니는 기관이 좁혀지고, 실시간으로 올리면 지금 그 자리에 있다는 뜻이 돼요.',
    scheduleOn: patterns.length > 0,
    scheduleEvidence: patterns.length > 0
      ? '최근 게시물에서 같은 요일·같은 시간대가 반복적으로 나타납니다.'
      : '이번엔 사진만 봤어요. 과거 게시물을 함께 올리면 반복 패턴까지 짚어드려요.',
    schedulePatterns: patterns,
    schedulePredicted: patterns.length > 0 ? '수요일 오후 학원 앞' : '',
    actions: ['교복 엠블럼을 가려주세요.', '업로드를 몇 시간 늦춰주세요.', '공개 범위를 좁혀주세요.'],
    summary: '교복 때문에 다니는 기관이 특정될 수 있어요. 실시간 전체공개라 지금 위치까지 드러납니다.',
    captionSuggestions: ['오늘 하루', '즐거운 시간', '기록 한 장'],
  };
}

const 상황 = [
  { 이름: '과거 게시물 없이 사진만', past: 0, patterns: [], 캡션: '오늘 학교 앞에서' },
  { 이름: '과거 게시물까지 함께', past: 3, 캡션: '오늘 학교 앞에서',
    patterns: [
      { 유형: '요일', 내용: '수요일 16시 전후 반복', 근거게시물: [1, 3, 5] },
      { 유형: '장소', 내용: '같은 학원 앞에서 3회', 근거게시물: [2, 4] },
    ] },
  { 이름: '캡션을 안 쓰기로 한 경우', past: 0, patterns: [], 캡션: null },
];

const SNAP = (sel) => `(()=>{const o={};const m=${JSON.stringify(sel)};
  Object.keys(m).forEach(k=>{const e=document.querySelector(m[k]);
    o[k]=e?(getComputedStyle(e).display==='none'?0:Math.round(e.getBoundingClientRect().height)):null;});
  o['<전체>']=Math.round(document.getElementById('screen-result').getBoundingClientRect().height);
  return o})()`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 140)));
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(1000);

  for (const c of 상황) {
    console.log('\n[' + c.이름 + ']');
    await page.evaluate((a) => {
      const [past, 캡션, ocr, face] = a;
      const T = window.__anshimTest;
      const cap = document.getElementById('captionInput');
      const no = document.getElementById('noCaption');
      if (캡션 === null) { no.checked = true; cap.value = ''; }
      else { no.checked = false; cap.value = 캡션; }
      // 1×1 투명 GIF — 실제 흐름과 같은 순서로 사진·핀을 먼저 그린다
      T.setPastCountForTest(past, 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
      T.showScreenForTest('result');
      T.renderPhotoAndPinsForTest(face, ocr);
      T.renderLocationChainForTest({ uploadTiming: '실시간 업로드', privacySetting: '전체공개' }, face, ocr);
      T.startRiskPendingForTest();
    }, [c.past, c.캡션, OCR, FACE]);
    await page.waitForTimeout(400);
    const before = await page.evaluate(SNAP(카드));

    await page.evaluate((a) => {
      window.__anshimTest.stopScoreTickerForTest();
      window.__anshimTest.renderResultForTest(a[0], a[1], a[2]);
    }, [결과(c.patterns), FACE, OCR]);
    await page.waitForTimeout(700); // 높이 전환(0.35s)이 끝나기를 기다린다
    const after = await page.evaluate(SNAP(카드));

    Object.keys(카드).forEach((k) => {
      if (before[k] === null) return;
      const d = after[k] - before[k];
      ok(Math.abs(d) <= 허용, k + ' 카드가 제자리에 있다',
        before[k] + 'px → ' + after[k] + 'px (' + (d > 0 ? '+' : '') + d + ')');
    });
    const d = after['<전체>'] - before['<전체>'];
    ok(Math.abs(d) <= 허용 * Object.keys(카드).length,
      '결과 화면 전체가 밀리지 않는다',
      before['<전체>'] + 'px → ' + after['<전체>'] + 'px (' + (d > 0 ? '+' : '') + d + ')');
  }

  console.log('\n[대기 중에 빈칸으로 남는 곳이 없는가]');
  const blanks = await page.evaluate(() => {
    const T = window.__anshimTest;
    T.setPastCountForTest(0, null);
    T.showScreenForTest('result');
    T.startRiskPendingForTest();
    const out = [];
    ['#actionList', '#sbList', '#captionSuggestions'].forEach((s) => {
      const e = document.querySelector(s);
      const h = e.getBoundingClientRect().height;
      out.push([s, Math.round(h), e.children.length]);
    });
    return out;
  });
  blanks.forEach(([s, h, n]) => ok(h < 6 || n > 0, s + '가 빈 채로 자리만 차지하지 않는다', h + 'px에 자식 ' + n + '개'));

  ok(errs.length === 0, '콘솔 에러가 없다', errs.join(' | '));
  await browser.close();
  console.log('\n결과: ' + pass + '/' + (pass + fail) + ' 통과');
  process.exit(fail === 0 ? 0 : 1);
})();
