/*
 * 진단 결과의 위험 항목 칩 + 시트 검사 (폰 전용).
 *
 * 폰에서는 오각형이 다섯 항목을 값까지 적어 주고 점수 내역 목록은 접혀 있다. 그래서 항목의
 * 근거를 보려면 목록을 펼쳐야 했고, 펼치면 화면이 길어졌다. 이제 오각형 아래 칩 한 줄을 누르면
 * 그 항목의 점수·막대·근거가 하단 시트로 올라온다.
 *
 * 사용법: 이 폴더에서 → node factor-sheet.js   (프런트가 8000 또는 ANSHIM_URL에서 돌고 있어야 함)
 * 비용·네트워크 없음.
 */
const { chromium } = require('playwright');
const URL = process.env.ANSHIM_URL || 'http://localhost:8000/index.html';

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

const 기본 = {
  score: 60, grade: '중',
  riskFactors: [
    { 항목: '간판·주소 노출', 점수: 0, 상한: 26, 근거: '사진에 식별 가능한 간판이나 주소 글자가 없습니다.' },
    { 항목: '소속 노출', 점수: 22, 상한: 22, 근거: '명확한 교복과 가슴의 명찰이 학교 특정을 가능하게 합니다.' },
    { 항목: '인물 식별성', 점수: 4, 상한: 18, 근거: '얼굴이 매우 작게 촬영되어 단독으로는 식별이 어렵습니다.' },
    { 항목: '캡션 노출', 점수: 18, 상한: 18, 근거: '학교명, 학년, 요일, 시간, 장소가 모두 명시되어 있습니다.' },
    { 항목: '게시 습관', 점수: 16, 상한: 16, 근거: '전체공개 계정에 실시간 업로드했습니다.' },
  ],
  uploadTiming: '실시간 업로드', privacySetting: '전체공개',
  locationScore: 78, locationEvidence: '교복과 캡션으로 학교가 좁혀져요.',
  scheduleOn: false, scheduleEvidence: '', schedulePatterns: [], schedulePredicted: '',
  actions: ['가슴의 마크를 지워주세요.'], summary: '학교가 특정될 수 있어요.', captionSuggestions: ['1', '2', '3'],
};

