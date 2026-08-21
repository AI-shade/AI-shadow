// 안심앨범 — 배경 흐림(applyBackgroundBlur) 테스트
//
// 사용법: 이 폴더(test)에서 → node blur.js
//   프론트가 http://localhost:8000 에서 돌고 있어야 합니다. AI 호출 없음 (비용 0).
//
// 왜 필요한가: 선명하게 남길 영역을 방사형 그라데이션으로 그리면서 중심을
// "피사체 영역의 한가운데"로 잡고 있었다. 그런데 그 영역은 얼굴 높이의 7배라
// 중심이 허리쯤에 온다. 정작 얼굴은 위쪽 가장자리라 흐림 구간에 걸려서
// **아이 얼굴이 같이 흐려졌다** (실사용 중 발견).
//
// 이 테스트의 핵심: 얼굴은 원본 그대로, 배경만 흐려져야 한다.

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

  const has = await page.evaluate(() => !!(window.__anshimTest && window.__anshimTest.applyBackgroundBlur));
  if (!has) {
    console.log('  FAIL  window.__anshimTest.applyBackgroundBlur 가 없습니다');
    await browser.close();
    process.exitCode = 1;
    return;
  }

  // 합성 사진: 배경은 촘촘한 줄무늬(흐려지면 확 뭉개짐), 인물 자리에는 대비 큰 격자
  // 배경·인물 모두 체커보드로 깔아 가로·세로 어느 방향으로든 선명도를 잴 수 있게 한다.
  // (처음엔 인물 자리에 가로 줄무늬를 깔고 가로 방향 차이를 재서 원본부터 0이 나왔다)
  // 배경 칸을 24px로 크게 잡아야 8px 흐림과 32px 흐림의 차이가 수치로 드러난다.
  const measure = (blurPx) =>
    page.evaluate(async (blurPx) => {
      const W = 400, H = 700;
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const x = c.getContext('2d');
      const checker = (x0, y0, x1, y1, cell, a, b) => {
        for (let yy = y0; yy < y1; yy += cell) {
          for (let xx = x0; xx < x1; xx += cell) {
            x.fillStyle = (((xx / cell) | 0) + ((yy / cell) | 0)) % 2 ? a : b;
            x.fillRect(xx, yy, cell, cell);
          }
        }
      };
      checker(0, 0, W, H, 24, '#1b1b1b', '#ececec');          // 배경
      const face = { x: 160, y: 80, width: 80, height: 90 };
      checker(120, 60, 280, 640, 12, '#c81e4a', '#f7f7f7');   // 인물 자리
      const img = await new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = c.toDataURL(); });

      const out = window.__anshimTest.applyBackgroundBlur(img, [{ box: face }], W, H, blurPx);

      // 이웃 픽셀 차이(가로+세로)의 평균. 흐려지면 이웃끼리 비슷해져 값이 떨어진다.
      const sharpness = (cv, px, py, n) => {
        const d = cv.getContext('2d').getImageData(px, py, n, n).data;
        let s = 0, cnt = 0;
        for (let yy = 0; yy < n; yy++) {
          for (let xx = 0; xx < n - 1; xx++) {
            const i = (yy * n + xx) * 4;
            s += Math.abs(d[i] - d[i + 4]); cnt++;
          }
        }
        for (let yy = 0; yy < n - 1; yy++) {
          for (let xx = 0; xx < n; xx++) {
            const i = (yy * n + xx) * 4;
            s += Math.abs(d[i] - d[i + n * 4]); cnt++;
          }
        }
        return Math.round(s / cnt);
      };
      return {
        얼굴_원본: sharpness(c, face.x + 10, face.y + 20, 40),
        얼굴_결과: sharpness(out, face.x + 10, face.y + 20, 40),
        몸통_원본: sharpness(c, 150, 380, 40),
        몸통_결과: sharpness(out, 150, 380, 40),
        배경_원본: sharpness(c, 20, 350, 40),
        배경_결과: sharpness(out, 20, 350, 40),
        크기: out.width + 'x' + out.height,
      };
    }, blurPx);

  console.log('\n기본 강도(18px)');
  const m = await measure(18);
  const keep = (a, b) => b >= a * 0.8; // 선명도 80% 이상 유지되면 "그대로"로 본다
  check('얼굴이 선명하게 남음', keep(m.얼굴_원본, m.얼굴_결과),
    '원본 ' + m.얼굴_원본 + ' → 결과 ' + m.얼굴_결과);
  check('몸통도 선명하게 남음', keep(m.몸통_원본, m.몸통_결과),
    '원본 ' + m.몸통_원본 + ' → 결과 ' + m.몸통_결과);
  check('배경은 확실히 흐려짐', m.배경_결과 < m.배경_원본 * 0.5,
    '원본 ' + m.배경_원본 + ' → 결과 ' + m.배경_결과);
  check('크기는 원본 그대로', m.크기 === '400x700', m.크기);

  console.log('\n강도 조절이 실제로 반영되는가');
  const weak = await measure(8);
  const strong = await measure(32);
  check('약하게가 강하게보다 덜 흐림', weak.배경_결과 > strong.배경_결과,
    '약 ' + weak.배경_결과 + ' vs 강 ' + strong.배경_결과);
  check('약하게에서도 얼굴은 선명', keep(weak.얼굴_원본, weak.얼굴_결과));
  check('강하게에서도 얼굴은 선명', keep(strong.얼굴_원본, strong.얼굴_결과),
    '원본 ' + strong.얼굴_원본 + ' → 결과 ' + strong.얼굴_결과);

  console.log('\n경계 조건');
  const noFace = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 200; c.height = 200;
    const x = c.getContext('2d');
    x.fillStyle = '#345'; x.fillRect(0, 0, 200, 200);
    const img = await new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = c.toDataURL(); });
    const out = window.__anshimTest.applyBackgroundBlur(img, [], 200, 200, 18);
    return out.width + 'x' + out.height;
  });
  check('얼굴이 없어도 터지지 않음', noFace === '200x200', noFace);

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
