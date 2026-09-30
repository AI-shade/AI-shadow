/*
 * 진단 결과의 「장소 지도」 시트 검사 (폰 전용).
 *
 * 폰에서는 "장소 특정 가능성" 카드가 통째로 숨어 있어서, 사진 한 장으로 장소가 어디까지 좁혀지는지가
 * 화면에 없었다. 이제 오각형 아래 칩 줄 맨 앞의 「📍 장소 지도」를 누르면 하단 시트가 올라와서,
 * 이 사진에서 실제로 찾은 단서(사진 속 장소 글자·지역 글자·파일 좌표)로 반경 원이 단계마다 줄어든다.
 * 이름만으로는 대개 안 좁혀진다("햇살어린이집"은 전국 175건) — 하나로 좁혀지는 원 대신, 찾은 곳들을
 * (카카오가 주는 최대 5곳) 낱개 핑으로 지도에 찍어서 "이렇게 흩어져 있다"를 보여준다.
 * 반경으로 좁혀지는 단계에는 원 하나만 그리고 핑은 안 찍는다(건물 하나를 콕 찍으면 안 된다).
 *
 * 사용법: 이 폴더에서 → node loc-map.js   (프런트가 8000 또는 ANSHIM_URL에서 돌고 있어야 함)
 * 비용 없음: 카카오 응답은 고정값으로 흉내 내고(/api/geocode를 가로챔), 지도 조각(타일)은 막는다.
 * Leaflet 스크립트만 CDN에서 받는다.
 */
const { chromium } = require('playwright');
const URL = process.env.ANSHIM_URL || 'http://localhost:8000/index.html';

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

const 결과 = {
  score: 60, grade: '중',
  riskFactors: [
    { 항목: '간판·주소 노출', 점수: 0, 상한: 26, 근거: '없음' },
    { 항목: '소속 노출', 점수: 22, 상한: 22, 근거: '교복과 명찰.' },
    { 항목: '캡션 노출', 점수: 18, 상한: 18, 근거: '학교명.' },
  ],
  uploadTiming: '실시간 업로드', privacySetting: '전체공개',
  locationScore: 78, locationEvidence: '학교가 좁혀져요.',
  scheduleOn: false, scheduleEvidence: '', schedulePatterns: [], schedulePredicted: '',
  actions: ['마크를 지워주세요.'], summary: '요약', captionSuggestions: ['1', '2', '3'],
};

// 카카오가 돌려주는 모양 그대로(server.js /api/geocode)
const 장소 = (name, address, lat, lng) => ({ name, address, lat, lng });
const 햇살전국 = { query: '햇살어린이집', total: 175, places: [
  장소('햇살어린이집', '제주특별자치도 제주시 도남동 797-4', 33.4935, 126.5222),
  장소('햇살어린이집', '전남 광양시 중동 1667', 34.9314, 127.6921),
  장소('햇살어린이집', '경북 상주시 냉림동 134-7', 36.4240, 128.1642),
] };
const 햇살유성 = { query: '유성구 햇살어린이집', total: 4, places: [
  장소('효성햇살어린이집', '대전 유성구 문지동 6', 36.4380, 127.4030),
  장소('나무를키우는햇살어린이집', '대전 유성구 신성동 1', 36.4260, 127.3950),
  장소('경성햇살어린이집', '대전 서구 갈마동 14', 36.3520, 127.3690),   // 다른 구 — 걸러져야 한다
] };
const 충남대 = { query: '충남대학교', total: 2451, places: [
  장소('충남대학교 대덕캠퍼스', '대전 유성구 궁동 220', 36.3688, 127.3468),
  장소('충남대학교 대덕캠퍼스 정문', '대전 유성구 궁동 220', 36.3626, 127.3448),
] };
const 없음 = (q) => ({ query: q, total: 0, places: [] });

