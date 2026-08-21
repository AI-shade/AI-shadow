// 안심앨범 — Claude Vision 중계 백엔드
//
// 역할: 브라우저는 이 서버에만 이미지를 보내고, 이 서버가 Anthropic API 키를 붙여
// Claude Vision을 호출한다. API 키는 여기(.env)에만 있고 브라우저로는 절대 나가지 않는다.
//
// 실행: npm install && npm start  (server/.env에 ANTHROPIC_API_KEY 필요)

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import { fal } from '@fal-ai/client';
import { estimateFillCostUsd } from './fill-cost.js';

const PORT = process.env.PORT || 3001;
// 사용자가 지정한 모델. 날짜 접미사(-20251001) 없는 정식 모델 ID를 사용함
// (Anthropic 모델 ID는 날짜 접미사를 붙이지 않는 것이 현재 규칙).
const MODEL = 'claude-haiku-4-5';

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('[server] ⚠ ANTHROPIC_API_KEY가 설정되지 않았습니다. server/.env를 만들어주세요 (.env.example 참고).');
}
if (!process.env.FAL_KEY) {
  console.warn('[server] ⚠ FAL_KEY가 설정되지 않았습니다 — AI 배경교체(/api/replace-background)는 준비 중 상태로 동작합니다.');
} else {
  fal.config({ credentials: process.env.FAL_KEY });
}

const anthropic = new Anthropic(); // ANTHROPIC_API_KEY 환경변수에서 자동으로 읽음

const app = express();
app.use(cors({ origin: /^http:\/\/localhost(:\d+)?$/ })); // 로컬 프론트만 허용
app.use(express.json({ limit: '15mb' })); // 마스킹된 이미지(base64)가 들어있어 넉넉하게

const PROMPT = `이 이미지에서 두 가지를 찾아줘.

[1] 보이는 모든 텍스트
간판, 표지판, 차량번호판, 전화번호, 주소 등 위치를 특정할 수 있는 정보에 특히 주의해줘.
각 텍스트의 대략적인 위치(상단/중앙/좌하단 등)도 함께 알려줘.

[2] 글자가 아닌 시각적 신원 단서
판단 기준은 딱 하나야: **이것으로 아이가 다니는 기관(학교·유치원·어린이집·학원·팀)을
좁혀낼 수 있는가?** 그렇지 않으면 보고하지 마.

보고할 것:
- 교복, 원복(유치원복), 어린이집 가운, 체육복, 태권도복 등 소속 기관이 정해주는 복장
- 명찰 (이름표) — 글자가 안 보여도 달려 있으면 보고 (아이 이름이 적혀 있을 수 있음)
- 학교·유치원·학원의 로고, 마크, 엠블럼 (옷·가방·모자·차량 어디에 있든)
- 스포츠팀 유니폼, 학원 차량

보고하지 말 것 (기관을 좁혀주지 않는 것들):
- 일반 사복, 유행하는 옷, 무늬 있는 양말·머리핀·신발 같은 개인 취향 물건
- 색깔이나 무늬 그 자체 (예: "체크무늬 치마", "별 무늬 양말")
- 나이·성별처럼 사진을 보면 누구나 아는 정보

**한 벌은 한 항목으로.** 교복 상의·치마·넥타이·양말을 따로 쪼개지 말고 "교복" 하나로
묶어서 보고하고, 근거에 구성 요소를 적어. 다만 그 위의 로고·엠블럼은 기관을 직접
가리키므로 별도 항목으로 빼줘.

교복·원복은 아이가 다니는 기관을 특정할 수 있어 주소 다음으로 강한 위치 단서야.
확실하지 않으면 "추정"이라고 적되, 소속을 드러낼 가능성이 있으면 빠뜨리지는 말아줘.

JSON으로만 응답해줘 (다른 설명 없이):
{
  "감지된텍스트": [
    {"내용": "...", "위치": "상단 중앙", "유형": "상호명"}
  ],
  "시각단서": [
    {"종류": "원복", "근거": "동일한 색·디자인의 원아용 상의와 모자", "위치": "중앙", "확신": "추정"}
  ]
}
해당하는 것이 없으면 각각 빈 배열로 응답해줘.`;

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('응답에서 JSON을 찾을 수 없음: ' + text.slice(0, 300));
  return JSON.parse(match[0]);
}

// 이미지 없이 텍스트만으로 Claude를 호출하는 공용 헬퍼 (위험도 진단, 캡션 제안에서 재사용)
async function callClaudeText(systemPrompt, userPrompt) {
  const t0 = Date.now();
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1536,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const textBlock = response.content.find((b) => b.type === 'text');
    const rawText = textBlock ? textBlock.text : '';
    const parsed = extractJson(rawText); // 실패하면 던져서 호출부의 catch로 감
    return { parsed: parsed, timingMs: Date.now() - t0, usage: response.usage, model: response.model, rawText: rawText };
  } catch (err) {
    if (err instanceof SyntaxError || /JSON을 찾을 수 없음/.test(err.message || '')) {
      var jsonErr = new Error('Claude 응답 파싱 실패: ' + err.message);
      jsonErr.isParseError = true;
      throw jsonErr;
    }
    throw err;
  }
}

function mapAnthropicError(err) {
  let status = 500;
  let message = err.message || 'Claude 호출 실패';
  if (err.isParseError) {
    status = 422;
  } else if (err instanceof Anthropic.AuthenticationError) {
    status = 401; message = 'API 키가 유효하지 않습니다.';
  } else if (err instanceof Anthropic.RateLimitError) {
    status = 429; message = '요청이 너무 많습니다 (rate limit).';
  } else if (err instanceof Anthropic.APIConnectionError) {
    status = 503; message = 'Anthropic API에 연결할 수 없습니다 (네트워크 문제).';
  } else if (err instanceof Anthropic.APIError) {
    status = err.status || 500;
  }
  return { status, message };
}

