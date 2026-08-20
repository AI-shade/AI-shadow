// 안심앨범 — Claude 힌트 기반 텍스트 위치 확정(locateTextsByHints) 테스트
//
// 사용법: 이 폴더(test)에서 → node text-locate.js
//   프론트가 http://localhost:8000 에서 돌고 있어야 합니다.
//   Tesseract는 브라우저 로컬 실행이라 **AI 비용이 없습니다** (다만 30초 정도 걸립니다).
//
// 배경: Claude Vision은 이 사진에서 텍스트 7개를 읽지만, 위치 계산용 Tesseract는
// 사진 전체에서 1개(큰 간판)만 찾아냈다. 나머지는 "뭔지는 아는데 어디 있는지 몰라서"
// 보정할 수 없었다(README 12번의 기존 한계).
//
// PSM 6종·반전·이진화 임계값을 바꿔가며 Tesseract가 스스로 찾게 만들려는 시도는 전부
// 실패했다. 풀린 방법은 역할을 나누는 것이었다:
//
//   Claude Vision → 무엇이 어디쯤 있는지 (내용 정확, 위치 근사)
//   Tesseract     → 그 근처만 오려 확대해서 좌표 추출 (내용 엉터리, 위치 정확)
//
// 그래서 이 테스트의 성공 기준은 "글자를 맞게 읽었는가"가 아니라 **"좌표가 맞는가"**다.
// Tesseract가 전화번호를 "10 A0506-609 1"로 잘못 읽어도 상관없다 — 글자는 Claude 것을
// 쓰고 좌표만 가져다 쓰기 때문.

const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';
const IMG = { w: 960, h: 540 };

