// 진단 결과 검수 목록 — 잘못 찾은 항목 빼기, 읽은 내용 고치기, 위치 짚어보기
const { chromium } = require('playwright');

const WORDS = [
  { text: '누아블룸', xPct: 30, yPct: 20, wPct: 24, hPct: 8, type: '상호명' },
  { text: '010-1234-5678', xPct: 60, yPct: 55, wPct: 18, hPct: 4, type: '전화번호' },
  { text: '1118-1', xPct: 20, yPct: 70, wPct: 10, hPct: 3, type: '지번', approximate: true },
];

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://localhost:8000/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(1200);

  // 보정 화면을 실제로 띄운다 — 숨긴 채로 재면 미리보기 크기가 0이라
  // 위치 테두리 크기를 검증할 수 없다
  await p.evaluate(() => {
    document.getElementById('screen-form').style.display = 'none';
    document.getElementById('screen-correct').style.display = '';
  });

  await p.evaluate(w => {
    const T = window.__anshimTest;
    T.setTargets(JSON.parse(JSON.stringify(w)));
    T.renderTargetPicker();
  }, WORDS);

  const rows = await p.evaluate(() => [...document.querySelectorAll('#targetList li')].map(li => ({
    tid: li.dataset.tid,
    value: li.querySelector('.t-edit') ? li.querySelector('.t-edit').value : null,
    kind: li.querySelector('.t-kind').textContent,
    hasDel: !!li.querySelector('.t-del'),
    checked: li.querySelector('input[type=checkbox]').checked,
  })));
  check('항목 3개가 목록에 나온다', rows.length === 3, '실제 ' + rows.length);
  check('항목마다 고유 번호가 붙는다', new Set(rows.map(r => r.tid)).size === 3);
  check('읽은 내용이 입력칸으로 나온다', rows[0].value === '누아블룸', String(rows[0].value));
  check('항목마다 빼기 단추가 있다', rows.every(r => r.hasDel));
  check('기본은 전부 선택', rows.every(r => r.checked));
  check('근사 위치는 "위치 대략"으로 표시', rows[2].kind === '위치 대략', rows[2].kind);
  check('정밀 위치는 대략으로 표시하지 않는다', rows[0].kind !== '위치 대략' && rows[1].kind !== '위치 대략');

  // 내용 고치기
  await p.evaluate(() => {
    const e = document.querySelector('#targetList li .t-edit');
    e.value = '누아블롬';
    e.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const edited = await p.evaluate(() => window.__anshimTest.getTargets()[0].text);
  check('내용을 고치면 원본 데이터에 반영된다', edited === '누아블롬', edited);

  // 빈 값으로 고치면 되돌린다
  await p.evaluate(() => {
    const e = document.querySelector('#targetList li .t-edit');
    e.value = '   ';
    e.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const blanked = await p.evaluate(() => window.__anshimTest.getTargets()[0].text);
  check('빈 값으로 비우면 원래 내용을 지킨다', blanked === '누아블롬', blanked);

  // 가운데 항목 빼기 — 인덱스가 밀려도 선택이 어긋나면 안 된다
  await p.evaluate(() => {
    const dels = document.querySelectorAll('#targetList li .t-del');
    dels[1].click();
  });
  await p.waitForTimeout(200);
  const after = await p.evaluate(() => ({
    texts: window.__anshimTest.getTargets().map(w => w.text),
    selected: window.__anshimTest.getSelectedTexts().map(w => w.text),
    ids: window.__anshimTest.getSelectedTargetIds(),
    rows: document.querySelectorAll('#targetList li').length,
  }));
  check('뺀 항목이 목록에서 사라진다', after.rows === 2, '실제 ' + after.rows);
  check('뺀 항목이 데이터에서도 사라진다',
    after.texts.length === 2 && after.texts.indexOf('010-1234-5678') === -1, after.texts.join('/'));
  check('남은 항목은 그대로 선택 상태',
    after.selected.length === 2 && after.selected.indexOf('누아블롬') !== -1 && after.selected.indexOf('1118-1') !== -1,
    after.selected.join('/'));

  // 체크를 풀면 처리 대상에서 빠진다 (지운 건 아니다)
  await p.evaluate(() => {
    const cb = document.querySelectorAll('#targetList input[type=checkbox]')[0];
    cb.checked = false;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await p.waitForTimeout(200);
  const unchecked = await p.evaluate(() => ({
    selected: window.__anshimTest.getSelectedTexts().map(w => w.text),
    total: window.__anshimTest.getTargets().length,
  }));
  check('체크를 풀면 처리 대상에서 빠진다', unchecked.selected.length === 1, unchecked.selected.join('/'));
  check('체크를 풀어도 목록에서 지워지지는 않는다', unchecked.total === 2, String(unchecked.total));

  // 위치 짚어보기 — 덮개 핸들이 없는 방식에서도 테두리가 뜬다
  await p.evaluate(() => {
    const img = document.getElementById('previewAfter');
    img.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAHUlEQVR42u3BAQ0AAADCoPdPbQ43oAAAAAAAAAAOBgAAAWfAAAHkYzUAAAAASUVORK5CYII=';
  });
  await p.waitForTimeout(400);
  const peek = await p.evaluate(() => {
    const li = document.querySelector('#targetList li');
    li.dispatchEvent(new MouseEvent('mouseenter'));
    const el = document.querySelector('#previewFrame .cover-peek');
    const on = !!el;
    const size = el ? { w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) } : null;
    const hi = li.classList.contains('hi');
    li.dispatchEvent(new MouseEvent('mouseleave'));
    const off = !document.querySelector('#previewFrame .cover-peek');
    return { on, off, hi, size };
  });
  check('짚으면 사진 위에 위치 테두리가 뜬다', peek.on);
  check('테두리 크기가 0이 아니다', peek.size && peek.size.w > 0 && peek.size.h > 0, JSON.stringify(peek.size));
  check('짚은 줄이 목록에서도 강조된다', peek.hi);
  check('손을 떼면 테두리가 사라진다', peek.off);

  // ── Tesseract가 잘못 읽은 것이 목록에 오르지 않는가 ──────────────────────
  // 실사용: 아이 사진에서 옷 주름을 "개  a 4°"로 읽어 체크된 채로 올라왔고,
  // 사용자가 매번 직접 빼줘야 했다. 뜻을 이루지 않는 것은 아예 올리지 않는다.
  const 잣대 = await p.evaluate(() => {
    const f = window.__anshimTest.looksLikeTextForTest;
    return {
      뺄것: ['개  a 4°', '개', 'a 4', '°', 'ab', '4', '  ', 'ㅁ ㅁ'].map((t) => [t, f(t)]),
      남길것: ['푸른숲유치원', '본죽', '12-3', '02-123-4567', 'ABC', '서울시 강남구'].map((t) => [t, f(t)]),
    };
  });
  잣대.뺄것.forEach(([t, ok]) => check('잘못 읽은 "' + t + '"는 글자로 치지 않는다', ok === false));
  잣대.남길것.forEach(([t, ok]) => check('"' + t + '"는 글자로 친다', ok === true));

  // 조용히 지우면 "왜 못 찾았지"가 된다 — 뺐다는 사실은 밝혀야 한다
  const 안내 = await p.evaluate(() => {
    const T = window.__anshimTest;
    T.setTargets([]);
    T.setDroppedNoiseForTest(2);
    T.renderTargetPicker();
    const 빈목록 = document.querySelector('#targetList .t-none').textContent;
    T.setTargets([{ text: '푸른숲유치원', bbox: { x0: 10, y0: 10, x1: 80, y1: 30 }, confidence: 90 }]);
    T.setDroppedNoiseForTest(1);
    T.renderTargetPicker();
    const 남은줄 = document.querySelectorAll('#targetList li').length;
    const 아래안내 = document.querySelector('#targetList .t-none');
    T.setDroppedNoiseForTest(0);
    T.renderTargetPicker();
    const 뺀게없을때 = !document.querySelector('#targetList .t-none');
    return { 빈목록, 남은줄, 아래안내: 아래안내 ? 아래안내.textContent : '', 뺀게없을때 };
  });
  check('전부 잡음이면 뺐다고 알린다', /잘못 읽은 2곳은 뺐어요/.test(안내.빈목록), 안내.빈목록);
  check('전부 잡음이어도 브러시를 안내한다', /브러시/.test(안내.빈목록));
  check('남은 것이 있으면 목록은 그대로 보인다', 안내.남은줄 === 1, String(안내.남은줄));
  check('남은 것이 있어도 뺀 개수를 알린다', /1곳은 목록에서 뺐어요/.test(안내.아래안내), 안내.아래안내);
  check('뺀 것이 없으면 군더더기 안내가 안 뜬다', 안내.뺀게없을때);

  check('페이지 에러 없음', errs.length === 0, errs.slice(0, 2).join(' / '));

  console.log('\n결과: ' + pass + '/' + (pass + fail) + ' 통과');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
