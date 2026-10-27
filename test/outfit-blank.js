/*
 * 옷 교체가 fal로 보내는 사진 검사 — 마스크 안쪽을 «옷끼리만 강하게 흐린 원본»으로 채워 보내는가.
 *
 * 배경: FLUX Fill은 마스크로 비운 자리를 백지에서 그리지 않고 원본 구조를 물려받는 것으로 보인다. 그래서 흰 소매·허리띠·
 * 블레이저 테두리 같은 헌 옷 조각이 «새 옷» 안에 섞여 나왔다(A/B 실측). 마스크 안을 회색으로 지워 보내면 그 구조를 못
 * 베낀다. 얼굴·손·마스크 밖은 그대로여야 한다(합성은 마스크 안쪽만 결과로 바꾸므로 밖은 원본이다).
 *
 * 2026-10-27: 회색 → «옷끼리만 흐린 원본»(짧은 변의 3.5%)으로 바꿨다. 팀 테스트 보고서(옷.배경교체 결과보고서.pdf 1쪽 위):
 * 패딩+바지가 목 아래를 다 덮은 아이를 옷 교체했더니, 회색 사람 모양만 본 AI가 체형·자세·신발까지 새로 지어냈다.
 * 흐린 원본은 몸 윤곽과 대표 색은 남기고 마크·배색(칼라·띠)은 지운다 — 흐림 1%·2%·3.5%를 사진 세 장에 얹어
 * 눈으로 골랐다(2%에서는 빨간 V 칼라·검은 띠가 색 띠로 남아 헌 옷 조각이 되살아날 수 있었다).
 *
 * 사용법: 이 폴더(test)에서 → node outfit-blank.js   (프런트가 8000 또는 BASE_URL에서 돌고 있어야 함)
 * fal은 부르지 않는다(/api/inpaint-regions를 가로채 가짜 응답을 준다) — 비용 0, 합성 사진만 쓴다.
 */
