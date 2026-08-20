// 안심앨범 — 얼굴분석(face-api.js) + 텍스트판독(Claude Vision/Tesseract) 회귀 테스트
//
// 사용법:
//   1) 프로젝트 루트에서 정적 서버 실행: python -m http.server 8000
//   2) server/ 폴더에서 백엔드 실행: npm start (Claude Vision 호출용, .env에 API 키 필요)
//   3) 이 폴더(test)에서: npm install (최초 1회) → npm test
//
// 새 단계 작업을 마칠 때마다 이 스크립트를 돌려서 이전 단계에서 확인한 인식 결과가
// 그대로 유지되는지 확인하세요.
//
// ⚠️ 이 스크립트는 항상 ?debug=1로 열어서 Claude Vision과 Tesseract를 "둘 다" 실행합니다.
//    즉, 실행할 때마다 Claude Vision API가 실제로 호출되어 소액이지만 비용이 발생합니다
//    (일반 케이스당 약 $0.01, 스케줄 패턴 케이스는 스크린샷 4장+패턴분석까지 포함돼서
//    약 $0.01~0.02 수준, claude-haiku-4-5 기준).
//    Claude의 텍스트 판독/패턴 판단은 호출마다 결과가 조금씩 달라질 수 있어(비결정적)
//    어서션은 일부러 느슨하게(부분 문자열, 개수, 유출여부 위주) 잡았습니다.

const { chromium } = require('playwright');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';

const CASES = [
  {
    name: '텍스트만 (꽃집간판.jpg) — 기준 케이스',
    image: path.join(__dirname, '..', '꽃집간판.jpg'),
    // Claude Vision 결과가 호출마다 "누아블룸"/"누아블롱" 등으로 조금씩 달라질 수 있어
    // 공통 부분("누아블")만 확인 — 완전 일치가 아니라 "판독 자체가 되는지"가 목적
    expect: { minFaces: 0, maxFaces: 0, minTexts: 1, textIncludes: '누아블', checkCompareTable: true },
  },
  {
    name: '얼굴만 (fixtures/face-only.png)',
    image: path.join(__dirname, 'fixtures', 'face-only.png'),
    // 실제 텍스트가 없는 사진에서도 OCR이 저신뢰도(60%대) 잡음을 1개 정도 잘못 잡아내는
    // 경우가 있음을 확인함(README 5번 항목 참고) — 알려진 노이즈라 maxTexts는 1까지 허용
    expect: { minFaces: 1, maxFaces: 1, minTexts: 0, maxTexts: 1 },
  },
  {
    name: '얼굴+텍스트 결합 (fixtures/face-plus-text.jpg)',
    image: path.join(__dirname, 'fixtures', 'face-plus-text.jpg'),
    expect: { minFaces: 1, minTexts: 1 },
  },
  {
    name: '스케줄 패턴 있음 (fixtures/schedule-pattern/*)',
    image: path.join(__dirname, '..', '꽃집간판.jpg'),
    pastImages: [1, 2, 3, 4].map((i) => path.join(__dirname, 'fixtures', 'schedule-pattern', 'post' + i + '.png')),
    expect: { scheduleFlagEquals: '있음' },
  },
  {
    name: '스케줄 패턴 없음 — 오탐 방지 확인 (fixtures/schedule-nopattern/*)',
    image: path.join(__dirname, '..', '꽃집간판.jpg'),
    pastImages: [1, 2, 3, 4].map((i) => path.join(__dirname, 'fixtures', 'schedule-nopattern', 'post' + i + '.png')),
    expect: { scheduleFlagEquals: '없음' },
  },
];