// ===== 1. 위험도 진단 프롬프트 (아이사진_SNS위험진단_프롬프트.md 1번) =====
const RISK_SYSTEM_PROMPT = `당신은 아동 안전 및 프라이버시 보호 전문가입니다. 부모가 SNS에 올리려는
아이 사진과 관련 정보를 보고, 유괴·스토킹·신원특정 등의 위험 요소를
진단하는 역할을 합니다.

원칙:
- 과장하지 말고, 근거에 기반해 담백하게 설명하세요
- 위험도는 상/중/하로 분류하고 0~100점 점수도 함께 제시하세요
- 왜 그 점수인지 구체적 근거를 반드시 포함하세요
- 실행 가능한 구체적 조치를 제안하세요
- 한자나 일본어 한자(紺色, 學校 등)를 쓰지 말고 쉬운 한국어로만 쓰세요 (감색, 학교).
- 부모가 읽는 글이므로 전문용어보다 일상어를 쓰세요.
- 부모를 불안하게 만들기보다, 실질적으로 도움이 되는 톤을 유지하세요

중요 — 시각적 신원 단서(교복·원복·명찰·기관 로고) 해석 시:
교복이나 원복은 아이가 다니는 학교·유치원을 특정할 수 있어, 주소 다음으로 강한
위치 노출 근거입니다. 평일 같은 시간대에 아이가 어디 있는지 알려주는 것과 같기 때문입니다.
명찰은 아이의 이름 자체가 노출될 수 있어 별도로 무겁게 다루세요.
이런 단서가 있으면 "위치노출근거"에 반드시 포함하고 점수에 반영하세요.
스케줄 패턴 분석 결과와 겹칠 경우(예: 매주 같은 요일·시간대 업로드 + 원복) 위험이
곱해지므로 더 높게 평가하세요.

중요 — 텍스트 판독 결과 해석 시:
전달받는 텍스트는 비전 모델로 추출된 것이라 부정확하거나
부분적으로만 인식되었을 수 있습니다. 일부 글자가 깨진 경우에도,
그것이 위치 특정 가능한 단서인지 맥락으로 추론하세요.
완벽한 판독을 기다리지 말고, 부분 정보만으로도 위험 여부를 판단하세요.

출력 길이 제약 (반드시 지킬 것 — 데모 중 응답 대기시간을 줄이기 위함):
- "위치노출근거"는 2문장 이내
- "종합설명"은 3문장 이내
- "권장조치"는 최대 3개, 각 항목은 1문장 이내
- 불필요한 수식어나 반복 없이 핵심만 간결하게 작성
(실측: 이 제약으로 출력 토큰 34%, 응답시간 26% 감소 확인 — 내용 품질 저하 없음)`;

function buildRiskUserPrompt(body) {
  var texts = body.texts || [];
  var detectedTexts = texts.length > 0 ? texts.map(function (t) { return t.content; }).join(', ') : '(감지된 텍스트 없음)';
  var textPositions = texts.length > 0 ? texts.map(function (t) { return t.content + ': ' + (t.position || '위치 불명'); }).join(', ') : '(없음)';
  var face = body.face || { count: 0, faces: [] };
  var faceDetail = (face.faces || []).map(function (f, i) {
    return '얼굴' + (i + 1) + '(각도 roll ' + Math.round(f.rollDeg) + '도, 크기 ' + f.areaRatioPct.toFixed(1) + '%)';
  }).join(', ') || '없음';
  var checklist = body.checklist || {};
  var clues = body.visualClues || [];
  var visualClues = clues.length > 0
    ? clues.map(function (c) {
        return '- ' + (c.종류 || '미상') + ' (' + (c.확신 || '추정') + ', 위치: ' + (c.위치 || '불명') + ') — ' + (c.근거 || '');
      }).join('\n')
    : '- (감지된 시각 단서 없음)';

  return `다음은 SNS에 게시하려는 사진과 관련된 비식별화된 분석 정보입니다:

[이미지 특징 - 로컬 얼굴인식 모델 결과]
- 얼굴 개수: ${face.count || 0}개
- 얼굴별 상세: ${faceDetail}

[이미지 내 텍스트 감지 결과]
- 감지된 텍스트 목록: ${detectedTexts}
- 각 텍스트의 이미지 내 위치: ${textPositions}

[이미지 내 시각적 신원 단서 - 글자가 아닌 것]
${visualClues}

[사용자 응답 - 체크리스트]
- 계정 공개 범위: ${checklist.privacySetting || '미입력'}
- 업로드 시점: ${checklist.uploadTiming || '미입력'}
- 함께 나온 사람: ${checklist.companions || '없음'}
- 배경 특이사항: ${checklist.backgroundNotes || '없음'}

[캡션 텍스트]
"${body.caption || ''}"

위 정보를 종합해서 다음을 작성해주세요:
1. 종합 위험도 점수 (0~100점)와 등급(상/중/하)
2. 위치노출 위험도 점수와 근거
3. 부모가 취할 수 있는 구체적 조치 제안

반드시 JSON 형식으로만 응답하세요 (다른 설명 없이):
{
  "종합위험도점수": 0,
  "종합위험도등급": "상/중/하",
  "위치노출위험도점수": 0,
  "위치노출근거": "설명",
  "권장조치": ["조치1", "조치2"],
  "종합설명": "부모가 읽을 자연어 설명"
}`;
}

