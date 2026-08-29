// 아이섀도우 — 알아볼 수 있는 장소(landmarkPoints) 테스트
//
// 사용법: 이 폴더(test)에서 → node landmarks.js
//   프론트가 http://localhost:8000 에서 돌고 있어야 합니다. AI 호출 없음 (비용 0).
//
// 왜 필요한가: 사진 103장 측정에서 끝까지 남은 놓침 4장 중 하나가
//     사진68 "창밖으로 남산타워와 한강 다리 등 유명 랜드마크가 뚜렷하게 보여
//             거주 위치를 쉽게 특정할 수 있다"
// 였다. 글자가 하나도 없어서, 글자를 읽는 방식으로는 원리적으로 못 잡는다.
//
// 구글 비전의 랜드마크 인식이 이미 있지만 "위치 찾기" 버튼 뒤에만 붙어 있고,
// 그걸 자동 진단에 붙이지 않았다 — 그 경로는 **원본을 보내기** 때문이다.
// 대신 이미 사진을 보고 있는 Claude에게 물었다. 호출도 수신자도 안 늘고 0원이다.
//
// 이 테스트가 지키는 것:
//   ① 이름을 댈 수 있는 곳은 점수를 받는다.
//   ② **이름을 못 대는 것은 0점이다.** "도시 풍경"은 위치를 못 좁힌다.
//      랜드마크는 모델이 이름을 지어내기 가장 쉬운 자리라 여기가 제일 중요하다.
//   ③ 좁히는 범위와 확신이 점수에 반영된다 — 멀리 흐릿하게 보이는 산과
//      바로 앞 건물이 같은 점수면 안 된다.
//   ④ 상한 26을 넘지 않는다.
//
// **사진이 아니라 문자열로 검사한다.** 정답표 세트로 튜닝하지 않기 위해서다.

const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';

let pass = 0;
let fail = 0;

