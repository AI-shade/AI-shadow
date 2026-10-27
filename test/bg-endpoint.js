// 아이섀도우 — /api/replace-background 요청 검사 (돈이 드는 호출 전에 걸러지는 것만)
//
// 사용법: 이 폴더(test)에서 → node bg-endpoint.js
//   백엔드가 http://localhost:3001 에서 돌고 있어야 합니다(node server/server.js).
//   **Claude·fal.ai를 부르지 않습니다** — 아래 요청은 전부 그 전에 400으로 돌아와야 한다.
//   ⚠ 서버 코드를 고친 뒤에는 반드시 백엔드를 다시 띄우고 돌릴 것. 고치기 전 서버가 3001에 남아 있으면
//     마스크 없는 요청이 그대로 통과해 Claude가 한 번 불린다(2026-10-27에 실제로 겪음 — 1x1 이미지라
//     Claude가 "이미지를 볼 수 없다"고 답해서 fal까지는 안 갔다).
//
// 왜: 배경 교체를 kontext(사진 전체를 다시 그림)에서 fill(마스크 안쪽만)로 바꿨다. 마스크 없이
// 들어온 요청이 예전처럼 사진 전체를 다시 그리는 길로 새면 사람을 막는 장치가 사라진다.
// 마스크가 없으면 Claude·fal을 부르기 전에 거절해야 한다.

const BASE_URL = process.env.BACKEND_URL || 'http://localhost:3001';

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log('  PASS  ' + label + (detail ? '  (' + detail + ')' : '')); }
  else { fail++; console.log('  FAIL  ' + label + (detail ? '  (' + detail + ')' : '')); }
}

async function post(body) {
  const res = await fetch(BASE_URL + '/api/replace-background', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let json = {};
  try { json = await res.json(); } catch (e) { /* 본문 없음 */ }
  return { status: res.status, json };
}

(async () => {
  const status = await fetch(BASE_URL + '/api/flux-status').then((r) => r.json()).catch(() => null);
  if (!status) {
    console.log('백엔드가 안 떠 있습니다: ' + BASE_URL);
    process.exitCode = 1;
    return;
  }
  if (!status.ready) {
    console.log('FAL_KEY가 없어 501로 먼저 막힙니다 — 이 검사는 키가 있을 때만 의미가 있어 건너뜁니다.');
    return;
  }

  // 1x1 PNG — 이 요청들은 이미지를 실제로 쓰기 전에 걸러져야 한다
  const tiny = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  console.log('\n마스크가 없으면');
  const noMask = await post({ imageBase64: tiny, mediaType: 'image/png' });
  check('400으로 거절한다', noMask.status === 400, String(noMask.status));
  check('마스크가 필요하다고 알린다', /마스크/.test(noMask.json.error || ''), noMask.json.error);

  console.log('\n이미지가 없으면');
  const noImage = await post({ maskBase64: tiny });
  check('400으로 거절한다', noImage.status === 400, String(noImage.status));

  console.log('\n' + pass + '개 통과, ' + fail + '개 실패');
  if (fail > 0) process.exitCode = 1;
})();
