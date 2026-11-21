// 아이섀도우 — 배경 교체 뒤 사람 둘레에 옛 배경(간판 색)이 띠로 남지 않는다
//
// 사용법: 이 폴더(test)에서 → node bg-halo.js
//   프론트가 http://localhost:8000 에서 돌고 있어야 합니다. AI 호출 없음 (비용 0) — 배경 교체 요청을 가로채 «새 배경»을
//   단색(짙은 남색)으로 돌려준다. 그러면 사람 둘레에 남은 색이 옛 배경인지 새 배경인지 숫자로 가를 수 있다.
//
// 왜: 폰 테스트(11-18, 거리 간판 앞 사진) — 배경을 바꿨더니 어깨 옆에 초록·빨간 얼룩이 남았다. buildBackgroundMask가
//   사람을 넓혀 막은 띠(원본 그대로)에 옛 간판 색이 남은 것이다. fillHaloFromBackground가 그 띠를 새 배경 색으로 채운다.
// 사진: public/self-check/school-sign.jpg — 아이 뒤에 밝은 대문·나무가 있어 짙은 새 배경과 대비가 크다.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';
const PHOTO = 'public/self-check/school-sign.jpg';
const NEW_BG = [20, 24, 60]; // 가짜 새 배경 색

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
  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.__anshimTest && window.__anshimTest.runBackgroundFill));
  // 거리 지도 모델은 받지 않는다 — 실패로 두어 예전처럼 사람 밖 전체를 다시 그리게 한다(이 테스트가 재는 것은 그쪽이다)
  await page.evaluate(() => window.__anshimTest.setDepthForTest(() => { throw new Error('test: no depth'); }));
  // 보낸 크기 그대로의 단색 그림을 돌려준다
  await page.route('**/api/replace-background', async (r) => {
    const body = r.request().postDataJSON();
    const png = await page.evaluate(async ({ b64, col }) => {
      const i = new Image(); i.src = 'data:image/jpeg;base64,' + b64; await i.decode();
      const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight;
      const x = c.getContext('2d'); x.fillStyle = 'rgb(' + col.join(',') + ')'; x.fillRect(0, 0, c.width, c.height);
      return c.toDataURL('image/png').split(',')[1];
    }, { b64: body.imageBase64, col: NEW_BG });
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ imageBase64: png, mediaType: 'image/png', editPrompt: 'x', timingMs: 1, estimatedCostUsd: 0 }) });
  });
  const u = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname, '..', PHOTO)).toString('base64');

  const r = await page.evaluate(async ({ u, NEW_BG }) => {
    const T = window.__anshimTest;
    const img = new Image(); img.src = u; await img.decode();
    const W = img.naturalWidth, H = img.naturalHeight;
    const fd = await T.runFaceDetectionPipeline(u);
    const out = await T.runBackgroundFill(img, fd.faces, { grade: '중' }, { words: [] });
    const od = out.canvas.getContext('2d').getImageData(0, 0, W, H).data;
    const oc = document.createElement('canvas'); oc.width = W; oc.height = H; oc.getContext('2d').drawImage(img, 0, 0);
    const id = oc.getContext('2d').getImageData(0, 0, W, H).data;
    const pm = await T.getFullPersonMask(img, 'halo-test');
    const pc = document.createElement('canvas'); pc.width = W; pc.height = H; pc.getContext('2d').drawImage(pm, 0, 0, W, H);
    const pa = pc.getContext('2d').getImageData(0, 0, W, H).data;
    // 띠: 사람(알파 > 0)에서 짧은 변 1.2% 안쪽이면서 알파 0인 곳 — buildBackgroundMask가 원본으로 남기던 자리
    const R = Math.round(Math.min(W, H) * 0.012);
    const person = (x, y) => x >= 0 && y >= 0 && x < W && y < H && pa[(y * W + x) * 4 + 3] > 0;
    const dist = (i, c) => Math.abs(od[i] - c[0]) + Math.abs(od[i + 1] - c[1]) + Math.abs(od[i + 2] - c[2]);
    let ring = 0, ringOld = 0, core = 0, coreChanged = 0;
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
      const i = (y * W + x) * 4, a = pa[i + 3];
      if (a >= 250) { core++; if (Math.abs(od[i] - id[i]) + Math.abs(od[i + 1] - id[i + 1]) + Math.abs(od[i + 2] - id[i + 2]) > 6) coreChanged++; continue; }
      if (a > 0) continue;
      if (!(person(x - R, y) || person(x + R, y) || person(x, y - R) || person(x, y + R))) continue;
      ring++;
      if (dist(i, NEW_BG) > 60) ringOld++; // 새 배경 색에서 멀다 = 옛 배경이 남았다
    }
    // 주인공(사람 분리가 잡은 사람)의 얼굴만 본다. 뒤에 선 다른 사람 얼굴은 배경이라 원래 새로 그려진다(고치기 전에도 같았다).
    let faceChanged = 0, faceN = 0;
    fd.faces.forEach((f) => {
      const b = f.box;
      if (pa[(Math.round(b.y + b.height / 2) * W + Math.round(b.x + b.width / 2)) * 4 + 3] <= 128) return;
      for (let y = Math.ceil(b.y); y < b.y + b.height; y += 3) for (let x = Math.ceil(b.x); x < b.x + b.width; x += 3) {
        const i = (y * W + x) * 4;
        if (pa[i + 3] <= 128) continue; // 상자 안 배경(사람 아닌 곳)은 채우는 게 맞다
        faceN++;
        if (Math.abs(od[i] - id[i]) + Math.abs(od[i + 1] - id[i + 1]) + Math.abs(od[i + 2] - id[i + 2]) > 6) faceChanged++;
      }
    });
    return { ring, ringOld, core, coreChanged, faceN, faceChanged };
  }, { u, NEW_BG });
  check('사람 둘레 띠를 잰다', r.ring > 500, r.ring + '점');
  check('띠에 옛 배경 색이 남지 않는다 (2% 미만)', r.ringOld / r.ring < 0.02, (r.ringOld / r.ring * 100).toFixed(1) + '%');
  check('확실한 사람 픽셀은 그대로다 (0.5% 미만 바뀜)', r.coreChanged / r.core < 0.005, (r.coreChanged / r.core * 100).toFixed(2) + '%');
  check('주인공 얼굴은 그대로다', r.faceN > 100 && r.faceChanged === 0, r.faceChanged + '/' + r.faceN);
  check('페이지 에러 없음', errs.length === 0, errs.join(' | '));
  await browser.close();
  console.log('\n' + pass + '개 통과, ' + fail + '개 실패');
  if (fail > 0) process.exitCode = 1;
})();