app.post('/api/diagnose-risk', async (req, res) => {
  try {
    const userPrompt = buildRiskUserPrompt(req.body || {});
    const result = await callClaudeText(RISK_SYSTEM_PROMPT, userPrompt);
    res.json({
      종합위험도점수: result.parsed.종합위험도점수,
      종합위험도등급: result.parsed.종합위험도등급,
      위치노출위험도점수: result.parsed.위치노출위험도점수,
      위치노출근거: result.parsed.위치노출근거,
      권장조치: result.parsed.권장조치 || [],
      종합설명: result.parsed.종합설명,
      timingMs: result.timingMs,
      usage: result.usage,
      model: result.model,
    });
  } catch (err) {
    const { status, message } = mapAnthropicError(err);
    console.error('[server] 위험도 진단 실패:', message);
    res.status(status).json({ error: message });
  }
});

// ===== 6. 캡션 텍스트 수정 제안 프롬프트 =====
// 캡션만 주면 사진과 무관한 일반적인 제안밖에 못 나온다. 사진에서 실제로 감지한
// 것들을 함께 넘겨 이 사진에 맞는 제안을 받는다.
function buildCaptionUserPrompt(body) {
  const caption = body.caption || '';
  const texts = (body.texts || []).filter(Boolean);
  const clues = (body.visualClues || []).filter(Boolean);

  const photoCtx = [
    texts.length ? `- 사진 속 글자: ${texts.join(', ')}` : null,
    clues.length ? `- 글자가 아닌 단서: ${clues.join(', ')}` : null,
    body.grade ? `- 종합 위험도: ${body.grade}` : null,
    body.locationEvidence ? `- 위치노출 근거: ${body.locationEvidence}` : null,
  ].filter(Boolean).join('\n') || '- (사진에서 특별히 감지된 단서 없음)';

  return `다음은 SNS 게시물의 캡션입니다:
"${caption}"

같은 사진을 분석한 결과입니다:
${photoCtx}

이 캡션에서 위치(동네명, 기관명 등)나 날짜/시간 정보가 지나치게 구체적으로
노출되어 있다면, 같은 느낌을 유지하면서 더 안전한 표현으로 바꾼 대체 캡션을
2~3개 제안해주세요.

반드시 지킬 것:
- **사용자가 쓴 캡션을 고쳐 쓰세요.** 새로 지어내지 마세요.
- 위 분석 결과를 반영하세요. 예를 들어 사진에 교복이 보이는데 캡션에도 학교를
  암시하는 표현이 있으면 그 조합이 왜 위험한지 짚고 함께 고치세요.
- **캡션에 고칠 것이 없으면 "대체캡션"을 빈 배열로 두세요.** 억지로 채우지 마세요.
  "오늘도 즐거웠어요" 같은 아무 사진에나 붙는 문구는 도움이 되지 않습니다.
- 톤은 부모가 실제로 쓸 법한 자연스러운 말투를 유지하세요.
- 한자를 쓰지 말고 쉬운 한국어로만 쓰세요.

JSON으로만 응답하세요 (다른 설명 없이):
{
  "위험표현": [
    {"원문": "OO동 놀이터", "이유": "구체적 지역명 노출"}
  ],
  "대체캡션": [
    {"문구": "수정된 캡션 1", "설명": "무엇을 바꿨는지"}
  ]
}`;
}

app.post('/api/suggest-captions', async (req, res) => {
  const { caption } = req.body || {};
  if (!caption || !caption.trim()) {
    return res.json({ 위험표현: [], 대체캡션: [], timingMs: 0 });
  }
  try {
    const result = await callClaudeText('당신은 SNS 캡션의 프라이버시 위험 표현을 다듬어주는 편집자입니다.', buildCaptionUserPrompt(req.body || {}));
    res.json({
      위험표현: result.parsed.위험표현 || [],
      대체캡션: result.parsed.대체캡션 || [],
      timingMs: result.timingMs,
      usage: result.usage,
      model: result.model,
    });
  } catch (err) {
    const { status, message } = mapAnthropicError(err);
    console.error('[server] 캡션 제안 실패:', message);
    res.status(status).json({ error: message });
  }
});

// 이미지 1장 + 프롬프트로 Claude Vision을 호출하는 공용 헬퍼 (간판 OCR, 스크린샷 분석에서 재사용)
async function callClaudeVision(imageBase64, mediaType, prompt, maxTokens) {
  const t0 = Date.now();
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens || 1024,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 } },
          { type: 'text', text: prompt },
        ],
      },
    ],
  });
  const textBlock = response.content.find((b) => b.type === 'text');
  const rawText = textBlock ? textBlock.text : '';
  const parsed = extractJson(rawText); // 실패하면 던져짐 (호출부에서 처리)
  return { parsed, timingMs: Date.now() - t0, usage: response.usage, model: response.model };
}

app.post('/api/analyze-image', async (req, res) => {
  const { imageBase64, mediaType } = req.body || {};
  if (!imageBase64) {
    return res.status(400).json({ error: '이미지(imageBase64)가 없습니다.' });
  }
  try {
    const result = await callClaudeVision(imageBase64, mediaType, PROMPT, 1024);
    res.json({
      감지된텍스트: result.parsed.감지된텍스트 || [],
      시각단서: result.parsed.시각단서 || [],
      timingMs: result.timingMs,
      usage: result.usage,
      model: result.model,
    });
  } catch (err) {
    const { status, message } = mapAnthropicError(err);
    console.error('[server] Claude Vision 호출 실패:', message);
    res.status(status).json({ error: message });
  }
});

