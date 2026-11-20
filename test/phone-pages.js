/*
 * 폰 앱은 길게 스크롤하지 않고 화면(쪽)이 넘어간다.
 *
 * 제보: "핸드폰어플은 스크롤을 내리는 형태로 길게 만들지말고 화면이 넘어가는 형태로 만들어줘"
 *       "다른 탭들도 페이지 넘김으로 바꿔줘" (10-27)
 *
 * 고치기 전 실측(390x844): 알아보기 2449px · 과거글 952px · 진단 결과 1164px.
 * 탭마다, 알아보기는 쪽마다 문서 높이가 화면 높이를 넘지 않는지 잰다.
 * 2px까지는 반올림 오차로 본다(375x667 알아보기 3쪽이 668px).
 *
 * 사용법: 이 폴더에서 → node phone-pages.js  (프런트가 8000 또는 ANSHIM_URL에서). 비용·네트워크 없음.
 */
const { chromium } = require('playwright');
const URL = process.env.ANSHIM_URL || 'http://localhost:8000/index.html';

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

(async () => {
  const browser = await chromium.launch();
  // 360x800: 가운데 정렬 제보 때 잰 크기 · 384x653: 갤럭시 S22+ 삼성 인터넷
  for (const [w, h] of [[390, 844], [375, 667], [360, 800], [384, 653]]) {
    console.log('\n' + w + 'x' + h);
    const page = await (await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, locale: 'ko-KR' })).newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(800);
    const 높이 = () => page.evaluate(() => document.documentElement.scrollHeight);
    // 내용이 위에 붙고 아래가 비지 않게 — 앱바와 탭바(·쪽 넘기기) 사이 세로 가운데. 넘칠 때는 따지지 않는다.
    // 제보 11-02: "'내정보' '알아보기' '문답' 탭들이 아래에 여백이 너무 많은거같아 가운데로 정렬해줘"
    const 가운데 = (이름) => page.evaluate((이름) => {
      const sec = [...document.querySelectorAll(`section[data-tab-of="${이름}"]`)].find((e) => e.getClientRects().length);
      const pager = document.querySelector('.app-pager');
      const 바닥 = pager && getComputedStyle(pager).display !== 'none' ? pager.getBoundingClientRect().top
        : document.querySelector('.app-tabbar').getBoundingClientRect().top;
      const 칸 = sec.getBoundingClientRect();
      const 안 = [...sec.children].map((c) => c.getBoundingClientRect()).filter((r) => r.height > 0);
      const 위 = Math.min(...안.map((r) => r.top)) - 칸.top, 아래 = 칸.bottom - Math.max(...안.map((r) => r.bottom));
      return { 넘침: document.documentElement.scrollHeight > innerHeight + 2, 칸끝: Math.round(칸.bottom), 바닥: Math.round(바닥), 위: Math.round(위), 아래: Math.round(아래) };
    }, 이름);
    const 가운데검사 = async (label, 이름) => {
      const g = await 가운데(이름);
      if (g.넘침) return;
      ok(Math.abs(g.칸끝 - g.바닥) <= 2 && Math.abs(g.위 - g.아래) <= 4, label + ' 내용이 세로 가운데다',
        '위 ' + g.위 + ' · 아래 ' + g.아래 + ' · 칸끝 ' + g.칸끝 + ' / 바닥 ' + g.바닥);
    };

    // 홈은 11-02부터 신뢰 카드·예시 타일을 숨기지 않고 넘치면 스크롤한다(home-hub.js가 잰다).
    // 다만 끝없이 길어지면 안 된다 — 한 화면 반을 넘지 않게만 막는다.
    ok((await 높이()) <= h * 1.5, '홈이 한 화면 반 안이다', (await 높이()) + 'px / ' + Math.round(h * 1.5) + 'px');
    for (const t of ['내정보', '문답']) {
      await page.click(`.app-tab[data-goto="${t}"]`);
      await page.waitForTimeout(300);
      ok((await 높이()) <= h + 2, t + ' 탭이 한 화면이다', (await 높이()) + 'px');
      await 가운데검사(t + ':', t);
    }

    await page.click('.app-tab[data-goto="알아보기"]');
    await page.waitForTimeout(300);
    const 쪽수 = await page.$$eval('section[data-tab-of="알아보기"]', (els) => els.length);
    ok((await page.textContent('#pagerNum')) === '1 / ' + 쪽수, '알아보기는 1쪽부터 연다');
    ok(await page.$eval('#pagerPrev', (b) => b.disabled), '첫 쪽에서는 이전 단추가 꺼져 있다');
    for (let i = 0; i < 쪽수; i++) {
      const 보이는쪽 = await page.$$eval('section[data-tab-of="알아보기"]', (els) => els.filter((e) => e.getClientRects().length).length);
      ok(보이는쪽 === 1 && (await 높이()) <= h + 2, (i + 1) + '쪽: 섹션 하나만, 한 화면에', 보이는쪽 + '개 · ' + (await 높이()) + 'px');
      await 가운데검사('알아보기 ' + (i + 1) + '쪽:', '알아보기');
      if (i < 쪽수 - 1) await page.click('#pagerNext');
    }
    ok(await page.$eval('#pagerNext', (b) => b.disabled), '마지막 쪽에서는 다음 단추가 꺼져 있다');

    // 홈의 «얼굴은 가려서 보냅니다»는 #why로 간다 — 그 쪽이 열려야 한다
    await page.click('.app-tab[data-goto="진단"]');
    await page.waitForTimeout(300);
    await page.click('.app-trust-row >> nth=0');
    await page.waitForTimeout(300);
    ok(await page.$eval('#why', (e) => e.getClientRects().length > 0), '홈 신뢰 문구를 누르면 그 설명 쪽(#why)이 열린다');

    ok(errs.length === 0, '페이지 에러 없음', errs.join(' | '));
  }
  await browser.close();
  console.log('\n' + pass + '개 통과, ' + fail + '개 실패');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('실패:', e.message); process.exit(1); });
