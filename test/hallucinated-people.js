// 아이섀도우 — removeHallucinatedPeople 검증 (AI 배경 교체가 원본에 없던 아이를
// 만들어내는 버그에 대한 구조적 방어)
//
// 실사용 확인: kontext(flux-kontext-pro)는 마스크 없이 이미지 전체를 새로 그리기
// 때문에, 원본에 없던 사람을 다른 자리에 하나 더 그려내는 경우가 있다.
// restorePersonFromOriginal은 "원본 아이가 있던 자리"만 되돌리므로 그 가짜 아이는
// 그대로 남는다 — 그래서 결과를 다시 얼굴 검출에 돌려, 원본 얼굴과 겹치지 않는
// 얼굴이 있으면 지운다(removeHallucinatedPeople).
//
// AI를 호출하지 않는다(비용 없음) — 실제 사진 한 장에서 얼굴 영역을 복사해 다른
// 자리에 붙여넣어 "가짜 인물이 하나 더 생긴 상황"을 흉내낸다.
//
// 신뢰도 게이트도 함께 검증한다: face-api는 임계값을 0.3까지 낮춰뒀기 때문에 체크
// 무늬·손처럼 얼굴이 아닌 것도 낮은 신뢰도로 "얼굴"이라고 잘못 검출한다(실측:
// childphoto.jpeg 실호출에서 허리 부근 오탐 신뢰도 0.34, 실제 얼굴 0.89). 이걸
// 그대로 "가짜 인물"로 보면 사진의 엉뚱한 곳을 흐려버리므로 0.6 이상만 본다.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const PHOTO_PATH = path.join(__dirname, 'real-face-fixture.png'); // 실제 아이 사진 — .gitignore로 커밋 막음

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label + (detail ? '  (' + detail + ')' : '')); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '  (' + detail + ')' : '')); }
}

