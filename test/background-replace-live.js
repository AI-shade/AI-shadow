// 아이섀도우 — AI 배경 교체 실호출 검증: "원본에 없던 아이가 생기는" 버그가 다시
// 나타나지 않는지 확인한다.
//
// ⚠️ 이 테스트는 실제로 fal.ai(flux-kontext-pro)를 호출합니다 — 1회당 비용이 들고
//    10~20초 걸립니다. 배경 교체 관련 코드를 고쳤을 때만 확인용으로 돌리세요.
//
// 사용법:
//   1) 백엔드: cd server && node server.js   (.env에 FAL_KEY 필요, 3001번)
//   2) 이 폴더에서: node background-replace-live.js
//
// 왜 이미지를 파일 서버로 안 읽고 base64로 넣는가: 로컬 실제 아이 사진(childphoto.jpeg
// 등)은 .gitignore로 커밋을 막아둔 파일이라, 정적 서버 URL로 노출하고 싶지 않다.
// Node에서 직접 읽어 data: URL로 넘기면 어떤 서버에도 파일로 노출되지 않는다.
//
// 왜 이 사진인가: 전신이 다 나오고 교복처럼 보이는 옷(가슴 엠블럼, 체크 리본)을 입고
// 있어서, 예전 버그(2026-08-21, "원복·명찰" 근거로 옷을 다시 그리다 사람 자체가
// 바뀜)를 유발했던 조건과 가장 비슷하다.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PHOTO_PATH = process.env.PHOTO || path.join(__dirname, '..', 'childphoto.jpeg');
const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label + (detail ? '  (' + detail + ')' : '')); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '  (' + detail + ')' : '')); }
}

async function main() {
  if (!fs.existsSync(PHOTO_PATH)) {
    console.log('사진이 없습니다: ' + PHOTO_PATH + ' — 로컬 테스트용 실제 사진이 있어야 돕니다.');
    process.exitCode = 1;
    return;
  }
  const b64 = fs.readFileSync(PHOTO_PATH).toString('base64');
  const ext = path.extname(PHOTO_PATH).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
  const dataUrl = 'data:' + mime + ';base64,' + b64;

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE_URL + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.__anshimTest && window.__anshimTest.runFluxBackgroundReplace));

  console.log('실제 fal 호출 중 — 10~20초 정도 걸립니다...\n');

  const out = await page.evaluate(async (dataUrl) => {
    const T = window.__anshimTest;
    const loadImg = (src) => new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = src;
    });

    const srcImg = await loadImg(dataUrl);
    const before = await T.runFaceDetectionPipeline(dataUrl);

    const fluxData = await T.runFluxBackgroundReplace(dataUrl,
      { grade: '상', locationEvidence: '교복(원복)·명찰이 보여서 다니는 기관이 좁혀져요.' },
      { words: [], visualClues: [] });

    const outImg = await loadImg('data:image/png;base64,' + fluxData.imageBase64);
    const outCanvas = document.createElement('canvas');
    outCanvas.width = srcImg.naturalWidth;
    outCanvas.height = srcImg.naturalHeight;
    outCanvas.getContext('2d').drawImage(outImg, 0, 0, outCanvas.width, outCanvas.height);

    // 지우기 전: 순수 AI 결과에 원본보다 얼굴이 더 많이 생겼는지가 이번 버그의 핵심이다.
    const rawResultFaces = await T.runFaceDetectionPipeline(outCanvas.toDataURL('image/jpeg', 0.9));

    await T.removeHallucinatedPeople(outCanvas, before.faces, outCanvas.width, outCanvas.height);
    const afterRemoval = await T.runFaceDetectionPipeline(outCanvas.toDataURL('image/jpeg', 0.9));

    const aiMask = await T.getPersonMask(srcImg, null);
    T.restorePersonFromOriginal(outCanvas, srcImg, before.faces, outCanvas.width, outCanvas.height, aiMask);
    const finalFaces = await T.runFaceDetectionPipeline(outCanvas.toDataURL('image/jpeg', 0.9));

    // hallucinated-people.js(무료·항상 도는 회귀 테스트)가 쓸 "얼굴 1개짜리 실제 사진"
    // 기준 파일을 여기서 함께 만들어둔다 — 원본 사진 자체를 그대로 쓰면 되고, AI 결과와는
    // 무관해서 매번 다르게 나오는 AI 변동성에 흔들리지 않는다.
    let fixtureDataUrl = null;
    if (before.faces.length === 1) {
      const fx = document.createElement('canvas');
      fx.width = srcImg.naturalWidth; fx.height = srcImg.naturalHeight;
      fx.getContext('2d').drawImage(srcImg, 0, 0);
      fixtureDataUrl = fx.toDataURL('image/png');
    }

    return {
      originalFaceCount: before.faces.length,
      rawResultFaceCount: rawResultFaces.faces.length,
      afterRemovalFaceCount: afterRemoval.faces.length,
      finalFaceCount: finalFaces.faces.length,
      cost: fluxData.estimatedCostUsd,
      seconds: Math.round(fluxData.timingMs / 1000),
      fixtureDataUrl: fixtureDataUrl,
    };
  }, dataUrl);

  if (out.fixtureDataUrl) {
    const fixturePath = path.join(__dirname, 'real-face-fixture.png');
    fs.writeFileSync(fixturePath, Buffer.from(out.fixtureDataUrl.split(',')[1], 'base64'));
    console.log('hallucinated-people.js용 기준 사진 갱신: ' + fixturePath + ' (실제 아이 사진 — 커밋 금지, .gitignore 처리됨)\n');
  }

  console.log('원본 얼굴 수: ' + out.originalFaceCount);
  console.log('AI 결과(순수) 얼굴 수: ' + out.rawResultFaceCount);
  console.log('중복 인물 제거 후: ' + out.afterRemovalFaceCount);
  console.log('원본 아이 복원 후(최종): ' + out.finalFaceCount);
  console.log('비용: $' + out.cost + ' / ' + out.seconds + '초\n');

  if (out.rawResultFaceCount > out.originalFaceCount) {
    console.log('  → 이번 호출에서 실제로 AI가 사람을 더 만들어냈습니다. 아래에서 잘 지워졌는지 확인합니다.');
  } else {
    console.log('  → 이번 호출에서는 AI가 사람을 더 만들지 않았습니다(확률적 현상이라 매번 재현되지 않습니다).');
  }

  check('중복 제거 후에는 원본 얼굴 수를 넘지 않는다', out.afterRemovalFaceCount <= out.originalFaceCount,
    out.afterRemovalFaceCount + ' <= ' + out.originalFaceCount);
  check('최종 결과의 얼굴 수가 원본과 같다', out.finalFaceCount === out.originalFaceCount,
    out.finalFaceCount + ' vs ' + out.originalFaceCount);

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
