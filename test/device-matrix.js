/*
 * 기기별 화면 — 실제 기기 크기 30여 개에서 화면마다 같은 것을 잰다.
 *
 * 멘토링 2회차(11-01): "기기별 화면 비율을 조사해 AI에게 각 비율에서 테스트하라고 시키기(E2E 테스트 등)."
 *
 * 기기 크기는 짐작하지 않고 Playwright 기기 목록(playwright.devices)에서 그대로 가져온다.
 *   viewport = 브라우저 주소창·도구막대를 뺀 실제 보이는 칸 (사파리·크롬으로 열었을 때)
 *   screen   = 화면 전체 (홈 화면에 추가해 앱처럼 열었을 때 — 튕김 제보가 이 방식이었다)
 * 아이폰·아이패드는 WebKit(사파리 엔진), 안드로이드는 Chromium으로 돌린다.
 *
 * 재는 것 (화면마다):
 *   ① 가로로 밀리지 않는다       — 문서 폭이 화면 폭을 넘지 않는다
 *   ② 단추가 가려지지 않는다     — 단추를 화면 가운데로 굴린 뒤 그 자리를 짚으면 단추가 잡힌다
 *                                  (탭바·액션바가 덮으면 다른 요소가 잡힌다 — d49db95가 고친 종류)
 *   ③ 탭바가 화면 안에 있다       — 폰 배치일 때
 *   ④ 페이지 에러가 없다
 *
 * 화면: 홈 → 사진 올린 홈 → 진단 결과 → 보정 → 검증 → (폰 배치면) 과거글·알아보기 쪽마다·문답
 *
 * 사용법: test 폴더에서 → node device-matrix.js
 *   프런트가 8000(또는 ANSHIM_URL)에서. /api는 가로채므로 비용 0.
 *   SHOTS=폴더  를 주면 기기·화면마다 스크린숏을 남긴다.
 *   ONLY=iPhone  처럼 주면 이름에 그 글자가 든 기기만 돈다.
 */
const fs = require('fs');
const path = require('path');
const { chromium, webkit, devices } = require('playwright');
const URL = process.env.ANSHIM_URL || 'http://localhost:8000/index.html';
const SHOTS = process.env.SHOTS || '';
const ONLY = process.env.ONLY || '';
const PHOTO = path.join(__dirname, 'fixtures', 'face-plus-text.jpg');

// ── 기기 목록 ────────────────────────────────────────────────────────────
// 한국에서 많이 쓰는 것 + 가장 좁은 것 + 가장 낮은 것 + 접는 폰 + 태블릿.
const 폰 = [
  'iPhone SE (3rd gen)', 'iPhone 13 Mini', 'iPhone 13', 'iPhone 14 Pro', 'iPhone 15', 'iPhone 15 Pro Max',
  'iPhone 16 Pro', 'iPhone 16 Pro Max', 'iPhone 17', 'iPhone Air',
  'Galaxy S24', 'Galaxy S8', 'Galaxy A55', 'Pixel 8', 'Pixel 9', 'Pixel 9 Pro XL',
  'Galaxy Z Flip 7', 'Galaxy Z Fold 7 Cover', 'Galaxy Z Fold 6 Cover',
];
// 홈 화면에 추가해 앱처럼 열면 주소창이 없어 화면 전체를 쓴다
const 앱처럼 = ['iPhone SE (3rd gen)', 'iPhone 13', 'iPhone 15', 'iPhone 16 Pro Max'];
const 가로 = ['iPhone 13', 'iPhone 15 Pro Max', 'Galaxy S24'];
const 큰화면 = ['iPad Mini', 'iPad (gen 11)', 'iPad Pro 11', 'Galaxy Tab S9', 'Galaxy Z Fold 7', 'Galaxy Z Fold 6'];
// 목록에 없는 크기: 삼성 인터넷으로 연 갤럭시 S22+ (phone-pages.js의 실측), 가장 좁은 구형 폰
const 직접 = [
  { 이름: 'Galaxy S22+ 삼성인터넷', viewport: { width: 384, height: 653 }, 엔진: 'chromium', mobile: true },
  { 이름: 'iPhone SE 1세대 (320)', base: 'iPhone SE' },
];

