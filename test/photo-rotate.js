// 아이섀도우 — 사진 돌리기 테스트
//
// 사용법: 이 폴더(test)에서 → node photo-rotate.js
//   프론트가 http://localhost:8000 에서 돌고 있어야 합니다. AI 호출 없음 (비용 0).
//
// 왜 필요한가: 옆으로 누운 사진은 얼굴 검출·인물 분리가 깨진다(실측: 90° 돌린 태권도복 사진에서
// 진짜 얼굴은 놓치고 문의 로고를 얼굴로 잡았고, 인물 분리는 다리 끝을 놓쳤다). 그 상태로 배경을
// 바꾸면 놓친 다리에 AI가 그린 옷이 남는다(팀 제보: "지 맘대로 옷도바꾸고 사진 방향이 바꼇다고
// 인식을 못하고"). 방향을 자동으로 판단하는 것은 재봤더니 25장 중 5장을 틀렸다 — 그래서
// 사용자가 직접 돌린다.
//
// 10-27에 만들었다가 팀원 화면을 합치면서 빠졌다. 되살리며 폰 크기도 잰다
// (제보 10-28: "모바일에서는 사진 돌리기가 안돼").

const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label + (detail ? '  (' + detail + ')' : '')); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '  (' + detail + ')' : '')); }
}

async function run(browser, name, ctxOpts) {
  console.log('\n=== ' + name);
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await page.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });

  // 600x400, 왼쪽 절반만 빨강 — 시계방향 90° 돌리면 400x600이 되고 위쪽 절반이 빨강이다
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 600; c.height = 400;
    const x = c.getContext('2d');
    x.fillStyle = '#0000ff'; x.fillRect(0, 0, 600, 400);
    x.fillStyle = '#ff0000'; x.fillRect(0, 0, 300, 400);
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.setInputFiles('#photoInput', { name: 'sideways.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.waitForFunction(() => document.getElementById('photoPreview').naturalWidth > 0);

  console.log('\n돌리기 버튼');
  const btn = await page.$('#rotatePhotoBtn');
  check('미리보기 아래에 돌리기 버튼이 있다', !!btn);
  if (!btn) { await ctx.close(); return; }
  check('사진을 올리면 버튼이 보인다', await btn.isVisible());

  // 폰: 돌리기 줄이 늘어도 «위험도 진단하기»가 탭바 위 화면 안에 있어야 한다
  const 자리 = await page.evaluate(() => {
    const s = document.getElementById('submitBtn').getBoundingClientRect();
    const bar = document.querySelector('.app-tabbar');
    const 바위 = bar && bar.getClientRects().length ? bar.getBoundingClientRect().top : innerHeight;
    const r = document.getElementById('rotatePhotoBtn').getBoundingClientRect();
    return { 진단끝: Math.round(s.bottom), 바위: Math.round(바위), 돌리기끝: Math.round(r.bottom) };
  });
  // 데스크톱은 업로드 칸이 원래 긴 페이지 아래쪽에 있다 — 폰에서만 잰다
  if (ctxOpts.isMobile) check('돌리기 단추가 스크롤 없이 보인다', 자리.돌리기끝 <= 자리.바위, 자리.돌리기끝 + ' / ' + 자리.바위);
  if (ctxOpts.isMobile) check('«위험도 진단하기»도 스크롤 없이 보인다', 자리.진단끝 <= 자리.바위, 자리.진단끝 + ' / ' + 자리.바위);

  const before = await page.evaluate(() => ({
    url: window.__anshimTest.uploadedPhotoUrlForTest(),
    orig: window.__anshimTest.originalPhotoUrlForTest(),
  }));
  check('처음에는 원본과 진단용 사진이 같다', before.url && before.url === before.orig);

  await btn.click();
  await page.waitForFunction((u) => window.__anshimTest.uploadedPhotoUrlForTest() !== u, before.url);
  await page.waitForFunction(() => document.getElementById('photoPreview').naturalWidth === 400);
  const once = await page.evaluate(() => {
    const im = document.getElementById('photoPreview');
    const c = document.createElement('canvas');
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    const x = c.getContext('2d');
    x.drawImage(im, 0, 0);
    const top = x.getImageData(200, 100, 1, 1).data;
    const bottom = x.getImageData(200, 500, 1, 1).data;
    return {
      w: im.naturalWidth, h: im.naturalHeight, top: Array.from(top), bottom: Array.from(bottom),
      url: window.__anshimTest.uploadedPhotoUrlForTest(), orig: window.__anshimTest.originalPhotoUrlForTest(),
    };
  });
  check('한 번 누르면 가로세로가 바뀐다', once.w === 400 && once.h === 600, once.w + 'x' + once.h);
  check('시계방향이다 — 왼쪽이던 빨강이 위로 온다', once.top[0] > 200 && once.top[2] < 60, 'top ' + once.top.slice(0, 3));
  check('아래쪽은 파랑이다', once.bottom[2] > 200 && once.bottom[0] < 60, 'bottom ' + once.bottom.slice(0, 3));
  check('진단에 쓰는 사진이 돌린 사진으로 바뀐다', once.url !== before.url);
  check('EXIF를 읽을 원본은 그대로다 (캔버스를 거치면 좌표가 사라진다)', once.orig === before.orig);

  for (let i = 0; i < 3; i++) {
    const u = await page.evaluate(() => window.__anshimTest.uploadedPhotoUrlForTest());
    await btn.click();
    await page.waitForFunction((v) => window.__anshimTest.uploadedPhotoUrlForTest() !== v, u);
  }
  await page.waitForFunction(() => document.getElementById('photoPreview').naturalWidth === 600);
  const four = await page.evaluate(() => {
    const im = document.getElementById('photoPreview');
    return { w: im.naturalWidth, h: im.naturalHeight };
  });
  check('네 번 누르면 원래 크기로 돌아온다', four.w === 600 && four.h === 400, four.w + 'x' + four.h);

  console.log('\n얼굴을 못 찾았을 때 안내');
  const hint = await page.evaluate(() => document.getElementById('noFaceConsentModal').textContent);
  check('얼굴을 못 찾은 창이 돌려보라고 알려준다', /누워/.test(hint) && /돌리기/.test(hint));

  check('페이지 에러 없음', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  await run(browser, '데스크톱 1280x800', { viewport: { width: 1280, height: 800 } });
  await run(browser, '폰 393x852', { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
  await run(browser, '낮은 폰 375x667', { viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  // 삼성 인터넷은 위 주소창·아래 도구 막대가 키를 먹는다 — 제보 11-02 "갤럭시 22+ 진단 누르면 여전히 짤려서 안보여"
  await run(browser, '갤럭시 S22+ 삼성 인터넷 384x653', { viewport: { width: 384, height: 653 }, isMobile: true, hasTouch: true });
  await run(browser, '갤럭시 S22 삼성 인터넷 360x610', { viewport: { width: 360, height: 610 }, isMobile: true, hasTouch: true });
  await browser.close();
  console.log('\n' + pass + '개 통과, ' + fail + '개 실패');
  if (fail > 0) process.exitCode = 1;
})();
