// 안심앨범 — 크롭 비율 유지(fitCropBoxToRatio) 테스트
//
// 사용법: 이 폴더(test)에서 → node crop-ratio.js
//   프론트가 http://localhost:8000 에서 돌고 있어야 합니다. AI 호출 없음 (비용 0).
//
// 요구사항: "처리 후에도 사진 비율은 원본과 같아야 한다."
// 크롭은 가장자리를 잘라내므로 그냥 두면 비율이 바뀐다. 비율을 맞추려면 크롭 박스를
// 원본 비율에 맞게 **축소**하는 수밖에 없다 — 확대하면 잘라냈던 위험 텍스트가 다시
// 들어와서 크롭의 목적이 사라지기 때문.
//
// 단, 아이 보존영역(safe)은 절대 잘라내면 안 되므로, 축소 결과가 보존영역을 침범하면
// 비율 맞추기를 포기하고 원래 박스를 그대로 돌려준다(ok:false). 비율보다 아이가 우선.

const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';

let pass = 0;
let fail = 0;

function check(label, actual, expected) {
  if (actual === expected) {
    pass++;
    console.log('  PASS  ' + label);
  } else {
    fail++;
    console.log('  FAIL  ' + label);
    console.log('        기대: ' + expected + ' / 실제: ' + actual);
  }
}

function near(label, actual, expected, tol) {
  const ok = Math.abs(actual - expected) <= (tol || 0.01);
  if (ok) {
    pass++;
    console.log('  PASS  ' + label + '  (' + actual.toFixed(3) + ')');
  } else {
    fail++;
    console.log('  FAIL  ' + label);
    console.log('        기대: ' + expected + ' ±' + (tol || 0.01) + ' / 실제: ' + actual);
  }
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE_URL + '/index.html', { waitUntil: 'domcontentloaded' });

  const has = await page.evaluate(() => !!(window.__anshimTest && window.__anshimTest.fitCropBoxToRatio));
  if (!has) {
    console.log('  FAIL  window.__anshimTest.fitCropBoxToRatio 가 없습니다');
    await browser.close();
    process.exitCode = 1;
    return;
  }

  const fit = (box, imgW, imgH, safe) =>
    page.evaluate(
      ({ box, imgW, imgH, safe }) => {
        const r = window.__anshimTest.fitCropBoxToRatio(box, imgW, imgH, safe);
        return {
          ok: r.ok,
          w: r.crop.x1 - r.crop.x0,
          h: r.crop.y1 - r.crop.y0,
          x0: r.crop.x0, y0: r.crop.y0, x1: r.crop.x1, y1: r.crop.y1,
        };
      },
      { box, imgW, imgH, safe }
    );

  // 원본 1200x900 (4:3 = 1.3333)
  const IMG = { w: 1200, h: 900 };
  const targetRatio = IMG.w / IMG.h;

  console.log('\n비율 맞추기');
  // 가로로 너무 넓은 박스 → 폭을 줄여야 함
  let r = await fit({ x0: 100, y0: 250, x1: 1100, y1: 650 }, IMG.w, IMG.h, { x0: 500, y0: 400, x1: 700, y1: 500 });
  near('가로로 넓은 박스가 원본 비율이 됨', r.w / r.h, targetRatio);
  check('높이는 그대로 유지 (폭만 줄임)', r.h, 400);
  check('축소 성공', r.ok, true);

  // 세로로 너무 긴 박스 → 높이를 줄여야 함
  r = await fit({ x0: 400, y0: 50, x1: 800, y1: 850 }, IMG.w, IMG.h, { x0: 550, y0: 400, x1: 650, y1: 500 });
  near('세로로 긴 박스가 원본 비율이 됨', r.w / r.h, targetRatio);
  check('폭은 그대로 유지 (높이만 줄임)', r.w, 400);

  console.log('\n절대 커지지 않아야 함 (잘라낸 위험요소가 되살아나면 안 됨)');
  r = await fit({ x0: 100, y0: 250, x1: 1100, y1: 650 }, IMG.w, IMG.h, { x0: 500, y0: 400, x1: 700, y1: 500 });
  check('폭이 원래보다 커지지 않음', r.w <= 1000, true);
  check('높이가 원래보다 커지지 않음', r.h <= 400, true);
  check('박스가 원래 범위를 벗어나지 않음', r.x0 >= 100 && r.x1 <= 1100 && r.y0 >= 250 && r.y1 <= 650, true);

  console.log('\n아이 보존영역 우선');
  // 보존영역이 왼쪽 끝에 붙어 있으면, 축소된 박스가 그쪽으로 밀려야 함
  r = await fit({ x0: 100, y0: 250, x1: 1100, y1: 650 }, IMG.w, IMG.h, { x0: 120, y0: 300, x1: 320, y1: 600 });
  check('보존영역이 축소 후에도 안에 들어있음', r.x0 <= 120 && r.x1 >= 320, true);
  near('그래도 비율은 유지', r.w / r.h, targetRatio);

  // 보존영역이 너무 커서 비율을 맞출 수 없는 경우 → 포기하고 원본 박스 유지
  r = await fit({ x0: 0, y0: 0, x1: 1200, y1: 400 }, IMG.w, IMG.h, { x0: 0, y0: 0, x1: 1200, y1: 400 });
  check('비율 맞추기 불가능하면 ok:false', r.ok, false);
  check('그럴 땐 원본 박스를 그대로 유지', r.w === 1200 && r.h === 400, true);

  console.log('\n이미 비율이 맞는 경우');
  r = await fit({ x0: 0, y0: 0, x1: 600, y1: 450 }, IMG.w, IMG.h, { x0: 200, y0: 200, x1: 300, y1: 300 });
  check('그대로 둠 (폭)', r.w, 600);
  check('그대로 둠 (높이)', r.h, 450);

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
