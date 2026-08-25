// 아이섀도우 — AI 배경 교체 인물 보호(restorePersonFromOriginal) 테스트
//
// 사용법: 이 폴더(test)에서 → node person-guard.js
//   프론트가 http://localhost:8000 에서 돌고 있어야 합니다. AI 호출 없음 (비용 0).
//
// 왜 필요한가: AI 배경 교체(flux-kontext)는 마스크가 없어서 이미지 전체를 다시 그린다.
// 인물 보호를 프롬프트 부탁에만 의존했는데, 실제로 **아이 성별이 바뀌어 돌아왔다**
// (2026-08-21, 여자아이 → 남자아이). 원인은 위치노출 근거에 "원복·명찰"이 들어가면서
// Claude가 "Replace the uniform with plain, generic clothing"이라는 지시를 만들었고,
// 마스크가 없으니 모델이 사람 자체를 새로 그린 것이다.
//
// 프롬프트는 막았지만 부탁은 언제든 실패한다. 결과 위에 원본 인물을 다시 덮어
// 구조적으로 차단한다. 이 테스트가 그 차단을 고정한다.

const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';

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

  const has = await page.evaluate(() => !!(window.__anshimTest && window.__anshimTest.restorePersonFromOriginal));
  if (!has) {
    console.log('  FAIL  window.__anshimTest.restorePersonFromOriginal 이 없습니다');
    await browser.close();
    process.exitCode = 1;
    return;
  }

  // 원본은 파랑, "AI가 전부 새로 그린 결과"는 빨강으로 두고,
  // 인물 영역이 파랑(원본)으로 복원되는지 본다. 극단적인 색 차이라 판정이 명확하다.
  const r = await page.evaluate(async () => {
    const W = 400, H = 700;
    const face = { x: 160, y: 80, width: 80, height: 90 };

    const mk = (color) => {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const x = c.getContext('2d');
      x.fillStyle = color; x.fillRect(0, 0, W, H);
      return c;
    };
    const origCanvas = mk('#1040ff');   // 원본 = 파랑
    const aiCanvas = mk('#ff2010');     // AI 결과 = 빨강 (사람까지 전부 바뀐 상황)
    const origImg = await new Promise((res) => {
      const i = new Image(); i.onload = () => res(i); i.src = origCanvas.toDataURL();
    });

    const out = window.__anshimTest.restorePersonFromOriginal(aiCanvas, origImg, [{ box: face }], W, H);
    const px = (cv, x, y) => Array.from(cv.getContext('2d').getImageData(x, y, 1, 1).data).slice(0, 3);
    const isBlue = (p) => p[2] > 150 && p[0] < 120;
    const isRed = (p) => p[0] > 150 && p[2] < 120;

    return {
      크기: out.width + 'x' + out.height,
      얼굴중심: px(out, face.x + face.width / 2, face.y + face.height / 2),
      몸통: px(out, 200, 380),
      배경_좌상: px(out, 8, 8),
      배경_우하: px(out, W - 8, H - 8),
      얼굴이_원본: isBlue(px(out, face.x + face.width / 2, face.y + face.height / 2)),
      몸통이_원본: isBlue(px(out, 200, 380)),
      배경이_AI결과: isRed(px(out, 8, 8)) && isRed(px(out, W - 8, H - 8)),
    };
  });

  console.log('\n인물은 원본으로 복원되는가');
  check('얼굴이 원본(파랑)으로 돌아옴', r.얼굴이_원본, r.얼굴중심.join(','));
  check('몸통도 원본으로 돌아옴', r.몸통이_원본, r.몸통.join(','));

  console.log('\n배경은 AI 결과가 유지되는가');
  check('배경 네 귀퉁이는 AI 결과(빨강)', r.배경이_AI결과,
    r.배경_좌상.join(',') + ' / ' + r.배경_우하.join(','));
  check('크기는 원본 그대로', r.크기 === '400x700', r.크기);

  console.log('\n경계 조건');
  const edge = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 200; c.height = 200;
    c.getContext('2d').fillRect(0, 0, 200, 200);
    const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = c.toDataURL(); });
    const a = window.__anshimTest.restorePersonFromOriginal(c, img, [], 200, 200);
    const b = window.__anshimTest.restorePersonFromOriginal(c, img, null, 200, 200);
    return a.width + 'x' + a.height + ' / ' + b.width + 'x' + b.height;
  });
  check('얼굴이 없으면 그대로 통과시킴', edge === '200x200 / 200x200', edge);

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
