/*
 * 근거 접기 검사.
 *
 * 제보: "한 화면에 글이 너무많아" — 항목별 근거 산문 5개가 300자를 넘었다.
 * 지우지 않고 접는다. AGENTS.md가 "항목별로 받는 이유는 근거를 댈 수 있어야
 * 하기 때문"이라고 못박고 있어서, 근거를 없애면 제품의 핵심이 깎인다.
 *
 * 그래서 이 파일이 지키는 것은 "접혔다"가 아니라 "접혀도 점수는 보인다"이다.
 */
const { chromium } = require('playwright');
const URL = process.env.ANSHIM_URL || 'http://localhost:8000/index.html';

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

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(900);

  await page.evaluate((a) => {
    // 결과 화면을 먼저 보여줘야 한다 — 안 그러면 #screen-result가 display:none이라
    // .why-btn이 렌더는 되어도 클릭 가능한 크기(0×0)가 아니게 된다.
    // (a11y.js·fallback.js·settle.js도 renderResultForTest 앞에 이 호출을 둔다.)
    window.__anshimTest.showScreenForTest('result');
    window.__anshimTest.stopScoreTickerForTest();
    window.__anshimTest.renderResultForTest(a, { faces: [] }, { words: [], visualClues: [] });
  }, R);
  await page.waitForTimeout(500);

  // 폰에서는 오각형이 다섯 항목의 값을 그림 위에 이미 적으므로 막대 목록이
  // 「항목별로 보기」 뒤에 접혀 있다. 근거 접기(왜?)는 그 안에 있으니 먼저 편다.
  // 데스크톱에서는 이 단추가 안 보이고 목록도 처음부터 펼쳐져 있다.
  await page.evaluate(() => {
    const more = document.querySelector('.sb-more');
    if (more && getComputedStyle(more).display !== 'none') more.click();
  });
  await page.waitForTimeout(300);

  const 첫상태 = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.why-btn'));
    const 보이나 = el => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden'; };
    return {
      단추수: btns.length,
      전부버튼: btns.every(b => b.tagName === 'BUTTON'),
      전부접힘: btns.every(b => b.getAttribute('aria-expanded') === 'false'),
      근거숨음: Array.from(document.querySelectorAll('.why-body')).every(p => !보이나(p)),
      점수보임: Array.from(document.querySelectorAll('.sb-score')).every(보이나),
      막대보임: Array.from(document.querySelectorAll('.sb-bar')).every(보이나),
      막대채움: Array.from(document.querySelectorAll('.sb-bar > *')).map(i => i.style.width),
    };
  });

  console.log('접힌 상태');
  ok(첫상태.단추수 === 5, '항목마다 «왜?» 단추가 있다', 첫상태.단추수 + '개');
  ok(첫상태.전부버튼, '진짜 <button>이다 (div onclick 아님)');
  ok(첫상태.전부접힘, 'aria-expanded="false"로 시작한다');
  ok(첫상태.근거숨음, '근거 산문은 숨어 있다');
  ok(첫상태.점수보임, '점수는 접혀도 보인다');
  ok(첫상태.막대보임, '막대는 접혀도 보인다');
  ok(첫상태.막대채움.some(w => w && w !== '0%'), '막대가 채워져 있다 (기다리는 중처럼 보이지 않는다)',
     첫상태.막대채움.join(' '));

  await page.click('.why-btn');
  await page.waitForTimeout(250);
  const 편뒤 = await page.evaluate(() => {
    const b = document.querySelector('.why-btn');
    const p = document.querySelector('.why-body');
    const s = getComputedStyle(p);
    return { 열림: b.getAttribute('aria-expanded') === 'true', 근거보임: s.display !== 'none', 글: p.innerText.trim().length };
  });
  console.log('\n펼친 뒤');
  ok(편뒤.열림, 'aria-expanded가 true로 바뀐다');
  ok(편뒤.근거보임, '근거가 보인다');
  ok(편뒤.글 > 10, '근거 글이 실제로 들어 있다', 편뒤.글 + '자');

  // JS가 접기를 못 붙인 경우 — 글이 사라지면 안 된다
  const 무JS = await page.evaluate(() => {
    document.documentElement.classList.remove('fold-on');
    return Array.from(document.querySelectorAll('.why-body'))
      .every(p => getComputedStyle(p).display !== 'none');
  });
  console.log('\nJS가 죽은 상태');
  ok(무JS, '접기 클래스가 없으면 근거가 펼쳐진 채로 남는다');

  await browser.close();
  console.log('\n' + pass + '개 통과, ' + fail + '개 실패');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('실패:', e.message); process.exit(1); });