const 단서 = {
  전국_지역: { // 이름만으로는 안 좁혀지고, 지역 글자가 붙으면 좁혀진다
    ocr: { words: [{ text: '햇살어린이집', type: '상호명' }, { text: '원생모집', type: '안내문' }, { text: '유성구', type: '주소' }], visualClues: [] },
    geocode: { results: [햇살전국, 햇살유성] },
  },
  유일한_이름: { ocr: { words: [{ text: '충남대학교', type: '간판' }], visualClues: [] }, geocode: { results: [충남대] } },
  없음: { ocr: { words: [], visualClues: [] } },
  파일좌표: { ocr: { words: [], visualClues: [] }, exif: { hasGps: true, lat: 36.3665, lng: 127.3445 } },
};

async function 열기(browser, viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, locale: 'ko-KR', reducedMotion: opts.reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  const errs = [];
  const 요청 = { 타일: [], 검색: [] };
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.route('**/tile.openstreetmap.org/**', (r) => { 요청.타일.push(r.request().url()); r.abort(); });
  await page.route('**/api/geocode', (r) => {
    요청.검색.push(r.request().postDataJSON());
    if (opts.검색실패) return r.fulfill({ status: opts.검색실패, contentType: 'application/json', body: JSON.stringify({ error: 'x', results: [] }) });
    const 응답 = (opts.단서 && opts.단서.geocode) || { results: [] };
    // 요청한 검색어마다 답을 맞춘다(없는 검색어는 0건)
    const q = r.request().postDataJSON().queries;
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      results: q.map((x) => 응답.results.find((y) => y.query === x) || 없음(x)) }) });
  });
  if (opts.leafletDown) await page.route('**/leaflet@1.9.4/**', (r) => r.abort());
  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(800);
  await page.evaluate(({ R, 단서 }) => {
    const T = window.__anshimTest;
    T.showScreenForTest('result'); T.stopScoreTickerForTest();
    T.renderResultForTest(R, { faces: [] }, (단서 && 단서.ocr) || { words: [], visualClues: [] });
    T.setLocCluesForTest({ ocr: 단서 && 단서.ocr, exif: 단서 && 단서.exif, caption: (단서 && 단서.caption) || '' });
    // 실제 흐름에서는 위험도진단이 끝나면 이걸 자동으로 부른다(데스크톱만 — 폰이면 안에서 그냥 빠진다).
    // 테스트는 진단 자체를 건너뛰므로 직접 불러 흉내낸다.
    if (window.__autoLoadInlineMap) window.__autoLoadInlineMap();
  }, { R: 결과, 단서: opts.단서 || null });
  await page.waitForTimeout(400);
  return { ctx, page, errs, 요청 };
}
const 열림 = (page) => page.evaluate(() => document.getElementById('screen-result').classList.contains('map-open'));
const 그려짐 = (page, sel) => page.evaluate((q) => {
  const el = document.querySelector(q);
  return !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
}, sel);
const 켜진단계 = (page) => page.evaluate(() => [...document.querySelectorAll('.map-step')].map((b) => b.classList.contains('on')));
const 지도준비 = (page) => page.waitForFunction(() => window.L && document.querySelector('#mapBox .leaflet-pane') && document.querySelectorAll('.map-step').length > 0, null, { timeout: 15000 });
const 지도준비Inline = (page) => page.waitForFunction(() => window.L && document.querySelector('#mapBoxInline .leaflet-pane') && document.querySelectorAll('#mapStepsInline .map-step').length > 0, null, { timeout: 15000 });
const 원수Inline = (page) => page.evaluate(() => document.querySelectorAll('#mapBoxInline path.leaflet-interactive').length);
const 원수 = (page) => page.evaluate(() => document.querySelectorAll('#mapBox path.leaflet-interactive').length);
const 단계글 = (page) => page.$$eval('.map-step', (b) => b.map((x) => x.textContent));

