/*
 * 재검증 화면의 «보정 전 → 후» 오각형.
 *
 * 제보(10-28): "보정후 재검증 단계에서 다시 오각형으로 점수화해서 시각적으로 점수가 내려간걸 보여주자"
 * 사용자 선택: 같은 채점(/api/diagnose-risk)으로 다시 잰다 — 검증 때 이미 보정된 사진을 다시 읽으므로
 * 그 판독으로 한 번 더 채점한다. 캡션·게시 습관은 사진을 고쳐도 입력이 같으니 처음 점수를 그대로 쓴다
 * (다시 채점하면 흔들림만 섞인다).
 *
 * 사용법: 이 폴더에서 → node verify-radar.js  (프런트가 8000에서). 모든 /api를 가로챈다 — 비용 0.
 */
const { chromium } = require('playwright');
const path = require('path');
const URL = process.env.ANSHIM_URL || 'http://localhost:8000/index.html';
const PHOTO = path.join(__dirname, 'fixtures', 'face-plus-text.jpg');

const 전판독 = {
  감지된텍스트: [{ 내용: '햇살어린이집', 위치: '상단 중앙', 유형: '상호명' }],
  시각단서: [{ 종류: '원복', 근거: '같은 색 원아용 조끼', 위치: '중앙', 확신: '확실' }],
  장소단서: [],
};
const 후판독 = { 감지된텍스트: [], 시각단서: [], 장소단서: [] };
const 전점수 = {
  위험요인: [
    { 항목: '간판·주소 노출', 점수: 22, 상한: 26, 근거: '간판' },
    { 항목: '소속 노출', 점수: 18, 상한: 22, 근거: '원복' },
    { 항목: '인물 식별성', 점수: 12, 상한: 18, 근거: '얼굴' },
    { 항목: '캡션 노출', 점수: 6, 상한: 18, 근거: '캡션' },
    { 항목: '게시 습관', 점수: 8, 상한: 16, 근거: '전체공개' },
  ],
  종합위험도점수: 66, 종합위험도등급: '중', 위치노출위험도점수: 70, 위치노출근거: '간판', 권장조치: ['a'], 종합설명: 's',
};
// 다시 잰 점수 — 캡션·게시 습관을 일부러 다르게 준다(흔들림 흉내). 화면은 처음 값(6, 8)을 써야 한다.
const 후점수 = {
  위험요인: [
    { 항목: '간판·주소 노출', 점수: 0, 상한: 26, 근거: '없음' },
    { 항목: '소속 노출', 점수: 4, 상한: 22, 근거: '평범한 옷' },
    { 항목: '인물 식별성', 점수: 12, 상한: 18, 근거: '얼굴' },
    { 항목: '캡션 노출', 점수: 15, 상한: 18, 근거: '흔들림' },
    { 항목: '게시 습관', 점수: 2, 상한: 16, 근거: '흔들림' },
  ],
  종합위험도점수: 33, 종합위험도등급: '하', 위치노출위험도점수: 10, 위치노출근거: '', 권장조치: [], 종합설명: '',
};
const 검증 = { 검증결과: '통과', 합의: '한쪽만', 합의설명: '', 위험요소해결: '해결됨', 신규위험: '없음', 인물보존: '정상', 설명: 'ok', 검증자: {} };

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

