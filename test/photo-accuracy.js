// 아이섀도우 — 사진 103장 정답표로 진단 정확도를 잰다
//
// 사용법: 이 폴더(test)에서 → node photo-accuracy.js
//   백엔드가 http://localhost:3001 에서 돌고 있어야 합니다(index.html도 여기서 받습니다).
//   **비용 발생** — 사진 1장당 Claude Vision 1~2회. 103장 전체가 1달러 안쪽.
//   시간은 15분 안팎 걸립니다.
//
// ─────────────────────────────────────────────────────────────────────────
// 규칙 — 이 파일을 돌리기 전에 읽으세요
//
//   나온 숫자를 그대로 보고합니다. **결과를 보고 코드나 프롬프트를 고치지 않습니다.**
//   고칠 것이 보이면 다른 사진으로 고치고, 이 세트로는 다시 재기만 합니다.
//   (test/schedule-holdout.js와 같은 규칙입니다.)
//
//   이 세트는 우리에게 홀드아웃입니다 — 앱은 이 사진들을 보기 전에 다 만들어졌습니다.
// ─────────────────────────────────────────────────────────────────────────
//
// 무엇을 재는가
//
//   정답표는 사진을 A/B/C로 나눕니다(팀원 분류, 사진별 라벨 + 근거):
//     A  위험한 사진      — 특정 단서가 뚜렷하고 알아보기 쉽게 나옴
//     B  숨은위험         — 같은 단서가 있지만 작거나·가장자리거나·놓치기 쉬움
//     C  안전한 사진      — 그런 단서가 아예 없음
//
//   우리 앱은 A/B/C를 출력하지 않습니다. 그래서 억지로 대응시키지 않고, 앱이 실제로
//   내리는 판단으로 잽니다 — **위치·소속 단서를 찾았는가, 못 찾았는가.**
//     찾음  = 앱이 장소 글자로 본 것이 있거나(isPlaceWord)
//             앱이 소속 단서로 본 것이 있음(isBelongClue)
//     못 찾음 = 둘 다 없음
//
//   앱의 판정 함수를 그대로 부른다. 여기에 판정을 따로 적으면 앱과 어긋나고,
//   그러면 앱이 아니라 이 파일을 재게 된다(실제로 그랬다 — 아래 '자를 두 개' 참고).
//
//   그러면 정답표의 A·B는 "찾아야 하는 사진", C는 "찾으면 안 되는 사진"이 됩니다.
//
//     놓침(miss)   A 또는 B인데 못 찾음  ← 이 앱에서 가장 나쁜 실패
//     오탐(false)  C인데 찾음
//
//   B는 따로 봅니다. 사람도 놓치기 쉬운 유형이라, 여기서의 검출률이 이 서비스가
//   실제로 값어치가 있는지를 가장 잘 보여줍니다.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const SET_DIR = path.join(__dirname, '..', '사진 100장 분석');
const LABELS = path.join(SET_DIR, '최종분류.json');
const OUT = path.join(__dirname, 'photo-accuracy-result.json');
const LIMIT = Number(process.env.LIMIT || 0);   // 0 = 전부

// ── 자를 두 개 쓴다 ───────────────────────────────────────────────────────
//
// **앱자** — 앱이 실제로 내리는 판정(isPlaceWord / isBelongClue)을 그대로 부른다.
//   사용자가 화면에서 보는 것이 이것이므로, 진짜 정확도는 이 숫자다.
//
// **옛자** — 아래 고정된 정규식. 앱이 바뀌어도 이 자는 안 바뀌므로 **실행끼리
//   비교할 수 있다.** 앱자만 쓰면 "앱이 좋아졌나, 자가 느슨해졌나"를 못 가린다.
//
// 옛자는 앱이 예전에 쓰던 것보다도 넓다(배지·학교·유치원·태권도·학원이 더 있고
// 근거까지 검사한다). 그래서 옛자의 오탐은 늘 부풀려져 있다 — 비교용으로만 쓴다.
const 옛_장소유형 = /상호명|간판|주소|지번|전화번호/;
const 옛_소속단서 = /교복|원복|명찰|로고|엠블럼|배지|기관|학교|유치원|어린이집|태권도|학원/;

