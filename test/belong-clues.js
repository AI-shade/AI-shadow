// 아이섀도우 — 소속 단서 판정(isBelongClue / belongClueWeight) 테스트
//
// 사용법: 이 폴더(test)에서 → node belong-clues.js
//   프론트가 http://localhost:8000 에서 돌고 있어야 합니다. AI 호출 없음 (비용 0).
//
// 왜 필요한가: 사진 103장 측정에서 **안전한 사진 32장 중 21장**을 위험하다고 했다.
// 정체는 셋이었다.
//
//   [1] 부정문을 긍정으로 읽었다 — 판정이 `종류 + 근거`를 이어붙여 검사하는데
//       근거는 산문이다. 실측:
//           사진101  종류 "옷"        근거 "일반 사복으로 보임, 특정 기관의 교복·원복 특징 없음"
//           사진86   종류 "파란색 외투" 근거 "일반 사복으로 판단되며 특정 기관 식별 불가"
//       둘 다 소속 노출로 채점됐다. "교복이 아니다"에서 `교복`을 찾은 것이다.
//
//   [2] 못 읽는 명찰을 소속 노출로 셌다 — 오탐 21장 중 9장이 명찰이다.
//       프롬프트가 "글자가 안 보여도 보고"라고 시켰고, 채점은 그걸 12점으로 셌다.
//
//   [3] 판정이 세 곳(재확인·채점·위험요소지도)에 따로 적혀 있었고 서로 달랐다.
//       장소 글자에서 겪은 것과 똑같은 일이다(test/place-words.js 참고).
//
// 이 테스트가 지키는 것:
//   ① 근거를 검사하지 않는다 — 부정문이 다시 새면 여기서 걸린다.
//   ② 못 읽은 명찰은 12점이 아니다. 다만 0점도 아니다(원본에서는 읽힐 수 있다).
//   ③ 가방·사복은 소속 단서가 아니다. 옷 자체(교복·원복·도복)는 판독을 안 따진다.
//   ④ 세 곳이 같은 판정을 쓴다.
//
// **사진이 아니라 종류 문자열로 검사한다.** 종류 어휘는 Claude 출력의 성질이지
// 그 사진들의 성질이 아니므로, 문자열로 고정하는 것이 옳다 — 정답표 세트에
// 맞춰 튜닝하지 않기 위해서다.

const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';

// 사진 103장 측정에서 Claude가 실제로 돌려준 종류들 (2026-08-29)
const 소속으로_봐야_하는_종류 = [
  '교복', '원복', '유치원복/어린이집복', '어린이집/유치원 복장', '학교복 또는 기관복',
  '교복/단체복', '체육복', '태권도복', '명찰', '명찰(이름표)', '행사 참가 명찰(ID카드)',
  '로고/엠블럼', '배지/엠블럼', '버튼 엠블럼', '스쿨 엠블럼',
];

// 같은 측정에서 나왔지만 기관을 좁혀주지 않는 종류들
const 소속이_아닌_종류 = [
  '일반 사복', '옷 - 일반 사복', '폴로셔츠', '파란색 점퍼/외투', '파란색 외투', '옷',
  '가방', '백팩', '학원/기관 가방', '보조가방/학용품', '학용품/교재', '책가방',
  '무늬 있는 양말', '머리핀', '장난감',
];

// [1]에 대한 회귀 — 실제로 오탐을 만든 (종류, 근거) 쌍이다.
// 종류만 보면 소속이 아니고, 근거를 보면 부정문에 걸린다.
const 부정문_함정 = [
  { 종류: '옷', 근거: '노란색 재킷, 파란색 데님 원피스 - 일반 사복으로 보임, 특정 기관의 교복·원복 특징 없음' },
  { 종류: '파란색 외투', 근거: '아동이 착용한 파란색 재킷으로, 일반 사복으로 판단되며 특정 기관 식별 불가' },
  { 종류: '일반 사복', 근거: '교복이나 원복으로 보이지 않음' },
  { 종류: '신발', 근거: '학교 로고 없음' },
];

let pass = 0;
let fail = 0;

