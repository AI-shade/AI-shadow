// SNS 게시물의 게시 시각 표기를 실제 날짜와 요일로 바꾼다.
//
// 별도 파일로 뺀 이유: 요일을 한 칸이라도 잘못 짚으면 "매주 화요일 발레학원" 같은
// 결론 자체가 틀어져 부모가 잘못된 안내를 받는다. Claude를 부르지 않고 단위 테스트할
// 수 있어야 한다 (test/schedule-date.js). fill-cost.js와 같은 원칙.
//
// 모델에게 역산을 시켰더니 날짜는 맞히면서 요일을 틀렸다 — 같은 수요일 네 건을
// "화요일과 수요일에 반복"이라고 설명했다(2026-08-23 실측). 그래서 산수는 여기서 하고
// 모델은 해석만 한다.

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
const pad = (n) => String(n).padStart(2, '0');

function build(d, now, approx) {
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return {
    날짜: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    요일: WEEKDAY[d.getDay()],
    며칠전: Math.round((t0 - d) / 86400000),
    어림값: !!approx,
  };
}

// 절대 날짜 표기를 읽는다.
//
// 홀드아웃 검증에서 드러난 구멍이다. 오래된 게시물은 SNS가 "25일 전"이 아니라
// "2026년 7월 29일"처럼 날짜로 보여주는데, 상대 표기만 처리하고 있어서 요일이
// 통째로 계산되지 않았다. 4주 연속 같은 요일인 세트에서 요일 패턴을 못 잡았다.
//
// 연도가 없는 표기("8월 19일")는 아직 오지 않은 날짜가 될 수 없으므로,
// 올해로 봤을 때 미래면 작년으로 본다.
function parseAbsolute(t, now) {
  let y = null, mo = null, day = null;

  let m = t.match(/^(\d{4})년(\d{1,2})월(\d{1,2})일/);
  if (m) { y = +m[1]; mo = +m[2]; day = +m[3]; }

  if (mo === null) {
    m = t.match(/^(\d{1,2})월(\d{1,2})일/);
    if (m) { mo = +m[1]; day = +m[2]; }
  }
  if (mo === null) {
    // 2026.08.19 / 2026-08-19 / 2026/08/19
    m = t.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
    if (m) { y = +m[1]; mo = +m[2]; day = +m[3]; }
  }
  if (mo === null) {
    // 8/19 · 8.19 — 연도 없는 짧은 표기
    m = t.match(/^(\d{1,2})[.\-/](\d{1,2})$/);
    if (m) { mo = +m[1]; day = +m[2]; }
  }
  if (mo === null) return null;
  if (mo < 1 || mo > 12 || day < 1 || day > 31) return null;

  if (y === null) y = now.getFullYear();
  let d = new Date(y, mo - 1, day);
  // 달을 넘겨버린 값(2월 30일 등)은 표기를 잘못 읽은 것이다
  if (d.getMonth() !== mo - 1 || d.getDate() !== day) return null;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!m[1] || t.match(/^\d{1,2}월/) || t.match(/^\d{1,2}[.\-/]\d{1,2}$/)) {
    // 연도를 안 적은 표기만 해가 넘어갔는지 따진다
    if (d > today) d = new Date(y - 1, mo - 1, day);
  }
  return d;
}

export function resolvePostDate(relativeText, now) {
  const t = String(relativeText || '').replace(/\s/g, '');
  if (!t) return null;
  const base = now || new Date();

  // ── 상대 표기
  let daysAgo = null;
  if (/^(방금|지금)/.test(t) || /분전$/.test(t) || /시간전$/.test(t)) daysAgo = 0;
  else if (/^오늘/.test(t)) daysAgo = 0;
  else if (/^어제/.test(t)) daysAgo = 1;
  else if (/^그저께|^그제/.test(t)) daysAgo = 2;
  else {
    const m = t.match(/^(\d+)(일|주|개월|달|년)전/);
    if (m) {
      const n = parseInt(m[1], 10);
      daysAgo = m[2] === '일' ? n
        : m[2] === '주' ? n * 7
          : m[2] === '년' ? n * 365
            : n * 30;
    }
  }
  if (daysAgo !== null) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - daysAgo);
    // 개월·년 단위는 30일·365일로 어림한 값이라 요일을 믿으면 안 된다
    return build(d, base, /개월전|달전|년전/.test(t));
  }

  // ── 절대 날짜 표기
  const abs = parseAbsolute(t, base);
  if (abs) return build(abs, base, false);

  return null;
}