(async () => {
  if (!fs.existsSync(LABELS)) {
    console.log('정답표가 없습니다: ' + LABELS);
    process.exit(1);
  }
  const labels = JSON.parse(fs.readFileSync(LABELS, 'utf8'));
  const rows = LIMIT ? labels.slice(0, LIMIT) : labels;
  console.log('정답표 ' + labels.length + '장 중 ' + rows.length + '장을 잽니다.');
  console.log('규칙: 나온 숫자를 그대로 보고합니다. 결과를 보고 코드를 고치지 않습니다.\n');

  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('  PAGEERROR:', String(e).slice(0, 120)));
  await page.goto(BASE_URL + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.__anshimTest && window.__anshimTest.addBelongClueByZoom));

  const results = [];
  const t0 = Date.now();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const file = path.join(SET_DIR, row.파일명);
    if (!fs.existsSync(file)) {
      results.push({ ...row, error: '파일 없음' });
      continue;
    }
    const ext = path.extname(row.파일명).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
    const u = 'data:' + mime + ';base64,' + fs.readFileSync(file).toString('base64');

    let r;
    try {
      r = await page.evaluate(async (a) => {
        const T = window.__anshimTest;
        // 실사용과 같은 경로: 얼굴 검출 -> Claude Vision -> 소속 못 찾으면 가슴 확대 재확인
        const face = await T.runFaceDetectionPipeline(a.u);
        const claude = await T.runClaudeVisionPipeline(a.u, face.faces);
        await T.addBelongClueByZoom(a.u, face.faces, claude);
        return {
          faces: face.faces.length,
          words: (claude.words || []).map((w) => ({
            text: w.text, type: w.type || '',
            앱장소: T.isPlaceWord(w),               // 앱이 실제로 내리는 판정
          })),
          clues: (claude.visualClues || []).map((c) => ({
            종류: c.종류 || '', 근거: c.근거 || '', 확대재확인: !!c.확대재확인,
            판독: c.판독 || '',
            앱소속: T.isBelongClue(c),              // 앱이 실제로 내리는 판정
            무게: T.belongClueWeight(c),
          })),
        };
      }, { u });
    } catch (e) {
      results.push({ ...row, error: String(e.message).slice(0, 120) });
      process.stdout.write('!');
      continue;
    }

    // 앱자 — 사용자가 실제로 보는 판정
    const 장소글자 = r.words.filter((w) => w.앱장소);
    const 소속 = r.clues.filter((c) => c.앱소속);
    const 찾음 = 장소글자.length > 0 || 소속.length > 0;

    // 옛자 — 실행끼리 비교하기 위한 고정된 자
    const 옛장소 = r.words.filter((w) => 옛_장소유형.test(w.type));
    const 옛소속 = r.clues.filter((c) => 옛_소속단서.test(c.종류 + c.근거));
    const 옛찾음 = 옛장소.length > 0 || 옛소속.length > 0;

    results.push({
      파일명: row.파일명, 정답: row.최종유형, 찾음, 옛찾음,
      장소글자: 장소글자.map((w) => w.text), 소속: 소속.map((c) => c.종류),
      못읽은소속: 소속.filter((c) => c.무게 < 12).map((c) => c.종류),
      버려진글자: r.words.filter((w) => !w.앱장소 && 옛_장소유형.test(w.type)).map((w) => w.text),
      버려진소속: r.clues.filter((c) => !c.앱소속 && 옛_소속단서.test(c.종류 + c.근거)).map((c) => c.종류),
      확대로찾음: 소속.some((c) => c.확대재확인),
      얼굴: r.faces, 근거: row.근거,
    });
    process.stdout.write(찾음 ? '●' : '·');
    if ((i + 1) % 50 === 0) process.stdout.write(' ' + (i + 1) + '\n');
  }
  process.stdout.write('\n\n');
  await browser.close();

  // ── 집계 ────────────────────────────────────────────────────────────────
  const ok = results.filter((r) => !r.error);
  const by = (t) => ok.filter((r) => r.정답 === t);
  const 검출률 = (arr) => (arr.length ? (arr.filter((r) => r.찾음).length / arr.length * 100).toFixed(0) : '—');

  const A = by('A'), B = by('B'), C = by('C');
  const 놓침 = [...A, ...B].filter((r) => !r.찾음);
  const 오탐 = C.filter((r) => r.찾음);

  console.log('═'.repeat(56));
  console.log('  정확도 — 사진 ' + ok.length + '장 (' + Math.round((Date.now() - t0) / 1000) + '초)');
  console.log('═'.repeat(56));
  console.log('  A 위험한 사진      ' + String(A.length).padStart(3) + '장   찾음 ' + 검출률(A) + '%');
  console.log('  B 숨은위험         ' + String(B.length).padStart(3) + '장   찾음 ' + 검출률(B) + '%  ← 핵심');
  console.log('  C 안전한 사진      ' + String(C.length).padStart(3) + '장   찾음 ' + 검출률(C) + '%  (낮을수록 좋음)');
  console.log('  ' + '─'.repeat(52));
  console.log('  놓침 (A·B인데 못 찾음)   ' + 놓침.length + '장 / ' + (A.length + B.length) + '장');
  console.log('  오탐 (C인데 찾음)        ' + 오탐.length + '장 / ' + C.length + '장');
  const 확대 = ok.filter((r) => r.확대로찾음);
  console.log('  가슴 확대 재확인으로 찾은 것  ' + 확대.length + '장');

  // 옛자로도 같이 낸다 — 앱이 좋아진 건지 자가 느슨해진 건지 가리기 위해서다
  const 옛검출 = (arr) => (arr.length ? (arr.filter((r) => r.옛찾음).length / arr.length * 100).toFixed(0) : '—');
  const 옛놓침 = [...A, ...B].filter((r) => !r.옛찾음);
  const 옛오탐 = C.filter((r) => r.옛찾음);
  console.log('  ' + '─'.repeat(52));
  console.log('  [옛자·비교용]  A ' + 옛검출(A) + '%  B ' + 옛검출(B) + '%  C ' + 옛검출(C) + '%'
    + '   놓침 ' + 옛놓침.length + '  오탐 ' + 옛오탐.length);
  const 못읽음 = ok.filter((r) => (r.못읽은소속 || []).length > 0);
  console.log('  이번에 낮춘 것: 못 읽은 명찰·로고 ' + 못읽음.length + '장');
  console.log('  이번에 버린 것: 장소글자 '
    + ok.reduce((s, r) => s + (r.버려진글자 || []).length, 0) + '개, 소속 '
    + ok.reduce((s, r) => s + (r.버려진소속 || []).length, 0) + '개');
  const err = results.filter((r) => r.error);
  if (err.length) console.log('  오류 ' + err.length + '장');

  if (놓침.length) {
    console.log('\n놓친 사진 (' + 놓침.length + '장) — 정답표의 근거와 대조해보세요');
    놓침.slice(0, 20).forEach((r) => console.log('  [' + r.정답 + '] ' + r.파일명 + ' — ' + String(r.근거).slice(0, 70)));
    if (놓침.length > 20) console.log('  … 그리고 ' + (놓침.length - 20) + '장 더 (' + path.basename(OUT) + ' 참고)');
  }

  fs.writeFileSync(OUT, JSON.stringify({
    잰날: new Date().toISOString().slice(0, 10),
    규칙: '결과를 보고 코드를 고치지 않는다. 고칠 것이 보이면 다른 사진으로 고치고 이 세트로는 다시 재기만 한다.',
    집계: {
      전체: ok.length,
      A: { 장수: A.length, 찾음: 검출률(A) },
      B: { 장수: B.length, 찾음: 검출률(B) },
      C: { 장수: C.length, 찾음: 검출률(C) },
      놓침: 놓침.length, 오탐: 오탐.length, 확대로찾음: 확대.length,
      옛자: {
        A: 옛검출(A), B: 옛검출(B), C: 옛검출(C),
        놓침: 옛놓침.length, 오탐: 옛오탐.length,
      },
    },
    사진별: results,
  }, null, 2), 'utf8');
  console.log('\n자세한 결과: ' + OUT);
})();
