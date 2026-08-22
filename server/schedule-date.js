// SNS 게시물의 상대 시각("3일 전")을 실제 날짜와 요일로 바꾼다.
//
// 별도 파일로 뺀 이유: 요일을 한 칸이라도 잘못 짚으면 "매주 화요일 발레학원" 같은
// 결론 자체가 틀어져 부모가 잘못된 안내를 받는다. Claude를 부르지 않고 단위 테스트할
// 수 있어야 한다 (test/schedule-date.js). fill-cost.js와 같은 원칙.

// "3일 전" 같은 상대 표기를 실제 날짜로 바꾼다.
// 모델에게 역산을 시켰더니 날짜는 맞히면서 요일을 틀렸다 — 같은 수요일 네 건을
// "화요일과 수요일에 반복"이라고 설명했다(2026-08-23 실측). 요일을 잘못 짚으면
// 부모가 받는 결론 자체가 틀어지므로, 산수는 서버가 하고 모델은 해석만 하게 한다.
export function resolvePostDate(relativeText, now) {
  const t = String(relativeText || '').replace(/\s/g, '');
  if (!t) return null;
  let daysAgo = null;
  if (/^(방금|지금)/.test(t) || /분전$/.test(t) || /시간전$/.test(t)) daysAgo = 0;
  else if (/^어제/.test(t)) daysAgo = 1;
  else if (/^그저께|^그제/.test(t)) daysAgo = 2;
  else {
    const m = t.match(/^(\d+)(일|주|개월|달)전$/);
    if (m) {
      const n = parseInt(m[1], 10);
      daysAgo = m[2] === '일' ? n : m[2] === '주' ? n * 7 : n * 30;
    }
  }
  if (daysAgo === null) return null;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    날짜: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    요일: ['일', '월', '화', '수', '목', '금', '토'][d.getDay()],
    며칠전: daysAgo,
    // 개월 단위는 30일로 어림한 값이라 요일을 믿으면 안 된다
    어림값: /개월전$|달전$/.test(t),
  };
}

