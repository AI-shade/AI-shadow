// 남은 곳 눌러서 가리기 — 누른 자리만 흐려지고, 아이 얼굴 근처는 막히고, 되돌리기가 원래대로 돌린다
//
// 사용법: 이 폴더(test)에서 → node tap-cover.js
//   프론트가 http://localhost:8000 에서 돌고 있어야 합니다. AI 호출 없음 (비용 0).

const { chromium } = require('playwright');
const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';
const PHOTO = '/public/self-check/school-sign.jpg'; // 880x880, 왼쪽 입간판, 오른쪽 아이(얼굴 대략 x 700~860, y 130~330)

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label + (detail ? '  (' + detail + ')' : '')); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '  (' + detail + ')' : '')); }
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);

  await page.waitForFunction(() => !!(window.__anshimTest && window.__anshimTest.tapCover), null, { timeout: 15000 });
  const r = await page.evaluate(async (photo) => {
    const T = window.__anshimTest.tapCover;
    const img = await T.loadImage(photo);
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    T.setup({ photo, canvas: c, faces: [{ box: { x: 720, y: 140, width: 130, height: 170 } }], meta: { method: 'auto', detail: '자동 보정' } });
    const barShown = document.getElementById('tapCoverBar').style.display !== 'none';
    const sum = (x, y, w, h) => { const d = c.getContext('2d').getImageData(x, y, w, h).data; let t = 0; for (let i = 0; i < d.length; i += 4) t += d[i] + d[i + 1] + d[i + 2]; return t; };
    const fake = (x, y) => ({ currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0, width: c.width, height: c.height }) }, clientX: x, clientY: y });
    const signBefore = sum(150, 580, 60, 60), faceBefore = sum(740, 160, 80, 80);
    // 꺼져 있을 때는 눌러도 안 바뀐다
    await T.at(fake(180, 610));
    const offSame = sum(150, 580, 60, 60) === signBefore;
    T.set(true);
    await T.at(fake(180, 610));               // 입간판 글자 자리
    const signAfter = sum(150, 580, 60, 60);
    const undoShown = document.getElementById('tapCoverUndo').style.display !== 'none';
    await T.at(fake(780, 220));               // 아이 얼굴 한가운데
    const faceAfter = sum(740, 160, 80, 80);
    const metaHas = /직접 흐리게 가린 곳 1곳/.test(T.meta().detail);
    document.getElementById('tapCoverUndo').click();
    const signUndo = sum(150, 580, 60, 60);
    return { barShown, offSame, changed: signAfter !== signBefore, faceSame: faceAfter === faceBefore, undoShown, metaHas, undone: signUndo === signBefore };
  }, PHOTO);

  check('보정 결과가 있으면 «남은 곳 눌러서 가리기»가 보인다', r.barShown);
  check('가리기를 켜기 전에는 눌러도 바뀌지 않는다', r.offSame);
  check('켜고 누르면 그 자리가 흐려진다', r.changed);
  check('되돌리기 단추가 나타난다', r.undoShown);
  check('아이 얼굴 근처는 눌러도 바뀌지 않는다', r.faceSame);
  check('3단계 검증에 넘기는 기록에 직접 가린 곳 수가 남는다', r.metaHas);
  check('하나 되돌리기로 원래대로 돌아온다', r.undone);
  check('페이지 에러 없음', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log('\n' + pass + '개 통과, ' + fail + '개 실패');
  process.exit(fail ? 1 : 0);
})();
