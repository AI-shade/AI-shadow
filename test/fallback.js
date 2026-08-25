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

// server.js의 RISK_FACTORS와 같아야 한다. 캡션 노출은 원래 캡션 제안에서만 보고
// 점수에는 안 들어갔는데, 실제로는 캡션이 가장 대놓고 흘리는 통로라 항목으로 넣었다.
const 서버항목 = [
  ['간판·주소 노출', 26], ['소속 노출', 22], ['인물 식별성', 18],
  ['캡션 노출', 18], ['게시 습관', 16],
];

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

    ok(Array.isArray(r.riskFactors) && r.riskFactors.length === 5,
      '항목 5개가 있다', '받은 값 ' + (r.riskFactors ? r.riskFactors.length : '없음'));

    if (r.riskFactors && r.riskFactors.length === 5) {
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
      const capSum = r.riskFactors.reduce((n, f) => n + f.상한, 0);
      ok(capSum === 100, '상한을 다 더하면 100이다', String(capSum));
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
    ok(drawn.줄수 === 5, '내역이 5줄로 그려진다', String(drawn.줄수));
    ok(drawn.합계.indexOf('= ' + r.score + '점') >= 0,
      '"합계 … = N점"이 게이지와 맞는다', drawn.합계 + ' / 게이지 ' + drawn.게이지);
    ok(drawn.게이지 === String(r.score), '게이지 숫자가 총점과 같다', drawn.게이지);
    ok(drawn.배지 === r.grade, '배지가 등급과 같다', drawn.배지);
  }

  console.log('\n[캡션 노출 — 새로 넣은 항목]');
  const 캡션 = await page.evaluate((base) => {
    const f = window.__anshimTest.buildMockDiagnosisForTest;
    const mk = (cap) => {
      const d = f(Object.assign({}, base, { caption: cap }), { words: [], visualClues: [] }, { faces: [] });
      return d.riskFactors.find((x) => x.항목 === '캡션 노출');
    };
    return {
      없음: mk(''),
      평범: mk('오늘도 즐거운 하루'),
      위험: mk('오늘 푸른숲어린이집 첫 등원! 매주 화요일 4시에 놀아요'),
    };
  }, { privacySetting: '전체공개', uploadTiming: '실시간 업로드', backgroundNotes: '', companions: '' });
  ok(캡션.없음.점수 === 0, '캡션을 안 쓰면 0점이다', String(캡션.없음.점수));
  ok(/쓰지 않으셔서/.test(캡션.없음.근거), '안 썼다는 사실을 근거로 말한다', 캡션.없음.근거);
  ok(캡션.평범.점수 === 0, '평범한 캡션은 0점이다', String(캡션.평범.점수));
  ok(캡션.위험.점수 > 0, '기관명·요일·시간이 있으면 점수가 붙는다', String(캡션.위험.점수));
  ok(캡션.위험.점수 > 캡션.평범.점수, '위험한 캡션이 평범한 캡션보다 높다',
    캡션.위험.점수 + ' vs ' + 캡션.평범.점수);

  console.log('\n[조사(이/가) — 목록을 이어붙인 문장에 "이(가)"가 그대로 남던 문제]');
  // 예전엔 "이름·일정·시간대이(가) 적혀 있어요"처럼 조사 자리를 placeholder로 남겨뒀다.
  // 마지막 낱말의 받침 여부에 따라 이/가 중 하나만 골라 붙어야 한다.
  const 최악근거 = await page.evaluate((c) => {
    const d = window.__anshimTest.buildMockDiagnosisForTest(c.inputs, c.ocr, c.face);
    return d.riskFactors.find((x) => x.항목 === '소속 노출').근거;
  }, 상황.최악);
  ok(!/\(가\)|\(이\)/.test(최악근거), '소속 노출 근거에 "이(가)" placeholder가 안 남는다', 최악근거);
  ok(최악근거 === '교복·로고/엠블럼이 보여서 다니는 기관까지 좁혀져요.',
    '받침 있는 마지막 낱말("엠블럼")엔 "이"가 붙는다', 최악근거);

  const 캡션근거 = await page.evaluate(() => {
    const f = window.__anshimTest.buildMockDiagnosisForTest;
    const d = f({ privacySetting: '전체공개', uploadTiming: '실시간 업로드', backgroundNotes: '', companions: '',
      caption: '오늘 푸른숲어린이집 첫 등원! 매주 화요일 4시에 놀아요' }, { words: [], visualClues: [] }, { faces: [] });
    return d.riskFactors.find((x) => x.항목 === '캡션 노출').근거;
  });
  ok(!/\(가\)|\(이\)/.test(캡션근거), '캡션 노출 근거에 "이(가)" placeholder가 안 남는다', 캡션근거);
  ok(/시간대가 적혀 있어요\.$/.test(캡션근거), '받침 없는 마지막 낱말("시간대")엔 "가"가 붙는다', 캡션근거);

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
