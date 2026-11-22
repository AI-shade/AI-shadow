/*
 * 배경 교체: 앞쪽 물체 모델과 사람 분리를 섞은 마스크를 잰다(11-22).
 * 요청: "그렇게 모델 하나로 하는것보단 섞어서 해줘"
 *   앞쪽 물체 모델(RMBG)은 경계가 깔끔하고 식탁을 남기지만 간판도 남겼다(박물관 이름·학교 기둥) → 섞는다.
 * 앞쪽 마스크는 가짜로 넣는다(모델을 받지 않는다):
 *   사진 아래쪽 절반 전체 = 앞쪽(사람과 맞닿은 식탁 역할) + 얼굴 자리 + 위쪽 왼 귀퉁이 = 따로 떨어진 앞쪽 덩어리(간판 역할)
 *   → 아래쪽 사람 밖은 남기고(검정), 떨어진 덩어리는 다시 그리고(흰색),
 *   → 아래쪽에 있는 글자 자리는 사람 밖이면 다시 그린다(흰색), 얼굴은 언제나 검정.
 *   → 앞쪽 마스크가 얼굴을 놓치면 예전 방식(거리 지도)으로 간다.
 *
 * 사용법: 이 폴더에서 → node bg-mix.js  (프런트가 8000에서). 비용 0(AI 응답은 가짜).
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
  page.on('console', (m) => { if (/배경교체/.test(m.text())) console.log('    [콘솔] ' + m.text().slice(0, 160)); });
  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.__anshimTest && window.__anshimTest.setForegroundForTest));
  let sentMask = null, depthCalls = 0;
  await page.route('**/api/replace-background', async (r) => {
    const body = r.request().postDataJSON();
    sentMask = body.maskBase64;
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ imageBase64: body.imageBase64, mediaType: 'image/jpeg', editPrompt: 'x', timingMs: 1, estimatedCostUsd: 0 }) });
  });
  await page.exposeFunction('__depthCalled', () => { depthCalls++; });
  const u = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname, '..', PHOTO)).toString('base64');

  // 사람 밖 아래쪽 한 자리(글자 자리로 쓴다)와 얼굴 상자를 찾아 둔다
  const setup = await page.evaluate(async (u) => {
    const T = window.__anshimTest;
    const img = new Image(); img.src = u; await img.decode();
    const W = img.naturalWidth, H = img.naturalHeight;
    const pm = await T.getFullPersonMask(img, 'mix-test');
    const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); x.drawImage(pm, 0, 0, W, H);
    const a = x.getImageData(0, 0, W, H).data;
    const fd = await T.runFaceDetectionPipeline(u);
    // 아래쪽 절반에서 사람이 하나도 없는 10%×8% 칸
    let spot = null;
    for (let gy = 0.55; gy < 0.9 && !spot; gy += 0.05) for (let gx = 0.05; gx < 0.85 && !spot; gx += 0.05) {
      let on = 0;
      for (let y = Math.floor(gy * H); y < (gy + 0.08) * H; y += 3) for (let xx = Math.floor(gx * W); xx < (gx + 0.1) * W; xx += 3) if (a[(y * W + xx) * 4 + 3] >= 128) on++;
      if (!on) spot = { xPct: (gx + 0.05) * 100, yPct: (gy + 0.04) * 100, wPct: 10, hPct: 8 };
    }
    return { W, H, faces: fd.faces.map((f) => ({ x: f.box.x, y: f.box.y, width: f.box.width, height: f.box.height })) /* 상자는 getter라 그대로 넘기면 _x로 온다 */, spot };
  }, u);
  check('글자 자리로 쓸 사람 없는 칸을 찾았다', !!setup.spot);

  const run = (fgKind) => page.evaluate(async ({ u, fgKind, spot, faces }) => {
    const T = window.__anshimTest;
    T.setDepthForTest(() => { window.__depthCalled(); throw new Error('test: no depth'); });
    T.setForegroundForTest(() => {
      const w = 100, h = 100, data = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (fgKind === 'normal' && y >= 50) data[y * w + x] = 255;          // 아래쪽 절반: 사람과 맞닿은 앞쪽
        if (y < 10 && x < 10) data[y * w + x] = 255;                        // 위쪽 왼 귀퉁이: 떨어진 덩어리
        if (fgKind === 'normal' && faces.some((f) => x >= f.x0 - 2 && x <= f.x1 + 2 && y >= f.y0 - 2 && y <= f.y1 + 2)) data[y * w + x] = 255; // 얼굴은 덮는다
      }
      return { data, width: w, height: h };
    });
    const img = new Image(); img.src = u; await img.decode();
    const fd = await T.runFaceDetectionPipeline(u);
    await T.runBackgroundFill(img, fd.faces, { grade: '중' }, { words: [Object.assign({ text: '햇살유치원', type: '상호명' }, spot)] });
  }, { u, fgKind, spot: setup.spot, faces: setup.faces.map((f) => ({ x0: f.x / setup.W * 100, x1: (f.x + f.width) / setup.W * 100, y0: f.y / setup.H * 100, y1: (f.y + f.height) / setup.H * 100 })) });

  const measure = (spot, faces, W0, H0) => page.evaluate(async ({ m, spot, faces, W0, H0 }) => {
    const i = new Image(); i.src = 'data:image/png;base64,' + m; await i.decode();
    const W = i.naturalWidth, H = i.naturalHeight;
    const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); x.drawImage(i, 0, 0);
    const d = x.getImageData(0, 0, W, H).data;
    const white = (x0, y0, x1, y1) => { let n = 0, w = 0; for (let y = Math.floor(y0); y < y1; y++) for (let xx = Math.floor(x0); xx < x1; xx++) { n++; if (d[(y * W + xx) * 4] >= 128) w++; } return n ? w / n * 100 : 0; };
    const sx = W / W0, sy = H / H0;
    return {
      corner: white(0, 0, W * 0.08, H * 0.08),
      spot: white((spot.xPct - spot.wPct / 2) / 100 * W + 2, (spot.yPct - spot.hPct / 2) / 100 * H + 2, (spot.xPct + spot.wPct / 2) / 100 * W - 2, (spot.yPct + spot.hPct / 2) / 100 * H - 2),
      bottomRow: white(0, H * 0.93, W, H * 0.97),
      face: Math.max(0, ...faces.map((b) => white(b.x * sx, b.y * sy, (b.x + b.width) * sx, (b.y + b.height) * sy))),
    };
  }, { m: sentMask, spot, faces, W0: setup.W, H0: setup.H });

  console.log('\n섞은 마스크');
  sentMask = null; depthCalls = 0;
  await run('normal');
  check('보내는 마스크를 받았다', !!sentMask);
  let r = await measure(setup.spot, setup.faces, setup.W, setup.H);
  console.log('  귀퉁이 ' + r.corner.toFixed(1) + '% · 글자 자리 ' + r.spot.toFixed(1) + '% · 맨 아래 줄 ' + r.bottomRow.toFixed(1) + '% · 얼굴 ' + r.face.toFixed(1) + '% (흰 = 다시 그림)');
  check('사람과 떨어진 앞쪽 덩어리(간판 역할)는 다시 그린다', r.corner > 90, r.corner.toFixed(1) + '%');
  check('사람과 맞닿은 앞쪽(식탁 역할)은 원본으로 남긴다', r.bottomRow < 5, r.bottomRow.toFixed(1) + '%');
  check('앞쪽에 있어도 글자 자리는 다시 그린다', r.spot > 90, r.spot.toFixed(1) + '%');
  check('얼굴은 검정', r.face === 0, r.face.toFixed(2) + '%');
  check('거리 지도는 부르지 않는다', depthCalls === 0, depthCalls + '번');

  console.log('\n앞쪽 마스크가 얼굴을 놓침');
  sentMask = null; depthCalls = 0;
  await run('missFace');
  r = await measure(setup.spot, setup.faces, setup.W, setup.H);
  check('예전 방식으로 간다(거리 지도를 부른다)', depthCalls === 1, depthCalls + '번');
  check('얼굴은 검정', r.face === 0, r.face.toFixed(2) + '%');

  check('페이지 에러 없음', errs.length === 0, errs.join(' | '));
  await browser.close();
  console.log('\n' + pass + '개 통과, ' + fail + '개 실패');
  process.exit(fail ? 1 : 0);
})();
