/*
 * 장소 확인이 진단과 한 번에 돌 때 원본을 보내지 않는지 잰다.
 *
 * 요청(11-20): "분석이 여러개로 지금 되어있잖아 그걸 하나로"
 * 규칙(AGENTS.md): 사용자가 그 단추를 누르지 않았는데 원본을 보내는 경로를 만들지 않는다.
 *   자동으로 돌 때 → 좌표 확인 + 얼굴 가린 AI 추측만. /api/location-check(원본)는 부르지 않는다.
 *   단추를 누를 때 → 그때 보낸다(11-21 동의창을 뺐다).
 *
 * 사용법: 이 폴더에서 → node loc-auto.js  (프런트가 8000에서). 비용·네트워크 없음.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const URL = process.env.ANSHIM_URL || 'http://localhost:8000/index.html';

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' })).newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  const 호출 = [];
  await page.route('**/api/**', (r) => {
    const u = r.request().url();
    호출.push(u.replace(/^.*\/api\//, ''));
    if (u.includes('location-guess')) {
      return r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ 구체성: '동네', 추측: '대전 유성구 어딘가', 근거: '아파트 단지 모양', 확신: '보통' }) });
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ready":false}' });
  });
  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(700);

  const img = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'fixtures', 'face-only.png')).toString('base64');
  await page.evaluate(async (img) => {
    const T = window.__anshimTest;
    T.setPastCountForTest(0, img);
    T.showScreenForTest('result');
    await T.runLocCheckForTest({ noOriginal: true });
  }, img);
  await page.waitForTimeout(300);

  console.log('\n자동으로 돌 때');
  ok(!호출.some((u) => u.startsWith('location-check')), '원본을 보내는 구글 검색을 부르지 않는다', JSON.stringify(호출));
  ok(호출.some((u) => u.startsWith('location-guess')), '얼굴 가린 AI 추측은 부른다');
  const 결과 = await page.textContent('#locWebResult');
  ok(/대전 유성구/.test(결과), '결과가 카드에 바로 나온다', 결과.slice(0, 60));
  // 11-21: «구글로 같은 사진 찾기»는 «내 정보 › 이미 올린 사진»으로 옮겼다 — 진단 결과에는 단추가 없다
  ok(!(await page.isVisible('#locWebCheckBtn')), '진단 결과에 구글 찾기 단추가 없다');

  console.log('\n내 정보 › 이미 올린 사진');
  await page.evaluate(() => { location.hash = '#me'; });
  await page.waitForTimeout(400);
  await page.click('#reverseBtn');
  await page.waitForTimeout(200);
  ok(!호출.some((u) => u.startsWith('location-check')), '사진을 안 고르면 보내지 않는다');
  ok(/먼저/.test(await page.textContent('#reverseResult')), '사진부터 고르라고 알려준다');
  await page.setInputFiles('#reverseInput', path.join(__dirname, 'fixtures', 'face-only.png'));
  await page.click('#reverseBtn');
  await page.waitForTimeout(600);
  ok(호출.some((u) => u.startsWith('location-check')), '누르면 그때 구글 검색을 부른다');
  ok(/못 찾음/.test(await page.textContent('#reverseResult')), '결과를 그 칸에 보여준다', (await page.textContent('#reverseResult')).slice(0, 40));

  ok(errs.length === 0, '페이지 오류 없음', errs.join(' | '));
  await browser.close();
  console.log(`\n${pass} 통과 / ${fail} 실패`);
  process.exit(fail ? 1 : 0);
})();
