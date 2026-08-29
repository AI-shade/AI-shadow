// 아이섀도우 — 어느 기기에서 어플 배치가 뜨는가
//
// 사용법: 이 폴더(test)에서 → node device-switch.js
//   프론트가 http://localhost:8000 에서 돌고 있어야 합니다. AI 호출 없음 (비용 0).
//
// 왜 필요한가: 어플 배치가 `max-width: 560px` 하나로만 걸려 있었다. 폭만 보면
// **폰을 가로로 돌리는 순간 데스크톱 배치가 뜬다** — 실측:
//
//     iPhone 15 세로   393 x 852   -> 어플 배치  (맞음)
//     iPhone 15 가로   852 x 393   -> 데스크톱   (틀림, 높이가 393px인데)
//
// 393px 높이에 데스크톱 배치를 그리면 히어로만으로 화면이 다 찬다.
//
// 그래서 판정을 둘로 나눈다:
//   ① 폭이 좁다                        -> 세로로 든 폰
//   ② 손가락으로 쓰는데 화면이 납작하다  -> 가로로 돌린 폰
//
// ②에 `pointer: coarse` + `hover: none`을 같이 쓰는 이유: 둘 중 하나만으로는
// 부족하다. 터치스크린 노트북은 coarse일 수 있고, 일부 스타일러스 기기는
// hover를 흉내낸다. 둘 다여야 "손가락으로만 쓰는 기기"다.
//
// 태블릿은 일부러 데스크톱 배치로 둔다. 744px이면 웹 배치가 편하게 들어가고,
// 설계서가 정한 폰 기준(560px)과도 맞다. 이 테스트가 그 결정을 못박는다 —
// 나중에 조건을 넓히다가 태블릿까지 딸려오면 여기서 걸린다.

const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';

// [이름, 폭, 높이, 손가락으로 쓰는가, 어플 배치여야 하는가]
const CASES = [
  ['iPhone SE 세로',      375,  667,  true,  true],
  ['iPhone 15 세로',      393,  852,  true,  true],
  ['iPhone 15 Max 세로',  430,  932,  true,  true],
  ['Galaxy S24 세로',     360,  800,  true,  true],
  ['iPhone 15 가로',      852,  393,  true,  true],   // <- 이게 안 됐다
  ['Galaxy S24 가로',     800,  360,  true,  true],
  ['iPad mini 세로',      744,  1133, true,  false],  // 태블릿은 웹 배치
  ['iPad mini 가로',      1133, 744,  true,  false],
  ['노트북 좁은 창',       700,  900,  false, false],  // 마우스가 있으면 웹 배치
  ['노트북 아주 좁은 창',  520,  900,  false, true],   // 폭이 폰만 하면 어플 배치
  ['데스크톱',            1280, 900,  false, false],
];

let pass = 0;
let fail = 0;

function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label + (detail ? '  (' + detail + ')' : '')); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '  (' + detail + ')' : '')); }
}

(async () => {
  const browser = await chromium.launch();
  const errs = [];

  console.log('\n기기별로 어느 배치가 뜨는가');
  for (const [name, w, h, touch, wantApp] of CASES) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: h },
      hasTouch: touch, isMobile: touch,
      deviceScaleFactor: touch ? 3 : 1,
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push(name + ': ' + String(e).slice(0, 100)));
    await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });

    const r = await page.evaluate(() => {
      const bar = document.querySelector('.app-tabbar');
      const all = [...document.querySelectorAll('[data-tab-of]')];
      const shown = all.filter((e) => getComputedStyle(e).display !== 'none');
      return {
        tabbar: bar ? getComputedStyle(bar).display !== 'none' : false,
        // 어플 배치면 한 번에 한 탭만 보인다
        oneTabOnly: all.length > 1 && shown.length === 1,
        padBottom: parseFloat(getComputedStyle(document.body).paddingBottom) || 0,
      };
    });

    const isApp = r.tabbar && r.oneTabOnly;
    check(name.padEnd(18) + (w + 'x' + h).padEnd(10) + (wantApp ? '어플 배치' : '웹 배치'),
      isApp === wantApp,
      isApp ? '탭바 있음·한 탭만' : '탭바 없음·전체');

    // 탭바가 뜨면 본문 끝이 가려지면 안 된다
    if (isApp) {
      check('   └ 탭바가 본문 끝을 안 가린다', r.padBottom >= 60, r.padBottom + 'px 비움');

      // 아이콘이 칸 가운데 있는가. .mono-icon이 display:block이라 부모의
      // text-align:center가 안 먹어서, 글자만 가운데 오고 아이콘은 왼쪽에
      // 남아 있었다 — 칸이 넓은 가로에서 확연히 어긋난다.
      const off = await page.evaluate(() => {
        return [...document.querySelectorAll('.app-tab')].map((tab) => {
          const ic = tab.querySelector('.app-tab-ic .mono-icon');
          if (!ic) return 0;
          const t = tab.getBoundingClientRect();
          const i = ic.getBoundingClientRect();
          return Math.abs((i.left + i.width / 2) - (t.left + t.width / 2));
        });
      });
      const worst = Math.max(...off);
      check('   └ 아이콘이 칸 가운데 있다', worst <= 1, '최대 ' + worst.toFixed(1) + 'px 어긋남');
    }
    await ctx.close();
  }

  check('콘솔 에러가 없다', errs.length === 0, errs.slice(0, 2).join(' | '));

  console.log('\n결과: ' + pass + '/' + (pass + fail) + ' 통과');
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})();