function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label + (detail ? '  (' + detail + ')' : '')); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '  (' + detail + ')' : '')); }
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 140)));
  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.__anshimTest && window.__anshimTest.landmarkPoints));

  const pts = (list) => page.evaluate(
    (ls) => ls.map((l) => window.__anshimTest.landmarkPoints(l)), list);
  const kept = (list) => page.evaluate(
    (ls) => window.__anshimTest.scoredLandmarks(ls).map((l) => l.이름), list);

  console.log('\n이름을 댈 수 있는 곳 — 점수를 받아야 한다');
  const real = [
    { 이름: 'N서울타워', 좁혀지는범위: '구역', 확신: '확실' },
    { 이름: '광안대교', 좁혀지는범위: '구역', 확신: '확실' },
    { 이름: '롯데월드타워', 좁혀지는범위: '건물', 확신: '확실' },
    { 이름: '한라산', 좁혀지는범위: '도시', 확신: '확실' },
    { 이름: '경복궁 근정전', 좁혀지는범위: '건물', 확신: '확실' },
  ];
  const a = await pts(real);
  const 놓친것 = real.filter((_, i) => a[i] === 0).map((l) => l.이름);
  check('이름 있는 장소 ' + real.length + '곳을 모두 센다', 놓친것.length === 0,
    놓친것.length ? '0점: ' + 놓친것.join(', ') : a.join(' / ') + '점');

  console.log('\n이름을 못 대는 것 — 0점이어야 한다 (지어낸 이름이 가장 위험하다)');
  const vague = [
    { 이름: '도시 풍경', 좁혀지는범위: '구역', 확신: '확실' },
    { 이름: '아파트 단지', 좁혀지는범위: '건물', 확신: '확실' },
    { 이름: '바닷가', 좁혀지는범위: '구역', 확신: '확실' },
    { 이름: '도심 전경', 좁혀지는범위: '도시', 확신: '확실' },
    { 이름: '주택가', 좁혀지는범위: '구역', 확신: '확실' },
    { 이름: '', 좁혀지는범위: '건물', 확신: '확실' },
    { 좁혀지는범위: '건물', 확신: '확실' },
    // 아래 다섯은 사진 103장에서 **실제로 올라온** 것이다.
    // "특정 불가"는 여기가 어딘지 모르겠다는 뜻인데 위치 노출로 세고 있었다.
    { 이름: '특정 불가', 좁혀지는범위: '불명확', 확신: '미확인' },
    { 이름: '확인 불가', 좁혀지는범위: '도시', 확신: '낮음' },
    { 이름: '벚꽃 수로원길 또는 유사 공원 경로', 좁혀지는범위: '도시', 확신: '추정' },
    { 이름: '한옥마을 또는 전통사찰 건축물', 좁혀지는범위: '도시', 확신: '추정' },
    { 이름: '어린이집/유치원', 좁혀지는범위: '기관 유형', 확신: '확실' },
  ];
  const b = await pts(vague);
  const 샌것 = vague.filter((_, i) => b[i] > 0).map((l) => l.이름 || '(이름 없음)');
  check('두루뭉술한 것 ' + vague.length + '개를 안 센다', 샌것.length === 0,
    샌것.length ? '점수 받음: ' + 샌것.join(', ') : '전부 0점');

  console.log('\n얼마나 좁히는가가 점수에 반영된다');
  const scope = await pts([
    { 이름: '가상타워', 좁혀지는범위: '건물', 확신: '확실' },
    { 이름: '가상타워', 좁혀지는범위: '구역', 확신: '확실' },
    { 이름: '가상타워', 좁혀지는범위: '도시', 확신: '확실' },
    { 이름: '가상타워', 확신: '확실' },              // 범위를 안 적어준 경우
  ]);
  check('건물 > 구역 > 도시 순으로 높다', scope[0] > scope[1] && scope[1] > scope[2],
    scope.slice(0, 3).join(' > '));
  check('범위를 안 적어주면 중간값을 준다', scope[3] > scope[2] && scope[3] < scope[0],
    scope[3] + '점');

  const conf = await pts([
    { 이름: '가상타워', 좁혀지는범위: '구역', 확신: '확실' },
    { 이름: '가상타워', 좁혀지는범위: '구역', 확신: '추정' },
  ]);
  check('추정은 확실의 절반이다', conf[1] < conf[0] && conf[1] > 0,
    conf[0] + ' → ' + conf[1] + '점');

  console.log('\n걸러낸 목록');
  const names = await kept([
    { 이름: 'N서울타워', 좁혀지는범위: '구역', 확신: '확실' },
    { 이름: '도시 풍경', 좁혀지는범위: '구역', 확신: '확실' },
    { 이름: '광안대교', 좁혀지는범위: '구역', 확신: '추정' },
  ]);
  check('점수 받는 것만 남긴다', names.length === 2 && names.indexOf('도시 풍경') < 0,
    names.join(', '));

  console.log('\n상한을 넘지 않는다');
  const cap = await page.evaluate(() => {
    // 간판·주소 항목의 상한은 26이다. 랜드마크를 아무리 많이 넣어도 넘으면 안 된다
    const many = Array.from({ length: 8 }, (_, i) => (
      { 이름: '가상타워' + i, 좁혀지는범위: '건물', 확신: '확실' }));
    const sum = window.__anshimTest.scoredLandmarks(many)
      .reduce((s, l) => s + window.__anshimTest.landmarkPoints(l), 0);
    return { sum, capped: Math.min(26, sum) };
  });
  check('합이 커도 26으로 잘린다', cap.capped === 26 && cap.sum > 26,
    '원점수 ' + cap.sum + ' → ' + cap.capped);

  check('콘솔 에러가 없다', errs.length === 0, errs.join(' | '));

  console.log('\n결과: ' + pass + '/' + (pass + fail) + ' 통과');
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})();
