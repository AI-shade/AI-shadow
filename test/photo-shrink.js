// 아이섀도우 — 큰 사진 줄이기 테스트
//
// 사용법: 이 폴더(test)에서 → node photo-shrink.js
//   프론트가 http://localhost:8000 에서 돌고 있어야 합니다. AI 호출 없음 (비용 0).
//
// 왜 필요한가: 제보 11-02 "아이폰 쓰시는 분들이 보정과정에서 튕긴데 … 난 갤럭시22인데 안튕기거든",
// "사파리로 안가도 튕긴데". iOS는 크롬·네이버·카톡 안 브라우저도 전부 웹킷이라 캔버스 합계 약 384MB,
// 한 장 16,777,216화소를 넘으면 탭을 다시 띄운다. 원본 크기로 보정하던 때 실측(배경 교체 + 옷 전체,
// AI는 가짜 응답): 2400만 화소(아이폰 15·16) 761MB·한도 넘는 캔버스 14장, 1200만 화소 386MB.
// 올릴 때 긴 변 2560px로 줄이자 둘 다 176MB·0장. 이 테스트는 그 줄이기가 빠지지 않게 지킨다.

const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label + (detail ? '  (' + detail + ')' : '')); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '  (' + detail + ')' : '')); }
}

// w x h 사진 — 왼쪽 위 1/4만 빨강이라 줄인 뒤에도 방향이 그대로인지 볼 수 있다
async function makeJpeg(page, w, h) {
  const b64 = await page.evaluate(([w, h]) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = '#0000ff'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#ff0000'; x.fillRect(0, 0, w / 2, h / 2);
    const u = c.toDataURL('image/jpeg', 0.8).split(',')[1];
    c.width = 0; c.height = 0;
    return u;
  }, [w, h]);
  return Buffer.from(b64, 'base64');
}

async function photoInfo(page) {
  return page.evaluate(async () => {
    const T = window.__anshimTest;
    const im = new Image();
    im.src = T.uploadedPhotoUrlForTest();
    await im.decode();
    const c = document.createElement('canvas');
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    const x = c.getContext('2d');
    x.drawImage(im, 0, 0);
    const tl = Array.from(x.getImageData(Math.floor(c.width / 4), Math.floor(c.height / 4), 1, 1).data);
    const br = Array.from(x.getImageData(Math.floor(c.width * 3 / 4), Math.floor(c.height * 3 / 4), 1, 1).data);
    c.width = 0; c.height = 0;
    return { w: im.naturalWidth, h: im.naturalHeight, tl, br, url: T.uploadedPhotoUrlForTest(), orig: T.originalPhotoUrlForTest() };
  });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await page.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });

  console.log('\n아이폰 15·16 사진 (4284x5712, 2400만 화소)');
  await page.setInputFiles('#photoInput', { name: 'iphone.jpg', mimeType: 'image/jpeg', buffer: await makeJpeg(page, 4284, 5712) });
  await page.waitForFunction(() => window.__anshimTest.uploadedPhotoUrlForTest() !== window.__anshimTest.originalPhotoUrlForTest(), null, { timeout: 15000 }).catch(() => {});
  const big = await photoInfo(page);
  check('긴 변이 2560px로 준다', Math.max(big.w, big.h) === 2560, big.w + 'x' + big.h);
  check('iOS 캔버스 한 장 한도(16,777,216화소) 안이다', big.w * big.h <= 16777216, (big.w * big.h).toLocaleString());
  check('가로세로 비율이 그대로다', Math.abs(big.w / big.h - 4284 / 5712) < 0.002, (big.w / big.h).toFixed(4));
  check('방향이 그대로다 — 왼쪽 위가 빨강', big.tl[0] > 200 && big.tl[2] < 60, 'tl ' + big.tl.slice(0, 3));
  check('오른쪽 아래는 파랑', big.br[2] > 200 && big.br[0] < 60, 'br ' + big.br.slice(0, 3));
  check('EXIF를 읽을 원본은 그대로 남는다', big.orig && big.orig !== big.url);
  const preview = await page.evaluate(() => document.getElementById('photoPreview').src);
  check('미리보기도 줄인 사진이다', preview === big.url);

  console.log('\n줄인 뒤 돌리기');
  await page.click('#rotatePhotoBtn');
  await page.waitForFunction((u) => window.__anshimTest.uploadedPhotoUrlForTest() !== u, big.url);
  const turned = await photoInfo(page);
  check('줄인 사진이 돌아간다', turned.w === big.h && turned.h === big.w, turned.w + 'x' + turned.h);

  console.log('\n작은 사진 (1200x900)');
  await page.setInputFiles('#photoInput', { name: 'small.jpg', mimeType: 'image/jpeg', buffer: await makeJpeg(page, 1200, 900) });
  await page.waitForFunction(() => document.getElementById('photoPreview').naturalWidth === 1200);
  await page.evaluate(() => new Promise((r) => setTimeout(r, 300)));
  const small = await photoInfo(page);
  check('작은 사진은 손대지 않는다 — 원본 그대로 쓴다', small.url === small.orig && small.w === 1200, small.w + 'x' + small.h);

  console.log('\n올리자마자 진단을 눌러도');
  await page.setInputFiles('#photoInput', { name: 'iphone2.jpg', mimeType: 'image/jpeg', buffer: await makeJpeg(page, 5712, 4284) });
  await page.evaluate(() => document.getElementById('submitBtn').click()); // 줄이기가 끝나기 전에 누른다
  await page.waitForFunction(() => document.getElementById('scanImg').getAttribute('src'), null, { timeout: 15000 });
  const scan = await page.evaluate(() => ({
    scan: document.getElementById('scanImg').getAttribute('src'),
    url: window.__anshimTest.uploadedPhotoUrlForTest(), orig: window.__anshimTest.originalPhotoUrlForTest(),
  }));
  check('진단은 줄인 사진으로 시작한다', scan.scan === scan.url && scan.url !== scan.orig);

  check('페이지 에러 없음', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log('\n' + pass + '개 통과, ' + fail + '개 실패');
  if (fail > 0) process.exitCode = 1;
})();
