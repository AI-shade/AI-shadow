// 아이섀도우 — «로고 지우기»는 로고·이름표 자리만 열고, 그 자리를 둘레 천 색으로 미리 지워서 보낸다
//
// 사용법: 이 폴더(test)에서 → node logo-erase.js
//   프론트가 http://localhost:8000 에서 돌고 있어야 합니다. AI 호출 없음 (비용 0) — 보내는 요청을 가로채서 본다.
//
// 왜: 팀 테스트(10-27 교복 사진) "로고를 지우긴했는데 왜자꾸 옷도 조금 바뀌고 이상한걸 추가하는지 모르겟어".
//   ① 예전에는 «어깨선부터 얼굴 높이 1.4배» 가슴 띠를 통째로 열어 칼라 여밈·단추·소매 테두리까지 다시 그렸다.
//   ② 원본을 그대로 보내서 AI가 이름표를 보고 글자 무늬가 있는 새 명찰을 그렸다.
// 이제 옷에서 «주변 천과 다르고 테두리가 날카로운 꽉 찬 덩어리»를 찾아 그 자리만 열고(findLogoRects), 둘레 천 색으로 칠해 보낸다.
// 아래 좌표는 예시 사진(880x880)에서 눈으로 찾은 자리다.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';
const CASES = [
  {
    file: 'public/self-check/playground.jpg',
    open: [{ x: 440, y: 505, what: 'TT 로고' }, { x: 615, y: 515, what: 'KOREA 패치' }],
    // 띠 매듭: 로고를 찾는 범위를 어깨선에서 얼굴 높이 1.9배로 넓혔다(성인 교복 주머니 엠블럼이 1.5배라 1.4배 띠에서 빠졌다).
    // 더 넓히면 이 매듭(약 2.1배)이 로고로 잡힌다 — 범위를 바꾸면 여기서 걸린다.
    closed: [{ x: 478, y: 440, what: '왼쪽 빨간 V 칼라' }, { x: 572, y: 440, what: '오른쪽 빨간 V 칼라' }, { x: 530, y: 490, what: '가운데 검은 칼라' },
      { x: 530, y: 668, what: '띠 매듭' }, { x: 470, y: 650, what: '왼쪽 띠' }],
    fill: { x: 440, y: 505 },
  },
  {
    file: 'public/self-check/school-sign.jpg',
    open: [{ x: 825, y: 565, what: '이름표' }, { x: 835, y: 615, what: '엠블럼' }],
    closed: [{ x: 797, y: 497, what: '칼라 단추' }],
  },
];
const PNG1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label + (detail ? '  (' + detail + ')' : '')); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '  (' + detail + ')' : '')); }
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  let last = null;
  await page.route('**/api/inpaint-regions', (r) => {
    last = r.request().postDataJSON();
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ imageBase64: PNG1, mediaType: 'image/png', width: 1, height: 1, editPrompt: 'x', timingMs: 1, estimatedCostUsd: 0, attempts: 1 }) });
  });
  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.__anshimTest && window.__anshimTest.runEmblemRemovalForTest));

  for (const c of CASES) {
    console.log('\n[' + path.basename(c.file) + ']');
    const u = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname, '..', c.file)).toString('base64');
    last = null;
    const info = await page.evaluate(async (u) => {
      const T = window.__anshimTest;
      const img = new Image(); img.src = u; await img.decode();
      const f = await T.runFaceDetectionPipeline(u);
      await T.runEmblemRemovalForTest(img, f.faces, { grade: '중' }, 'none');
      return { w: img.naturalWidth, h: img.naturalHeight, faces: f.faces.map((q) => q.box) };
    }, u);
    check('요청이 한 번 나간다', !!last);
    if (!last) continue;
    const r = await page.evaluate(async ({ image, mask, info, open, closed, fill }) => {
      const load = (s) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + s; });
      const A = await load(image), M = await load(mask);
      const sw = M.naturalWidth, sh = M.naturalHeight, kx = sw / info.w, ky = sh / info.h;
      const read = (im) => { const c = document.createElement('canvas'); c.width = sw; c.height = sh; const x = c.getContext('2d'); x.drawImage(im, 0, 0); return x.getImageData(0, 0, sw, sh).data; };
      const a = read(A), m = read(M);
      const at = (p) => (Math.round(p.y * ky) * sw + Math.round(p.x * kx)) * 4;
      let opened = 0;
      for (let i = 0; i < m.length; i += 4) if (m[i] > 128) opened++;
      let faceOpen = 0;
      info.faces.forEach((b) => {
        for (let y = Math.ceil(b.y * ky); y < Math.floor((b.y + b.height) * ky); y += 2)
          for (let x = Math.ceil(b.x * kx); x < Math.floor((b.x + b.width) * kx); x += 2) if (m[(y * sw + x) * 4] > 128) faceOpen++;
      });
      const px = fill ? Array.from(a.slice(at(fill), at(fill) + 3)) : null;
      return {
        openPct: (opened / (sw * sh) * 100).toFixed(1), faceOpen,
        open: open.map((p) => ({ what: p.what, on: m[at(p)] > 128 })),
        closed: closed.map((p) => ({ what: p.what, on: m[at(p)] > 128 })),
        fill: px,
      };
    }, { image: last.imageBase64, mask: last.maskBase64, info, open: c.open, closed: c.closed, fill: c.fill || null });
    r.open.forEach((p) => check(p.what + '은 연다', p.on));
    r.closed.forEach((p) => check(p.what + '는 열지 않는다 (옷 디자인은 그대로)', !p.on));
    check('얼굴은 열지 않는다', r.faceOpen === 0, r.faceOpen + 'px');
    check('가슴 띠 전체가 아니라 좁게 연다 (사진의 3% 미만)', Number(r.openPct) < 3, r.openPct + '%');
    if (r.fill) {
      const spread = Math.max(...r.fill) - Math.min(...r.fill);
      check('흰 도복 로고 자리를 분홍기 없는 흰 천 색으로 칠해 보낸다', spread < 15 && Math.min(...r.fill) > 190, 'rgb(' + r.fill.join(',') + ')');
    }
  }

  check('페이지 에러 없음', errs.length === 0, errs.join(' | '));
  await browser.close();
  console.log('\n' + pass + '개 통과, ' + fail + '개 실패');
  if (fail > 0) process.exitCode = 1;
})();
