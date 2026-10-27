// 사진을 0/90/180/270도로 돌려 얼굴 검출 신뢰도를 잰다. 바른 방향(0도)이 늘 이기는지 본다. AI 호출 없음.
//   node rotate-scores.js <사진...>
const fs = require('fs');
const path = require('path');
const REPO = 'C:/Users/duddn/ax-ton 멋쟁이사자처럼/AI-shadow';
const { chromium } = require(path.join(REPO, 'node_modules', 'playwright'));
const photos = process.argv.slice(2);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:8000/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.__anshimTest && window.__anshimTest.runFaceDetectionPipeline));
  for (const file of photos) {
    const ext = path.extname(file).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
    const u = 'data:' + mime + ';base64,' + fs.readFileSync(file).toString('base64');
    const r = await page.evaluate(async (u) => {
      const T = window.__anshimTest;
      const src = await new Promise((res, j) => { const i = new Image(); i.onload = () => res(i); i.onerror = j; i.src = u; });
      const out = {};
      for (const deg of [0, 90, 180, 270]) {
        const c = document.createElement('canvas');
        const side = deg % 180 !== 0;
        c.width = side ? src.naturalHeight : src.naturalWidth;
        c.height = side ? src.naturalWidth : src.naturalHeight;
        const x = c.getContext('2d');
        x.translate(c.width / 2, c.height / 2);
        x.rotate(deg * Math.PI / 180);
        x.drawImage(src, -src.naturalWidth / 2, -src.naturalHeight / 2);
        const f = await T.runFaceDetectionPipeline(c.toDataURL('image/jpeg', 0.9));
        const confs = (f.faces || []).map((z) => z.confidence).sort((a, b) => b - a);
        out[deg] = { n: confs.length, top: confs[0] || 0, sum: confs.reduce((a, b) => a + b, 0) };
      }
      return out;
    }, u);
    const fmt = (d) => d.n + '명 최고' + d.top.toFixed(2) + ' 합' + d.sum.toFixed(2);
    const best = Object.keys(r).sort((a, b) => r[b].sum - r[a].sum)[0];
    console.log(path.basename(file).padEnd(18), '0°:' + fmt(r[0]), '| 90°:' + fmt(r[90]), '| 180°:' + fmt(r[180]), '| 270°:' + fmt(r[270]), '| 합 최대 ' + best + '°');
  }
  await browser.close();
})();
