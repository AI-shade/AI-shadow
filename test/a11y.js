/*
 * 문서 기본기와 화면 낭독기 검증.
 *
 * - DOCTYPE이 없어서 브라우저가 쿼크 모드로 그렸고, viewport 메타가 없어서
 *   폰이 980px 데스크톱 레이아웃을 축소해 보여줬다(모바일 미디어쿼리 10개가 전부 죽음).
 * - 체크리스트 입력 7개가 <label for>로 연결되어 있지 않아, 눈에는 이름이 보이는데
 *   낭독기에는 "이름 없는 입력칸"으로 읽혔다.
 * - 결과가 도착해도 낭독기에 알리는 곳이 없었다. 점수는 90ms마다 바뀌므로
 *   점수 자체를 live 영역으로 두면 쉬지 않고 읽어댄다 — 상태 한 줄만 알린다.
 * - 점수 내역의 근거 자리에 "살펴보는 중…"이라고 써 있어, 눌러야 하거나
 *   기다려야 하는 것으로 읽혔다(실사용 제보).
 */
const { chromium, devices } = require('playwright');
const URL = process.env.ANSHIM_URL || 'http://localhost:8000/index.html';

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

const R = {
  score: 45, grade: '중',
  riskFactors: [
    { 항목: '간판·주소 노출', 점수: 0, 상한: 30, 근거: '간판이나 주소로 읽히는 글자가 없어요.' },
    { 항목: '소속 노출', 점수: 23, 상한: 25, 근거: '교복이 보여 다니는 기관이 좁혀져요.' },
    { 항목: '인물 식별성', 점수: 10, 상한: 20, 근거: '얼굴이 정면으로 크게 나와요.' },
    { 항목: '게시 습관', 점수: 12, 상한: 15, 근거: '전체공개, 실시간 업로드예요.' },
  ],
  uploadTiming: '실시간 업로드', privacySetting: '전체공개',
  locationScore: 65, locationEvidence: '교복으로 다니는 기관이 좁혀져요.',
  scheduleOn: false, scheduleEvidence: '패턴 없음', schedulePatterns: [], schedulePredicted: '',
  actions: ['a', 'b', 'c'], summary: '학교가 특정될 수 있어요.', captionSuggestions: ['1', '2', '3'],
};
const OCR = { words: [], visualClues: [] };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 140)));
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(1000);

  console.log('\n[문서 기본기]');
  const doc = await page.evaluate(() => ({
    mode: document.compatMode, lang: document.documentElement.lang,
    viewport: !!document.querySelector('meta[name=viewport]'),
    charset: !!document.querySelector('meta[charset]'),
  }));
  ok(doc.mode === 'CSS1Compat', 'DOCTYPE이 있어 표준 모드로 그린다', doc.mode);
  ok(doc.lang === 'ko', '문서 언어가 한국어로 선언되어 있다', doc.lang || '(없음)');
  ok(doc.viewport, 'viewport 메타가 있다 (없으면 폰이 980px로 그린 뒤 축소한다)');
  ok(doc.charset, 'charset 선언이 있다');

  console.log('\n[폰에서 실제로 그 폭으로 그려지는가]');
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const mp = await ctx.newPage();
  await mp.goto(URL, { waitUntil: 'load' });
  await mp.waitForTimeout(1200);
  const m = await mp.evaluate(() => ({
    w: innerWidth, mq: matchMedia('(max-width:900px)').matches,
    가로스크롤: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  }));
  ok(m.w <= 430, '레이아웃 폭이 실제 화면 폭이다', m.w + 'px');
  ok(m.mq, '모바일 미디어쿼리가 실제로 걸린다');
  ok(!m.가로스크롤, '가로 스크롤이 생기지 않는다');
  await ctx.close();

  console.log('\n[입력칸에 이름이 붙어 있는가]');
  const 이름없는 = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('input,select,textarea').forEach((e) => {
      if (e.type === 'hidden') return;
      const has = e.getAttribute('aria-label')
        || (e.id && document.querySelector('label[for="' + e.id + '"]'))
        || e.closest('label') || e.getAttribute('title');
      if (!has) out.push(e.id || e.name || e.type);
    });
    return out;
  });
  ok(이름없는.length === 0, '이름 없는 입력칸이 없다', 이름없는.join(', '));

  const alt없는 = await page.evaluate(() =>
    [...document.querySelectorAll('img')].filter((e) => !e.hasAttribute('alt')).map((e) => e.id || '(id없음)'));
  ok(alt없는.length === 0, '대체 텍스트 없는 이미지가 없다', alt없는.join(', '));

  const dup = await page.evaluate(() => {
    const seen = {}, out = [];
    document.querySelectorAll('[id]').forEach((e) => { if (seen[e.id]) out.push(e.id); seen[e.id] = 1; });
    return out;
  });
  ok(dup.length === 0, '중복된 id가 없다', dup.join(', '));

  console.log('\n[결과가 도착한 걸 낭독기에 알리는가]');
  const live = await page.evaluate(() => {
    const e = document.getElementById('resultStatus');
    if (!e) return null;
    const c = getComputedStyle(e);
    return { live: e.getAttribute('aria-live'), role: e.getAttribute('role'),
      보임: c.width + '×' + c.height, clip: c.clip };
  });
  ok(live && live.live === 'polite', '상태 칸이 aria-live="polite"다');
  ok(live && live.role === 'status', 'role="status"다');
  ok(live && live.보임 === '1px×1px', '눈에는 안 보인다', live ? live.보임 : '');

  const pend = await page.evaluate((a) => {
    const T = window.__anshimTest;
    T.setPastCountForTest(0, null);
    T.showScreenForTest('result');
    T.startRiskPendingForTest();
    const li = document.querySelector('#sbList li.pending');
    const cs = li ? getComputedStyle(li.querySelector('.sb-name')).color : null;
    return {
      상태: document.getElementById('resultStatus').textContent,
      기다리는문구: [...document.querySelectorAll('#screen-result *')]
        .filter((e) => e.children.length === 0 && /살펴보는|확인 중/.test(e.textContent))
        .map((e) => e.textContent.trim()),
      pending색: cs,
      뼈대줄: document.querySelectorAll('#sbList p.sb-why.skel').length,
    };
  }, R);
  ok(/계산하고 있어요/.test(pend.상태), '대기 중에는 계산 중이라고 알린다');
  ok(pend.기다리는문구.length === 0, '"살펴보는 중" 같은 문구가 화면에 없다', pend.기다리는문구.join(' | '));
  ok(pend.뼈대줄 === 5, '근거 자리는 글자 대신 뼈대 막대다 (항목 5개)', pend.뼈대줄 + '줄');

  const fin = await page.evaluate((a) => {
    window.__anshimTest.stopScoreTickerForTest();
    window.__anshimTest.renderResultForTest(a, { faces: [] }, { words: [], visualClues: [] });
    const li = document.querySelector('#sbList li:nth-child(2)');
    return {
      상태: document.getElementById('resultStatus').textContent,
      최종색: getComputedStyle(li.querySelector('.sb-name')).color,
      근거: li.querySelector('.sb-why').textContent,
      뼈대남음: document.querySelectorAll('#sbList .skel').length,
    };
  }, R);
  ok(/45점/.test(fin.상태) && /중 등급/.test(fin.상태), '결과가 오면 점수와 등급을 알린다', fin.상태.slice(0, 46));
  ok(fin.뼈대남음 === 0, '결과가 오면 뼈대가 남지 않는다', fin.뼈대남음 + '개');
  ok(fin.근거.length > 0 && !/살펴보는/.test(fin.근거), '근거 자리에 실제 문장이 들어온다', fin.근거.slice(0, 30));
  ok(pend.pending색 !== null && pend.pending색 !== fin.최종색,
    '굴러가는 동안의 항목은 결과와 다르게 보인다', pend.pending색 + ' vs ' + fin.최종색);

  ok(errs.length === 0, '콘솔 에러가 없다', errs.join(' | '));
  await browser.close();
  console.log('\n결과: ' + pass + '/' + (pass + fail) + ' 통과');
  process.exit(fail === 0 ? 0 : 1);
})();