// ===== 스크린샷에서 캡션/게시시점/배경 위치단서 추출 (스케줄 패턴 분석용) =====
const SCREENSHOT_PROMPT = `이 이미지는 SNS 게시물 스크린샷입니다. 다음 정보를 최대한 정확히 추출해줘:
1. 캡션 (게시글 본문 텍스트) — 화면 캡처라 폰트가 선명하니 최대한 정확히 읽어줘
2. 게시 시점 — 화면에 보이는 상대적 시간 표현 그대로 (예: "3일 전", "1주 전", "방금 전")
3. 사진 배경에서 위치를 특정할 수 있는 텍스트 (간판, 표지판, 장소명 등) — 있는 경우만

JSON으로만 응답해줘 (다른 설명 없이):
{
  "캡션": "...",
  "게시시점": "...",
  "배경텍스트": ["...", "..."]
}
해당 정보가 화면에 없으면 캡션/게시시점은 빈 문자열, 배경텍스트는 빈 배열로 응답해줘.`;

app.post('/api/analyze-screenshot', async (req, res) => {
  const { imageBase64, mediaType } = req.body || {};
  if (!imageBase64) {
    return res.status(400).json({ error: '이미지(imageBase64)가 없습니다.' });
  }
  try {
    const result = await callClaudeVision(imageBase64, mediaType, SCREENSHOT_PROMPT, 512);
    res.json({
      캡션: result.parsed.캡션 || '',
      게시시점: result.parsed.게시시점 || '',
      배경텍스트: result.parsed.배경텍스트 || [],
      timingMs: result.timingMs,
      usage: result.usage,
      model: result.model,
    });
  } catch (err) {
    const { status, message } = mapAnthropicError(err);
    console.error('[server] 스크린샷 분석 실패:', message);
    res.status(status).json({ error: message });
  }
});

// ===== 2. 스케줄 패턴 분석 프롬프트 (아이사진_SNS위험진단_프롬프트.md 2번) =====
const SCHEDULE_SYSTEM_PROMPT = `당신은 SNS 게시물의 누적 패턴에서 개인정보 유출 위험을 찾아내는
분석가입니다. 게시물 하나하나는 무해해 보여도, 여러 개를 모아보면
아이의 생활 반경과 일정이 드러날 수 있다는 점에 주목하세요.

주의사항:
- 게시 시각이 "3일 전", "1주 전" 같은 상대 표기로 들어옵니다.
  기준 시각을 참고해 실제 날짜와 요일을 역산하세요.
- OCR로 추출된 텍스트라 일부 오인식이 있을 수 있습니다.
  유사한 표현은 같은 장소로 간주해도 좋습니다.
- 패턴이 없으면 억지로 만들지 말고 "패턴 없음"으로 답하세요.

출력 길이 제약: "부모에게전할설명"은 3문장 이내로 간결하게 작성하세요.`;

function buildScheduleUserPrompt(posts, currentDatetime) {
  const postsJson = posts.map((p, i) => ({
    번호: i + 1,
    상대시각: p.relativeTime || '(알 수 없음)',
    캡션: p.caption || '',
    감지된텍스트: p.detectedTexts || [],
  }));

  return `기준 시각(스크린샷 업로드 시점): ${currentDatetime}

다음은 사용자가 업로드한 과거 게시물 스크린샷에서 추출한 정보입니다:

${JSON.stringify({ 게시물목록: postsJson }, null, 2)}

다음을 분석해주세요:

1. 각 게시물의 실제 날짜와 요일을 역산
2. 반복 패턴 탐지:
   - 요일 패턴 (특정 요일에 반복되는 장소/활동)
   - 시간대 패턴 (특정 시간대에 반복 노출되는 위치)
   - 장소 반복 (동일 장소가 여러 게시물에 등장)
   - 캡션 내 명시적 일정 언급
3. 이 패턴으로 예측 가능해지는 정보

JSON으로 응답 (다른 설명 없이):
{
  "역산된게시물": [
    {"번호": 1, "상대시각": "3일 전", "실제날짜": "2026-08-16", "요일": "토"}
  ],
  "패턴발견여부": "있음/없음",
  "발견된패턴": [
    {"유형": "요일패턴", "내용": "설명", "근거게시물": [1, 3]}
  ],
  "예측가능정보": "설명 (패턴 없으면 빈 문자열)",
  "위험도점수": 0,
  "부모에게전할설명": "자연어 설명"
}`;
}

app.post('/api/analyze-schedule-pattern', async (req, res) => {
  const { posts } = req.body || {};
  if (!posts || posts.length === 0) {
    return res.json({ 패턴발견여부: '없음', 발견된패턴: [], 예측가능정보: '', 부모에게전할설명: '분석할 과거 게시물이 없어요.', timingMs: 0 });
  }
  try {
    const currentDatetime = new Date().toISOString();
    const userPrompt = buildScheduleUserPrompt(posts, currentDatetime);
    const result = await callClaudeText(SCHEDULE_SYSTEM_PROMPT, userPrompt);
    res.json({
      역산된게시물: result.parsed.역산된게시물 || [],
      패턴발견여부: result.parsed.패턴발견여부 || '없음',
      발견된패턴: result.parsed.발견된패턴 || [],
      예측가능정보: result.parsed.예측가능정보 || '',
      위험도점수: result.parsed.위험도점수,
      부모에게전할설명: result.parsed.부모에게전할설명,
      timingMs: result.timingMs,
      usage: result.usage,
      model: result.model,
    });
  } catch (err) {
    const { status, message } = mapAnthropicError(err);
    console.error('[server] 스케줄 패턴 분석 실패:', message);
    res.status(status).json({ error: message });
  }
});

