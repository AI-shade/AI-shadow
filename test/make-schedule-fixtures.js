// 생활패턴 감지 검증용 SNS 게시물 스크린샷 생성기
//
// 핵심: 상대시각을 7의 배수 간격으로 두면 오늘이 며칠이든 늘 같은 요일이 된다.
// 그래야 "오늘 날짜"에 기대지 않고도 요일 패턴을 검증할 수 있다.
// 반대로 패턴 없음 세트는 7의 배수를 피해 서로 다른 요일에 흩어지게 만든다.
//
// 사용: node make-schedule-fixtures.js
// 결과: test/fixtures/schedule-<세트이름>/post1.png ...
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'fixtures');

// 각 세트의 정답(ground truth)을 함께 적어둔다. 검증 테스트가 이 파일을 읽어 쓴다.
const SETS = [
  {
    name: 'weekday',
    label: '요일 패턴 — 같은 요일 발레학원',
    truth: { pattern: true, kinds: ['요일'], note: '4·11·18·25일 전 = 모두 같은 요일' },
    posts: [
      { rel: '4일 전', place: '리틀스타 발레학원', cap: '오늘도 발레 수업 끝! 열심히 했어요 🩰' },
      { rel: '11일 전', place: '리틀스타 발레학원', cap: '발레 가는 날. 토슈즈 챙겼어요' },
      { rel: '18일 전', place: '리틀스타 발레학원', cap: '발레 수업 마치고 나오는 길 🩰' },
      { rel: '25일 전', place: '리틀스타 발레학원', cap: '오늘도 발레! 매주 이맘때가 제일 신나요' },
    ],
  },
  {
    name: 'timeofday',
    label: '시간대 패턴 — 매번 오후 4시 하원',
    truth: { pattern: true, kinds: ['시간대'], note: '1·3·6·9일 전 = 서로 다른 요일, 캡션에 오후 4시만 반복' },
    posts: [
      { rel: '1일 전', place: '', cap: '오후 4시 하원길, 오늘도 씩씩하게 나왔어요' },
      { rel: '3일 전', place: '', cap: '4시 하원. 오늘은 간식으로 붕어빵 🐟' },
      { rel: '6일 전', place: '', cap: '늘 그렇듯 오후 4시에 데리러 갔어요' },
      { rel: '9일 전', place: '', cap: '4시 정각 하원. 오늘은 안 울었어요!' },
    ],
  },
  {
    name: 'place',
    label: '장소 반복 — 요일은 무작위, 같은 어린이집',
    truth: { pattern: true, kinds: ['장소'], note: '2·4·10·15일 전 = 서로 다른 요일' },
    posts: [
      { rel: '2일 전', place: '햇살어린이집', cap: '오늘은 물놀이 했대요 💦' },
      { rel: '4일 전', place: '햇살어린이집', cap: '친구랑 블록 쌓기 삼매경' },
      { rel: '10일 전', place: '햇살어린이집', cap: '점심 다 먹었다고 자랑 중' },
      { rel: '15일 전', place: '햇살어린이집', cap: '낮잠 자고 일어난 얼굴 😴' },
    ],
  },
  {
    name: 'none',
    label: '패턴 없음 — 요일도 장소도 제각각',
    truth: { pattern: false, kinds: [], note: '2·6·10·15일 전 = 서로 다른 요일, 장소도 전부 다름' },
    posts: [
      { rel: '2일 전', place: '', cap: '집에서 그림 그렸어요 🎨' },
      { rel: '6일 전', place: '', cap: '할머니 댁 다녀왔어요' },
      { rel: '10일 전', place: '', cap: '비 오는 날 창밖 구경' },
      { rel: '15일 전', place: '', cap: '새 인형이 생겼어요 🧸' },
    ],
  },
  {
    name: 'weak',
    label: '근거 부족 — 같은 요일이지만 두 장뿐',
    truth: { pattern: null, kinds: [], note: '두 장으로 패턴을 단정하면 과잉 판정' },
    posts: [
      { rel: '3일 전', place: '푸른숲 태권도장', cap: '태권도 승급 심사 통과! 🥋' },
      { rel: '10일 전', place: '푸른숲 태권도장', cap: '오늘도 태권도 다녀왔어요' },
    ],
  },
];

