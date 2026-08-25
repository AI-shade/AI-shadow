// 아이섀도우 — 인페인팅 마스크 생성 + 크기 가드 테스트
//
// 사용법: 이 폴더(test)에서 → node inpaint-mask.js
//   프론트가 http://localhost:8000 에서 돌고 있어야 합니다. AI 호출 없음 (비용 0).
//
// 검증하는 두 가지:
//
// 1) 마스크 규약 — 흰색 = 새로 그릴 영역, 검은색 = 보존.
//    (fal 문서에 없어서 2026-08-21에 실제 호출로 확인함)
//    아이 보존영역은 반드시 검은색이어야 한다. 여기가 흰색이면 AI가 아이 얼굴을
//    다시 그려버린다 — 이 앱에서 가장 위험한 실패다.
//
// 2) 크기 가드 — fal FLUX Fill은 가로·세로를 32의 배수로 내림한다.
//    960x540을 보내면 960x512가 돌아와서 비율이 깨진다(실측). 그래서 보내기 전에
//    32의 배수로 올려서 보내고, 받은 뒤 원본 크기로 되돌린다.

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

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE_URL + '/index.html', { waitUntil: 'domcontentloaded' });

  const api = await page.evaluate(() => ({
    mask: !!(window.__anshimTest && window.__anshimTest.buildInpaintMask),
    round: !!(window.__anshimTest && window.__anshimTest.roundUpTo32),
  }));
  if (!api.mask || !api.round) {
    console.log('  FAIL  buildInpaintMask / roundUpTo32 가 없습니다 (' + JSON.stringify(api) + ')');
    await browser.close();
    process.exitCode = 1;
    return;
  }

  console.log('\n크기 가드 (32의 배수로 올림)');
  const rounds = await page.evaluate(() =>
    [540, 960, 512, 1, 32, 33, 4032, 3024].map((n) => window.__anshimTest.roundUpTo32(n))
  );
  check('540 → 544', rounds[0], 544);
  check('960은 이미 32의 배수라 그대로', rounds[1], 960);
  check('512 그대로', rounds[2], 512);
  check('1 → 32 (0이 되면 안 됨)', rounds[3], 32);
  check('32 그대로', rounds[4], 32);
  check('33 → 64', rounds[5], 64);
  check('4032 그대로', rounds[6], 4032);
  check('3024 → 3040', rounds[7], 3040);

  console.log('\n마스크 생성');
  // 960x540 이미지, 지울 텍스트 2곳, 아이 보존영역 1곳
  const m = await page.evaluate(() => {
    const words = [
      { text: '010-1234-5678', xPct: 73, yPct: 49, wPct: 21, hPct: 6.7 },
      { text: '1118-1', xPct: 22, yPct: 58, wPct: 9, hPct: 5.9 },
    ];
    const subject = [{ x0: 380, y0: 150, x1: 620, y1: 500 }]; // 화면 가운데 아이
    const c = window.__anshimTest.buildInpaintMask(words, 960, 540, subject);
    const x = c.getContext('2d');
    const at = (px, py) => {
      const d = x.getImageData(px, py, 1, 1).data;
      return d[0] > 200 ? 'white' : (d[0] < 55 ? 'black' : 'gray');
    };
    return {
      size: c.width + 'x' + c.height,
      전화번호_중심: at(Math.round(0.73 * 960), Math.round(0.49 * 540)),
      주소코드_중심: at(Math.round(0.22 * 960), Math.round(0.58 * 540)),
      아이_얼굴: at(500, 250),
      빈_배경: at(20, 20),
      아이_영역_경계밖: at(370, 250),
    };
  });

  check('마스크 크기가 이미지와 같음', m.size, '960x540');
  check('지울 텍스트 자리는 흰색', m.전화번호_중심, 'white');
  check('두 번째 텍스트 자리도 흰색', m.주소코드_중심, 'white');
  check('아이 얼굴은 검은색 (AI가 못 건드림)', m.아이_얼굴, 'black');
  check('아무것도 없는 배경은 검은색', m.빈_배경, 'black');
  check('아이 영역 바로 바깥은 검은색', m.아이_영역_경계밖, 'black');

  console.log('\n아이 영역과 텍스트가 겹칠 때 (가장 위험한 경우)');
  const overlap = await page.evaluate(() => {
    // 텍스트가 아이 얼굴 위에 겹쳐 있는 상황
    const words = [{ text: '겹침', xPct: 50, yPct: 50, wPct: 30, hPct: 30 }];
    const subject = [{ x0: 380, y0: 150, x1: 620, y1: 400 }];
    const c = window.__anshimTest.buildInpaintMask(words, 960, 540, subject);
    const x = c.getContext('2d');
    const at = (px, py) => (x.getImageData(px, py, 1, 1).data[0] > 200 ? 'white' : 'black');
    return { 겹친_부분: at(500, 270), 안겹친_텍스트부분: at(360, 270) };
  });
  check('겹친 부분은 아이 보호가 이김 (검은색)', overlap.겹친_부분, 'black');
  check('아이 밖의 텍스트 부분은 흰색', overlap.안겹친_텍스트부분, 'white');

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
