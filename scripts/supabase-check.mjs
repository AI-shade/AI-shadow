// 개발용 정답셋 슈퍼베이스에 연결되는지만 확인한다. 아무것도 만들거나 쓰지 않는다.
//   node scripts/supabase-check.mjs
// server/.env의 SUPABASE_URL · SUPABASE_SECRET_KEY를 읽는다. 키 값은 출력하지 않는다.
import { readFileSync } from 'node:fs';

const envPath = new URL('../server/.env', import.meta.url);
const env = {};
for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2];
}

const url = (env.SUPABASE_URL || '').replace(/\/+$/, '');
const key = env.SUPABASE_SECRET_KEY || '';
if (!url || !key) {
  console.error('server/.env에 SUPABASE_URL과 SUPABASE_SECRET_KEY를 넣어주세요.');
  process.exit(1);
}

// 새 비밀 키(sb_secret_…)는 apikey 헤더만, 옛 service_role(JWT)은 Authorization도 같이 보낸다.
const headers = { apikey: key };
if (!key.startsWith('sb_')) headers.Authorization = `Bearer ${key}`;

// 버킷 목록은 비밀 키로만 읽힌다 — 공개 키를 잘못 넣었으면 여기서 걸린다.
const res = await fetch(`${url}/storage/v1/bucket`, { headers });
const body = await res.text();
if (!res.ok) {
  console.error(`연결 실패: HTTP ${res.status}`);
  console.error(body.slice(0, 300));
  process.exit(1);
}

const buckets = JSON.parse(body);
console.log(`연결됨: ${new URL(url).host}`);
console.log(`버킷 ${buckets.length}개`);
for (const b of buckets) {
  console.log(`  ${b.name}  ${b.public ? '⚠ Public — Private로 바꿔야 합니다' : 'Private'}`);
}
