// 아이섀도우 — Claude Vision 중계 백엔드
//
// 역할: 브라우저는 이 서버에만 이미지를 보내고, 이 서버가 Anthropic API 키를 붙여
// Claude Vision을 호출한다. API 키는 여기(.env)에만 있고 브라우저로는 절대 나가지 않는다.
//
// 실행: npm install && npm start  (server/.env에 ANTHROPIC_API_KEY 필요)

import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import { fal } from '@fal-ai/client';
import { estimateFillCostUsd } from './fill-cost.js';
import { resolvePostDate } from './schedule-date.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// dotenv는 기본적으로 "실행한 위치"에서 .env를 찾는다. 저장소 루트에서
// `npm start`(= node server/server.js)로 띄우면 server/.env를 못 보고,
// 키가 없는 채로 조용히 뜬다 — 화면은 멀쩡한데 전부 폴백으로 도는 상태가 된다.
// 어디서 띄우든 이 파일 옆의 .env를 읽게 한다.
// 배포판(버셀)에는 .env 파일이 없고 환경변수가 직접 주입되므로, 없어도 그냥 넘어간다.
dotenv.config({ path: path.join(HERE, '.env') });

const PORT = process.env.PORT || 3001;
// 사용자가 지정한 모델. 날짜 접미사(-20251001) 없는 정식 모델 ID를 사용함
// (Anthropic 모델 ID는 날짜 접미사를 붙이지 않는 것이 현재 규칙).
const MODEL = 'claude-haiku-4-5';

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('[server] ⚠ ANTHROPIC_API_KEY가 설정되지 않았습니다. server/.env를 만들어주세요 (.env.example 참고).');
}
// fal.ai는 업로드한 파일과 생성 결과를 공개 CDN URL로 서빙하고, 요청 페이로드를
// 기본 30일간 대시보드 히스토리에 보관한다. 아이 얼굴 사진을 다루는 서비스라
// 둘 다 기본값으로 두면 안 된다.
//
// ACL(initialAcl)로 아예 비공개로 만드는 방법은 실제로 시도해봤고 둘 다 막혔다:
//   - 입력에 걸면 → FLUX 러너가 URL을 못 읽어서 file_download_error로 실패
//   - 출력에 걸면 → 우리 서버도 못 받는다 (FAL_KEY를 Authorization에 넣어도 403/404)
// CDN이 전부-아니면-전무라서, 쓸 수 있는 레버는 "만료 시간"뿐이다.
//   - 입력(원본 사진·마스크): 러너가 큐에서 대기했다 가져가므로 여유를 두되 10분
//     (실제 처리는 보통 10~30초. 1시간은 불필요하게 길다)
//   - 출력(보정 결과): 서버가 즉시 내려받아 base64로 돌려주므로 최소값
// fal의 만료 최소 단위가 60초라 'immediate'도 실제로는 60초다.
const FAL_INPUT_LIFECYCLE = { expiresIn: 600 };
const FAL_OUTPUT_STORAGE = { expiresIn: 'immediate' };

if (!process.env.FAL_KEY) {
  console.warn('[server] ⚠ FAL_KEY가 설정되지 않았습니다 — AI 배경교체(/api/replace-background)는 준비 중 상태로 동작합니다.');
} else {
  fal.config({
    credentials: process.env.FAL_KEY,
    // SDK에 store-io 옵션이 없어서(v1.10.1) 미들웨어로 헤더를 직접 붙인다.
    // 이게 있어야 요청 입출력 JSON이 fal 쪽에 30일간 남지 않는다.
    requestMiddleware: async (request) => ({
      ...request,
      headers: { ...(request.headers || {}), 'x-fal-store-io': '0' },
    }),
  });
}

const anthropic = new Anthropic(); // ANTHROPIC_API_KEY 환경변수에서 자동으로 읽음

