/*
 * Claude 진단 호출이 실패했을 때 쓰는 규칙 기반 폴백 검증.
 *
 * 예전에는 buildMockDiagnosis가 riskFactors를 만들지 않아서, 실패하면
 * "왜 이 점수인지" 내역 카드가 통째로 사라졌다(renderRiskFields는 factors가
 * 없으면 display:none 한다). 이미 무너진 상황에서 점수를 납득시킬 근거까지
 * 같이 사라지던 셈이다. 그리고 등급 기준이 서버는 40, 클라이언트는 45라
 * 40~44점에서는 배지와 게이지 색이 서로 달랐다.
 */
const { chromium } = require('playwright');
const URL = process.env.ANSHIM_URL || 'http://localhost:8000/index.html';

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

const 서버항목 = [['간판·주소 노출', 30], ['소속 노출', 25], ['인물 식별성', 20], ['게시 습관', 15]];

const 상황 = {
  최악: {
    inputs: { privacySetting: '전체공개', uploadTiming: '실시간 업로드', backgroundNotes: '푸른숲 유치원 앞', companions: '', caption: '' },
    ocr: { words: [{ text: '푸른숲유치원', type: '상호명' }, { text: '02-123-4567', type: '전화번호' }],
           visualClues: [{ 종류: '교복', 근거: '교복' }, { 종류: '로고/엠블럼', 근거: '엠블럼' }] },
    face: { faces: [{}, {}] },
  },
  깨끗: {
    inputs: { privacySetting: '친구공개', uploadTiming: '시간차 업로드', backgroundNotes: '', companions: '', caption: '' },
    ocr: { words: [], visualClues: [] },
    face: { faces: [] },
  },
  중간: {
    inputs: { privacySetting: '전체공개', uploadTiming: '시간차 업로드', backgroundNotes: '', companions: '', caption: '' },
    ocr: { words: [], visualClues: [{ 종류: '교복', 근거: '교복' }] },
    face: { faces: [{}] },
  },
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 140)));
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(900);

  console.log('\n[등급 기준이 서버와 같은가]');
  const grades = await page.evaluate(() =>
    [0, 39, 40, 44, 69, 70, 100].map((n) => [n, window.__anshimTest.gradeOfForTest(n)]));
  const 기대 = { 0: '하', 39: '하', 40: '중', 44: '중', 69: '중', 70: '상', 100: '상' };
  grades.forEach(([n, g]) => ok(g === 기대[n], n + '점 → ' + 기대[n], '받은 값 ' + g));

  for (const 이름 of Object.keys(상황)) {
    const c = 상황[이름];
    console.log('\n[' + 이름 + ' 상황]');
    const r = await page.evaluate((a) =>
      window.__anshimTest.buildMockDiagnosisForTest(a[0], a[1], a[2]), [c.inputs, c.ocr, c.face]);

    ok(Array.isArray(r.riskFactors) && r.riskFactors.length === 4,
      '항목 4개가 있다', '받은 값 ' + (r.riskFactors ? r.riskFactors.length : '없음'));

    if (r.riskFactors && r.riskFactors.length === 4) {
      서버항목.forEach((def, i) => {
        const f = r.riskFactors[i];
        ok(f.항목 === def[0] && f.상한 === def[1],
          '항목 ' + (i + 1) + '이 서버와 같다 (' + def[0] + ' / ' + def[1] + '점)',
          f.항목 + ' / ' + f.상한);
        ok(f.점수 >= 0 && f.점수 <= f.상한, def[0] + ' 점수가 0~상한 안에 있다', String(f.점수));
        ok(typeof f.근거 === 'string' && f.근거.length > 0, def[0] + '에 근거가 있다');
      });
      const sum = r.riskFactors.reduce((n, f) => n + f.점수, 0);
      ok(sum === r.score, '총점이 항목의 합과 같다', sum + ' vs ' + r.score);
      ok(r.grade === (r.score >= 70 ? '상' : r.score >= 40 ? '중' : '하'), '등급이 총점과 맞는다');
    }

    ok(r.uploadTiming === c.inputs.uploadTiming && r.privacySetting === c.inputs.privacySetting,
      '체크리스트 답을 실어 나른다 (장소 사슬이 쓴다)');
    ok(/규칙 기반/.test(r.summary || ''), '규칙 기반 결과라는 걸 밝힌다');
    ok(r.isFallback === true, '폴백 표시가 있다');

    // 실제로 그렸을 때 내역 카드가 살아 있는가
    const drawn = await page.evaluate((a) => {
      const T = window.__anshimTest;
      T.showScreenForTest('result');
      T.stopScoreTickerForTest();
      T.renderResultForTest(a, { faces: [] }, { words: [], visualClues: [] });
      const sb = document.getElementById('scoreBreakdown');
      return {
        보임: getComputedStyle(sb).display !== 'none',
        줄수: document.querySelectorAll('#sbList li').length,
        합계: document.getElementById('sbTotal').textContent,
        게이지: document.getElementById('riskScore').textContent,
        배지: document.getElementById('riskBadge').textContent,
      };
    }, r);
    ok(drawn.보임, '내역 카드가 화면에 남아 있다');
    ok(drawn.줄수 === 4, '내역이 4줄로 그려진다', String(drawn.줄수));
    ok(drawn.합계.indexOf('= ' + r.score + '점') >= 0,
      '"합계 … = N점"이 게이지와 맞는다', drawn.합계 + ' / 게이지 ' + drawn.게이지);
    ok(drawn.게이지 === String(r.score), '게이지 숫자가 총점과 같다', drawn.게이지);
    ok(drawn.배지 === r.grade, '배지가 등급과 같다', drawn.배지);
  }

  console.log('\n[상황에 따라 점수가 실제로 달라지는가]');
  const scores = await page.evaluate((all) => all.map((c) =>
    window.__anshimTest.buildMockDiagnosisForTest(c[0], c[1], c[2]).score),
    Object.keys(상황).map((k) => [상황[k].inputs, 상황[k].ocr, 상황[k].face]));
  ok(scores[0] > scores[2] && scores[2] > scores[1],
    '최악 > 중간 > 깨끗 순이다', scores.join(' > '));

  ok(errs.length === 0, '콘솔 에러가 없다', errs.join(' | '));

  await browser.close();
  console.log('\n결과: ' + pass + '/' + (pass + fail) + ' 통과');
  process.exit(fail === 0 ? 0 : 1);
})();
