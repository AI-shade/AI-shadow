// 안심앨범 — 주변색 채우기 / 모자이크(applyPatchFill) 테스트
//
// 사용법: 이 폴더(test)에서 → node patch-fill.js
//   프론트가 http://localhost:8000 에서 돌고 있어야 합니다. AI 호출 없음 (비용 0).
//
// 왜 이모지 스티커를 버렸나:
//   1) 미감 — 사진 위의 만화 스티커는 어떤 디자인 시안과도 어울리지 않는다 (사용자 지적).
//   2) 검증 불가 — 이모지는 ctx.fillText로 그려서 결과가 폰트에 의존한다. 헤드리스
//      Chromium에는 이모지 폰트가 없어 아무것도 그려지지 않는다(실측: 커버리지 0%).
//      즉 "정말 가려졌는가"를 자동으로 확인할 방법이 없다. 프라이버시 기능에서
//      검증할 수 없다는 것은 그 자체로 결함이다.
//   같은 조건에서 단색 채우기(⬛)는 커버리지 100%로 결정적으로 측정된다.
//
// 대체 방식: 글자 주변을 샘플링해 그 색으로 칠한다. 평평한 간판에서는 "불이 꺼진
// 간판"처럼 보여 거의 티가 나지 않는다. AI 인페인팅과 달리 단색을 칠할 뿐이라
// 가짜 글씨가 생길 위험도 없다. 배경이 균일하지 않으면 모자이크로 넘긴다.
//
// 이 테스트의 핵심 기준: **덮인 영역이 100%인가.**

const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8000';

let pass = 0;
let fail = 0;

