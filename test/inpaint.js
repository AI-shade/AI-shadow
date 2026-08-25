// 아이섀도우 — AI 인페인팅(/api/inpaint-regions) 테스트
//
// 사용법: 이 폴더(test)에서 → node inpaint.js
//   백엔드가 http://localhost:3001 에서 돌고 있어야 합니다.
//
// 이 테스트는 fal.ai를 호출하지 않습니다 (비용 없음).
//   - 비용 계산 함수는 순수 함수라 직접 검증
//   - 엔드포인트는 입력 검증 경로(400)만 확인 — 이 경로는 fal 호출 전에 리턴됨

import { estimateFillCostUsd } from '../server/fill-cost.js';

const BASE = process.env.BACKEND_URL || 'http://localhost:3001';

let pass = 0;
let fail = 0;

function check(label, actual, expected) {
  const ok = actual === expected;
  if (ok) {
    pass++;
    console.log('  PASS  ' + label);
  } else {
    fail++;
    console.log('  FAIL  ' + label);
    console.log('        기대: ' + expected);
    console.log('        실제: ' + actual);
  }
}

// ===== 1. 비용 계산 (fal FLUX Fill = 메가픽셀당 $0.05) =====
console.log('\n비용 계산');
check('1024x1024 (1.05MP) → $0.052', estimateFillCostUsd(1024, 1024), 0.052);
check('768x512 (0.39MP) → $0.020', estimateFillCostUsd(768, 512), 0.02);
check('4032x3024 (12.2MP) → $0.610', estimateFillCostUsd(4032, 3024), 0.61);
check('크기 정보 없으면 null', estimateFillCostUsd(null, null), null);

// ===== 2. 엔드포인트 입력 검증 (fal 호출 전에 리턴 — 무료) =====
console.log('\n입력 검증');

async function post(body) {
  const r = await fetch(BASE + '/api/inpaint-regions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

try {
  const noImage = await post({ maskBase64: 'AAAA' });
  check('이미지 없으면 400', noImage.status, 400);

  const noMask = await post({ imageBase64: 'AAAA' });
  check('마스크 없으면 400', noMask.status, 400);

  const noMaskMsg = (await post({ imageBase64: 'AAAA' })).body.error || '';
  check('마스크 누락 안내에 "마스크" 포함', noMaskMsg.includes('마스크'), true);
} catch (err) {
  fail++;
  console.log('  FAIL  엔드포인트 호출 실패 — 백엔드가 떠 있나요? (' + err.message + ')');
}

console.log('\n결과: ' + pass + '/' + (pass + fail) + ' 통과');
// process.exit()를 바로 부르면 윈도우에서 libuv assertion 경고가 뜨므로 exitCode만 설정
process.exitCode = fail === 0 ? 0 : 1;
