// 페이지를 열었을 때 어디서 시작하는가
// - 새로고침하면 히어로(맨 위)부터 보여야 한다
// - 주소에 #앵커가 있으면 그 자리로 가야 한다
// - 화면 전환(진단 → 보정 → 검증)에서는 여전히 도구 위쪽으로 올려줘야 한다
const { chromium } = require('playwright');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

const heroInView = p => p.evaluate(() => {
  const h = document.querySelector('.hero-title').getBoundingClientRect();
  return h.top >= 0 && h.top < innerHeight;
});

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  // 1) 첫 진입
  await p.goto('http://localhost:8000/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(1500);
  check('첫 진입은 맨 위에서 시작한다',
    (await p.evaluate(() => Math.round(scrollY))) === 0,
    'scrollY=' + (await p.evaluate(() => Math.round(scrollY))));
  check('첫 진입에 히어로가 보인다', await heroInView(p));

  // 2) 한참 내렸다가 새로고침 — 브라우저가 위치를 되살리면 안 된다
  await p.evaluate(() => scrollTo(0, 5000));
  await p.waitForTimeout(400);
  await p.reload({ waitUntil: 'load' });
  await p.waitForTimeout(1600);
  check('새로고침해도 맨 위에서 시작한다',
    (await p.evaluate(() => Math.round(scrollY))) === 0,
    'scrollY=' + (await p.evaluate(() => Math.round(scrollY))));
  check('새로고침 후에도 히어로가 보인다', await heroInView(p));
  check('스크롤 되살리기를 꺼둔다',
    (await p.evaluate(() => history.scrollRestoration)) === 'manual');

  // 3) #앵커로 들어오면 그 자리로
  await p.goto('http://localhost:8000/index.html#faq', { waitUntil: 'load' });
  await p.waitForTimeout(1600);
  const faq = await p.evaluate(() => ({
    y: Math.round(scrollY),
    near: Math.abs(document.getElementById('faq').getBoundingClientRect().top) < 500,
  }));
  check('#앵커로 들어오면 그 자리로 간다', faq.y > 1000 && faq.near, 'y=' + faq.y + ' near=' + faq.near);

  // 4) 화면 전환은 여전히 도구로 올려준다
  await p.goto('http://localhost:8000/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(1400);
  await p.evaluate(() => {
    // 검증 화면을 띄우고 "다른 사진으로 처음부터 다시"를 누르면 showScreen('form')이 돈다
    document.getElementById('screen-form').style.display = 'none';
    document.getElementById('screen-verify').style.display = 'block';
    scrollTo(0, 6000);
  });
  await p.waitForTimeout(400);
  const before = await p.evaluate(() => ({
    y: Math.round(scrollY),
    toolTop: Math.round(document.getElementById('tool').getBoundingClientRect().top),
  }));
  check('전환 전에는 도구가 화면 밖에 있다', before.toolTop < -200, 'toolTop=' + before.toolTop);
  await p.evaluate(() => document.getElementById('restartBtn').click());
  await p.waitForTimeout(900);
  const after = await p.evaluate(() => ({
    y: Math.round(scrollY),
    toolTop: Math.round(document.getElementById('tool').getBoundingClientRect().top),
  }));
  // 상단 네비가 sticky라 도구 윗변이 네비 아래(약 78px)에 놓이는 게 정상이다
  check('화면을 전환하면 도구 위쪽으로 올려준다',
    after.toolTop >= 0 && after.toolTop < 200,
    before.y + ' → y=' + after.y + ' toolTop=' + after.toolTop);

  check('페이지 에러 없음', errs.length === 0, errs.slice(0, 2).join(' / '));

  console.log('\n결과: ' + pass + '/' + (pass + fail) + ' 통과');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