function check(label, ok, detail) {
  if (ok) {
    pass++;
    console.log('  PASS  ' + label + (detail ? '  (' + detail + ')' : ''));
  } else {
    fail++;
    console.log('  FAIL  ' + label + (detail ? '  (' + detail + ')' : ''));
  }
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 140)));
  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.__anshimTest && window.__anshimTest.isBelongClue));

  const judge = (clues) => page.evaluate(
    (cs) => cs.map((c) => window.__anshimTest.isBelongClue(c)), clues);
  const weigh = (clues) => page.evaluate(
    (cs) => cs.map((c) => window.__anshimTest.belongClueWeight(c)), clues);

  console.log('\n소속 단서로 봐야 하는 종류');
  const a = await judge(소속으로_봐야_하는_종류.map((t) => ({ 종류: t, 근거: '' })));
  const 놓친종류 = 소속으로_봐야_하는_종류.filter((_, i) => !a[i]);
  check('관찰된 종류 ' + 소속으로_봐야_하는_종류.length + '개를 모두 잡는다',
    놓친종류.length === 0, 놓친종류.length ? '놓친 것: ' + 놓친종류.join(', ') : '전부');

  console.log('\n소속 단서가 아닌 종류 — 가방·사복은 기관을 안 알려준다');
  const b = await judge(소속이_아닌_종류.map((t) => ({ 종류: t, 근거: '' })));
  const 헛잡은종류 = 소속이_아닌_종류.filter((_, i) => b[i]);
  check('기관과 무관한 종류 ' + 소속이_아닌_종류.length + '개를 안 잡는다',
    헛잡은종류.length === 0, 헛잡은종류.length ? '헛잡음: ' + 헛잡은종류.join(', ') : '전부');

  console.log('\n부정문 함정 — "교복이 아니다"를 교복으로 읽으면 안 된다');
  const c = await judge(부정문_함정);
  const 걸린것 = 부정문_함정.filter((_, i) => c[i]).map((x) => x.종류);
  check('근거의 부정문에 걸리지 않는다', 걸린것.length === 0,
    걸린것.length ? '걸림: ' + 걸린것.join(', ') : '4개 전부 통과');

  console.log('\n판독 여부 — 못 읽은 명찰은 낮게, 그러나 0은 아니게');
  const w = await weigh([
    { 종류: '명찰', 판독: '읽힘', 읽은글자: '행복유치원 김하늘' },
    { 종류: '명찰', 판독: '안읽힘', 읽은글자: '' },
    { 종류: '로고/엠블럼', 판독: '안읽힘' },
    { 종류: '명찰' },                       // 판독 값이 없는 예전 응답
    { 종류: '원복', 판독: '안읽힘' },        // 옷 자체는 판독을 안 따진다
    { 종류: '가방', 판독: '읽힘' },          // 소속 단서가 아니다
  ]);
  check('읽히는 명찰은 12점', w[0] === 12, String(w[0]));
  check('못 읽은 명찰은 12점보다 낮다', w[1] < 12, String(w[1]) + '점');
  check('못 읽은 명찰도 0점은 아니다 (원본에서는 읽힐 수 있다)', w[1] > 0, String(w[1]) + '점');
  check('못 읽은 로고도 낮춘다', w[2] < 12 && w[2] > 0, String(w[2]) + '점');
  check('판독 값이 없으면 읽히는 것으로 본다 (놓치는 쪽이 더 나쁘다)', w[3] === 12, String(w[3]));
  check('옷 자체는 판독과 무관하게 12점', w[4] === 12, String(w[4]));
  check('소속 단서가 아니면 0점', w[5] === 0, String(w[5]));

  console.log('\n판정이 한 곳인가');
  const drift = await page.evaluate(() => {
    const src = document.documentElement.innerHTML;
    // 종류+근거를 이어붙여 검사하던 옛 방식이 되살아나면 여기서 걸린다
    const joined = (src.match(/String\(c\.종류 \|\| ''\) \+ String\(c\.근거 \|\| ''\)/g) || []).length;
    const narrow = (src.match(/\/교복\|원복\|명찰\|로고\|엠블럼\|기관\//g) || []).length;
    return { joined, narrow };
  });
  check('근거를 이어붙여 검사하지 않는다', drift.joined === 0, drift.joined + '군데');
  check('좁은 목록이 되살아나지 않았다', drift.narrow === 0, drift.narrow + '군데');

  check('콘솔 에러가 없다', errs.length === 0, errs.join(' | '));

  console.log('\n결과: ' + pass + '/' + (pass + fail) + ' 통과');
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})();
