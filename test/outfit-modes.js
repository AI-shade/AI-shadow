// 아이섀도우 — 옷 보정 방식 두 개 테스트 (마크만 지우기 / 옷 색만 바꾸기)
//
// 사용법: 이 폴더(test)에서 → node outfit-modes.js
//   프론트가 http://localhost:8000 에서 돌고 있어야 합니다. **AI 호출 없음 (비용 0).**
//   마스크와 로컬 색 변경만 검사합니다 — 실호출 확인은 따로 했습니다(커밋 메시지 참고).
//
// 왜 필요한가: 제보 "옷 색만 바뀌어야 할텐데 왜 옷 자체가 다른 옷으로 바뀌는거야".
// 원인은 프롬프트가 아니라 마스크가 옷 전체라서 FLUX가 옷 전체를 새로 그린다는 데
// 있었다. 그래서 두 방식을 더했다 —
//   마크만 지우기   가슴만 좁힌 마스크. 옷의 나머지는 구조적으로 못 건드린다.
//   옷 색만 바꾸기  옷 분할 마스크 안쪽의 색조만 이동. AI를 부르지 않는다.
//
// 이 테스트가 지키는 것:
//   ① 가슴 마스크가 옷 전체가 아니다 — 이게 무너지면 방식의 존재 이유가 없어진다
//   ② 가슴 마스크가 얼굴·손을 열지 않는다 — 얼굴이 흰색이면 AI가 아이 얼굴을 다시 그린다
//   ③ 가슴 마스크가 옷 바깥(배경·맨살)을 열지 않는다
//   ④ 색만 바꾸기가 옷 바깥 픽셀을 건드리지 않는다 — 배경·얼굴이 바뀌면 안 된다
//   ⑤ 색만 바꾸기가 밝기를 보존한다 — 주름·단추가 살아 있어야 "색만" 바뀐 것이다

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';
const PHOTOS = ['아이사진1.jpg', 'childphoto.jpeg'];
const TARGET = '#CCB490'; // 오트밀 베이지 (COLORWAYS.brown.hex)

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

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.__anshimTest && window.__anshimTest.buildEmblemMask));

  console.log('\n합쳐진 카드와 선택지');
  const ui = await page.evaluate(() => ({
    methods: Array.from(document.querySelectorAll('.method-card')).map((c) => c.dataset.method),
    colors: Array.from(document.querySelectorAll('.cw-btn')).map((b) => b.dataset.cw),
    emblems: Array.from(document.querySelectorAll('.em-btn')).map((b) => b.dataset.em),
    emblemDefault: (document.querySelector('.em-btn.selected') || { dataset: {} }).dataset.em,
  }));
  check('옷 카드는 하나다', ui.methods.filter((m) => m === 'outfit').length === 1, ui.methods.join(', '));
  check('없어진 카드가 되살아나지 않았다',
    ui.methods.indexOf('emblem') === -1 && ui.methods.indexOf('recolor') === -1);
  check('교복 티 지우기 선택지 4개', ui.emblems.join(',') === 'keep,pocket,none,all', ui.emblems.join(','));
  check('색 선택지에 "안 바꾸기"가 있다', ui.colors.indexOf('keep') >= 0, ui.colors.join(','));
  // 기본값이 "그대로 두기"여야 카드를 고르는 것만으로 사진이 나가지 않는다
  check('기본 마크 처리는 "그대로 두기"', ui.emblemDefault === 'keep', ui.emblemDefault);

  for (const rel of PHOTOS) {
    const file = path.join(__dirname, '..', rel);
    if (!fs.existsSync(file)) continue;
    const u = 'data:image/jpeg;base64,' + fs.readFileSync(file).toString('base64');

    console.log('\n[' + rel + '] 가슴 마스크');
    const m = await page.evaluate(async (u) => {
      const T = window.__anshimTest;
      const img = await new Promise((r, j) => { const i = new Image(); i.onload = () => r(i); i.onerror = j; i.src = u; });
      const w = img.naturalWidth, h = img.naturalHeight;
      const face = await T.runFaceDetectionPipeline(u);
      const clothes = await T.getClothesMask(img, 'om:' + u.length + ':' + u.slice(-40));
      if (!clothes) return { err: '옷 분할 실패' };
      const hands = await T.detectHandBoxes(img);
      const boxes = face.faces.map((f) => f.box);
      const mask = T.buildEmblemMask(boxes, w, h, clothes, hands);

      const md = mask.getContext('2d').getImageData(0, 0, w, h).data;
      const cc = document.createElement('canvas'); cc.width = w; cc.height = h;
      cc.getContext('2d').drawImage(clothes, 0, 0, w, h);
      const cd = cc.getContext('2d').getImageData(0, 0, w, h).data;

      let open = 0, clothesPx = 0, outsideClothes = 0;
      for (let i = 0; i < md.length; i += 4) {
        const isOpen = md[i] > 128, isClothes = cd[i + 3] > 128;
        if (isClothes) clothesPx++;
        if (isOpen) { open++; if (!isClothes) outsideClothes++; }
      }
      // 얼굴·손 중심이 열려 있는지
      const at = (x, y) => md[(Math.round(y) * w + Math.round(x)) * 4] > 128;
      const faceOpen = face.faces.filter((f) => at(f.box.x + f.box.width / 2, f.box.y + f.box.height / 2)).length;
      const handOpen = hands.filter((hb) => at(hb.x + hb.width / 2, hb.y + hb.height / 2)).length;
      return {
        openPct: (open / (w * h) * 100).toFixed(1),
        ofClothes: clothesPx ? (open / clothesPx * 100).toFixed(0) : '0',
        outsideClothes, faceOpen, handOpen, faces: face.faces.length, hands: hands.length,
      };
    }, u);
    if (m.err) { check('옷 분할이 된다', false, m.err); continue; }

    check('옷 전체가 아니다 (60% 미만)', Number(m.ofClothes) < 60, '옷의 ' + m.ofClothes + '%');
    check('빈 마스크가 아니다', Number(m.openPct) > 0.3, '사진의 ' + m.openPct + '%');
    check('얼굴을 열지 않는다', m.faceOpen === 0, '얼굴 ' + m.faces + '개 중 열린 것 ' + m.faceOpen + '개');
    check('손을 열지 않는다', m.handOpen === 0, '손 ' + m.hands + '개 중 열린 것 ' + m.handOpen + '개');
    check('옷 바깥을 열지 않는다', m.outsideClothes === 0, m.outsideClothes + '픽셀');

    console.log('[' + rel + '] 옷 색만 바꾸기');
    const r = await page.evaluate(async (a) => {
      const T = window.__anshimTest;
      const img = await new Promise((res, j) => { const i = new Image(); i.onload = () => res(i); i.onerror = j; i.src = a.u; });
      const w = img.naturalWidth, h = img.naturalHeight;
      const clothes = await T.getClothesMask(img, 'om:' + a.u.length + ':' + a.u.slice(-40));
      const out = await T.runOutfitRecolor(img, a.target);

      const oc = document.createElement('canvas'); oc.width = w; oc.height = h;
      oc.getContext('2d').drawImage(img, 0, 0);
      const before = oc.getContext('2d').getImageData(0, 0, w, h).data;
      const after = out.getContext('2d').getImageData(0, 0, w, h).data;
      const cc = document.createElement('canvas'); cc.width = w; cc.height = h;
      cc.getContext('2d').drawImage(clothes, 0, 0, w, h);
      const cd = cc.getContext('2d').getImageData(0, 0, w, h).data;

      let outsideChanged = 0, insideChanged = 0, inside = 0;
      let lumaDiffSum = 0;
      for (let i = 0; i < before.length; i += 4) {
        const d = Math.abs(before[i] - after[i]) + Math.abs(before[i + 1] - after[i + 1])
          + Math.abs(before[i + 2] - after[i + 2]);
        const isClothes = cd[i + 3] > 128;
        if (isClothes) {
          inside++;
          if (d > 12) insideChanged++;
          // 밝기(BT.601)가 얼마나 유지되는가
          const l0 = 0.299 * before[i] + 0.587 * before[i + 1] + 0.114 * before[i + 2];
          const l1 = 0.299 * after[i] + 0.587 * after[i + 1] + 0.114 * after[i + 2];
          lumaDiffSum += Math.abs(l0 - l1);
        } else if (d > 12) outsideChanged++;
      }
      return {
        size: w + 'x' + h,
        outsideChanged,
        insideChangedPct: inside ? (insideChanged / inside * 100).toFixed(0) : '0',
        avgLumaDiff: inside ? (lumaDiffSum / inside).toFixed(1) : '0',
      };
    }, { u, target: TARGET });

    check('옷 바깥은 한 픽셀도 안 바뀐다', r.outsideChanged === 0, r.outsideChanged + '픽셀 (' + r.size + ')');
    check('옷 안쪽은 실제로 바뀐다', Number(r.insideChangedPct) > 50, '옷의 ' + r.insideChangedPct + '%');
    // 'color' 합성은 색조·채도만 바꾸고 밝기를 남긴다 — 주름·단추가 살아 있다는 뜻이다.
    // 완전히 0은 아니다(감마·반올림) 지만 평균 8 이하면 눈에는 밝기가 그대로다.
    check('밝기가 보존된다 (주름·단추가 남는다)', Number(r.avgLumaDiff) <= 8,
      '평균 밝기 차 ' + r.avgLumaDiff + '/255');
  }

  // ── 색만 고르면 사진이 밖으로 나가지 않는가 ───────────────────────────────
  // 카드를 셋에서 하나로 합치면서 얻은 것이 이것이다. 예전에는 옷 카드를 고르는 순간
  // 무조건 동의를 물었다 — 보내지도 않을 사진에 동의를 받고 있었다.
  console.log('\n색만 고를 때 (전송 없음)');
  const noSend = await page.evaluate(async () => {
    const T = window.__anshimTest;
    if (!T.selectMethodForTest) return { skip: true };
    // 진단 없이도 흐름을 타보려고 상태만 세워둔다
    T.showScreenForTest('correct');
    let apiCalls = 0;
    const realFetch = window.fetch;
    window.fetch = function (u) {
      if (String(u).indexOf('/api/') >= 0) apiCalls++;
      return realFetch.apply(this, arguments);
    };
    T.setOutfitStyleForTest('brown', 'keep');   // 색만, 마크는 그대로
    await T.selectMethodForTest('outfit');
    const modal = document.getElementById('fluxConsentModal');
    const shown = modal && getComputedStyle(modal).display !== 'none';
    window.fetch = realFetch;
    return { apiCalls, consentShown: !!shown };
  });
  if (noSend.skip) {
    check('selectMethod가 노출돼 있다', false, '노출 필요');
  } else {
    check('동의창이 뜨지 않는다', noSend.consentShown === false);
    check('API를 부르지 않는다', noSend.apiCalls === 0, noSend.apiCalls + '회');
  }

  check('콘솔 에러가 없다', errs.length === 0, errs.join(' | '));

  console.log('\n결과: ' + pass + '/' + (pass + fail) + ' 통과');
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})();
