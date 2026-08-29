// 아이섀도우 — 장소 글자 판정(isPlaceWord) 테스트
//
// 사용법: 이 폴더(test)에서 → node place-words.js
//   프론트가 http://localhost:8000 에서 돌고 있어야 합니다. AI 호출 없음 (비용 0).
//
// 왜 필요한가: 사진 103장 정확도 측정에서 놓친 13장 중 6장의 원인이 이 판정이었다.
// Claude는 글자를 제대로 읽었는데 우리 필터가 그 유형을 몰랐다 —
//     "푸른곡 가족 공원"[표지판]  "햇살마을 아파트"[아파트명]  "34가 1862"[차량번호판]
// 점수 매기는 쪽과 위험 요소 지도가 각자 좁은 목록(/상호명|간판|주소|지번|전화번호/)을
// 갖고 있었고, 넓은 목록은 "이렇게 좁혀집니다" 사슬에만 있었다. 같은 판정이 세 곳에
// 따로 적혀 있다가 한쪽만 자란 것이다.
//
// 이 테스트가 지키는 것:
//   ① 실제로 관찰된 유형을 전부 장소로 본다 — 사진이 아니라 유형 문자열로 검사한다.
//      (정답표 세트로 튜닝하지 않기 위해서다. 유형 어휘는 Claude 출력의 성질이지
//       그 사진들의 성질이 아니므로, 문자열로 고정하는 것이 옳다.)
//   ② 장소와 무관한 유형은 장소로 보지 않는다 — 오탐이 이미 높아서 여기서 더 늘리면 안 된다.
//   ③ 세 곳이 같은 판정을 쓴다 — 다시 갈라지면 여기서 걸린다.

const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';

// 사진 103장 측정에서 Claude가 실제로 돌려준 유형들 (2026-08-29)
const 장소로_봐야_하는_유형 = [
  '상호명', '간판', '표지판', '간판/표지판', '차량번호판', '번호판',
  '아파트명', '건물명', '건물/단지명', '시설안내', '기관명', '학교명',
  '주소', '지번', '전화번호', '호수', '동호수', '현수막', '배너',
];

// 같은 측정에서 나왔지만 장소를 특정하지 않는 유형들
const 장소가_아닌_유형 = [
  '포스터', '책/자료', '악보', '운영시간', '생활정보', '상품명', '메뉴',
];

// 유형을 못 받았을 때는 글자 내용으로 판단한다
const 글자로_잡아야_하는_것 = [
  '햇살어린이집', '푸른숲 유치원', '래미안아파트', '101동', '302호',
  '02-1234-5678', '테헤란로 12', '수성구',
];
const 글자로_잡으면_안_되는_것 = ['안녕하세요', '생일축하해', '오늘도 화이팅', 'hello'];

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
  await page.waitForFunction(() => !!(window.__anshimTest && window.__anshimTest.isPlaceWord));

  const judge = (words) => page.evaluate(
    (ws) => ws.map((w) => !!window.__anshimTest.isPlaceWord(w)), words);

  console.log('\n실제로 관찰된 유형 — 장소로 봐야 한다');
  const a = await judge(장소로_봐야_하는_유형.map((t) => ({ type: t, text: '' })));
  const 놓친유형 = 장소로_봐야_하는_유형.filter((_, i) => !a[i]);
  check('관찰된 유형 ' + 장소로_봐야_하는_유형.length + '개를 모두 잡는다',
    놓친유형.length === 0, 놓친유형.length ? '놓친 것: ' + 놓친유형.join(', ') : '전부');

  console.log('\n장소가 아닌 유형 — 잡으면 안 된다');
  const b = await judge(장소가_아닌_유형.map((t) => ({ type: t, text: '' })));
  const 헛잡은유형 = 장소가_아닌_유형.filter((_, i) => b[i]);
  check('장소가 아닌 유형 ' + 장소가_아닌_유형.length + '개를 안 잡는다',
    헛잡은유형.length === 0, 헛잡은유형.length ? '헛잡음: ' + 헛잡은유형.join(', ') : '전부');

  console.log('\n유형이 없을 때 — 글자 내용으로');
  const c = await judge(글자로_잡아야_하는_것.map((t) => ({ type: '', text: t })));
  const 놓친글자 = 글자로_잡아야_하는_것.filter((_, i) => !c[i]);
  check('장소를 가리키는 글자를 잡는다', 놓친글자.length === 0,
    놓친글자.length ? '놓친 것: ' + 놓친글자.join(', ') : '전부');

  const d = await judge(글자로_잡으면_안_되는_것.map((t) => ({ type: '', text: t })));
  const 헛잡은글자 = 글자로_잡으면_안_되는_것.filter((_, i) => d[i]);
  check('평범한 인사말은 안 잡는다', 헛잡은글자.length === 0,
    헛잡은글자.length ? '헛잡음: ' + 헛잡은글자.join(', ') : '전부');

  console.log('\n판정이 한 곳인가');
  const drift = await page.evaluate(() => {
    // 세 곳이 같은 판정을 쓰는지 — 좁은 목록이 되살아나면 여기서 걸린다
    const src = document.documentElement.innerHTML;
    const narrow = (src.match(/\/상호명\|간판\|주소\|지번\|전화번호\//g) || []).length;
    return { narrow };
  });
  check('좁은 목록이 코드에 되살아나지 않았다', drift.narrow === 0,
    drift.narrow + '군데');

  check('콘솔 에러가 없다', errs.length === 0, errs.join(' | '));

  console.log('\n결과: ' + pass + '/' + (pass + fail) + ' 통과');
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})();
