// 배경 교체 마스크를 사진 위에 얹어 본다. 빨강 = AI가 다시 그리는 자리. AI 호출 없음.
const fs = require('fs');
const path = require('path');
const REPO = 'C:/Users/duddn/ax-ton 멋쟁이사자처럼/AI-shadow';
const { chromium } = require(path.join(REPO, 'node_modules', 'playwright'));
const [outDir, ...photos] = process.argv.slice(2);
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:8000/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.__anshimTest && window.__anshimTest.buildBackgroundMask));
  for (const file of photos) {
    const u = 'data:image/jpeg;base64,' + fs.readFileSync(file).toString('base64');
    const url = await page.evaluate(async (u) => {
      const T = window.__anshimTest;
      const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = u; });
      const w = img.naturalWidth, h = img.naturalHeight;
      const face = await T.runFaceDetectionPipeline(u);
      const hands = await T.detectHandBoxes(img);
      const person = await T.getPersonMask(img, 'ov:' + u.length);
      const mask = T.buildBackgroundMask(face.faces.map((f) => f.box), w, h, person, hands);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      const base = x.getImageData(0, 0, w, h), md = mask.getContext('2d').getImageData(0, 0, w, h).data;
      for (let i = 0; i < md.length; i += 4) if (md[i] > 128) {
        base.data[i] = base.data[i] * 0.45 + 255 * 0.55; base.data[i + 1] *= 0.45; base.data[i + 2] *= 0.45;
      }
      x.putImageData(base, 0, 0);
      return c.toDataURL('image/jpeg', 0.85);
    }, u);
    const name = path.basename(file, path.extname(file)) + '.bgmask.jpg';
    fs.writeFileSync(path.join(outDir, name), Buffer.from(url.split(',')[1], 'base64'));
    console.log(name);
  }
  await browser.close();
})();
