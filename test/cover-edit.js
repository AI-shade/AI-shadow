// 덮개 위치 조정 — 간판 덮기 화면 단순화 이후
//
// 사용법: 이 폴더(test)에서 → node cover-edit.js
//   프론트가 http://localhost:8000 에서 돌고 있어야 합니다. **AI 호출 없음 (비용 0).**
//
// 배경: 멘토 지적(선택지 4개 안쪽)으로 간판 덮기의 선택지를 걷어냈다 —
//   덮는 방식(자동/주변색/모자이크)·픽셀 크기, 도형/브러시 전환, 붓 굵기·지우개·직전 획 취소.
//   위치는 상자를 끌어 맞추고, 놓친 곳은 «+ 놓친 곳 추가»로 더한다.
// 이 테스트가 지키는 것:
//   ① 위치 상자는 어떤 보정 방식에서든 보인다 (예전엔 덮기 계열에서만 보였다)
//   ② 없앤 선택지가 화면에 되살아나지 않았다
//   ③ 남겨 둔 것(놓친 곳 추가 · AI 글자 교체 줄)은 그대로 있다
const { chromium } = require('playwright');
const URL = process.env.ANSHIM_URL || 'http://localhost:8000/index.html';

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

async function setup(p, method) {
  return p.evaluate(async (m) => {
    const T = window.__anshimTest;
    T.setMethodForTest(m);
    T.renderCoverHandles();
    await new Promise(r => setTimeout(r, 120));
    return {
      handles: document.querySelectorAll('#previewFrame .cover-handle').length,
      grips: document.querySelectorAll('#previewFrame .cover-grip').length,
    };
  }, method);
}

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1100 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.goto(URL, { waitUntil: 'load' });
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

  console.log('위치 상자');
  for (const [m, label] of [['blur', '흐림'], ['ai', 'AI 배경교체'], ['sticker', '자연스럽게 덮기']]) {
    const r = await setup(p, m);
    check(label + '에서도 위치 상자가 보인다', r.handles === 2, '상자 ' + r.handles + '개');
    check(label + '에서도 크기 손잡이가 붙는다', r.grips === 2, '손잡이 ' + r.grips + '개');
  }

  console.log('\n없앤 선택지가 되살아나지 않았다');
  const gone = await p.evaluate(() => {
    const has = (sel) => !!document.querySelector(sel);
    return {
      fillStyle: has('#fillStyle') || has('.fs-btn') || has('#fillPixel'),
      brushToggle: has('.ct-btn') || has('[data-edit]'),
      brushTools: has('#brushSize') || has('#brushErase') || has('#brushUndo') || has('.ct-only-brush'),
      brushLayer: has('.brush-layer'),
    };
  });
  check('덮는 방식·픽셀 크기가 없다', gone.fillStyle === false);
  check('도형/브러시 전환이 없다', gone.brushToggle === false);
  check('붓 굵기·지우개·획 되돌리기가 없다', gone.brushTools === false);
  check('칠하는 층이 만들어지지 않는다', gone.brushLayer === false);

  console.log('\n남겨 둔 것');
  const kept = await p.evaluate(() => ({
    missedBtn: !!document.getElementById('addMissedBtn'),
    aiRow: !!document.getElementById('signAiRow'),
    inAiBox: !!document.querySelector('#aiMore #signAiUpgradeBtn') && !!document.querySelector('#aiMore #signAiRow'),
    hint: (document.querySelector('.target-picker-head .hint') || {}).textContent || '',
    oldTools: !!document.getElementById('coverTools') || !!document.querySelector('.cover-hint') || !!document.getElementById('recommendFlow'),
    subtitle: Array.from(document.querySelectorAll('.correct-left > .evidence')).map(e => e.textContent).join('|'),
  }));
  check('«+ 놓친 곳 추가»가 있다', kept.missedBtn);
  check('AI 글자 교체 줄이 있다', kept.aiRow);
  check('간판 글자 AI 단추가 «AI로 더 다듬기» 구역 안에 있다', kept.inAiBox);
  check('안내가 목록 머리 한 곳에만 있고 상자 끌기를 말한다', /끌어/.test(kept.hint), kept.hint.slice(0, 60));
  check('따로 떠 있던 도구줄·낡은 추천 문구·제목 아래 홍보 문구가 없다', kept.oldTools === false && kept.subtitle === '', kept.subtitle.slice(0, 40));

  check('페이지 에러 없음', errs.length === 0, errs.slice(0, 2).join(' / '));

  console.log('\n결과: ' + pass + '/' + (pass + fail) + ' 통과');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