async function runCase(page, testCase) {
  const errors = [];
  const onPageError = (e) => errors.push(String(e));
  const onConsole = (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); };
  page.on('pageerror', onPageError);
  page.on('console', onConsole);

  try {
    // 얼굴이 0개 감지되면(예: 꽃집간판.jpg처럼 사람이 없는 사진) 이제 "얼굴 검출 실패" 확인
    // 모달이 떠서 사용자 선택을 기다린다. 회귀 테스트는 기존 비교표/스케줄분석 검증을 그대로
    // 하고 싶으므로, 모달이 뜨면 자동으로 "그래도 원본으로 분석"을 선택하도록 미리 걸어둠.
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const modal = document.getElementById('noFaceConsentModal');
        if (!modal) return;
        const auto = () => {
          if (getComputedStyle(modal).display !== 'none') {
            const btn = document.getElementById('noFaceConsentOriginal');
            if (btn) btn.click();
          }
        };
        new MutationObserver(auto).observe(modal, { attributes: true, attributeFilter: ['style'] });
      });
    });
    await page.goto(BASE_URL + '/index.html?debug=1', { waitUntil: 'load' });
    await (await page.$('#photoInput')).setInputFiles(testCase.image);
    if (testCase.pastImages) {
      await (await page.$('#pastInput')).setInputFiles(testCase.pastImages);
    }
    await page.click('#submitBtn');
    // #3 단계별 표시 도입 후: 결과 화면은 얼굴+텍스트 판독만 끝나면 먼저 뜨고,
    // 위험도 진단(및 디버그 비교표)은 백그라운드에서 이어서 채워짐 — 그것까지 기다려야 함
    await page.waitForSelector('#screen-result[style*="display: block"]', { timeout: 60000 });
    await page.waitForFunction(
      () => !document.getElementById('riskScore').classList.contains('skel'),
      { timeout: 60000 }
    );

    const faceCount = await page.$$eval('.pin.face', (els) => els.length);
    const textCount = await page.$$eval('.pin:not(.face)', (els) => els.length);
    const legend = await page.$eval('#pinLegend', (el) => el.textContent);
    const compareTable = await page.$eval('#debugCompareTable', (el) => el.textContent);
    const scheduleFlag = await page.$eval('#scheduleFlag', (el) => el.textContent.trim());

    const failures = [];
    const exp = testCase.expect;
    if (exp.minFaces != null && faceCount < exp.minFaces) failures.push('얼굴 개수 ' + faceCount + ' < 최소 ' + exp.minFaces);
    if (exp.maxFaces != null && faceCount > exp.maxFaces) failures.push('얼굴 개수 ' + faceCount + ' > 최대 ' + exp.maxFaces);
    if (exp.minTexts != null && textCount < exp.minTexts) failures.push('텍스트 개수 ' + textCount + ' < 최소 ' + exp.minTexts);
    if (exp.maxTexts != null && textCount > exp.maxTexts) failures.push('텍스트 개수 ' + textCount + ' > 최대 ' + exp.maxTexts);
    if (exp.textIncludes && !legend.includes(exp.textIncludes)) failures.push('범례에 "' + exp.textIncludes + '" 없음 (실제: ' + legend + ')');
    if (exp.checkCompareTable && (!compareTable.includes('Claude Vision') || !compareTable.includes('Tesseract'))) {
      failures.push('Claude Vision/Tesseract 비교표가 정상적으로 채워지지 않음');
    }
    if (exp.scheduleFlagEquals && scheduleFlag !== exp.scheduleFlagEquals) {
      failures.push('스케줄 유출 경고 "' + scheduleFlag + '" ≠ 기대값 "' + exp.scheduleFlagEquals + '"');
    }
    if (errors.length > 0) failures.push('콘솔/페이지 에러 발생: ' + errors.join(' | '));

    return { name: testCase.name, pass: failures.length === 0, failures, faceCount, textCount };
  } finally {
    page.off('pageerror', onPageError);
    page.off('console', onConsole);
  }
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 500, height: 1600 } });

  console.log('회귀 테스트 시작 — 대상: ' + BASE_URL);
  const results = [];
  for (const tc of CASES) {
    process.stdout.write('  - ' + tc.name + ' ... ');
    try {
      const r = await runCase(page, tc);
      results.push(r);
      console.log(r.pass ? 'PASS (얼굴 ' + r.faceCount + '개, 텍스트 ' + r.textCount + '개)' : 'FAIL');
      if (!r.pass) r.failures.forEach((f) => console.log('      ✗ ' + f));
    } catch (e) {
      results.push({ name: tc.name, pass: false, failures: [e.message] });
      console.log('ERROR');
      console.log('      ✗ ' + e.message);
    }
  }

  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log('\n총 ' + results.length + '개 중 ' + (results.length - failed.length) + '개 통과, ' + failed.length + '개 실패');
  process.exit(failed.length > 0 ? 1 : 0);
})();
