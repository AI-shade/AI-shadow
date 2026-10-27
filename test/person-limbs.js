// 아이섀도우 — 손·팔·다리가 잘리지 않는 인물 마스크 테스트 (배경 흐림 · AI 배경 교체)
//
// 사용법: 이 폴더(test)에서 → node person-limbs.js
//   프론트가 http://localhost:8000 에서 돌고 있어야 합니다. **AI 호출 없음 (비용 0).**
//   정답표 사진(사진 100장 분석/)은 gitignore라 없으면 그 검사는 건너뜁니다.
//
// 왜 필요한가: 멘토 시연에서 "손이나 팔이 잘린다". 원인(2026-10-06 실측, 103장)은 getPersonMask의
// 2분류 모델이 몸에서 떨어진 손·팔·다리를 배경으로 보는 것이었다 — 마스크가 쓸 만했던 98장 중 33장에서
// 맨살의 3% 넘게 빠졌다. getFullPersonMask가 옷 분할 모델의 «배경이 아닌 곳»을 합쳐 그 구멍을 메운다.
//
// 이 테스트가 지키는 것:
//   ① 사람 밖으로 빠지던 맨살(손·팔·다리)이 거의 0으로 줄어든다
//   ② 합치다가 간판 같은 별개 물체를 사람으로 끌어들이지 않는다 — 처음 구현(겹침 10%)은 사진6에서
//      «햇살어린이집» 간판 아랫부분이 사람으로 딸려 들어와 글자가 선명하게 남았다. 이건 이 서비스가 막으려는
//      결과 그 자체라, 눈으로 보고서야 잡았다. 추가 면적이 작은지를 숫자로 고정한다.
//   ③ 어떤 사진도 나빠지지 않는다 (빠지는 맨살이 늘지 않는다)

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';
const DIR = path.join(__dirname, '..', '사진 100장 분석');
// [번호, 확장자, 설명] — 손·팔·다리가 뻗은 사진 + 간판이 곁에 있는 사진 + 변화가 없어야 하는 사진
const PHOTOS = [
  ['52', 'png', '브이 한 손', 'limb'],
  ['5', 'png', '붓 든 손', 'limb'],
  ['39', 'jpg', '발차기 다리', 'limb'],
  ['6', 'png', '간판이 곁에 있는 사진', 'sign'],
  ['1', 'png', '팔을 내린 사진 (변화 없어야 함)', 'plain'],
];

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label + (detail ? '  (' + detail + ')' : '')); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '  (' + detail + ')' : '')); }
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.__anshimTest && window.__anshimTest.getFullPersonMask));

  for (const [n, ext, label, kind] of PHOTOS) {
    const file = path.join(DIR, '사진' + n + '.' + ext);
    if (!fs.existsSync(file)) { console.log('\n[사진' + n + '] (건너뜀) 파일 없음'); continue; }
    console.log('\n[사진' + n + '] ' + label);
    const u = 'data:image/' + (ext === 'jpg' ? 'jpeg' : 'png') + ';base64,' + fs.readFileSync(file).toString('base64');
    const r = await page.evaluate(async (u) => {
      const T = window.__anshimTest;
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u; });
      const base = await T.getPersonMask(img, 'pl-a:' + u.length);
      const full = await T.getFullPersonMask(img, 'pl-b:' + u.length);
      const cl = await T.getClothesMask(img, 'pl-c:' + u.length, false);
      if (!base || !full || !cl || !cl._skin) return { err: '마스크를 못 만듦' };
      const w = cl._skin.width, h = cl._skin.height;
      const rd = (cv) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.drawImage(cv, 0, 0, w, h); return x.getImageData(0, 0, w, h).data; };
      const sk = rd(cl._skin), b = rd(base), f = rd(full);
      let skin = 0, outBefore = 0, outAfter = 0, addedPx = 0;
      for (let i = 3; i < sk.length; i += 4) {
        if (f[i] >= 128 && b[i] < 128) addedPx++;
        if (sk[i] < 128) continue;
        skin++;
        if (b[i] < 128) outBefore++;
        if (f[i] < 128) outAfter++;
      }
      return { skin, outBefore, outAfter, addedPct: addedPx / (w * h) * 100, limbs: !!full._limbs };
    }, u);
    if (r.err) { check('마스크가 만들어진다', false, r.err); continue; }
    const before = r.outBefore / Math.max(1, r.skin) * 100, after = r.outAfter / Math.max(1, r.skin) * 100;
    check('팔다리 합치기가 동작한다 (2분류 그대로가 아니다)', r.limbs);
    if (kind === 'limb') {
      check('고치기 전에는 맨살이 사람 밖으로 빠진다 (이 검사의 전제)', before > 3, before.toFixed(1) + '%');
      check('고친 뒤 빠진 맨살이 1% 미만이다', after < 1, before.toFixed(1) + '% → ' + after.toFixed(1) + '%');
    }
    check('빠지는 맨살이 늘지 않는다', r.outAfter <= r.outBefore, r.outBefore + ' → ' + r.outAfter + ' px');
    check('추가된 면적이 작다 (사진의 2% 미만) — 간판 같은 물체를 끌어들이지 않는다', r.addedPct < 2, r.addedPct.toFixed(2) + '%');
  }

  check('콘솔 에러가 없다', errs.length === 0, errs.join(' | '));
  console.log('\n결과: ' + pass + '/' + (pass + fail) + ' 통과');
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})();
