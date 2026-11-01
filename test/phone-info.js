/*
 * 폰에서 정보가 숨지 않는지 잰다.
 *
 * 제보(10-28): "사진진단하면 컴퓨터 화면처럼 정보를 안줘 그냥 점수만줘"
 *              "사진 다운로드도 안되고" (카카오톡 링크로 열었을 때)
 *
 * 고치기 전 실측(393x852):
 *   진단 결과 — 장소 특정·권장 조치·종합 설명이 display:none. 할 일은 첫 줄만.
 *   보정 — 결과·오류 문구(#previewCaption)가 display:none. AI 단추는 시트 안에 있는데
 *          눌러도 시트가 안 닫혀서 진행 중 표시가 시트 뒤에 가려졌다. 실패해도 아무 말이 없다.
 *   다운로드 — <a download>는 카카오톡 안 브라우저가 막는다.
 * 폰은 이제 결과를 아래로 스크롤한다(사용자 선택 10-28: "그냥 아래로 스크롤").
 *
 * 사용법: 이 폴더에서 → node phone-info.js  (프런트가 8000에서). 비용·네트워크 없음.
 */
const { chromium } = require('playwright');
const URL = process.env.ANSHIM_URL || 'http://localhost:8000/index.html';

const R = {
  score: 60, grade: '중',
  riskFactors: [
    { 항목: '간판·주소 노출', 점수: 22, 상한: 26, 근거: '어린이집 간판이 또렷하게 보입니다.' },
    { 항목: '소속 노출', 점수: 18, 상한: 22, 근거: '원복과 명찰로 다니는 곳을 알 수 있습니다.' },
    { 항목: '인물 식별성', 점수: 12, 상한: 18, 근거: '얼굴이 정면으로 크게 보입니다.' },
    { 항목: '캡션 노출', 점수: 0, 상한: 18, 근거: '캡션이 없습니다.' },
    { 항목: '게시 습관', 점수: 8, 상한: 16, 근거: '전체 공개 계정입니다.' },
  ],
  uploadTiming: '실시간 업로드', privacySetting: '전체공개',
  locationScore: 70, locationEvidence: '간판 글자로 어린이집 위치를 찾을 수 있습니다.',
  scheduleOn: false, scheduleEvidence: '', schedulePatterns: [], schedulePredicted: '',
  actions: [
    '간판이 보이지 않게 배경을 바꾸거나 다른 각도에서 다시 찍어주세요.',
    '명찰의 이름과 반 이름을 지워주세요.',
    '전체공개 대신 친구만 볼 수 있게 바꾸고, 며칠 지난 뒤에 올려주세요.',
  ],
  summary: '간판과 명찰 때문에 아이가 다니는 곳이 드러납니다.', captionSuggestions: [],
};

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

async function open(browser, w, h, extra) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 600, hasTouch: w < 600, locale: 'ko-KR', acceptDownloads: true, ...(extra || {}) });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('dialog', (d) => d.dismiss());
  // 실제 서버로 나가는 호출이 없게 전부 막는다. flux-status는 «준비 안 됨» — 돈이 드는 길로 못 간다.
  await page.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ready":false}' }));
  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(700);
  return { page, errs };
}

const 보임 = (page, sel) => page.evaluate((s) => {
  const e = document.querySelector(s);
  return !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
}, sel);

