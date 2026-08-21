// 안심앨범 — 옷 교체 마스크(computeClothingRegion / buildClothingMask) 테스트
//
// 사용법: 이 폴더(test)에서 → node outfit-mask.js
//   프론트가 http://localhost:8000 에서 돌고 있어야 합니다. AI 호출 없음 (비용 0).
//
// 왜 필요한가: 교복·원복은 아이가 다니는 기관을 특정한다. 텍스트가 아니라서 지울 수도,
// 잘라낼 수도 없다(자르면 아이가 잘린다). 그래서 옷만 일반적인 옷으로 바꿔 사진과 기관을
// 잇는 고리를 끊는다.
//
// 간판에서 가짜 글씨가 문제였던 이유는 실재하는 다른 가게 이름이 우연히 생길 수 있어서다.
// 옷은 다르다 — 교복처럼 생긴 일반 옷은 어느 기관도 지목하지 않는다. 이 구분이 근거다.
//
// 이 테스트의 핵심: **얼굴이 마스크에 절대 들어가면 안 된다.** 얼굴이 흰색이면 AI가
// 아이 얼굴을 다시 그린다 — 이 앱에서 가장 위험한 실패다.

const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';

// childphoto.jpeg(540x832)에서 실제로 검출되는 얼굴과 비슷한 값
const IMG = { w: 540, h: 832 };
const FACE = { x: 175, y: 100, width: 125, height: 135 };

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

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });

  const api = await page.evaluate(() => ({
    region: !!(window.__anshimTest && window.__anshimTest.computeClothingRegion),
    mask: !!(window.__anshimTest && window.__anshimTest.buildClothingMask),
  }));
  if (!api.region || !api.mask) {
    console.log('  FAIL  computeClothingRegion / buildClothingMask 가 없습니다 (' + JSON.stringify(api) + ')');
    await browser.close();
    process.exitCode = 1;
    return;
  }

  const region = await page.evaluate(
    ({ FACE, IMG }) => window.__anshimTest.computeClothingRegion(FACE, IMG.w, IMG.h),
    { FACE, IMG }
  );

  console.log('\n옷 영역 위치');
  check('얼굴보다 아래에서 시작', region.y0 > FACE.y + FACE.height,
    'y0 ' + Math.round(region.y0) + ' > 턱 ' + (FACE.y + FACE.height));
  check('얼굴 중심을 기준으로 좌우 대칭',
    Math.abs((region.x0 + region.x1) / 2 - (FACE.x + FACE.width / 2)) < 2,
    '중심 ' + Math.round((region.x0 + region.x1) / 2));
  check('이미지 안에 들어옴',
    region.x0 >= 0 && region.y0 >= 0 && region.x1 <= IMG.w && region.y1 <= IMG.h,
    [region.x0, region.y0, region.x1, region.y1].map(Math.round).join(','));
  check('팔·손이 있을 바깥쪽은 남겨둠 (얼굴 폭의 2.2배 이내)',
    (region.x1 - region.x0) <= FACE.width * 2.2,
    '폭 ' + Math.round(region.x1 - region.x0) + ' vs 얼굴 폭 ' + FACE.width);

  console.log('\n마스크 — 흰색은 새로 그릴 영역, 검은색은 보존');
  const m = await page.evaluate(({ FACE, IMG }) => {
    const c = window.__anshimTest.buildClothingMask([FACE], IMG.w, IMG.h);
    const x = c.getContext('2d');
    const at = (px, py) => (x.getImageData(Math.round(px), Math.round(py), 1, 1).data[0] > 200 ? 'white' : 'black');
    const r = window.__anshimTest.computeClothingRegion(FACE, IMG.w, IMG.h);
    return {
      size: c.width + 'x' + c.height,
      얼굴중심: at(FACE.x + FACE.width / 2, FACE.y + FACE.height / 2),
      이마: at(FACE.x + FACE.width / 2, FACE.y + 8),
      턱바로아래: at(FACE.x + FACE.width / 2, FACE.y + FACE.height + 4),
      옷중심: at((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2),
      // 목 보호 여백이 옷 영역 위쪽과 일부러 겹친다 — 옷깃 바로 아래(가슴)부터 흰색이어야 함
      가슴: at((r.x0 + r.x1) / 2, FACE.y + FACE.height * 1.7),
      바깥배경: at(10, IMG.h - 10),
      영역바로바깥_왼쪽: at(Math.max(0, r.x0 - 10), (r.y0 + r.y1) / 2),
    };
  }, { FACE, IMG });

  check('마스크 크기가 사진과 같음', m.size === IMG.w + 'x' + IMG.h, m.size);
  check('얼굴 중심은 검은색 — AI가 못 건드림', m.얼굴중심 === 'black');
  check('이마도 검은색', m.이마 === 'black');
  check('턱 바로 아래(목)도 검은색', m.턱바로아래 === 'black');
  check('옷 중심은 흰색 — 바뀔 영역', m.옷중심 === 'white');
  check('가슴 높이는 흰색 (목 보호 여백 아래부터 바뀜)', m.가슴 === 'white');
  check('사진 구석 배경은 검은색', m.바깥배경 === 'black');
  check('옷 영역 바로 바깥(팔 자리)은 검은색', m.영역바로바깥_왼쪽 === 'black');

  console.log('\n경계 조건');
  const edge = await page.evaluate(({ IMG }) => {
    const noFace = window.__anshimTest.buildClothingMask([], IMG.w, IMG.h);
    const nx = noFace.getContext('2d');
    let white = 0;
    for (let px = 0; px < IMG.w; px += 20) for (let py = 0; py < IMG.h; py += 20) {
      if (nx.getImageData(px, py, 1, 1).data[0] > 200) white++;
    }
    // 얼굴이 사진 아래쪽에 있어 옷이 들어갈 자리가 거의 없는 경우
    const low = window.__anshimTest.computeClothingRegion({ x: 200, y: 700, width: 100, height: 110 }, IMG.w, IMG.h);
    return { 얼굴없을때_흰픽셀: white, 낮은얼굴: low };
  }, { IMG });
  check('얼굴을 못 찾으면 마스크가 전부 검은색', edge.얼굴없을때_흰픽셀 === 0, edge.얼굴없을때_흰픽셀 + '개');
  check('얼굴이 사진 아래쪽이어도 이미지를 벗어나지 않음',
    edge.낮은얼굴.y1 <= IMG.h && edge.낮은얼굴.y0 >= 0,
    'y ' + Math.round(edge.낮은얼굴.y0) + '~' + Math.round(edge.낮은얼굴.y1));

  if (errors.length) {
    console.log('\n  페이지 에러: ' + errors.join(' | '));
    fail++;
  }

  await browser.close();
  console.log('\n결과: ' + pass + '/' + (pass + fail) + ' 통과');
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
