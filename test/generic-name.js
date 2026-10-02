/*
 * 기관 이름 → 일반 이름 바꿔 쓰기(applyPatchFill 자동 모드) 검사.
 *
 * 「햇살어린이집」처럼 기관 이름이 잡히면 모자이크·색으로 덮는 대신 그 자리에 「어린이집」이라고 다시 쓴다.
 * 핵심 기준 두 가지:
 *   1) 원래 이름의 글자가 **남지 않는다** — 새 글자(4자)가 원래(6자)보다 짧아서 좌우에 생기는 빈자리에
 *      원래 글자의 흔적이 없어야 한다.
 *   2) 새 글자가 **실제로 그려진다**.
 * 사용자가 주변색·모자이크를 직접 고르면 예전처럼 덮어야 하고, 바꿀 수 없는 글자(전화번호 등)도 그렇다.
 *
 * 사용법: 이 폴더(test)에서 → node generic-name.js   (프런트가 8000 또는 BASE_URL에서 돌고 있어야 함)
 * AI 호출 없음(비용 0).
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

  // 페이지 안에서 쓸 도구 — 간판 사진을 만들고, 글자 상자를 재고, 픽셀을 센다
  await page.evaluate(() => {
    window.__t = {
      // W x H 캔버스에 배경(단색 또는 좌→우 그러데이션)을 깔고 글자를 쓴다. 글자 상자(퍼센트)를 돌려준다.
      make(W, H, bg, text, ink, opt = {}) {
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const x = c.getContext('2d');
        if (Array.isArray(bg[0])) {
          const g = x.createLinearGradient(0, 0, W, 0);
          g.addColorStop(0, `rgb(${bg[0]})`); g.addColorStop(1, `rgb(${bg[1]})`);
          x.fillStyle = g;
        } else x.fillStyle = `rgb(${bg})`;
        x.fillRect(0, 0, W, H);
        const size = opt.size || 40;
        x.font = `700 ${size}px "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
        x.textBaseline = 'middle'; x.textAlign = 'left';
        const tw = x.measureText(text).width;
        const left = opt.left != null ? opt.left : (W - tw) / 2, cy = H / 2;
        x.fillStyle = `rgb(${ink})`;
        x.fillText(text, left, cy);
        const th = size * 1.1;
        return {
          canvas: c, tw, left, cy, th,
          word: { text, xPct: (left + tw / 2) / W * 100, yPct: cy / H * 100, wPct: tw / W * 100, hPct: th / H * 100 },
        };
      },
      // 영역 안에서 배경과 확연히 다른 픽셀 수 (L1 거리)
      diffCount(cv, x0, y0, x1, y1, ref, tol = 60) {
        const d = cv.getContext('2d').getImageData(Math.max(0, Math.floor(x0)), Math.max(0, Math.floor(y0)),
          Math.max(1, Math.ceil(x1 - x0)), Math.max(1, Math.ceil(y1 - y0))).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (Math.abs(d[i] - ref[0]) + Math.abs(d[i + 1] - ref[1]) + Math.abs(d[i + 2] - ref[2]) > tol) n++;
        }
        return n;
      },
      px(cv, x, y) { return [...cv.getContext('2d').getImageData(Math.round(x), Math.round(y), 1, 1).data].slice(0, 3); },
      // 한 영역 안에서 특정 색에 "가까운" 픽셀 수 — diffCount(다르다)의 반대
      closeCount(cv, x0, y0, x1, y1, target, tol = 60) {
        const d = cv.getContext('2d').getImageData(Math.max(0, Math.floor(x0)), Math.max(0, Math.floor(y0)),
          Math.max(1, Math.ceil(x1 - x0)), Math.max(1, Math.ceil(y1 - y0))).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (Math.abs(d[i] - target[0]) + Math.abs(d[i + 1] - target[1]) + Math.abs(d[i + 2] - target[2]) < tol) n++;
        }
        return n;
      },
      // 한 간판에 글자색이 두 가지 섞인 경우 흉내(실측: "햇살"은 주황, "유치원"은 남색)
      makeTwoTone() {
        const BG = [250, 247, 235], ORANGE = [235, 140, 40], NAVY = [35, 55, 110];
        const W = 520, H = 130, size = 44, cy = H / 2;
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const ctx = c.getContext('2d');
        ctx.fillStyle = `rgb(${BG})`; ctx.fillRect(0, 0, W, H);
        ctx.font = `700 ${size}px "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
        ctx.textBaseline = 'middle';
        let left = 30;
        ctx.fillStyle = `rgb(${ORANGE})`; ctx.fillText('햇살', left, cy);
        left += ctx.measureText('햇살').width;
        ctx.fillStyle = `rgb(${NAVY})`; ctx.fillText('유치원', left, cy);
        left += ctx.measureText('유치원').width;
        const th = size * 1.1;
        const word = { text: '햇살유치원', xPct: (30 + left) / 2 / W * 100, yPct: cy / H * 100, wPct: (left - 30) / W * 100, hPct: th / H * 100 };
        return { canvas: c, word, W, H, cy, th, ORANGE, NAVY };
      },
    };
  });
  const run = (fn, args) => page.evaluate(fn, args);

  // ── 이름 → 일반 이름 표 ──
  console.log('일반 이름 고르기');
  const 표 = await run(() => {
    const g = window.__anshimTest.genericNameFor;
    const 입력 = ['햇살어린이집', '햇살 어린이집', '새싹유치원', '한빛초등학교', '해솔중학교', '푸른고등학교', '충남대학교', '샛별학교', '영재학원',
      '수학교습소', '어린이집', '학교', '유치원', '햇살어린이집원생모집', '010-1234-5678', '', '가어린이집', '제2햇살어린이집'];
    return 입력.map((t) => [t, g(t)]);
  });
  const 기대 = {
    '햇살어린이집': '어린이집', '햇살 어린이집': '어린이집', '새싹유치원': '유치원', '한빛초등학교': '초등학교', '해솔중학교': '중학교',
    '푸른고등학교': '고등학교', '충남대학교': '대학교', '샛별학교': '학교', '영재학원': '학원', '수학교습소': '교습소',
    '어린이집': null, '학교': null, '유치원': null, '햇살어린이집원생모집': null, '010-1234-5678': null, '': null, '가어린이집': null,
    '제2햇살어린이집': '어린이집',
  };
  for (const [t, g] of 표) ok(g === 기대[t], `«${t}» → ${g === null ? '(안 바꿈)' : '«' + g + '»'}`, g === 기대[t] ? '' : '기대: ' + 기대[t]);

  // ── 단색 간판: 이름이 바뀐다 ──
  console.log('\n단색 간판 — 원래 이름의 흔적이 안 남고 새 글자가 그려진다');
  {
    const r = await run(() => {
      const T = window.__t;
      const BG = [20, 40, 110], INK = [255, 255, 255];
      const s = T.make(520, 120, BG, '햇살어린이집', INK, { size: 44 });
      const out = window.__anshimTest.applyPatchFill(s.canvas, [s.word], 520, 120);
      const L = s.left, R = s.left + s.tw, W = R - L;
      return {
        replaced: out._replaced, kept: out._kept,
        // 원래 글자의 왼쪽 12%·오른쪽 12% — 새 글자(4자)가 더 짧아서 여기는 빈 배경이어야 한다
        leftInk: T.diffCount(out, L, s.cy - s.th / 2, L + W * 0.12, s.cy + s.th / 2, BG),
        rightInk: T.diffCount(out, R - W * 0.12, s.cy - s.th / 2, R, s.cy + s.th / 2, BG),
        beforeLeft: T.diffCount(s.canvas, L, s.cy - s.th / 2, L + W * 0.12, s.cy + s.th / 2, BG),
        centerInk: T.diffCount(out, L + W * 0.3, s.cy - s.th / 2, R - W * 0.3, s.cy + s.th / 2, BG),
        outsideSame: T.diffCount(out, 0, 0, 520, 8, BG) === 0,   // 상자 밖은 안 건드린다
        // 새 글자가 원래 글자색(흰색)이다
        white: (() => { const d = out.getContext('2d').getImageData(L + W * 0.3, s.cy - 20, W * 0.4, 40).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 220 && d[i + 1] > 220 && d[i + 2] > 220) n++; return n; })(),
      };
    });
    ok(r.replaced && r.replaced.join() === '어린이집' && r.kept === 0, '«햇살어린이집» 한 곳을 «어린이집»으로 바꿨다고 알려 준다', JSON.stringify(r.replaced));
    ok(r.beforeLeft > 100, '(전제) 원래 사진의 왼쪽 끝에는 글자 «햇»이 있었다', r.beforeLeft + 'px');
    ok(r.leftInk === 0 && r.rightInk === 0, '원래 이름의 좌우 끝(«햇»·«집»의 자리)이 깨끗한 배경이다', `왼쪽 ${r.leftInk}px · 오른쪽 ${r.rightInk}px`);
    ok(r.centerInk > 300, '가운데에 새 글자가 실제로 그려졌다', r.centerInk + 'px');
    ok(r.white > 100, '새 글자는 원래 글자색(흰색)을 따른다', r.white + 'px');
    ok(r.outsideSame, '글자 상자 밖은 건드리지 않는다');
  }

  // ── 그러데이션 간판: 채운 자리가 주변과 이어진다 ──
  console.log('\n그러데이션 간판 — 지운 자리가 주변 색과 이어진다');
  {
    const r = await run(() => {
      const T = window.__t;
      const s = T.make(520, 120, [[210, 170, 100], [120, 80, 40]], '햇살어린이집', [40, 20, 10], { size: 44 });
      const out = window.__anshimTest.applyPatchFill(s.canvas, [s.word], 520, 120);
      const L = s.left, R = s.left + s.tw, W = R - L, y = s.cy;
      const near = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
      // 상자 바로 안쪽과 바로 바깥 픽셀의 차이 (원본 그러데이션은 완만하다)
      const padX = Math.max(2, s.th * 0.15);
      const seamL = near(T.px(out, L - padX + 2, y - s.th * 0.6), T.px(out, L - padX - 3, y - s.th * 0.6));
      const seamR = near(T.px(out, R + padX - 3, y - s.th * 0.6), T.px(out, R + padX + 3, y - s.th * 0.6));
      // 좌우 끝의 글자 흔적 — 배경(그러데이션)과 다른 어두운 픽셀이 없어야 한다
      const dark = (x0, x1) => {
        const d = out.getContext('2d').getImageData(Math.floor(x0), Math.floor(y - s.th / 2), Math.ceil(x1 - x0), Math.ceil(s.th)).data;
        let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] < 200) n++; return n;
      };
      return { replaced: out._replaced, seamL, seamR, darkL: dark(L, L + W * 0.12), darkR: dark(R - W * 0.12, R), darkC: dark(L + W * 0.3, R - W * 0.3) };
    });
    ok(r.replaced.join() === '어린이집', '그러데이션 간판에서도 바꿔 쓴다');
    ok(r.seamL <= 40 && r.seamR <= 40, '지운 자리의 가장자리가 바로 바깥 색과 이어진다 (이음새가 안 튄다)', `왼쪽 ${r.seamL} · 오른쪽 ${r.seamR}`);
    ok(r.darkL === 0 && r.darkR === 0, '좌우 끝에 원래 글자의 흔적이 없다', `${r.darkL} · ${r.darkR}`);
    ok(r.darkC > 200, '가운데에는 새 글자(어두운 색)가 그려졌다', r.darkC + 'px');
  }

  // ── 무늬 있는 간판: 획만 지우고 나무결은 남긴다 · 글자 크기는 원래와 같다 ──
  console.log('\n무늬 있는 간판 — 상자 전체를 다시 칠하지 않고, 글자 크기도 원래와 같다');
  {
    const r = await run(() => {
      const W = 560, H = 140, size = 46;
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d');
      // 세로 줄무늬(나무결 흉내): 열마다 밝기가 다르다
      for (let i = 0; i < W; i++) { const v = 150 + (i * 37 % 41); x.fillStyle = `rgb(${v + 40},${v - 5},${v - 70})`; x.fillRect(i, 0, 1, H); }
      x.font = `700 ${size}px "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
      x.textBaseline = 'middle'; x.textAlign = 'left';
      const text = '햇살어린이집', tw = x.measureText(text).width, left = 60, cy = 70, th = size * 1.1;
      x.fillStyle = 'rgb(45,45,55)'; x.fillText(text, left, cy);
      const original = document.createElement('canvas'); original.width = W; original.height = H;
      original.getContext('2d').drawImage(c, 0, 0);
      const word = { text, xPct: (left + tw / 2) / W * 100, yPct: cy / H * 100, wPct: tw / W * 100, hPct: th / H * 100 };
      const out = window.__anshimTest.applyPatchFill(c, [word], W, H);
      const a = original.getContext('2d').getImageData(0, 0, W, H).data, b = out.getContext('2d').getImageData(0, 0, W, H).data;
      // 글자 위쪽 여백(상자 안이지만 글자 밖): 원본 그대로여야 한다
      const padY = Math.max(2, th * 0.15);
      const yTop0 = Math.floor(cy - th / 2 - padY), yTop1 = Math.floor(cy - th / 2 - 6);
      let changedMargin = 0, total = 0;
      for (let yy = yTop0; yy < yTop1; yy++) for (let xx = Math.floor(left); xx < left + tw; xx++) {
        const i = (yy * W + xx) * 4; total++;
        if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) changedMargin++;
      }
      // 새 글자가 차지하는 가로 폭 (어두운 픽셀이 있는 열의 처음~끝)
      let xmin = W, xmax = -1;
      for (let xx = 0; xx < W; xx++) for (let yy = Math.floor(cy - th / 2); yy < cy + th / 2; yy++) {
        const i = (yy * W + xx) * 4;
        if (b[i] + b[i + 1] + b[i + 2] < 260) { xmin = Math.min(xmin, xx); xmax = Math.max(xmax, xx); break; }
      }
      return { changedMargin, total, ratio: (xmax - xmin) / tw, replaced: out._replaced.join() };
    });
    ok(r.replaced === '어린이집', '무늬 있는 간판에서도 바꿔 쓴다');
    ok(r.changedMargin === 0, '글자 위쪽 여백은 원본 그대로다 (나무결이 사각형으로 뭉개지지 않는다)', `바뀐 픽셀 ${r.changedMargin}/${r.total}`);
    ok(r.ratio > 0.55 && r.ratio < 0.8, '새 글자 폭이 원래 글자 한 자 폭 × 4자 정도다 (원래 6자 대비 약 2/3)', `원래 폭의 ${(r.ratio * 100).toFixed(0)}%`);
  }

  // ── 기울어진 간판: 새 글자도 같은 각도로 쓴다 ──
  console.log('\n기울어진 글자 — 줄의 기울기와 세로획의 누움을 재서 같은 모양으로 쓴다');
  const 기울기 = await run(() => {
    // 회전·눕힘을 준 글자를 그린 사진과, 그 글자를 감싸는 (축에 나란한) 상자를 만든다 — 비전이 주는 상자와 같은 모양
    function make(deg, slantDeg, text) {
      const W = 700, H = 260, size = 50;
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d');
      x.fillStyle = 'rgb(200,160,100)'; x.fillRect(0, 0, W, H);
      x.font = `700 ${size}px "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
      x.textAlign = 'center'; x.textBaseline = 'middle';
      const tw = x.measureText(text).width, th = size * 1.1, cx = W / 2, cy = H / 2;
      const t = deg * Math.PI / 180, sl = slantDeg * Math.PI / 180;
      x.save(); x.translate(cx, cy); x.rotate(t); x.transform(1, 0, -Math.tan(sl), 1, 0, 0);
      x.fillStyle = 'rgb(40,40,50)'; x.fillText(text, 0, 0); x.restore();
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const [px, py] of [[-tw / 2, -th / 2], [tw / 2, -th / 2], [tw / 2, th / 2], [-tw / 2, th / 2]]) {
        const sx = px - Math.tan(sl) * py, sy = py;
        const rx = sx * Math.cos(t) - sy * Math.sin(t), ry = sx * Math.sin(t) + sy * Math.cos(t);
        x0 = Math.min(x0, rx); x1 = Math.max(x1, rx); y0 = Math.min(y0, ry); y1 = Math.max(y1, ry);
      }
      const word = { text, xPct: cx / W * 100, yPct: cy / H * 100, wPct: (x1 - x0) / W * 100, hPct: (y1 - y0) / H * 100 };
      const out = window.__anshimTest.applyPatchFill(c, [word], W, H);
      return { deg, slantDeg, est: out._angles[0], estSlant: out._slants[0], replaced: out._replaced.join() };
    }
    return [[0, 0], [3, 0], [-3, 0], [5, 0], [-7, 0], [10, 0], [0, 8], [0, -8], [-3, -8], [5, 6]].map(([d, sl]) => make(d, sl, '햇살어린이집'));
  });
  for (const r of 기울기) {
    ok(Math.abs(r.est - r.deg) <= 1.5 && Math.abs(r.estSlant - r.slantDeg) <= 2,
      `줄 ${r.deg}° · 세로획 ${r.slantDeg}° → 잰 값 ${r.est.toFixed(1)}° · ${r.estSlant.toFixed(1)}°`, r.replaced);
  }
  {
    // 기울기가 없으면 똑바로 쓴다(잡음으로 기울이지 않는다)
    const r = 기울기.find((x) => x.deg === 0 && x.slantDeg === 0);
    ok(Math.abs(r.est) < 0.01 && Math.abs(r.estSlant) < 0.01, '기울지 않은 글자는 정확히 0°로 쓴다', r.est + '° · ' + r.estSlant + '°');
  }

  // ── 글자색을 따라간다 ──
  console.log('\n원래 글자색 따라가기');
  {
    const r = await run(() => {
      const T = window.__t;
      const s = T.make(520, 120, [250, 240, 200], '새싹유치원', [200, 30, 30], { size: 44 });
      const out = window.__anshimTest.applyPatchFill(s.canvas, [s.word], 520, 120);
      const d = out.getContext('2d').getImageData(0, 0, 520, 120).data;
      let red = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 170 && d[i + 1] < 90 && d[i + 2] < 90) red++;
      return { replaced: out._replaced, red };
    });
    ok(r.replaced.join() === '유치원', '«새싹유치원» → «유치원»');
    ok(r.red > 150, '새 글자가 원래처럼 붉은색이다', r.red + 'px');
  }

  // ── 바꾸지 않는 경우 ──
  console.log('\n바꾸지 않는 글자');
  {
    const r = await run(() => {
      const T = window.__t;
      const BG = [20, 40, 110];
      const a = T.make(520, 120, BG, '어린이집', [255, 255, 255], { size: 44 });
      const outA = window.__anshimTest.applyPatchFill(a.canvas, [a.word], 520, 120);
      const before = a.canvas.getContext('2d').getImageData(0, 0, 520, 120).data;
      const after = outA.getContext('2d').getImageData(0, 0, 520, 120).data;
      let same = true; for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) { same = false; break; }

      const p = T.make(520, 120, BG, '010-1234-5678', [255, 255, 255], { size: 40 });
      const outP = window.__anshimTest.applyPatchFill(p.canvas, [p.word], 520, 120);

      const t = T.make(700, 120, BG, '햇살어린이집원생모집', [255, 255, 255], { size: 40 });
      const outT = window.__anshimTest.applyPatchFill(t.canvas, [t.word], 700, 120);
      return {
        aKept: outA._kept, aReplaced: outA._replaced.length, aSame: same,
        pReplaced: outP._replaced.length, pInk: T.diffCount(outP, p.left, p.cy - p.th / 2, p.left + p.tw, p.cy + p.th / 2, BG, 30),
        tReplaced: outT._replaced.length, tInk: T.diffCount(outT, t.left, t.cy - t.th / 2, t.left + t.tw, t.cy + t.th / 2, BG, 30),
      };
    });
    ok(r.aKept === 1 && r.aReplaced === 0 && r.aSame, '«어린이집»뿐인 글자는 이미 일반 이름이라 그대로 둔다 (자국도 안 남긴다)');
    ok(r.pReplaced === 0 && r.pInk === 0, '전화번호는 바꿀 수 없으니 예전처럼 덮는다 (글자 흔적 0)', `흔적 ${r.pInk}px`);
    ok(r.tReplaced === 0 && r.tInk === 0, '이름 뒤에 다른 글자가 붙은 것(«…원생모집»)도 예전처럼 덮는다', `흔적 ${r.tInk}px`);
  }

  // ── 사용자가 덮는 방식을 고르면 그대로 덮는다 ──
  console.log('\n덮는 방식을 직접 고르면');
  {
    const r = await run(() => {
      const T = window.__t;
      const BG = [20, 40, 110];
      const s = T.make(520, 120, BG, '햇살어린이집', [255, 255, 255], { size: 44 });
      const color = window.__anshimTest.applyPatchFill(s.canvas, [s.word], 520, 120, 'color', 16);
      const mosaic = window.__anshimTest.applyPatchFill(s.canvas, [s.word], 520, 120, 'mosaic', 16);
      const box = [s.left - 8, s.cy - s.th / 2 - 4, s.left + s.tw + 8, s.cy + s.th / 2 + 4];
      return {
        colorReplaced: color._replaced.length, colorInk: T.diffCount(color, ...box, BG, 30),
        mosaicReplaced: mosaic._replaced.length,
      };
    });
    ok(r.colorReplaced === 0 && r.colorInk === 0, '«주변색»을 고르면 글자를 안 쓰고 평평하게 덮는다', `흔적 ${r.colorInk}px`);
    ok(r.mosaicReplaced === 0, '«모자이크»를 고르면 바꿔 쓰지 않는다');
  }
  {
    // 큰 간판(높이 150px)을 16픽셀 셀로 덮으면 글자 모양이 그대로 읽힌다 — 셀은 글자 높이에 맞춰 커져야 한다
    const r = await run(() => {
      const T = window.__t;
      const s = T.make(900, 300, [30, 60, 160], '푸른하늘서점', [255, 255, 255], { size: 130 });
      const out = window.__anshimTest.applyPatchFill(s.canvas, [s.word], 900, 300, 'mosaic', 16);
      const y = Math.round(s.cy), d = out.getContext('2d').getImageData(0, y, 900, 1).data;
      let run = 1, best = 1;
      for (let x = 1; x < 900; x++) {
        const i = x * 4, j = (x - 1) * 4;
        if (d[i] === d[j] && d[i + 1] === d[j + 1] && d[i + 2] === d[j + 2]) { run++; best = Math.max(best, run); } else run = 1;
      }
      return { best, th: s.th };
    });
    ok(r.best >= r.th / 2.5, '모자이크 셀은 글자 높이에 맞춰 커진다 (고른 값이 16이어도 큰 글자는 읽히지 않는다)', `가장 긴 같은 색 구간 ${r.best}px / 글자 높이 ${r.th.toFixed(0)}px`);
  }

  // ── 한 간판에 잉크색이 두 가지 섞인 경우 ──
  // 실측(햇살 유치원 입학식 사진): "햇살"은 주황, "유치원"은 남색으로 다른 색을 쓰는 간판에서
  // sampleInkColor가 둘 중 더 튀는 색(남색) 하나만 대표 잉크로 뽑으면, "잉크색에 더 가까운
  // 픽셀만 획"으로 보는 옛 판정은 주황 "햇살"을 배경으로 오판해 하나도 안 지우고 원래 이름이
  // 그대로 남았다(이름이 다 가려지지 않는 프라이버시 버그). 배경과 "충분히 다르면" 획으로 보도록
  // 고친 뒤에는 두 색 다 지워져야 한다.
  console.log('\n한 간판에 잉크색이 두 가지 섞인 경우');
  {
    const r = await run(() => {
      const T = window.__t;
      const t = T.makeTwoTone();
      const out = window.__anshimTest.applyPatchFill(t.canvas, [t.word], t.W, t.H, 'auto', 16, null);
      const box = [0, t.cy - t.th / 2 - 6, t.W, t.cy + t.th / 2 + 6];
      return { replaced: out._replaced, orangeLeft: T.closeCount(out, ...box, t.ORANGE, 60) };
    });
    ok(r.replaced.join() === '유치원', '«햇살»(주황)+«유치원»(남색) → «유치원»으로 바뀐다', r.replaced.join());
    ok(r.orangeLeft === 0, '대표 잉크색(남색)과 다른 색이었던 «햇살»도 흔적 없이 지워진다', `주황 흔적 ${r.orangeLeft}px`);
  }
  {
    // 모자이크·주변색은 박스 전체를 통째로 덮어서, 안에 잉크색이 몇 가지든 애초에 상관없다 —
    // 그래도 실제로 확인해 둔다.
    const r = await run(() => {
      const T = window.__t;
      const t1 = T.makeTwoTone();
      const colorOut = window.__anshimTest.applyPatchFill(t1.canvas, [t1.word], t1.W, t1.H, 'color', 16, null);
      const t2 = T.makeTwoTone();
      const mosaicOut = window.__anshimTest.applyPatchFill(t2.canvas, [t2.word], t2.W, t2.H, 'mosaic', 16, null);
      const box1 = [0, t1.cy - t1.th / 2 - 6, t1.W, t1.cy + t1.th / 2 + 6];
      const box2 = [0, t2.cy - t2.th / 2 - 6, t2.W, t2.cy + t2.th / 2 + 6];
      return {
        colorOrange: T.closeCount(colorOut, ...box1, t1.ORANGE, 60),
        colorNavy: T.closeCount(colorOut, ...box1, t1.NAVY, 60),
        mosaicOrange: T.closeCount(mosaicOut, ...box2, t2.ORANGE, 60),
        mosaicNavy: T.closeCount(mosaicOut, ...box2, t2.NAVY, 60),
      };
    });
    ok(r.colorOrange === 0 && r.colorNavy === 0, '주변색 모드는 두 잉크색 다 흔적 없이 덮는다', `주황 ${r.colorOrange} · 남색 ${r.colorNavy}`);
    ok(r.mosaicOrange === 0 && r.mosaicNavy === 0, '모자이크 모드는 두 잉크색 다 흔적 없이 덮는다', `주황 ${r.mosaicOrange} · 남색 ${r.mosaicNavy}`);
  }

  // ── 여러 곳 · 가장자리 ──
  console.log('\n여러 곳 · 이미지 가장자리');
  {
    const r = await run(() => {
      const T = window.__t;
      const BG = [30, 30, 30];
      const a = T.make(700, 200, BG, '햇살어린이집', [255, 255, 255], { size: 40, left: 30 });
      const ctx = a.canvas.getContext('2d');
      ctx.font = '700 40px "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
      const w2 = ctx.measureText('새싹유치원').width;
      ctx.fillStyle = '#fff'; ctx.fillText('새싹유치원', 30, 150);
      const second = { text: '새싹유치원', xPct: (30 + w2 / 2) / 700 * 100, yPct: 150 / 200 * 100, wPct: w2 / 700 * 100, hPct: 44 / 200 * 100 };
      const first = { ...a.word, yPct: 50 / 200 * 100 };
      // 첫 글자를 다시 위쪽 줄로 옮겨 그린다
      ctx.fillStyle = `rgb(${BG})`; ctx.fillRect(0, 0, 700, 100);
      ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText('햇살어린이집', 30, 50);
      const out = window.__anshimTest.applyPatchFill(a.canvas, [first, second], 700, 200);
      // 가장자리에 딱 붙은 상자 (x0 = 0)
      const e = T.make(300, 100, BG, '샛별어린이집', [255, 255, 255], { size: 34, left: 0 });
      let edgeErr = null, edge = null;
      try { edge = window.__anshimTest.applyPatchFill(e.canvas, [e.word], 300, 100); } catch (x) { edgeErr = String(x); }
      const d = edge ? edge.getContext('2d').getImageData(0, 0, 300, 100).data : [];
      let bad = 0; for (let i = 0; i < d.length; i++) if (!(d[i] >= 0 && d[i] <= 255)) bad++;
      return { replaced: out._replaced, edgeErr, edgeReplaced: edge && edge._replaced.join(), bad };
    });
    ok(r.replaced.join() === '어린이집,유치원', '한 사진에서 두 곳을 각각 알맞은 일반 이름으로 바꾼다', r.replaced.join());
    ok(!r.edgeErr && r.edgeReplaced === '어린이집' && r.bad === 0, '상자가 사진 가장자리에 붙어 있어도 오류 없이 바꾼다', r.edgeErr || '');
  }

  ok(errs.length === 0, '페이지 에러 없음', errs.join(' | '));
  await browser.close();
  console.log(`\n${pass}개 통과, ${fail}개 실패`);
  process.exit(fail ? 1 : 0);
})();