function check(label, ok, detail) {
  if (ok) {
    pass++;
    console.log('  PASS  ' + label + (detail ? '  (' + detail + ')' : ''));
  } else {
    fail++;
    console.log('  FAIL  ' + label + (detail ? '  (' + detail + ')' : ''));
  }
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE_URL + '/index.html', { waitUntil: 'load' });

  const api = await page.evaluate(() => ({
    fill: !!(window.__anshimTest && window.__anshimTest.applyPatchFill),
    sample: !!(window.__anshimTest && window.__anshimTest.sampleBoxSurround),
  }));
  if (!api.fill || !api.sample) {
    console.log('  FAIL  applyPatchFill / sampleBoxSurround 가 없습니다 (' + JSON.stringify(api) + ')');
    await browser.close();
    process.exitCode = 1;
    return;
  }

  // 합성 이미지: 400x300. 평평한 배경(어두운 남색) 위에 밝은 "글자" 막대.
  // 텍스트 박스는 중앙 (140,120)-(260,160) → 중심 50%,46.7% / 크기 30%,13.3%
  const TEXT = { text: 'TEST', xPct: 50, yPct: 46.67, wPct: 30, hPct: 13.33 };

  const flat = await page.evaluate(async (TEXT) => {
    const c = document.createElement('canvas');
    c.width = 400; c.height = 300;
    const x = c.getContext('2d');
    x.fillStyle = '#101828'; x.fillRect(0, 0, 400, 300);
    x.fillStyle = '#f2f2f2';
    for (let i = 0; i < 5; i++) x.fillRect(150 + i * 22, 128, 14, 24); // 글자처럼 보이는 막대들
    const img = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = c.toDataURL(); });

    const stats = window.__anshimTest.sampleBoxSurround(c, { x0: 140, y0: 120, x1: 260, y1: 160 });
    const out = window.__anshimTest.applyPatchFill(img, [TEXT], 400, 300);
    const ox = out.getContext('2d');
    const at = (px, py) => Array.from(ox.getImageData(px, py, 1, 1).data).slice(0, 3);

    // 박스 안 여러 지점을 훑어 "원본 글자가 남아있는가" 확인
    const bx = c.getContext('2d');
    let leftover = 0, total = 0;
    for (let px = 142; px < 258; px += 2) {
      for (let py = 122; py < 158; py += 2) {
        total++;
        const a = Array.from(bx.getImageData(px, py, 1, 1).data).slice(0, 3);
        const b = at(px, py);
        // 원본이 밝은 글자였는데 결과도 여전히 밝으면 = 안 가려짐
        if (a[0] > 180 && b[0] > 180) leftover++;
      }
    }
    return {
      uniform: stats.uniform, stdev: Math.round(stats.stdev), color: stats.color,
      채운색: at(200, 140), 바깥: at(20, 20),
      남은글자비율: Math.round(100 * leftover / total),
    };
  }, TEXT);

  console.log('\n평평한 배경 (간판처럼)');
  check('배경이 균일하다고 판단', flat.uniform === true, 'stdev ' + flat.stdev);
  check('샘플한 색이 실제 배경색(16,24,40)에 가까움',
    Math.abs(flat.color[0] - 16) < 20 && Math.abs(flat.color[2] - 40) < 25, flat.color.join(','));
  check('채운 색이 배경색과 같음',
    Math.abs(flat.채운색[0] - flat.color[0]) < 12 && Math.abs(flat.채운색[2] - flat.color[2]) < 12, flat.채운색.join(','));
  check('글자가 100% 가려짐', flat.남은글자비율 === 0, '남은 글자 ' + flat.남은글자비율 + '%');
  check('박스 바깥은 건드리지 않음', flat.바깥.join(',') === '16,24,40', flat.바깥.join(','));

  // 무늬 있는 배경 → 단색으로 칠하면 얼룩지므로 모자이크로 넘어가야 함
  const striped = await page.evaluate(async (TEXT) => {
    const c = document.createElement('canvas');
    c.width = 400; c.height = 300;
    const x = c.getContext('2d');
    for (let i = 0; i < 400; i += 16) {
      x.fillStyle = (i / 16) % 2 ? '#20c060' : '#c02040';
      x.fillRect(i, 0, 16, 300);
    }
    x.fillStyle = '#ffffff';
    for (let i = 0; i < 5; i++) x.fillRect(150 + i * 22, 128, 14, 24);
    const img = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = c.toDataURL(); });

    const stats = window.__anshimTest.sampleBoxSurround(c, { x0: 140, y0: 120, x1: 260, y1: 160 });
    const out = window.__anshimTest.applyPatchFill(img, [TEXT], 400, 300);
    const ox = out.getContext('2d');
    const at = (px, py) => Array.from(ox.getImageData(px, py, 1, 1).data).slice(0, 3);

    const bx = c.getContext('2d');
    let leftover = 0, total = 0;
    const seen = new Set();
    for (let px = 142; px < 258; px += 2) {
      for (let py = 122; py < 158; py += 2) {
        total++;
        const a = Array.from(bx.getImageData(px, py, 1, 1).data).slice(0, 3);
        const b = at(px, py);
        seen.add(b.join(','));
        if (a[0] > 200 && a[1] > 200 && b[0] > 200 && b[1] > 200) leftover++;
      }
    }
    return { uniform: stats.uniform, stdev: Math.round(stats.stdev), 남은글자비율: Math.round(100 * leftover / total), 색가짓수: seen.size };
  }, TEXT);

  console.log('\n무늬 있는 배경');
  check('배경이 균일하지 않다고 판단', striped.uniform === false, 'stdev ' + striped.stdev);
  check('글자가 100% 가려짐', striped.남은글자비율 === 0, '남은 글자 ' + striped.남은글자비율 + '%');
  check('단색이 아니라 모자이크 (색이 여러 개)', striped.색가짓수 > 1, striped.색가짓수 + '가지');

  console.log('\n경계 조건');
  const edge = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 200; c.height = 150;
    const x = c.getContext('2d');
    x.fillStyle = '#334455'; x.fillRect(0, 0, 200, 150);
    const img = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = c.toDataURL(); });
    // 이미지 밖으로 튀어나가는 박스, 그리고 빈 목록
    const a = window.__anshimTest.applyPatchFill(img, [{ text: 'x', xPct: 2, yPct: 2, wPct: 30, hPct: 30 }], 200, 150);
    const b = window.__anshimTest.applyPatchFill(img, [], 200, 150);
    const c2 = window.__anshimTest.applyPatchFill(img, null, 200, 150);
    return { a: a.width + 'x' + a.height, b: b.width + 'x' + b.height, c: c2.width + 'x' + c2.height };
  });
  check('박스가 이미지 밖으로 나가도 터지지 않음', edge.a === '200x150', edge.a);
  check('빈 목록이어도 정상', edge.b === '200x150');
  check('null이어도 정상', edge.c === '200x150');

  if (errors.length) {
    console.log('\n  페이지 에러: ' + errors.join(' | '));
    fail++;
  }

  await browser.close();
  console.log('\n결과: ' + pass + '/' + (pass + fail) + ' 통과');
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