function 기기(이름, 방식) {
  const d = devices[이름 + (방식 === '가로' ? ' landscape' : '')];
  if (!d) throw new Error('기기 목록에 없음: ' + 이름);
  const viewport = 방식 === '앱' && d.screen ? { ...d.screen } : { ...d.viewport };
  return {
    이름: 이름 + (방식 === '앱' ? ' · 앱처럼' : 방식 === '가로' ? ' · 가로' : ''),
    엔진: d.defaultBrowserType,
    ctx: { viewport, deviceScaleFactor: d.deviceScaleFactor, isMobile: d.isMobile, hasTouch: d.hasTouch, userAgent: d.userAgent },
  };
}
const 목록 = [
  ...폰.map((n) => 기기(n)),
  ...앱처럼.map((n) => 기기(n, '앱')),
  ...가로.map((n) => 기기(n, '가로')),
  ...큰화면.map((n) => 기기(n)),
  ...직접.map((x) => x.base ? { ...기기(x.base), 이름: x.이름 }
    : { 이름: x.이름, 엔진: x.엔진, ctx: { viewport: x.viewport, isMobile: x.mobile, hasTouch: x.mobile, deviceScaleFactor: 3 } }),
].filter((d) => !ONLY || d.이름.includes(ONLY));

// phone-fit.js와 같은 길이의 진단 결과 — 한 글자짜리로 재면 화면이 거짓으로 들어간다
const R = {
  score: 60, grade: '중',
  riskFactors: [
    { 항목: '간판·주소 노출', 점수: 0, 상한: 26, 근거: '사진에 식별 가능한 간판이나 주소 글자가 없습니다.' },
    { 항목: '소속 노출', 점수: 22, 상한: 22, 근거: '명확한 교복과 가슴의 명찰이 학교 특정을 가능하게 하며, 캡션의 학교명으로 이중 확인됩니다.' },
    { 항목: '인물 식별성', 점수: 4, 상한: 18, 근거: '얼굴이 매우 작게 촬영되어 단독으로는 식별이 어렵습니다.' },
    { 항목: '캡션 노출', 점수: 18, 상한: 18, 근거: '학교명, 학년, 요일, 시간, 장소가 모두 명시되어 있습니다.' },
    { 항목: '게시 습관', 점수: 16, 상한: 16, 근거: '전체공개 계정에 실시간 업로드했습니다.' },
  ],
  uploadTiming: '실시간 업로드', privacySetting: '전체공개',
  locationScore: 78, locationEvidence: '교복과 캡션으로 학교가 좁혀져요.',
  scheduleOn: true, scheduleEvidence: '매주 화·목 4시', schedulePatterns: [], schedulePredicted: '',
  actions: [
    '가슴의 마크를 지우고 교복 색을 바꿔서 어느 학교인지 알 수 없게 해주세요.',
    '캡션에서 학교명과 요일·시간을 빼주세요. 셋이 모이면 등하원 시간이 드러나요.',
    '전체공개 대신 친구만 볼 수 있게 바꾸고, 며칠 지난 뒤에 올려주세요.',
  ],
  summary: '학교가 특정될 수 있어요.', captionSuggestions: ['1', '2', '3'],
};

