// 핀 고정 섹션 전체 — 세 단계 소개 · 기능 · 왜 안전한가 · 자주 묻는 질문
// - 넓은 화면: 무대가 붙어 있는 동안 항목만 하나씩 넘어간다
// - 자주 묻는 질문은 쌓기 방식 — 지나간 질문도 켜둔 채로 남아 눌러볼 수 있다
// - 좁은 화면 / 모션 축소: 붙이지 않고 전부 펼친다
const { chromium } = require('playwright');
const { 무시해도되나 } = require('./console-noise.js');

const SECTIONS = [
  ['#stepsTrack', '세 단계', 3, false],
  ['#features .pin-track', '기능', 4, false],
  ['#why .pin-track', '왜 안전한가', 4, false],
  ['#faq .pin-track', '자주 묻는 질문', 5, true],
];

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

const geo = (p, sel) => p.evaluate(s => {
  const t = document.querySelector(s);
  return { top: Math.round(t.getBoundingClientRect().top + scrollY), h: t.offsetHeight };
}, sel);

const st = (p, sel) => p.evaluate(s => window.__anshimTest.pinState(s), sel);

(async () => {
  const b = await chromium.launch();

  // ─────────── 넓은 화면 ───────────
  {
    const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
    const errs = [];
    p.on('pageerror', e => errs.push(String(e)));
    p.on('console', m => { if (!무시해도되나(m)) errs.push(m.text()); });
    await p.goto('http://localhost:8000/index.html', { waitUntil: 'load' });
    await p.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; });
    await p.waitForTimeout(1200);

    console.log('— 1440px (핀 고정) —');
    check('핀 섹션이 네 개다',
      (await p.evaluate(() => document.querySelectorAll('[data-pin]').length)) === 4);

    for (const [sel, name, count, accum] of SECTIONS) {
      const g = await geo(p, sel);
      const total = g.h - 900;
      const s0 = await st(p, sel);
      check(name + ' — 항목 수가 선언과 맞는다', s0.count === count, s0.count + ' vs ' + count);
      check(name + ' — 무대가 sticky다', s0.position === 'sticky', s0.position);
      check(name + ' — 쌓기 설정이 의도대로', s0.accumulate === accum, String(s0.accumulate));

      const lits = [], tops = [];
      for (let i = 0; i < count; i++) {
        await p.evaluate(v => scrollTo(0, v), g.top + Math.round(total * ((i + 0.5) / count)));
        await p.waitForTimeout(700); // 전환 0.42s가 끝난 뒤에 잰다
        const s = await st(p, sel);
        lits.push(s.lit);
        tops.push(s.stageTop);
      }
      check(name + ' — 스크롤 내내 무대가 화면 맨 위에 붙어 있다',
        tops.every(t => Math.abs(t) <= 2), tops.join(','));

      if (accum) {
        const want = Array.from({ length: count }, (_, i) => i + 1);
        check(name + ' — 지나간 항목이 쌓인다',
          JSON.stringify(lits) === JSON.stringify(want), lits.join(',') + ' 기대 ' + want.join(','));
      } else {
        // 세 단계 소개는 목록 항목과 화면 목업이 같은 번호를 나눠 쓴다 —
        // 한 단계에 두 요소가 켜지는 게 정상이다. 요소수/항목수로 기대값을 잡는다.
        const per = s0.total / count;
        check(name + ' — 한 번에 한 항목만 밝다 (요소 ' + per + '개)',
          lits.every(n => n === per), lits.join(','));
      }

      // 진행 막대
      await p.evaluate(v => scrollTo(0, v), g.top + total);
      await p.waitForTimeout(400);
      const end = await st(p, sel);
      check(name + ' — 진행 막대가 끝에서 찬다',
        /scaleX\(0?\.9\d|scaleX\(1\)/.test(end.bar || ''), end.bar);

      // 트랙을 지나면 풀려야 한다
      await p.evaluate(v => scrollTo(0, v), g.top + total + 500);
      await p.waitForTimeout(350);
      const past = await st(p, sel);
      check(name + ' — 트랙을 지나면 무대가 같이 올라간다',
        past.stageTop < -100, 'stage=' + past.stageTop);
    }

    // 항목이 많은 섹션은 한 항목당 스크롤이 짧아야 한다
    const steps = await p.evaluate(() => {
      const g = s => {
        const t = document.querySelector(s);
        return t.offsetHeight / Number(t.dataset.pin) / innerHeight;
      };
      return { three: g('#stepsTrack'), four: g('#features .pin-track'), five: g('#faq .pin-track') };
    });
    check('항목이 많을수록 한 항목당 스크롤이 짧다',
      steps.three > steps.four && steps.four > steps.five,
      Object.entries(steps).map(([k, v]) => k + '=' + v.toFixed(2)).join(' '));

    check('페이지 에러 없음', errs.length === 0, errs.slice(0, 2).join(' / '));
    await p.close();
  }

  // ─────────── 좁은 화면 ───────────
  {
    const p = await b.newPage({ viewport: { width: 520, height: 900 } });
    const errs = [];
    p.on('pageerror', e => errs.push(String(e)));
    await p.goto('http://localhost:8000/index.html', { waitUntil: 'load' });
    await p.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; });
    await p.waitForTimeout(1200);
    console.log('— 520px (펼치기) —');
    for (const [sel, name, count] of SECTIONS) {
      const g = await geo(p, sel);
      await p.evaluate(v => scrollTo(0, v), g.top);
      await p.waitForTimeout(400);
      const s = await st(p, sel);
      check(name + ' — 붙이지 않는다', s.position === 'static', s.position);
      check(name + ' — 항목이 전부 보인다', s.lit === s.total, s.lit + '/' + s.total);
    }
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
    await p.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; });
    await p.waitForTimeout(1200);
    console.log('— 모션 축소 —');
    let allStatic = true, allLit = true, noneOn = true;
    for (const [sel] of SECTIONS) {
      const g = await geo(p, sel);
      await p.evaluate(v => scrollTo(0, v), g.top);
      await p.waitForTimeout(350);
      const s = await st(p, sel);
      if (s.position !== 'static') allStatic = false;
      if (s.lit !== s.total) allLit = false;
      if (s.on !== 0) noneOn = false;
    }
    check('네 섹션 모두 붙이지 않는다', allStatic);
    check('네 섹션 모두 항목이 전부 보인다', allLit);
    check('스크립트가 단계 표시를 건드리지 않는다', noneOn);
    check('페이지 에러 없음', errs.length === 0, errs.slice(0, 2).join(' / '));
    await ctx.close();
  }

  // ─────────── 폭별 넘침 ───────────
  {
    console.log('— 폭별 가로 넘침 —');
    const bad = [];
    for (const w of [1920, 1600, 1440, 1280, 1100, 1024, 900, 760, 520, 380, 320]) {
      const p = await b.newPage({ viewport: { width: w, height: 900 } });
      await p.goto('http://localhost:8000/index.html', { waitUntil: 'load' });
      await p.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; });
      await p.waitForTimeout(700);
      for (const [sel] of SECTIONS) {
        const g = await geo(p, sel);
        await p.evaluate(v => scrollTo(0, v), g.top + 300);
        await p.waitForTimeout(220);
        if (await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) {
          bad.push(w); break;
        }
      }
      await p.close();
    }
    check('열한 폭 모두 가로 스크롤 없음', bad.length === 0, '넘침: ' + bad.join(','));
  }

  console.log('\n결과: ' + pass + '/' + (pass + fail) + ' 통과');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
