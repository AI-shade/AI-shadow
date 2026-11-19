// 개발용 정답셋 사진을 슈퍼베이스 Private 버킷에 올린다. 이미 있는 파일은 건너뛴다.
//   node scripts/supabase-upload.mjs
// server/.env의 SUPABASE_URL · SUPABASE_SECRET_KEY를 읽는다. 키 값은 출력하지 않는다.
// 스토리지 경로에는 한글을 못 쓴다 — 사진1.png → ai103/1.png, 실사1.jpeg → real35/1.jpeg
import { readFileSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
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
const SETS = [
  { prefix: 'ai103', dir: join(root, '../CNUtest2/사진 100장 분석'), name: /^사진(\d+)$/ },
  { prefix: 'real35', dir: join(root, '역할_데이터수집/실사_인터넷'), name: /^실사(\d+)$/ },
];
const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

// 버킷 — 없으면 Private으로 만들고, 있는데 Public이면 멈춘다.
const list = await (await fetch(`${url}/storage/v1/bucket`, { headers })).json();
const found = list.find((b) => b.id === BUCKET);
if (found?.public) {
  console.error(`${BUCKET}가 Public입니다. 대시보드에서 Private으로 바꾼 뒤 다시 돌리세요.`);
  process.exit(1);
}
if (!found) {
  const r = await fetch(`${url}/storage/v1/bucket`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }),
  });
  if (!r.ok) {
    console.error(`버킷 만들기 실패: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
    process.exit(1);
  }
  console.log(`버킷 ${BUCKET} 만듦 (Private)`);
}

let fail = 0;
for (const set of SETS) {
  let up = 0, skip = 0;
  const files = readdirSync(set.dir).filter((f) => TYPES[extname(f).toLowerCase()]);
  for (const f of files) {
    const ext = extname(f).toLowerCase();
    const m = f.slice(0, -ext.length).match(set.name);
    if (!m) {
      console.error(`  이름 규칙에 안 맞아 건너뜀: ${f}`);
      fail++;
      continue;
    }
    const path = `${set.prefix}/${Number(m[1])}${ext}`;
    const r = await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': TYPES[ext], 'x-upsert': 'false' },
      body: readFileSync(join(set.dir, f)),
    });
    if (r.ok) up++;
    else {
      const body = await r.text();
      if (/Duplicate|already exists/i.test(body)) skip++;
      else {
        console.error(`  실패 ${f}: HTTP ${r.status} ${body.slice(0, 200)}`);
        fail++;
      }
    }
  }
  console.log(`${set.prefix}: 사진 ${files.length}장 → 올림 ${up} · 이미 있음 ${skip}`);
}
if (fail) {
  console.error(`실패 ${fail}건`);
  process.exit(1);
}