// ===== 3. 처리 방식 추천 프롬프트 (아이사진_SNS위험진단_프롬프트.md 3번) =====
const RECOMMEND_SYSTEM_PROMPT = `당신은 아이 사진 속 위험요소를 어떤 방식으로 처리하면 좋을지
추천하는 전문가입니다. 블러를 기본으로 쓰지 않습니다 — 부모가 자랑하고 싶어 올리는
사진에 블러가 있으면 실사용 가능성이 떨어지기 때문에, 위험 유형별로 가장 자연스러운
방식을 추천하세요.

출력 길이 제약: "이유"는 1문장, "전체권장흐름"은 2문장 이내로 간결하게.`;

function buildRecommendUserPrompt(body) {
  const texts = body.texts || [];
  const riskInfo = texts.length > 0
    ? texts.map((t) => `- "${t.content}" (${t.type || '기타'}, 위치: ${t.position || '위치 불명'})`).join('\n')
    : '(감지된 위험 텍스트 없음)';

  return `다음은 사진의 위험요소 진단 결과입니다:
- 종합 위험도: ${body.grade || '미상'} (${body.score != null ? body.score : '?'}점)
- 위치노출 근거: ${body.locationEvidence || '없음'}

각 위험요소의 이미지 내 위치 정보:
${riskInfo}

사용 가능한 처리 방식과 특징:
1. 스마트 크롭 — 위험요소가 가장자리에 있을 때 최적. 결과가 가장 자연스러움
2. 배경 흐림(인물 사진 모드) — 배경 전반에 단서가 흩어져 있을 때. 아이는
   선명하게 유지되고 사진이 오히려 예뻐 보임
3. AI 배경 교체(flux) — 위험요소가 중앙에 있어 크롭이 불가능할 때.
   단 인물 변형 리스크 있음 (현재 서비스에서는 준비 중이라 추천에서 제외해줘)
4. 스티커 덮기 — 특정 텍스트만 가리면 될 때. 부모들에게 익숙한 방식

각 위험요소에 대해 가장 적합한 처리 방식을 추천하고, 이유를 설명해주세요.
1~3(AI 배경교체)은 아직 지원하지 않으니 추천에서 제외하고, 2~3가지 옵션을 제시하되
1순위를 명확히 해주세요.

JSON으로 응답 (다른 설명 없이):
{
  "추천처리": [
    {"위험요소": "우상단 간판 텍스트", "1순위": "스마트 크롭", "이유": "설명", "대안": ["스티커 덮기"]}
  ],
  "전체권장흐름": "설명"
}`;
}

app.post('/api/recommend-correction', async (req, res) => {
  try {
    const userPrompt = buildRecommendUserPrompt(req.body || {});
    const result = await callClaudeText(RECOMMEND_SYSTEM_PROMPT, userPrompt);
    res.json({
      추천처리: result.parsed.추천처리 || [],
      전체권장흐름: result.parsed.전체권장흐름 || '',
      timingMs: result.timingMs,
      usage: result.usage,
      model: result.model,
    });
  } catch (err) {
    const { status, message } = mapAnthropicError(err);
    console.error('[server] 처리 방식 추천 실패:', message);
    res.status(status).json({ error: message });
  }
});

// ===== 4. flux-kontext-pro용 편집 지시문 동적 생성 (아이사진_SNS위험진단_프롬프트.md 4번) =====
const FLUX_PROMPT_SYSTEM = `당신은 flux-kontext-pro 이미지 편집 API에 보낼 영어 프롬프트를 작성하는
어시스턴트입니다. 이 편집은 **배경만** 바꾸는 기능입니다.

절대 규칙 — 어기면 아이 사진이 훼손됩니다:
- **인물에 관한 지시를 절대 쓰지 마세요.** 옷·교복·명찰·머리·얼굴·체형·성별·나이를
  바꾸거나 지우거나 가리라는 말을 한 마디도 넣지 마세요.
  ("replace the uniform", "remove the badge" 같은 문장은 금지입니다.)
- 입력으로 받은 위험요소 중 교복·원복·명찰처럼 **인물이 입거나 달고 있는 것은 무시하세요.**
  그건 이 기능이 다루는 대상이 아닙니다.
- 배경에 있는 것(간판, 표지판, 건물 이름, 차량번호판, 주소 표기 등)만 다루세요.
- 인물은 그대로 두라고 강하게 명시하세요
  ("do not modify the person in any way", "preserve the person with pixel-level accuracy").
- 간결하고 명확한 영어 문장 1~3개로 작성
- 다른 설명 없이 영어 프롬프트 텍스트 자체만 응답 (JSON 아님, 따옴표도 없이)`;

function buildFluxPromptUserPrompt(body) {
  const texts = body.texts || [];
  const riskInfo = texts.length > 0
    ? texts.map((t) => `- "${t.content}" (${t.type || '기타'}, 위치: ${t.position || '위치 불명'})`).join('\n')
    : '(감지된 위험 텍스트 없음 — 배경 전반의 위치 단서 제거를 가정)';
  return `다음은 사진의 위험요소 진단 결과입니다:
- 종합 위험도: ${body.grade || '미상'}
- 위치노출 근거: ${body.locationEvidence || '없음'}

위험요소 목록:
${riskInfo}

이 위험요소를 해결하기 위해 flux-kontext-pro 이미지 편집 API에 보낼 영어 프롬프트를 작성해주세요.`;
}