const app = express();
// 배포판은 프런트와 API가 같은 도메인이라 CORS가 애초에 걸리지 않는다.
// 로컬 개발에서 프런트를 다른 포트로 띄우는 경우만 허용해준다.
app.use(cors({ origin: /^http:\/\/localhost(:\d+)?$/ }));
app.use(express.json({ limit: '15mb' })); // 마스킹된 이미지(base64)가 들어있어 넉넉하게

// ── 팀원만 쓰게 하는 공유 접근 코드 ──────────────────────────────────────────
// 배포하면 주소를 아는 사람은 누구나 이 API를 부를 수 있고, 그 비용은 우리가 낸다.
// 코드를 모르면 아무 것도 돌아가지 않게 막는다.
//
// 팀원 여럿이 하나를 나눠 쓰는 열쇠라 강한 인증이 아니다 — 코드를 아는 사람은
// 누구나 들어올 수 있고, 브라우저에도 남는다. 해커톤 데모용으로 충분한 수준이다.
// ANSHIM_ACCESS_CODE가 없으면 열어둔다(로컬 개발에서 매번 입력하지 않도록).
const ACCESS_CODE = (process.env.ANSHIM_ACCESS_CODE || '').trim();
function accessOk(req) {
  if (!ACCESS_CODE) return true;
  const raw = String(req.get('x-anshim-code') || '');
  // 헤더에는 ASCII만 담기므로 프런트가 퍼센트 인코딩해서 보낸다. 되돌린다.
  // 망가진 값이 오면 decodeURIComponent가 예외를 던지므로 그대로 비교한다.
  let given;
  try { given = decodeURIComponent(raw); } catch (e) { given = raw; }
  return given.trim() === ACCESS_CODE;
}

// 프런트가 "코드가 필요한 곳인가, 내 코드가 맞는가"를 물어보는 곳. 여기는 막지 않는다.
app.get('/api/access-check', (req, res) => {
  res.json({ required: Boolean(ACCESS_CODE), ok: accessOk(req) });
});

app.use('/api', (req, res, next) => {
  if (req.path === '/access-check') return next();
  if (accessOk(req)) return next();
  res.status(401).json({ error: '접근 코드가 필요해요. 팀에서 받은 코드를 입력해주세요.' });
});

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
1. 아래 네 항목에 각각 점수를 매기고, 왜 그 점수인지 한 문장으로 적기
2. 위치노출 위험도 점수와 근거
3. 부모가 취할 수 있는 구체적 조치 제안

점수 항목과 상한(이 상한을 넘기지 마세요):
- 간판·주소 노출 (0~30): 사진에 찍힌 간판·주소·지번·전화번호처럼 글자로 드러나는 것
- 소속 노출 (0~25): 교복·원복·명찰·기관 로고처럼 어디 다니는지 알 수 있는 것
- 인물 식별성 (0~20): 얼굴이 또렷한 정도, 함께 찍힌 사람
- 게시 습관 (0~15): 계정 공개 범위, 실시간 업로드 여부

근거가 없으면 0점을 주세요. 억지로 점수를 채우지 마세요.
종합 점수는 이 네 항목의 합으로 계산되므로 따로 적지 않아도 됩니다.

