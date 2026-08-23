// 생활패턴 감지 — 홀드아웃(검증 전용) 세트 생성기
//
// 튜닝용 세트(make-schedule-fixtures.js)와 반드시 구분해서 써야 한다.
// 그 세트는 결과를 보고 프롬프트를 고치는 데 썼으므로, 같은 세트로 잰 점수는
// 시험 문제를 보고 공부한 뒤 그 문제로 시험 본 것과 같다.
//
// 이 세트의 규칙:
//   1. 딱 한 번 돌리고 나온 숫자를 그대로 보고한다.
//   2. 결과를 보고 프롬프트나 코드를 고치지 않는다. 고쳐야 할 것이 보이면
//      튜닝용 세트에서 고치고, 그 다음에 이 세트를 새로 만들어 다시 잰다.
//
// 튜닝 세트와 일부러 다르게 만든 것:
//   - 앱 화면 모양이 다르다(밴드/카카오스토리 느낌, 다크모드 포함)
//   - 위치 태그가 없고 사진 속 간판으로만 장소가 드러나는 세트 — 배경텍스트 경로는
//     지금까지 한 번도 실제로 검증된 적이 없다(튜닝 세트는 사진 자리에 "사진"이라고만 적혀 있었다)
//   - 절대 날짜 표기("2026년 8월 19일") — 지금 코드는 상대 표기만 처리한다
//   - 같은 장소를 게시물마다 다르게 적는다(한글/영문/띄어쓰기)
//   - 우연히 요일이 겹치는 함정
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'fixtures');
const NOW = new Date();

function absDate(daysAgo) {
  const d = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - daysAgo);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}
function weekdayOf(daysAgo) {
  const d = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - daysAgo);
  return ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
}

const SETS = [
  {
    name: 'h1-sign',
    label: 'H1 · 다크모드 + 사진 속 간판으로만 장소가 드러남',
    style: 'dark',
    truth: {
      pattern: true, kinds: ['장소'],
      note: '위치 태그가 없다. 장소는 사진 속 간판(하늘유치원)에만 있다. 2·4·10·15일 전 = 서로 다른 요일',
      places: ['하늘유치원'],
    },
    posts: [
      { rel: '2일 전', place: '', sign: '하늘유치원', cap: '오늘 재롱잔치 연습했대요' },
      { rel: '4일 전', place: '', sign: '하늘유치원 정문', cap: '등원길, 오늘도 안 울고 들어갔어요' },
      { rel: '10일 전', place: '', sign: '하늘유치원', cap: '친구랑 손잡고 나오는 중' },
      { rel: '15일 전', place: '', sign: '하늘유치원 알림장', cap: '오늘 활동 사진 받았어요' },
    ],
  },
  {
    name: 'h2-absdate',
    label: 'H2 · 절대 날짜 표기 + 같은 요일 피아노 학원',
    style: 'band',
    truth: {
      pattern: true, kinds: ['요일'],
      note: '상대 표기가 아니라 "2026년 8월 19일" 식 절대 날짜. 4·11·18·25일 전 = 모두 ' + weekdayOf(4) + '요일',
      places: ['소리봄 피아노학원'],
    },
    posts: [
      { rel: absDate(4), place: '소리봄 피아노학원', sign: '', cap: '피아노 레슨 다녀왔어요 🎹' },
      { rel: absDate(11), place: '소리봄 피아노학원', sign: '', cap: '오늘은 체르니 들어갔대요' },
      { rel: absDate(18), place: '소리봄 피아노학원', sign: '', cap: '레슨 끝나고 아이스크림' },
      { rel: absDate(25), place: '소리봄 피아노학원', sign: '', cap: '피아노 가는 길' },
    ],
  },
  {
    name: 'h3-alias',
    label: 'H3 · 같은 장소를 게시물마다 다르게 적음',
    style: 'story',
    truth: {
      pattern: true, kinds: ['장소'],
      note: '표기는 다르지만 전부 같은 키즈카페. 1·3·9·12일 전 = 서로 다른 요일',
      places: ['블루밍 키즈카페', 'Blooming Kids Cafe', '블루밍키즈카페', '블루밍 키즈 카페'],
    },
    posts: [
      { rel: '1일 전', place: '블루밍 키즈카페', sign: '', cap: '오늘도 여기서 두 시간 놀았어요' },
      { rel: '3일 전', place: 'Blooming Kids Cafe', sign: '', cap: '트램폴린이 제일 좋대요' },
      { rel: '9일 전', place: '블루밍키즈카페', sign: '', cap: '비 오는 날엔 실내가 최고' },
      { rel: '12일 전', place: '블루밍 키즈 카페', sign: '', cap: '친구 생일파티 다녀왔어요 🎂' },
    ],
  },
  {
    name: 'h4-coincidence',
    label: 'H4 · 우연히 요일이 겹치는 함정',
    style: 'band',
    truth: {
      pattern: false, kinds: [],
      note: '3·10일 전이 우연히 같은 요일이지만 장소·활동이 전부 다르다. 요일 패턴이라 단정하면 과잉 판정',
      places: [],
    },
    posts: [
      { rel: '3일 전', place: '', sign: '', cap: '동네 산책 나왔어요' },
      { rel: '5일 전', place: '', sign: '', cap: '집에서 케이크 만들기' },
      { rel: '10일 전', place: '', sign: '', cap: '삼촌이 놀러 왔어요' },
      { rel: '13일 전', place: '', sign: '', cap: '새 신발 신고 한 바퀴 👟' },
    ],
  },
];

