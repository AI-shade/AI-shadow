// 아이섀도우 — 보정 화면: 들어오면 바로 원본, AI 단추는 원본(또는 앞선 AI 결과)에서 시작한다
//
// 사용법: 이 폴더(test)에서 → node ai-bg-base.js
//   프론트가 http://localhost:8000 에서 돌고 있어야 합니다. AI 호출 없음 (비용 0) —
//   배경 교체 요청은 가로채서 보낸 사진만 보고 가짜 응답을 준다.
//
// 왜:
//   ① 팀 테스트(10-27) "배경이 흐릿하게보여 … 자동보정된 결과를 기준으로 바껴서 뿌옇게 보이는거같아" — AI 다듬기가
//      자동 보정(배경 흐림 포함) 결과 위에서 시작했다. 고친 뒤 Claude가 보는 사진의 배경 선명도가 원본 대비 7% → 91%.
//   ② 이어서 자동 보정·찾은 곳 목록·놓친 곳 추가·상자 끌기를 화면에서 뺐다("자동보정이 빼봐봐 이것떄문에 더
//      불편한거같아", "바로바로 반영이 되는것도 아니고 로딩시간도 길고"). 들어올 때 글자 위치를 다시 계산하던
//      로딩(구글 비전·Tesseract)도 같이 빠졌다 — 들어오자마자 원본이 보여야 한다.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';
const PHOTO = path.join(__dirname, '..', 'public', 'self-check', 'school-sign.jpg');

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
  const calls = [];
  const sent = [];
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    calls.push(url.replace(/^.*\/api\//, ''));
    if (/flux-status/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ready":true}' });
    if (/replace-background/.test(url)) {
      sent.push(route.request().postDataJSON());
      // 가짜 결과: 작은 회색 PNG — 합성은 배경 자리에만 얹힌다
      const gray = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGNoaGhgwA0YhqYEAJwKBYGTYJdGAAAAAElFTkSuQmCC';
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ imageBase64: gray, mediaType: 'image/png', width: 8, height: 8, editPrompt: 'x', timingMs: 1, estimatedCostUsd: 0, attempts: 1 }) });
    }
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"테스트에서 막음"}' });
  });
  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.__anshimTest && window.__anshimTest.runAiUpgradeForTest));
  const u = 'data:image/jpeg;base64,' + fs.readFileSync(PHOTO).toString('base64');

  console.log('\n보정 화면에 들어오면');
  const entered = await page.evaluate(async (u) => {
    const T = window.__anshimTest;
    const face = await T.runFaceDetectionPipeline(u);
    T.setFaceForTest(face);
    T.setPastCountForTest(0, u); // 올린 사진 자리를 채운다
    document.getElementById('goCorrectBtn').click();
    await new Promise((r) => setTimeout(r, 400));
    const out = document.getElementById('previewAfter');
    return {
      busy: !document.getElementById('previewBusy').hidden,
      same: out.src === u,
      caption: document.getElementById('previewCaption').textContent,
      aiShown: getComputedStyle(document.getElementById('aiMore')).display !== 'none',
    };
  }, u);
  const entryCalls = calls.filter((c) => !/flux-status|access-check/.test(c));
  check('글자 위치 계산 같은 API 호출이 없다', entryCalls.length === 0, entryCalls.join(',') || '0회');
  check('기다림 표시 없이 바로 원본이 보인다', !entered.busy && entered.same, 'busy=' + entered.busy);
  check('무엇을 고르라고 안내한다', /골라주세요/.test(entered.caption), entered.caption.slice(0, 40));
  check('AI 단추가 보인다', entered.aiShown);

  function clickConsent(which) {
    return page.evaluate((which) => {
      window.__consentTimer = setInterval(() => {
        const m = document.getElementById('fluxConsentModal');
        if (m && getComputedStyle(m).display !== 'none') document.getElementById(which).click();
      }, 50);
    }, which);
  }

  console.log('\n배경 교체하기 — 동의를 취소하면');
  await clickConsent('fluxConsentCancel');
  const cancel = await page.evaluate(async () => {
    const T = window.__anshimTest;
    await T.runAiUpgradeForTest('ai');
    await new Promise((r) => setTimeout(r, 300));
    clearInterval(window.__consentTimer);
    return { caption: document.getElementById('previewCaption').textContent, steps: T.stackState().steps.length };
  });
  check('아무것도 안 한 상태로 돌아온다', /골라주세요/.test(cancel.caption) && cancel.steps === 0, cancel.steps + '단계 · ' + cancel.caption.slice(0, 30));
  check('동의 없이는 보내지 않는다', sent.length === 0, sent.length + '회');

  console.log('\n배경 교체하기 — 동의하면');
  await clickConsent('fluxConsentAgree');
  const agree = await page.evaluate(async () => {
    const T = window.__anshimTest;
    await T.runAiUpgradeForTest('ai');
    clearInterval(window.__consentTimer);
    return { caption: document.getElementById('previewCaption').textContent };
  });
  check('배경 교체 요청이 한 번 나간다', sent.length === 1, sent.length + '회');
  check('사람은 원본 그대로라고 알린다', /사람은 원본 그대로/.test(agree.caption), agree.caption.slice(0, 40));
  if (sent.length) {
    // Claude가 보는 사진이 원본만큼 선명한지 — 원본을 같은 크기로 줄인 것과 배경 자리(위쪽 왼편) 선명도를 비교한다
    const sharp = await page.evaluate(async ({ u, ctx }) => {
      const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = s; });
      const C = await load('data:image/jpeg;base64,' + ctx);
      const O = await load(u);
      const w = C.naturalWidth, h = C.naturalHeight;
      function lap(im) {
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const x = c.getContext('2d'); x.drawImage(im, 0, 0, w, h);
        const cw = Math.round(w * 0.5), ch = Math.round(h * 0.4);
        const d = x.getImageData(0, 0, cw, ch).data;
        const L = (i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        let s = 0, n = 0;
        for (let y = 1; y < ch - 1; y++) for (let x2 = 1; x2 < cw - 1; x2++) {
          const i = (y * cw + x2) * 4;
          const v = 4 * L(i) - L(i - 4) - L(i + 4) - L(i - cw * 4) - L(i + cw * 4);
          s += v * v; n++;
        }
        return s / n;
      }
      return { ctx: lap(C), orig: lap(O) };
    }, { u, ctx: sent[0].contextImageBase64 });
    const ratio = sharp.ctx / sharp.orig;
    check('Claude가 보는 사진의 배경이 원본만큼 선명하다', ratio > 0.6, (ratio * 100).toFixed(0) + '%');
  }

  console.log('\n이어서 다른 단추를 누르면');
  await clickConsent('fluxConsentCancel');
  const stacked = await page.evaluate(async () => {
    const T = window.__anshimTest;
    await T.runAiUpgradeForTest('mark');
    await new Promise((r) => setTimeout(r, 300));
    clearInterval(window.__consentTimer);
    return { steps: T.stackState().steps.map((s) => s.method) };
  });
  // 동의창은 사진마다 한 번만 묻는다(askFluxConsent) — 이미 동의했으니 로고 지우기는 바로 돈다. 여기서는 배경 결과가
  // 먼저 확정돼 그 위에 얹히는지만 본다(로고 지우기 요청은 가로채기에서 500으로 막혀 실패로 끝난다).
  check('앞선 배경 교체 결과가 먼저 확정된다', stacked.steps[0] === 'ai', stacked.steps.join(','));

  check('페이지 에러 없음', errs.length === 0, errs.join(' | '));
  await browser.close();
  console.log('\n' + pass + '개 통과, ' + fail + '개 실패');
  if (fail > 0) process.exitCode = 1;
})();
