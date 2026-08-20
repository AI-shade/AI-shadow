// 안심앨범 — 2단계 보정 미리보기 레이아웃 회귀 테스트
//
// 사용법:
//   1) 프로젝트 루트에서 정적 서버 실행: python -m http.server 8000
//   2) 이 폴더(test)에서: npm install (최초 1회) → node preview-layout.js
//
// regression.js와 달리 이 테스트는 Claude API를 전혀 호출하지 않습니다 (비용 없음).
// 순수하게 CSS 레이아웃만 검사하므로 빠르고 결정적입니다.
//
// 왜 필요한가: 미리보기 프레임이 mockup 시절 `aspect-ratio: 4/3` + `object-fit: cover`로
// 고정돼 있어서, 세로로 긴 사진(휴대폰 사진 대부분)이 확대되고 위아래가 잘린 채 표시됐음.
// 사용자가 "내가 다운로드할 사진"을 미리보기에서 그대로 확인할 수 없었던 문제.
//
// 불변조건: 미리보기에 표시되는 <img>의 화면상 비율 == 실제 이미지의 원본 비율
//          (= 잘려나가는 부분도, 늘어나는 왜곡도 없음)

const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';
const TOLERANCE = 0.02; // 비율 오차 허용치 (반올림/서브픽셀 대응)

const SIZES = [
  { label: '세로 사진 3:4 (휴대폰 기본)', w: 900, h: 1200 },
  { label: '가로 사진 4:3', w: 1200, h: 900 },
  { label: '정사각 크롭 결과 1:1', w: 800, h: 800 },
  { label: '가로로 긴 크롭 결과 16:9', w: 1600, h: 900 },
  { label: '세로로 매우 긴 사진 9:16', w: 900, h: 1600 },
];

async function measure(page, size) {
  return page.evaluate(async ({ w, h }) => {
    const screen = document.getElementById('screen-correct');
    const prevDisplay = screen.style.display;
    screen.style.display = 'block';

    const img = document.getElementById('previewAfter');
    const frame = document.getElementById('previewFrame');

    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const cx = c.getContext('2d');
    cx.fillStyle = '#888';
    cx.fillRect(0, 0, w, h);

    await new Promise((res) => {
      img.onload = res;
      img.src = c.toDataURL('image/png');
    });

    const ib = img.getBoundingClientRect();
    const fb = frame.getBoundingClientRect();
    const result = {
      naturalRatio: img.naturalWidth / img.naturalHeight,
      boxRatio: ib.width / ib.height,
      boxW: Math.round(ib.width),
      boxH: Math.round(ib.height),
      frameW: Math.round(fb.width),
      frameH: Math.round(fb.height),
      // 프레임 밖으로 삐져나가면 overflow:hidden에 잘림
      overflowsFrame: ib.width > fb.width + 1 || ib.height > fb.height + 1,
    };

    img.removeAttribute('src');
    screen.style.display = prevDisplay;
    return result;
  }, size);
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(BASE_URL + '/index.html', { waitUntil: 'domcontentloaded' });

  let pass = 0;
  let fail = 0;

  for (const size of SIZES) {
    const m = await measure(page, size);
    const drift = Math.abs(m.boxRatio - m.naturalRatio) / m.naturalRatio;
    const ok = drift <= TOLERANCE && !m.overflowsFrame;

    if (ok) {
      pass++;
      console.log('  PASS  ' + size.label + '  — 표시 ' + m.boxW + 'x' + m.boxH + ' (비율 유지)');
    } else {
      fail++;
      console.log('  FAIL  ' + size.label);
      console.log('        원본 ' + size.w + 'x' + size.h + ' (비율 ' + m.naturalRatio.toFixed(3) + ')');
      console.log('        표시 ' + m.boxW + 'x' + m.boxH + ' (비율 ' + m.boxRatio.toFixed(3) + ')');
      console.log('        비율 오차 ' + (drift * 100).toFixed(1) + '% — 잘리거나 확대되어 보임');
      if (m.overflowsFrame) {
        console.log('        프레임(' + m.frameW + 'x' + m.frameH + ') 밖으로 넘쳐 잘림');
      }
    }
  }

  if (errors.length) {
    console.log('\n  페이지 에러:');
    errors.forEach((e) => console.log('    ' + e));
  }

  await browser.close();

  console.log('\n결과: ' + pass + '/' + (pass + fail) + ' 통과');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