const THEMES = {
  dark: { bg: '#0f0f10', fg: '#f2f2f3', sub: '#9aa0a6', line: '#26262a', chip: '#1c1c20' },
  band: { bg: '#ffffff', fg: '#1a1a1a', sub: '#7b8794', line: '#e8eaee', chip: '#f3f5f7' },
  story: { bg: '#fffdf8', fg: '#1a1a1a', sub: '#8a7f6d', line: '#efe7d8', chip: '#f7f1e4' },
};

function postHtml(p, set, idx) {
  const t = THEMES[set.style];
  const photoBg = set.style === 'dark'
    ? ['#1e293b', '#312e2b', '#1f2937', '#28211f'][idx % 4]
    : ['#e2e8f0', '#e7f0e4', '#f2ece1', '#e8e4f0'][idx % 4];
  // 앱마다 머리 부분 생김새를 다르게 그린다
  const head = set.style === 'band'
    ? `<div class="bandhead"><div class="av"></div><div><b>서연맘</b><i>${p.rel}</i></div></div>`
    : `<div class="head"><div class="av"></div><div class="who"><b>seoyeon_daily</b>${p.place ? `<span>📍 ${p.place}</span>` : ''}</div></div>`;
  const tail = set.style === 'band'
    ? `${p.place ? `<div class="bandplace">📍 ${p.place}</div>` : ''}<div class="cap2">${p.cap}</div>`
    : `<div class="cap"><b>seoyeon_daily</b> ${p.cap}</div><div class="time">${p.rel}</div>`;

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
  * { box-sizing:border-box; margin:0; }
  body { width:420px; font-family:'Malgun Gothic','맑은 고딕',sans-serif; background:${t.bg}; color:${t.fg}; }
  .status { display:flex; justify-content:space-between; padding:7px 15px; font-size:12.5px; font-weight:600; color:${t.sub}; }
  .head { display:flex; align-items:center; gap:9px; padding:9px 13px; }
  .bandhead { display:flex; align-items:center; gap:10px; padding:12px 14px; border-bottom:1px solid ${t.line}; }
  .bandhead b { font-size:14.5px; display:block; }
  .bandhead i { font-style:normal; font-size:11.5px; color:${t.sub}; }
  .av { width:33px; height:33px; border-radius:50%; background:linear-gradient(140deg,#a5b4fc,#fbcfe8); flex:0 0 auto; }
  .who b { font-size:13.5px; }
  .who span { display:block; font-size:11.5px; color:${t.sub}; }
  .photo { height:290px; background:${photoBg}; position:relative; }
  .sign { position:absolute; left:50%; top:34%; transform:translateX(-50%);
          background:#f8fafc; color:#111827; border:2px solid #94a3b8; border-radius:5px;
          padding:7px 15px; font-size:16px; font-weight:800; letter-spacing:-0.3px;
          box-shadow:0 2px 6px rgba(0,0,0,0.25); white-space:nowrap; }
  .acts { display:flex; gap:13px; padding:9px 13px 3px; font-size:18px; }
  .cap { padding:2px 13px 0; font-size:13.5px; line-height:1.5; }
  .cap2 { padding:9px 14px 2px; font-size:14px; line-height:1.55; }
  .bandplace { margin:9px 14px 0; display:inline-block; background:${t.chip}; color:${t.sub};
               border-radius:14px; padding:3px 10px; font-size:12px; }
  .time { padding:9px 13px 13px; font-size:11px; color:${t.sub}; }
  .foot { padding:10px 14px 14px; font-size:11.5px; color:${t.sub}; }
</style></head><body>
  <div class="status"><span>10:12</span><span>LTE ▮▮ 64%</span></div>
  ${head}
  <div class="photo">${p.sign ? `<div class="sign">${p.sign}</div>` : ''}</div>
  <div class="acts"><span>♡</span><span>💬</span><span>↗</span></div>
  ${tail}
  ${set.style === 'band' ? '<div class="foot">공감 12 · 댓글 3</div>' : ''}
</body></html>`;
}

// 요일 설계 확인 — 손으로 숫자를 고르면 의도치 않게 겹친다
function daysAgoOf(rel) {
  const m = String(rel).match(/^(\d+)일/);
  if (m) return parseInt(m[1], 10);
  // 절대 날짜는 오늘로부터 며칠 전인지 되계산
  const a = String(rel).match(/(\d+)년\s*(\d+)월\s*(\d+)일/);
  if (a) {
    const d = new Date(+a[1], +a[2] - 1, +a[3]);
    const t0 = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate());
    return Math.round((t0 - d) / 86400000);
  }
  return null;
}

(async () => {
  console.log('홀드아웃 세트 — 만든 뒤 딱 한 번만 돌리고, 결과를 보고 코드를 고치지 않는다\n');
  for (const set of SETS) {
    const mods = set.posts.map(p => daysAgoOf(p.rel) % 7);
    const uniq = new Set(mods).size;
    const wantSame = set.truth.kinds.includes('요일');
    if (wantSame && uniq !== 1) throw new Error(set.name + ': 같은 요일이어야 하는데 mod7 ' + mods.join(','));
    if (set.name === 'h4-coincidence' && uniq === mods.length) {
      throw new Error('h4: 우연히 겹치는 요일이 하나는 있어야 함정이 된다 — mod7 ' + mods.join(','));
    }
    if (!wantSame && set.name !== 'h4-coincidence' && uniq !== mods.length) {
      throw new Error(set.name + ': 요일이 모두 달라야 하는데 mod7 ' + mods.join(','));
    }
  }
  console.log('요일 설계 확인 통과');

  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 420, height: 560 }, deviceScaleFactor: 2 });
  const manifest = [];

  for (const set of SETS) {
    const dir = path.join(OUT, 'holdout-' + set.name);
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f));
    for (let i = 0; i < set.posts.length; i++) {
      await page.setContent(postHtml(set.posts[i], set, i), { waitUntil: 'load' });
      await page.waitForTimeout(120);
      await page.screenshot({ path: path.join(dir, 'post' + (i + 1) + '.png'), fullPage: true });
    }
    manifest.push({ name: set.name, label: set.label, style: set.style, truth: set.truth, posts: set.posts });
    console.log('  ' + set.label);
    console.log('     ' + set.truth.note);
  }

  fs.writeFileSync(path.join(OUT, 'holdout-manifest.json'),
    JSON.stringify({ 만든날: NOW.toISOString().slice(0, 10), sets: manifest }, null, 2), 'utf8');
  console.log('\n정답표: fixtures/holdout-manifest.json');
  console.log('주의: H2는 절대 날짜를 구워 넣었다. 나중에 다시 쓰려면 새로 만들어야 한다.');
  await b.close();
})();
