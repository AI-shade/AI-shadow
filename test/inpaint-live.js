// 안심앨범 — AI 인페인팅 실호출 검증 (클라이언트 → 서버 → fal → 복원 전 경로)
//
// ⚠️ 이 테스트는 실제로 fal.ai를 호출합니다 — 1회당 약 $0.03, 30초 정도 걸립니다.
//    다른 테스트들(preview-layout / text-routing / crop-ratio / inpaint-mask / inpaint)은
//    전부 무료이므로 평소에는 그것들만 돌리세요. 이 파일은 인페인팅 관련 코드를
//    고쳤을 때만 확인용으로 돌립니다.
//
// 사용법:
//   1) 프론트: python -m http.server 8000  (프로젝트 루트)
//   2) 백엔드: cd server && npm start      (.env에 FAL_KEY 필요)
//   3) 이 폴더에서: node inpaint-live.js
//
// 왜 좌표를 손으로 넣는가: 이 사진에서 Tesseract는 큰 간판만 찾고 전화번호·지번은
// 놓칩니다(README 12번의 기존 OCR 한계). 그래서 UI로 돌리면 인페인팅 경로가 아예
// 실행되지 않아, 좌표를 직접 넣어 경로만 검증합니다.

const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';

// 꽃집간판.jpg(960x540)에서 눈으로 확인한 작은 텍스트 3곳
const WORDS = [
  { text: '010-4956-6091', type: '전화번호', xPct: 72.9, yPct: 48.9, wPct: 20.8, hPct: 6.7 },
  { text: '1118-1', type: '주소', xPct: 22.4, yPct: 58.1, wPct: 9.4, hPct: 5.9 },
  { text: '1118-1', type: '주소', xPct: 67.8, yPct: 93.0, wPct: 6.5, hPct: 4.4 },
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

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });

  console.log('실제 fal 호출 중 — 30초 정도 걸립니다 (약 $0.03)...\n');

  const out = await page.evaluate(async (words) => {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = '/' + encodeURIComponent('꽃집간판.jpg');
    });

    const split = window.__anshimTest.classifyTextRegions(words, img.naturalWidth, img.naturalHeight);

    const before = document.createElement('canvas');
    before.width = img.naturalWidth;
    before.height = img.naturalHeight;
    before.getContext('2d').drawImage(img, 0, 0);

    const r = await window.__anshimTest.runInpaintRegions(img, split.inpaint, [], {
      grade: '높음',
      locationEvidence: '간판 전화번호·지번',
    });

    const sample = (cv, x, y) => {
      const d = cv.getContext('2d').getImageData(x, y, 1, 1).data;
      return [d[0], d[1], d[2]];
    };
    const changedAt = (x, y) => {
      const a = sample(before, x, y);
      const c = sample(r.canvas, x, y);
      return Math.round(Math.sqrt((a[0]-c[0])**2 + (a[1]-c[1])**2 + (a[2]-c[2])**2));
    };

    return {
      routedToInpaint: split.inpaint.length,
      routedToSignboard: split.signboard.length,
      srcSize: img.naturalWidth + 'x' + img.naturalHeight,
      outSize: r.canvas.width + 'x' + r.canvas.height,
      falSize: r.data.width + 'x' + r.data.height,
      cost: r.data.estimatedCostUsd,
      seconds: Math.round(r.data.timingMs / 1000),
      changed: {
        전화번호: changedAt(700, 264),
        주소코드: changedAt(215, 314),
        유리문코드: changedAt(651, 502),
      },
      unchanged: {
        간판글씨: changedAt(480, 200),
        빈벽: changedAt(60, 460),
      },
    };
  }, WORDS);

  console.log('분기 결과');
  check('작은 텍스트 3곳이 인페인팅으로 감', out.routedToInpaint === 3, out.routedToInpaint + '곳');
  check('간판으로 분류된 것 없음', out.routedToSignboard === 0);

  console.log('\n크기 가드 (fal은 32의 배수로 내림한다)');
  check('fal에는 32의 배수로 보내짐', out.falSize === '960x544', out.falSize);
  check('결과가 원본 크기로 복원됨', out.outSize === out.srcSize, out.srcSize + ' → ' + out.outSize);

  console.log('\n마스크가 정확히 그 영역만 건드렸는가');
  check('전화번호 자리가 바뀜', out.changed.전화번호 > 40, '변화량 ' + out.changed.전화번호);
  check('주소코드 자리가 바뀜', out.changed.주소코드 > 40, '변화량 ' + out.changed.주소코드);
  check('간판 글씨는 그대로', out.unchanged.간판글씨 < 20, '변화량 ' + out.unchanged.간판글씨);
  check('빈 벽은 그대로', out.unchanged.빈벽 < 20, '변화량 ' + out.unchanged.빈벽);

  console.log('\n비용: $' + out.cost + ' / ' + out.seconds + '초');

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
