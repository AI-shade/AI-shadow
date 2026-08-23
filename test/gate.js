/*
 * 팀 접근 코드 검증.
 *
 * 배포하면 주소를 아는 사람은 누구나 /api/*를 부를 수 있고, 그 비용은 우리가 낸다.
 * 코드를 모르면 아무것도 돌아가지 않아야 한다.
 *
 * 이 테스트는 자기 서버를 직접 띄운다(빈 포트, 테스트용 코드). 돈 나가는 API는
 * 부르지 않는다 — /api/access-check와 /api/flux-status는 둘 다 서버 안에서만 답한다.
 */
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const path = require('node:path');
const net = require('node:net');

const CODE = '안심앨범팀2026'; // 한글이 헤더에 그대로 들어가면 fetch가 예외를 던진다 — 일부러 한글로 본다
let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

function freePort() {
  return new Promise((res) => {
    const s = net.createServer();
    s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); });
  });
}
function waitFor(url, ms) {
  const end = Date.now() + ms;
  return new Promise(function loop(res, rej) {
    fetch(url).then(() => res()).catch(() => {
      if (Date.now() > end) return rej(new Error('서버가 안 뜸: ' + url));
      setTimeout(() => loop(res, rej), 200);
    });
  });
}

(async () => {
  const port = await freePort();
  const root = path.join(__dirname, '..');
  const server = spawn(process.execPath, [path.join(root, 'server', 'server.js')], {
    cwd: root,
    env: Object.assign({}, process.env, { PORT: String(port), ANSHIM_ACCESS_CODE: CODE }),
    stdio: 'ignore',
  });
  const base = 'http://localhost:' + port;
  try {
    await waitFor(base + '/api/access-check', 15000);

    console.log('\n[서버가 코드를 제대로 가리는가]');
    const enc = (c) => (c ? { 'x-anshim-code': encodeURIComponent(c) } : {});
    const check = async (c) => (await fetch(base + '/api/access-check', { headers: enc(c) })).json();
    ok((await check(null)).required === true, '코드가 필요한 상태라고 알린다');
    ok((await check(null)).ok === false, '코드 없이는 통과 못 한다');
    ok((await check('wrong')).ok === false, '틀린 영문 코드는 막힌다');
    ok((await check('아무거나')).ok === false, '틀린 한글 코드는 막힌다');
    ok((await check(CODE)).ok === true, '맞는 한글 코드는 통과한다');

    const noCode = await fetch(base + '/api/diagnose-risk',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    ok(noCode.status === 401, '코드 없이 진단 API를 부르면 401', '받은 값 ' + noCode.status);
    const withCode = await fetch(base + '/api/flux-status', { headers: enc(CODE) });
    ok(withCode.status === 200, '코드가 있으면 API가 열린다', '받은 값 ' + withCode.status);

    console.log('\n[화면에서]');
    const browser = await chromium.launch();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
    const 보낸헤더 = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/')) 보낸헤더.push(r.headers()['x-anshim-code'] || '(없음)');
    });

    await page.goto(base + '/', { waitUntil: 'load' });
    await page.waitForTimeout(1400);
    const 문열림 = () => page.evaluate(() => document.getElementById('accessGate').classList.contains('on'));
    ok(await 문열림(), '들어오면 문이 뜬다');
    ok(await page.evaluate(() => {
      const r = document.getElementById('accessGate').getBoundingClientRect();
      return r.width >= innerWidth && r.height >= innerHeight;
    }), '문이 화면 전체를 덮는다');

    await page.fill('#accessInput', '아무거나');
    await page.click('#accessBtn');
    await page.waitForTimeout(600);
    const err = await page.textContent('#accessErr');
    ok(/맞지 않아요/.test(err), '틀리면 "코드가 맞지 않다"고 말한다', err);
    ok(!/확인하지 못했어요/.test(err), '한글 코드를 넣어도 통신 오류로 새지 않는다', err);
    ok(await 문열림(), '틀린 코드로는 문이 안 열린다');

    await page.fill('#accessInput', CODE);
    await page.click('#accessBtn');
    await page.waitForTimeout(600);
    ok(!(await 문열림()), '맞는 코드를 넣으면 문이 열린다');

    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1400);
    ok(!(await 문열림()), '새로고침해도 다시 묻지 않는다');

    const st = await page.evaluate(() => window.__anshimTest.apiHeadersForTest({ 'X-A': '1' }));
    ok(st['x-anshim-code'] === encodeURIComponent(CODE), '요청 헤더에 코드가 인코딩되어 붙는다');
    ok(st['X-A'] === '1', '원래 붙이던 헤더도 그대로 간다');

    const 남 = await (await browser.newContext()).newPage();
    await 남.goto(base + '/', { waitUntil: 'load' });
    await 남.waitForTimeout(1400);
    ok(await 남.evaluate(() => document.getElementById('accessGate').classList.contains('on')),
      '링크만 아는 사람에게는 문이 뜬다');

    ok(errs.length === 0, '콘솔 에러가 없다', errs.join(' | '));
    await browser.close();
  } finally {
    server.kill();
  }
  console.log('\n결과: ' + pass + '/' + (pass + fail) + ' 통과');
  process.exit(fail === 0 ? 0 : 1);
})();
