// AI허브 «Text in the Wild» 간판 사진(작게 찍힌 간판 150장, scripts 밖에서 뽑은 labels.json)의 글자를
// 서버와 같은 상가정보 색인(storeLookup)으로 대조해, 간판 하나로 몇 장이 좁혀지는지 잰다.
// 비용 0 · 네트워크 없음.  사용: node scripts/measure-store-tiw.mjs <labels.json>
//
// 사진 단위 판정(그 사진의 글자 중 가장 좁은 것):
//   전국 1곳 — 같은 이름 가게가 전국에 1곳 → 그 가게가 특정된다
//   시군구 하나 — 2곳 이상이지만 모두 한 시군구
//   2~10곳 / 11곳 이상 — 여러 지역에 흩어짐
//   없음 — 상가정보에 없는 글자뿐(간판 문구·업종명·전화번호 등)
import fs from 'node:fs';
process.env.VERCEL = '1';
const { storeLookup } = await import('../server/server.js');

const labels = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const rank = (s) => (!s || !s.count ? 99 : s.count === 1 ? 0 : s.sigungu ? 1 : s.count <= 10 ? 2 : 3);
const names = ['전국 1곳', '시군구 하나', '2~10곳', '11곳 이상'];
const byPhoto = [0, 0, 0, 0], none = { n: 0 };
const nameStat = [0, 0, 0, 0], nameNone = { n: 0 };
const examples = { 0: [], 1: [] };
const seen = new Set();
for (const p of labels) {
  let best = 99, bestWord = '';
  for (const w of p.words) {
    const t = String(w.text || '').trim();
    if (t.length < 2) continue;
    const s = storeLookup(t);
    const r = rank(s);
    if (!seen.has(t)) { seen.add(t); if (r === 99) nameNone.n++; else nameStat[r]++; }
    if (r < best) { best = r; bestWord = t + (s && s.sigungu ? ' (' + s.sigungu + ')' : '') + ' ' + (s ? s.count : 0) + '곳'; }
  }
  if (best === 99) none.n++; else byPhoto[best]++;
  if (best <= 1 && examples[best].length < 5) examples[best].push(bestWord);
}
console.log('사진 ' + labels.length + '장 (사진마다 가장 좁은 글자 기준)');
names.forEach((n, i) => console.log('  ' + n + ': ' + byPhoto[i] + '장'));
console.log('  상가정보에 없는 글자뿐: ' + none.n + '장');
console.log('글자 ' + seen.size + '개');
names.forEach((n, i) => console.log('  ' + n + ': ' + nameStat[i] + '개'));
console.log('  상가정보에 없음: ' + nameNone.n + '개');
console.log('예 — 전국 1곳: ' + examples[0].join(' / '));
console.log('예 — 시군구 하나: ' + examples[1].join(' / '));
