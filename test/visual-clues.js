// 안심앨범 — 시각 단서(교복·원복·명찰) 배선 테스트
//
// 사용법: 이 폴더(test)에서 → node visual-clues.js
//   프론트가 http://localhost:8000 에서 돌고 있어야 합니다.
//
// **AI를 호출하지 않습니다 (비용 0).** Playwright로 백엔드 응답을 가로채서
// 미리 정해둔 값을 돌려주므로, 실제 Claude/fal 호출 없이 전체 흐름이 검증됩니다.
// 백엔드가 떠 있지 않아도 됩니다.
//
// 왜 필요한가: 서버는 교복을 감지하도록 고쳤지만(2026-08-21), 프론트가 그 결과를
// 위험도 진단으로 넘기지 않으면 아무 소용이 없습니다. 실제로 그 상태였습니다 —
// Vision이 "원복 감지"라고 응답해도 진단 요청에는 들어가지 않아 점수에 반영되지
// 않았습니다. 이 테스트는 그 배선이 살아있는지 확인합니다.

const { chromium } = require('playwright');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';
const PHOTO = path.join(__dirname, '..', 'childphoto.jpeg');

// Vision이 돌려줄 가짜 응답 — 실제 원복 사진에서 나온 것과 같은 모양
const FAKE_VISION = {
  감지된텍스트: [],
  시각단서: [
    { 종류: '원복', 근거: '동일한 색·디자인의 원아용 조끼와 체크 치마', 위치: '중앙', 확신: '높음' },
    { 종류: '학교 로고/마크', 근거: '좌측 가슴에 배지 형태의 마크', 위치: '중앙 좌측', 확신: '추정' },
  ],
  timingMs: 10,
  usage: { input_tokens: 1, output_tokens: 1 },
  model: 'test',
};

const FAKE_RISK = {
  종합위험도점수: 78,
  종합위험도등급: '상',
  위치노출위험도점수: 85,
  위치노출근거: '원복으로 유치원을 특정할 수 있습니다.',
  권장조치: ['원복이 보이지 않는 각도로 재촬영하세요.'],
  종합설명: '원복이 노출되어 기관 특정이 가능합니다.',
  timingMs: 10,
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

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 520, height: 1600 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  let riskPayload = null;

  const json = (route, body) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route('**/api/analyze-image', (route) => json(route, FAKE_VISION));
  await page.route('**/api/diagnose-risk', (route) => {
    try { riskPayload = JSON.parse(route.request().postData() || '{}'); } catch (e) { riskPayload = { _parseError: e.message }; }
    return json(route, FAKE_RISK);
  });
  // 나머지 백엔드 호출은 이 테스트와 무관하므로 무해한 응답으로 막아둠
  await page.route('**/api/suggest-captions', (route) => json(route, { 캡션제안: [], timingMs: 5 }));
  await page.route('**/api/flux-status', (route) => json(route, { ready: false }));
  await page.route('**/api/analyze-schedule-pattern', (route) => json(route, { 반복패턴여부: '없음', 근거: '', timingMs: 5 }));

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await (await page.$('#photoInput')).setInputFiles(PHOTO);
  await page.click('#submitBtn');
  await page.waitForSelector('#screen-result[style*="display: block"]', { timeout: 90000 });
  await page.waitForFunction(
    () => !document.getElementById('riskScore').classList.contains('skel'),
    { timeout: 90000 }
  );
  await page.waitForTimeout(500);

  console.log('\n진단 요청에 시각 단서가 실려 나가는가');
  check('diagnose-risk 요청이 발생함', riskPayload !== null);
  const clues = (riskPayload && riskPayload.visualClues) || [];
  check('visualClues 필드가 존재함', Array.isArray(riskPayload && riskPayload.visualClues),
    riskPayload ? JSON.stringify(Object.keys(riskPayload)) : '요청 없음');
  check('시각 단서 2개가 그대로 전달됨', clues.length === 2, clues.length + '개');
  check('원복이 포함됨', clues.some((c) => c.종류 === '원복'));
  check('로고/마크가 포함됨', clues.some((c) => (c.종류 || '').includes('로고')));
  check('근거 문장도 함께 전달됨', clues.some((c) => (c.근거 || '').includes('조끼')));

  console.log('\n화면에 표시되는가');
  const shown = await page.evaluate(() => document.getElementById('screen-result').textContent);
  check('결과 화면에 "원복"이 보임', shown.includes('원복'));
  check('결과 화면에 근거가 보임', shown.includes('조끼') || shown.includes('배지'));

  console.log('\n시각 단서가 없을 때도 정상 동작하는가');
  await page.route('**/api/analyze-image', (route) => json(route, { ...FAKE_VISION, 시각단서: [] }));
  riskPayload = null;
  await page.reload({ waitUntil: 'load' });
  await (await page.$('#photoInput')).setInputFiles(PHOTO);
  await page.click('#submitBtn');
  await page.waitForSelector('#screen-result[style*="display: block"]', { timeout: 90000 });
  await page.waitForFunction(
    () => !document.getElementById('riskScore').classList.contains('skel'),
    { timeout: 90000 }
  );
  await page.waitForTimeout(300);
  check('단서가 없으면 빈 배열로 전달', riskPayload && Array.isArray(riskPayload.visualClues) && riskPayload.visualClues.length === 0);

  if (errors.length) {
    console.log('\n  페이지 에러: ' + errors.join(' | '));
    fail++;
  }

  await browser.close();
  console.log('\n결과: ' + pass + '/' + (pass + fail) + ' 통과');
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