// ── 화면 하나를 재는 함수 (브라우저 안에서 돈다) ─────────────────────────
// 반환: { 폭, 문서폭, 넘친요소[], 가린단추[], 탭바 }
async function 재기(page) {
  // 단추를 하나씩 가운데로 굴리며 짚는다. 굴리는 것은 브라우저 안에서 해야 빠르다.
  return page.evaluate(async () => {
    // 페이지가 scroll-behavior: smooth라 굴리자마자 짚으면 아직 굴러가는 중이다 — 즉시 굴린다
    document.documentElement.style.scrollBehavior = 'auto';
    document.body.style.scrollBehavior = 'auto';
    const W = innerWidth, H = innerHeight;
    const 보임 = (e) => {
      if (!e.getClientRects().length) return false;
      const s = getComputedStyle(e);
      if (s.visibility === 'hidden' || +s.opacity === 0) return false;
      const r = e.getBoundingClientRect();
      return r.width > 2 && r.height > 2;
    };
    const 이름 = (e) => {
      const t = (e.innerText || e.value || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 18);
      return e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/)[0] : '') + (t ? ' «' + t + '»' : '');
    };
    // 가로로 굴리는 칸(칩 줄 등) 안의 요소는 일부러 넘친다 — 그 칸이 화면 안이면 괜찮다
    const 가로굴림안 = (e) => {
      for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
      }
      return false;
    };

    const 문서폭 = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    const 넘친요소 = [];
    if (문서폭 > W + 1) {
      for (const e of document.body.querySelectorAll('*')) {
        if (!보임(e) || 가로굴림안(e)) continue;
        const r = e.getBoundingClientRect();
        if (r.right > W + 1 || r.left < -1) 넘친요소.push(이름(e) + ' [' + Math.round(r.left) + '~' + Math.round(r.right) + ']');
        if (넘친요소.length >= 6) break;
      }
    }

    // 단추: 화면 흐름 안의 누를 것들. 탭바·액션바 자신은 빼고(그게 가리는 쪽이다), 굴림 칸 안의 것도 뺀다.
    const 고정 = (e) => { for (let p = e; p && p !== document.body; p = p.parentElement) { const s = getComputedStyle(p).position; if (s === 'fixed' || s === 'sticky') return true; } return false; };
    const 단추들 = [...document.querySelectorAll('button, a.btn, [role="button"], input[type="checkbox"], input[type="radio"], label.method-card, select')]
      .filter((e) => 보임(e) && !고정(e) && !가로굴림안(e) && !e.closest('[aria-hidden="true"], .app-tabbar, dialog:not([open])'));
    const 가린단추 = [];
    for (const b of 단추들.slice(0, 60)) {
      b.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      const r = b.getBoundingClientRect();
      // 화면보다 큰 요소는 보이는 부분 가운데를 짚는다
      const x = Math.min(Math.max(r.left + r.width / 2, 1), W - 1);
      const y = Math.min(Math.max(r.top + Math.min(r.height, H) / 2, 1), H - 1);
      const hit = document.elementFromPoint(x, y);
      if (!hit) continue;
      const 같은편 = b.contains(hit) || hit.contains(b) || (b.tagName === 'INPUT' && b.labels && [...b.labels].some((l) => l.contains(hit)))
        || (hit.tagName === 'LABEL' && hit.control === b);
      if (!같은편) 가린단추.push(이름(b) + ' ← ' + 이름(hit));
    }
    window.scrollTo(0, 0);

    const tab = document.querySelector('.app-tabbar');
    const 폰배치 = !!tab && getComputedStyle(tab).display !== 'none';
    const tr = 폰배치 ? tab.getBoundingClientRect() : null;
    return {
      폭: W, 높이: H, 문서폭, 넘친요소, 가린단추, 단추수: 단추들.length, 폰배치,
      탭바안: !폰배치 || (tr.top >= 0 && tr.bottom <= H + 1 && tr.height > 20),
    };
  });
}

let pass = 0, fail = 0;
const 실패목록 = [];
function ok(cond, 기기이름, name, detail) {
  if (cond) { pass++; return; }
  fail++;
  실패목록.push(기기이름 + ' | ' + name + (detail ? ' → ' + detail : ''));
  console.log('  ✗ ' + name + (detail ? '  → ' + detail : ''));
}

