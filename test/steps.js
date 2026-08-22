// 세 단계 소개 — 핀 고정 스크롤
// - 넓은 화면: 무대가 화면에 붙어 있는 동안 단계만 넘어간다
// - 좁은 화면 / 모션 축소: 붙이지 않고 세 단계를 전부 펼쳐 보여준다
// - 어느 쪽이든 스크롤이 갇히거나 내용이 사라지면 안 된다
const { chromium } = require('playwright');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

const geo = p => p.evaluate(() => {
  const t = document.getElementById('stepsTrack');
  return {
    top: Math.round(t.getBoundingClientRect().top + scrollY),
    h: t.offsetHeight,
    vh: innerHeight,
  };
});

const state = p => p.evaluate(() => {
  const s = window.__anshimTest.stepsState();
  const stage = document.querySelector('.steps-stage');
  const cs = getComputedStyle(stage);
  s.stageTop = Math.round(stage.getBoundingClientRect().top);
  s.position = cs.position;
  // 화면에 실제로 보이는 단계 글이 몇 개인가 (펼친 모드에서는 셋 다)
  s.visiblePanes = [...document.querySelectorAll('.steps-pane')]
    .filter(e => Number(getComputedStyle(e).opacity) > 0.5).length;
  s.visibleItems = [...document.querySelectorAll('.steps-list li')]
    .filter(e => Number(getComputedStyle(e).opacity) > 0.9).length;
  return s;
});

