// 아이섀도우 — 배경 교체 «간판 자리만»: 장소 글자 간판만 열고, 아이·얼굴·다른 간판·뒤 사람은 그대로 둔다
//
// 사용법: 이 폴더(test)에서 → node sign-replace.js
//   프론트가 http://localhost:8000 에서 돌고 있어야 합니다. AI 호출 없음 (비용 0) — 읽기·보정 요청을 가로채서 본다.
//
// 왜: 배경 전체를 다시 그리면 사진 분위기가 바뀐다. 아이와 장소를 잇는 것은 대개 간판 하나다.
//   모델은 글자판 자리만 알고 글자를 못 읽는다 → 상자에 번호를 그려 Claude가 «번호마다 무슨 글자인지»만 읽고,
//   위험한지는 isPlaceWord가 정한다. 읽기 결과는 사진이 아니라 문자열로 고정한다(AGENTS.md 3절).
//
// 1부(늘): 상자·읽기 결과를 숫자·문자열로 고정해 거르기·고르기·번호 그림을 본다.
// 2부(모델 파일이 있을 때만): 실제 모델 상자로 runSignReplace를 끝까지 돌려 마스크를 본다.
//   읽기 답은 상자 자리로 정한다 — 입간판 글자 자리 상자만 «햇살어린이집 / 기관명», 나머지는 «글자없음».

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';
const PHOTO = 'public/self-check/school-sign.jpg'; // 880x880 — 왼쪽 입간판 «햇살어린이집 원생 모집», 대문 간판, 오른쪽 원복 아이
const STANDEE_TEXT = { x0: 20, y0: 560, x1: 420, y1: 690 }; // 입간판 «햇살어린이집» 글자 줄
const BOXES = [
  { what: '입간판 글자 (사람 밖)', keep: true, x: 40, y: 570, width: 350, height: 100 },
  { what: '아이 전체 (얼굴을 품음)', keep: false, x: 670, y: 120, width: 210, height: 760 },
  { what: '아이 가슴 명찰 (사람 위 — 로고 지우기 몫)', keep: false, x: 785, y: 545, width: 90, height: 45 },
  { what: '사진 대부분을 덮는 상자', keep: false, x: 0, y: 0, width: 880, height: 700 },
];
// 고정 읽기 결과 → 고를지
const READS = [
  { what: '기관 이름', text: '햇살어린이집', type: '기관명', pick: true },
  { what: '못 읽은 간판', text: '(판독 불가)', type: '상호명', pick: false },
  { what: '지점 없는 프랜차이즈', text: '스타벅스', type: '상호명', pick: false },
  { what: '글자 없는 상자', text: '', type: '글자없음', pick: false },
];
const PNG1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label + (detail ? '  (' + detail + ')' : '')); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '  (' + detail + ')' : '')); }
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  let reads = null, sentRead = null, sentFill = null;
  await page.route('**/api/read-sign-boxes', (r) => {
    sentRead = r.request().postDataJSON();
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ 상자: reads || [] }) });
  });
  await page.route('**/api/inpaint-regions', (r) => {
    sentFill = r.request().postDataJSON();
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ imageBase64: PNG1, mediaType: 'image/png', width: 1, height: 1, editPrompt: 'x', timingMs: 1, estimatedCostUsd: 0, attempts: 1 }) });
  });
  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.__anshimTest && window.__anshimTest.runSignReplace));
  const u = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname, '..', PHOTO)).toString('base64');

  console.log('\n[1부] 고정 상자·고정 읽기 — ' + path.basename(PHOTO));
  const r1 = await page.evaluate(async ({ u, boxes, reads }) => {
    const T = window.__anshimTest;
    const img = new Image(); img.src = u; await img.decode();
    const W = img.naturalWidth, H = img.naturalHeight;
    const fd = await T.runFaceDetectionPipeline(u);
    const faceBoxes = fd.faces.map((q) => q.box);
    const pm = await T.getFullPersonMask(img, 'sign-test');
    const kept = T.signRectsOffPerson(boxes, faceBoxes, pm, W, H).map((b) => b.what);
    const picked = T.pickPlaceSigns(reads.map((_, i) => ({ x: i, y: 0, width: 1, height: 1 })),
      reads.map((r, i) => ({ n: i + 1, text: r.text, type: r.type }))).map((p) => p.n - 1);
    // 조각 모음(Claude에 가는 것): 얼굴 자리를 그대로 조각으로 잘라도 그 조각 가운데가 검은지 — 자르기 전에 가린다
    const big = faceBoxes.slice().sort((a, b) => b.width - a.width)[0];
    const c = T.drawCropSheet(img, fd.faces, [big]);
    const cw = c.width, d = c.getContext('2d').getImageData(0, 0, cw, c.height).data;
    // 첫 조각은 (10, 10+26)에 놓인다. 조각 둘레 15%는 얼굴 밖이니 가운데 60%만 본다.
    const s = Math.min(4, 220 / (Math.max(big.width, big.height) * 1.3)), gw = big.width * 1.3 * s, gh = big.height * 1.3 * s;
    let dark = 0, n = 0;
    for (let y = Math.round(36 + gh * 0.2); y < 36 + gh * 0.8; y += 2) for (let x = Math.round(10 + gw * 0.2); x < 10 + gw * 0.8; x += 2) { n++; const i = (y * cw + x) * 4; if (d[i] + d[i + 1] + d[i + 2] < 30) dark++; }
    return { kept, picked, faceDark: dark / n, person: !!pm };
  }, { u, boxes: BOXES, reads: READS });
  check('사람 분리가 된다', r1.person);
  BOXES.forEach((b) => check(b.what + (b.keep ? ' — 남긴다' : ' — 버린다'), r1.kept.includes(b.what) === b.keep));
  READS.forEach((r, i) => check(r.what + ' «' + r.text + '» — ' + (r.pick ? '고른다' : '고르지 않는다'), r1.picked.includes(i) === r.pick));
  check('조각 모음에서 아이 얼굴 자리는 검게 가려 보낸다 (자르기 전에 가림)', r1.faceDark > 0.95, (r1.faceDark * 100).toFixed(0) + '%');

  const has = await page.evaluate(async (url) => { try { const r = await fetch(url, { method: 'HEAD' }); return r.ok; } catch (e) { return false; } }, BASE_URL + '/public/models/mark-int8.onnx');
  if (!has) {
    console.log('\n[2부] 건너뜀 — public/models/mark-int8.onnx 가 없다(41MB, 저장소 밖). 팀자료/모델/에서 복사하면 돈다.');
  } else {
    console.log('\n[2부] 실제 모델 상자로 runSignReplace');
    const cand = await page.evaluate(async (u) => {
      const T = window.__anshimTest;
      const img = new Image(); img.src = u; await img.decode();
      const fd = await T.runFaceDetectionPipeline(u);
      const pm = await T.getFullPersonMask(img, 'sign-test');
      return T.signRectsOffPerson(await T.detectMarkBoxes(img), fd.faces.map((q) => q.box), pm, img.naturalWidth, img.naturalHeight);
    }, u);
    const inText = (b) => { const cx = b.x + b.width / 2, cy = b.y + b.height / 2; return cx > STANDEE_TEXT.x0 && cx < STANDEE_TEXT.x1 && cy > STANDEE_TEXT.y0 && cy < STANDEE_TEXT.y1; };
    reads = cand.map((b, i) => inText(b) ? { 번호: i + 1, 내용: '햇살어린이집', 유형: '기관명' } : { 번호: i + 1, 내용: '', 유형: '글자없음' });
    check('모델이 사람 밖 상자를 낸다', cand.length > 0, cand.length + '개');
    check('그중 입간판 글자 자리 상자가 있다', reads.some((r) => r.유형 === '기관명'));
    sentRead = null; sentFill = null;
    const info = await page.evaluate(async (u) => {
      const T = window.__anshimTest;
      window.__signPhoto = u;
      const img = new Image(); img.src = u; await img.decode();
      const fd = await T.runFaceDetectionPipeline(u);
      const r = await T.runSignReplace(img, fd.faces, { grade: '중' });
      return { none: !!r.none, why: r.why || '', n: (r.signs || []).length, w: img.naturalWidth, h: img.naturalHeight, faces: fd.faces.map((q) => q.box) };
    }, u);
    check('읽기 요청이 한 번 나가고 상자 수를 같이 보낸다', !!sentRead && sentRead.count === cand.length);
    check('장소 글자 간판을 골라 보정 요청이 나간다', !info.none && !!sentFill, info.none ? '멈춤: ' + info.why : info.n + '곳');
    if (sentFill) {
      const r = await page.evaluate(async ({ image, mask, info }) => {
        const T = window.__anshimTest;
        const load = (s) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = s; });
        const A = await load('data:image/png;base64,' + image), M = await load('data:image/png;base64,' + mask);
        const sw = M.naturalWidth, sh = M.naturalHeight, kx = sw / info.w, ky = sh / info.h;
        const read = (im) => { const c = document.createElement('canvas'); c.width = sw; c.height = sh; const x = c.getContext('2d'); x.drawImage(im, 0, 0, sw, sh); return x.getImageData(0, 0, sw, sh).data; };
        const m = read(M), a = read(A);
        const on = (p) => m[(Math.round(p.y * ky) * sw + Math.round(p.x * kx)) * 4] > 128;
        let opened = 0, gray = 0;
        for (let i = 0; i < m.length; i += 4) { if (m[i] > 128) opened++; if (m[i] > 10 && m[i] < 245) gray++; }
        let faceOpen = 0;
        info.faces.forEach((b) => {
          for (let y = Math.ceil(b.y * ky); y < Math.floor((b.y + b.height) * ky); y += 2)
            for (let x = Math.ceil(b.x * kx); x < Math.floor((b.x + b.width) * kx); x += 2) if (m[(y * sw + x) * 4] > 128) faceOpen++;
        });
        // 주인공 아이(사람 분리) 위에서 열린 픽셀
        const orig = new Image(); orig.src = window.__signPhoto; await orig.decode();
        const pm = await T.getFullPersonMask(orig, 'sign-test');
        const pc = document.createElement('canvas'); pc.width = sw; pc.height = sh; const px = pc.getContext('2d'); px.drawImage(pm, 0, 0, sw, sh);
        const pd = px.getImageData(0, 0, sw, sh).data;
        let personOpen = 0;
        for (let i = 0; i < m.length; i += 4) if (pd[i + 3] > 0 && m[i] > 128) personOpen++;
        // 입간판 글자 자리를 미리 칠했는지: 열린 자리 색이 고르다(글자 획이 남아 있으면 검은 픽셀이 섞인다)
        // 같은 자리 원본의 어두운 획 비율도 잰다 — 원본에도 없으면 이 검사는 아무것도 재지 않는다
        const o = read(orig);
        let lo = 0, loOrig = 0, cnt = 0;
        for (let i = 0; i < m.length; i += 4) if (m[i] > 128) { cnt++; if (a[i] + a[i + 1] + a[i + 2] < 200) lo++; if (o[i] + o[i + 1] + o[i + 2] < 200) loOrig++; }
        return { darkOrig: cnt ? loOrig / cnt : 0, faceOpen, personOpen, gray, openPct: (opened / (sw * sh) * 100).toFixed(1),
          text: on({ x: 200, y: 620 }), gate: on({ x: 610, y: 255 }), crowd: on({ x: 480, y: 500 }), kidBody: on({ x: 780, y: 700 }),
          darkInOpen: cnt ? lo / cnt : 1 };
      }, { image: sentFill.imageBase64, mask: sentFill.maskBase64, info });
      check('얼굴은 0픽셀 열린다', r.faceOpen === 0, r.faceOpen + 'px');
      check('주인공 아이 몸은 0픽셀 열린다', r.personOpen === 0, r.personOpen + 'px');
      check('마스크는 흑백뿐 (경계가 회색으로 반쯤 열리지 않는다)', r.gray === 0, r.gray + 'px');
      check('입간판 «햇살어린이집» 글자 자리는 연다', r.text);
      check('고르지 않은 대문 간판은 열지 않는다', !r.gate);
      check('뒤에 선 사람은 열지 않는다 (글자없음)', !r.crowd);
      check('아이 원복은 열지 않는다', !r.kidBody);
      check('배경 전체가 아니라 좁게 연다 (사진의 10% 미만)', Number(r.openPct) < 10, r.openPct + '%');
      check('연 자리는 간판 바탕색으로 미리 칠해 보낸다 (원본에 있던 어두운 글자 획이 2% 미만으로)', r.darkOrig > 0.05 && r.darkInOpen < 0.02,
        '원본 ' + (r.darkOrig * 100).toFixed(1) + '% → 보낸 사진 ' + (r.darkInOpen * 100).toFixed(1) + '%');
      check('보정 지시는 빈 간판이다 (글자를 새로 쓰게 하지 않는다)', /blank signboard/.test(sentFill.promptOverride || ''), (sentFill.promptOverride || '').slice(0, 40));
    }
    console.log('\n[2부-2] 장소 글자가 하나도 없으면 보정 요청을 보내지 않는다(배경 전체로 넘어갈 수 있게)');
    reads = cand.map((b, i) => ({ 번호: i + 1, 내용: '', 유형: '글자없음' }));
    sentFill = null;
    const none = await page.evaluate(async (u) => {
      const T = window.__anshimTest;
      const img = new Image(); img.src = u; await img.decode();
      const fd = await T.runFaceDetectionPipeline(u);
      const r = await T.runSignReplace(img, fd.faces, { grade: '중' });
      return { none: !!r.none, why: r.why || '' };
    }, u);
    check('«고칠 간판 없음»으로 멈춘다', none.none && none.why === 'noplace', none.why);
    check('보정 요청이 나가지 않는다 (돈이 안 든다)', !sentFill);
  }

  check('페이지 에러 없음', errs.length === 0, errs.join(' | '));
  await browser.close();
  console.log('\n' + pass + '개 통과, ' + fail + '개 실패');
  if (fail > 0) process.exitCode = 1;
})();
