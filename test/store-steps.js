/*
 * 장소 지도가 공공 목록 색인(서버 same — 상가·어린이집·학교·학원에서 같은 이름이 전국에 몇 곳인지)을 말하는지 잰다.
 *   전국 1곳인 이름 → «이름만으로 그 가게가 특정돼요»
 *   카카오가 못 찾아도 전국 1곳이면 그 사실을 한 단계로 보여준다(지도 위치 없이)
 *   프랜차이즈(수천 곳) → «전국에 N곳»
 *   색인이 없으면(same 없음) 예전 문구 그대로
 *
 * 사용법: 이 폴더에서 → node store-steps.js  (프런트가 8000에서). 비용·네트워크 없음.
 */
const { chromium } = require('playwright');
const URL = process.env.ANSHIM_URL || 'http://localhost:8000/index.html';

let pass = 0, fail = 0;
const ok = (c, name, d) => { if (c) { pass++; console.log('  ✓ ' + name + (d ? '  ' + d : '')); } else { fail++; console.log('  ✗ ' + name + (d ? '  → ' + d : '')); } };
const 장소 = (name, address, lat, lng) => ({ name, address, lat, lng });

async function steps(browser, words, results) {
  const page = await browser.newPage();
  await page.route('**/api/geocode', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results }) }));
  await page.route('**/api/**', (r) => (r.request().url().includes('/api/geocode') ? r.fallback() : r.fulfill({ status: 200, contentType: 'application/json', body: '{}' })));
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  const out = await page.evaluate(async (words) => {
    window.__anshimTest.setLocCluesForTest({ ocr: { words, visualClues: [], landmarks: [] } });
    return window.__anshimLocMap.getSteps();
  }, words);
  await page.close();
  return out;
}

(async () => {
  const browser = await chromium.launch();

  console.log('\n전국 1곳인 이름 — 카카오도 한 동네');
  let r = await steps(browser, [{ text: '청솔피아노교습소', type: '상호명' }],
    [{ query: '청솔피아노교습소', total: 1, places: [장소('청솔피아노교습소', '대전 유성구 궁동 1', 36.36, 127.34)], same: { count: 1, sigungu: '대전광역시 유성구' } }]);
  ok(r.steps.length === 1 && /전국에 1곳뿐/.test(r.steps[0].why), '«전국에 1곳뿐» 이라고 말한다', r.steps[0] && r.steps[0].why);

  console.log('\n카카오가 못 찾았지만 전국 1곳');
  r = await steps(browser, [{ text: '하늘별미술학원', type: '상호명' }],
    [{ query: '하늘별미술학원', total: 0, places: [], same: { count: 1, sigungu: '경기도 수원시 팔달구' } }]);
  ok(r.steps.length === 1 && r.steps[0].where === '전국 1곳' && r.steps[0].center === null, '지도 위치 없이 «전국 1곳» 단계가 나온다', JSON.stringify(r.steps[0]));

  // 스타벅스 같은 유명 상호는 앱이 원래 장소 이름으로 쓰지 않는다 — 흔한 이름으로 잰다
  console.log('\n흔한 이름(전국 여러 곳)');
  r = await steps(browser, [{ text: '해피피아노학원', type: '상호명' }],
    [{ query: '해피피아노학원', total: 60, places: [장소('해피피아노학원', '대전 서구 둔산동 1', 36.35, 127.38), 장소('해피피아노학원', '서울 강남구 역삼동 1', 37.5, 127.03)], same: { count: 37, sigungu: null } }]);
  ok(r.steps.length === 1 && /전국에 37곳/.test(r.steps[0].why), '«전국에 37곳» 이라고 말한다', JSON.stringify(r));

  console.log('\n색인이 없을 때(same 없음)');
  r = await steps(browser, [{ text: '청솔피아노교습소', type: '상호명' }],
    [{ query: '청솔피아노교습소', total: 1, places: [장소('청솔피아노교습소', '대전 유성구 궁동 1', 36.36, 127.34)] }]);
  ok(r.steps.length === 1 && !/공공 목록/.test(r.steps[0].why), '공공 목록 문장을 붙이지 않는다', r.steps[0] && r.steps[0].why);

  await browser.close();
  console.log('\n' + pass + '개 통과, ' + fail + '개 실패');
  process.exit(fail ? 1 : 0);
})();
