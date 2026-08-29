/*
 * 알약 버튼 묶음이 좁은 화면에서 글자를 세로로 흘리지 않는지 검사한다.
 *
 * 제보: "핸드폰 어플용 목업을 손봐야할거같아 너무 조잡해"
 *
 * 원인은 `.bs-options`가 `display: flex`인데 줄바꿈을 허용하지 않은 것이었다.
 * 버튼 5개를 한 줄에 욱여넣으니 버튼당 44px가 되고, 그 폭에 한글을 넣으려니
 * 브라우저가 «색 / 안 / 바 / 꾸 / 기»처럼 한 자씩 끊어 세로로 쌓았다.
 *
 * 실측 (고치기 전 → 후), «마크를 완전히 지우기» 버튼:
 *    390px   65x116  →  150x31
 *    560px   78x 82  →  150x31
 *    768px  111x 48  →  150x31
 *   1280px  171x 36  →  171x36   (원래 정상이던 폭은 그대로)
 *
 * 폭을 조건으로 건 미디어쿼리로 고치지 않았다. 경계값마다 다시 깨지기 때문이다.
 * `flex-wrap: wrap` + 버튼에 `white-space: nowrap` 두 줄이면 모든 폭에서 지켜진다.
 *
 * 이 검사는 진단을 돌리지 않는다 — 패널만 강제로 띄워 재므로 API 호출도 비용도 없다.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = process.env.ANSHIM_URL || 'http://localhost:8000/index.html';

// 한 줄 높이는 글꼴 크기에 따라 31~36px이었다. 44px를 넘으면 두 줄 이상이라는 뜻이다.
const 한줄한계 = 44;
// 44px까지 찌그러졌던 것이 문제였다. 이름이 들어가려면 최소 이만큼은 있어야 한다.
const 최소폭 = 80;

const 폭들 = [390, 430, 560, 768, 1280];

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

(async () => {
  // 소스 검사 — 고친 두 줄이 지워지면 여기서 먼저 걸린다.
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  console.log('소스');
  ok(/\.bs-options\s*\{[^}]*flex-wrap:\s*wrap/.test(src),
     '.bs-options가 줄바꿈을 허용한다');
  ok(/\.bs-btn,\s*\.fs-btn,\s*\.cw-btn,\s*\.em-btn\s*\{[^}]*white-space:\s*nowrap/.test(src),
     '버튼 이름이 쪼개지지 않는다 (white-space: nowrap)');

  const browser = await chromium.launch();

  for (const w of 폭들) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, locale: 'ko-KR' });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(900);

    const 잰값 = await page.evaluate(() => {
      // 보정 화면과 옷 패널은 흐름을 타야 열린다. 여기서는 크기만 재면 되므로 강제로 띄운다.
      const sc = document.getElementById('screen-correct');
      if (sc) sc.style.display = 'flex';
      const os = document.getElementById('outfitStyle');
      if (os) os.style.display = 'flex';
      return Array.from(document.querySelectorAll('.cw-btn, .em-btn')).map(b => {
        const r = b.getBoundingClientRect();
        return { 글: b.textContent.trim(), 폭: Math.round(r.width), 높이: Math.round(r.height) };
      });
    });

    console.log('\n폭 ' + w + 'px — 버튼 ' + 잰값.length + '개');
    ok(잰값.length === 9, '버튼 9개를 찾았다', 잰값.length + '개');

    const 두줄 = 잰값.filter(b => b.높이 > 한줄한계);
    ok(두줄.length === 0, '모든 버튼이 한 줄이다',
       두줄.length ? 두줄.map(b => `${b.글} ${b.폭}x${b.높이}`).join(', ') : `가장 높은 것 ${Math.max(...잰값.map(b => b.높이))}px`);

    const 좁음 = 잰값.filter(b => b.폭 < 최소폭);
    ok(좁음.length === 0, '이름이 들어갈 폭을 갖는다',
       좁음.length ? 좁음.map(b => `${b.글} ${b.폭}px`).join(', ') : `가장 좁은 것 ${Math.min(...잰값.map(b => b.폭))}px`);

    await ctx.close();
  }

  await browser.close();

  console.log('\n' + pass + '개 통과, ' + fail + '개 실패');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('실패:', e.message); process.exit(1); });
