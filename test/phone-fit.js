/*
 * 폰 한 화면에 들어가는지 잰다.
 *
 * 고치기 전 실측(390x844): screen-correct 517자 / 1658px / 폰 화면 2.0개분.
 * 시안 기준선: 진단 결과·보정 모두 넘침 0.
 */
const { chromium } = require('playwright');
const URL = process.env.ANSHIM_URL || 'http://localhost:8000/index.html';

// Task 2의 test/fold.js와 글자까지 같은 R — 두 파일이 어긋나면 한쪽만 통과한다(R5).
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
  // 한 글자짜리로 재면 「지금 할 일」이 35px로 나와 "한 화면에 들어간다"가 거짓이 된다.
  // 실제 권장 조치는 문장이고 폰 폭에서 두세 줄을 먹는다.
  actions: [
    '가슴의 마크를 지우고 교복 색을 바꿔서 어느 학교인지 알 수 없게 해주세요.',
    '캡션에서 학교명과 요일·시간을 빼주세요. 셋이 모이면 등하원 시간이 드러나요.',
    '전체공개 대신 친구만 볼 수 있게 바꾸고, 며칠 지난 뒤에 올려주세요.',
  ],
  summary: '학교가 특정될 수 있어요.', captionSuggestions: ['1', '2', '3'],
};

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

const 폭들 = [390, 430, 560];

(async () => {
  const browser = await chromium.launch();
  for (const w of 폭들) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, locale: 'ko-KR' });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(900);
    await page.evaluate((a) => {
      // 결과 화면을 먼저 보여줘야 한다 — 안 그러면 #screen-result가 display:none이라
      // 크기가 0으로 잡힌다 (test/fold.js와 같은 준비 절차).
      window.__anshimTest.showScreenForTest('result');
      window.__anshimTest.stopScoreTickerForTest();
      window.__anshimTest.renderResultForTest(a, { faces: [] }, { words: [], visualClues: [] });
    }, R);
    await page.waitForTimeout(400);

    // 결과 화면을 화면 맨 위로 올린 뒤에 잰다. 스크롤 위치가 제각각이면
    // 고정된 바와의 겹침이 실행마다 다르게 나온다.
    await page.evaluate(() => {
      document.getElementById('screen-result').scrollIntoView({ block: 'start' });
    });
    await page.waitForTimeout(200);

    const 잰값 = await page.evaluate(() => {
      const el = document.getElementById('screen-result');
      const bar = document.querySelector('.app-actionbar');
      const pos = bar ? getComputedStyle(bar).position : '';
      const br = bar ? bar.getBoundingClientRect() : null;

      // 높이만 재면 **바가 글자를 덮고 있어도 통과한다.** 실제로 그랬다 —
      // 액션 바가 권장 조치 문장을 "…교복 색을 바꿔서"에서 잘랐는데 높이는
      // 831px로 멀쩡했다.
      //
      // 그렇다고 좌표로 겹침을 재면 **스크롤이 어디에 멈추느냐에 따라 결과가
      // 흔들린다** — scrollIntoView가 실행마다 14px에도, 65px에도 내려앉았다.
      // 그래서 자리 계산으로 잰다: 내용 높이가 "바 위에 남는 자리"에 들어가는가.
      // 이건 스크롤과 무관해서 항상 같은 답을 준다.
      const tab = document.querySelector('.app-tabbar');
      const 바높이 = br ? br.height : 0;
      const 탭높이 = tab ? tab.getBoundingClientRect().height : 0;
      const 아래여백 = parseFloat(getComputedStyle(el).paddingBottom) || 0;
      return {
        높이: Math.round(el.getBoundingClientRect().height),
        // sticky든 fixed든 "화면 아래에 붙어 있다"가 요구사항이다
        액션바: !!bar && (pos === 'sticky' || pos === 'fixed'),
        위치: pos,
        // 아래여백은 고정된 바가 앉을 자리라 내용이 아니다 — 빼고 잰다
        내용: Math.round(el.getBoundingClientRect().height - 아래여백),
        자리: Math.round(window.innerHeight - 탭높이 - 바높이),
      };
    });
    console.log('\n폭 ' + w + 'px');
    ok(잰값.높이 <= 844, '진단 결과가 한 화면에 들어간다', 잰값.높이 + 'px');
    ok(잰값.액션바, '하단 액션 바가 화면에 붙어 있다', 잰값.위치);
    ok(잰값.내용 <= 잰값.자리, '액션 바가 글자를 덮지 않는다',
      '내용 ' + 잰값.내용 + 'px / 바 위 자리 ' + 잰값.자리 + 'px');

    // ── 보정 화면 ──────────────────────────────────────────────────────
    // 고치기 전 실측(390x844): 517자 / 1658px / 폰 화면 2.0개분.
    // 방식 카드가 335px씩 쌓여서 화면을 다 먹었다.
    await page.evaluate(() => {
      window.__anshimTest.showScreenForTest('correct');
      document.getElementById('screen-correct').scrollIntoView({ block: 'start' });
    });
    await page.waitForTimeout(300);

    const 보정 = await page.evaluate(() => {
      const el = document.getElementById('screen-correct');
      const cards = [...document.querySelectorAll('.method-card')]
        .filter((c) => getComputedStyle(c).display !== 'none');
      const grid = document.querySelector('.method-grid');
      const bar = el.querySelector('.app-actionbar');
      const tab = document.querySelector('.app-tabbar');
      const 아래여백 = parseFloat(getComputedStyle(el).paddingBottom) || 0;
      const 바높이 = bar ? bar.getBoundingClientRect().height : 0;
      const 탭높이 = tab ? tab.getBoundingClientRect().height : 0;
      const preview = document.getElementById('compareGrid');
      return {
        높이: Math.round(el.getBoundingClientRect().height),
        가장큰카드: cards.length ? Math.max(...cards.map(
          (c) => Math.round(c.getBoundingClientRect().height))) : 0,
        두열: grid
          ? getComputedStyle(grid).gridTemplateColumns.trim().split(/\s+/).length === 2
          : false,
        // 미리보기가 방식 목록보다 위에 있는가. DOM은 안 옮기고 order로만 바꾸므로
        // 실제로 그려진 자리를 잰다.
        미리보기가위: !!preview && !!grid
          && preview.getBoundingClientRect().top < grid.getBoundingClientRect().top,
        내용: Math.round(el.getBoundingClientRect().height - 아래여백),
        자리: Math.round(window.innerHeight - 탭높이 - 바높이),
        바있음: !!bar,
      };
    });
    ok(보정.높이 <= 844, '보정 화면이 한 화면에 들어간다', 보정.높이 + 'px');
    ok(보정.가장큰카드 <= 150, '방식 카드가 150px를 넘지 않는다', 보정.가장큰카드 + 'px');
    ok(보정.두열, '방식이 2열 타일이다');
    ok(보정.미리보기가위, '원본/처리 후가 방식 목록보다 위에 있다');
    ok(보정.바있음 && 보정.내용 <= 보정.자리, '액션 바가 글자를 덮지 않는다',
      '내용 ' + 보정.내용 + 'px / 바 위 자리 ' + 보정.자리 + 'px');

    await ctx.close();
  }
  await browser.close();
  console.log('\n' + pass + '개 통과, ' + fail + '개 실패');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('실패:', e.message); process.exit(1); });
