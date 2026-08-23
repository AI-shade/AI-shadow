// 과거 게시물 스크린샷만 올렸을 때의 경로 (API 호출 없음)
//
// 사진이 있어야만 진행되던 것을, 스크린샷만으로도 생활 패턴을 볼 수 있게 열었다.
// 얼굴·글자 검출과 보정은 올릴 사진이 있어야 뜻이 있으니 이 경로에서는 건너뛴다.
const { chromium } = require('playwright');
const { 무시해도되나 } = require('./console-noise.js');
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

const SHOTS = (() => {
  const dir = path.join(__dirname, 'fixtures', 'holdout-h1-sign');
  return fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort().map(f => path.join(dir, f));
})();

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 1000 } });
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => {
    if (!무시해도되나(m) && !/XNNPACK|INFO:|Created TensorFlow/.test(m.text())) errs.push(m.text());
  });
  await p.goto('http://localhost:8000/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(1300);

  // ── 아무것도 없으면 안내만 하고 진행하지 않는다
  let msg = null;
  p.once('dialog', d => { msg = d.message(); d.dismiss(); });
  await p.evaluate(() => document.getElementById('submitBtn').click());
  await p.waitForTimeout(400);
  check('둘 다 없으면 안내를 띄운다', !!msg && /스크린샷/.test(msg), msg || '(안내 없음)');
  check('안내가 스크린샷만으로도 된다고 알려준다', !!msg && /생활 패턴/.test(msg), msg);
  check('안내 후에도 진단 화면으로 넘어가지 않는다',
    (await p.evaluate(() => getComputedStyle(document.getElementById('screen-form')).display)) !== 'none');

  // ── 스크린샷만 넣으면 버튼과 안내가 바뀐다
  const before = await p.evaluate(() => document.getElementById('submitBtn').textContent.trim());
  await p.setInputFiles('#pastInput', SHOTS);
  await p.waitForTimeout(400);
  const after = await p.evaluate(() => ({
    btn: document.getElementById('submitBtn').textContent.trim(),
    hint: document.getElementById('fileCount').textContent.trim(),
  }));
  check('사진이 없으면 버튼이 "생활 패턴만 분석하기"로 바뀐다',
    before === '위험도 진단하기' && after.btn === '생활 패턴만 분석하기', before + ' → ' + after.btn);
  check('안내도 사진 없이 된다고 말한다', /사진 없이/.test(after.hint), after.hint);

  // ── 사진을 같이 넣으면 원래 문구로 돌아온다
  const tmp = path.join(__dirname, 'fixtures', 'face-only.png');
  await p.setInputFiles('#photoInput', tmp);
  await p.waitForTimeout(400);
  const both = await p.evaluate(() => ({
    btn: document.getElementById('submitBtn').textContent.trim(),
    hint: document.getElementById('fileCount').textContent.trim(),
  }));
  check('사진까지 있으면 원래 문구로 돌아온다', both.btn === '위험도 진단하기', both.btn);
  check('안내도 함께 진행한다고 바뀐다', /함께 진행/.test(both.hint), both.hint);

  // ── 결과 화면 렌더링 (실제 분석은 비용이 들어 여기서는 값만 넣어 확인한다)
  const rendered = await p.evaluate(() => {
    const T = window.__anshimTest;
    document.querySelectorAll('.card').forEach(c => { c.style.display = 'none'; });
    document.getElementById('screen-pattern').style.display = 'block';
    T.renderPatternOnly({
      scheduleOn: true,
      patterns: [
        { 유형: '장소반복', 내용: '하늘유치원이 4개 게시물에 등장', 근거게시물: [1, 2, 3, 4] },
        { 유형: '시간대패턴', 내용: '등하원 시간대 활동이 반복', 근거게시물: [2, 3] },
      ],
      predictedInfo: '아이가 다니는 유치원이 드러남',
      evidence: '유치원명이 반복 노출되고 있습니다.',
      extracted: [
        { relativeTime: '2일 전', placeTag: '', backgroundTexts: ['하늘유치원'] },
        { relativeTime: '4일 전', placeTag: '하늘유치원', backgroundTexts: [] },
        { relativeTime: '10일 전', placeTag: '', backgroundTexts: [], skippedNoFaceConsent: true },
      ],
    }, 3);
    return {
      flag: document.getElementById('pScheduleFlag').textContent,
      flagOn: document.getElementById('pScheduleFlag').className.includes('on'),
      patterns: [...document.querySelectorAll('#pPatternList li')].map(x => x.textContent),
      predicted: document.getElementById('pPredicted').textContent,
      predictedShown: getComputedStyle(document.getElementById('pPredicted')).display !== 'none',
      read: [...document.querySelectorAll('#pReadList li')].map(x => x.textContent),
      stepper: getComputedStyle(document.querySelector('#screen-pattern')).display,
      ov: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });

  check('경고 배지가 "경고"로 강조된다', rendered.flag === '경고' && rendered.flagOn, rendered.flag);
  check('패턴을 줄마다 보여준다', rendered.patterns.length === 2, String(rendered.patterns.length));
  check('근거 게시물 번호를 함께 적는다', /근거: 1번, 2번, 3번, 4번/.test(rendered.patterns[0]), rendered.patterns[0]);
  check('예측 가능 정보를 보여준다', rendered.predictedShown && /유치원/.test(rendered.predicted));
  check('무엇을 읽었는지 게시물마다 보여준다', rendered.read.length === 3, String(rendered.read.length));
  check('위치 태그와 사진 속 글자를 구분해 적는다',
    /“하늘유치원”/.test(rendered.read[0]) && /📍 하늘유치원/.test(rendered.read[1]),
    rendered.read.slice(0, 2).join(' | '));
  check('뺀 스크린샷은 이유를 적는다',
    /얼굴을 못 찾아/.test(rendered.read[2]) && /보내지 않았어요/.test(rendered.read[2]), rendered.read[2]);
  check('가로 스크롤 없음', !rendered.ov);

  // ── 뺀 스크린샷을 알리고 되돌릴 수 있는가
  // 예전에는 얼굴을 못 찾을 때마다 확인 창을 띄웠다. 사진과 스크린샷을 함께 올리면
  // 사진은 멀쩡한데도 스크린샷 하나 때문에 결과 화면 위로 창이 튀어나왔다(실사용 제보).
  // 지금은 묻지 않고 안전한 쪽(제외)으로 처리하되, 어떤 장을 왜 뺐는지 반드시 알린다.
  const skip = await p.evaluate(() => {
    const T = window.__anshimTest;
    T.renderPatternOnly({
      scheduleOn: false, patterns: [], predictedInfo: '', evidence: '패턴이 없어요.',
      extracted: [
        { relativeTime: '1일 전', placeTag: '', backgroundTexts: [] },
        { relativeTime: '', placeTag: '', backgroundTexts: [], skippedNoFaceConsent: true },
        { relativeTime: '', placeTag: '', backgroundTexts: [], skippedNoFaceConsent: true },
      ],
      skippedCount: 2, totalCount: 3,
    }, 3);
    const box = document.getElementById('pSkipNotice');
    const shown = getComputedStyle(box).display !== 'none';
    const text = document.getElementById('pSkipText').textContent;
    // 뺀 게 없을 때는 안내가 사라져야 한다
    T.renderPatternOnly({
      scheduleOn: false, patterns: [], predictedInfo: '', evidence: '패턴이 없어요.',
      extracted: [{ relativeTime: '1일 전', placeTag: '', backgroundTexts: [] }],
      skippedCount: 0, totalCount: 1,
    }, 1);
    return { shown, text, hiddenWhenNone: getComputedStyle(box).display === 'none',
             hasBtn: !!document.getElementById('pIncludeBtn') };
  });
  check('뺀 장이 있으면 그 사실을 알린다', skip.shown);
  check('몇 장 중 몇 장인지 적는다', /3장 중 2장/.test(skip.text), skip.text);
  check('왜 뺐는지 적는다', /보내지 않습니다|가릴 수 없/.test(skip.text), skip.text);
  check('그래도 포함할 방법을 준다', skip.hasBtn);
  check('뺀 장이 없으면 안내를 감춘다', skip.hiddenWhenNone);

  // ── 패턴이 없을 때도 읽은 내용은 보여줘야 한다
  const none = await p.evaluate(() => {
    window.__anshimTest.renderPatternOnly({
      scheduleOn: false, patterns: [], predictedInfo: '', evidence: '반복 패턴이 없어요.',
      extracted: [{ relativeTime: '1일 전', placeTag: '', backgroundTexts: [] }],
    }, 1);
    return {
      flag: document.getElementById('pScheduleFlag').textContent,
      listShown: getComputedStyle(document.getElementById('pPatternList')).display !== 'none',
      predictedShown: getComputedStyle(document.getElementById('pPredicted')).display !== 'none',
      read: [...document.querySelectorAll('#pReadList li')].map(x => x.textContent),
    };
  });
  check('패턴이 없으면 "없음"으로 표시', none.flag === '없음', none.flag);
  check('패턴이 없으면 목록을 감춘다', !none.listShown);
  check('예측 정보가 없으면 감춘다', !none.predictedShown);
  check('패턴이 없어도 무엇을 읽었는지는 남긴다',
    none.read.length === 1 && /1일 전/.test(none.read[0]), none.read.join(' | '));

  // ── 머리말이 지금 하는 일에 맞게 바뀌는가
  // 스크린샷만 보는 화면에서 "사진 진단 · 사진을 올리고 세 단계를"은 사실과 다르다.
  const heads = await p.evaluate(() => {
    const read = () => ({
      t: document.getElementById('appTitle').textContent.trim(),
      s: document.getElementById('appSubtitle').textContent.trim(),
      stepper: getComputedStyle(document.getElementById('stepper')).display,
    });
    const T = window.__anshimTest;
    T.showScreenForTest('form');
    const form = read();
    T.showScreenForTest('pattern');
    const pattern = read();
    T.showScreenForTest('form');
    const back = read();
    return { form, pattern, back };
  });
  check('진단 화면 머리말은 "사진 진단"', heads.form.t === '사진 진단', heads.form.t);
  check('SNS 화면 머리말은 "SNS 게시물 검사"', heads.pattern.t === 'SNS 게시물 검사', heads.pattern.t);
  check('SNS 화면 설명에 사진 얘기가 없다',
    !/사진을 올리고/.test(heads.pattern.s) && /게시물/.test(heads.pattern.s), heads.pattern.s);
  check('SNS 화면에서는 세 단계 표시를 감춘다', heads.pattern.stepper === 'none', heads.pattern.stepper);
  check('진단 화면으로 돌아오면 머리말도 되돌아온다',
    heads.back.t === '사진 진단' && heads.back.stepper !== 'none',
    heads.back.t + ' / ' + heads.back.stepper);

  // ── 경고 배지가 경고답게 보이는가
  const badge = await p.evaluate(() => {
    const f = document.getElementById('pScheduleFlag');
    const off = (() => {
      f.className = 'schedule-flag'; f.textContent = '없음';
      const cs = getComputedStyle(f);
      return { bg: cs.backgroundColor, fg: cs.color, weight: cs.fontWeight };
    })();
    f.className = 'schedule-flag on'; f.textContent = '있음';
    const cs = getComputedStyle(f);
    const bef = getComputedStyle(f, '::before');
    return {
      off,
      bg: cs.backgroundColor, fg: cs.color, weight: cs.fontWeight,
      size: parseFloat(cs.fontSize), ring: cs.boxShadow !== 'none',
      iconColor: bef.borderBottomColor, iconContent: bef.content,
    };
  });
  const lum = (c) => {
    const [r, g, b] = c.match(/[0-9.]+/g).map(Number).slice(0, 3).map(v => {
      v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const [x, y] = [lum(a), lum(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };

  check('경고 상태는 평상시보다 굵다', Number(badge.weight) > Number(badge.off.weight),
    badge.off.weight + ' → ' + badge.weight);
  check('경고 상태는 색이 달라진다', badge.bg !== badge.off.bg && badge.fg !== badge.off.fg);
  check('경고 배지에 테두리가 둘러진다', badge.ring);
  check('경고 배지 글자가 충분히 크다', badge.size >= 15, badge.size + 'px');
  check('경고 배지 대비가 AA를 넘는다', contrast(badge.fg, badge.bg) >= 4.5,
    contrast(badge.fg, badge.bg).toFixed(2) + ':1');
  // 이모지(⚠)는 기기마다 노란 그림으로 그려져 글자색을 안 따라간다
  check('경고 아이콘이 이모지가 아니다', !/⚠/.test(badge.iconContent), badge.iconContent);
  check('경고 아이콘이 글자색을 그대로 따른다', badge.iconColor === badge.fg,
    badge.iconColor + ' vs ' + badge.fg);

  // ── 긴 설명이 한글 단어 중간에서 끊기지 않는가
  // word-break 기본값은 한글을 아무 글자에서나 끊는다 — "빈도와"가 "빈도/와"로,
  // "예측"이 "예/측"으로 갈라져 읽다 걸린다(실사용 제보).
  const wrap = await p.evaluate(() => {
    const T = window.__anshimTest;
    T.showScreenForTest('pattern');
    T.renderPatternOnly({
      scheduleOn: true,
      patterns: [{ 유형: '장소반복', 내용: '햇살어린이집이 네 게시물 모두에서 등장하며 등원 시간대까지 드러난다', 근거게시물: [1, 2, 3, 4] }],
      predictedInfo: '아이가 햇살어린이집을 정기적으로 다니고 있으며, 평일뿐 아니라 토요일에도 등원하는 패턴. '
        + '게시물 빈도와 요일 분포를 보면 주 3~4회 이상 방문하는 것으로 추정 가능. '
        + '이는 아이의 일주일 생활 동선을 충분히 예측 가능하게 만듦.',
      evidence: '어린이집 이름이 반복 노출되고 있습니다.',
      extracted: [],
    }, 0);
    const pick = (sel) => {
      const el = document.querySelector(sel);
      const cs = getComputedStyle(el);
      const parentW = el.parentElement.getBoundingClientRect().width;
      const w = el.getBoundingClientRect().width;
      return { wordBreak: cs.wordBreak, gap: Math.round(parentW - w), w: Math.round(w) };
    };
    return {
      predicted: pick('#pPredicted'),
      evidence: pick('#pEvidence'),
      item: pick('#pPatternList li'),
    };
  });
  check('예측 문단이 단어를 붙여 끊는다', wrap.predicted.wordBreak === 'keep-all', wrap.predicted.wordBreak);
  check('안내 문단도 단어를 붙여 끊는다', wrap.evidence.wordBreak === 'keep-all', wrap.evidence.wordBreak);
  check('패턴 목록도 단어를 붙여 끊는다', wrap.item.wordBreak === 'keep-all', wrap.item.wordBreak);
  // 읽기 폭 제한 자체는 남기되, 오른쪽이 눈에 띄게 비면 안 된다(전에는 247px 남았다)
  check('오른쪽에 남는 자리가 과하지 않다', wrap.predicted.gap < 140, wrap.predicted.gap + 'px');

  check('페이지 에러 없음', errs.length === 0, errs.slice(0, 2).join(' / '));

  console.log('\n결과: ' + pass + '/' + (pass + fail) + ' 통과');
  await b.close();
  process.exit(fail ? 1 : 0);
})();
