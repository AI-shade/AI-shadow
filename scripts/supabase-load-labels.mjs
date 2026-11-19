// 정답셋 라벨을 슈퍼베이스 표(photos · mask_labels · risk_labels)에 넣는다. 사진 파일은 스토리지에 따로 있다.
//   node scripts/supabase-load-labels.mjs
// 다시 돌려도 된다 — photos·risk_labels는 덮어쓰고, mask_labels는 지우고 새로 넣는다.
// 읽는 것:
//   팀자료/마스킹_최종/분리목록.csv · 마스킹라벨_학습.csv · 마스킹라벨_시험_확정.csv  → masking503
//   사진 100장 분석/최종분류.json                                                → ai103 (제미나이로 만든 시험 사진)
// server/.env의 SUPABASE_URL · SUPABASE_SECRET_KEY를 읽는다. 키 값은 출력하지 않는다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const env = {};
for (const line of readFileSync(join(root, 'server/.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2];
}
const url = (env.SUPABASE_URL || '').replace(/\/+$/, '');
const key = env.SUPABASE_SECRET_KEY || '';
if (!url || !key) { console.error('server/.env에 SUPABASE_URL과 SUPABASE_SECRET_KEY를 넣어주세요.'); process.exit(1); }
const headers = { apikey: key, 'Content-Type': 'application/json' };
if (!key.startsWith('sb_')) headers.Authorization = `Bearer ${key}`;

// 따옴표 안의 쉼표를 지키는 CSV 읽기(BOM 제거)
function readCsv(p) {
  const s = readFileSync(p, 'utf8').replace(/^﻿/, '');
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((x) => x !== ''));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}
const int = (v) => (v === '' || v == null ? null : Math.round(Number(v)));
const nul = (v) => (v === '' || v == null ? null : v);

async function rest(method, path, body, prefer) {
  const r = await fetch(`${url}/rest/v1/${path}`, {
    method, headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) { console.error(`${method} ${path}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`); process.exit(1); }
}
async function insert(table, rows, prefer) {
  for (let i = 0; i < rows.length; i += 500) await rest('POST', table, rows.slice(i, i + 500), prefer);
}

// ── masking503
const M = join(root, '팀자료/마스킹_최종');
const SPLIT = { '학습': 'train', '시험': 'test' };
const pathOf = {};
const photos = readCsv(join(M, '분리목록.csv')).map((r) => {
  const split = SPLIT[r.set];
  if (!split) { console.error('알 수 없는 set: ' + r.set + ' (' + r.file + ')'); process.exit(1); }
  const p = `masking503/${split}/${r.file}`;
  pathOf[r.file] = p;
  return { storage_path: p, dataset: 'masking503', file: r.file, split, case_type: nul(r.case), person: nul(r.person),
    direct: r.direct === 'True', width: int(r.w), height: int(r.h), orig_width: int(r.orig_w), orig_height: int(r.orig_h),
    source: nul(r.src), generated: false };
});

const labels = [];
for (const [csv, split] of [['마스킹라벨_학습.csv', 'train'], ['마스킹라벨_시험_확정.csv', 'test']]) {
  for (const r of readCsv(join(M, csv))) {
    const p = pathOf[r.file];
    if (!p || !p.startsWith(`masking503/${split}/`)) { console.error(`${csv}: 분리목록과 안 맞는 줄 — ${r.file}`); process.exit(1); }
    const b = r.box ? r.box.split(',').map((x) => int(x)) : [];
    if (r.box && b.length !== 4) { console.error(`${csv}: 상자 모양이 이상함 — ${r.file} "${r.box}"`); process.exit(1); }
    labels.push({ photo_path: p, case_type: nul(r.case), text: nul(r.text),
      box_x: b[0] ?? null, box_y: b[1] ?? null, box_w: b[2] ?? null, box_h: b[3] ?? null,
      how: nul(r.how), needs_check: /확인 필요/.test(r['확인'] || ''), note: nul(r.note) });
  }
}

// ── ai103 — 사진N.png ↔ 스토리지 ai103/N.png
const ai = JSON.parse(readFileSync(join(root, '사진 100장 분석/최종분류.json'), 'utf8'));
const aiPhotos = [], risk = [];
for (const r of ai) {
  const m = String(r['파일명']).match(/^사진(\d+)(\.\w+)$/);
  if (!m) { console.error('ai103 파일명 규칙 밖: ' + r['파일명']); process.exit(1); }
  const p = `ai103/${Number(m[1])}${m[2].toLowerCase()}`;
  aiPhotos.push({ storage_path: p, dataset: 'ai103', file: r['파일명'], generated: true });
  risk.push({ photo_path: p, risk: r['최종유형'], reason: nul(r['근거']) });
}

// 한 번에 넣는 줄들은 칸 이름이 같아야 한다(PostgREST) — 두 묶음을 따로 넣는다.
await insert('photos', photos, 'resolution=merge-duplicates');
await insert('photos', aiPhotos, 'resolution=merge-duplicates');
await rest('DELETE', 'mask_labels?photo_path=like.masking503%2F*');
await insert('mask_labels', labels);
await insert('risk_labels', risk, 'resolution=merge-duplicates');
console.log(`photos: masking503 ${photos.length} (학습 ${photos.filter((p) => p.split === 'train').length} · 시험 ${photos.filter((p) => p.split === 'test').length}) + ai103 ${aiPhotos.length}`);
console.log(`mask_labels: ${labels.length}줄 (상자 없음 ${labels.filter((l) => l.box_x == null).length} · 확인 필요 ${labels.filter((l) => l.needs_check).length})`);
console.log(`risk_labels: ${risk.length}줄`);
