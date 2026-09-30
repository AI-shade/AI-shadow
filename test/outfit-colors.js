/*
 * 옷 색을 사진에서 읽어 색 이름으로 프롬프트에 적기 — 「색 안 바꾸기」 검사.
 *
 * 배경: 예전 「색 안 바꾸기」 프롬프트는 "keeping the exact same colors as the garment already worn"이었다.
 * 인페인팅 모델은 마스크로 비운 자리의 원래 픽셀을 못 보므로 이 문장은 색을 추측으로 흘렸다.
 * 이제 브라우저가 옷 색을 읽어 «forest green top, navy bottoms»처럼 이름으로 적는다.
 * 아이가 여럿이면 사람마다 따로 읽어 왼쪽부터 적는다. 부정문·«uniform» 낱말은 넣지 않는다(적으면 그 물체를 불러온다).
 *
 * 사용법: 이 폴더(test)에서 → node outfit-colors.js   (프런트가 8000 또는 BASE_URL에서 돌고 있어야 함)
 * 합성 사진만 쓴다 — AI·네트워크 호출 없음(비용 0).
 */
const { chromium } = require('playwright');
const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(800);
  const run = (fn, arg) => page.evaluate(fn, arg);

  // ── 색 이름 ──
  console.log('색 이름 고르기 (CIELAB 가장 가까운 이름)');
  const 이름표 = await run(() => {
    const T = window.__anshimTest;
    return [
      [[250, 250, 250], 'white'], [[10, 10, 10], 'black'], [[255, 200, 215], 'pink'], [[120, 190, 240], 'sky blue'],
      [[30, 40, 90], 'navy'], [[100, 70, 40], 'brown'], [[200, 40, 40], 'red'], [[60, 155, 80], 'green'],
      [[36, 80, 58], 'forest green'], [[140, 142, 148], 'gray'], [[64, 66, 72], 'charcoal gray'], [[242, 213, 60], 'yellow'],
      [[239, 123, 42], 'orange'], [[123, 63, 160], 'purple'], [[62, 42, 30], 'dark brown'], [[217, 195, 160], 'beige'],
    ].map(([rgb, want]) => [rgb.join(','), want, T.nameColor(rgb).en]);
  });
  for (const [rgb, want, got] of 이름표) ok(got === want, `rgb(${rgb}) → ${want}`, got === want ? '' : '나온 이름: ' + got);

  // ── 사람마다 읽기 ──
  console.log('\n사람마다 상의·하의 색을 읽는다');
  const 합성 = await run(() => {
    const T = window.__anshimTest;
    const W = 640, H = 480;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = 'rgb(210,200,190)'; x.fillRect(0, 0, W, H);
    const mask = document.createElement('canvas'); mask.width = W; mask.height = H;
    const m = mask.getContext('2d');
    const rect = (col, x0, y0, x1, y1) => { x.fillStyle = col; x.fillRect(x0, y0, x1 - x0, y1 - y0); m.fillStyle = '#fff'; m.fillRect(x0, y0, x1 - x0, y1 - y0); };
    // 왼쪽 아이: 초록 상의(가슴에 흰 로고) + 남색 하의 / 오른쪽 아이: 빨강 상의 + 회색 하의. 얼굴 높이 80.
    rect('#3E9B4F', 110, 150, 260, 270); x.fillStyle = '#fff'; x.fillRect(170, 190, 22, 22);
    rect('#1F2A55', 120, 330, 250, 430);
    rect('#C62828', 380, 150, 530, 270);
    rect('#8E9095', 390, 330, 520, 430);
    const faces = [
      { box: { x: 420, y: 60, width: 70, height: 80 } },   // 일부러 오른쪽을 먼저 넣는다 — 왼쪽부터 정렬되어야 한다
      { box: { x: 150, y: 60, width: 70, height: 80 } },
    ];
    const img = c;
    const two = T.describeOutfitColors(img, faces, mask);
    const one = T.describeOutfitColors(img, [faces[1]], mask);
    // 상체만 나온 사진: 하의 띠에 옷이 없다
    const half = document.createElement('canvas'); half.width = W; half.height = H;
    const hx = half.getContext('2d'); hx.drawImage(c, 0, 0);
    const hm = document.createElement('canvas'); hm.width = W; hm.height = H;
    const hmx = hm.getContext('2d'); hmx.fillStyle = '#fff'; hmx.fillRect(110, 150, 150, 120);
    const topOnly = T.describeOutfitColors(half, [faces[1]], hm);
    return {
      twoMissing: two && two.missing, oneMissing: one && one.missing,
      two: two && two.map((p) => ({ x: Math.round(p.x * 100), top: p.top.en, bottom: p.bottom && p.bottom.en })),
      one: one && one.map((p) => ({ top: p.top.en, bottom: p.bottom && p.bottom.en })),
      topOnly: topOnly && topOnly.map((p) => ({ top: p.top.en, bottom: p.bottom })),
      ghostFace: (() => { const r = T.describeOutfitColors(img, [faces[0], { box: { x: 20, y: 60, width: 40, height: 40 } }, faces[1]], mask); return r && { n: r.length, missing: r.missing, ranks: r.map((q) => q.rank).join() }; })(),
      faceless: (() => {
        // 얼굴이 안 잡힌 사람의 옷(마스크에는 들어 있다): 어떤 얼굴 밑에도 없는 옷이 15%를 넘으면 알려야 한다
        const m2 = document.createElement('canvas'); m2.width = 640; m2.height = 480;
        const m2x = m2.getContext('2d'); m2x.fillStyle = '#fff';
        m2x.fillRect(110, 150, 150, 120); m2x.fillRect(120, 330, 130, 100); m2x.fillRect(565, 150, 60, 280); // 왼쪽 아이 + 얼굴 없는 사람
        const r = T.describeOutfitColors(img, [faces[1]], m2); return r && { n: r.length, missing: r.missing };
      })(),
      cutBottom: (() => {
        // 사진이 가슴 아래에서 잘렸고 맨 아래에 그림자 몇 줄만 걸친다 — 하의를 지어내면 안 된다
        const cc = document.createElement('canvas'); cc.width = 640; cc.height = 330;
        const cx = cc.getContext('2d'); cx.drawImage(c, 0, 0);
        cx.fillStyle = '#111'; cx.fillRect(100, 322, 160, 8);
        const mm = document.createElement('canvas'); mm.width = 640; mm.height = 330;
        const mmx = mm.getContext('2d'); mmx.fillStyle = '#fff'; mmx.fillRect(110, 150, 150, 120); mmx.fillRect(100, 322, 160, 8);
        const r = T.describeOutfitColors(cc, [faces[1]], mm); return r && { top: r[0].top.en, bottom: r[0].bottom };
      })(),
      none: T.describeOutfitColors(img, [], mask), noMask: T.describeOutfitColors(img, faces, null),
      noShoulder: T.describeOutfitColors(img, [{ box: { x: 5, y: 400, width: 30, height: 30 } }], mask),
    };
  });
  ok(합성.two && 합성.two.length === 2, '두 아이를 따로 읽는다', JSON.stringify(합성.two));
  ok(합성.two && 합성.two[0].top === 'green' && 합성.two[0].bottom === 'navy', '왼쪽 아이: 초록 상의 · 남색 하의 (얼굴 목록 순서와 상관없이 왼쪽부터)', JSON.stringify(합성.two && 합성.two[0]));
  ok(합성.two && 합성.two[1].top === 'red' && 합성.two[1].bottom === 'gray', '오른쪽 아이: 빨강 상의 · 회색 하의', JSON.stringify(합성.two && 합성.two[1]));
  ok(합성.one && 합성.one[0].top === 'green', '가슴의 작은 흰 로고에 끌리지 않는다 (중앙값) — 상의는 그대로 초록', JSON.stringify(합성.one));
  ok(합성.topOnly && 합성.topOnly[0].top === 'green' && 합성.topOnly[0].bottom === null, '하의가 사진에 없으면 하의 색을 지어내지 않는다', JSON.stringify(합성.topOnly));
  ok(합성.ghostFace && 합성.ghostFace.n === 2 && 합성.ghostFace.missing === 0 && 합성.ghostFace.ranks === '0,1', '옷이 안 잡히는 얼굴(배경 그림·오탐)은 사람으로 세지 않는다 — 순서가 어긋나지 않는다', JSON.stringify(합성.ghostFace));
  ok(합성.faceless && 합성.faceless.n === 1 && 합성.faceless.missing === 1, '얼굴이 안 잡힌 사람의 옷이 마스크의 15%를 넘으면 «그 밖의 옷»이 있다고 알린다 (안 그러면 그 옷까지 아이 색으로 칠해진다)', JSON.stringify(합성.faceless));
  ok(합성.twoMissing === 0, '얼굴마다 옷이 다 읽히면 «그 밖의 옷»은 없다');
  ok(합성.oneMissing === 1, '얼굴이 한 명만 잡히면 다른 아이의 옷은 «그 밖의 옷»이다 (마스크에는 그 옷도 들어 있다)');
  ok(합성.cutBottom && 합성.cutBottom.top === 'green' && 합성.cutBottom.bottom === null, '사진이 잘려 하의 띠가 사진 밖이면 맨 아래 그림자로 하의 색을 지어내지 않는다', JSON.stringify(합성.cutBottom));
  ok(합성.none === null && 합성.noMask === null, '얼굴이 없거나 옷 마스크가 없으면 null (호출부가 예전 문구로 간다)');
  ok(합성.noShoulder === null, '옷이 안 잡히는 사람은 건너뛴다(색을 지어내지 않는다)');

  // ── 프롬프트 ──
  console.log('\n프롬프트 문구');
  const 프롬프트 = await run(() => {
    const T = window.__anshimTest;
    const nm = (a) => T.nameColor(a);
    const one = [{ rank: 0, x: 0.3, top: nm([62, 155, 79]), bottom: nm([31, 42, 85]) }];
    one.missing = 0;
    const two = [one[0], { rank: 1, x: 0.7, top: nm([198, 40, 40]), bottom: nm([142, 144, 149]) }];
    two.missing = 0;
    const noBottom = [{ rank: 0, x: 0.3, top: nm([62, 155, 79]), bottom: null }];
    noBottom.missing = 0;
    // 두 번째 사람만 읽고 첫 번째는 못 읽은 경우 — 순서는 얼굴 전체 기준이어야 한다
    const partial = [{ rank: 1, x: 0.7, top: nm([198, 40, 40]), bottom: null }];
    partial.missing = 1;
    return {
      one: T.buildOutfitFillPrompt('keep', 'none', one),
      onePocket: T.buildOutfitFillPrompt('keep', 'pocket', one),
      two: T.buildOutfitFillPrompt('keep', 'none', two),
      noBottom: T.buildOutfitFillPrompt('keep', 'none', noBottom),
      partial: T.buildOutfitFillPrompt('keep', 'none', partial),
      partialKo: T.outfitColorsKo(partial),
      fallback: T.buildOutfitFillPrompt('keep', 'none', null),
      fallbackEmpty: T.buildOutfitFillPrompt('keep', 'none', []),
      brown: T.buildOutfitFillPrompt('brown', 'none', one),
      brownNoColors: T.buildOutfitFillPrompt('brown', 'none'),
      ko: [T.outfitColorsKo(one), T.outfitColorsKo(two)],
    };
  });
  const 금지어 = /\b(no|not|uniform|logo|logos|badge|badges|crest|emblem|lettering|illustration)\b/i;
  ok(/plain solid green crew-neck top and plain solid navy bottoms/.test(프롬프트.one), '한 명: «green crew-neck top and navy bottoms»로 색 이름을 적는다', 프롬프트.one.slice(0, 90) + '…');
  ok(!금지어.test(프롬프트.one) && !금지어.test(프롬프트.two), '읽은 색 프롬프트에는 부정문·uniform·logo 낱말이 없다 (적으면 그 물체를 불러온다)');
  ok(!/keeping the exact same colors|already worn/.test(프롬프트.one), '모델이 볼 수 없는 «원래 옷»을 가리키는 문장이 없다');
  ok(/first person from the left wears a plain solid green top and plain solid navy bottoms; the second person from the left wears a plain solid red top and plain solid gray bottoms/.test(프롬프트.two),
    '두 명: 왼쪽부터 «first / second person from the left»로 각자의 색을 적는다', 프롬프트.two.slice(0, 120) + '…');
  ok(/every top a plain cotton crew-neck/.test(프롬프트.two), '두 명이어도 상의는 crew-neck이라고 말한다');
  ok(/the second person from the left wears a plain solid red top/.test(프롬프트.partial) && /everyone else wears plain solid muted cotton clothes/.test(프롬프트.partial) && !/A plain solid red crew-neck/.test(프롬프트.partial),
    '일부만 읽었으면 «몇 번째 사람»을 얼굴 전체 기준으로 말하고, 나머지는 무난한 색으로 둔다', 프롬프트.partial.slice(0, 150) + '…');
  ok(/2번째\(왼쪽부터\) 상의 빨강/.test(프롬프트.partialKo) && /그 밖의 옷은 색을 못 읽어/.test(프롬프트.partialKo), '화면 안내에도 못 읽은 사람을 밝힌다', 프롬프트.partialKo);
  ok(!/bottoms/.test(프롬프트.noBottom), '하의를 못 읽었으면 하의를 말하지 않는다', 프롬프트.noBottom.slice(0, 80));
  ok(/small plain patch pocket on the chest/.test(프롬프트.onePocket) && !/small plain patch pocket/.test(프롬프트.one), '포켓 선택일 때만 가슴 포켓을 말한다(긍정 서술로)');
  ok(/muted natural colors/.test(프롬프트.fallback) && 프롬프트.fallback === 프롬프트.fallbackEmpty && !금지어.test(프롬프트.fallback), '색을 못 읽었으면 «무난한 색»으로 간다 — 모델이 볼 수 없는 원래 색을 지키라고 하지 않는다 (기능은 끊기지 않는다)');
  ok(프롬프트.brown === 프롬프트.brownNoColors && /warm taupe brown/.test(프롬프트.brown), '색을 바꾸는 선택(오트밀 등)은 읽은 색과 상관없이 그대로다');
  ok(프롬프트.ko[0] === '상의 초록 · 하의 남색' && /1번째\(왼쪽부터\) 상의 초록 · 하의 남색, 2번째\(왼쪽부터\) 상의 빨강 · 하의 회색/.test(프롬프트.ko[1]), '화면에는 한국어 색 이름으로 알린다', 프롬프트.ko.join(' / '));

  // ── 하의 모양(치마·반바지·긴바지) ──
  // «bottoms»라고만 하면 모델이 치마를 반바지로 그렸다(A/B 실측, 아이3). 밑단 폭을 그 아래 맨다리 폭과 비교해 구별한다:
  // 치마 자락은 다리보다 훨씬 넓고, 반바지는 다리와 폭이 비슷하고, 사진 끝까지 이어지면(맨다리가 안 보이면) 긴바지다.
  console.log('\n하의 모양 판별 (밑단 폭 vs 맨다리 폭)');
  const 하의 = await run(() => {
    const T = window.__anshimTest;
    const W = 640, H = 600;
    const face = { box: { x: 150, y: 60, width: 80, height: 80 } }; // cx=190, shoulder밴드 y=132부터
    const img = (() => { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); x.fillStyle = '#3E9B4F'; x.fillRect(0, 0, W, H); return c; })();
    function build(clothesRects, skinRects) {
      const mask = document.createElement('canvas'); mask.width = W; mask.height = H;
      const mx = mask.getContext('2d'); mx.fillStyle = '#fff';
      for (const [x0, y0, x1, y1] of clothesRects) mx.fillRect(x0, y0, x1 - x0, y1 - y0);
      const skin = document.createElement('canvas'); skin.width = W; skin.height = H;
      const sx = skin.getContext('2d'); sx.fillStyle = '#fff';
      for (const [x0, y0, x1, y1] of (skinRects || [])) sx.fillRect(x0, y0, x1 - x0, y1 - y0);
      mask._skin = skin;
      return mask;
    }
    // 치마: 밑단(y 300~430, x 110~270 → 폭 160)이 그 아래 맨다리(x 145~235 → 폭 90)보다 훨씬 넓다
    const skirtMask = build([[140, 135, 240, 300], [110, 300, 270, 430]], [[172, 453, 208, 560]]);
    // 반바지: 밑단(y 300~430, x 150~230 → 폭 80)이 맨다리(x 145~235 → 폭 90)와 비슷하다
    const shortsMask = build([[140, 135, 240, 300], [150, 300, 230, 430]], [[145, 453, 235, 560]]);
    // 긴바지: 옷이 사진 맨 아래까지 이어져 맨다리가 안 보인다
    const trousersMask = build([[140, 135, 240, 599]], []);
    // 밑단은 있다(사진 맨 아래까지 이어지지 않는다) — 그런데 그 아래에 맨다리가 전혀 안 잡힌다.
    // 긴바지일 수도 있지만 다른 이유(각도·그림자·인식 실패)도 있어 단정할 근거가 아니다.
    const noLegMask = build([[140, 135, 240, 300], [110, 300, 270, 430]], []);
    const one = (mask) => { const r = T.describeOutfitColors(img, [face], mask); return r && r[0].bottomKind; };
    return { skirt: one(skirtMask), shorts: one(shortsMask), trousers: one(trousersMask), noLeg: one(noLegMask) };
  });
  ok(하의.skirt === 'skirt', '밑단이 맨다리보다 1.3배 넘게 넓으면 치마', JSON.stringify(하의));
  ok(하의.shorts === 'shorts', '밑단이 맨다리와 폭이 비슷하면 반바지', JSON.stringify(하의));
  ok(하의.trousers === 'trousers', '옷이 사진 끝까지 이어지고 얼굴 높이의 3배가 넘으면 긴바지', JSON.stringify(하의));
  ok(하의.noLeg === null, '밑단은 있는데 그 아래 맨다리가 안 보이면 긴바지로 단정하지 않는다(null → 예전처럼 «bottoms»)', JSON.stringify(하의));

  // ── 폭 재기: 옆 아이 몸까지 안 번진다 ──
  // runWidthAt은 자리(x0~x1) 안에서 씨앗을 찾은 뒤 양옆으로 번져 폭을 잰다. 옆 아이 옷이 픽셀로 맞닿아 있으면
  // (예: 어깨를 나란히 함) 번짐이 안 끊기므로, 잰 자리를 안 막으면 옆 아이 몸까지 폭에 잡힌다
  // (실측: medianClothesColor에서 이미 겪은 문제 — 거기는 애초에 띠를 좁혀서 막았다).
  console.log('\n폭 재기 — 잰 자리 밖으로 번지지 않는다');
  const 폭번짐 = await run(() => {
    const T = window.__anshimTest;
    const W = 640, H = 10;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'); x.fillStyle = '#fff';
    x.fillRect(150, 0, 90, H); // 이 아이의 몸: x 150~239
    x.fillRect(240, 0, 300, H); // 맞닿은 옆 아이 몸: x 240~539 (틈 없음)
    const data = x.getImageData(0, 0, W, H).data;
    return {
      band: T.runWidthAt(data, W, 110, 270, 5, 190), // 이 아이 자리(±80)로 좁혀 잰다
      noBand: T.runWidthAt(data, W, 0, 639, 5, 190), // 비교용: 자리를 안 좁히면 옆 아이까지 다 잡힌다
    };
  });
  ok(폭번짐.band <= 270 - 110 + 1, '옆 아이 몸과 맞닿아도 잰 자리(110~270) 밖으로는 안 나간다', JSON.stringify(폭번짐));
  ok(폭번짐.noBand > 폭번짐.band, '자리를 넓게 주면(비교용) 그만큼 옆 아이 몸이 더 잡힌다 — 자리를 좁히는 것 자체가 방어임을 보여준다', JSON.stringify(폭번짐));

  // ── 프롬프트: 사람마다 하의 모양이 다르면 각자 말하고, 같으면 한 번만 말한다 ──
  console.log('\n프롬프트: 치마/반바지 반영');
  const 하의프롬프트 = await run(() => {
    const T = window.__anshimTest;
    const diff = [{ rank: 0, bottomKind: 'skirt' }, { rank: 1, bottomKind: 'shorts' }]; diff.missing = 0;
    const same = [{ rank: 0, bottomKind: 'skirt' }, { rank: 1, bottomKind: 'skirt' }]; same.missing = 0;
    const unknown = [{ rank: 0, bottomKind: null }]; unknown.missing = 0;
    return {
      diff: T.buildOutfitFillPrompt('brown', 'none', diff),
      same: T.buildOutfitFillPrompt('brown', 'none', same),
      unknown: T.buildOutfitFillPrompt('brown', 'none', unknown),
    };
  });
  ok(/the first person from the left with plain solid dark chocolate brown skirt/.test(하의프롬프트.diff) && /the second person from the left with plain solid dark chocolate brown shorts/.test(하의프롬프트.diff),
    '하의 모양이 사람마다 다르면 왼쪽부터 각자의 모양을 말한다', 하의프롬프트.diff);
  ok(/plain solid dark chocolate brown skirt\./.test(하의프롬프트.same), '모두 같은 모양이면 한 번만 말한다(치마)', 하의프롬프트.same);
  ok(/plain solid dark chocolate brown bottoms\./.test(하의프롬프트.unknown), '모양을 못 읽었으면 예전처럼 «bottoms»로 뭉뚱그린다', 하의프롬프트.unknown);

  // ── 모든 옷 프롬프트 감사 ──
  console.log('\n옷 프롬프트 전수 검사 (색 4종 × 마크 2종 + 색 그대로 + 가슴 마크 지우기 2종)');
  const 전수 = await run(() => {
    const T = window.__anshimTest;
    const all = {};
    for (const cw of T.colorwaysForTest()) for (const em of ['none', 'pocket']) all[`${cw}/${em}`] = T.buildOutfitFillPrompt(cw, em);
    const e = T.emblemPromptsForTest();
    all['마크지우기/그냥'] = e.fill; all['마크지우기/포켓'] = e.pocket;
    return all;
  });
  const 이름들 = Object.keys(전수);
  const 나쁜말 = /\b(no|not|without|never|don't|uniform|logo|logos|badge|badges|crest|emblem|lettering|insignia|illustration|school|kindergarten|institution)\b|#[0-9a-f]{6}/i;
  const 걸린 = 이름들.filter((k) => 나쁜말.test(전수[k]));
  ok(이름들.length === 12, '검사 대상은 12개다', 이름들.length + '개');
  ok(걸린.length === 0, '어느 프롬프트에도 부정문·교복·로고 낱말·헥스 코드가 없다 (적으면 그 물체를 불러온다)', 걸린.map((k) => k + ': ' + (전수[k].match(나쁜말) || [''])[0]).join(', '));
  ok(이름들.filter((k) => !/^마크지우기/.test(k)).every((k) => /crew-neck top and plain solid (.+ )?bottoms/.test(전수[k])), '옷 프롬프트는 구체적인 옷 이름(crew-neck top)과 하의를 색 이름으로 적는다');
  ok(!이름들.some((k) => /trim|plaid|pleated|whichever|already worn|original|dyed/.test(전수[k])), '배색 띠·격자·«원래 옷처럼» 같은 표현이 없다 (모델이 볼 수 없는 것·교복 배색과 닮은 것)');
  ok(전수['brown/none'].includes('warm taupe brown') && 전수['brown/none'].includes('dark chocolate brown') && 전수['navy/none'].includes('sky blue') && 전수['navy/none'].includes('navy'), '색 바꾸기는 색 이름으로 지정한다(토프/브라운, 스카이/네이비)');
  ok(이름들.filter((k) => /\/none$/.test(k)).every((k) => !/pocket/.test(전수[k])) && 이름들.filter((k) => /\/pocket$/.test(k) && !/^마크/.test(k)).every((k) => /small plain patch pocket on the chest in the same fabric/.test(전수[k])), '포켓은 고른 경우에만, 긍정 서술로 들어간다');
  ok(/exactly the same colour and texture as the surrounding garment/.test(전수['마크지우기/그냥']) && /exactly the same fabric colour and texture as the surrounding garment/.test(전수['마크지우기/포켓']), '마크 지우기는 «주변 천과 똑같이»를 앞세운다 (주변은 모델이 볼 수 있다)');

  ok(errs.length === 0, '페이지 에러 없음', errs.join(' | '));
  await browser.close();
  console.log(`\n${pass}개 통과, ${fail}개 실패`);
  process.exit(fail ? 1 : 0);
})();
