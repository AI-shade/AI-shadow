// 생활패턴 감지 실검증 (비용 발생 — Claude Vision + Claude 텍스트 호출)
//
// 정답을 알고 만든 다섯 세트를 실제 파이프라인에 그대로 통과시킨다.
//   스크린샷 PNG → 얼굴 마스킹 → Claude Vision 판독(캡션·게시시점·배경텍스트)
//   → Claude 패턴 분석(요일 역산, 반복 탐지)
//
// 사용: node schedule-live.js         (전체)
//       node schedule-live.js weekday (한 세트만)
//
// 정답표는 fixtures/schedule-manifest.json (make-schedule-fixtures.js가 만든다).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const FIX = path.join(__dirname, 'fixtures');
const manifest = JSON.parse(fs.readFileSync(path.join(FIX, 'schedule-manifest.json'), 'utf8'));
const only = process.argv[2];
const sets = only ? manifest.filter(s => s.name === only) : manifest;

let pass = 0, fail = 0, warn = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('    ✓ ' + name); }
  else { fail++; console.log('    ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function note(name, detail) { warn++; console.log('    · ' + name + (detail ? ' — ' + detail : '')); }

(async () => {
  const totalShots = sets.reduce((n, s) => n + s.posts.length, 0);
  console.log('생활패턴 실검증 — 세트 ' + sets.length + '개 / 스크린샷 ' + totalShots + '장');
  console.log('Claude Vision ' + totalShots + '회 + 패턴 분석 ' + sets.length + '회 호출 (비용 발생)\n');

  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));

  await p.goto('http://localhost:8000/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(1200);

  // 목업 스크린샷에는 얼굴이 없어서 "얼굴 미검출" 동의창이 뜬다.
  // 실제 SNS 캡처에는 대개 아이 얼굴이 있어 안 뜨지만, 여기서는 그 경로를 통과시켜야 한다.
  await p.evaluate(() => {
    const btn = document.getElementById('noFaceConsentOriginal');
    const obs = new MutationObserver(() => {
      const m = document.getElementById('noFaceConsentModal');
      if (m && getComputedStyle(m).display !== 'none') btn.click();
    });
    obs.observe(document.getElementById('noFaceConsentModal'), { attributes: true, attributeFilter: ['style'] });
    // 이미 떠 있을 수도 있다
    const m = document.getElementById('noFaceConsentModal');
    if (m && getComputedStyle(m).display !== 'none') btn.click();
  });

  const results = [];

  for (const set of sets) {
    console.log('── ' + set.label);
    console.log('   (' + set.truth.note + ')');
    const dir = path.join(FIX, 'schedule-' + set.name);
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort();

    // 파일을 브라우저의 File 객체로 만들어 실제 업로드 경로와 같게 넘긴다
    const payload = files.map(f => ({
      name: f,
      b64: fs.readFileSync(path.join(dir, f)).toString('base64'),
    }));

    const t0 = Date.now();
    const out = await p.evaluate(async (items) => {
      const files = items.map(it => {
        const bin = atob(it.b64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return new File([arr], it.name, { type: 'image/png' });
      });
      try {
        return { ok: true, data: await window.__anshimTest.runScheduleAnalysisPipeline(files) };
      } catch (e) {
        return { ok: false, err: String(e && e.message || e) };
      }
    }, payload);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);

    if (!out.ok) {
      check(set.label + ' — 파이프라인이 끝까지 돈다', false, out.err);
      continue;
    }
    const d = out.data;

    // 판독 단계에서 실제로 무엇을 읽어왔는지 그대로 보여준다 — 왜 놓쳤는지 알아야 고친다
    (d.extracted || []).forEach((e, i) => {
      console.log('    [판독 ' + (i + 1) + '] 시점="' + (e.relativeTime || '') + '"'
        + ' 위치태그="' + (e.placeTag || '') + '"'
        + ' 배경=' + JSON.stringify(e.backgroundTexts || [])
        + ' 캡션="' + String(e.caption || '').slice(0, 28) + '"');
    });

    // 판독 단계: 게시시점을 제대로 읽었는가
    const wantRels = set.posts.map(x => x.rel);
    const gotRels = (d.extracted || []).map(e => (e.relativeTime || '').trim());
    const relHit = wantRels.filter(w => gotRels.some(g => g.replace(/\s/g, '') === w.replace(/\s/g, ''))).length;
    check('게시시점을 정확히 읽는다 (' + relHit + '/' + wantRels.length + ')',
      relHit === wantRels.length, '기대 ' + wantRels.join(', ') + ' / 실제 ' + gotRels.join(', '));

    // 장소가 있는 세트는 장소도 읽혀야 한다.
    // 한두 글자 오독은 통과로 본다 — "푸른숲"을 "푸른솔"로 읽어도 모든 게시물에서
    // 똑같이 오독하므로 "같은 장소가 반복된다"는 결론은 그대로 성립한다.
    // 서버 프롬프트도 "유사한 표현은 같은 장소로 간주"하라고 지시하고 있다.
    const wantPlaces = [...new Set(set.posts.map(x => x.place).filter(Boolean))];
    if (wantPlaces.length) {
      const got = (d.extracted || []).map(e => String(e.placeTag || '')).filter(Boolean);
      const near = (a, bStr) => {
        if (a === bStr) return true;
        if (Math.abs(a.length - bStr.length) > 1) return false;
        let diff = 0;
        for (let i = 0; i < Math.max(a.length, bStr.length); i++) if (a[i] !== bStr[i]) diff++;
        return diff <= 1; // 한 글자까지 오독 허용
      };
      const misread = [];
      const placeHit = wantPlaces.filter(pl => got.some(g => {
        if (g === pl) return true;
        if (near(g, pl)) { misread.push(pl + ' → ' + g); return true; }
        return false;
      })).length;
      check('장소를 읽는다 (' + placeHit + '/' + wantPlaces.length + ')',
        placeHit === wantPlaces.length,
        '기대 ' + wantPlaces.join(', ') + ' / 실제 ' + (got.join(', ') || '(못 읽음)'));
      if (misread.length) note('장소명을 한 글자 오독', misread.join(' · '));
    }

    // 패턴 판정
    const kinds = (d.patterns || []).map(x => x.유형 || '').join(' ');
    if (set.truth.pattern === true) {
      check('패턴을 찾아낸다', d.scheduleOn === true, '판정: ' + (d.scheduleOn ? '있음' : '없음'));
      const wantKind = set.truth.kinds[0];
      const kindOk = kinds.includes(wantKind);
      if (d.scheduleOn) {
        check('패턴 유형이 ' + wantKind + '이다', kindOk, '실제: ' + (kinds || '(없음)'));
      }
    } else if (set.truth.pattern === false) {
      check('없는 패턴을 지어내지 않는다', d.scheduleOn === false,
        '판정: 있음 / ' + kinds + ' — ' + (d.predictedInfo || ''));
    } else {
      // 정답을 단정할 수 없는 세트 — 무엇이라 답했는지만 기록한다
      note('두 장만 줬을 때의 판단', d.scheduleOn ? '패턴 있다고 답함 (' + kinds + ')' : '패턴 없다고 답함');
    }

    console.log('    ⟢ ' + secs + '초 · 판정 ' + (d.scheduleOn ? '패턴 있음' : '패턴 없음')
      + (d.patterns || []).map(x => '\n      - [' + (x.유형 || '') + '] ' + (x.내용 || '')).join(''));
    if (d.predictedInfo) console.log('      예측 가능: ' + d.predictedInfo);
    if (d.evidence) console.log('      부모 안내: ' + d.evidence);
    console.log('');

    results.push({ set: set.name, scheduleOn: d.scheduleOn, kinds, secs });
  }

  check('페이지 에러 없음', errs.length === 0, errs.slice(0, 2).join(' / '));

  console.log('결과: ' + pass + '/' + (pass + fail) + ' 통과' + (warn ? ' (판단 기록 ' + warn + '건)' : ''));
  await b.close();
  process.exit(fail ? 1 : 0);
})();
