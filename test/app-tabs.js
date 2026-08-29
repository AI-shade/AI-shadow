/*
 * 폰 폭에서만 어플 탭 배치가 되는지 검사한다.
 *
 * 핵심은 "데스크톱을 안 건드린다"는 것이다. data-tab을 세워도 넓은 화면에서는
 * 아무 섹션도 숨으면 안 된다 — 그래야 pinned.js 45개가 계속 통과한다.
 */
const { chromium } = require('playwright');
const URL = process.env.ANSHIM_URL || 'http://localhost:8000/index.html';

const 탭들 = ['진단', '과거글', '알아보기', '문답'];
const 섹션 = {
  진단: ['tool'],
  과거글: ['pattern-check'],
  알아보기: ['steps', 'features', 'why'],
  문답: ['faq'],
};

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

const 보이나 = (page, id) => page.evaluate(i => {
  const el = document.getElementById(i);
  if (!el) return null;
  const st = getComputedStyle(el);
  return st.display !== 'none' && st.visibility !== 'hidden';
}, id);

(async () => {
  const browser = await chromium.launch();

  // ── 폰 폭 ──
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(900);

    console.log('폰 390px');
    ok(await 보이나(page, 'appTabbar'), '탭바가 보인다');

    const 칸수 = await page.evaluate(() => document.querySelectorAll('#appTabbar .app-tab').length);
    ok(칸수 === 4, '탭이 4개다', 칸수 + '개');
    ok(await 보이나(page, 'appFab'), '가운데 사진 넣기 버튼이 있다');

    for (const 탭 of 탭들) {
      await page.evaluate(t => window.__anshimTest.setTabForTest(t), 탭);
      await page.waitForTimeout(120);

      let 좋음 = true, 상세 = [];
      for (const [이름, ids] of Object.entries(섹션)) {
        for (const id of ids) {
          const v = await 보이나(page, id);
          const 기대 = 이름 === 탭;
          if (v !== 기대) { 좋음 = false; 상세.push(`#${id} ${v ? '보임' : '숨음'}`); }
        }
      }
      ok(좋음, `«${탭}» 탭에서 그 탭 것만 보인다`, 상세.join(', '));

      const cur = await page.evaluate(() =>
        (document.querySelector('#appTabbar .app-tab[aria-current="true"]') || {}).dataset?.goto);
      ok(cur === 탭, `«${탭}»에 aria-current가 붙는다`, String(cur));
    }

    // JS가 죽은 상태 — data-tab이 없으면 아무것도 숨으면 안 된다
    await page.evaluate(() => document.documentElement.removeAttribute('data-tab'));
    await page.waitForTimeout(120);
    let 다보임 = true, 숨은것 = [];
    for (const ids of Object.values(섹션)) {
      for (const id of ids) {
        if (!(await 보이나(page, id))) { 다보임 = false; 숨은것.push('#' + id); }
      }
    }
    ok(다보임, 'data-tab이 없으면 아무 섹션도 안 숨는다', 숨은것.join(', '));

    await ctx.close();
  }

  // ── 데스크톱 ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(900);

    console.log('\n데스크톱 1280px');
    ok(!(await 보이나(page, 'appTabbar')), '탭바가 안 보인다');

    await page.evaluate(() => window.__anshimTest.setTabForTest('문답'));
    await page.waitForTimeout(120);
    let 다보임 = true, 숨은것 = [];
    for (const ids of Object.values(섹션)) {
      for (const id of ids) {
        if (!(await 보이나(page, id))) { 다보임 = false; 숨은것.push('#' + id); }
      }
    }
    ok(다보임, 'data-tab을 세워도 아무것도 안 숨는다 (미디어쿼리 안에만 있다)', 숨은것.join(', '));

    await ctx.close();
  }

  await browser.close();
  console.log('\n' + pass + '개 통과, ' + fail + '개 실패');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('실패:', e.message); process.exit(1); });
