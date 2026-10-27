// 아이섀도우 — 자동 보정 테스트 (방식 카드 4장을 «자동 보정» 하나 + «AI로 더 다듬기»로 합친 뒤)
//
// 사용법: 이 폴더(test)에서 → node auto-correction.js
//   프론트가 http://localhost:8000 에서 돌고 있어야 합니다. **AI 호출 없음 (비용 0)** — AI 경로는 가짜 응답으로 막고 동의창을 취소한다.
//   정답표 사진(사진 100장 분석/사진1.png)이 없으면 실제 사진 검사는 건너뜁니다.
//
// 이 테스트가 지키는 것:
//   ① 어떤 단계가 도는지는 읽은 값으로 정해진다 — 글자가 있으면 덮고, 소속 단서가 있으면 옷 색, 글자 없이 장소만 있으면 배경 흐림
//   ② 장소로 인정되지 않는 얼버무림(«특정 불가»·«일반 놀이터»)은 배경 흐림을 일으키지 않는다
//   ③ 실제 사진에서 자동 보정이 브라우저 안에서 끝나고(API 0회), 얼굴은 한 픽셀도 안 바뀐다
//   ④ AI 다듬기에서 동의를 취소하면 확정해 둔 자동 보정이 되돌려지고 자동 미리보기로 돌아온다
//   ⑤ 방식 카드·옷 선택 줄·흐림 슬라이더가 되살아나지 않았다

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';
const PHOTO = path.join(__dirname, '..', '사진 100장 분석', '사진1.png');

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label + (detail ? '  (' + detail + ')' : '')); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '  (' + detail + ')' : '')); }
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  const apiCalls = [];
  page.on('request', (r) => { if (r.url().indexOf('/api/') >= 0) apiCalls.push(r.url().replace(/^.*\/api\//, '')); });
  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.__anshimTest && window.__anshimTest.planAutoCorrectionForTest));

  console.log('\n어떤 단계가 도는가 (순수 규칙)');
  const plan = (texts, ocr, faces) => page.evaluate((a) => window.__anshimTest.planAutoCorrectionForTest(a[0], a[1], a[2]), [texts, ocr, faces]);
  const T1 = [{ text: '청룡 태권도' }];
  const FACE = [{ box: { x: 1, y: 1, width: 2, height: 2 } }];
  const UNI = [{ 종류: '태권도복' }];
  const MARK = [{ 이름: '창덕궁', 좁혀지는범위: '건물', 확신: '확실' }];
  let r = await plan(T1, { visualClues: UNI, landmarks: MARK }, FACE);
  check('글자가 있으면 덮는다', r.cover === true && r.coverN === 1);
  check('글자가 있으면 장소 단서가 있어도 배경은 흐리지 않는다', r.blur === false);
  check('소속 단서가 읽히면 옷 색을 바꾼다', r.uniform === true);
  r = await plan([], { visualClues: [], landmarks: MARK }, FACE);
  check('글자 없이 알아볼 장소만 있으면 배경을 흐린다', r.cover === false && r.blur === true && r.uniform === false);
  r = await plan([], { visualClues: UNI, landmarks: [{ 이름: '특정 불가', 좁혀지는범위: '도시', 확신: '추정' }] }, FACE);
  check('«특정 불가»는 장소가 아니라서 배경 흐림을 일으키지 않는다', r.blur === false);
  // «어린이 놀이터»처럼 종류 낱말 앞에 수식어가 붙은 것은 앱의 장소 판정(scoredLandmarks)이 점수를 준다 —
  // 배경 흐림도 그 판정을 그대로 따른다(판정을 여기서 새로 만들지 않는다).
  r = await plan([], { visualClues: UNI, landmarks: [] }, []);
  check('얼굴이 없으면 옷 색을 못 바꾼다(옷 위치를 얼굴로 잡는다)', r.uniform === false);
  r = await plan([], { visualClues: [{ 종류: '평상복' }], landmarks: [] }, FACE);
  check('소속이 아닌 옷(평상복)은 색을 바꾸지 않는다', r.uniform === false);
  r = await plan([], null, FACE);
  check('읽은 게 없으면 아무 단계도 안 돈다', !r.cover && !r.uniform && !r.blur);

  console.log('\n단계 목록 표시');
  const shown = await page.evaluate(() => {
    const T = window.__anshimTest;
    T.renderAutoPlanForTest({ cover: true, coverN: 3, uniform: true, blur: false });
    const a = Array.from(document.querySelectorAll('#autoPlan li')).map((l) => l.textContent);
    const rowA = document.getElementById('methodRowValue').textContent;
    T.renderAutoPlanForTest({ cover: false, coverN: 0, uniform: false, blur: false });
    const b = Array.from(document.querySelectorAll('#autoPlan li')).map((l) => l.textContent);
    return { a, rowA, b, rowB: document.getElementById('methodRowValue').textContent };
  });
  check('도는 단계를 한 줄씩 보여준다', shown.a.length === 2 && /3곳/.test(shown.a[0]) && /교복/.test(shown.a[1]), shown.a.join(' / '));
  check('폰 행에도 짧게 요약된다', shown.rowA === '글자 3곳 · 교복 색', shown.rowA);
  const sw = await page.evaluate(() => {
    window.__anshimTest.renderAutoPlanForTest({ cover: true, coverN: 3, uniform: true, blur: false });
    return Array.from(document.querySelectorAll('#methodRowList .mr-switch')).map((s) => s.dataset.step + ':' + s.checked + ':' + s.getAttribute('role'));
  });
  check('폰 단계 목록에 단계마다 켜진 스위치가 있다 (편집창 스위치, 10-27)', sw.join(',') === 'cover:true:switch,uniform:true:switch', sw.join(','));
  await page.evaluate(() => window.__anshimTest.renderAutoPlanForTest({ cover: false, coverN: 0, uniform: false, blur: false }));
  check('할 일이 없으면 그렇다고 말한다', shown.b.length === 1 && /찾지 못했어요/.test(shown.b[0]) && shown.rowB === '가릴 곳 없음');

  console.log('\n없앤 선택지가 되살아나지 않았다');
  const gone = await page.evaluate(() => ({
    cards: document.querySelectorAll('.method-card').length,
    blurSlider: !!document.getElementById('blurRange'),
    outfitRow: !!document.getElementById('outfitStyle') || document.querySelectorAll('.of-btn').length > 0,
    stackBtn: !!document.getElementById('applyStepBtn'),
    aiBtns: Array.from(document.querySelectorAll('#aiMore .ai-more-btns > button')).map((b) => b.textContent.trim()),
    title: (document.querySelector('.correct-left h3') || {}).textContent.trim(),
    autoHidden: getComputedStyle(document.getElementById('autoPlan')).display === 'none'
      && getComputedStyle(document.getElementById('targetPicker')).display === 'none',
  }));
  check('방식 카드가 없다', gone.cards === 0);
  check('흐림 슬라이더·옷 선택 줄·겹쳐 쓰기 단추가 없다', !gone.blurSlider && !gone.outfitRow && !gone.stackBtn);
  // 10-27 사용자 결정으로 자동 보정·찾은 곳 목록을 화면에서 뺐다("자동보정이 빼봐봐 이것떄문에 더 불편한거같아").
  // 위 자동 보정 검사는 함수(planAutoCorrection·selectMethod('auto'))가 남아 있어 그대로 두지만, 화면에서는 부르지 않는다.
  check('AI 단추는 로고 지우기·배경 교체하기·옷 전체 바꾸기 셋이다', gone.aiBtns.join(',') === '로고 지우기,배경 교체하기,옷 전체 바꾸기', gone.aiBtns.join(','));
  check('제목이 무엇을 바꿀지 묻는다', gone.title === '무엇을 바꿀까요?', gone.title);
  check('자동 보정 단계 목록·찾은 곳 목록은 화면에 없다', gone.autoHidden);

  if (!fs.existsSync(PHOTO)) {
    console.log('\n(건너뜀) 사진 파일 없음 — 실제 사진 검사');
  } else {
    console.log('\n실제 사진 — 글자 + 소속 단서 (태권도 간판 사진)');
    const u = 'data:image/png;base64,' + fs.readFileSync(PHOTO).toString('base64');
    const before = apiCalls.length;
    const res = await page.evaluate(async (u) => {
      const T = window.__anshimTest;
      document.getElementById('screen-form').style.display = 'none';
      document.getElementById('screen-correct').style.display = '';
      const face = await T.runFaceDetectionPipeline(u);
      T.setFaceForTest(face);
      T.setLocCluesForTest({ ocr: { visualClues: [{ 종류: '태권도복' }], landmarks: [], words: [] } });
      T.setTargets([{ text: '청룡 태권도 체육관', xPct: 50, yPct: 8, wPct: 50, hPct: 12, type: '상호명' }]);
      T.stackSeed(u);
      await T.selectMethodForTest('auto');
      const out = document.getElementById('previewAfter');
      await new Promise((r) => { if (out.complete && out.naturalWidth) r(); else out.onload = r; });
      const load = (src) => new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = src; });
      const A = await load(u), B = await load(out.src);
      const w = A.naturalWidth, h = A.naturalHeight;
      const px = (im) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.drawImage(im, 0, 0, w, h); return x.getImageData(0, 0, w, h).data; };
      const a = px(A), b = px(B);
      const region = (x0, y0, x1, y1) => {
        let diff = 0, n = 0;
        for (let y = Math.max(0, Math.floor(y0)); y < Math.min(h, y1); y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(w, x1); x++) {
          const i = (y * w + x) * 4; n++;
          if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 30) diff++;
        }
        return n ? diff / n : 0;
      };
      const fb = face.faces[0].box;
      // 얼굴 상자 아래 끝은 옷깃이 걸친다(실측: 바뀐 픽셀이 전부 상자 아래 20%의 검은 깃). 얼굴·머리가 있는 위쪽 75%를 잰다.
      const headBottom = fb.y + fb.height * 0.75;
      return {
        size: w + 'x' + h + ' → ' + B.naturalWidth + 'x' + B.naturalHeight, sameSize: w === B.naturalWidth && h === B.naturalHeight,
        plan: Array.from(document.querySelectorAll('#autoPlan li')).map((l) => l.textContent),
        caption: document.getElementById('previewCaption').textContent,
        signChanged: region(w * 0.25, h * 0.0, w * 0.75, h * 0.17),
        faceChanged: region(fb.x, fb.y, fb.x + fb.width, headBottom),
        suit: region(w * 0.40, h * 0.45, w * 0.60, h * 0.75),
        meta: T.stackState && true,
      };
    }, u);
    check('원본과 같은 크기로 돌아온다', res.sameSize, res.size);
    check('도는 단계가 글자 덮기 + 교복 색이다', res.plan.length === 2 && /글자/.test(res.plan[0]) && /교복/.test(res.plan[1]), res.plan.join(' / '));
    check('간판 자리가 실제로 바뀐다', res.signChanged > 0.2, (res.signChanged * 100).toFixed(0) + '% 픽셀');
    check('옷이 실제로 바뀐다', res.suit > 0.1, (res.suit * 100).toFixed(0) + '% 픽셀');
    check('얼굴·머리(상자 위쪽 75%)는 한 픽셀도 안 바뀐다', res.faceChanged === 0, (res.faceChanged * 100).toFixed(2) + '%');
    check('설명에 지운 글자를 다시 적지 않는다', res.caption.indexOf('청룡') === -1 && res.caption.indexOf('태권도 체육관') === -1, res.caption.slice(0, 80));
    check('API를 부르지 않는다', apiCalls.length === before, apiCalls.slice(before).join(','));

    console.log('\n글자 없이 장소만 — 배경 흐림');
    const blurRes = await page.evaluate(async (u) => {
      const T = window.__anshimTest;
      T.setLocCluesForTest({ ocr: { visualClues: [], landmarks: [{ 이름: '창덕궁', 좁혀지는범위: '건물', 확신: '확실' }], words: [] } });
      T.setTargets([]);
      T.stackSeed(u);
      await T.selectMethodForTest('auto');
      return {
        plan: Array.from(document.querySelectorAll('#autoPlan li')).map((l) => l.textContent),
        caption: document.getElementById('previewCaption').textContent,
      };
    }, u);
    check('도는 단계가 배경 흐림 하나다', blurRes.plan.length === 1 && /배경/.test(blurRes.plan[0]), blurRes.plan.join(' / '));
    check('흐렸다고 말한다', /배경을 흐렸어요/.test(blurRes.caption), blurRes.caption.slice(0, 80));

    console.log('\n할 일이 없을 때');
    const noneRes = await page.evaluate(async (u) => {
      const T = window.__anshimTest;
      T.setLocCluesForTest({ ocr: { visualClues: [], landmarks: [], words: [] } });
      T.setTargets([]);
      T.stackSeed(u);
      await T.selectMethodForTest('auto');
      return { caption: document.getElementById('previewCaption').textContent, src: document.getElementById('previewAfter').src === u };
    }, u);
    check('가릴 곳이 없으면 원본을 그대로 보여주고 길을 알려준다', noneRes.src && /찾지 못했어요/.test(noneRes.caption) && /놓친 곳 추가/.test(noneRes.caption), noneRes.caption.slice(0, 60));

    console.log('\nAI 다듬기 — 동의를 취소하면 되돌아온다');
    await page.route('**/api/flux-status*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ready: true }) }));
    const aiBefore = apiCalls.length;
    const rb = await page.evaluate(async (u) => {
      const T = window.__anshimTest;
      T.setLocCluesForTest({ ocr: { visualClues: [{ 종류: '태권도복' }], landmarks: [], words: [] } });
      T.setTargets([{ text: '청룡 태권도 체육관', xPct: 50, yPct: 8, wPct: 50, hPct: 12, type: '상호명' }]);
      T.stackSeed(u);
      await T.selectMethodForTest('auto');
      const hadAuto = T.stackState().steps.length;
      // 동의창이 뜨면 취소를 누른다
      const timer = setInterval(() => {
        const m = document.getElementById('fluxConsentModal');
        if (m && getComputedStyle(m).display !== 'none') document.getElementById('fluxConsentCancel').click();
      }, 50);
      await T.runAiUpgradeForTest('mark');
      await new Promise((r) => setTimeout(r, 400));
      clearInterval(timer);
      const st = T.stackState();
      const method = document.querySelector('#autoPlan li') && 'auto';
      return { hadAuto, steps: st.steps.length, history: st.history, caption: document.getElementById('previewCaption').textContent,
               consentShown: !!document.getElementById('fluxConsentModal') };
    }, u);
    check('동의창이 떴다 (이 검사의 전제)', rb.consentShown);
    check('취소하면 확정해 둔 자동 보정이 되돌려진다', rb.steps === 0 && rb.history === 0, '쌓인 단계 ' + rb.steps + ' / 되돌리기 ' + rb.history);
    check('취소하면 자동 미리보기로 돌아온다', /글자|교복/.test(rb.caption), rb.caption.slice(0, 60));
    // 사진을 보내는 호출만 센다. flux-status는 «준비됐나» 확인이라 사진이 없다.
    const aiCalls = apiCalls.slice(aiBefore).filter((c) => /inpaint|replace-background|inpaint-sign/i.test(c));
    check('동의 없이는 사진을 보내지 않는다', aiCalls.length === 0, aiCalls.join(','));

    // 사진 위 «처리 중» 안내는 데스크톱에서 단추보다 위에 있어, 단추를 누르는 순간 화면 밖으로 나갔다.
    // 그래서 단추 아래에도 같은 안내를 띄운다(AI 호출은 3초 뒤 실패하는 가짜 응답이다 — 비용 0).
    console.log('\nAI 다듬기 — 기다리는 동안 단추 아래에도 안내가 뜬다');
    await page.route('**/api/replace-background*', async (route) => {
      await new Promise((r) => setTimeout(r, 3000));
      try { await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: '시험용 가짜 응답' }) }); } catch (e) { /* 닫힘 */ }
    });
    const wt = await page.evaluate(async (u) => {
      const T = window.__anshimTest;
      document.getElementById('aiMore').style.display = 'block';
      T.setLocCluesForTest({ ocr: { visualClues: [{ 종류: '태권도복' }], landmarks: [], words: [] } });
      T.setTargets([{ text: '청룡 태권도 체육관', xPct: 50, yPct: 8, wPct: 50, hPct: 12, type: '상호명' }]);
      T.stackSeed(u);
      await T.selectMethodForTest('auto');
      const timer = setInterval(() => {
        const m = document.getElementById('fluxConsentModal');
        if (m && getComputedStyle(m).display !== 'none') document.getElementById('fluxConsentAgree').click();
      }, 50);
      const run = T.runAiUpgradeForTest('bg');
      await new Promise((r) => setTimeout(r, 1500));
      const w = document.getElementById('aiWait');
      const during = { shown: !w.hidden, text: document.getElementById('aiWaitText').textContent };
      try { await run; } catch (e) { /* 가짜 응답 실패 */ }
      await new Promise((r) => setTimeout(r, 300));
      clearInterval(timer);
      return { during, afterHidden: document.getElementById('aiWait').hidden };
    }, u);
    check('기다리는 동안 단추 아래에 안내가 뜬다', wt.during.shown && /배경을 새로 그리는 중/.test(wt.during.text) && /10~20초/.test(wt.during.text), wt.during.text.replace(/\n/g, ' / '));
    check('끝나면 안내가 사라진다', wt.afterHidden);
  }

  check('콘솔 에러가 없다', errs.length === 0, errs.join(' | '));
  console.log('\n결과: ' + pass + '/' + (pass + fail) + ' 통과');
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})();
