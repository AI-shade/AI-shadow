// 아이섀도우 — 배경 교체 마스크 테스트 (buildBackgroundMask / falSendSize / runBackgroundFill)
//
// 사용법: 이 폴더(test)에서 → node background-mask.js
//   프론트가 http://localhost:8000 에서 돌고 있어야 합니다. AI 호출 없음 (비용 0) —
//   배경 교체 요청은 가로채서 막는다.
//
// 왜: 배경 교체가 kontext(사진 전체를 다시 그리고 "사람은 건드리지 마"라고 부탁)였을 때
// 바지가 청바지로 바뀌었다(팀 제보 "지 맘대로 옷도바꾸고"). 옷 교체처럼 마스크로 막는다 —
// 흰색 = 사람 바깥(다시 그림), 검정 = 사람·얼굴·손(보존). 이 테스트가 지키는 것:
//   ① 얼굴·손·인물 분리 안쪽은 한 픽셀도 열리지 않는다
//   ② 배경(사진 모서리)은 열린다
//   ③ 보내는 크기는 긴 변 1024px, 32의 배수
//   ④ 사람을 못 찾으면 요청을 보내지 않고 멈춘다 — 부탁 방식으로 되돌아가지 않는다

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';
const PHOTOS = ['public/self-check/playground.jpg', 'public/self-check/school-sign.jpg'];
// 얼굴 바로 옆 배경에 있어서, 얼굴 상자를 넉넉히 넓혀 막으면 그대로 남던 자리(마스크를 얹어 눈으로 찾음).
//   school-sign: 아이 머리 왼쪽 뒤 «햇살언…» 간판  ·  playground: 오른쪽 포스터 속 아이 얼굴
const MUST_OPEN = {
  'school-sign.jpg': [{ x: 650, y: 255, what: '얼굴 옆 «햇살언…» 간판' }],
  'playground.jpg': [{ x: 780, y: 355, what: '배경 포스터 속 얼굴' }],
};

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label + (detail ? '  (' + detail + ')' : '')); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '  (' + detail + ')' : '')); }
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  let bgCalls = 0;
  await page.route('**/api/replace-background', (route) => {
    bgCalls++;
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"테스트에서 막음"}' });
  });
  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.__anshimTest && window.__anshimTest.runFaceDetectionPipeline));

  const api = await page.evaluate(() => ({
    mask: typeof window.__anshimTest.buildBackgroundMask,
    size: typeof window.__anshimTest.falSendSizeForTest,
    run: typeof window.__anshimTest.runBackgroundFill,
  }));
  check('buildBackgroundMask · falSendSize · runBackgroundFill이 있다',
    api.mask === 'function' && api.size === 'function' && api.run === 'function', JSON.stringify(api));
  if (api.mask !== 'function' || api.size !== 'function' || api.run !== 'function') {
    await browser.close();
    console.log('\n' + pass + '개 통과, ' + fail + '개 실패');
    process.exitCode = 1;
    return;
  }

  console.log('\n보내는 크기');
  const sz = await page.evaluate(() => ({
    bg: window.__anshimTest.falSendSizeForTest(4032, 3024, 1024),
    bgTall: window.__anshimTest.falSendSizeForTest(3024, 4032, 1024),
    outfit: window.__anshimTest.falSendSizeForTest(4032, 3024),
    small: window.__anshimTest.falSendSizeForTest(800, 600, 1024),
  }));
  check('배경 교체는 긴 변 1024px', sz.bg.w === 1024 && sz.bg.h === 768, JSON.stringify(sz.bg));
  check('세로 사진도 긴 변 1024px', sz.bgTall.w === 768 && sz.bgTall.h === 1024, JSON.stringify(sz.bgTall));
  check('옷 교체는 그대로 1568px', sz.outfit.w === 1568 && sz.outfit.h === 1184, JSON.stringify(sz.outfit));
  check('작은 사진은 키우지 않고 32의 배수로만 맞춘다', sz.small.w === 800 && sz.small.h === 608, JSON.stringify(sz.small));

  for (const rel of PHOTOS) {
    const file = path.join(__dirname, '..', rel);
    const u = 'data:image/jpeg;base64,' + fs.readFileSync(file).toString('base64');
    console.log('\n[' + path.basename(rel) + '] 배경 마스크');
    const m = await page.evaluate(async ({ u, mustOpen }) => {
      const T = window.__anshimTest;
      const img = await new Promise((res, j) => { const i = new Image(); i.onload = () => res(i); i.onerror = j; i.src = u; });
      const w = img.naturalWidth, h = img.naturalHeight;
      const face = await T.runFaceDetectionPipeline(u);
      const boxes = face.faces.map((f) => f.box);
      const hands = await T.detectHandBoxes(img);
      const person = await T.getFullPersonMask(img, 'bgm:' + u.length); // 앱(runBackgroundFill)과 같은 마스크 — 손·팔·다리까지
      const mask = T.buildBackgroundMask(boxes, w, h, person, hands);
      const md = mask.getContext('2d').getImageData(0, 0, w, h).data;
      const pc = document.createElement('canvas'); pc.width = w; pc.height = h;
      pc.getContext('2d').drawImage(person, 0, 0, w, h);
      const pd = pc.getContext('2d').getImageData(0, 0, w, h).data;
      const open = (x, y) => md[(y * w + x) * 4] > 128;
      function openIn(b) {
        let n = 0;
        for (let y = Math.max(0, Math.floor(b.y)); y < Math.min(h, Math.ceil(b.y + b.height)); y++)
          for (let x = Math.max(0, Math.floor(b.x)); x < Math.min(w, Math.ceil(b.x + b.width)); x++) if (open(x, y)) n++;
        return n;
      }
      let opened = 0, personOpened = 0;
      for (let i = 0; i < md.length; i += 4) {
        if (md[i] > 128) { opened++; if (pd[i + 3] > 128) personOpened++; }
      }
      // 인물 분리가 잡은 사람과 겹치는 얼굴·손만 «이 사람의 것»이다. 포스터·행인의 얼굴은 배경이다.
      function onPerson(b) {
        let n = 0, on = 0;
        for (let y = Math.max(0, Math.floor(b.y)); y < Math.min(h, Math.ceil(b.y + b.height)); y += 2)
          for (let x = Math.max(0, Math.floor(b.x)); x < Math.min(w, Math.ceil(b.x + b.width)); x += 2) {
            n++; if (pd[(y * w + x) * 4 + 3] > 128) on++;
          }
        return n > 0 && on / n >= 0.15;
      }
      const ownFaces = boxes.filter(onPerson), ownHands = hands.filter(onPerson);
      return {
        size: mask.width + 'x' + mask.height, same: mask.width === w && mask.height === h,
        faces: ownFaces.length + '/' + boxes.length, hands: ownHands.length + '/' + hands.length,
        faceOpen: ownFaces.reduce((s, b) => s + openIn(b), 0),
        handOpen: ownHands.reduce((s, b) => s + openIn(b), 0),
        personOpened, openPct: (opened / (w * h) * 100).toFixed(1),
        corners: [open(2, 2), open(w - 3, 2)],
        mustOpen: mustOpen.map((p) => ({ what: p.what, open: open(p.x, p.y) })),
      };
    }, { u, mustOpen: MUST_OPEN[path.basename(rel)] || [] });
    check('마스크 크기가 사진과 같다', m.same, m.size);
    check('사람의 얼굴은 열리지 않는다', m.faceOpen === 0, '사람 얼굴/찾은 얼굴 ' + m.faces + ', 열린 ' + m.faceOpen + 'px');
    check('사람의 손은 열리지 않는다', m.handOpen === 0, '사람 손/찾은 손 ' + m.hands + ', 열린 ' + m.handOpen + 'px');
    m.mustOpen.forEach((p) => check(p.what + '은 다시 그린다', p.open));
    check('사람(인물 분리 안쪽)은 열리지 않는다', m.personOpened === 0, m.personOpened + 'px');
    check('배경(위쪽 모서리)은 열린다', m.corners.every(Boolean), JSON.stringify(m.corners));
    check('사진의 30~95%가 열린다', Number(m.openPct) >= 30 && Number(m.openPct) <= 95, m.openPct + '%');
  }

  console.log('\n사람이 없는 사진');
  const noPerson = await page.evaluate(async () => {
    const T = window.__anshimTest;
    const c = document.createElement('canvas'); c.width = 640; c.height = 480;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 640, 480);
    g.addColorStop(0, '#88aacc'); g.addColorStop(1, '#335577');
    x.fillStyle = g; x.fillRect(0, 0, 640, 480);
    const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = c.toDataURL('image/png'); });
    try {
      await T.runBackgroundFill(img, [], null, null);
      return { threw: false };
    } catch (e) {
      return { threw: true, noPerson: !!e.noPerson, msg: e.message };
    }
  });
  check('사람을 못 찾으면 멈춘다', noPerson.threw && noPerson.noPerson, JSON.stringify(noPerson));
  check('그때 배경 교체 요청을 보내지 않는다', bgCalls === 0, bgCalls + '회');

  check('페이지 에러 없음', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log('\n' + pass + '개 통과, ' + fail + '개 실패');
  if (fail > 0) process.exitCode = 1;
})();
