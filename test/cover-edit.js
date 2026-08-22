// 덮개 위치 조정 + 브러시 획 되돌리기
// - 위치 상자는 어떤 보정 방식에서든 보여야 한다 (예전엔 덮기 계열에서만 보였다)
// - 브러시 도구는 결과에 반영되는 방식에서만 보인다
// - 획 하나씩 되돌릴 수 있다
const { chromium } = require('playwright');

const PNG_100 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAHUlEQVR42u3BAQ0AAADCoPdPbQ43oAAAAAAAAAAOBgAAAWfAAAHkYzUAAAAASUVORK5CYII=';

const WORDS = [
  { text: '누아블룸', xPct: 30, yPct: 22, wPct: 26, hPct: 9, type: '상호명' },
  { text: '010-1234-5678', xPct: 62, yPct: 58, wPct: 20, hPct: 5, type: '전화번호' },
];

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

async function setup(p, method, mode) {
  return p.evaluate(async a => {
    const [m, mo] = a;
    const T = window.__anshimTest;
    T.setMethodForTest(m);
    T.setCoverEditMode(mo);
    T.renderCoverHandles();
    await new Promise(r => setTimeout(r, 120));
    const tools = document.getElementById('coverTools');
    return {
      tools: getComputedStyle(tools).display,
      noBrush: tools.classList.contains('no-brush'),
      isBrush: tools.classList.contains('is-brush'),
      handles: document.querySelectorAll('#previewFrame .cover-handle').length,
      layers: document.querySelectorAll('#previewFrame .brush-layer').length,
      mode: T.getCoverEditMode(),
      // 브러시 "전환 단추"와 브러시 "조절 도구"는 다르다 —
      // 조절 도구(굵기·지우개·되돌리기)는 브러시 모드일 때만 나온다.
      brushBtnShown: getComputedStyle(document.querySelector('[data-edit="brush"]')).display !== 'none',
      brushCtrlShown: getComputedStyle(document.querySelector('.ct-only-brush')).display !== 'none',
      undoShown: getComputedStyle(document.getElementById('brushUndo')).display !== 'none',
    };
  }, [method, mode]);
}

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1100 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://localhost:8000/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(1200);

  await p.evaluate(async a => {
    const [words, png] = a;
    document.getElementById('screen-form').style.display = 'none';
    document.getElementById('screen-correct').style.display = '';
    window.__anshimTest.setTargets(JSON.parse(JSON.stringify(words)));
    window.__anshimTest.renderTargetPicker();
    const img = document.getElementById('previewAfter');
    img.src = png;
    await new Promise(r => { img.onload = r; setTimeout(r, 800); });
  }, [WORDS, PNG_100]);

  // ── 위치 조정은 모든 방식에서
  let r = await setup(p, 'blur', 'shape');
  check('흐림에서도 위치 상자가 보인다', r.handles === 2, '상자 ' + r.handles + '개');
  check('흐림에서도 덮개 도구줄이 뜬다', r.tools !== 'none', r.tools);
  check('흐림에서는 브러시 도구를 감춘다', r.noBrush === true && r.brushBtnShown === false,
    'noBrush=' + r.noBrush + ' brushShown=' + r.brushBtnShown);

  r = await setup(p, 'ai', 'shape');
  check('AI 배경교체에서도 위치 상자가 보인다', r.handles === 2, '상자 ' + r.handles + '개');

  r = await setup(p, 'sticker', 'shape');
  check('덮기에서는 브러시 전환 단추가 보인다', r.noBrush === false && r.brushBtnShown === true,
    'noBrush=' + r.noBrush + ' brushBtn=' + r.brushBtnShown);
  check('도형 모드에서는 붓 조절 도구를 감춘다', r.brushCtrlShown === false, String(r.brushCtrlShown));

  r = await setup(p, 'inpaint', 'shape');
  check('AI 지우고 메우기에서도 브러시 도구가 보인다', r.noBrush === false);

  // 브러시 모드에서 다른 방식으로 옮기면 도형으로 되돌아온다
  r = await setup(p, 'sticker', 'brush');
  check('덮기 + 브러시면 칠하는 층이 생긴다', r.layers === 1 && r.mode === 'brush',
    'layers=' + r.layers + ' mode=' + r.mode);
  check('브러시 모드에서는 붓 조절 도구가 나온다', r.brushCtrlShown === true);
  check('되돌리기 단추도 붓 조절 도구 안에 있다', r.undoShown === true);
  r = await setup(p, 'blur', 'brush');
  check('브러시가 안 먹는 방식으로 옮기면 도형으로 되돌아온다', r.mode === 'shape', r.mode);
  check('되돌아오면 칠하는 층도 사라진다', r.layers === 0, String(r.layers));

  // ── 붓 커서
  const cursors = await p.evaluate(() => {
    const T = window.__anshimTest;
    const out = {};
    T.setCoverEditMode('brush');
    document.getElementById('brushSize').value = '30';
    document.getElementById('brushSize').dispatchEvent(new Event('input', { bubbles: true }));
    out.small = T.brushCursorCss();
    document.getElementById('brushSize').value = '70';
    document.getElementById('brushSize').dispatchEvent(new Event('input', { bubbles: true }));
    out.big = T.brushCursorCss();
    document.getElementById('brushErase').checked = true;
    document.getElementById('brushErase').dispatchEvent(new Event('change', { bubbles: true }));
    out.erase = T.brushCursorCss();
    document.getElementById('brushErase').checked = false;
    document.getElementById('brushErase').dispatchEvent(new Event('change', { bubbles: true }));
    return out;
  });
  check('커서가 원 모양 SVG다', cursors.small.indexOf('circle') !== -1);
  check('붓 굵기를 키우면 커서도 커진다',
    cursors.small.indexOf("width='30'") !== -1 && cursors.big.indexOf("width='70'") !== -1,
    cursors.small.slice(40, 80));
  check('커서 중심이 원 한가운데다', / 35 35, crosshair$/.test(cursors.big), cursors.big.slice(-24));
  check('지우개는 점선 원으로 구분된다', cursors.erase.indexOf('stroke-dasharray') !== -1);
  check('낡은 cell 커서를 더 쓰지 않는다',
    (await p.evaluate(() => [...document.styleSheets].some(ss => { try { return [...ss.cssRules].some(r => /cursor:\s*cell/.test(r.cssText)) } catch (e) { return false } }))) === false);

  // ── 획 되돌리기
  await setup(p, 'sticker', 'brush');
  // 히어로가 첫 화면을 꽉 채우게 되면서 도구가 한 화면 아래로 내려갔다.
  // 마우스로 실제로 칠하려면 칠할 층이 화면 안에 들어와 있어야 한다.
  await p.evaluate(() => {
    document.documentElement.style.scrollBehavior = 'auto';
    document.querySelector('#previewFrame').scrollIntoView({ block: 'center' });
  });
  await p.waitForTimeout(400);
  const box = await p.evaluate(() => {
    const l = document.querySelector('#previewFrame .brush-layer');
    const r = l.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  check('칠할 층이 화면에 자리를 차지한다', box.w > 10 && box.h > 10, JSON.stringify(box));

  // 층의 화면 좌표는 스크롤에 따라 달라진다 — 칠할 때마다 다시 잰다
  const stroke = async (dx, dy) => {
    const b = await p.evaluate(() => {
      const r = document.querySelector('#previewFrame .brush-layer').getBoundingClientRect();
      return { x: r.left, y: r.top };
    });
    await p.mouse.move(b.x + dx, b.y + dy);
    await p.mouse.down();
    await p.mouse.move(b.x + dx + 18, b.y + dy + 12, { steps: 4 });
    await p.mouse.up();
    await p.waitForTimeout(350);
  };

  const undoBtnDisabled = () => p.evaluate(() => document.getElementById('brushUndo').disabled);
  check('칠하기 전에는 되돌리기 단추가 꺼져 있다', await undoBtnDisabled() === true);

  await stroke(box.w * 0.25, box.h * 0.3);
  let n = await p.evaluate(() => window.__anshimTest.brushStrokeCount());
  check('한 획 그으면 획이 하나 기록된다', n === 1, String(n));
  check('획이 생기면 되돌리기 단추가 켜진다', await undoBtnDisabled() === false);

  await stroke(box.w * 0.6, box.h * 0.6);
  n = await p.evaluate(() => window.__anshimTest.brushStrokeCount());
  check('두 번째 획도 따로 기록된다', n === 2, String(n));

  // 되돌리기 한 번 → 두 번째 획만 사라진다
  await p.evaluate(() => document.getElementById('brushUndo').click());
  await p.waitForTimeout(400);
  n = await p.evaluate(() => window.__anshimTest.brushStrokeCount());
  check('되돌리면 마지막 획만 사라진다', n === 1, String(n));
  const stillPainted = await p.evaluate(() => {
    const c = window.__anshimTest.getTargets && document.querySelector('#previewFrame .brush-layer');
    return !!c;
  });
  check('되돌린 뒤에도 칠하는 층은 남아 있다', stillPainted);

  await p.evaluate(() => document.getElementById('brushUndo').click());
  await p.waitForTimeout(400);
  n = await p.evaluate(() => window.__anshimTest.brushStrokeCount());
  check('전부 되돌리면 획이 0이 된다', n === 0, String(n));
  check('획이 없으면 되돌리기 단추가 다시 꺼진다', await undoBtnDisabled() === true);

  await p.evaluate(() => window.__anshimTest.undoBrushStroke());
  n = await p.evaluate(() => window.__anshimTest.brushStrokeCount());
  check('빈 상태에서 더 되돌려도 안전하다', n === 0, String(n));

  // Ctrl+Z
  await setup(p, 'sticker', 'brush');
  await p.evaluate(() => document.querySelector('#previewFrame').scrollIntoView({ block: 'center' }));
  await p.waitForTimeout(400);
  await stroke(box.w * 0.4, box.h * 0.4);
  n = await p.evaluate(() => window.__anshimTest.brushStrokeCount());
  const before = n;
  await p.keyboard.press('Control+z');
  await p.waitForTimeout(400);
  n = await p.evaluate(() => window.__anshimTest.brushStrokeCount());
  check('Ctrl+Z로도 되돌아간다', before === 1 && n === 0, before + '→' + n);

  check('페이지 에러 없음', errs.length === 0, errs.slice(0, 2).join(' / '));

  console.log('\n결과: ' + pass + '/' + (pass + fail) + ' 통과');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
