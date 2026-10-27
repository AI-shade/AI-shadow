// 실험: 옷 위에서 «주변 천과 다른 덩어리»를 로고 후보로 찾는다. AI 호출 없음, 브라우저 안에서만.
//   node logo-find.js <출력폴더> <사진...>
// 빨간 칠 = 후보 픽셀, 노란 상자 = 후보 덩어리, 파란 선 = 옷 영역 경계
const fs = require('fs');
const path = require('path');
const REPO = 'C:/Users/duddn/ax-ton 멋쟁이사자처럼/AI-shadow';
const { chromium } = require(path.join(REPO, 'node_modules', 'playwright'));
const [outDir, ...photos] = process.argv.slice(2);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 200)));
  await page.goto('http://localhost:8000/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => !!(window.__anshimTest && window.__anshimTest.getClothesMask));

  for (const file of photos) {
    const u = 'data:image/jpeg;base64,' + fs.readFileSync(file).toString('base64');
    const r = await page.evaluate(async (u) => {
      const T = window.__anshimTest;
      const src = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = u; });
      // 큰 휴대폰 사진은 긴 변 1024로 줄여서 잰다(덩어리 찾기에는 충분)
      const k = Math.min(1, 1024 / Math.max(src.naturalWidth, src.naturalHeight));
      const w = Math.round(src.naturalWidth * k), h = Math.round(src.naturalHeight * k);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const cx = c.getContext('2d'); cx.drawImage(src, 0, 0, w, h);
      const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = c.toDataURL('image/jpeg', 0.95); });
      const px = cx.getImageData(0, 0, w, h).data;

      const clothes = await T.getClothesMask(img, 'logo:' + u.length);
      if (!clothes) return { err: '옷 분할 실패' };
      const mc = document.createElement('canvas'); mc.width = w; mc.height = h;
      mc.getContext('2d').drawImage(clothes, 0, 0, w, h);
      const md = mc.getContext('2d').getImageData(0, 0, w, h).data;
      const isC = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) isC[i] = md[i * 4 + 3] > 128 ? 1 : 0;

      // 1) 주변 천 색: 격자 칸마다 옷 픽셀 평균 → 이웃 칸과 섞어 부드럽게
      const cell = Math.max(8, Math.round(Math.min(w, h) / 40));
      const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
      const sum = new Float64Array(gw * gh * 3), cnt = new Float64Array(gw * gh);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x; if (!isC[i]) continue;
        const g = ((y / cell) | 0) * gw + ((x / cell) | 0);
        sum[g * 3] += px[i * 4]; sum[g * 3 + 1] += px[i * 4 + 1]; sum[g * 3 + 2] += px[i * 4 + 2]; cnt[g]++;
      }
      // 칸의 대표색은 반경 R칸 안 옷 픽셀 전체 평균 — 로고 하나가 한 칸을 다 차지해도 주변 천 색이 이긴다
      const R = 3;
      const ref = new Float64Array(gw * gh * 3), refOk = new Uint8Array(gw * gh);
      for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
        let s0 = 0, s1 = 0, s2 = 0, n = 0;
        for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
          const yy = gy + dy, xx = gx + dx; if (yy < 0 || xx < 0 || yy >= gh || xx >= gw) continue;
          const g = yy * gw + xx; s0 += sum[g * 3]; s1 += sum[g * 3 + 1]; s2 += sum[g * 3 + 2]; n += cnt[g];
        }
        const g = gy * gw + gx;
        if (n > 0) { ref[g * 3] = s0 / n; ref[g * 3 + 1] = s1 / n; ref[g * 3 + 2] = s2 / n; refOk[g] = 1; }
      }

      // 2) 옷 경계에서 조금 안쪽만 본다(경계는 배경·살과 섞여 늘 «다르다»가 된다)
      const ER = Math.max(2, Math.round(Math.min(w, h) * +(window.__ER || 0.012)));
      const inner = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!isC[y * w + x]) continue;
        let ok = 1;
        for (let d = -ER; d <= ER && ok; d += ER) for (let e = -ER; e <= ER; e += ER) {
          const yy = y + d, xx = x + e;
          if (yy < 0 || xx < 0 || yy >= h || xx >= w || !isC[yy * w + xx]) { ok = 0; break; }
        }
        inner[y * w + x] = ok;
      }

      // 3) 주변 천 색과 다르고 + 테두리가 날카로운 픽셀.
      //    1차(색만)에서는 남색 천의 빛 반사·그림자(부드럽게 번진 밝기 차)가 크게 잡혔다. 로고·글자는 날카롭다.
      //    날카로움 = 그 픽셀 밝기와 바로 옆(반경 2) 평균 밝기의 차이.
      const TH = +(window.__TH || 50), SH = +(window.__SH || 14);
      const lum = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) lum[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
      const sharp = new Float32Array(w * h);
      for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
        let s = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) s += lum[(y + dy) * w + x + dx];
        sharp[y * w + x] = Math.abs(lum[y * w + x] - s / 25);
      }
      // 날카로운 픽셀이 근처에 모여 있어야 한다(한 점짜리 잡티·실밥 제외) — 반경 4 안 개수
      const sharpOn = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) sharpOn[i] = sharp[i] > SH ? 1 : 0;
      const cand = new Uint8Array(w * h);
      let candN = 0;
      for (let i = 0; i < w * h; i++) {
        if (!inner[i]) continue;
        const x = i % w, y = (i / w) | 0, g = ((y / cell) | 0) * gw + ((x / cell) | 0);
        if (!refOk[g]) continue;
        const d = Math.abs(px[i * 4] - ref[g * 3]) + Math.abs(px[i * 4 + 1] - ref[g * 3 + 1]) + Math.abs(px[i * 4 + 2] - ref[g * 3 + 2]);
        if (d <= TH) continue;
        let near = 0;
        for (let dy = -4; dy <= 4; dy += 2) for (let dx = -4; dx <= 4; dx += 2) {
          const yy = y + dy, xx = x + dx; if (yy < 0 || xx < 0 || yy >= h || xx >= w) continue;
          near += sharpOn[yy * w + xx];
        }
        if (near >= 4) { cand[i] = 1; candN++; }
      }

      // 3.5) 가는 선을 걷어낸다(열림: 깎았다가 되살림). 2차에서 옷 외곽·소매 테두리를 따라 생긴 가는 빨간 선이
      //      엠블럼과 이어져 한 덩어리가 됐다. 로고는 뭉친 덩어리라 깎아도 남는다.
      const OR = +(window.__OR || 2);
      const er = new Uint8Array(w * h);
      for (let y = OR; y < h - OR; y++) for (let x = OR; x < w - OR; x++) {
        let all = 1;
        for (let dy = -OR; dy <= OR && all; dy++) for (let dx = -OR; dx <= OR; dx++) if (!cand[(y + dy) * w + x + dx]) { all = 0; break; }
        er[y * w + x] = all;
      }
      const opened = new Uint8Array(w * h);
      for (let y = OR; y < h - OR; y++) for (let x = OR; x < w - OR; x++) {
        if (!er[y * w + x]) continue;
        for (let dy = -OR; dy <= OR; dy++) for (let dx = -OR; dx <= OR; dx++) opened[(y + dy) * w + x + dx] = 1;
      }
      // 되살린 자리 중 원래 후보였던 픽셀만 남긴다
      candN = 0;
      for (let i = 0; i < w * h; i++) { cand[i] = cand[i] && opened[i] ? 1 : 0; candN += cand[i]; }

      // 4) 가까운 후보끼리 이어 붙인 뒤(팽창) 덩어리로 묶는다
      const DL = Math.max(2, Math.round(Math.min(w, h) * 0.008));
      const grown = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!cand[y * w + x]) continue;
        for (let dy = -DL; dy <= DL; dy++) for (let dx = -DL; dx <= DL; dx++) {
          const yy = y + dy, xx = x + dx; if (yy < 0 || xx < 0 || yy >= h || xx >= w) continue;
          grown[yy * w + xx] = 1;
        }
      }
      const lab = new Int32Array(w * h), blobs = [];
      const stack = new Int32Array(w * h);
      for (let i = 0; i < w * h; i++) {
        if (!grown[i] || lab[i]) continue;
        const id = blobs.length + 1; let top = 0; stack[top++] = i; lab[i] = id;
        const b = { x0: w, y0: h, x1: 0, y1: 0, px: 0, cand: 0 };
        while (top) {
          const cur = stack[--top], x = cur % w, y = (cur / w) | 0;
          b.px++; if (cand[cur]) b.cand++;
          if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y;
          const nb = [cur - 1, cur + 1, cur - w, cur + w];
          for (const n of nb) { if (n < 0 || n >= w * h || lab[n] || !grown[n]) continue; if (Math.abs((n % w) - x) > 1) continue; lab[n] = id; stack[top++] = n; }
        }
        blobs.push(b);
      }
      const area = w * h;
      const kept = blobs.filter((b) => b.cand / area >= 0.0003 && (b.x1 - b.x0) * (b.y1 - b.y0) / area <= 0.06);

      // 그림
      const o = document.createElement('canvas'); o.width = w; o.height = h;
      const ox = o.getContext('2d'); ox.drawImage(img, 0, 0);
      const od = ox.getImageData(0, 0, w, h);
      for (let i = 0; i < w * h; i++) {
        if (cand[i]) { od.data[i * 4] = 255; od.data[i * 4 + 1] *= 0.3; od.data[i * 4 + 2] *= 0.3; }
        else if (isC[i] && !inner[i]) { od.data[i * 4] *= 0.4; od.data[i * 4 + 1] *= 0.6; od.data[i * 4 + 2] = 255; }
      }
      ox.putImageData(od, 0, 0);
      ox.strokeStyle = '#ffd400'; ox.lineWidth = 2; ox.font = 'bold 14px sans-serif'; ox.fillStyle = '#ffd400';
      kept.forEach((b, i) => { ox.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); ox.fillText(String(i + 1), b.x0, b.y0 - 3); });
      return {
        size: w + 'x' + h, candPct: (candN / area * 100).toFixed(2), blobs: blobs.length,
        kept: kept.map((b, i) => ({ n: i + 1, box: [b.x0, b.y0, b.x1, b.y1], areaPct: ((b.x1 - b.x0) * (b.y1 - b.y0) / area * 100).toFixed(2) })),
        url: o.toDataURL('image/jpeg', 0.88),
      };
    }, u);
    if (r.err) { console.log(path.basename(file), r.err); continue; }
    const name = path.basename(file, path.extname(file)) + '.logo.jpg';
    fs.writeFileSync(path.join(outDir, name), Buffer.from(r.url.split(',')[1], 'base64'));
    console.log(name, r.size, '후보픽셀 ' + r.candPct + '%', '덩어리 ' + r.blobs + ' → 남김 ' + r.kept.length);
    r.kept.forEach((b) => console.log('  #' + b.n, JSON.stringify(b.box), b.areaPct + '%'));
  }
  await browser.close();
})();
