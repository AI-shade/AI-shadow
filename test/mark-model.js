// 아이섀도우 — 마크 찾기 모델의 상자를 «로고 지우기»에 더해도 얼굴은 열리지 않고, 옷 위 로고만 더 열린다
//
// 사용법: 이 폴더(test)에서 → node mark-model.js
//   프론트가 http://localhost:8000 에서 돌고 있어야 합니다. AI 호출 없음 (비용 0) — 보내는 요청을 가로채서 본다.
//
// 왜: 학습한 RF-DETR 모델은 «사람 전체»를 상자로 자주 잡는다(정답표 103장에서 625개 중 110개가 얼굴을 품음).
//   그 상자를 옷 마스크와 겹치면 옷 전체가 다시 그려진다 — «몸 두 개»와 같은 종류의 사고다.
//   그래서 markRectsOnClothes가 얼굴을 품은 상자·얼굴보다 훨씬 큰 상자·옷이 아닌 상자를 버린다.
//
// 1부(늘): 상자를 모델 출력이 아니라 숫자로 고정해 규칙을 본다 — 모델 파일이 없어도 돈다.
// 2부(모델 파일이 있을 때만): 실제 모델로 «로고 지우기» 경로를 끝까지 돌려 얼굴 0픽셀·소매 열림을 본다.
//   public/models/mark-int8.onnx 는 41MB라 저장소에 없다(gitignore). 없으면 2부는 건너뛴다고 적고 넘어간다.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';
const PHOTO = 'public/self-check/playground.jpg'; // 880x880, 태권도복 — 오른쪽 소매에 세로 글자 «청룡태도»
// 고정 상자 (원본 좌표). 눈으로 사진에서 잡은 자리다.
const BOXES = [
  { what: '오른쪽 소매 세로 글자', keep: true, x: 668, y: 485, width: 44, height: 180 },
  { what: '사람 전체 (얼굴을 품음)', keep: false, x: 330, y: 160, width: 400, height: 720 },
  { what: '왼쪽 세로 간판 (옷 아님)', keep: false, x: 40, y: 170, width: 95, height: 440 },
  { what: '도복 아랫도리 큰 상자 (얼굴 폭 1.5배 넘음)', keep: false, x: 400, y: 620, width: 260, height: 260 },
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
  await page.waitForFunction(() => !!(window.__anshimTest && window.__anshimTest.markRectsOnClothes));
  const u = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname, '..', PHOTO)).toString('base64');

  console.log('\n[1부] 고정 상자로 거르기 규칙 — ' + path.basename(PHOTO));
  const r1 = await page.evaluate(async ({ u, boxes }) => {
    const T = window.__anshimTest;
    const img = new Image(); img.src = u; await img.decode();
    const W = img.naturalWidth, H = img.naturalHeight;
    const faces = (await T.runFaceDetectionPipeline(u)).faces.map((q) => q.box);
    const cm = await T.getClothesMask(img, 'mark-model-test');
    const kept = T.markRectsOnClothes(boxes, faces, cm, W, H).map((b) => b.what);
    // 얼굴까지 덮는 상자를 buildLogoMask에 바로 넣어도 얼굴은 검게 남아야 한다(막기가 마지막 단계)
    const m = T.buildLogoMask([{ x: 0, y: 0, width: W, height: H }], W, H, cm, faces, []);
    const md = m.getContext('2d').getImageData(0, 0, W, H).data;
    let faceOpen = 0;
    faces.forEach((b) => {
      for (let y = Math.ceil(b.y); y < Math.floor(b.y + b.height); y += 2)
        for (let x = Math.ceil(b.x); x < Math.floor(b.x + b.width); x += 2) if (md[(y * W + x) * 4] > 128) faceOpen++;
    });
    return { faces: faces.length, bigFace: Math.round(Math.max(...faces.map((f) => f.width))), kept, faceOpen };
  }, { u, boxes: BOXES });
  // 뒤 포스터 속 아이 얼굴(폭 약 69px)도 잡힌다 — 그래서 크기는 «가장 큰 얼굴»에 댄다
  check('주인공 얼굴을 찾는다 (가장 큰 얼굴 폭 100px 넘음)', r1.bigFace > 100, '얼굴 ' + r1.faces + '개, 가장 큰 폭 ' + r1.bigFace + 'px');
  BOXES.forEach((b) => check(b.what + (b.keep ? ' — 남긴다' : ' — 버린다'), r1.kept.includes(b.what) === b.keep));
  check('사진 전체를 여는 상자를 넣어도 얼굴은 0픽셀 열린다', r1.faceOpen === 0, r1.faceOpen + 'px');

  const has = await page.evaluate(async (url) => { try { const r = await fetch(url, { method: 'HEAD' }); return r.ok; } catch (e) { return false; } }, BASE_URL + '/public/models/mark-int8.onnx');
  if (!has) {
    console.log('\n[2부] 건너뜀 — public/models/mark-int8.onnx 가 없다(41MB, 저장소 밖). 팀자료/모델/에서 복사하면 돈다.');
  } else {
    console.log('\n[2부] 실제 모델로 «로고 지우기» 경로');
    last = null;
    const info = await page.evaluate(async (u) => {
      const T = window.__anshimTest;
      const img = new Image(); img.src = u; await img.decode();
      const f = await T.runFaceDetectionPipeline(u);
      const boxes = await T.detectMarkBoxes(img);
      await T.runEmblemRemovalForTest(img, f.faces, { grade: '중' }, 'none');
      return { w: img.naturalWidth, h: img.naturalHeight, faces: f.faces.map((q) => q.box), nBoxes: boxes.length };
    }, u);
    check('모델이 상자를 낸다', info.nBoxes > 0, info.nBoxes + '개');
    check('요청이 한 번 나간다', !!last);
    if (last) {
      const r = await page.evaluate(async ({ mask, info }) => {
        const M = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + mask; });
        const sw = M.naturalWidth, sh = M.naturalHeight, kx = sw / info.w, ky = sh / info.h;
        const c = document.createElement('canvas'); c.width = sw; c.height = sh; const x = c.getContext('2d'); x.drawImage(M, 0, 0);
        const m = x.getImageData(0, 0, sw, sh).data;
        const on = (p) => m[(Math.round(p.y * ky) * sw + Math.round(p.x * kx)) * 4] > 128;
        let opened = 0, faceOpen = 0;
        for (let i = 0; i < m.length; i += 4) if (m[i] > 128) opened++;
        info.faces.forEach((b) => {
          for (let y = Math.ceil(b.y * ky); y < Math.floor((b.y + b.height) * ky); y += 2)
            for (let xx = Math.ceil(b.x * kx); xx < Math.floor((b.x + b.width) * kx); xx += 2) if (m[(y * sw + xx) * 4] > 128) faceOpen++;
        });
        return { faceOpen, openPct: (opened / (sw * sh) * 100).toFixed(1),
          sleeve: on({ x: 690, y: 560 }), collarL: on({ x: 478, y: 440 }), collarR: on({ x: 572, y: 440 }) };
      }, { mask: last.maskBase64, info });
      check('얼굴은 0픽셀 열린다', r.faceOpen === 0, r.faceOpen + 'px');
      check('소매 세로 글자를 연다 (가슴 띠 밖 — 모델이 더한 자리)', r.sleeve);
      check('빨간 V 칼라는 열지 않는다 (옷 디자인은 그대로)', !r.collarL && !r.collarR);
      check('옷 전체가 아니라 좁게 연다 (사진의 5% 미만)', Number(r.openPct) < 5, r.openPct + '%');
    }
  }

  check('페이지 에러 없음', errs.length === 0, errs.join(' | '));
  await browser.close();
  console.log('\n' + pass + '개 통과, ' + fail + '개 실패');
  if (fail > 0) process.exitCode = 1;
})();
