// 생활패턴 감지 — 홀드아웃 검증 (비용 발생, 한 번만 돌린다)
//
// 튜닝용 세트(schedule-live.js)로 잰 점수는 시험 문제를 보고 공부한 뒤 그 문제로
// 시험 본 것과 같다. 이 파일은 한 번도 튜닝에 쓰지 않은 세트로 잰다.
//
// 규칙: 나온 숫자를 그대로 보고한다. 결과를 보고 프롬프트나 코드를 고치지 않는다.
// 고쳐야 할 것이 보이면 튜닝 세트에서 고치고, 홀드아웃을 새로 만들어 다시 잰다.
//
// 채점 기준은 결과를 보기 전에 아래에 못박아 둔다.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const FIX = path.join(__dirname, 'fixtures');
const { 만든날, sets } = JSON.parse(fs.readFileSync(path.join(FIX, 'holdout-manifest.json'), 'utf8'));

let pass = 0, fail = 0;
const notes = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log('    ✓ ' + name); }
  else { fail++; console.log('    ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function note(t) { notes.push(t); console.log('    · ' + t); }

// 한두 글자 오독은 같은 것으로 본다 (튜닝 세트에서 정한 기준을 그대로 적용)
function near(a, b) {
  a = String(a).replace(/\s/g, ''); b = String(b).replace(/\s/g, '');
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let diff = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) diff++;
  return diff <= 1;
}

(async () => {
  const total = sets.reduce((n, s) => n + s.posts.length, 0);
  console.log('홀드아웃 검증 — 세트 ' + sets.length + '개 / 스크린샷 ' + total + '장 (픽스처 생성일 ' + 만든날 + ')');
  console.log('한 번만 돌리고 결과를 그대로 보고한다. Vision ' + total + '회 + 분석 ' + sets.length + '회.\n');

  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://localhost:8000/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(1200);
  await p.evaluate(() => {
    const btn = document.getElementById('noFaceConsentOriginal');
    const m = document.getElementById('noFaceConsentModal');
    new MutationObserver(() => {
      if (getComputedStyle(m).display !== 'none') btn.click();
    }).observe(m, { attributes: true, attributeFilter: ['style'] });
    if (getComputedStyle(m).display !== 'none') btn.click();
  });

  for (const set of sets) {
    console.log('── ' + set.label);
    console.log('   ' + set.truth.note);
    const dir = path.join(FIX, 'holdout-' + set.name);
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort();
    const payload = files.map(f => ({ name: f, b64: fs.readFileSync(path.join(dir, f)).toString('base64') }));

    const t0 = Date.now();
    const out = await p.evaluate(async (items) => {
      const fl = items.map(it => {
        const bin = atob(it.b64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return new File([arr], it.name, { type: 'image/png' });
      });
      try { return { ok: true, data: await window.__anshimTest.runScheduleAnalysisPipeline(fl) }; }
      catch (e) { return { ok: false, err: String(e && e.message || e) }; }
    }, payload);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);

    if (!out.ok) { check(set.name + ' 파이프라인이 끝까지 돈다', false, out.err); continue; }
    const d = out.data;

    (d.extracted || []).forEach((e, i) => {
      console.log('    [판독 ' + (i + 1) + '] 시점="' + (e.relativeTime || '') + '"'
        + ' 위치태그="' + (e.placeTag || '') + '"'
        + ' 배경=' + JSON.stringify(e.backgroundTexts || []));
    });

    // ── 공통: 게시 시각을 읽는가
    const wantRels = set.posts.map(x => x.rel);
    const gotRels = (d.extracted || []).map(e => (e.relativeTime || '').trim());
    const relHit = wantRels.filter(w => gotRels.some(g => near(g, w))).length;
    check('게시 시각을 읽는다 (' + relHit + '/' + wantRels.length + ')',
      relHit === wantRels.length, '실제 ' + JSON.stringify(gotRels));

    // ── 공통: 장소를 어디서든 읽어내는가 (위치태그든 사진 속 간판이든)
    const blob = JSON.stringify(d.extracted || []);
    if (set.truth.places.length) {
      const anyPlace = set.truth.places.some(pl =>
        blob.includes(pl) || (d.extracted || []).some(e =>
          [e.placeTag, ...(e.backgroundTexts || [])].some(g => g && near(g, pl))));
      check('장소를 읽어낸다', anyPlace, '기대 ' + set.truth.places[0]);
    }

    const kinds = (d.patterns || []).map(x => x.유형 || '').join(' ');

    // ── 세트별 기준 (결과를 보기 전에 정해둔 것)
    if (set.name === 'h1-sign') {
      check('위치 태그 없이 사진 속 간판만으로 장소 반복을 잡는다',
        d.scheduleOn === true && /장소/.test(kinds), '판정 ' + (d.scheduleOn ? kinds : '패턴 없음'));
    } else if (set.name === 'h2-absdate') {
      check('절대 날짜 표기에서도 같은 요일 반복을 잡는다',
        d.scheduleOn === true && /요일/.test(kinds), '판정 ' + (d.scheduleOn ? kinds : '패턴 없음'));
      const wd = set.truth.note.match(/모두 (.)요일/)[1];
      const said = JSON.stringify(d.patterns || []) + (d.predictedInfo || '');
      check('요일을 ' + wd + '요일로 정확히 짚는다', said.includes(wd + '요일'),
        '실제: ' + (said.match(/[월화수목금토일]요일/g) || ['(언급 없음)']).join(','));
    } else if (set.name === 'h3-mixeddate') {
      check('상대·절대 표기를 섞어 써도 같은 요일 반복을 잡는다',
        d.scheduleOn === true && /요일/.test(kinds), '판정 ' + (d.scheduleOn ? kinds : '패턴 없음'));
      const wd3 = set.truth.note.match(/모두 (.)요일/)[1];
      const said3 = JSON.stringify(d.patterns || []) + (d.predictedInfo || '');
      check('요일을 ' + wd3 + '요일로 정확히 짚는다', said3.includes(wd3 + '요일'),
        '실제: ' + (said3.match(/[월화수목금토일]요일/g) || ['(언급 없음)']).join(','));
    } else if (set.name === 'h4-decoy') {
      check('우연한 요일 겹침을 요일 패턴이라 단정하지 않는다',
        !/요일/.test(kinds), '실제 ' + (kinds || '(패턴 없음)'));
    }

    console.log('    ⟢ ' + secs + '초 · 판정 ' + (d.scheduleOn ? '패턴 있음' : '패턴 없음')
      + (d.patterns || []).map(x => '\n      - [' + (x.유형 || '') + '] ' + (x.내용 || '')).join(''));
    if (d.evidence) console.log('      부모 안내: ' + d.evidence);
    console.log('');
  }

  check('페이지 에러 없음', errs.length === 0, errs.slice(0, 2).join(' / '));
  console.log('홀드아웃 결과: ' + pass + '/' + (pass + fail) + ' 통과');
  if (notes.length) console.log('기록: ' + notes.join(' | '));
  await b.close();
  // 홀드아웃은 "고칠 거리를 찾는" 자리다. 실패해도 종료 코드로 빌드를 막지 않는다.
  process.exit(0);
})();