(async () => {
  const browser = await chromium.launch();
  const 기본 = { 단서: 단서.전국_지역 };

  console.log('칩');
  {
    const { ctx, page, errs, 요청 } = await 열기(browser, { width: 390, height: 844 }, 기본);
    const 첫 = await page.$eval('#factorChips', (el) => el.firstElementChild.className + '|' + el.firstElementChild.textContent);
    ok(첫.startsWith('map-chip|') && 첫.includes('장소 지도'), '칩 줄 맨 앞이 «장소 지도»다', 첫);
    ok((await page.$$eval('.factor-chip', (els) => els.length)) === 3, '항목 칩은 그대로 3개다');
    ok(await page.$eval('.map-chip', (e) => e.tagName === 'BUTTON' && e.getAttribute('aria-haspopup') === 'dialog'), '진짜 <button>이고 대화상자를 연다고 알린다');
    ok((await 그려짐(page, '#mapSheet')) === false, '닫힌 시트는 안 보인다');
    ok((await page.evaluate(() => typeof window.L)) === 'undefined', '열기 전에는 지도 라이브러리를 받지 않는다');
    ok(요청.검색.length === 0, '열기 전에는 장소 검색을 부르지 않는다 (쿼터를 아낀다)');
    ok(errs.length === 0, '페이지 에러 없음', errs.join(' | '));
    await ctx.close();
  }

  console.log('\n이 사진의 단서로 단계가 만들어진다 (이름만은 안 좁혀지고, 지역이 붙으면 좁혀진다)');
  {
    const { ctx, page, errs, 요청 } = await 열기(browser, { width: 390, height: 844 }, 기본);
    await page.click('.map-chip');
    await 지도준비(page);
    ok(await 열림(page), '칩을 누르면 시트가 열린다');
    ok(await 그려짐(page, '#mapSheet'), '시트가 보인다');
    ok((await page.$eval('#mapSheet', (e) => e.getAttribute('role') + '/' + e.getAttribute('aria-modal'))) === 'dialog/true', '열리면 대화상자 역할이 붙는다');
    ok((await page.evaluate(() => document.activeElement.className)).includes('sheet-close'), '열리면 ✕로 포커스가 간다');

    ok(요청.검색.length === 1, '지도를 열면 장소 검색을 한 번 부른다', 요청.검색.length + '번');
    const 본문 = 요청.검색[0];
    ok(Object.keys(본문).join() === 'queries', '사진은 안 보낸다 — 검색어만 간다', Object.keys(본문).join());
    ok(JSON.stringify(본문.queries) === JSON.stringify(['햇살어린이집', '원생모집', '유성구 햇살어린이집', '유성구 원생모집']),
      '장소 글자와 「지역 + 장소 글자」를 검색한다 (지역만 적힌 «유성구»는 이름으로 안 보낸다)', JSON.stringify(본문.queries));

    const 글 = await 단계글(page);
    ok(글.length === 2, '단서가 만든 단계는 둘이다 (검색 결과가 0건인 «원생모집»은 단계가 못 된다)', 글.join(' / '));
    ok(글[0].includes('햇살어린이집') && 글[0].includes('전국 175건'), '① 이름만: 전국 175건 — 안 좁혀진다', 글[0]);
    ok(글[1].includes('유성구') && /반경 약 [\d.]+(m|km)/.test(글[1]), '② 지역 글자가 붙으면 반경으로 좁혀진다', 글[1]);
    ok(!/문지동 6|신성동 1|갈마/.test(await page.$eval('#mapSheet', (e) => e.textContent)), '다른 구 결과는 걸러지고, 번지까지는 화면에 안 나온다');
    ok((await page.$eval('#mapWhy', (e) => e.textContent)).includes('흩어져'), '① 단계의 설명은 "전국에 흩어져 있어서 안 좁혀져요"다');

    // ① 은 반경 원 대신 낱개 핑 3개(햇살전국 mock 3곳), 스스로 ②로 좁혀지면 핑은 지고 원 하나만 남는다
    ok((await 켜진단계(page))[0] === true, '처음엔 ① 이름만에서 시작한다');
    ok((await 원수(page)) === 3, '① 에서는 찾은 곳마다 낱개 핑이 찍힌다 (원 대신)', await 원수(page));
    await page.waitForFunction(() => document.querySelectorAll('.map-step')[1].classList.contains('on'), null, { timeout: 8000 });
    ok(true, '스스로 ② 단계로 좁혀진다');
    ok((await 원수(page)) === 1, '② 에서는 핑이 지고 반경 원 하나만 남는다');
    ok((await page.evaluate(() => document.querySelectorAll('#mapBox .leaflet-marker-icon').length)) === 0, '기본 마커 아이콘(핀 그림)은 안 쓴다 — 원 모양 핑만 찍는다');
    ok((await page.$eval('#mapWhy', (e) => e.textContent)).includes('대전 유성구'), '② 설명은 시·구까지만 말한다', await page.$eval('#mapWhy', (e) => e.textContent));
    ok((await page.evaluate(() => !!document.querySelector('#mapBox .leaflet-control-attribution a[href*="openstreetmap"]'))), '지도 저작자(OpenStreetMap) 표시가 있다');
    ok(요청.타일.length > 0 && 요청.타일.every((u) => /\/(\d|1[0-6])\/\d+\/\d+\.png$/.test(u)), '거리 단위(17단계 이상) 타일은 요청하지 않는다', 요청.타일.length + '건');

    // 누르면 그 단계로, 자동 진행은 멈춘다
    await page.click('.map-step:nth-child(1)');
    ok((await 켜진단계(page)).join() === 'true,false', '단계를 누르면 그 단계가 켜진다');
    ok((await page.$eval('.map-step:nth-child(1)', (e) => e.getAttribute('aria-pressed'))) === 'true', '켜진 단계는 aria-pressed=true다');
    await page.waitForTimeout(1600);
    ok((await 켜진단계(page)).join() === 'true,false', '누른 뒤에는 자동으로 넘어가지 않는다');
    ok((await 원수(page)) === 3, '① 로 돌아가면 반경 원 대신 핑 3개가 다시 찍힌다');
    const 폭 = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
    ok(폭.sw <= 폭.iw, '옆으로 넘치지 않는다', `${폭.sw} ≤ ${폭.iw}`);
    ok(errs.length === 0, '페이지 에러 없음', errs.join(' | '));
    await ctx.close();
  }

  console.log('\n다른 단서 조합');
  {
    const { ctx, page, 요청 } = await 열기(browser, { width: 390, height: 844 }, { 단서: 단서.유일한_이름 });
    await page.click('.map-chip');
    await 지도준비(page);
    const 글 = await 단계글(page);
    ok(글.length === 1 && /반경 약/.test(글[0]), '이름 하나로 한 동네에 모이면 그대로 원이 된다 (충남대학교)', 글.join(' / '));
    await page.waitForTimeout(500);
    ok((await 원수(page)) === 1, '원이 그려진다');
    ok((await 켜진단계(page)).join() === 'true', '단계가 하나면 그 단계가 바로 켜진다');
    await ctx.close();
  }
  {
    const { ctx, page, 요청 } = await 열기(browser, { width: 390, height: 844 }, { 단서: 단서.파일좌표 });
    await page.click('.map-chip');
    await 지도준비(page);
    ok(요청.검색.length === 0, '장소 글자가 없으면 장소 검색을 안 부른다');
    const 글 = await 단계글(page);
    ok(글.length === 1 && 글[0].includes('사진 파일의 좌표') && 글[0].includes('반경 약 50m'), '파일 좌표는 핀이 아니라 반경 50m 원이다', 글.join(' / '));
    await page.waitForTimeout(500);
    ok((await 원수(page)) === 1, '원이 그려진다');
    await ctx.close();
  }
  {
    const { ctx, page, 요청 } = await 열기(browser, { width: 390, height: 844 }, { 단서: 단서.없음 });
    await page.click('.map-chip');
    await 지도준비이거나빈(page);
    async function 지도준비이거나빈(p) { await p.waitForFunction(() => window.L && document.querySelector('#mapBox .leaflet-pane'), null, { timeout: 15000 }); await p.waitForTimeout(300); }
    ok((await page.$$eval('.map-step', (b) => b.length)) === 0, '단서가 없으면 단계 버튼이 없다');
    ok((await page.$eval('#mapWhy', (e) => e.textContent)).includes('찾지 못했어요'), '"단서를 찾지 못했어요"라고 말한다 (거짓 지도를 그리지 않는다)');
    ok((await 원수(page)) === 0, '원이 없다');
    ok(요청.검색.length === 0, '검색도 안 부른다');
    ok(await 열림(page), '그래도 시트는 열려 있고 닫을 수 있다');
    await ctx.close();
  }
  {
    const { ctx, page } = await 열기(browser, { width: 390, height: 844 }, { 단서: { ...단서.전국_지역, exif: 단서.파일좌표.exif }, 검색실패: 501 });
    await page.click('.map-chip');
    await 지도준비(page);
    const 글 = await 단계글(page);
    ok(글.length === 1 && 글[0].includes('사진 파일의 좌표'), '장소 검색이 안 돼도(준비 중) 파일 좌표 단계는 남는다', 글.join(' / '));
    ok((await page.$eval('#mapWhy', (e) => e.textContent)).includes('장소 검색을 하지 못해서'), '못 찾은 것과 없는 것을 구분해서 알린다');
    await ctx.close();
  }
  {
    const { ctx, page } = await 열기(browser, { width: 390, height: 844 }, { 단서: 단서.전국_지역, 검색실패: 500 });
    await page.click('.map-chip');
    await page.waitForFunction(() => window.L && document.querySelector('#mapBox .leaflet-pane'), null, { timeout: 15000 });
    await page.waitForTimeout(300);
    ok((await page.$eval('#mapWhy', (e) => e.textContent)).includes('장소 검색을 하지 못해서'), '검색이 실패하고 좌표도 없으면 그렇게 말한다');
    await ctx.close();
  }
  {
    // 캡션에 적어 준 지역도 지역 단서로 쓴다
    const { ctx, page, 요청 } = await 열기(browser, { width: 390, height: 844 }, {
      단서: { ocr: { words: [{ text: '햇살어린이집', type: '상호명' }], visualClues: [] }, caption: '유성구 어린이집 하원길', geocode: 단서.전국_지역.geocode },
    });
    await page.click('.map-chip');
    await 지도준비(page);
    ok(JSON.stringify(요청.검색[0].queries) === JSON.stringify(['햇살어린이집', '유성구 햇살어린이집']), '캡션의 «유성구»도 지역 단서로 붙는다', JSON.stringify(요청.검색[0].queries));
    await ctx.close();
  }

  console.log('\n닫기');
  for (const [이름, 닫기] of [
    ['✕', (p) => p.click('#mapSheet .sheet-close')],
    ['확인', (p) => p.click('#mapSheet .sheet-done')],
    ['뒤 화면', (p) => p.mouse.click(195, 60)],
    ['Esc', (p) => p.keyboard.press('Escape')],
  ]) {
    const { ctx, page } = await 열기(browser, { width: 390, height: 844 }, 기본);
    await page.click('.map-chip');
    await page.waitForTimeout(500);
    await 닫기(page);
    await page.waitForTimeout(400);
    ok((await 열림(page)) === false, `${이름}로 닫힌다`);
    ok((await page.evaluate(() => document.activeElement.className)) === 'map-chip', `${이름}로 닫으면 «장소 지도» 칩으로 포커스가 돌아온다`);
    ok((await page.$eval('#mapSheet', (e) => e.getAttribute('role'))) === null, `${이름}로 닫으면 대화상자 역할이 빠진다`);
    await ctx.close();
  }
  {
    const { ctx, page } = await 열기(browser, { width: 390, height: 844 }, 기본);
    await page.click('.map-chip');
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__anshimTest.showScreenForTest('form'));
    await page.waitForTimeout(300);
    ok((await 열림(page)) === false, '다른 단계로 가면 시트가 닫힌다');
    await ctx.close();
  }

  console.log('\n움직임 줄이기 · 지도 실패');
  {
    const { ctx, page } = await 열기(browser, { width: 390, height: 844 }, { ...기본, reduced: true });
    await page.click('.map-chip');
    await 지도준비(page);
    await page.waitForTimeout(300);
    ok((await 켜진단계(page)).join() === 'false,true', '움직임 줄이기: 끝 단계를 바로 보여준다');
    await ctx.close();
  }
  {
    const { ctx, page, errs } = await 열기(browser, { width: 390, height: 844 }, { ...기본, leafletDown: true });
    await page.click('.map-chip');
    await page.waitForTimeout(1500);
    ok((await page.$eval('#mapBox', (e) => e.textContent)).includes('불러오지 못했어요'), '지도를 못 받으면 안내 문구가 뜬다');
    ok((await page.$$eval('.map-step', (b) => b.length)) === 2, '그래도 단계 버튼은 남는다');
    await page.click('.map-step:nth-child(1)');
    ok((await 켜진단계(page)).join() === 'true,false', '지도가 없어도 단계 버튼은 동작한다');
    ok((await page.$eval('#mapWhy', (e) => e.textContent)).includes('흩어져'), '설명도 읽힌다');
    await page.click('#mapSheet .sheet-done');
    ok((await 열림(page)) === false, '실패 상태에서도 닫힌다');
    ok(errs.length === 0, '페이지 에러 없음', errs.join(' | '));
    await ctx.close();
  }

  console.log('\n작은 폰 · 큰 폰');
  for (const [w, h] of [[375, 667], [360, 640], [430, 932]]) {
    const { ctx, page } = await 열기(browser, { width: w, height: h }, 기본);
    await page.click('.map-chip');
    await 지도준비(page);
    const r = await page.evaluate(() => {
      const s = document.getElementById('mapSheet').getBoundingClientRect();
      const m = document.getElementById('mapBox').getBoundingClientRect();
      return { top: Math.round(s.top), mapH: Math.round(m.height), sw: document.documentElement.scrollWidth, iw: innerWidth };
    });
    ok(r.top >= 0 && r.mapH >= 180, `${w}x${h} 시트가 화면 안에 있고 지도가 충분히 크다`, `시트 위 ${r.top}px, 지도 높이 ${r.mapH}px`);
    ok(r.sw <= r.iw, `${w}x${h} 옆으로 안 넘친다`);
    await ctx.close();
  }

  console.log('\n데스크톱은 안 건드렸다 (폰의 시트·칩 부분)');
  {
    const { ctx, page } = await 열기(browser, { width: 1280, height: 800 }, 기본);
    ok((await 그려짐(page, '#factorChips')) === false, '칩 줄이 안 보인다 (지도 칩 포함)');
    ok((await 그려짐(page, '#mapSheet')) === false, '폰 전용 지도 시트가 안 보인다');
    ok((await 그려짐(page, '#mapBackdrop')) === false, '지도 뒤판이 안 보인다');
    ok(await 그려짐(page, '.rcard-location'), '데스크톱의 「장소 특정 가능성」 카드는 그대로 보인다');
    await ctx.close();
  }

  console.log('\n데스크톱 — 카드 안에 지도가 누를 필요 없이 자동으로 뜬다');
  // 예전엔 「지도로 보기」를 눌러야 가운데 대화상자가 열렸다. 사용자 요청으로 바꿔서,
  // 이제 진단이 끝나면(여기선 열기() 안에서 흉내낸 시점) 그 버튼 없이 카드 안에 바로 뜬다.
  for (const [w, h] of [[1280, 800], [1440, 900], [1024, 700]]) {
    const { ctx, page, errs, 요청 } = await 열기(browser, { width: w, height: h }, 기본);
    ok((await page.$('#locMapBtn')) === null, `${w}x${h} 「지도로 보기」 버튼이 더는 없다 (누를 게 없다)`);
    await 지도준비Inline(page);
    await page.waitForTimeout(400);
    ok(요청.검색.length === 1, `${w}x${h} 누르지 않아도 장소 검색을 한 번 자동으로 부른다`);
    const g = await page.evaluate(() => {
      const card = document.querySelector('.rcard-location').getBoundingClientRect();
      const m = document.getElementById('mapBoxInline').getBoundingClientRect();
      return {
        mapH: Math.round(m.height), mapTop: Math.round(m.top), cardTop: Math.round(card.top), cardBottom: Math.round(card.bottom),
        position: getComputedStyle(document.getElementById('mapBoxInline')).position,
        hasBackdrop: getComputedStyle(document.getElementById('mapBackdrop')).display !== 'none',
        sw: document.documentElement.scrollWidth, iw: innerWidth,
      };
    });
    ok(g.position !== 'fixed', `${w}x${h} 대화상자가 아니라 카드 흐름 안에 있다`, g.position);
    ok(g.mapTop >= g.cardTop && g.mapTop <= g.cardBottom, `${w}x${h} 「장소 특정 가능성」 카드 안에 있다`, `지도 ${g.mapTop} / 카드 ${g.cardTop}~${g.cardBottom}`);
    ok(!g.hasBackdrop, `${w}x${h} 뒤판(배경 어둡게)이 없다 — 화면을 막지 않는다`);
    ok(g.mapH >= 180, `${w}x${h} 지도가 충분히 크다`, `지도 높이 ${g.mapH}px`);
    ok((await page.$$eval('#mapStepsInline .map-step', (b) => b.length)) === 2, `${w}x${h} 단계 버튼이 둘 다 있다 (이름만 / +지역)`);
    ok((await 원수Inline(page)) === 1, `${w}x${h} 가장 좁혀진 단계(반경 원)가 바로 보인다`);
    ok(g.sw <= g.iw, `${w}x${h} 옆으로 안 넘친다`);
    ok(errs.length === 0, `${w}x${h} 페이지 에러 없음`, errs.join(' | '));
    await ctx.close();
  }
  {
    // ① 단계(이름만 — 전국에 흩어짐)는 원이 아니라 낱개 핑 3개(햇살전국 mock 3곳)를 찍는다.
    // 예전엔 point 모양이 {latlng, region}으로 바뀌었는데 인라인 지도 쪽만 안 따라가서
    // L.circleMarker(p, ...)에 통째로 넘겨 좌표를 못 읽었다 — 핑이 하나도 안 찍혔다
    // (실사용 제보: "2곳이라면서 안 찍힘"). 폰 쪽(원수)과 같은 값을 확인한다.
    const { ctx, page } = await 열기(browser, { width: 1280, height: 800 }, 기본);
    await 지도준비Inline(page);
    await page.click('#mapStepsInline .map-step:nth-child(1)');
    ok((await page.$eval('#mapStepsInline .map-step:nth-child(1)', (e) => e.classList.contains('on'))), '단계 버튼을 누르면 그 단계로 바뀐다 (다이얼로그가 아니어도 단계는 그대로 눌려진다)');
    ok((await 원수Inline(page)) === 3, '① 단계에서는 찾은 곳마다 낱개 핑이 3개 찍힌다 (원 대신)', await 원수Inline(page));
    await ctx.close();
  }
  {
    // 폰 폭으로 줄이면 카드 자체가 숨고, 칩이 폰 전용 시트를 연다 — 자동 인라인 지도는 부르지 않는다(쿼터를 아낀다)
    const { ctx, page, 요청 } = await 열기(browser, { width: 390, height: 844 }, 기본);
    ok((await page.$('#locMapBtn')) === null, '폰 폭에도 예전 버튼은 없다 (카드 자체가 숨는다)');
    ok(요청.검색.length === 0, '폰 폭에서는 인라인 지도가 자동으로 검색을 부르지 않는다 (칩을 눌러야 부른다)');
    await ctx.close();
  }

  await browser.close();
  console.log(`\n${pass}개 통과, ${fail}개 실패`);
  process.exit(fail ? 1 : 0);
})();
