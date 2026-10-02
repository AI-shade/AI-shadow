/*
 * 붙어 있는 글자 조각 병합(applyPatchFill의 groupAdjacentTexts) 검사.
 *
 * OCR이 한 간판을 "청룡"·"태권도"·"체육관"처럼 여러 낱말로 쪼개 주면, 낱말별로 따로
 * 덮어서 틈새로 원본이 비치고 조각조각 나 보인다(실측: 태권도장 간판 사진). 같은 줄에
 * 붙어 있는 조각은 하나로 묶어 한 영역으로 덮어야 한다. 핵심 기준:
 *   1) 글자 높이의 1.2배 안으로 붙어 있으면 하나로 묶여, 이어붙인 이름이 GENERIC_NAME_RULES에
 *      걸리면(예: …체육관) 조각 전체가 한 번에 그 일반 이름으로 바뀐다.
 *   2) 글자 높이의 몇 배씩 떨어져 있으면(같은 줄이 아님) 묶지 않고 각자 처리한다.
 *   3) "체육관"처럼 종류 낱말 하나뿐인 조각은(이번에 GENERIC_ONLY_RE에 추가) 이미 일반
 *      이름이라 손대지 않는다.
 *
 * 사용법: 이 폴더(test)에서 → node merge-adjacent-text.js   (프런트가 8000 또는 BASE_URL에서 돌고 있어야 함)
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

  await page.evaluate(() => {
    window.__t = {
      make(W, H, bg, text, ink, opt = {}) {
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const x = c.getContext('2d');
        x.fillStyle = `rgb(${bg})`; x.fillRect(0, 0, W, H);
        const size = opt.size || 40;
        x.font = `700 ${size}px "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
        x.textBaseline = 'middle'; x.textAlign = 'left';
        const tw = x.measureText(text).width;
        const left = opt.left != null ? opt.left : (W - tw) / 2, cy = H / 2;
        x.fillStyle = `rgb(${ink})`;
        x.fillText(text, left, cy);
        const th = size * 1.1;
        return { canvas: c, word: { text, xPct: (left + tw / 2) / W * 100, yPct: cy / H * 100, wPct: tw / W * 100, hPct: th / H * 100 } };
      },
    };
  });
  const run = (fn, args) => page.evaluate(fn, args);

  console.log('붙어 있는 조각 병합');
  {
    const r = await run(() => {
      const BG = [24, 32, 58];
      const W = 900, H = 220, size = 44, cy = H / 2, th = size * 1.1;
      function makeRow(gap) {
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const ctx = c.getContext('2d');
        ctx.fillStyle = `rgb(${BG})`; ctx.fillRect(0, 0, W, H);
        ctx.font = `700 ${size}px "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
        ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
        let left = 30;
        const words = ['청룡', '태권도', '체육관'].map((text) => {
          const w = ctx.measureText(text).width;
          ctx.fillText(text, left, cy);
          const word = { text, xPct: (left + w / 2) / W * 100, yPct: cy / H * 100, wPct: w / W * 100, hPct: th / H * 100 };
          left += w + gap;
          return word;
        });
        return { canvas: c, words };
      }
      // 낱말 사이 틈 = 글자 높이의 0.3배 — 실제 간판의 자연스러운 낱말 간격 흉내(병합 기준 1.2배 안쪽)
      const close = makeRow(th * 0.3);
      const merged = window.__anshimTest.applyPatchFill(close.canvas, close.words, W, H, 'auto', 16, null);
      // 낱말 사이 틈 = 글자 높이의 2배 — 같은 줄이 아니라고 볼 만큼 떨어뜨림(병합 기준 밖)
      const far = makeRow(th * 2);
      const farApart = window.__anshimTest.applyPatchFill(far.canvas, far.words, W, H, 'auto', 16, null);
      return {
        merged: { replaced: merged._replaced, kept: merged._kept },
        farApart: { replaced: farApart._replaced, kept: farApart._kept },
      };
    });
    ok(r.merged.replaced.join() === '체육관' && r.merged.kept === 0,
      '붙어 있는 조각(«청룡»«태권도»«체육관»)은 하나로 묶여 «체육관»으로 바뀐다', JSON.stringify(r.merged));
    ok(r.farApart.replaced.length === 0 && r.farApart.kept === 1,
      '멀리 떨어진 조각은 한 줄로 묶지 않는다 (따로 처리 — «체육관»만 이미 일반 이름이라 남음)', JSON.stringify(r.farApart));
  }

  console.log('\n새로 추가한 종류 낱말');
  {
    const r = await run(() => {
      const T = window.__t;
      const BG = [24, 32, 58];
      const alone = T.make(300, 120, BG, '체육관', [255, 255, 255], { size: 40 });
      const out = window.__anshimTest.applyPatchFill(alone.canvas, [alone.word], 300, 120, 'auto', 16, null);
      const before = alone.canvas.getContext('2d').getImageData(0, 0, 300, 120).data;
      const after = out.getContext('2d').getImageData(0, 0, 300, 120).data;
      let same = true; for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) { same = false; break; }
      return { kept: out._kept, replaced: out._replaced, same };
    });
    ok(r.kept === 1 && r.replaced.length === 0 && r.same,
      '«체육관»뿐인 글자는 이미 일반 이름이라 그대로 둔다 (자국도 안 남긴다)', JSON.stringify(r));

    const r2 = await run(() => {
      const T = window.__t;
      const BG = [40, 40, 40];
      const w = T.make(500, 150, BG, '은하체육관', [255, 255, 255], { size: 40 });
      const out = window.__anshimTest.applyPatchFill(w.canvas, [w.word], 500, 150, 'auto', 16, null);
      return { replaced: out._replaced };
    });
    ok(r2.replaced.join() === '체육관', '«은하체육관» → «체육관»으로 바꿔 쓴다', r2.replaced.join());
  }

  // AI(nano-banana)로 다시 그릴 자리는 applyPatchFill이 바꿔 쓰는 자리와 같아야 한다 —
  // 둘이 어긋나면 화면은 "한 곳 바꿨다"는데 AI는 엉뚱한 곳(전화번호·「유치원」뿐인 글자)을
  // 잘라 보내 돈과 사진 조각만 나간다. 순수 계산이라 AI는 부르지 않는다(비용 0).
  console.log('\nAI 교체 대상 자리 (findSignSwapRegions)');
  {
    const r = await run(() => {
      const BG = [24, 32, 58], W = 900, H = 220, size = 44, cy = H / 2, th = size * 1.1;
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d');
      ctx.font = `700 ${size}px "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
      let left = 30;
      const row = ['청룡', '태권도', '체육관'].map((text) => {
        const w = ctx.measureText(text).width;
        const word = { text, xPct: (left + w / 2) / W * 100, yPct: cy / H * 100, wPct: w / W * 100, hPct: th / H * 100 };
        left += w + th * 0.3;
        return word;
      });
      const merged = window.__anshimTest.findSignSwapRegions(row, W, H);
      const two = window.__anshimTest.findSignSwapRegions([
        { text: '새싹유치원', xPct: 30, yPct: 25, wPct: 25, hPct: 12 },
        { text: '민들레어린이집', xPct: 75, yPct: 70, wPct: 30, hPct: 10 },
      ], 1000, 400);
      const none = window.__anshimTest.findSignSwapRegions([
        { text: '010-1234-5678', xPct: 30, yPct: 25, wPct: 25, hPct: 12 },
        { text: '유치원', xPct: 75, yPct: 70, wPct: 20, hPct: 10 },
      ], 1000, 400);
      return {
        merged: merged.map((g) => g.origText + '→' + g.newText),
        two: two.map((g) => g.origText + '→' + g.newText),
        noneCount: none.length,
      };
    });
    ok(r.merged.join() === '청룡태권도체육관→체육관', '붙어 있는 조각은 한 자리로 묶여 AI에 한 번만 보낸다', r.merged.join());
    ok(r.two.join() === '새싹유치원→유치원,민들레어린이집→어린이집', '떨어진 두 간판은 각자 한 자리씩 보낸다', r.two.join());
    ok(r.noneCount === 0, '전화번호·«유치원»뿐인 글자는 바꿔 쓸 말이 없어 아무것도 안 보낸다', String(r.noneCount));
  }

  ok(errs.length === 0, '페이지 에러 없음', errs.join(' | '));
  await browser.close();
  console.log(`\n${pass}개 통과, ${fail}개 실패`);
  process.exit(fail ? 1 : 0);
})();
