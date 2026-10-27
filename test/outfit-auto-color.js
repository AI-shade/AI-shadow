// 아이섀도우 — 옷 색 «자동» 테스트
//
// 사용법: 이 폴더(test)에서 → node outfit-auto-color.js
//   프론트가 http://localhost:8000 에서 돌고 있어야 합니다. **AI 호출 없음 (비용 0).**
//
// 왜 필요한가: 멘토 피드백 "옷 색은 자동 인식". 예전에는 옷 색 조합 4개를 사용자가 직접 골랐다.
// 이제는 사진 속 옷 색을 읽어, 그 색과 가장 달라 보이는 조합을 앱이 고른다.
//
// 이 테스트가 지키는 것:
//   ① 원래 옷 색과 같은 계열의 조합은 고르지 않는다 (남색 → 남색 계열을 고르면 바뀐 게 안 보인다)
//   ② 사람이 여럿이면 모두에게서 먼 조합을 고른다
//   ③ 옷 색을 못 읽으면 null (호출부가 기본 색으로 되돌린다)
//   ④ 실제 사진에서 옷 색을 읽어 조합을 고르고, 그 색으로 바꾸면 옷의 색조가 실제로 움직인다
//   색 이름 목록은 모델 출력이 아니라 이 앱의 상수라서, 사진이 아니라 색값으로 고정해 검사한다.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';
const PHOTOS = ['public/self-check/school-sign.jpg', 'public/self-check/playground.jpg'];

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
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.__anshimTest && window.__anshimTest.chooseColorwayAgainstForTest));

  console.log('\n색값으로 고정한 선택');
  const pick = (hexes) => page.evaluate((hexes) => {
    const T = window.__anshimTest;
    const r = T.chooseColorwayAgainstForTest(hexes.map((h) => ({ top: { hex: h } })));
    return r && r.key;
  }, hexes);

  const navy = await pick(['#1F2A55']);
  check('남색 옷 → 스카이 & 네이비가 아니다', navy !== 'navy', navy);
  const brown = await pick(['#7B5230']);
  check('갈색 옷 → 토프 & 브라운이 아니다', brown !== 'brown', brown);
  const forest = await pick(['#24503A']);
  check('진초록 옷 → 크림 & 포레스트가 아니다', forest !== 'green', forest);
  const white = await pick(['#F5F5F5']);
  check('흰 옷 → 그레이가 아니다 (색조가 없는 색은 바뀐 게 안 보인다)', white !== 'gray', white);
  const black = await pick(['#1A1A1A']);
  check('검정 옷 → 그레이가 아니다', black !== 'gray', black);

  // 둘 다에게서 먼 쪽: 남색 + 갈색 아이가 함께 있으면, 각자에게서 가장 가까운 거리가 가장 큰 조합
  const both = await page.evaluate(() => {
    const T = window.__anshimTest;
    const hexes = ['#1F2A55', '#7B5230'];
    const read = hexes.map((h) => ({ top: { hex: h } }));
    const best = T.chooseColorwayAgainstForTest(read);
    const each = hexes.map((h) => T.chooseColorwayAgainstForTest([{ top: { hex: h } }]).key);
    return { key: best.key, dist: best.dist, each };
  });
  check('여럿일 때 거리가 0보다 크다', both.dist > 0, '조합 ' + both.key + ', 거리 ' + both.dist.toFixed(1));

  const none = await page.evaluate(() => {
    const T = window.__anshimTest;
    return [T.chooseColorwayAgainstForTest(null), T.chooseColorwayAgainstForTest([])];
  });
  check('색을 못 읽으면 null (호출부가 기본 색으로 되돌린다)', none[0] === null && none[1] === null);

  console.log('\n실제 사진');
  for (const rel of PHOTOS) {
    const file = path.join(__dirname, '..', rel);
    if (!fs.existsSync(file)) { console.log('  (건너뜀) ' + rel); continue; }
    const u = 'data:image/jpeg;base64,' + fs.readFileSync(file).toString('base64');
    console.log('[' + rel + ']');
    const r = await page.evaluate(async (u) => {
      const T = window.__anshimTest;
      const img = await new Promise((res, j) => { const i = new Image(); i.onload = () => res(i); i.onerror = j; i.src = u; });
      const face = await T.runFaceDetectionPipeline(u);
      const pk = await T.pickAutoColorwayForTest(img, face.faces);
      return { faces: face.faces.length, key: pk.key, read: pk.read ? T.outfitColorsKo(pk.read) : null,
               palettes: T.colorwaysForTest() };
    }, u);
    check('얼굴이 잡힌다 (이 검사의 전제)', r.faces > 0, r.faces + '명');
    check('옷 색을 읽었다', !!r.read, r.read || '못 읽음');
    check('고른 조합은 실제 팔레트다', r.palettes.indexOf(r.key) >= 0 && r.key !== 'keep', r.key);
    console.log('        → 원래 옷: ' + r.read + ' / 자동 선택: ' + r.key);
  }

  check('콘솔 에러가 없다', errs.length === 0, errs.join(' | '));
  console.log('\n결과: ' + pass + '/' + (pass + fail) + ' 통과');
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})();
