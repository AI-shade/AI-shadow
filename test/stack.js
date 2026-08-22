// 보정 누적 — 방식을 겹쳐 쌓고, 마지막 것부터 되돌리고, 검증에 전 단계를 넘긴다
const { chromium } = require('playwright');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

// 단색 캔버스를 만들어 "보정 결과"인 척한다 — 어떤 그림이 쌓였는지 색으로 추적한다
const MAKE = `(function (r, g, bl) {
  var c = document.createElement('canvas');
  c.width = 40; c.height = 30;
  var x = c.getContext('2d');
  x.fillStyle = 'rgb(' + r + ',' + g + ',' + bl + ')';
  x.fillRect(0, 0, 40, 30);
  return c;
})`;

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://localhost:8000/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(1200);

  await p.evaluate(() => {
    document.getElementById('screen-form').style.display = 'none';
    document.getElementById('screen-correct').style.display = '';
  });

  // 원본을 흰 사진으로 두고 시작
  const white = await p.evaluate(MAKE + '(255,255,255).toDataURL("image/png")');
  await p.evaluate(u => window.__anshimTest.stackSeed(u), white);

  let st = await p.evaluate(() => window.__anshimTest.stackState());
  check('처음엔 쌓인 게 없다', st.steps.length === 0 && st.history === 0);
  check('처음엔 안내문이 보인다',
    await p.evaluate(() => getComputedStyle(document.getElementById('stackEmpty')).display) === 'block');

  // 적용할 결과가 없으면 아무 일도 없어야 한다
  p.once('dialog', d => d.dismiss());
  await p.evaluate(() => window.__anshimTest.applyStep());
  st = await p.evaluate(() => window.__anshimTest.stackState());
  check('결과 없이 적용을 눌러도 쌓이지 않는다', st.steps.length === 0);

  // 1단계 — 빨강
  await p.evaluate(MK => {
    const c = eval(MK)(255, 0, 0);
    window.__anshimTest.stackPending(c, { method: 'blur', detail: '배경만 흐리게' });
    window.__anshimTest.applyStep();
  }, MAKE);
  st = await p.evaluate(() => window.__anshimTest.stackState());
  check('1단계가 쌓인다', st.steps.length === 1 && st.steps[0].method === 'blur', JSON.stringify(st.steps));
  check('기준 사진이 1단계 결과로 바뀐다', st.base !== white && st.base.indexOf('data:image/png') === 0);
  check('되돌리기용 이전 사진이 보관된다', st.history === 1, String(st.history));
  check('쌓인 뒤엔 안내문이 사라진다',
    await p.evaluate(() => getComputedStyle(document.getElementById('stackEmpty')).display) === 'none');

  const rows1 = await p.evaluate(() => [...document.querySelectorAll('#stackList li')].map(li => ({
    text: li.querySelector('.st-text').textContent,
    undoDisabled: li.querySelector('.st-undo').disabled,
  })));
  check('목록에 방식 이름이 한국어로 나온다', rows1.length === 1 && rows1[0].text === '배경 흐림', JSON.stringify(rows1));

  // 2단계 — 파랑
  await p.evaluate(MK => {
    const c = eval(MK)(0, 0, 255);
    window.__anshimTest.stackPending(c, { method: 'sticker', detail: '간판을 주변색으로 덮음' });
    window.__anshimTest.applyStep();
  }, MAKE);
  st = await p.evaluate(() => window.__anshimTest.stackState());
  check('2단계까지 쌓인다', st.steps.length === 2, String(st.steps.length));

  const rows2 = await p.evaluate(() => [...document.querySelectorAll('#stackList li')].map(li => ({
    text: li.querySelector('.st-text').textContent,
    undoDisabled: li.querySelector('.st-undo').disabled,
  })));
  check('마지막 것만 되돌릴 수 있다',
    rows2.length === 2 && rows2[0].undoDisabled === true && rows2[1].undoDisabled === false,
    JSON.stringify(rows2));

  // 최종 결과는 마지막에 쌓인 그림(파랑)이어야 한다
  const finalPx = await p.evaluate(async () => {
    const c = await window.__anshimTest.getFinalCanvas();
    if (!c) return null;
    const d = c.getContext('2d').getImageData(5, 5, 1, 1).data;
    return [d[0], d[1], d[2]];
  });
  check('최종 결과가 마지막에 쌓은 그림이다',
    finalPx && finalPx[2] === 255 && finalPx[0] === 0, JSON.stringify(finalPx));

  // 검증에 넘길 설명에 두 단계가 모두 들어가야 한다
  const meta = await p.evaluate(() => window.__anshimTest.combinedMeta());
  check('검증 설명에 1단계가 들어간다', meta && meta.detail.indexOf('배경만 흐리게') !== -1, meta && meta.detail);
  check('검증 설명에 2단계가 들어간다', meta && meta.detail.indexOf('간판을 주변색으로 덮음') !== -1);
  check('검증 설명이 순서를 매긴다', meta && /1\)/.test(meta.detail) && /2\)/.test(meta.detail), meta && meta.detail);
  check('검증에 넘기는 방식은 마지막 것', meta && meta.method === 'sticker', meta && meta.method);

  // 되돌리기 — 1단계(빨강)로 돌아가야 한다
  await p.evaluate(() => window.__anshimTest.undoStep());
  st = await p.evaluate(() => window.__anshimTest.stackState());
  check('되돌리면 단계가 하나 줄어든다', st.steps.length === 1, String(st.steps.length));
  const undonePx = await p.evaluate(async () => {
    const c = await window.__anshimTest.getFinalCanvas();
    const d = c.getContext('2d').getImageData(5, 5, 1, 1).data;
    return [d[0], d[1], d[2]];
  });
  check('되돌리면 그림도 1단계로 돌아간다',
    undonePx && undonePx[0] === 255 && undonePx[2] === 0, JSON.stringify(undonePx));

  // 전부 되돌리면 원본
  await p.evaluate(() => window.__anshimTest.undoStep());
  st = await p.evaluate(() => window.__anshimTest.stackState());
  check('전부 되돌리면 쌓인 게 없다', st.steps.length === 0 && st.history === 0);
  check('전부 되돌리면 기준 사진이 원본으로 돌아간다', st.base === white);
  const noneCanvas = await p.evaluate(async () => await window.__anshimTest.getFinalCanvas());
  check('쌓인 게 없으면 최종 결과도 없다', noneCanvas === null);
  check('쌓인 게 없으면 검증 설명도 없다',
    await p.evaluate(() => window.__anshimTest.combinedMeta()) === null);

  // 더 되돌려도 터지지 않아야 한다
  await p.evaluate(() => { window.__anshimTest.undoStep(); window.__anshimTest.undoStep(); });
  st = await p.evaluate(() => window.__anshimTest.stackState());
  check('빈 상태에서 더 되돌려도 안전하다', st.steps.length === 0 && st.base === white);

  // 한 단계만 있으면 설명을 번호 없이 그대로 넘긴다
  await p.evaluate(MK => {
    const c = eval(MK)(0, 128, 0);
    window.__anshimTest.stackPending(c, { method: 'blur', detail: '배경만 흐리게' });
    window.__anshimTest.applyStep();
  }, MAKE);
  const one = await p.evaluate(() => window.__anshimTest.combinedMeta());
  check('한 단계면 설명을 그대로 넘긴다', one && one.detail === '배경만 흐리게', one && one.detail);

  check('페이지 에러 없음', errs.length === 0, errs.slice(0, 2).join(' / '));

  console.log('\n결과: ' + pass + '/' + (pass + fail) + ' 통과');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
