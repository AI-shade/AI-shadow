// 팀이 모은 마스킹 사진 503장(줄인 사진, 긴 변 1024px)과 라벨 CSV를 슈퍼베이스 Private 버킷에 올린다.
//   node scripts/supabase-upload-masking.mjs
// 이미 있는 파일은 건너뛴다. server/.env의 SUPABASE_URL · SUPABASE_SECRET_KEY를 읽는다. 키 값은 출력하지 않는다.
//
// 스토리지 경로에는 한글을 못 쓴다 — 학습 → train, 시험 → test.
//   dev-photos/masking503/train/<파일>.jpg   (401장)
//   dev-photos/masking503/test/<파일>.jpg    (102장 — 측정 전용. 학습·예시에 넣지 말 것)
//   dev-photos/masking503/labels/*.csv       (원본 CSV 백업 — 표는 DB의 photos · mask_labels)
// 원본(큰 사진)은 올리지 않는다. 라벨 좌표가 전부 줄인 사진 기준이다.
import { readFileSync, readdirSync } from 'node:fs';
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
if (!url || !key) {
  console.error('server/.env에 SUPABASE_URL과 SUPABASE_SECRET_KEY를 넣어주세요.');
  process.exit(1);
}
const headers = { apikey: key };
if (!key.startsWith('sb_')) headers.Authorization = `Bearer ${key}`;

const BUCKET = 'dev-photos';
const SRC = join(root, '팀자료/마스킹_최종');
const PHOTO_SETS = [
  { dir: join(SRC, '줄인사진/학습'), prefix: 'masking503/train' },
  { dir: join(SRC, '줄인사진/시험'), prefix: 'masking503/test' },
];
const CSVS = [
  ['마스킹라벨_학습.csv', 'masking503/labels/mask_labels_train.csv'],
  ['마스킹라벨_시험_확정.csv', 'masking503/labels/mask_labels_test.csv'],
  ['분리목록.csv', 'masking503/labels/split.csv'],
];

// 버킷이 Public이면 멈춘다 — 실제 아이가 찍힌 사진이 섞여 있을 수 있다.
const list = await (await fetch(`${url}/storage/v1/bucket`, { headers })).json();
const found = Array.isArray(list) && list.find((b) => b.id === BUCKET);
if (!found) { console.error(`${BUCKET} 버킷이 없습니다.`); process.exit(1); }
if (found.public) { console.error(`${BUCKET}가 Public입니다. Private으로 바꾼 뒤 다시 돌리세요.`); process.exit(1); }

let fail = 0;
async function put(path, body, type) {
  const r = await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': type, 'x-upsert': 'false' },
    body,
  });
  if (r.ok) return 'up';
  const text = await r.text();
  if (/Duplicate|already exists/i.test(text)) return 'skip';
  console.error(`  실패 ${path}: HTTP ${r.status} ${text.slice(0, 200)}`);
  fail++;
  return 'fail';
}

for (const set of PHOTO_SETS) {
  const files = readdirSync(set.dir).filter((f) => /\.jpe?g$/i.test(f));
  const n = { up: 0, skip: 0, fail: 0 };
  for (const f of files) n[await put(`${set.prefix}/${f}`, readFileSync(join(set.dir, f)), 'image/jpeg')]++;
  console.log(`${set.prefix}: ${files.length}장 → 올림 ${n.up} · 이미 있음 ${n.skip} · 실패 ${n.fail}`);
}
for (const [src, dst] of CSVS) {
  console.log(`${dst}: ${await put(dst, readFileSync(join(SRC, src)), 'text/csv')}`);
}
process.exit(fail ? 1 : 0);