async function generateFluxPrompt(body) {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 300,
    system: FLUX_PROMPT_SYSTEM,
    messages: [{ role: 'user', content: buildFluxPromptUserPrompt(body) }],
  });
  const textBlock = response.content.find((b) => b.type === 'text');
  return (textBlock ? textBlock.text : '').trim().replace(/^"|"$/g, '');
}

// ===== flux-kontext-pro 배경교체 =====
// 프라이버시 예외: 이 엔드포인트만 마스킹 없는 원본 이미지를 그대로 받는다 (기획서 0번
// 원칙에 명시된 대로, 사용자가 "AI 배경교체"를 명시적으로 선택했을 때만 호출됨).
app.post('/api/replace-background', async (req, res) => {
  if (!process.env.FAL_KEY) {
    return res.status(501).json({ error: '준비 중입니다. fal.ai API 키 연동 후 지원 예정이에요.', ready: false });
  }
  const { imageBase64, mediaType, texts, grade, locationEvidence } = req.body || {};
  if (!imageBase64) {
    return res.status(400).json({ error: '이미지(imageBase64)가 없습니다.' });
  }

  const t0 = Date.now();
  try {
    const editPrompt = await generateFluxPrompt({ texts, grade, locationEvidence });

    const mt = mediaType || 'image/jpeg';
    const buffer = Buffer.from(imageBase64, 'base64');
    const ext = mt.includes('png') ? 'png' : 'jpg';
    const file = new File([buffer], 'photo.' + ext, { type: mt });
    const uploadedUrl = await fal.storage.upload(file);

    const result = await fal.subscribe('fal-ai/flux-pro/kontext', {
      input: { prompt: editPrompt, image_url: uploadedUrl },
    });

    const output = result.data || result;
    const outputImage = output.images && output.images[0];
    if (!outputImage) throw new Error('flux-kontext-pro 응답에 이미지가 없습니다.');

    // 프론트의 기존 다운로드 로직(canvas 기반)과 통일하기 위해 결과 이미지를 서버에서
    // 대신 내려받아 base64로 변환해서 돌려줌 (외부 CDN URL을 브라우저에서 직접 fetch하면
    // CORS에 막힐 수 있어서 회피).
    const imgResp = await fetch(outputImage.url);
    const imgArrayBuffer = await imgResp.arrayBuffer();
    const outputBase64 = Buffer.from(imgArrayBuffer).toString('base64');

    res.json({
      imageBase64: outputBase64,
      sourceUrl: outputImage.url,
      width: outputImage.width,
      height: outputImage.height,
      editPrompt: editPrompt,
      timingMs: Date.now() - t0,
      estimatedCostUsd: 0.04,
    });
  } catch (err) {
    console.error('[server] flux-kontext-pro 호출 실패:', err.message);
    res.status(500).json({ error: 'AI 배경교체 실패: ' + err.message });
  }
});

// ===== flux-pro/v1/fill 마스크 인페인팅 =====
// 배경교체(kontext)가 이미지 "전체"를 지시문대로 다시 그리는 것과 달리, Fill은 마스크로
// 지정한 영역만 다시 그린다. 위험 텍스트가 있는 자리만 배경으로 메우는 용도.
//
// 마스크 규약: 흰색 = 새로 그릴 영역, 검은색 = 보존.
//   문서에 명시돼 있지 않아서 2026-08-21에 실제로 1회 호출해서 확인했다
//   (768x512 테스트 이미지, 마스크 안쪽 변화량 267 vs 바깥 23).
// 같은 검증에서 출력 크기 = 입력 크기(768x512 -> 768x512)임도 확인했다. 즉 이 방식은
// "처리 후에도 원본 비율 유지"를 구조적으로 보장한다.
//
// 프라이버시: replace-background와 마찬가지로 마스킹 없는 원본을 받는다. 다만 인물 보호를
// 프롬프트가 아니라 마스크로 한다 — 클라이언트가 인물 보존영역을 마스크에서 빼고 보내므로
// 모델이 애초에 얼굴 픽셀을 건드릴 수 없다. 프롬프트 지시보다 훨씬 강한 보장이다.
const INPAINT_PROMPT_SYSTEM = `당신은 FLUX Fill 인페인팅 API에 보낼 영어 프롬프트를 작성합니다.
이것은 "지우는" 지시가 아니라 마스크로 비운 자리를 "무엇으로 채울지" 묘사하는 프롬프트입니다.

반드시 지킬 것:
- 주변 배경과 자연스럽게 이어지는 내용을 묘사 (벽, 하늘, 나뭇잎, 길바닥 등)
- 글자가 다시 생기지 않도록 명시 ("no text, no letters, no numbers, no signage, no logos")
- 사람이 새로 생기지 않도록 명시 ("no people")
- 간결한 영어 문장 1~2개
- 다른 설명 없이 영어 프롬프트 텍스트 자체만 응답 (JSON 아님, 따옴표도 없이)`;

function buildInpaintPromptUserPrompt(body) {
  const texts = body.texts || [];
  const removed = texts.length > 0
    ? texts.map((t) => `- "${t.content}" (${t.type || '기타'}, 위치: ${t.position || '위치 불명'})`).join('\n')
    : '(개별 텍스트 정보 없음 — 주변 배경과 이어지는 무난한 배경으로 채울 것)';
  return `사진에서 아래 위험요소가 있던 자리를 마스크로 비웠습니다. 그 자리를 주변과
자연스럽게 이어지도록 채울 영어 프롬프트를 작성해주세요.

- 종합 위험도: ${body.grade || '미상'}
- 위치노출 근거: ${body.locationEvidence || '없음'}

비워둔 자리에 있던 것:
${removed}`;
}

