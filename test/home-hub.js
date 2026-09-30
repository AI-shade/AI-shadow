/*
 * 폰 진단 탭의 홈(허브) 검사 — 스크롤 없는 한 화면, 그리고 홈 ↔ 도구 화면 전환.
 *
 * 배경: 진단 탭이 소개 문단·예시 피드·입력 폼을 한 페이지에 길게 이어 놓아서 한 화면이
 * 아니었다. 이제 첫 화면은 제목 바 + 알약 + 아이콘 메뉴 + 짧은 소개까지만이고, 사진을
 * 고르면 도구 화면(main#tool)으로 넘어간다. 데스크톱은 그대로다.
 *
 * 사용법: 이 폴더에서 → node home-hub.js   (프런트가 8000 또는 ANSHIM_URL에서 돌고 있어야 함)
 * 비용·네트워크 없음.
 */
const { chromium } = require('playwright');
const path = require('path');
const URL = process.env.ANSHIM_URL || 'http://localhost:8000/index.html';
const PHOTO = path.join(__dirname, '..', 'public', 'self-check', 'school-sign.jpg'); // AI 생성 사진

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}
const 보이나 = (page, sel) => page.evaluate((q) => {
  const el = document.querySelector(q);
  if (!el) return null;
  // 요소 자신의 display만 보면 부모(main#tool)가 숨어도 "보임"으로 나온다 — 실제로 그려지는지 잰다
  return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
}, sel);
const 속성 = (page, name) => page.evaluate((n) => document.documentElement.getAttribute(n), name);

