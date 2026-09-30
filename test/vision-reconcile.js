// 아이섀도우 — Claude가 읽은 한글을 Vision 글자로 교정(reconcileWordsWithVision) 테스트
//
// 사용법: 이 폴더(test)에서 → node vision-reconcile.js
//   프론트가 http://localhost:8000 (또는 3001)에서 돌고 있어야 합니다. 네트워크·AI 비용 없음 —
//   합성 데이터로 순수 함수만 검사합니다.
//
// 배경: 명찰 사진 10장 실측(정답 글자 32개)에서 Vision은 25개, Claude는 18개를 읽었다.
// Claude의 오독은 대부분 글자 하나가 바뀐 것이었다 — "해님반"→"해남반", "새싹유치원"→
// "새빛유치원", "누아블룸"→"누아블롱". 이 함수는 그런 것만 Vision 표기로 바로잡고,
// **맞게 읽은 것을 틀리게 만들 위험이 있는 경우는 건드리지 않는다**(아래 "건드리면 안 되는 것").
const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label + (detail ? '  (' + detail + ')' : '')); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '  (' + detail + ')' : '')); }
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });

  const has = await page.evaluate(() => !!(window.__anshimTest && window.__anshimTest.reconcileWordsWithVision));
  if (!has) {
    console.log('  FAIL  window.__anshimTest.reconcileWordsWithVision 이 없습니다');
    await browser.close();
    process.exitCode = 1;
    return;
  }

  // 한 번에 돌리고 결과만 가져온다. tokens는 Vision이 쪼개서 준 조각들(글자만 있으면 된다).
  const run = (claudeText, tokens) => page.evaluate(({ claudeText, tokens }) => {
    const words = [{ text: claudeText }];
    const n = window.__anshimTest.reconcileWordsWithVision(words, tokens.map((t) => ({ text: t })));
    return { n, text: words[0].text, claudeText: words[0].claudeText, reconciled: !!words[0].reconciled };
  }, { claudeText, tokens });

  console.log('\n고쳐야 하는 것 (실측에서 본 오독)');
  let r = await run('해남반 6세', ['새싹', '유치원', '김지후', '해님', '반', '6', '세']);
  check('"해남반 6세" → "해님반6세" (숫자 6이 같아서 교정)', r.text === '해님반6세' && r.n === 1, r.text);
  check('원래 글자를 claudeText에 남김', r.claudeText === '해남반 6세');
  r = await run('새빛유치원', ['(', 'Kim', 'Min', '-', 'jun', ')', '김민준', '새싹', '유치원']);
  check('"새빛유치원" → "새싹유치원"', r.text === '새싹유치원', r.text);
  r = await run('별나반', ['김서현', '별님', '반']);
  check('"별나반" → "별님반" (3글자, 1글자 차이)', r.text === '별님반', r.text);
  r = await run('누아블롱', ['꽃집', '누아', '블룸']);
  check('"누아블롱" → "누아블룸" (조각 둘을 이어 붙여 비교)', r.text === '누아블룸', r.text);
  r = await run('복유지원', ['복', '유치원']);
  check('"복유지원" → "복유치원"', r.text === '복유치원', r.text);

  console.log('\n건드리면 안 되는 것 (맞게 읽은 것을 틀리게 만들 수 있다)');
  r = await run('새싹유치원', ['새싹', '유치원']);
  check('이미 같은 글은 그대로 (교정 표시 없음)', r.text === '새싹유치원' && !r.reconciled && r.n === 0);
  r = await run('사랑아파트 101동', ['사랑', '아파트', '102동']);
  check('숫자가 다르면 건드리지 않음 (101동 ≠ 102동)', r.text === '사랑아파트 101동' && r.n === 0, r.text);
  r = await run('010-4956-6091', ['010-4956-6092']);
  check('전화번호(한글 없음)는 건드리지 않음', r.text === '010-4956-6091' && r.n === 0);
  r = await run('Kim Min-jun', ['Kim', 'Min', 'jun']);
  check('영문 이름은 건드리지 않음', r.text === 'Kim Min-jun' && r.n === 0);
  r = await run('서우', ['서유']);
  check('2글자는 건드리지 않음 (한 글자 차이가 다른 낱말일 확률이 큼)', r.text === '서우' && r.n === 0);
  r = await run('새빛유원', ['새싹', '유치원']);
  check('4글자에 2글자 차이면 건드리지 않음 (허용은 1글자)', r.text === '새빛유원' && r.n === 0, r.text);
  r = await run('햇살어린이집', ['꽃집', '누아', '블룸']);
  check('전혀 다른 글이면 건드리지 않음', r.text === '햇살어린이집' && r.n === 0);

  console.log('\n경계 조건');
  const edge = await page.evaluate(() => {
    const T = window.__anshimTest;
    const w1 = [{ text: '해남반' }];
    return {
      nullVision: T.reconcileWordsWithVision(w1, null),
      emptyVision: T.reconcileWordsWithVision(w1, []),
      nullWords: T.reconcileWordsWithVision(null, [{ text: '해님' }]),
      unchanged: w1[0].text,
      multi: (() => {
        const ws = [{ text: '해남반' }, { text: '새빛유치원' }, { text: '02-123-4567' }];
        const n = T.reconcileWordsWithVision(ws, [{ text: '해님반' }, { text: '새싹' }, { text: '유치원' }]);
        return { n, texts: ws.map((w) => w.text) };
      })(),
    };
  });
  check('Vision 결과가 null이면 0을 돌려주고 안 터짐', edge.nullVision === 0 && edge.unchanged === '해남반');
  check('Vision 결과가 비어 있어도 안 터짐', edge.emptyVision === 0);
  check('words가 null이어도 안 터짐', edge.nullWords === 0);
  check('여러 개를 한 번에: 고친 개수를 돌려줌', edge.multi.n === 2 && edge.multi.texts[0] === '해님반' && edge.multi.texts[1] === '새싹유치원' && edge.multi.texts[2] === '02-123-4567', JSON.stringify(edge.multi));

  if (errors.length) {
    console.log('\n  페이지 에러: ' + errors.join(' | '));
    fail++;
  }
  await browser.close();
  console.log('\n결과: ' + pass + '/' + (pass + fail) + ' 통과');
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
