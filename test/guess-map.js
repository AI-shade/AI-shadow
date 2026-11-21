/*
 * AI 위치 추측이 «동네·건물»까지 좁히면 장소 카드 지도에 «AI 추측» 원이 그려지는지 잰다(데스크톱).
 * 요청(11-21): "이렇게 위치가 좁혀지면 지도에 표시 되어야하는거 아냐?" — 추측 문장만 있고 지도는 숨어 있었다.
 *   글자 단서가 하나도 없어도 AI 추측(건물)이 있으면 지도가 열리고 «AI 추측» 단계가 있다.
 *   AI 추측이 «광범위»면 지도에 그리지 않는다.
 *
 * 사용법: 이 폴더에서 → node guess-map.js  (프런트가 8000에서). 비용·네트워크 없음.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const IMG = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'fixtures', 'face-only.png')).toString('base64');
const URL = process.env.ANSHIM_URL || 'http://localhost:8000/index.html';
let pass = 0, fail = 0;
const ok = (c, n, d) => { if (c) { pass++; console.log('  ✓ ' + n + (d ? '  ' + d : '')); } else { fail++; console.log('  ✗ ' + n + (d ? '  → ' + d : '')); } };

async function run(browser, guess) {
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await p.route('**/tile.openstreetmap.org/**', (r) => r.abort());
  await p.route('**/api/**', (r) => {
    const u = r.request().url();
    if (u.includes('/api/location-guess')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(guess) });
    if (u.includes('/api/geocode')) {
      const q = r.request().postDataJSON().queries || [];
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: q.map((query) => ({ query, total: 1, places: [{ name: query, address: '서울 송파구 석촌동 1', lat: 37.505, lng: 127.105 }] })) }) });
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ready":false}' });
  });
  await p.goto(URL, { waitUntil: 'load' });
  await p.waitForTimeout(600);
  await p.evaluate(async (IMG) => {
    const T = window.__anshimTest;
    T.setLocCluesForTest({ ocr: { words: [], visualClues: [], landmarks: [] } });
    T.setPastCountForTest(0, IMG);
    T.showScreenForTest('result');
    window.__autoLoadInlineMap();
    await T.runLocCheckForTest({ noOriginal: true });
  }, IMG);
  await p.waitForTimeout(3500);
  const out = await p.evaluate(() => {
    const v = (s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none'; };
    return { map: v('#mapBoxInline'), steps: document.getElementById('mapStepsInline').textContent, why: document.getElementById('mapWhyInline').textContent };
  });
  await p.close();
  return out;
}

(async () => {
  const b = await chromium.launch();
  console.log('\nAI 추측 — 건물까지');
  let o = await run(b, { 구체성: '건물', 추측: '서울 송파구 석촌동의 스튜디오', 근거: '전화번호·지명', 확신: '높음', 지명: '서울 송파구 석촌동' });
  ok(o.map, '지도가 열린다');
  ok(/AI 추측/.test(o.steps), '«AI 추측» 단계가 있다', o.steps.slice(0, 60));
  ok(/석촌동/.test(o.why) && /틀릴 수/.test(o.why), '추측이라 틀릴 수 있다고 말한다', o.why.slice(0, 60));

  console.log('\nAI 추측 — 광범위');
  o = await run(b, { 구체성: '광범위', 추측: '한국의 아파트', 근거: '창밖', 확신: '보통', 지명: '' });
  ok(!o.map, '지도는 열리지 않는다');

  await b.close();
  console.log('\n' + pass + '개 통과, ' + fail + '개 실패');
  process.exit(fail ? 1 : 0);
})();
