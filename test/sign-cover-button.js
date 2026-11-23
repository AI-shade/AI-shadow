// 아이섀도우 — 보정 단추 나누기(11-23): «간판 가리기»는 간판만, «배경 교체»는 배경 전체. 못 찾으면 알리고 멈춘다.
//
// 사용법: 이 폴더(test)에서 → node sign-cover-button.js
//   프론트가 http://localhost:8000 에서 돌고 있어야 합니다. AI 호출 없음 (비용 0) — 읽기·보정 요청을 가로채 가짜 응답을 준다.
//
// 왜: 예전 «배경 교체»는 누르면 간판만 가리고, 간판을 못 찾으면 말없이 배경 전체를 바꿨다. 같은 단추가 사진마다 다른 일을 했고,
//   간판만 가린 뒤에야 «배경 전체 바꾸기» 단추가 나타났다. 사용자: «간판가리기 기능하고 배경교체 기능 로고 지우기 이렇게 3개 해야겠어»
//   — 단추 이름과 하는 일이 1:1이어야 하고, 사용자가 누르지 않은 보정(배경 전체)에 돈이 나가면 안 된다.
//
// 3번(간판을 찾았을 때)은 마크 모델 파일(public/models/mark-int8.onnx, 41MB, 저장소 밖)이 있을 때만 돈다.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';
const PHOTO = path.join(__dirname, '..', 'public', 'self-check', 'school-sign.jpg');
const GRAY = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGNoaGhgwA0YhqYEAJwKBYGTYJdGAAAAAElFTkSuQmCC';

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label + (detail ? '  (' + detail + ')' : '')); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '  (' + detail + ')' : '')); }
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  let readAs = 'none';                 // 'none' = 모든 상자를 글자없음으로 / 'place' = 모든 상자를 기관 이름으로
  const hit = { read: 0, sign: 0, bg: 0 };
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const ok = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (/flux-status/.test(url)) return ok({ ready: true });
    if (/read-sign-boxes/.test(url)) {
      hit.read++;
      const n = (route.request().postDataJSON() || {}).count || 0;
      const 상자 = Array.from({ length: n }, (_, i) => readAs === 'place' ? { 번호: i + 1, 내용: '햇살어린이집', 유형: '기관명' } : { 번호: i + 1, 내용: '', 유형: '글자없음' });
      return ok({ 상자 });
    }
    if (/inpaint-regions/.test(url)) { hit.sign++; return ok({ imageBase64: GRAY, mediaType: 'image/png', width: 8, height: 8, editPrompt: 'x', timingMs: 1, estimatedCostUsd: 0, attempts: 1 }); }
    if (/replace-background/.test(url)) { hit.bg++; return ok({ imageBase64: GRAY, mediaType: 'image/png', width: 8, height: 8, editPrompt: 'x', timingMs: 1, estimatedCostUsd: 0, attempts: 1 }); }
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"테스트에서 막음"}' });
  });
  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.__anshimTest && window.__anshimTest.runAiUpgradeForTest));
  await page.evaluate(() => window.__anshimTest.setDepthForTest(() => { throw new Error('test: no depth'); }));
  const u = 'data:image/jpeg;base64,' + fs.readFileSync(PHOTO).toString('base64');
  const hasModel = await page.evaluate(async (url) => { try { return (await fetch(url, { method: 'HEAD' })).ok; } catch (e) { return false; } }, BASE_URL + '/public/models/mark-int8.onnx');

  console.log('\n[1] 보정 화면의 AI 단추');
  const btns = await page.evaluate(async (u) => {
    const T = window.__anshimTest;
    T.setFaceForTest(await T.runFaceDetectionPipeline(u));
    T.setPastCountForTest(0, u);
    document.getElementById('goCorrectBtn').click();
    await new Promise((r) => setTimeout(r, 400));
    const all = Array.from(document.querySelectorAll('#aiMore .ai-more-btns > button')).map((b) => (b.querySelector('.ai-name') || b).textContent.trim());
    return { all, full: !!document.getElementById('aiBgFullBtn'), signShown: !!document.getElementById('aiSignBtn') && getComputedStyle(document.getElementById('aiSignBtn')).display !== 'none' };
  }, u);
  check('단추 순서: 간판 가리기 · 로고 지우기 · 배경 교체 · (로고 지우기 뒤) 옷 전체 바꾸기', btns.all.join(',') === '간판 가리기,로고 지우기,배경 교체,옷 전체 바꾸기', btns.all.join(','));
  check('«간판 가리기»가 처음부터 보인다', btns.signShown);
  check('«배경 전체 바꾸기» 단추는 없다 («배경 교체»가 맡는다)', !btns.full);

  const press = (kind) => page.evaluate(async (kind) => {
    const T = window.__anshimTest;
    await T.runAiUpgradeForTest(kind);
    const out = document.getElementById('previewAfter');
    return { caption: document.getElementById('previewCaption').textContent.trim(), png: out.src.startsWith('data:image/png') };
  }, kind);

  console.log('\n[2] 간판 가리기 — 가릴 간판이 없으면');
  readAs = 'none'; Object.assign(hit, { read: 0, sign: 0, bg: 0 });
  const none = await press('sign');
  check('간판 보정 요청이 나가지 않는다', hit.sign === 0, hit.sign + '회');
  check('배경 전체로 넘어가지 않는다 (배경 교체 요청 0회)', hit.bg === 0, hit.bg + '회');
  check('못 찾았다고 알리고 «배경 교체»를 안내한다', /가릴 간판을 찾지 못했어요/.test(none.caption) && /배경 교체/.test(none.caption), none.caption.slice(0, 50));

  if (!hasModel) {
    console.log('\n[3] 건너뜀 — public/models/mark-int8.onnx 가 없다(41MB, 저장소 밖). 팀자료/모델/에서 복사하면 돈다.');
  } else {
    console.log('\n[3] 간판 가리기 — 위치를 알려 주는 간판이 있으면');
    readAs = 'place'; Object.assign(hit, { read: 0, sign: 0, bg: 0 });
    const got = await press('sign');
    check('간판을 읽는다', hit.read === 1, hit.read + '회');
    check('간판 자리만 보정 요청이 한 번 나간다', hit.sign === 1, hit.sign + '회');
    check('배경 교체 요청은 나가지 않는다', hit.bg === 0, hit.bg + '회');
    check('결과 사진이 보이고 안내 문장은 없다', got.png && got.caption === '', got.caption.slice(0, 40));
  }

  console.log('\n[4] 배경 교체 — 누르면');
  readAs = 'place'; Object.assign(hit, { read: 0, sign: 0, bg: 0 });
  const bg = await press('ai');
  check('간판을 읽지 않고 바로 배경 전체로 간다 (읽기 0회)', hit.read === 0, hit.read + '회');
  check('배경 교체 요청이 한 번 나간다', hit.bg === 1, hit.bg + '회');
  check('간판 보정 요청은 나가지 않는다', hit.sign === 0, hit.sign + '회');
  const steps = await page.evaluate(() => window.__anshimTest.stackState().steps.map((s) => s.method));
  if (hasModel) check('앞선 «간판 가리기» 결과가 먼저 확정되고 그 위에 배경 교체가 얹힌다', steps[0] === 'sign', steps.join(','));

  check('페이지 에러 없음', errs.length === 0, errs.join(' | '));
  await browser.close();
  console.log('\n' + pass + '개 통과, ' + fail + '개 실패');
  if (fail > 0) process.exitCode = 1;
})();