const { chromium } = require('playwright');
const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  const 요청 = [];
  const PNG1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await page.route('**/api/inpaint-regions', (r) => {
    요청.push(r.request().postDataJSON());
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      imageBase64: PNG1, mediaType: 'image/png', width: 1, height: 1, editPrompt: 'x', timingMs: 1, estimatedCostUsd: 0, attempts: 1 }) });
  });
  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(800);

  // 합성 사진: 분홍 벽에 얼굴(살구색)과 몸통 자리에 선명한 무늬(빨강·초록 줄무늬) — 무늬가 뭉개졌는지 눈에 띄게
  const 결과 = await page.evaluate(async () => {
    const T = window.__anshimTest;
    const W = 400, H = 600;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = 'rgb(240,200,210)'; x.fillRect(0, 0, W, H);
    x.fillStyle = 'rgb(250,205,170)'; x.fillRect(150, 60, 100, 110);   // 얼굴
    for (let i = 0; i < 12; i++) { x.fillStyle = i % 2 ? 'rgb(220,30,30)' : 'rgb(30,160,60)'; x.fillRect(110, 190 + i * 24, 180, 24); } // 무늬 있는 몸통
    const img = new Image(); img.src = c.toDataURL('image/png'); await img.decode();
    const faces = [{ box: { x: 150, y: 60, width: 100, height: 110 } }];
    const decode = async (b64) => { const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode(); const cc = document.createElement('canvas'); cc.width = im.width; cc.height = im.height; const cx = cc.getContext('2d'); cx.drawImage(im, 0, 0); return { w: im.width, h: im.height, d: cx.getImageData(0, 0, im.width, im.height).data }; };
    const out = {};
    for (const [이름, opts] of [['기본', undefined], ['켬', { blank: true }], ['끔', { blank: false }]]) {
      window.__req = null;
      await T.runOutfitSwap(img, faces, { grade: '중' }, 'brown', 'none', undefined, opts);
      out[이름] = 'ok';
    }
    return out;
  });
  ok(요청.length === 3, '옷 교체를 세 번 불렀다 (기본 / 켬 / 끔)', 요청.length + '번');

  async function 분석(body) {
    return page.evaluate(async ({ image, mask }) => {
      const dec = async (b64) => { const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode(); const cc = document.createElement('canvas'); cc.width = im.width; cc.height = im.height; const cx = cc.getContext('2d'); cx.drawImage(im, 0, 0); return { w: im.width, h: im.height, d: cx.getImageData(0, 0, im.width, im.height).data }; };
      const a = await dec(image), m = await dec(mask);
      let inside = 0, gray = 0, outside = 0, outsideSame = 0, faceGray = 0, faceN = 0;
      // 몸통 한가운데(무늬 자리 안쪽, 경계에서 떨어진 곳)의 빨강 채널 퍼짐 — 줄무늬면 크고, 뭉개졌으면 작다
      const core = [];
      const ref = (x, y) => { // 원본 색: 벽(240,200,210) / 얼굴 / 무늬 — 마스크 밖 벽은 원본 그대로여야 한다
        return null;
      };
      for (let i = 0; i < a.d.length; i += 4) {
        const p = i / 4, x = p % a.w, y = (p / a.w) | 0;
        const white = m.d[i] > 250;              // 확실히 마스크 안쪽
        const black = m.d[i] < 5;                // 확실히 마스크 바깥
        const isGray = Math.abs(a.d[i] - 128) < 8 && Math.abs(a.d[i + 1] - 128) < 8 && Math.abs(a.d[i + 2] - 128) < 8;
        if (white) { inside++; if (isGray) gray++; }
        if (black) { outside++; if (!isGray) outsideSame++; }
        if (x >= 150 && x < 250 && y >= 60 && y < 170) { faceN++; if (isGray) faceGray++; }
        const sx = x * 400 / a.w, sy = y * 600 / a.h;
        if (white && sx >= 150 && sx < 250 && sy >= 260 && sy < 420) core.push([a.d[i], a.d[i + 1], a.d[i + 2]]);
      }
      const mean = [0, 1, 2].map((k) => core.reduce((s, c) => s + c[k], 0) / Math.max(1, core.length));
      const sd = Math.sqrt(core.reduce((s, c) => s + (c[0] - mean[0]) ** 2, 0) / Math.max(1, core.length));
      return { inside, grayPct: inside ? gray / inside * 100 : 0, outside, outsideNotGrayPct: outside ? outsideSame / outside * 100 : 0, faceGray, faceN,
        coreN: core.length, coreMean: mean.map(Math.round), coreSd: Math.round(sd) };
    }, { image: body.imageBase64, mask: body.maskBase64 });
  }
  const 기본 = await 분석(요청[0]), 켬 = await 분석(요청[1]), 끔 = await 분석(요청[2]);
  ok(기본.inside > 5000, '마스크 안쪽 픽셀이 충분히 있다 (몸통 자리)', 기본.inside + 'px');
  // 줄무늬(빨강 220 / 초록 30)의 빨강 채널 퍼짐은 약 95다. 뭉개면 크게 줄어야 하고, 대표 색(두 색의 평균 ≈ 125,95,45)은 남아야 한다.
  ok(기본.coreN > 1000, '몸통 한가운데를 잴 수 있다', 기본.coreN + 'px');
  ok(기본.grayPct < 5, '기본값: 마스크 안쪽이 회색이 아니다 (몸 윤곽·색이 보인다)', 기본.grayPct.toFixed(1) + '%');
  ok(기본.coreSd < 30, '기본값: 무늬(마크·배색)는 뭉개져서 간다', '빨강 퍼짐 ' + 기본.coreSd + ' (원본 약 95)');
  ok(Math.abs(기본.coreMean[0] - 125) < 30 && Math.abs(기본.coreMean[1] - 95) < 30 && Math.abs(기본.coreMean[2] - 45) < 30,
    '기본값: 옷의 대표 색은 남는다 (회색 128이 아니라 무늬의 평균색)', JSON.stringify(기본.coreMean));
  ok(켬.coreSd < 30 && 켬.grayPct < 5, 'blank:true: 기본값과 같다 (흐린 원본)', '퍼짐 ' + 켬.coreSd);
  ok(끔.coreSd > 80, 'blank:false: 예전처럼 원본 그대로 간다 (무늬가 그대로)', '빨강 퍼짐 ' + 끔.coreSd);
  ok(기본.outsideNotGrayPct > 99.9, '마스크 바깥은 회색으로 바뀌지 않는다 (배경·얼굴 그대로)', 기본.outsideNotGrayPct.toFixed(2) + '%');
  ok(기본.faceGray === 0, '얼굴 자리는 회색이 아니다 (얼굴은 마스크에서 빠진다)', `얼굴 ${기본.faceN}px 중 회색 ${기본.faceGray}`);
  ok(요청[0].maskBase64 === 요청[1].maskBase64, '마스크 자체는 같다 — 지우는 것은 «보내는 사진»뿐이다');
  ok(errs.length === 0, '페이지 에러 없음', errs.join(' | '));
  await browser.close();
  console.log(`\n${pass}개 통과, ${fail}개 실패`);
  process.exit(fail ? 1 : 0);
})();
