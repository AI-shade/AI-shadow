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

  check('보정 결과가 있으면 «남은 곳 문질러서 가리기»가 보인다', r.barShown);
  check('가리기를 켜기 전에는 눌러도 바뀌지 않는다', r.offSame);
  check('켜고 누르면 그 자리가 흐려진다', r.changed);
  check('되돌리기 단추가 나타난다', r.undoShown);
  check('아이 얼굴 근처는 눌러도 바뀌지 않는다', r.faceSame);
  check('3단계 검증에 넘기는 기록에 직접 가린 곳 수가 남는다', r.metaHas);
  check('하나 되돌리기로 원래대로 돌아온다', r.undone);

  // 문질러서 가리기(11-23): 실제 마우스로 누른 채 가로로 끌면 지나간 줄이 다 흐려지고, 되돌리기 한 번에 통째로 돌아온다.
  // 흑백 무늬 사진을 써서 흐려진 칸을 정확히 센다. 화면이 누를 때 위로 밀리지 않는지도 본다(예전 컴퓨터에서 26px).
  console.log('\n문질러서 가리기');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(async () => {
    const T = window.__anshimTest; T.showScreenForTest && T.showScreenForTest('correct');
    const t = T.tapCover, c = document.createElement('canvas'); c.width = 1200; c.height = 800;
    const x = c.getContext('2d');
    for (let yy = 0; yy < 800; yy += 8) for (let xx = 0; xx < 1200; xx += 8) { x.fillStyle = ((xx + yy) / 8) % 2 ? '#000' : '#fff'; x.fillRect(xx, yy, 8, 8); }
    // 얼굴 상자는 오른쪽 끝(x 1000~1100, y 340~460) — 끄는 줄이 이 상자를 지나간다
    t.setup({ photo: c.toDataURL(), canvas: c, faces: [{ box: { x: 1000, y: 340, width: 100, height: 120 } }], meta: { method: 'auto', detail: '자동 보정' } });
    const e = document.getElementById('previewAfter'); e.src = c.toDataURL('image/png'); await e.decode();
    t.set(true); window.__c = c; e.scrollIntoView({ block: 'center' });
    window.__before = x.getImageData(0, 0, 1200, 800).data.slice();
  });
  await page.waitForTimeout(400);
  const rect = await page.evaluate(() => { const r = document.getElementById('previewAfter').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, sy: scrollY }; });
  const P = (fx, fy) => [rect.x + rect.w * fx, rect.y + rect.h * fy];
  await page.mouse.move(...P(0.1, 0.5)); await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(...P(0.1 + 0.8 * i / 12, 0.5));
  await page.mouse.up();
  await page.waitForTimeout(500);
  const d = await page.evaluate(() => {
    const a = window.__before, now = window.__c.getContext('2d').getImageData(0, 0, 1200, 800).data;
    const changed = (x0, x1, y) => { let n = 0, t = 0; for (let x = x0; x < x1; x += 4) { t++; const i = (y * 1200 + x) * 4; if (a[i] !== now[i]) n++; } return n / t; };
    const r = document.getElementById('previewAfter').getBoundingClientRect();
    return { line: changed(140, 960, 400), above: changed(140, 960, 200), face: changed(1010, 1090, 400), undoShown: document.getElementById('tapCoverUndo').style.display !== 'none', top: r.top, sy: scrollY };
  });
  check('끈 줄(가로 0.1~0.8)이 빈틈없이 흐려진다', d.line > 0.95, (d.line * 100).toFixed(0) + '%');
  check('끈 줄에서 먼 곳은 그대로다', d.above === 0, (d.above * 100).toFixed(0) + '%');
  check('끄는 줄이 지나간 아이 얼굴 상자는 그대로다', d.face === 0, (d.face * 100).toFixed(0) + '%');
  check('누른 뒤 화면이 위아래로 밀리지 않는다', Math.abs(d.top - rect.y) < 2 && d.sy === rect.sy, Math.round(rect.y) + '→' + Math.round(d.top));
  await page.click('#tapCoverUndo');
  const back = await page.evaluate(() => { const a = window.__before, now = window.__c.getContext('2d').getImageData(0, 0, 1200, 800).data; let n = 0; for (let i = 0; i < a.length; i += 16) if (a[i] !== now[i]) n++; return n; });
  check('되돌리기 한 번에 문지른 줄 전체가 돌아온다', back === 0, back + '칸 남음');

  check('페이지 에러 없음', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log('\n' + pass + '개 통과, ' + fail + '개 실패');
  process.exit(fail ? 1 : 0);
})();
