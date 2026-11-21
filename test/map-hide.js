/*
 * 좁혀지는 곳이 없으면 장소 카드에 지도를 띄우지 않는지 잰다(데스크톱).
 * 요청(11-21): "장소특정되는곳이 없으면 걍 지도를 띄우지마"
 *   단서가 하나도 없음 → 오른쪽 칸(지도·문장) 통째로 숨김, 왼쪽이 가로 전체
 *   문장은 있는데 찍을 자리가 없음(카카오 0건 · 공공 목록 전국 1곳) → 지도만 숨기고 문장은 보임
 *   찍을 자리가 있음 → 지도 보임
 * 함께: 진단 결과에는 «구글로 같은 사진 찾기» 단추가 없다(«내 정보»로 옮겼다).
 *
 * 사용법: 이 폴더에서 → node map-hide.js  (프런트가 8000에서). 비용·네트워크 없음(지도 조각은 막는다).
 */
const { chromium } = require('playwright');
const URL = process.env.ANSHIM_URL || 'http://localhost:8000/index.html';
let pass = 0, fail = 0;
const ok = (c, n, d) => { if (c) { pass++; console.log('  ✓ ' + n + (d ? '  ' + d : '')); } else { fail++; console.log('  ✗ ' + n + (d ? '  → ' + d : '')); } };

async function run(browser, words, geocode) {
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await p.route('**/tile.openstreetmap.org/**', (r) => r.abort());
  await p.route('**/api/**', (r) => {
    const u = r.request().url();
    if (u.includes('/api/geocode')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(geocode) });
    if (u.includes('/api/location-check')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ found: false }) });
    if (u.includes('/api/location-guess')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ 구체성: '특정불가', 근거: '벽뿐' }) });
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ready":false}' });
  });
  await p.goto(URL, { waitUntil: 'load' });
  await p.waitForTimeout(600);
  await p.evaluate((words) => {
    const T = window.__anshimTest;
    T.setLocCluesForTest({ ocr: { words, visualClues: [], landmarks: [] } });
    T.showScreenForTest('result');
    window.__autoLoadInlineMap();
  }, words);
  await p.waitForTimeout(2500);
  const v = (sel) => p.evaluate((s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none'; }, sel);
  const out = { right: await v('#screen-result .loc-right'), map: await v('#mapBoxInline'), why: await v('#mapWhyInline'),
    leftW: await p.evaluate(() => Math.round(document.querySelector('#screen-result .loc-left').getBoundingClientRect().width)),
    cardW: await p.evaluate(() => Math.round(document.querySelector('#screen-result .rcard-location').getBoundingClientRect().width)) };
  return { p, out };
}

(async () => {
  const b = await chromium.launch();

  console.log('\n단서가 하나도 없음');
  let { p, out } = await run(b, [], { results: [] });
  // 11-21: 오른쪽 칸은 좌표·AI 추측 결과를 담아 남을 수 있다 — 지도와 단계 설명만 숨는다
  ok(!out.map && !out.why, '지도와 지도 설명이 안 보인다');
  ok(out.leftW > out.cardW * 0.8, '왼쪽 칸이 가로 전체를 쓴다', out.leftW + '/' + out.cardW);
  await p.close();

  console.log('\n문장은 있는데 찍을 자리가 없음(전국 1곳 · 카카오 0건)');
  ({ p, out } = await run(b, [{ text: '하늘별미술학원', type: '상호명' }],
    { results: [{ query: '하늘별미술학원', total: 0, places: [], same: { count: 1, sigungu: '경기도 수원시 팔달구' } }] }));
  ok(out.right && out.why, '문장은 보인다');
  ok(!out.map, '지도는 안 보인다');
  await p.close();

  console.log('\n찍을 자리가 있음');
  ({ p, out } = await run(b, [{ text: '청솔피아노교습소', type: '상호명' }],
    { results: [{ query: '청솔피아노교습소', total: 1, places: [{ name: '청솔피아노교습소', address: '대전 유성구 궁동 1', lat: 36.36, lng: 127.34 }], same: { count: 1, sigungu: '대전광역시 유성구' } }] }));
  ok(out.right && out.map, '지도가 보인다');

  // «구글로 같은 사진 찾기»는 «내 정보»로 옮겼다(11-21) — 진단 결과에서는 늘 안 보인다
  const btn = await p.evaluate(async () => {
    const T = window.__anshimTest;
    T.setPastCountForTest(0, 'data:image/gif;base64,R0lGODlhAQABAAAAACw=');
    await T.runLocCheckForTest({ noOriginal: true });
    return getComputedStyle(document.getElementById('locWebCheckBtn')).display;
  });
  ok(btn === 'none', '진단 결과에 구글 찾기 단추가 없다', btn);
  await p.close();

  await b.close();
  console.log('\n' + pass + '개 통과, ' + fail + '개 실패');
  process.exit(fail ? 1 : 0);
})();