function postHtml(p, idx) {
  const swatch = ['#dbeafe', '#dcfce7', '#fef3c7', '#fae8ff', '#ffe4e6'][idx % 5];
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 440px; font-family: 'Malgun Gothic','맑은 고딕',sans-serif; background: #fff; color: #111; }
  .status { display:flex; justify-content:space-between; padding:8px 16px; font-size:13px; font-weight:600; }
  .head { display:flex; align-items:center; gap:10px; padding:10px 14px; }
  .av { width:34px; height:34px; border-radius:50%; background:linear-gradient(135deg,#f9a8d4,#fcd34d); flex:0 0 auto; }
  .who { line-height:1.25; }
  .who b { font-size:14px; }
  .who span { display:block; font-size:12px; color:#333; }
  .photo { height:300px; background:${swatch}; display:flex; align-items:center; justify-content:center;
           color:#64748b; font-size:13px; }
  .acts { display:flex; gap:14px; padding:10px 14px 4px; font-size:19px; }
  .cap { padding:2px 14px 0; font-size:14px; line-height:1.5; }
  .cap b { margin-right:6px; }
  .time { padding:10px 14px 14px; font-size:11.5px; color:#8e8e8e; letter-spacing:0.2px; }
</style></head><body>
  <div class="status"><span>9:41</span><span>▮▮▮ ⌁ 82%</span></div>
  <div class="head">
    <div class="av"></div>
    <div class="who"><b>@mom_and_seoyeon</b>${p.place ? `<span>📍 ${p.place}</span>` : ''}</div>
  </div>
  <div class="photo">사진</div>
  <div class="acts"><span>♡</span><span>💬</span><span>↗</span></div>
  <div class="cap"><b>@mom_and_seoyeon</b>${p.cap}</div>
  <div class="time">${p.rel}</div>
</body></html>`;
}

// 요일은 (일수 mod 7)로 정해진다. 손으로 숫자를 고르다 보면 의도치 않게 겹치는데,
// 그러면 "패턴 없음" 세트에 진짜 요일 패턴이 생겨 정답표가 거짓말을 하게 된다.
// 실제로 처음 만든 세트 셋이 이 함정에 빠져 있었다. 만들 때마다 확인한다.
function assertWeekdayDesign(set) {
  const mods = set.posts.map(p => parseInt(p.rel, 10) % 7);
  const uniq = new Set(mods).size;
  const wantSame = set.truth.kinds.includes('요일') || set.truth.pattern === null;
  if (wantSame && uniq !== 1) {
    throw new Error(set.name + ': 같은 요일이어야 하는데 mod7이 ' + mods.join(','));
  }
  if (!wantSame && uniq !== mods.length) {
    throw new Error(set.name + ': 요일이 모두 달라야 하는데 mod7이 ' + mods.join(',') + ' — 겹칩니다');
  }
}

(async () => {
  SETS.forEach(assertWeekdayDesign);
  console.log('요일 설계 확인 통과 — 겹침 없음');
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 440, height: 560 }, deviceScaleFactor: 2 });
  const manifest = [];

  for (const set of SETS) {
    const dir = path.join(OUT, 'schedule-' + set.name);
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f));

    for (let i = 0; i < set.posts.length; i++) {
      await page.setContent(postHtml(set.posts[i], i), { waitUntil: 'load' });
      await page.waitForTimeout(120);
      await page.screenshot({ path: path.join(dir, 'post' + (i + 1) + '.png'), fullPage: true });
    }
    manifest.push({ name: set.name, label: set.label, truth: set.truth, posts: set.posts });
    console.log(set.label.padEnd(34) + ' → ' + set.posts.length + '장  (' + dir.replace(OUT, 'fixtures') + ')');
  }

  fs.writeFileSync(path.join(OUT, 'schedule-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log('\n정답표: fixtures/schedule-manifest.json');
  await b.close();
})();