반드시 JSON 형식으로만 응답하세요 (다른 설명 없이):
{
  "위험요인": [
    {"항목": "간판·주소 노출", "점수": 0, "근거": "한 문장"},
    {"항목": "소속 노출", "점수": 0, "근거": "한 문장"},
    {"항목": "인물 식별성", "점수": 0, "근거": "한 문장"},
    {"항목": "게시 습관", "점수": 0, "근거": "한 문장"}
  ],
  "위치노출위험도점수": 0,
  "위치노출근거": "설명",
  "권장조치": ["조치1", "조치2"],
  "종합설명": "부모가 읽을 자연어 설명"
}`;
}

// 종합 점수를 모델이 통째로 내놓게 두면 "왜 72점인가"에 답할 수가 없다.
// 항목별로 받아서 서버가 더한다 — 화면에 보이는 숫자와 계산이 반드시 맞아떨어진다.
// 상한을 넘기거나 빠뜨린 항목은 여기서 바로잡는다. 모델의 산수를 믿지 않는다.
const RISK_FACTORS = [
  { 항목: '간판·주소 노출', 상한: 30 },
  { 항목: '소속 노출', 상한: 25 },
  { 항목: '인물 식별성', 상한: 20 },
  { 항목: '게시 습관', 상한: 15 },
];

function normalizeRiskFactors(raw) {
  const given = Array.isArray(raw) ? raw : [];
  return RISK_FACTORS.map((def) => {
    const hit = given.find((g) => String(g && g.항목 || '').replace(/\s/g, '') === def.항목.replace(/\s/g, ''));
    let score = Number(hit && hit.점수);
    if (!isFinite(score) || score < 0) score = 0;
    score = Math.min(def.상한, Math.round(score));
    return { 항목: def.항목, 점수: score, 상한: def.상한, 근거: (hit && hit.근거) || '해당하는 근거를 찾지 못했어요.' };
  });
}

function gradeOf(score) {
  return score >= 70 ? '상' : score >= 40 ? '중' : '하';
}

app.post('/api/diagnose-risk', async (req, res) => {
  try {
    const userPrompt = buildRiskUserPrompt(req.body || {});
    const result = await callClaudeText(RISK_SYSTEM_PROMPT, userPrompt);
    const factors = normalizeRiskFactors(result.parsed.위험요인);
    const total = factors.reduce((n, f) => n + f.점수, 0);
    res.json({
      위험요인: factors,
      종합위험도점수: total,
      종합위험도등급: gradeOf(total),
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
// 위치 태그를 따로 물어본다.
// 예전에는 "사진 배경에서 위치를 특정할 수 있는 텍스트"만 요구했는데, SNS가 사용자
// 이름 아래에 붙이는 위치 태그는 사진 안이 아니라 화면 UI라서 그 정의에 걸리지 않았다.
// 검증에서 "리틀스타 발레학원"·"햇살어린이집"·"푸른숲 태권도장" 세 개를 전부 놓쳤고,
// 그 결과 장소 반복 세트가 "패턴 없음"으로 판정됐다. 정작 가장 값싼 위치 단서인데도.
const SCREENSHOT_PROMPT = `이 이미지는 SNS 게시물 스크린샷입니다. 다음 정보를 최대한 정확히 추출해줘:
1. 캡션 (게시글 본문 텍스트) — 화면 캡처라 폰트가 선명하니 최대한 정확히 읽어줘
2. 게시 시점 — 화면에 보이는 상대적 시간 표현 그대로 (예: "3일 전", "1주 전", "방금 전")
3. 위치 태그 — 사용자 이름(@아이디) 바로 아래나 옆줄에 적힌 장소 이름.
   대개 핀 모양(📍) 뒤에 옵니다. 예: "📍 행복어린이집" 이면 "행복어린이집".
   사진 속 간판이 아니라 앱이 표시하는 글자입니다.
4. 사진 배경에서 위치를 특정할 수 있는 텍스트 (간판, 표지판, 장소명 등) — 있는 경우만

중요: 장소·기관 이름(어린이집, 유치원, 학원, 도장, 놀이터, 상호명 등)은
화면 어느 자리에 있든 하나도 빠뜨리지 마세요. 위치 태그인지 사진 속 간판인지
판단이 애매하면 3번과 4번 양쪽에 다 넣어도 됩니다 — 빠뜨리는 것보다 낫습니다.

