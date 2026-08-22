// 인물 분할(누끼) — 배경 흐림과 AI 배경교체가 쓰는 픽셀 단위 사람 마스크
//
// 예전에는 얼굴 상자에서 유추한 타원(폭 3.2배 x 높이 7배)으로 사람을 덮었다.
// 팔을 벌리면 팔이 잘리고 사람 주변 배경이 통째로 선명하게 남았다.
// 지금은 브라우저 안에서 도는 분할 모델이 사람 윤곽을 픽셀 단위로 갈라낸다.
const { chromium } = require('playwright');

const PHOTO = 'childphoto.jpeg'; // 로컬에서만 쓰는 실사진. 분할은 브라우저 안에서 돌아 밖으로 나가지 않는다.

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1000, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  // TFLite가 정보 로그를 error 채널로 뱉는다 — 진짜 오류만 센다
  p.on('console', m => {
    if (m.type() === 'error' && !/XNNPACK|INFO:|Created TensorFlow/.test(m.text())) errs.push(m.text());
  });

  await p.goto('http://localhost:8000/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(1200);

  const r = await p.evaluate(async (photo) => {
    const T = window.__anshimTest;
    const img = new Image();
    img.src = photo;
    await img.decode();

    const t0 = performance.now();
    const mask = await T.getPersonMask(img, 'key-1');
    const coldMs = Math.round(performance.now() - t0);
    if (!mask) return { got: false };

    const md = mask.getContext('2d').getImageData(0, 0, mask.width, mask.height).data;
    let on = 0;
    for (let i = 3; i < md.length; i += 4) if (md[i] > 128) on++;

    // 캐시
    const t1 = performance.now();
    await T.getPersonMask(img, 'key-1');
    const cachedMs = Math.round(performance.now() - t1);
    // 다른 사진(키가 다르면) 다시 계산해야 한다
    T.clearPersonMaskCache();
    const t2 = performance.now();
    const again = await T.getPersonMask(img, 'key-2');
    const recalcMs = Math.round(performance.now() - t2);

    // 마스크 안/밖 표본 지점
    const sx = mask.width;
    const at = (x, y) => md[((y * sx) + x) * 4 + 3] > 128;
    let inPt = null, outPt = null;
    for (let y = 12; y < mask.height - 12 && (!inPt || !outPt); y += 7) {
      for (let x = 12; x < mask.width - 12; x += 7) {
        if (!inPt && at(x, y)) inPt = [x, y];
        if (!outPt && !at(x, y)) outPt = [x, y];
      }
    }

    const W = img.naturalWidth, H = img.naturalHeight;
    const orig = document.createElement('canvas');
    orig.width = W; orig.height = H;
    orig.getContext('2d').drawImage(img, 0, 0);
    const octx = orig.getContext('2d');

    const meanDiff = (cv, pt) => {
      const a = cv.getContext('2d').getImageData(pt[0], pt[1], 9, 9).data;
      const c = octx.getImageData(pt[0], pt[1], 9, 9).data;
      let d = 0;
      for (let i = 0; i < a.length; i += 4) {
        d += Math.abs(a[i] - c[i]) + Math.abs(a[i + 1] - c[i + 1]) + Math.abs(a[i + 2] - c[i + 2]);
      }
      return Math.round(d / (a.length / 4));
    };

    // 1) 마스크를 쓴 배경 흐림
    const withMask = T.applyBackgroundBlur(img, [], W, H, 18, mask);
    // 2) 마스크 없이 얼굴도 없으면 전체가 흐려져야 한다(예전 폴백)
    const noMask = T.applyBackgroundBlur(img, [], W, H, 18, null);

    // 3) AI 배경교체 인물 보호 — 배경을 빨갛게 칠한 가짜 결과에 인물만 되돌린다
    const fake = document.createElement('canvas');
    fake.width = W; fake.height = H;
    const fctx = fake.getContext('2d');
    fctx.fillStyle = '#ff0000';
    fctx.fillRect(0, 0, W, H);
    T.restorePersonFromOriginal(fake, img, [], W, H, mask);
    const isRed = (pt) => {
      const d = fake.getContext('2d').getImageData(pt[0], pt[1], 5, 5).data;
      let red = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 80 && d[i + 2] < 80) red++;
      return red / (d.length / 4);
    };

    return {
      got: true, coldMs, cachedMs, recalcMs,
      maskW: mask.width, maskH: mask.height, imgW: W, imgH: H,
      personPct: +(on / (mask.width * mask.height) * 100).toFixed(1),
      againSame: !!again,
      inside: meanDiff(withMask, inPt), outside: meanDiff(withMask, outPt),
      noMaskInside: meanDiff(noMask, inPt), noMaskOutside: meanDiff(noMask, outPt),
      restoredPersonRed: +isRed(inPt).toFixed(2),
      restoredBgRed: +isRed(outPt).toFixed(2),
    };
  }, PHOTO);

  check('사람 마스크를 만들어낸다', r.got);
  if (!r.got) {
    console.log('\n결과: ' + pass + '/' + (pass + fail) + ' 통과');
    await b.close();
    process.exit(1);
  }

  check('마스크 크기가 사진과 같다', r.maskW === r.imgW && r.maskH === r.imgH,
    r.maskW + 'x' + r.maskH + ' vs ' + r.imgW + 'x' + r.imgH);
  check('사람 비율이 그럴듯하다 (2~95%)', r.personPct > 2 && r.personPct < 95, r.personPct + '%');

  // 핵심: 사람은 선명하고 배경은 흐리다
  check('마스크를 쓰면 사람이 원본만큼 선명하다', r.inside < 12, '차이 ' + r.inside);
  check('마스크를 쓰면 배경은 확실히 흐려진다', r.outside > 25, '차이 ' + r.outside);
  check('사람과 배경의 차이가 뚜렷하다', r.outside > r.inside * 4,
    '안 ' + r.inside + ' vs 밖 ' + r.outside);

  // 마스크가 없으면 예전대로 전체 흐림
  check('마스크도 얼굴도 없으면 사람까지 흐려진다(폴백)', r.noMaskInside > 20, '차이 ' + r.noMaskInside);

  // AI 배경교체 인물 보호
  check('AI 결과에서 사람은 원본으로 되돌아온다', r.restoredPersonRed < 0.1, '빨강 비율 ' + r.restoredPersonRed);
  check('AI 결과에서 배경은 그대로 둔다', r.restoredBgRed > 0.9, '빨강 비율 ' + r.restoredBgRed);

  // 캐시
  check('같은 사진은 다시 계산하지 않는다', r.cachedMs < 20, r.cachedMs + 'ms');
  check('캐시를 비우면 다시 계산한다', r.recalcMs > 20 && r.againSame, r.recalcMs + 'ms');
  check('모델을 처음 받는 데 10초를 넘지 않는다', r.coldMs < 10000, r.coldMs + 'ms');

  check('페이지 에러 없음', errs.length === 0, errs.slice(0, 2).join(' / '));

  console.log('\n  (참고) 첫 계산 ' + r.coldMs + 'ms · 캐시 ' + r.cachedMs + 'ms · 재계산 ' + r.recalcMs + 'ms'
    + ' · 사람 ' + r.personPct + '%');
  console.log('\n결과: ' + pass + '/' + (pass + fail) + ' 통과');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
