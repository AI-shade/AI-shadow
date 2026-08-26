// 아이섀도우 — AI 배경 교체: 두 사람 이상일 때 각자 다른 방향으로 밀려도
// 이중 인화(고스트) 없이 각자의 자리로 되돌아오는지 검증.
//
// 실사용 제보: 아이 둘이 나온 사진에서 AI 배경 교체를 쓰면 한 명은 맞는데 다른
// 한 명은 계속 겹쳐 보이는(이중 인화) 문제가 있었다. 원인은 restorePersonFromOriginal이
// "평균 어긋남 하나"로 마스크 전체를 옮겼기 때문 — 두 사람이 서로 다른 방향으로
// 밀리면 평균은 둘 중 누구의 자리도 맞추지 못하는 절충값이 된다.
// 고친 뒤에는 얼굴마다 자기 몸통 범위(computeSubjectRegion)로 마스크를 잘라
// 각자의 어긋남으로 따로 옮긴다.
//
// AI를 호출하지 않는다(비용 없음) — 실제 사진 한 장을 복제해 "두 사람"을 만들고,
// 각자 다른 방향으로 옮겨 그려서 "AI가 각자 다르게 밀어 그린" 상황을 흉내낸다.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const PHOTO_PATH = path.join(__dirname, 'real-face-fixture.png');

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
  await page.waitForFunction(() => !!(window.__anshimTest && window.__anshimTest.restorePersonFromOriginal));

  const out = await page.evaluate(async (u) => {
    const T = window.__anshimTest;
    const img = await new Promise((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u;
    });
    const single = await T.runFaceDetectionPipeline(u);
    if (single.faces.length !== 1) return { setupError: '기준 사진에서 얼굴이 정확히 1개가 아님: ' + single.faces.length };

    // 같은 얼굴을 옆으로 하나 더 붙여 "두 사람"을 만든다.
    const W = img.naturalWidth * 2, H = img.naturalHeight;
    const orig = document.createElement('canvas');
    orig.width = W; orig.height = H;
    const octx = orig.getContext('2d');
    octx.drawImage(img, 0, 0);
    octx.drawImage(img, img.naturalWidth, 0);
    const origDetected = await T.runFaceDetectionPipeline(orig.toDataURL('image/png'));
    const faces = origDetected.faces;
    if (faces.length !== 2) return { setupError: '두 사람 합성 후 얼굴이 정확히 2개가 아님: ' + faces.length };

    const halfW = img.naturalWidth;
    const SHIFT = 30;
    // "AI가 각자 다른 방향으로 옮겨 그렸다" — 왼쪽 절반은 +SHIFT, 오른쪽 절반은 -SHIFT.
    const aiCanvas = document.createElement('canvas');
    aiCanvas.width = W; aiCanvas.height = H;
    const actx = aiCanvas.getContext('2d');
    actx.fillStyle = '#999999'; actx.fillRect(0, 0, W, H);
    actx.drawImage(orig, 0, 0, halfW, H, SHIFT, 0, halfW, H);
    actx.drawImage(orig, halfW, 0, halfW, H, halfW - SHIFT, 0, halfW, H);

    const matched = T.matchFacesForTest(faces, (await T.runFaceDetectionPipeline(aiCanvas.toDataURL('image/png'))).faces);
    const offsets = faces.map((of) => {
      const pair = matched.pairs.find((p) => p.of === of);
      if (!pair) return { dx: 0, dy: 0 };
      const ocx = of.box.x + of.box.width / 2, ocy = of.box.y + of.box.height / 2;
      const rcx = pair.rf.box.x + pair.rf.box.width / 2, rcy = pair.rf.box.y + pair.rf.box.height / 2;
      return { dx: rcx - ocx, dy: rcy - ocy };
    });

    T.restorePersonFromOriginal(aiCanvas, orig, faces, W, H, null, offsets);
    const finalDetected = await T.runFaceDetectionPipeline(aiCanvas.toDataURL('image/png'));

    const expectedXs = faces
      .map((f, i) => Math.round(f.box.x + (offsets[i].dx || 0)))
      .sort((a, b) => a - b);
    const actualXs = finalDetected.faces.map((f) => Math.round(f.box.x)).sort((a, b) => a - b);

    return {
      matchedPairsCount: matched.pairs.length,
      extrasCount: matched.extras.length,
      finalFaceCount: finalDetected.faces.length,
      expectedXs, actualXs,
    };
  }, dataUrl);

  if (out.setupError) {
    console.log('  FAIL  테스트 준비 실패: ' + out.setupError);
    fail++;
  } else {
    check('두 얼굴이 각자 짝을 찾는다(가짜 인물 0명)', out.matchedPairsCount === 2 && out.extrasCount === 0,
      'pairs=' + out.matchedPairsCount + ' extras=' + out.extrasCount);
    check('되돌린 뒤에도 얼굴 수가 2명 그대로다(고스트로 늘거나 지워지지 않음)',
      out.finalFaceCount === 2, String(out.finalFaceCount));
    check('두 사람 다 각자의 밀린 자리로 정확히 돌아온다', out.finalFaceCount === 2 &&
      Math.abs(out.actualXs[0] - out.expectedXs[0]) < 8 && Math.abs(out.actualXs[1] - out.expectedXs[1]) < 8,
      '기대 ' + JSON.stringify(out.expectedXs) + ' 실제 ' + JSON.stringify(out.actualXs));
  }

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