JSON으로만 응답해줘 (다른 설명 없이):
{
  "캡션": "...",
  "게시시점": "...",
  "위치태그": "...",
  "배경텍스트": ["...", "..."]
}
해당 정보가 화면에 없으면 캡션/게시시점/위치태그는 빈 문자열, 배경텍스트는 빈 배열로 응답해줘.
없는 것을 지어내지 마세요 — 특히 위치 태그와 배경텍스트는 화면에 실제로 보일 때만 채우세요.`;

app.post('/api/analyze-screenshot', async (req, res) => {
  const { imageBase64, mediaType } = req.body || {};
  if (!imageBase64) {
    return res.status(400).json({ error: '이미지(imageBase64)가 없습니다.' });
  }
  try {
    const result = await callClaudeVision(imageBase64, mediaType, SCREENSHOT_PROMPT, 640);
    res.json({
      캡션: result.parsed.캡션 || '',
      게시시점: result.parsed.게시시점 || '',
      위치태그: result.parsed.위치태그 || '',
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
  기준 시각에 오늘 날짜와 요일이 함께 적혀 있으니, 그것을 출발점으로 역산하세요.
  기준 시각은 현지 시간이며 시간대가 표기되어 있습니다 — UTC로 바꿔 계산하지 마세요.
- OCR로 추출된 텍스트라 일부 오인식이 있을 수 있습니다.
  유사한 표현은 같은 장소로 간주해도 좋습니다.
- 패턴이 없으면 억지로 만들지 말고 "패턴 없음"으로 답하세요.
- 근거 게시물이 3개 미만인 패턴은 "반복"이라고 단정하지 마세요. 두 번 같은 일이
  있었다고 매주 그렇다는 뜻은 아닙니다. 그런 경우에는 패턴으로 세지 말고,
  설명에서 "게시물이 더 쌓이면 드러날 수 있다" 정도로만 짚으세요.
- 화면에서 읽어낸 정보에 없는 장소명이나 시간을 지어내지 마세요.
  감지된텍스트가 비어 있으면 장소가 없는 것입니다.

출력 길이 제약: "부모에게전할설명"은 3문장 이내로 간결하게 작성하세요.`;

// 기준 시각을 UTC(toISOString)로 넘기면 한국(UTC+9)에서는 자정~오전 9시 사이에
// 날짜가 하루 어긋난다. 그 상태로 "3일 전"을 역산하면 요일까지 틀린다 —
// 실제로 목요일 반복을 화요일 반복이라고 답한 적이 있다(2026-08-23 00:25 KST 실측).
// 현지 날짜와 요일을 직접 계산해 넘겨서 모델이 역산할 여지를 줄인다.
function localDatetimeLabel(d) {
  const pad = (n) => String(n).padStart(2, '0');
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  const tzMin = -d.getTimezoneOffset();
  const sign = tzMin >= 0 ? '+' : '-';
  const tz = 'UTC' + sign + pad(Math.floor(Math.abs(tzMin) / 60)) + ':' + pad(Math.abs(tzMin) % 60);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} (${weekday}요일) `
    + `${pad(d.getHours())}:${pad(d.getMinutes())} ${tz}`;
}

function buildScheduleUserPrompt(posts, currentDatetime, now) {
  const postsJson = posts.map((p, i) => {
    const when = resolvePostDate(p.relativeTime, now || new Date());
    return {
      번호: i + 1,
      상대시각: p.relativeTime || '(알 수 없음)',
      실제날짜: when ? when.날짜 : '(계산 불가)',
      요일: when ? (when.어림값 ? when.요일 + '(어림)' : when.요일) : '(계산 불가)',
      위치태그: p.placeTag || '',
      캡션: p.caption || '',
      감지된텍스트: p.detectedTexts || [],
    };
  });

  return `기준 시각(스크린샷 업로드 시점): ${currentDatetime}

다음은 사용자가 업로드한 과거 게시물 스크린샷에서 추출한 정보입니다:

${JSON.stringify({ 게시물목록: postsJson }, null, 2)}

다음을 분석해주세요:

1. 날짜와 요일은 이미 계산해서 드렸습니다. 다시 계산하지 말고 그대로 쓰세요.
   "(어림)"이 붙은 요일은 개월 단위를 30일로 어림한 값이라 요일 패턴 근거로 쓰지 마세요.