(async () => {
  const 엔진 = { chromium: await chromium.launch(), webkit: await webkit.launch() };
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const 요약 = [];

  for (const d of 목록) {
    const { width: w, height: h } = d.ctx.viewport;
    console.log('\n■ ' + d.이름 + '  ' + w + 'x' + h + '  (' + d.엔진 + ')');
    const ctx = await 엔진[d.엔진].newContext({ ...d.ctx, locale: 'ko-KR' });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
    await page.route('**/api/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(900);

    let 화면수 = 0, 폰배치 = false;
    const 검사 = async (화면) => {
      await page.waitForTimeout(250);
      const m = await 재기(page);
      폰배치 = m.폰배치;
      화면수++;
      ok(m.문서폭 <= m.폭 + 1, d.이름, 화면 + ': 가로로 밀리지 않는다', '문서 ' + m.문서폭 + 'px / 화면 ' + m.폭 + 'px  ' + m.넘친요소.join(', '));
      ok(m.가린단추.length === 0, d.이름, 화면 + ': 단추가 가려지지 않는다', m.가린단추.slice(0, 4).join(' | '));
      ok(m.탭바안, d.이름, 화면 + ': 탭바가 화면 안에 있다');
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, (d.이름 + ' - ' + 화면).replace(/[\\/:*?"<>|]/g, '_') + '.png') });
    };

    await 검사('홈');

    await page.setInputFiles('#photoInput', PHOTO);
    await page.waitForFunction(() => document.getElementById('photoPreview').naturalWidth > 0, null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(500); // 미리보기가 자리를 잡은 뒤
    await 검사('사진 올린 홈');
    // 세로로 든 폰: 사진을 올린 홈의 주인공은 «위험도 진단하기» — 굴리지 않은 첫 화면에서 탭바 위에 보여야 한다(d49db95).
    // 가로 폰·태블릿은 굴려서 누를 수 있으면 된다(위 «단추가 가려지지 않는다»가 이미 잰다).
    if (폰배치 && h > w) {
      const 진단단추 = await page.evaluate(() => {
        window.scrollTo(0, 0);
        const b = document.getElementById('submitBtn');
        const r = b.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { 보임: r.bottom <= innerHeight && !!hit && (b.contains(hit) || hit.contains(b)), 아래: Math.round(r.bottom), H: innerHeight, 덮은것: hit ? hit.className || hit.tagName : '' };
      });
      ok(진단단추.보임, d.이름, '사진 올린 홈: «위험도 진단하기»가 첫 화면에 보인다', '단추 아래 ' + 진단단추.아래 + ' / 화면 ' + 진단단추.H + ' · ' + 진단단추.덮은것);
    }

    await page.evaluate((a) => {
      const t = window.__anshimTest;
      t.showScreenForTest('result');
      t.stopScoreTickerForTest();
      t.renderResultForTest(a, { faces: [] }, { words: [], visualClues: [] });
    }, R);
    await 검사('진단 결과');

    await page.evaluate(() => window.__anshimTest.showScreenForTest('correct'));
    await 검사('보정');

    await page.evaluate(() => {
      window.__anshimTest.showScreenForTest('verify');
      document.getElementById('verifyDetail').textContent = '⚖ 두 검증자의 판단이 갈렸어요. 설명을 읽은 쪽은 통과로 봤지만 사진을 직접 본 쪽은 재검토가 필요하다고 했어요. 추가 조치: 마크 지우기를 한 번 더 적용하거나 옷 색을 함께 바꿔보세요.';
    });
    await 검사('검증');

    // 탭은 사람처럼 눌러 본다 — 다른 요소가 탭바를 덮으면 못 누른다(가로 폰에서 실제로 그랬다)
    const 누르기 = async (sel, 화면) => {
      try { await page.click(sel, { timeout: 3000 }); return true; }
      catch (e) {
        const 덮은것 = (/<([^>]+)>[^<]*from|<([^>]+)> intercepts|<([^>]+)>…<\/[a-z]+> (?:from|intercepts)/.exec(e.message) || [])[0] || e.message.split('\n')[0];
        ok(false, d.이름, 화면 + ': 누를 수 있다', 덮은것.slice(0, 120));
        await page.$eval(sel, (b) => b.click());
        return false;
      }
    };
    if (폰배치) {
      for (const t of ['과거글', '문답']) {
        await 누르기(`.app-tab[data-goto="${t}"]`, t + ' 탭 단추');
        await 검사(t + ' 탭');
      }
      await 누르기('.app-tab[data-goto="알아보기"]', '알아보기 탭 단추');
      const 쪽수 = await page.$$eval('section[data-tab-of="알아보기"]', (els) => els.length);
      for (let i = 0; i < 쪽수; i++) {
        await 검사('알아보기 ' + (i + 1) + '쪽');
        if (i < 쪽수 - 1) await 누르기('#pagerNext', '알아보기 다음 쪽 단추');
      }
    }

    ok(errs.length === 0, d.이름, '페이지 에러 없음', errs.join(' | '));
    요약.push({ 기기: d.이름, 크기: w + 'x' + h, 엔진: d.엔진, 배치: 폰배치 ? '폰' : '웹', 화면수, 실패: 실패목록.filter((x) => x.startsWith(d.이름 + ' |')).length });
    console.log('  ' + (폰배치 ? '폰 배치' : '웹 배치') + ' · 화면 ' + 화면수 + '개 · 실패 ' + 요약[요약.length - 1].실패);
    await ctx.close();
  }

  await 엔진.chromium.close();
  await 엔진.webkit.close();

  console.log('\n─── 기기별 요약 ───');
  for (const s of 요약) console.log((s.실패 ? '✗ ' : '✓ ') + s.기기.padEnd(34) + s.크기.padEnd(11) + s.엔진.padEnd(9) + s.배치 + '  화면 ' + s.화면수 + (s.실패 ? '  실패 ' + s.실패 : ''));
  console.log('\n' + pass + '개 통과, ' + fail + '개 실패 (기기 ' + 요약.length + '대)');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('실패:', e.message); process.exit(1); });