async function 새로열기(browser, viewport, hash) {
  const ctx = await browser.newContext({ viewport, locale: 'ko-KR' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(URL + (hash || ''), { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(900);
  return { ctx, page, errs };
}

(async () => {
  const browser = await chromium.launch();

  // ── 1) 홈은 스크롤 없이 한 화면 ──
  console.log('홈은 한 화면이다 (스크롤 없음, 히어로가 탭바에 안 가려짐)');
  // 320x568(아주 옛 폰)은 일부러 뺐다 — 29px 넘친다. 알려진 한계.
  for (const [w, h] of [[390, 844], [430, 932], [360, 740], [375, 667], [360, 640]]) {
    const { ctx, page } = await 새로열기(browser, { width: w, height: h });
    const r = await page.evaluate(() => {
      const hero = document.querySelector('header.hero').getBoundingClientRect();
      const tab = document.getElementById('appTabbar').getBoundingClientRect();
      return { sh: document.documentElement.scrollHeight, ih: innerHeight, heroBottom: Math.round(hero.bottom), tabTop: Math.round(tab.top) };
    });
    ok(r.sh <= r.ih, `${w}x${h} 스크롤이 없다`, `문서 ${r.sh}px / 화면 ${r.ih}px`);
    ok(r.heroBottom <= r.tabTop, `${w}x${h} 소개가 탭바에 안 가린다`, `${r.heroBottom} ≤ ${r.tabTop}`);
    await ctx.close();
  }

  // ── 2) 홈에 무엇이 보이고 무엇이 숨는가 ──
  console.log('\n홈의 구성');
  {
    const { ctx, page, errs } = await 새로열기(browser, { width: 390, height: 844 });
    ok((await 속성(page, 'data-view')) === 'home', '처음엔 홈이다');
    ok(await 보이나(page, '.app-home'), '제목 바·알약·메뉴가 보인다');
    ok(await 보이나(page, '#appPill'), '알약 입력창이 보인다');
    // 예전엔 4개였는데, 바로 위 알약이 이미 "사진 진단"이라 첫 칸과 문구·행동이 겹쳤다
    // (UX 감사 지적) — 그 칸을 빼서 3개(과거글·알아보기·문답)만 남았다.
    // .app-menu 안으로 좁힌다 — 신뢰 포인트(.app-trust)도 클릭 동작을 재사용하려고
    // 같은 .app-menu-item 클래스를 쓰지만, 그건 다른 칸(아이콘 메뉴)이 아니다.
    const 메뉴수 = await page.$$eval('.app-menu .app-menu-item', (els) => els.filter((e) => getComputedStyle(e).display !== 'none').length);
    ok(메뉴수 === 3, '아이콘 메뉴가 3개 보인다(사진 진단은 알약과 겹쳐서 뺐다)', 메뉴수 + '개');
    ok((await 보이나(page, 'main#tool')) === false, '입력 폼(도구)은 숨어 있다');
    ok((await 보이나(page, '#selfcheck')) === false, '자가 점검(긴 예시 피드)은 홈에서 숨어 있다');
    ok((await 보이나(page, '.app-bar--form')) === false, '도구 화면의 ‹ 바는 홈에서 안 보인다');
    ok(errs.length === 0, '페이지 에러 없음', errs.join(' | '));
    await ctx.close();
  }

  // ── 3) 알약 → 사진 고르기 → 도구 화면 → ‹ → 홈 ──
  console.log('\n홈 ↔ 도구 화면');
  {
    const { ctx, page } = await 새로열기(browser, { width: 390, height: 844 });
    const chooser = page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null);
    await page.click('#appPill');
    const fc = await chooser;
    ok(!!fc, '알약을 누르면 사진 고르기가 열린다');
    ok((await 속성(page, 'data-view')) === 'home', '고르기만 열었을 땐 아직 홈이다 (취소하면 홈에 남는다)');
    if (fc) await fc.setFiles(PHOTO);
    await page.waitForTimeout(700);
    ok((await 속성(page, 'data-view')) === 'tool', '사진을 고르면 도구 화면으로 넘어간다');
    ok(await 보이나(page, 'main#tool'), '입력 폼이 보인다');
    ok((await 보이나(page, '.app-home')) === false, '홈의 알약·메뉴는 숨는다');
    ok(await 보이나(page, '.app-bar--form'), '폼 위에 ‹ 상단 바가 보인다');
    const 막대폭 = await page.evaluate(() => {
      const r = document.querySelector('.app-bar--form').getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right), w: innerWidth };
    });
    ok(막대폭.left >= 0 && 막대폭.right <= 막대폭.w, '상단 바가 화면 밖으로 삐져나가지 않는다', `${막대폭.left}~${막대폭.right} / ${막대폭.w}`);

    // 진단 탭을 다시 눌러도 사진을 골랐으니 도구 화면에 남는다
    await page.click('.app-tab[data-goto="진단"]');
    ok((await 속성(page, 'data-view')) === 'tool', '사진을 골랐으면 진단 탭을 다시 눌러도 도구 화면에 남는다');

    await page.click('#appBack');
    ok((await 속성(page, 'data-view')) === 'home', '‹ 를 누르면 홈으로 돌아온다');
    ok((await 보이나(page, 'main#tool')) === false, '돌아오면 폼이 다시 숨는다');
    await ctx.close();
  }

  // ── 4) 사진이 없을 때: 진단 탭 다시 누르기 / 다른 화면이 뜨면 자동으로 도구 ──
  console.log('\n전환 규칙');
  {
    const { ctx, page } = await 새로열기(browser, { width: 390, height: 844 });
    await page.evaluate(() => document.documentElement.setAttribute('data-view', 'tool'));
    await page.click('.app-tab[data-goto="진단"]');
    ok((await 속성(page, 'data-view')) === 'home', '사진이 없고 진행 중도 아니면 진단 탭을 누르면 홈으로 간다');

    await page.evaluate(() => window.__anshimTest.showScreenForTest('result'));
    await page.waitForTimeout(300);
    ok((await 속성(page, 'data-view')) === 'tool', '진단 결과 같은 다른 화면이 뜨면 자동으로 도구 화면이 된다');
    await page.click('.app-tab[data-goto="진단"]');
    ok((await 속성(page, 'data-view')) === 'tool', '진행 중이면 진단 탭을 눌러도 도구 화면에 남는다');
    await ctx.close();
  }
  {
    const { ctx, page } = await 새로열기(browser, { width: 390, height: 844 }, '#tool');
    ok((await 속성(page, 'data-view')) === 'tool', '주소가 #tool이면 도구 화면으로 시작한다 (공유 링크)');
    await ctx.close();
  }

  // ── 5) 아이콘 메뉴는 하단 탭과 같은 곳으로 간다 ──
  console.log('\n아이콘 메뉴');
  for (const 탭 of ['과거글', '알아보기', '문답']) {
    const { ctx, page } = await 새로열기(browser, { width: 390, height: 844 });
    await page.click(`.app-menu-item[data-menu="${탭}"]`);
    await page.waitForTimeout(200);
    ok((await 속성(page, 'data-tab')) === 탭, `«${탭}» 메뉴가 ${탭} 탭으로 간다`);
    await ctx.close();
  }
  {
    const { ctx, page } = await 새로열기(browser, { width: 390, height: 844 });
    await page.click('.app-menu-item[data-menu="알아보기"]');
    await page.waitForTimeout(200);
    ok(await 보이나(page, '#selfcheck'), '자가 점검은 알아보기 탭에서 볼 수 있다 (진단 탭에서 옮겨 왔다)');
    await ctx.close();
  }

  // ── 6) 데스크톱은 그대로 ──
  console.log('\n데스크톱은 안 건드렸다');
  {
    const { ctx, page } = await 새로열기(browser, { width: 1280, height: 800 });
    ok((await 보이나(page, '.app-home')) === false, '홈 알약·메뉴가 안 보인다');
    ok(await 보이나(page, 'main#tool'), '입력 폼(도구)이 그대로 보인다');
    ok(await 보이나(page, 'header.hero'), '히어로가 그대로 보인다');
    ok(await 보이나(page, '#selfcheck'), '자가 점검이 그대로 보인다');
    ok((await 보이나(page, '.app-bar--form')) === false, '폼 상단 바(‹)가 안 보인다');
    ok((await 보이나(page, '#appTabbar')) === false, '탭바가 안 보인다');
    await ctx.close();
  }

  await browser.close();
  console.log(`\n${pass}개 통과, ${fail}개 실패`);
  process.exit(fail ? 1 : 0);
})();