async function generateInpaintPrompt(body) {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 300,
    system: INPAINT_PROMPT_SYSTEM,
    messages: [{ role: 'user', content: buildInpaintPromptUserPrompt(body) }],
  });
  const textBlock = response.content.find((b) => b.type === 'text');
  return (textBlock ? textBlock.text : '').trim().replace(/^"|"$/g, '');
}

app.post('/api/inpaint-regions', async (req, res) => {
  if (!process.env.FAL_KEY) {
    return res.status(501).json({ error: '준비 중입니다. fal.ai API 키 연동 후 지원 예정이에요.', ready: false });
  }
  const { imageBase64, maskBase64, mediaType, texts, grade, locationEvidence, promptOverride } = req.body || {};
  if (!imageBase64) {
    return res.status(400).json({ error: '이미지(imageBase64)가 없습니다.' });
  }
  if (!maskBase64) {
    return res.status(400).json({ error: '마스크(maskBase64)가 없습니다. 지울 영역을 흰색으로 칠한 마스크가 필요해요.' });
  }

  const t0 = Date.now();
  try {
    // promptOverride: 마스크가 '글자만'이냐 '간판 판때기 전체'냐에 따라 채울 내용이 완전히
    // 달라지는데, 서버는 마스크 모양을 모른다. 그래서 호출부가 필요하면 직접 지정할 수 있게 열어둠.
    // (지정하지 않으면 위험요소 목록을 보고 Claude가 생성)
    const editPrompt = promptOverride || await generateInpaintPrompt({ texts, grade, locationEvidence });

    const mt = mediaType || 'image/jpeg';
    const ext = mt.includes('png') ? 'png' : 'jpg';
    // 마스크는 흑백 경계가 뭉개지면 안 되므로 항상 PNG로 올린다 (JPEG 압축 금지)
    const [imageUrl, maskUrl] = await Promise.all([
      fal.storage.upload(new File([Buffer.from(imageBase64, 'base64')], 'photo.' + ext, { type: mt })),
      fal.storage.upload(new File([Buffer.from(maskBase64, 'base64')], 'mask.png', { type: 'image/png' })),
    ]);

    const result = await fal.subscribe('fal-ai/flux-pro/v1/fill', {
      input: { prompt: editPrompt, image_url: imageUrl, mask_url: maskUrl },
    });

    const output = result.data || result;
    const outputImage = output.images && output.images[0];
    if (!outputImage) throw new Error('flux-fill 응답에 이미지가 없습니다.');

    // replace-background와 같은 이유로 서버가 대신 내려받아 base64로 돌려줌 (CORS 회피)
    const imgResp = await fetch(outputImage.url);
    const outputBase64 = Buffer.from(await imgResp.arrayBuffer()).toString('base64');

    res.json({
      imageBase64: outputBase64,
      sourceUrl: outputImage.url,
      width: outputImage.width,
      height: outputImage.height,
      editPrompt: editPrompt,
      timingMs: Date.now() - t0,
      estimatedCostUsd: estimateFillCostUsd(outputImage.width, outputImage.height),
    });
  } catch (err) {
    console.error('[server] flux-fill 호출 실패:', err.message);
    res.status(500).json({ error: 'AI 인페인팅 실패: ' + err.message });
  }
});

// 프론트에서 실제 비용이 드는 호출을 하기 전에 "준비됐는지"만 가볍게 확인하는 용도
app.get('/api/flux-status', (req, res) => {
  res.json({ ready: !!process.env.FAL_KEY });
});

// ===== 5. 결과 재검증 프롬프트 (아이사진_SNS위험진단_프롬프트.md 5번, 3단계) =====
const VERIFY_SYSTEM_PROMPT = `당신은 이미지 프라이버시 처리 결과를 검증하는 검토자입니다.
원래 어떤 위험요소가 있었고 어떤 처리를 했는지 확인한 뒤,
처리 결과가 실제로 문제를 해결했는지 냉정하게 재검토하세요.

**아이 얼굴이 사진에 보이는 것 자체는 위험요소가 아닙니다.**
부모가 아이 사진을 올리려는 것이고, 얼굴을 가린 사진을 올릴 사람은 없습니다.
"얼굴이 노출되어 있다", "아이 신원이 드러난다" 같은 이유로 "재검토필요"를 주지 마세요.
이 서비스가 다루는 위험은 **아이가 어디 있는지·어디 다니는지 알려주는 단서**
(간판·전화번호·주소·교복·명찰·기관 로고 등)이지, 얼굴 자체가 아닙니다.

"재검토필요"는 아래 셋 중 하나일 때만 주세요:
1. 원래 있던 위치·소속 단서가 그대로 남아 있거나 일부만 지워졌을 때
2. 처리 과정에서 새로운 단서가 생겼을 때 (예: AI가 가짜 간판 글씨를 만들어냄)
3. 아이가 변형됐을 때 (아래 인물 보존 기준 참고)

특히 중요 — 인물 보존 확인:
AI 처리를 사용한 경우, 아이의 얼굴·포즈·옷차림이 원본과 동일하게 유지되었는지
반드시 확인하세요. 프라이버시를 위해 아이의 모습이 바뀌어버리면 부모가 그 사진을
쓸 수 없습니다. (단, "AI 옷 바꾸기"는 옷을 바꾸는 것이 목적이므로 옷차림 변화는
정상입니다 — 이 경우 얼굴·포즈만 보세요.)

인물 보존 판단 시 아래 수치 기준을 참고하세요 (클라이언트에서 미리 계산해서 알려줌):
- 얼굴 개수가 달라짐 → 명확한 변형 (사람이 사라지거나 새로 생기면 절대 안 됨)
- 얼굴 크기 비율 차이 20%p 이상 → 변형 의심
- 얼굴 각도(roll/yaw) 차이 15도 이상 → 변형 의심

출력 길이 제약: "설명"은 2~3문장 이내로 간결하게.
- 한자나 일본어 한자(紺色, 學校 등)를 쓰지 말고 쉬운 한국어로만 쓰세요 (감색, 학교).
- 부모가 읽는 글이므로 전문용어보다 일상어를 쓰세요.`;

