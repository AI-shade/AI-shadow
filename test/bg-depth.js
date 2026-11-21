/*
 * 배경 전체 바꾸기가 사람보다 «앞쪽»(식탁·케이크)은 다시 그리지 않는지 잰다.
 * 제보(11-21): "배경 바꾸기 했는데 뒤에 그래픽이 깨지는게 보임" — 사람 밖을 전부 다시 그려서
 *   식탁 위 원본 조각(촛불·빨대)이 섬처럼 남고 케이크 자리가 하얀 덩어리가 됐다.
 * 거리 지도는 가짜로 넣는다(모델을 받지 않는다): 위쪽 절반은 멀고(0), 아래쪽 절반은 가깝다(255).
 *   → 보내는 마스크의 아래쪽 절반(앞쪽)에는 흰 곳(다시 그림)이 없어야 하고, 위쪽에는 있어야 한다.
 *   → 얼굴은 어느 쪽이든 검정이어야 한다(막는 쪽만 넓힌다).
 *   → 거리 지도를 못 만들면 예전처럼 사람 밖 전체를 다시 그린다.
 *
 * 사용법: 이 폴더에서 → node bg-depth.js  (프런트가 8000에서). 비용 0(AI 응답은 가짜).
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';
const PHOTO = 'public/self-check/school-sign.jpg';

let pass = 0, fail = 0;
const check = (l, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + l + (d ? '  (' + d + ')' : '')); } else { fail++; console.log('  FAIL  ' + l + (d ? '  (' + d + ')' : '')); } };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.__anshimTest && window.__anshimTest.runBackgroundFill && window.__anshimTest.setDepthForTest));
  let sentMask = null;
  await page.route('**/api/replace-background', async (r) => {
    const body = r.request().postDataJSON();
    sentMask = body.maskBase64;
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ imageBase64: body.imageBase64, mediaType: 'image/jpeg', editPrompt: 'x', timingMs: 1, estimatedCostUsd: 0 }) });
  });
  const u = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname, '..', PHOTO)).toString('base64');

  const measure = () => page.evaluate(async ({ u, m }) => {
    const i = new Image(); i.src = 'data:image/png;base64,' + m; await i.decode();
    const W = i.naturalWidth, H = i.naturalHeight;
    const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); x.drawImage(i, 0, 0);
    const d = x.getImageData(0, 0, W, H).data;
    let top = 0, bottom = 0;
    for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) if (d[(y * W + xx) * 4] >= 128) { if (y < H / 2) top++; else bottom++; }
    return { top: top / (W * H / 2) * 100, bottom: bottom / (W * H / 2) * 100 };
  }, { u, m: sentMask });

  // 1) 거리 지도: 위 절반 멀고, 아래 절반 가깝다
  const faces = await page.evaluate(async ({ u }) => {
    const T = window.__anshimTest;
    T.setDepthForTest(() => { const w = 64, h = 64, data = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = y < h / 2 ? 0 : 255; return { data, width: w, height: h }; });
    const img = new Image(); img.src = u; await img.decode();
    const fd = await T.runFaceDetectionPipeline(u);
    await T.runBackgroundFill(img, fd.faces, { grade: '중' }, { words: [] });
    return fd.faces.length;
  }, { u });
  check('보내는 마스크를 받았다', !!sentMask);
  const a = await measure();
  console.log('  위쪽 다시 그림 ' + a.top.toFixed(1) + '% · 아래쪽 ' + a.bottom.toFixed(1) + '%  (얼굴 ' + faces + '개)');
  check('앞쪽(가까운 아래 절반)은 다시 그리지 않는다', a.bottom === 0, a.bottom.toFixed(2) + '%');
  check('뒤쪽(먼 위 절반)은 다시 그린다', a.top > 5, a.top.toFixed(1) + '%');

  // 2) 거리 지도를 못 만들면 예전처럼 — 아래쪽도 다시 그린다
  sentMask = null;
  await page.evaluate(async ({ u }) => {
    const T = window.__anshimTest;
    T.setDepthForTest(() => { throw new Error('test: no depth'); });
    const img = new Image(); img.src = u; await img.decode();
    const fd = await T.runFaceDetectionPipeline(u);
    await T.runBackgroundFill(img, fd.faces, { grade: '중' }, { words: [] });
  }, { u });
  const b = await measure();
  check('거리 지도가 없으면 예전처럼 아래쪽도 다시 그린다', b.bottom > 5, b.bottom.toFixed(1) + '%');
  check('거리 지도를 쓰면 다시 그리는 곳이 줄어든다', a.top + a.bottom < b.top + b.bottom, (a.top + a.bottom).toFixed(1) + ' < ' + (b.top + b.bottom).toFixed(1));

  check('페이지 에러 없음', errs.length === 0, errs.join(' | '));
  await browser.close();
  console.log('\n' + pass + '개 통과, ' + fail + '개 실패');
  process.exit(fail ? 1 : 0);
})();