(async () => {
  const b = await chromium.launch();

  // ─────────── 넓은 화면: 핀 고정 ───────────
  {
    const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
    const errs = [];
    p.on('pageerror', e => errs.push(String(e)));
    await p.goto('http://localhost:8000/index.html', { waitUntil: 'load' });
    await p.evaluate(() => document.fonts.ready);
    await p.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; });
    await p.waitForTimeout(1000);

    const g = await geo(p);
    console.log('— 1440px (핀 고정) —');
    check('트랙이 세 화면 높이다', Math.abs(g.h - g.vh * 3) < 4, g.h + ' vs ' + g.vh * 3);

    const total = g.h - g.vh;
    const seen = [];
    const tops = [];
    for (const f of [0.05, 0.2, 0.4, 0.55, 0.75, 0.95]) {
      await p.evaluate(v => scrollTo(0, v), g.top + Math.round(total * f));
      await p.waitForTimeout(420);
      const s = await state(p);
      seen.push(s.active);
      tops.push(s.stageTop);
      if (f === 0.4) {
        check('한 번에 한 단계만 켜진다', s.onCount === 1 && s.paneOn === 1,
          'item=' + s.onCount + ' pane=' + s.paneOn);
      }
    }
    check('무대가 sticky다', (await state(p)).position === 'sticky');
    check('스크롤하는 내내 무대가 화면 맨 위에 붙어 있다',
      tops.every(t => Math.abs(t) <= 2), tops.join(','));
    check('단계가 0 → 1 → 2로 넘어간다',
      JSON.stringify(seen) === JSON.stringify([0, 0, 1, 1, 2, 2]), seen.join(','));

    // 진행 막대. html에 scroll-behavior: smooth가 걸려 있어 scrollTo가 애니메이션으로
    // 흘러간다 — 측정 전에는 즉시 이동시켜야 중간값을 재지 않는다.
    await p.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; });
    const g2 = await geo(p);
    await p.evaluate(v => scrollTo(0, v), g2.top);
    await p.waitForTimeout(400);
    const b0 = (await state(p)).bar;
    await p.evaluate(v => scrollTo(0, v), g2.top + (g2.h - g2.vh));
    await p.waitForTimeout(400);
    const b1 = (await state(p)).bar;
    check('진행 막대가 0에서 시작한다', /scaleX\(0(\.0+)?\)/.test(b0), b0);
    check('진행 막대가 끝에서 꽉 찬다', /scaleX\(0?\.99|scaleX\(1\)/.test(b1), b1);

    // 트랙을 다 지나면 다음 섹션이 나와야 한다 — 스크롤이 갇히면 안 된다
    await p.evaluate(v => scrollTo(0, v), g.top + total + 400);
    await p.waitForTimeout(400);
    const past = await p.evaluate(() => {
      const f = document.getElementById('features').getBoundingClientRect();
      return { featTop: Math.round(f.top), stageTop: Math.round(document.querySelector('.steps-stage').getBoundingClientRect().top) };
    });
    check('트랙을 지나면 무대가 같이 올라간다(스크롤이 갇히지 않는다)',
      past.stageTop < -100, 'stage=' + past.stageTop);
    check('트랙 뒤에 다음 섹션이 이어진다', past.featTop < 900, 'features top=' + past.featTop);

    check('페이지 에러 없음', errs.length === 0, errs.slice(0, 2).join(' / '));
    await p.close();
  }

  // ─────────── 좁은 화면: 펼치기 ───────────
  {
    const p = await b.newPage({ viewport: { width: 520, height: 900 } });
    const errs = [];
    p.on('pageerror', e => errs.push(String(e)));
    await p.goto('http://localhost:8000/index.html', { waitUntil: 'load' });
    await p.waitForTimeout(1000);
    const g = await geo(p);
    await p.evaluate(v => scrollTo(0, v), g.top);
    await p.waitForTimeout(500);
    const s = await state(p);
    console.log('— 520px (펼치기) —');
    check('좁은 화면에서는 붙이지 않는다', s.position === 'static', s.position);
    check('트랙이 세 화면 높이를 차지하지 않는다', g.h < g.vh * 3, g.h + ' vs ' + g.vh * 3);
    check('세 단계 글이 전부 보인다', s.visibleItems === 3, String(s.visibleItems));
    check('세 화면 목업이 전부 보인다', s.visiblePanes === 3, String(s.visiblePanes));
    check('페이지 에러 없음', errs.length === 0, errs.slice(0, 2).join(' / '));
    await p.close();
  }

  // ─────────── 모션 축소 ───────────
  {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(String(e)));
    await p.goto('http://localhost:8000/index.html', { waitUntil: 'load' });
    await p.waitForTimeout(1000);
    const g = await geo(p);
    await p.evaluate(v => scrollTo(0, v), g.top);
    await p.waitForTimeout(500);
    const s = await state(p);
    console.log('— 모션 축소 —');
    check('모션 축소에서는 붙이지 않는다', s.position === 'static', s.position);
    check('모션 축소에서도 세 단계가 전부 보인다',
      s.visibleItems === 3 && s.visiblePanes === 3, s.visibleItems + '/' + s.visiblePanes);
    check('모션 축소에서는 단계 표시를 건드리지 않는다', s.onCount === 0, String(s.onCount));
    check('페이지 에러 없음', errs.length === 0, errs.slice(0, 2).join(' / '));
    await ctx.close();
  }

  // ─────────── 폭별 넘침 ───────────
  {
    console.log('— 폭별 가로 넘침 —');
    let bad = [];
    for (const w of [1920, 1600, 1440, 1280, 1100, 1024, 900, 760, 520, 380, 320]) {
      const p = await b.newPage({ viewport: { width: w, height: 900 } });
      await p.goto('http://localhost:8000/index.html', { waitUntil: 'load' });
      await p.waitForTimeout(700);
      const g = await geo(p);
      await p.evaluate(v => scrollTo(0, v), g.top + 200);
      await p.waitForTimeout(350);
      const ov = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      if (ov) bad.push(w);
      await p.close();
    }
    check('열한 폭 모두 가로 스크롤 없음', bad.length === 0, '넘침: ' + bad.join(','));
  }

  console.log('\n결과: ' + pass + '/' + (pass + fail) + ' 통과');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