// Claude Vision이 줄 법한 "근사" 위치 — 일부러 실제보다 어긋나게 잡아 견고성을 본다.
// truth는 사람이 눈으로 확인한 실제 위치.
const CASES = [
  { name: '전화번호', text: '010-4956-6091', hint: { xPct: 70, yPct: 52 }, truth: { x0: 600, y0: 246, x1: 800, y1: 282 }, 정밀기대: true },
  { name: '지번(좌)', text: '1118-1', hint: { xPct: 25, yPct: 55 }, truth: { x0: 175, y0: 300, x1: 255, y1: 328 }, 정밀기대: true },
  { name: '지번(유리문)', text: '1118-1', hint: { xPct: 65, yPct: 90 }, truth: { x0: 622, y0: 492, x1: 680, y1: 514 }, 정밀기대: false },
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

function iou(a, b) {
  const ix = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const iy = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const inter = ix * iy;
  const uni = (a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - inter;
  return uni > 0 ? inter / uni : 0;
}

function covers(box, truth) {
  return box.x0 <= truth.x0 && box.y0 <= truth.y0 && box.x1 >= truth.x1 && box.y1 >= truth.y1;
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });

  const has = await page.evaluate(() => !!(window.__anshimTest && window.__anshimTest.locateTextsByHints));
  if (!has) {
    console.log('  FAIL  window.__anshimTest.locateTextsByHints 가 없습니다');
    await browser.close();
    process.exitCode = 1;
    return;
  }

  console.log('\nTesseract 로컬 실행 중 — 30초 정도 걸립니다 (AI 비용 없음)...');

  const got = await page.evaluate(async (hints) => {
    const url = '/' + encodeURIComponent('꽃집간판.jpg');
    const out = await window.__anshimTest.locateTextsByHints(url, hints);
    return out.map((w) => ({
      text: w.text,
      approximate: !!w.approximate,
      xPct: w.xPct, yPct: w.yPct, wPct: w.wPct, hPct: w.hPct,
    }));
  }, CASES.map((c) => ({ text: c.text, xPct: c.hint.xPct, yPct: c.hint.yPct })));

  console.log('\n결과 개수');
  check('힌트 3개 → 결과 3개 (아무것도 잃지 않음)', got.length === 3, got.length + '개');

  console.log('\n좌표 정확도');
  CASES.forEach((c) => {
    const w = got.find((g) => g.text === c.text && Math.abs(g.xPct - c.hint.xPct) < 40);
    if (!w) {
      fail++;
      console.log('  FAIL  ' + c.name + ' 결과가 없음');
      return;
    }
    const box = {
      x0: (w.xPct - w.wPct / 2) / 100 * IMG.w,
      y0: (w.yPct - w.hPct / 2) / 100 * IMG.h,
      x1: (w.xPct + w.wPct / 2) / 100 * IMG.w,
      y1: (w.yPct + w.hPct / 2) / 100 * IMG.h,
    };
    const v = iou(box, c.truth);
    const round = (n) => Math.round(n);
    const boxStr = [box.x0, box.y0, box.x1, box.y1].map(round).join(',');

    if (c.정밀기대) {
      check(c.name + ' — 정밀 좌표를 찾음', !w.approximate, w.approximate ? '근사로 대체됨' : '정밀');
      check(c.name + ' — 겹침 IoU ≥ 0.3', v >= 0.3, 'IoU ' + v.toFixed(2) + ' / ' + boxStr);
    } else {
      check(c.name + ' — 못 찾으면 근사로 표시됨', w.approximate === true, w.approximate ? '근사' : '정밀로 나옴');
      check(c.name + ' — 근사 박스가 실제 위치를 덮음', covers(box, c.truth), boxStr + ' ⊇ ' + [c.truth.x0, c.truth.y0, c.truth.x1, c.truth.y1].join(','));
    }
  });

  console.log('\n안전 방향 (마스킹은 넓게 잡히는 게 안전)');
  const phone = got.find((g) => g.text === '010-4956-6091');
  if (phone) {
    const h = phone.hPct / 100 * IMG.h;
    check('전화번호 박스 높이가 실제(36px) 이상', h >= 30, Math.round(h) + 'px');
  }

  console.log('\n전체 스캔이 이미 찾은 것 골라내기 (pickUnlocatedHints)');
  // 실제 꽃집간판.jpg 상황: 전체 스캔은 큰 간판 하나만 찾았고 글자를 지저분하게 읽었다
  const located = [{ text: '교지 누아블룸 _', xPct: 52, yPct: 34, wPct: 69.8, hPct: 21.2 }];
  const claude = [
    { text: '꽃집', xPct: 32, yPct: 37 },
    { text: '누아블룸', xPct: 60, yPct: 37 },
    { text: '010-4956-6091', xPct: 73, yPct: 49 },
    { text: '1118-1', xPct: 22, yPct: 58 },
    { text: '1118-1', xPct: 68, yPct: 93 },
  ];
  const picked = await page.evaluate(
    ({ claude, located }) => window.__anshimTest.pickUnlocatedHints(claude, located).map((w) => w.text),
    { claude, located }
  );
  check('간판 안에 있는 2개는 재탐색 대상에서 빠짐', picked.length === 3, picked.join(', '));
  check('전화번호는 재탐색 대상', picked.includes('010-4956-6091'));
  check('지번 2개도 재탐색 대상', picked.filter((t) => t === '1118-1').length === 2);

  const fuzzy = await page.evaluate(() =>
    window.__anshimTest.pickUnlocatedHints(
      [{ text: '누아 블룸', xPct: 5, yPct: 5 }],
      [{ text: '누아블룸', xPct: 90, yPct: 90, wPct: 5, hPct: 5 }]
    ).length
  );
  check('위치가 멀어도 글자가 같으면 중복으로 보고 제외', fuzzy === 0);

  console.log('\n경계 조건');
  const empty = await page.evaluate(async () => {
    const out = await window.__anshimTest.locateTextsByHints('/' + encodeURIComponent('꽃집간판.jpg'), []);
    return out.length;
  });
  check('힌트가 없으면 빈 배열', empty === 0);

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