(async () => {
  const browser = await chromium.launch();

  // 384x653·360x610 — 갤럭시 S22+·S22 삼성 인터넷(주소창·도구 막대를 뺀 키). 제보 11-02 "진단 누르면 여전히 짤려서 안보여"
  for (const [w, h] of [[390, 844], [375, 667], [384, 653], [360, 610]]) {
    console.log('\n진단 결과 ' + w + 'x' + h);
    const { page, errs } = await open(browser, w, h);
    await page.evaluate((a) => {
      window.__anshimTest.showScreenForTest('result');
      window.__anshimTest.stopScoreTickerForTest();
      window.__anshimTest.renderResultForTest(a, { faces: [] }, { words: [], visualClues: [] });
    }, R);
    await page.waitForTimeout(500);

    ok(await 보임(page, '#screen-result > .rcard-location'), '장소 특정 카드가 보인다');
    ok(await 보임(page, '#summaryCard'), '종합 설명이 보인다');
    const 할일 = await page.$$eval('#actionList li', (ls) => ls.filter((l) => l.getClientRects().length).length);
    ok(할일 === 3, '권장 조치가 전부 보인다', 할일 + '/3');

    // 맨 아래까지 내렸을 때 마지막 카드가 고정 바(보정하러 가기)에 가리지 않아야 한다
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(200);
    const 가림 = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#screen-result > .rcard, #screen-result > .result-section')]
        .filter((e) => e.getClientRects().length);
      const last = cards[cards.length - 1];
      const bar = document.querySelector('#screen-result > .app-actionbar');
      return { 끝: Math.round(last.getBoundingClientRect().bottom), 바: Math.round(bar.getBoundingClientRect().top), 이름: last.id || last.className };
    });
    ok(가림.끝 <= 가림.바, '맨 아래 카드가 고정 바에 안 가린다', 가림.이름 + ' 끝 ' + 가림.끝 + ' / 바 ' + 가림.바);
    ok(errs.length === 0, '페이지 에러 없음', errs.join(' | '));
  }

  console.log('\n보정 393x852');
  {
    const { page, errs } = await open(browser, 393, 852);
    // AI 단추 줄은 fal이 준비됐을 때만 보인다. 동의창에서 «취소»를 누르므로 보정 요청은 나가지 않는다.
    const 나간요청 = [];
    await page.route('**/api/flux-status', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ready":true}' }));
    page.on('request', (q) => { if (/replace-background|inpaint/.test(q.url())) 나간요청.push(q.url()); });
    // 진단 결과에서 «보정하러 가기»로 들어간다 — 그래야 AI 단추 줄이 켜진다
    await page.evaluate((a) => {
      window.__anshimTest.showScreenForTest('result');
      window.__anshimTest.stopScoreTickerForTest();
      window.__anshimTest.renderResultForTest(a, { faces: [] }, { words: [], visualClues: [] });
    }, R);
    await page.waitForTimeout(300);
    await page.click('#goCorrectBtn');
    await page.waitForTimeout(800);
    // 제보(10-28): "보정단계에서 그냥 바로 보정방식이 떳으면 좋겠어 보정 내용-고치기 눌러서 선택하는게 아니라"
    ok(!(await 보임(page, '#methodRow')), '«보정 내용 · 고치기» 줄이 없다');
    const 단추 = await page.evaluate(() => {
      const bar = document.querySelector('#screen-correct > .app-actionbar').getBoundingClientRect().top;
      return ['#aiMarkBtn', '#aiBgBtn', '#aiOutfitBtn'].map((s) => {
        const r = document.querySelector(s).getBoundingClientRect();
        return r.height > 0 && r.bottom <= bar;
      });
    });
    ok(단추.every(Boolean), 'AI 단추 셋이 누르지 않아도 바로 보인다(아래 고정 바에 안 가린다)', JSON.stringify(단추));
    await page.click('#aiBgBtn');
    await page.waitForTimeout(600);
    ok(await 보임(page, '#fluxConsentCancel'), '동의창이 뜬다');
    await page.click('#fluxConsentCancel');
    await page.waitForTimeout(400);
    ok(나간요청.length === 0, '동의를 취소하면 보정 요청이 안 나간다', 나간요청.join(','));
    ok(await 보임(page, '#previewCaption'), '결과·오류 안내 문구가 보인다',
      (await page.textContent('#previewCaption')).slice(0, 50));
    ok(errs.length === 0, '페이지 에러 없음', errs.join(' | '));
  }

  // 다운로드 — 보정 결과가 있는 상태를 만든다
  const 결과있게 = (page) => page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 40; c.height = 40;
    c.getContext('2d').fillRect(0, 0, 40, 40);
    window.__anshimTest.stackPending(c, { method: 'ai', detail: 't' });
    window.__anshimTest.setMethodForTest('ai');
  });

  console.log('\n다운로드 — 폰, 공유 가능');
  {
    const { page } = await open(browser, 393, 852);
    await page.evaluate(() => {
      window.__shared = null;
      navigator.canShare = (d) => !!(d && d.files);
      navigator.share = (d) => { window.__shared = d.files.map((f) => f.name + '|' + f.type); return Promise.resolve(); };
    });
    await 결과있게(page);
    await page.evaluate(() => document.getElementById('downloadResultBtn').click());
    await page.waitForTimeout(500);
    const s = await page.evaluate(() => window.__shared);
    ok(s && s.length === 1 && /\.png\|image\/png$/.test(s[0]), '공유 시트로 PNG 파일 하나를 넘긴다', JSON.stringify(s));
  }

  console.log('\n다운로드 — 카카오톡(공유 없음)');
  {
    const { page } = await open(browser, 393, 852, {
      userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36 KAKAOTALK 10.8.0',
    });
    await page.evaluate(() => { delete Navigator.prototype.share; delete Navigator.prototype.canShare; });
    await 결과있게(page);
    const dl = page.waitForEvent('download', { timeout: 1500 }).then(() => true).catch(() => false);
    await page.evaluate(() => document.getElementById('downloadResultBtn').click());
    await page.waitForTimeout(500);
    ok(await 보임(page, '#saveSheet'), '사진을 크게 띄워 «꾹 눌러 저장» 안내를 한다');
    ok(await page.$eval('#saveSheetImg', (i) => i.src.startsWith('data:image/png')), '띄운 사진이 보정 결과다');
    ok(!(await dl), '카톡에서는 막히는 다운로드를 시도하지 않는다');
    await page.click('#saveSheet .sheet-close');
    await page.waitForTimeout(200);
    ok(!(await 보임(page, '#saveSheet')), '닫기를 누르면 닫힌다');
  }

  console.log('\n다운로드 — 데스크톱은 그대로');
  {
    const { page } = await open(browser, 1280, 900);
    await 결과있게(page);
    const dl = page.waitForEvent('download', { timeout: 3000 }).then((d) => d.suggestedFilename()).catch(() => null);
    await page.evaluate(() => document.getElementById('downloadResultBtn').click());
    const name = await dl;
    ok(name && name.endsWith('.png'), '파일로 내려받는다', String(name));
  }

  console.log('\n다운로드 — 결과가 없을 때 안내가 거짓말하지 않는다');
  {
    const { page } = await open(browser, 393, 852);
    let msg = '';
    page.removeAllListeners('dialog');
    page.on('dialog', (d) => { msg = d.message(); d.dismiss(); });
    await page.evaluate(() => window.__anshimTest.setMethodForTest('ai'));
    await page.evaluate(() => document.getElementById('downloadResultBtn').click());
    await page.waitForTimeout(400);
    ok(msg && !msg.includes('준비 중'), '«준비 중»이라고 하지 않는다(실패해도 그렇게 말했다)', msg);
  }

  await browser.close();
  console.log('\n' + pass + '개 통과, ' + fail + '개 실패');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('실패:', e.message); process.exit(1); });