async function main() {
  if (!fs.existsSync(PHOTO_PATH)) {
    console.log('기준 사진이 없습니다: ' + PHOTO_PATH);
    console.log('background-replace-live.js를 한 번 돌리면 이 얼굴 기준 사진이 만들어집니다.');
    process.exitCode = 1;
    return;
  }
  const dataUrl = 'data:image/png;base64,' + fs.readFileSync(PHOTO_PATH).toString('base64');

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE_URL + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.__anshimTest && window.__anshimTest.removeHallucinatedPeople));

  const out = await page.evaluate(async (u) => {
    const T = window.__anshimTest;
    const img = await new Promise((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    const before = await T.runFaceDetectionPipeline(u);
    const real = before.faces[0];

    // 얼굴 영역을 그대로 복사해 화면 반대쪽 빈 자리에 붙여넣는다 — "다른 자리에
    // 아이를 하나 더 그려낸" 상황을 흉내낸다.
    const pad = 30;
    const sx = Math.max(0, real.box.x - pad), sy = Math.max(0, real.box.y - pad);
    const sw = real.box.width + pad * 2, sh = real.box.height + pad * 2;
    const dupX = 20, dupY = canvas.height - sh - 20;
    ctx.drawImage(canvas, sx, sy, sw, sh, dupX, dupY, sw, sh);

    const withDup = await T.runFaceDetectionPipeline(canvas.toDataURL('image/png'));

    const pixelAt = (cv, x, y) => cv.getContext('2d').getImageData(x, y, 1, 1).data;
    const diff = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    const realCenter = [real.box.x + real.box.width / 2, real.box.y + real.box.height / 2];
    const dupCenter = [dupX + sw / 2, dupY + sh / 2];
    const realPixelBefore = pixelAt(canvas, realCenter[0], realCenter[1]);
    const dupPixelBefore = pixelAt(canvas, dupCenter[0], dupCenter[1]);

    await T.removeHallucinatedPeople(canvas, [real], canvas.width, canvas.height);

    const afterDataUrl = canvas.toDataURL('image/png');
    const after = await T.runFaceDetectionPipeline(afterDataUrl);
    const realPixelAfter = pixelAt(canvas, realCenter[0], realCenter[1]);
    const dupPixelAfter = pixelAt(canvas, dupCenter[0], dupCenter[1]);

    // 신뢰도 게이트 — 저신뢰 오탐은 애초에 "가짜 인물"로 취급되면 안 된다.
    // 흐리고 반투명하게 잘라 붙여 "얼굴처럼 보이지만 확신은 낮은" 오탐을 흉내낸다.
    const lowConfCanvas = document.createElement('canvas');
    lowConfCanvas.width = canvas.width; lowConfCanvas.height = canvas.height;
    const lctx = lowConfCanvas.getContext('2d');
    lctx.drawImage(img, 0, 0);
    lctx.filter = 'blur(3px) opacity(60%)'; // 실측: 이 값에서 신뢰도 0.37짜리 오탐이 안정적으로 생김
    lctx.drawImage(img, sx, sy, sw, sh, dupX, dupY, sw, sh);
    lctx.filter = 'none';
    const lowConfDetected = await T.runFaceDetectionPipeline(lowConfCanvas.toDataURL('image/png'));
    const lowConfExtra = lowConfDetected.faces.find((f) => T.faceBoxOverlapRatioForTest(f.box, real.box) <= 0.2);
    const lowConfPixelBefore = pixelAt(lowConfCanvas, dupCenter[0], dupCenter[1]);
    await T.removeHallucinatedPeople(lowConfCanvas, [real], lowConfCanvas.width, lowConfCanvas.height);
    const lowConfPixelAfter = pixelAt(lowConfCanvas, dupCenter[0], dupCenter[1]);

    // 실사용 제보: kontext가 같은 아이를 원본과 전혀 안 겹칠 만큼 크게 옮겨 그린 적이
    // 있다. 그때 겹침 비율만으로 "같은 아이인지" 판단하면 진짜 아이를 "원본에 없던
    // 인물"로 오판해 흐려버린다 — 사진 위에 회색 얼룩이 생기는 버그였다. 원본 사진을
    // 통째로 40% 옆으로 옮겨 그려서(원본과 겹침 0%) 이 상황을 흉내낸다.
    const shiftX = Math.round(img.naturalWidth * 0.4);
    const shiftCanvas = document.createElement('canvas');
    shiftCanvas.width = img.naturalWidth; shiftCanvas.height = img.naturalHeight;
    const sctx = shiftCanvas.getContext('2d');
    sctx.fillStyle = '#777777'; sctx.fillRect(0, 0, shiftCanvas.width, shiftCanvas.height);
    sctx.drawImage(img, shiftX, 0);
    const beforeShiftUrl = shiftCanvas.toDataURL('image/png');
    const shiftedDetected = await T.runFaceDetectionPipeline(beforeShiftUrl);
    const overlapAfterShift = shiftedDetected.faces.length
      ? T.faceBoxOverlapRatioForTest(shiftedDetected.faces[0].box, real.box) : null;
    const shiftCheck = await T.removeHallucinatedPeople(shiftCanvas, [real], shiftCanvas.width, shiftCanvas.height);
    const afterShiftUrl = shiftCanvas.toDataURL('image/png');
    const shiftOffset = T.computeAlignmentOffset([real], shiftCheck.resultFaces);

    return {
      beforeCount: before.faces.length,
      withDupCount: withDup.faces.length,
      withDupMinConfidence: Math.min.apply(null, withDup.faces.map((f) => f.confidence)),
      afterCount: after.faces.length,
      realAreaChanged: diff(realPixelBefore, realPixelAfter),
      dupAreaChanged: diff(dupPixelBefore, dupPixelAfter),
      lowConfExtraConfidence: lowConfExtra ? lowConfExtra.confidence : null,
      lowConfAreaChanged: diff(lowConfPixelBefore, lowConfPixelAfter),
      shiftX: shiftX,
      overlapAfterShift: overlapAfterShift,
      shiftUnchanged: beforeShiftUrl === afterShiftUrl,
      shiftOffsetDx: shiftOffset.dx,
    };
  }, dataUrl);

  console.log('\n[진짜 중복 인물 — 흐려서 지워야 함]');
  check('원본 사진엔 얼굴 1개', out.beforeCount === 1, String(out.beforeCount));
  check('복사 붙여넣기 후 얼굴 2개로 검출됨(테스트 준비 확인)', out.withDupCount === 2, String(out.withDupCount));
  check('둘 다 신뢰도 0.6 이상 — 신뢰도 게이트를 통과할 조건', out.withDupMinConfidence >= 0.6,
    out.withDupMinConfidence.toFixed(2));
  check('제거 후 얼굴이 다시 1개로 돌아옴', out.afterCount === 1, String(out.afterCount));
  check('원본 아이 얼굴 자리는 손대지 않음', out.realAreaChanged === 0, '변화량 ' + out.realAreaChanged);
  check('가짜로 붙여넣은 자리는 흐려져서 바뀜', out.dupAreaChanged > 20, '변화량 ' + out.dupAreaChanged);

  console.log('\n[신뢰도 게이트 — 얼굴이 아닌 걸 얼굴로 오탐했을 때 건드리지 않아야 함]');
  if (out.lowConfExtraConfidence === null) {
    console.log('  SKIP  이번 실행에서는 저신뢰 오탐이 만들어지지 않았습니다(흐림 강도에 따라 매번 같지 않을 수 있음)');
  } else {
    check('저신뢰 오탐은 게이트(0.6) 밑이다', out.lowConfExtraConfidence < 0.6,
      '신뢰도 ' + out.lowConfExtraConfidence.toFixed(2));
    check('신뢰도가 낮으면 그 자리를 건드리지 않는다', out.lowConfAreaChanged === 0,
      '변화량 ' + out.lowConfAreaChanged);
  }

  console.log('\n[크게 밀려 그려진 같은 아이 — 겹침이 0이어도 가짜 인물로 오판하면 안 됨]');
  check('밀린 뒤에는 원본과 안 겹친다(테스트 준비 확인)', out.overlapAfterShift === 0, String(out.overlapAfterShift));
  check('개수가 같으면(1명↔1명) 흐리지 않는다', out.shiftUnchanged === true, 'unchanged=' + out.shiftUnchanged);
  check('옮겨간 만큼 어긋남을 정확히 잰다', Math.abs(out.shiftOffsetDx - out.shiftX) < 5,
    'dx=' + out.shiftOffsetDx.toFixed(1) + ' vs 실제 ' + out.shiftX);

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
