// 안심앨범 — 텍스트 영역 분기(classifyTextRegions) 테스트
//
// 사용법: 이 폴더(test)에서 → node text-routing.js
//   프론트가 http://localhost:8000 에서 돌고 있어야 합니다.
//
// AI를 호출하지 않습니다 (비용 없음). 순수 분류 함수만 검증합니다.
//
// 왜 필요한가: fal FLUX Fill로 실측한 결과, 인페인팅은 "주변 맥락이 벽·유리·바닥인
// 작은 텍스트"는 깨끗이 지우지만, "간판"은 지우는 대신 가짜 글씨를 새로 그려 넣습니다
// (2026-08-21 실측: "춧천쿠 전설룽", "POFATS & BILES"가 생성됨). 프롬프트로는 못 막습니다.
// 그래서 간판형은 인페인팅으로 보내지 않고 스티커/흐림으로 돌립니다.

const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';

// 꽃집간판.jpg(960x540) 실측 기준 — 이 사진이 판단 기준의 근거입니다
const IMG = { w: 960, h: 540 };

// xPct/yPct는 중심 좌표, wPct/hPct는 크기 (textWordToPixelBbox와 같은 규약)
const WORDS = {
  간판_상호명: { text: '누아블룸', xPct: 60, yPct: 37, wPct: 31, hPct: 17 },
  간판_짧은글자: { text: '꽃집', xPct: 32, yPct: 37, wPct: 14, hPct: 17 },
  전화번호: { text: '010-4956-6091', xPct: 73, yPct: 49, wPct: 21, hPct: 6.7 },
  주소코드: { text: '1118-1', xPct: 22, yPct: 58, wPct: 9, hPct: 5.9 },
  유리문_주소코드: { text: '1118-1', xPct: 68, yPct: 93, wPct: 6.5, hPct: 4.4 },
  넓지만_납작한_띠: { text: 'A'.repeat(40), xPct: 50, yPct: 20, wPct: 70, hPct: 4.5 },
};

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

  const exists = await page.evaluate(() => !!(window.__anshimTest && window.__anshimTest.classifyTextRegions));
  if (!exists) {
    console.log('  FAIL  window.__anshimTest.classifyTextRegions 가 없습니다');
    await browser.close();
    process.exitCode = 1;
    return;
  }

  const run = (words) =>
    page.evaluate(({ words, IMG }) => {
      const r = window.__anshimTest.classifyTextRegions(words, IMG.w, IMG.h);
      return { inpaint: r.inpaint.map((w) => w.text), signboard: r.signboard.map((w) => w.text) };
    }, { words, IMG });

  console.log('\n간판형 판정 (인페인팅에서 제외해야 함)');
  let r = await run([WORDS.간판_상호명]);
  check('큰 상호명은 간판형', r.signboard.length, 1);
  check('큰 상호명은 인페인팅 대상 아님', r.inpaint.length, 0);

  r = await run([WORDS.간판_짧은글자]);
  check('글자 수가 적어도 키가 크면 간판형', r.signboard.length, 1);

  r = await run([WORDS.넓지만_납작한_띠]);
  check('납작해도 면적이 크면 간판형', r.signboard.length, 1);

  console.log('\n인페인팅 대상 판정');
  r = await run([WORDS.전화번호]);
  check('전화번호는 인페인팅 대상', r.inpaint.length, 1);
  check('전화번호는 간판형 아님', r.signboard.length, 0);

  r = await run([WORDS.주소코드]);
  check('주소코드는 인페인팅 대상', r.inpaint.length, 1);

  r = await run([WORDS.유리문_주소코드]);
  check('유리문 안 작은 코드는 인페인팅 대상', r.inpaint.length, 1);

  console.log('\n섞여 있을 때 (실제 꽃집간판.jpg 상황)');
  r = await run([WORDS.간판_상호명, WORDS.간판_짧은글자, WORDS.전화번호, WORDS.주소코드, WORDS.유리문_주소코드]);
  check('간판 2개가 간판형으로 분리됨', r.signboard.length, 2);
  check('나머지 3개가 인페인팅 대상', r.inpaint.length, 3);
  check('전화번호가 인페인팅 쪽에 있음', r.inpaint.includes('010-4956-6091'), true);

  console.log('\n경계 조건');
  r = await run([]);
  check('빈 목록이면 둘 다 비어있음', r.inpaint.length + r.signboard.length, 0);

  const rNull = await page.evaluate(({ IMG }) => {
    const x = window.__anshimTest.classifyTextRegions(null, IMG.w, IMG.h);
    return x.inpaint.length + x.signboard.length;
  }, { IMG });
  check('null이어도 터지지 않음', rNull, 0);

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