async function 열기(browser, viewport, 결과) {
  const ctx = await browser.newContext({ viewport, locale: 'ko-KR' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(800);
  await page.evaluate((R) => {
    const T = window.__anshimTest;
    T.showScreenForTest('result'); T.stopScoreTickerForTest();
    T.renderResultForTest(R, { faces: [] }, { words: [], visualClues: [] });
  }, 결과 || 기본);
  await page.waitForTimeout(400);
  return { ctx, page, errs };
}
const 열림 = (page) => page.evaluate(() => document.getElementById('screen-result').classList.contains('factor-open'));
const 그려짐 = (page, sel) => page.evaluate((q) => {
  const el = document.querySelector(q);
  return !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
}, sel);

(async () => {
  const browser = await chromium.launch();

  // ── 칩 ──
  console.log('칩 줄');
  {
    const { ctx, page, errs } = await 열기(browser, { width: 390, height: 844 });
    const 칩 = await page.$$eval('.factor-chip', (els) => els.map((e) => ({
      text: e.textContent, cls: e.className, label: e.querySelector('span').textContent, val: e.querySelector('b').textContent,
    })));
    ok(칩.length === 5, '항목마다 칩이 있다', 칩.length + '개');
    ok(칩.map((c) => c.label).join(',') === '소속,캡션,게시 습관,인물,간판·주소',
      '점수 높은 항목이 앞에 온다', 칩.map((c) => c.label).join(','));
    ok(칩[0].val === '22/22' && 칩[4].val === '0/26', '점수/상한을 적는다', 칩[0].val + ' · ' + 칩[4].val);
    ok(칩.filter((c) => c.cls.includes('max')).length === 3, '만점 항목(소속·캡션·게시)은 위험색 칩이다');
    ok(칩[4].cls.includes('zero'), '0점 항목은 흐린 칩이다');
    ok(!칩[3].cls.includes('max') && !칩[3].cls.includes('zero'), '중간 점수(인물 4/18)는 기본 칩이다');
    ok(await 그려짐(page, '#factorChips'), '폰에서 칩 줄이 보인다');
    const 폭 = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
    ok(폭.sw <= 폭.iw, '칩 줄이 페이지를 옆으로 넘치게 하지 않는다', `${폭.sw} ≤ ${폭.iw}`);
    ok((await page.$$eval('.factor-chip', (els) => els.every((e) => e.tagName === 'BUTTON' && e.getAttribute('aria-haspopup') === 'dialog'))),
      '칩은 진짜 <button>이고 대화상자를 연다고 알린다');
    ok(errs.length === 0, '페이지 에러 없음', errs.join(' | '));
    await ctx.close();
  }

  // ── 시트 열기 ──
  console.log('\n시트');
  {
    const { ctx, page } = await 열기(browser, { width: 390, height: 844 });
    ok((await 열림(page)) === false, '처음엔 닫혀 있다');
    ok((await 그려짐(page, '#factorSheet')) === false, '닫힌 시트는 화면에도 탭 순서에도 없다 (visibility:hidden)');
    ok((await page.$eval('#factorSheet', (e) => e.getAttribute('role'))) === null, '닫혀 있을 땐 대화상자 역할을 안 붙인다');

    await page.click('.factor-chip >> text=소속');
    await page.waitForTimeout(400);
    ok(await 열림(page), '칩을 누르면 시트가 열린다');
    ok(await 그려짐(page, '#factorSheet'), '시트가 보인다');
    const 내용 = await page.evaluate(() => ({
      title: document.getElementById('fsTitle').textContent,
      score: document.getElementById('fsScore').textContent,
      barW: document.getElementById('fsBar').style.width,
      barCls: document.getElementById('fsBar').className,
      why: document.getElementById('fsWhy').textContent,
      role: document.getElementById('factorSheet').getAttribute('role'),
      modal: document.getElementById('factorSheet').getAttribute('aria-modal'),
      rowWhy: [...document.querySelectorAll('#sbList li')].find((li) => li.querySelector('.sb-name').textContent === '소속 노출').querySelector('.sb-why').textContent,
      bottom: Math.round(document.getElementById('factorSheet').getBoundingClientRect().bottom), ih: innerHeight,
      focus: document.activeElement && document.activeElement.className,
      bodyOverflow: getComputedStyle(document.body).overflow,
    }));
    ok(내용.title === '소속 노출', '제목이 항목 이름이다', 내용.title);
    ok(내용.score.replace(/\s/g, '') === '22/22점', '점수와 상한이 적힌다', 내용.score);
    ok(내용.barW === '100%' && 내용.barCls === 'max', '만점 막대는 100%·위험색', 내용.barW + ' ' + 내용.barCls);
    ok(내용.why === 내용.rowWhy && 내용.why.length > 5, '근거가 점수 내역 행의 근거와 같다', 내용.why.slice(0, 28) + '…');
    ok(내용.role === 'dialog' && 내용.modal === 'true', '열리면 대화상자 역할이 붙는다');
    ok(내용.bottom <= 내용.ih + 1, '시트가 화면 안에 있다', `${내용.bottom} ≤ ${내용.ih}`);
    ok(String(내용.focus).includes('sheet-close'), '열리면 닫기 단추로 포커스가 간다', 내용.focus);
    ok(내용.bodyOverflow === 'hidden', '열려 있는 동안 뒤 화면은 스크롤하지 않는다', 내용.bodyOverflow);
    await ctx.close();
  }

  // ── 시트 닫기 네 가지 + 포커스 복귀 ──
  console.log('\n닫기');
  for (const [이름, 동작] of [
    ['✕ 단추', (p) => p.click('#factorSheet .sheet-close')],
    ['확인 단추', (p) => p.click('#factorSheet .sheet-done')],
    ['뒤판 누르기', (p) => p.mouse.click(195, 60)],
    ['Esc 키', (p) => p.keyboard.press('Escape')],
  ]) {
    const { ctx, page } = await 열기(browser, { width: 390, height: 844 });
    await page.click('.factor-chip >> text=캡션');
    await page.waitForTimeout(350);
    await 동작(page);
    await page.waitForTimeout(350);
    ok((await 열림(page)) === false, `${이름}로 닫힌다`);
    if (이름 === 'Esc 키') {
      const 포커스 = await page.evaluate(() => document.activeElement && document.activeElement.textContent);
      ok(String(포커스).includes('캡션'), '닫히면 눌렀던 칩으로 포커스가 돌아간다', String(포커스).trim());
      ok((await page.$eval('#factorSheet', (e) => e.getAttribute('role'))) === null, '닫히면 대화상자 역할을 걷는다');
    }
    await ctx.close();
  }

  // ── 항목별 내용 ──
  console.log('\n항목별 표시');
  {
    const { ctx, page } = await 열기(browser, { width: 390, height: 844 });
    await page.click('.factor-chip >> text=간판');
    await page.waitForTimeout(350);
    let v = await page.evaluate(() => ({ w: document.getElementById('fsBar').style.width, c: document.getElementById('fsBar').className, t: document.getElementById('fsTitle').textContent }));
    ok(v.t === '간판·주소 노출' && v.w === '2%' && v.c === 'zero', '0점은 폭 2%의 흐린 막대 (폭 0이면 "검사 안 함"으로 읽힌다)', `${v.w} ${v.c}`);
    await page.click('#factorSheet .sheet-done');
    await page.waitForTimeout(350);
    await page.click('.factor-chip >> text=인물');
    await page.waitForTimeout(350);
    v = await page.evaluate(() => ({ w: document.getElementById('fsBar').style.width, c: document.getElementById('fsBar').className }));
    ok(v.w === '22%' && v.c === '', '4/18은 22%·기본색 막대', `${v.w} "${v.c}"`);
    await ctx.close();
  }

  // ── 경계 ──
  console.log('\n경계 조건');
  {
    const 빈근거 = JSON.parse(JSON.stringify(기본));
    빈근거.riskFactors[1].근거 = '';
    const { ctx, page } = await 열기(browser, { width: 390, height: 844 }, 빈근거);
    await page.click('.factor-chip >> text=소속');
    await page.waitForTimeout(350);
    const t = await page.$eval('#fsWhy', (e) => e.textContent);
    ok(t === '이 항목의 근거를 아직 만들지 못했어요.', '근거가 비면 안내 문구를 보여준다', t);
    await ctx.close();
  }
  {
    const 없음 = JSON.parse(JSON.stringify(기본));
    없음.riskFactors = [];
    const { ctx, page, errs } = await 열기(browser, { width: 390, height: 844 }, 없음);
    ok((await 그려짐(page, '#factorChips')) === false, '항목이 없으면 칩 줄이 숨는다');
    ok(errs.length === 0, '항목이 없어도 에러가 없다', errs.join(' | '));
    await ctx.close();
  }
  {
    // 사진 속 글자가 항목 이름·근거로 들어올 수 있다 — HTML로 해석되면 안 된다
    const 위험 = JSON.parse(JSON.stringify(기본));
    위험.riskFactors[1].항목 = '<img src=x onerror="window.__pwn=1">소속';
    위험.riskFactors[1].근거 = '<img src=x onerror="window.__pwn=2"><b>굵게</b>';
    const { ctx, page } = await 열기(browser, { width: 390, height: 844 }, 위험);
    await page.click('.factor-chip.max');
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => ({
      pwn: window.__pwn, imgs: document.querySelectorAll('#factorSheet img, #factorChips img').length,
      bolds: document.querySelectorAll('#factorSheet b').length,
    }));
    ok(r.pwn === undefined, '항목·근거의 HTML이 실행되지 않는다', String(r.pwn));
    ok(r.imgs === 0, '시트와 칩에 <img>가 끼어들지 않는다');
    ok(r.bolds === 1, '근거 안의 <b>는 글자로만 보인다 (시트의 <b>는 점수 숫자 하나뿐)', r.bolds + '개');
    await ctx.close();
  }
  {
    const { ctx, page } = await 열기(browser, { width: 390, height: 844 });
    await page.click('.factor-chip >> text=소속');
    await page.waitForTimeout(350);
    await page.evaluate(() => window.__anshimTest.showScreenForTest('correct'));
    await page.waitForTimeout(300);
    ok((await 열림(page)) === false, '다른 단계로 가면 시트가 닫힌다');
    await page.evaluate(() => window.__anshimTest.showScreenForTest('result'));
    await page.waitForTimeout(300);
    ok((await 열림(page)) === false, '돌아와도 열려 있지 않다');
    await ctx.close();
  }

  // ── 데스크톱은 그대로 ──
  console.log('\n데스크톱은 안 건드렸다');
  {
    const { ctx, page } = await 열기(browser, { width: 1280, height: 800 });
    ok((await 그려짐(page, '#factorChips')) === false, '칩 줄이 안 보인다');
    ok((await 그려짐(page, '#factorSheet')) === false, '시트가 안 보인다');
    ok((await 그려짐(page, '#scoreBreakdown')), '점수 내역 목록은 그대로 보인다');
    await ctx.close();
  }

  await browser.close();
  console.log(`\n${pass}개 통과, ${fail}개 실패`);
  process.exit(fail ? 1 : 0);
})();