2. 반복 패턴 탐지:
   - 요일 패턴 (특정 요일에 반복되는 장소/활동)
   - 시간대 패턴 (특정 시간대에 반복 노출되는 위치)
   - 장소 반복 (동일 장소가 여러 게시물에 등장)
   - 캡션 내 명시적 일정 언급
3. 이 패턴으로 예측 가능해지는 정보

JSON으로 응답 (다른 설명 없이):
{
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
    const currentDatetime = localDatetimeLabel(new Date());
    const userPrompt = buildScheduleUserPrompt(posts, currentDatetime, new Date());
    const result = await callClaudeText(SCHEDULE_SYSTEM_PROMPT, userPrompt);
    res.json({
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
    const uploadedUrl = await fal.storage.upload(file, { lifecycle: FAL_INPUT_LIFECYCLE });

    const result = await fal.subscribe('fal-ai/flux-pro/kontext', {
      input: { prompt: editPrompt, image_url: uploadedUrl },
      storageSettings: FAL_OUTPUT_STORAGE,
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
      fal.storage.upload(new File([Buffer.from(imageBase64, 'base64')], 'photo.' + ext, { type: mt }), { lifecycle: FAL_INPUT_LIFECYCLE }),
      fal.storage.upload(new File([Buffer.from(maskBase64, 'base64')], 'mask.png', { type: 'image/png' }), { lifecycle: FAL_INPUT_LIFECYCLE }),
    ]);

    const result = await fal.subscribe('fal-ai/flux-pro/v1/fill', {
      input: { prompt: editPrompt, image_url: imageUrl, mask_url: maskUrl },
      storageSettings: FAL_OUTPUT_STORAGE,
    });

    const output = result.data || result;
    const outputImage = output.images && output.images[0];
    if (!outputImage) throw new Error('flux-fill 응답에 이미지가 없습니다.');

    // replace-background와 같은 이유로 서버가 대신 내려받아 base64로 돌려줌 (CORS 회피)
    const imgResp = await fetch(outputImage.url);
    const outputBase64 = Buffer.from(await imgResp.arrayBuffer()).toString('base64');

    res.json({
      imageBase64: outputBase64,
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

검출로 확인할 수 없는 처리도 있습니다:
사용자가 브러시로 직접 칠하거나 상자를 씌워 가린 부분은 **글자가 아니어서 텍스트 검출에
잡히지 않습니다**(예: 교복 엠블럼, 로고, 명찰). 처리 설명에 "직접 칠한 영역을 덮었다"고
적혀 있으면 그 부분은 처리된 것으로 보세요. 눈으로 확인할 수 없다는 이유로
"미해결"이라고 판단하지 마세요 — 당신은 이미지를 직접 보지 못합니다.

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

// 로컬에서 `npm start` 하나로 프런트까지 볼 수 있게 index.html을 직접 내보낸다.
// 프런트가 API를 상대 경로(/api/...)로 부르므로 같은 주소에서 떠 있어야 한다.
// 저장소 전체를 static으로 열면 server/.env까지 나가므로 파일 하나만 지정한다.
// 배포판에서는 버셀이 정적 파일을 먼저 처리하니 여기까지 오지 않는다.
const ROOT = path.join(HERE, '..');
function sendIndex(req, res) { res.sendFile(path.join(ROOT, 'index.html')); }
app.get('/', sendIndex);
app.get('/index.html', sendIndex);

// 서버리스(버셀)에서는 이 파일이 함수로 불려 들어오므로 포트를 열지 않는다.
// 로컬에서 `npm start`로 직접 띄울 때만 listen 한다.
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`[server] 아이섀도우 백엔드 실행 중 — http://localhost:${PORT}`);
    console.log(`[server] 모델: ${MODEL}`);
  });
}

export default app;