function buildVerifyUserPrompt(body) {
  const original = body.원본진단 || {};
  const before = body.처리전얼굴 || {};
  const after = body.처리후얼굴 || {};
  const sizeDiff = (before.areaRatioPct != null && after.areaRatioPct != null)
    ? Math.abs(before.areaRatioPct - after.areaRatioPct).toFixed(1) : '알수없음';
  const angleDiff = (before.maxAngleDeg != null && after.maxAngleDeg != null)
    ? Math.abs(before.maxAngleDeg - after.maxAngleDeg).toFixed(1) : '알수없음';

  return `[원본 위험 진단 결과]
- 종합 위험도: ${original.grade || '미상'} (${original.score != null ? original.score : '?'}점)
- 위치노출 근거: ${original.locationEvidence || '없음'}
- 원본에서 감지된 텍스트: ${(body.원본텍스트 || []).map((t) => `"${t}"`).join(', ') || '없음'}

[적용한 처리 내용]
방식: ${body.처리방식 || '미상'}
설명: ${body.처리설명 || '(설명 없음)'}

[처리 전 이미지의 얼굴 분석 결과]
- 얼굴 개수: ${before.count != null ? before.count : '?'}개
- 프레임 대비 얼굴 크기: ${before.areaRatioPct != null ? before.areaRatioPct + '%' : '?'}
- 얼굴 각도(roll/yaw 중 큰 값): ${before.maxAngleDeg != null ? before.maxAngleDeg + '도' : '?'}

[처리 후 이미지의 재분석 결과 - 로컬 모델로 다시 추출]
- 감지된 텍스트: ${(body.재추출텍스트 || []).map((t) => `"${t}"`).join(', ') || '없음'}
- 얼굴 개수: ${after.count != null ? after.count : '?'}개
- 프레임 대비 얼굴 크기: ${after.areaRatioPct != null ? after.areaRatioPct + '%' : '?'}
- 얼굴 각도(roll/yaw 중 큰 값): ${after.maxAngleDeg != null ? after.maxAngleDeg + '도' : '?'}

[클라이언트가 미리 계산한 참고 수치]
- 얼굴 개수 일치 여부: ${before.count === after.count ? '일치' : '불일치(명확한 변형)'}
- 크기 비율 차이: ${sizeDiff}%p (20%p 이상이면 의심)
- 각도 차이: ${angleDiff}도 (기준: 15도 이상이면 의심)

위 정보를 바탕으로 다음을 판단해주세요:
1. 원래 있던 위치·소속 단서가 실제로 해결되었는가? (얼굴이 보이는지는 판단 대상이 아님)
2. 처리 과정에서 새로운 단서가 생기지 않았는가?
3. 인물(아이)이 원본과 동일하게 보존되었는가?
4. 추가 조치가 필요하다면 무엇인가?

JSON으로 응답 (다른 설명 없이):
{
  "검증결과": "통과/재검토필요",
  "위험요소해결": "해결됨/부분해결/미해결",
  "신규위험": "없음/있음(설명)",
  "인물보존": "정상/변형의심(설명)",
  "설명": "구체적 근거",
  "추가조치필요시": "설명"
}`;
}

app.post('/api/verify-correction', async (req, res) => {
  try {
    const body = req.body || {};
    const userPrompt = buildVerifyUserPrompt(body);
    const result = await callClaudeText(VERIFY_SYSTEM_PROMPT, userPrompt);
    const parsed = result.parsed || {};

    // 얼굴 개수 불일치는 가장 명확한 신호라 Claude 판단과 무관하게 강제로 덮어씀
    // (9번 섹션에서 점수→등급을 클라이언트가 확정한 것과 같은 방식의 안전장치)
    const before = body.처리전얼굴 || {};
    const after = body.처리후얼굴 || {};
    let 인물보존 = parsed.인물보존 || '알수없음';
    if (before.count != null && after.count != null && before.count !== after.count) {
      인물보존 = `변형의심(얼굴 개수가 ${before.count}개에서 ${after.count}개로 바뀜 — 자동 판정)`;
    }

    res.json({
      검증결과: parsed.검증결과 || '알수없음',
      위험요소해결: parsed.위험요소해결 || '알수없음',
      신규위험: parsed.신규위험 || '알수없음',
      인물보존: 인물보존,
      설명: parsed.설명 || '',
      추가조치필요시: parsed.추가조치필요시 || '',
      timingMs: result.timingMs,
      usage: result.usage,
      model: result.model,
    });
  } catch (err) {
    const { status, message } = mapAnthropicError(err);
    console.error('[server] 결과 재검증 실패:', message);
    res.status(status).json({ error: message });
  }
});

app.listen(PORT, () => {
  console.log(`[server] 안심앨범 백엔드 실행 중 — http://localhost:${PORT}`);
  console.log(`[server] 모델: ${MODEL}`);
});
