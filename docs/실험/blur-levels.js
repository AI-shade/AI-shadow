// 실험: 옷 교체 때 AI에 보내는 사진에서 옷 자리를 «회색» 대신 «옷끼리만 흐린 원본»으로 채우면 어떻게 보이나.
// 흐림 세기(짧은 변 대비 %)를 바꿔 나란히 놓는다. AI 호출 없음.
//   node blur-levels.js <출력폴더> <사진...>
const fs = require('fs');
const path = require('path');
const REPO = 'C:/Users/duddn/ax-ton 멋쟁이사자처럼/AI-shadow';
const { chromium } = require(path.join(REPO, 'node_modules', 'playwright'));
const [outDir, ...photos] = process.argv.slice(2);
const LEVELS = [0.01, 0.02, 0.035];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 200)));
  await page.goto('http://localhost:8000/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.__anshimTest && window.__anshimTest.buildClothingMask));
  for (const file of photos) {
    const u = 'data:image/jpeg;base64,' + fs.readFileSync(file).toString('base64');
    const url = await page.evaluate(async ({ u, LEVELS }) => {
      const T = window.__anshimTest;
      const src = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = u; });
      const ow = src.naturalWidth, oh = src.naturalHeight;
      const send = T.falSendSize(ow, oh);
      const sw = send.w, sh = send.h;
      const ic = document.createElement('canvas'); ic.width = sw; ic.height = sh;
      ic.getContext('2d').drawImage(src, 0, 0, sw, sh);
      const face = await T.runFaceDetectionPipeline(u);
      const faces = face.faces || [];
      const scaled = faces.map((f) => ({ x: f.box.x * sw / ow, y: f.box.y * sh / oh, width: f.box.width * sw / ow, height: f.box.height * sh / oh }));
      const hands = (await T.detectHandBoxes(src)).map((b) => ({ x: b.x * sw / ow, y: b.y * sh / oh, width: b.width * sw / ow, height: b.height * sh / oh }));
      const person = await T.getPersonMask(src, 'bl:p:' + u.length);
      const strict = await T.getClothesMask(src, 'bl:s:' + u.length, true, faces);
      const mask = T.buildClothingMask(scaled, sw, sh, person, hands, strict);

      // 옷끼리만 흐린다: 마스크 안쪽만 남긴 층을 흐린 뒤, 알파를 다시 채운다.
      // 캔버스는 알파를 곱한 채로 흐리므로, 투명한 바깥은 색을 보태지 않는다 — 다시 읽으면 옷 색만 섞인 값이 나온다.
      // 흰색=열린 곳을 알파로 (index.html maskToAlpha와 같은 일, 가장자리 흐림 없이)
      const alphaMask = (() => {
        const a = document.createElement('canvas'); a.width = sw; a.height = sh;
        const ax = a.getContext('2d'); ax.drawImage(mask, 0, 0);
        const d = ax.getImageData(0, 0, sw, sh);
        for (let i = 0; i < d.data.length; i += 4) { d.data[i + 3] = d.data[i]; d.data[i] = d.data[i + 1] = d.data[i + 2] = 255; }
        ax.putImageData(d, 0, 0); return a;
      })();
      T.maskToAlpha = () => alphaMask;
      T.blankInsideMaskForTest = () => {
        const out = document.createElement('canvas'); out.width = sw; out.height = sh;
        const ox = out.getContext('2d'); ox.drawImage(ic, 0, 0);
        const g = document.createElement('canvas'); g.width = sw; g.height = sh;
        const gx = g.getContext('2d'); gx.fillStyle = '#808080'; gx.fillRect(0, 0, sw, sh);
        gx.globalCompositeOperation = 'destination-in'; gx.drawImage(alphaMask, 0, 0);
        ox.drawImage(g, 0, 0); return out;
      };
      function blurInside(level) {
        const r = Math.max(2, Math.round(Math.min(sw, sh) * level));
        const layer = document.createElement('canvas'); layer.width = sw; layer.height = sh;
        const lx = layer.getContext('2d');
        lx.drawImage(ic, 0, 0);
        lx.globalCompositeOperation = 'destination-in';
        lx.drawImage(T.maskToAlpha ? T.maskToAlpha(mask, sw, sh) : mask, 0, 0);
        const bl = document.createElement('canvas'); bl.width = sw; bl.height = sh;
        const bx = bl.getContext('2d');
        bx.filter = 'blur(' + r + 'px)';
        bx.drawImage(layer, 0, 0);
        bx.filter = 'none';
        const bd = bx.getImageData(0, 0, sw, sh);
        const md = mask.getContext('2d').getImageData(0, 0, sw, sh).data;
        const out = document.createElement('canvas'); out.width = sw; out.height = sh;
        const ox = out.getContext('2d'); ox.drawImage(ic, 0, 0);
        const od = ox.getImageData(0, 0, sw, sh);
        for (let i = 0; i < od.data.length; i += 4) {
          if (md[i] <= 128) continue;
          if (bd.data[i + 3] < 8) { od.data[i] = od.data[i + 1] = od.data[i + 2] = 128; continue; }
          od.data[i] = bd.data[i]; od.data[i + 1] = bd.data[i + 1]; od.data[i + 2] = bd.data[i + 2];
        }
        ox.putImageData(od, 0, 0);
        return out;
      }
      const panels = [ic, T.blankInsideMaskForTest ? T.blankInsideMaskForTest(ic, mask, sw, sh) : null].filter(Boolean)
        .concat(LEVELS.map(blurInside));
      const labels = ['원본', '지금(회색)'].slice(0, panels.length - LEVELS.length).concat(LEVELS.map((l) => '흐림 ' + (l * 100) + '%'));
      const scale = 360 / sh;
      const pw = Math.round(sw * scale);
      const sheet = document.createElement('canvas'); sheet.width = pw * panels.length; sheet.height = 360 + 26;
      const sx = sheet.getContext('2d');
      sx.fillStyle = '#fff'; sx.fillRect(0, 0, sheet.width, sheet.height);
      sx.font = 'bold 16px sans-serif'; sx.fillStyle = '#000';
      panels.forEach((p, i) => { sx.drawImage(p, i * pw, 26, pw, 360); sx.fillText(labels[i], i * pw + 6, 19); });
      return sheet.toDataURL('image/jpeg', 0.9);
    }, { u, LEVELS });
    const name = path.basename(file, path.extname(file)) + '.blur-levels.jpg';
    fs.writeFileSync(path.join(outDir, name), Buffer.from(url.split(',')[1], 'base64'));
    console.log(name);
  }
  await browser.close();
})();