async function 흐름(browser, 이름, ctxOpts, 옵션) {
  console.log('\n' + 이름);
  const ctx = await browser.newContext({ locale: 'ko-KR', ...ctxOpts });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('dialog', (d) => d.dismiss());
  const json = (r, b, s) => r.fulfill({ status: s || 200, contentType: 'application/json', body: JSON.stringify(b) });
  let 단계 = '전';
  const 채점요청 = [];
  await page.route('**/api/**', (r) => json(r, {}));
  await page.route('**/api/analyze-image', (r) => json(r, 단계 === '전' ? 전판독 : 후판독));
  await page.route('**/api/diagnose-risk', (r) => {
    채점요청.push(JSON.parse(r.request().postData() || '{}'));
    if (단계 === '후' && 옵션 && 옵션.채점실패) return json(r, { error: 'x' }, 500);
    return json(r, 단계 === '전' ? 전점수 : 후점수);
  });
  await page.route('**/api/verify-correction', (r) => json(r, 검증));

  await page.goto(URL, { waitUntil: 'load' });
  await page.fill('#captionInput', '오늘 햇살어린이집 첫 등원').catch(() => {});
  await page.setInputFiles('#photoInput', PHOTO);
  await page.click('#submitBtn');
  await page.waitForSelector('#screen-result[style*="display: block"]', { timeout: 60000 });
  await page.waitForFunction(() => !document.getElementById('riskScore').classList.contains('skel'), { timeout: 60000 });
  await page.waitForTimeout(800);
  await page.click('#goCorrectBtn');
  await page.waitForTimeout(800);
  // 보정 결과 자리에 올린 사진을 그대로 넣는다 — 얼굴이 없는 그림을 넣으면 검증이 «얼굴을 못 찾았어요» 창에서 멈춘다
  await page.evaluate(() => {
    const im = document.getElementById('photoPreview');
    const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
    c.getContext('2d').drawImage(im, 0, 0);
    window.__anshimTest.stackPending(c, { method: 'ai', detail: '배경 교체' });
  });
  단계 = '후';
  const 처음요청수 = 채점요청.length;
  await page.click('#goVerifyBtn');
  await page.waitForFunction(() => !/재검증 중/.test(document.querySelector('#verifyStamp .s-text').textContent), { timeout: 60000 });
  await page.waitForTimeout(600);

  const 보임 = await page.evaluate(() => { const e = document.getElementById('verifyRadar'); return !!e && e.getClientRects().length > 0; });
  if (옵션 && 옵션.채점실패) {
    ok(!보임, '다시 채점이 실패하면 오각형 칸을 숨긴다(지어낸 점수를 그리지 않는다)');
    ok(errs.length === 0, '페이지 에러 없음', errs.join(' | '));
    await ctx.close();
    return;
  }
  ok(채점요청.length === 처음요청수 + 1, '검증할 때 채점을 정확히 한 번 더 부른다', (채점요청.length - 처음요청수) + '번');
  const 후요청 = 채점요청[채점요청.length - 1] || {};
  const 전요청 = 채점요청[0] || {};
  ok((후요청.texts || []).length === 0, '다시 채점은 보정된 사진의 판독으로 한다(지운 간판이 안 실린다)', JSON.stringify(후요청.texts));
  ok(후요청.caption === 전요청.caption && JSON.stringify(후요청.checklist) === JSON.stringify(전요청.checklist),
    '캡션·체크리스트는 처음과 같은 값으로 보낸다');
  ok(보임, '오각형 칸이 보인다');
  const 값 = await page.evaluate(() => ({
    전: document.getElementById('vrBefore').textContent,
    후: document.getElementById('vrAfter').textContent,
    차: document.getElementById('vrDelta').textContent,
    전도형: document.getElementById('vrShapeBefore').getAttribute('points'),
    후도형: document.getElementById('vrShapeAfter').getAttribute('points'),
    줄: [...document.querySelectorAll('#vrList li')].map((l) => l.textContent.replace(/\s+/g, ' ').trim()),
    넓이: document.getElementById('verifyRadar').scrollWidth <= document.getElementById('verifyRadar').clientWidth + 1,
  }));
  // 후 = 0 + 4 + 12 + 처음 캡션 6 + 처음 게시 습관 8 = 30
  ok(값.전 === '66' && 값.후 === '30', '처음 66 → 보정 후 30 (캡션·게시 습관은 처음 값)', 값.전 + ' → ' + 값.후);
  ok(/36/.test(값.차), '내려간 만큼(36)을 적는다', 값.차);
  ok(값.전도형 && 값.후도형 && 값.전도형 !== 값.후도형, '처음과 보정 후 오각형이 둘 다 그려지고 모양이 다르다');
  ok(값.줄.length === 5, '항목 다섯 줄', 값.줄.length + '줄');
  ok(값.줄.some((t) => /간판/.test(t) && /22/.test(t) && /0/.test(t)), '간판·주소 22 → 0 이 적힌다', 값.줄[0]);
  ok(값.줄.some((t) => /캡션/.test(t) && /사진과 무관/.test(t)), '캡션 줄에 «사진과 무관»이라고 적는다', 값.줄.find((t) => /캡션/.test(t)));
  ok(값.넓이, '옆으로 넘치지 않는다');
  if (process.env.SHOT) await page.screenshot({ path: path.join(process.env.SHOT, 'verify-' + (ctxOpts.viewport.width) + '.png'), fullPage: true });
  ok(errs.length === 0, '페이지 에러 없음', errs.join(' | '));
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  await 흐름(browser, '데스크톱 1280x900', { viewport: { width: 1280, height: 900 } });
  await 흐름(browser, '폰 390x844', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await 흐름(browser, '폰 — 다시 채점 실패', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, { 채점실패: true });
  await browser.close();
  console.log('\n' + pass + '개 통과, ' + fail + '개 실패');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('실패:', e.message); process.exit(1); });
