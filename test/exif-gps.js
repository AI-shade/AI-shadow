// 아이섀도우 — 사진 파일에 박힌 좌표(EXIF GPS) 읽기 테스트
//
// 사용법: 이 폴더(test)에서 → node exif-gps.js
//   프론트가 http://localhost:8000 에서 돌고 있어야 합니다. AI 호출 없음 (비용 0).
//   고정 사진이 없으면: python make-exif-fixtures.py
//
// 왜 필요한가: 이 앱의 다른 위치 판단은 전부 추론이다 — "간판이 읽히니 좁혀질 수
// 있어요". 이것만 다르다. 파일에 위도·경도가 적혀 있으면 추론이 아니라 좌표다.
// 이 앱에서 유일하게 100% 확실한 위치 노출이라, 틀리면 그만큼 크게 틀린다:
//   못 읽으면  → 집 주소가 박힌 사진을 "안전하다"고 내보낸다 (놓침)
//   잘못 읽으면 → 엉뚱한 좌표로 겁을 준다 (오탐)
//
// 그래서 시험하는 것:
//   ① 흔한 경우(북위·동경)를 정확히 읽는가
//   ② 남위·서경 부호를 붙이는가 — 빼먹으면 지구 반대편을 가리킨다
//   ③ 빅엔디언(MM) 파일도 읽는가 — 리틀엔디언만 처리하면 여기서 틀린다
//   ④ 분모가 0인 유리수에서 죽지 않는가
//   ⑤ 좌표가 없을 때 "없다"고 제대로 말하는가 (있다고 지어내지 않는가)
//   ⑥ 깨진 파일·JPEG가 아닌 파일에서 예외를 던지지 않는가

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';
const DIR = path.join(__dirname, 'fixtures', 'exif');

// 좌표는 1/100초 단위로 저장되므로 소수점 5자리까지 맞으면 같은 것으로 본다
// (1/100초 ≈ 0.3m — 집을 특정하는 데에는 이 정밀도로 충분하다).
const TOL = 0.00002;

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

function near(a, b) {
  return a != null && b != null && Math.abs(a - b) < TOL;
}

(async () => {
  if (!fs.existsSync(DIR)) {
    console.log('고정 사진이 없습니다. 먼저 실행하세요: python make-exif-fixtures.py');
    process.exit(1);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.__anshimTest && window.__anshimTest.parseExifBuffer));

  // 파일 바이트를 그대로 브라우저로 넘겨 parseExifBuffer에 먹인다.
  // readExifGps(fetch)를 거치지 않는 이유: 파일 URL 접근 제약과 무관하게
  // 해석 부분만 따로 시험하기 위해서다.
  const parse = (file) => {
    const bytes = Array.from(fs.readFileSync(path.join(DIR, file)));
    return page.evaluate((b) => {
      const buf = new Uint8Array(b).buffer;
      return window.__anshimTest.parseExifBuffer(buf);
    }, bytes);
  };

  console.log('\n좌표가 박힌 사진');
  let r = await parse('gps-north-east.jpg');
  check('북위·동경을 읽는다', r.hasGps && near(r.lat, 37.566536) && near(r.lng, 126.977969),
    r.lat + ', ' + r.lng);
  check('촬영 시각도 읽는다', r.takenAt === '2026-08-27 14:32', r.takenAt);
  check('기기 정보도 읽는다', r.make === 'Apple' && r.model === 'iPhone 15 Pro',
    r.make + ' / ' + r.model);
  check('고도도 읽는다', Math.abs(r.altM - 37.5) < 0.01, r.altM + 'm');

  r = await parse('gps-south-west.jpg');
  check('남위·서경에 음수 부호를 붙인다',
    r.hasGps && r.lat < 0 && r.lng < 0 && near(r.lat, -34.603722) && near(r.lng, -58.381592),
    r.lat + ', ' + r.lng);

  r = await parse('gps-motorola.jpg');
  check('빅엔디언(MM) 파일도 읽는다',
    r.hasGps && near(r.lat, 35.179553) && near(r.lng, 129.075642),
    r.lat + ', ' + r.lng);

  console.log('\n좌표가 없는 사진');
  r = await parse('no-gps.jpg');
  check('GPS가 없으면 없다고 말한다', r.hasGps === false && r.lat === null, 'hasGps=' + r.hasGps);
  check('GPS가 없어도 촬영 시각은 읽는다', r.takenAt === '2026-05-06 07:08', r.takenAt);

  r = await parse('no-exif.jpg');
  check('EXIF 자체가 없으면 없다고 말한다', r.hasGps === false, 'hasGps=' + r.hasGps);

  console.log('\n망가진 값');
  r = await parse('gps-zero-denom.jpg');
  check('분모가 0이어도 죽지 않는다', r !== null && typeof r.hasGps === 'boolean',
    'lat=' + r.lat + ' lng=' + r.lng);

  const junk = await page.evaluate(() => {
    const T = window.__anshimTest;
    const out = {};
    // JPEG가 아닌 것 (PNG 머리)
    out.png = T.parseExifBuffer(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]).buffer).hasGps;
    // 빈 것
    out.empty = T.parseExifBuffer(new Uint8Array([]).buffer).hasGps;
    // JPEG 머리만 있고 뒤가 잘린 것
    out.truncated = T.parseExifBuffer(new Uint8Array([0xFF, 0xD8, 0xFF, 0xE1, 0x00]).buffer).hasGps;
    // 길이가 터무니없는 APP1
    out.badLen = T.parseExifBuffer(
      new Uint8Array([0xFF, 0xD8, 0xFF, 0xE1, 0xFF, 0xFF, 0x45, 0x78, 0x69, 0x66, 0, 0]).buffer).hasGps;
    return out;
  });
  check('PNG를 넣어도 던지지 않는다', junk.png === false);
  check('빈 파일에도 던지지 않는다', junk.empty === false);
  check('잘린 파일에도 던지지 않는다', junk.truncated === false);
  check('길이가 깨진 APP1에도 던지지 않는다', junk.badLen === false);

  console.log('\n실제 사진 (좌표가 없는 것으로 확인된 것들)');
  for (const rel of ['아이사진1.jpg', 'childphoto.jpeg']) {
    const p = path.join(__dirname, '..', rel);
    if (!fs.existsSync(p)) continue;
    const bytes = Array.from(fs.readFileSync(p));
    const got = await page.evaluate((b) => window.__anshimTest.parseExifBuffer(new Uint8Array(b).buffer), bytes);
    check(rel + '에서 좌표를 지어내지 않는다', got.hasGps === false, 'hasGps=' + got.hasGps);
  }

  check('콘솔 에러가 없다', errs.length === 0, errs.join(' | '));

  console.log('\n결과: ' + pass + '/' + (pass + fail) + ' 통과');
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})();
