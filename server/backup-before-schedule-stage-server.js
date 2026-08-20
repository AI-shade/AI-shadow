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

const PORT = process.env.PORT || 3001;
// 사용자가 지정한 모델. 날짜 접미사(-20251001) 없는 정식 모델 ID를 사용함
// (Anthropic 모델 ID는 날짜 접미사를 붙이지 않는 것이 현재 규칙).
const MODEL = 'claude-haiku-4-5';

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('[server] ⚠ ANTHROPIC_API_KEY가 설정되지 않았습니다. server/.env를 만들어주세요 (.env.example 참고).');
}

const anthropic = new Anthropic(); // ANTHROPIC_API_KEY 환경변수에서 자동으로 읽음

const app = express();
app.use(cors({ origin: /^http:\/\/localhost(:\d+)?$/ })); // 로컬 프론트만 허용
app.use(express.json({ limit: '15mb' })); // 마스킹된 이미지(base64)가 들어있어 넉넉하게

const PROMPT = `이 이미지에서 보이는 모든 텍스트를 읽어줘.
간판, 표지판, 차량번호판, 전화번호, 주소 등 위치를 특정할 수 있는 정보에 특히 주의해줘.
각 텍스트의 대략적인 위치(상단/중앙/좌하단 등)도 함께 알려줘.

JSON으로만 응답해줘 (다른 설명 없이):
{
  "감지된텍스트": [
    {"내용": "...", "위치": "상단 중앙", "유형": "상호명"}
  ]
}
텍스트가 하나도 없으면 "감지된텍스트": [] 로 응답해줘.`;

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
- 부모를 불안하게 만들기보다, 실질적으로 도움이 되는 톤을 유지하세요

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

  return `다음은 SNS에 게시하려는 사진과 관련된 비식별화된 분석 정보입니다:

[이미지 특징 - 로컬 얼굴인식 모델 결과]
- 얼굴 개수: ${face.count || 0}개
- 얼굴별 상세: ${faceDetail}

[이미지 내 텍스트 감지 결과]
- 감지된 텍스트 목록: ${detectedTexts}
- 각 텍스트의 이미지 내 위치: ${textPositions}

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
function buildCaptionUserPrompt(caption) {
  return `다음은 SNS 게시물의 캡션입니다:
"${caption}"

이 캡션에서 위치(동네명, 기관명 등)나 날짜/시간 정보가 지나치게
구체적으로 노출되어 있다면, 같은 느낌을 유지하면서 더 안전한
표현으로 바꾼 대체 캡션을 2~3개 제안해주세요.

예시 톤: 너무 딱딱하지 않게, 부모가 실제로 쓸 법한 자연스러운 말투 유지

JSON으로만 응답하세요 (다른 설명 없이):
{
  "위험표현": [
    {"원문": "OO동 놀이터", "이유": "구체적 지역명 노출"}
  ],
  "대체캡션": [
    {"문구": "수정된 캡션 1", "설명": "무엇을 바꿨는지"},
    {"문구": "수정된 캡션 2", "설명": "무엇을 바꿨는지"}
  ]
}`;
}

app.post('/api/suggest-captions', async (req, res) => {
  const { caption } = req.body || {};
  if (!caption || !caption.trim()) {
    return res.json({ 위험표현: [], 대체캡션: [], timingMs: 0 });
  }
  try {
    const result = await callClaudeText('당신은 SNS 캡션의 프라이버시 위험 표현을 다듬어주는 편집자입니다.', buildCaptionUserPrompt(caption));
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

app.post('/api/analyze-image', async (req, res) => {
  const { imageBase64, mediaType } = req.body || {};
  if (!imageBase64) {
    return res.status(400).json({ error: '이미지(imageBase64)가 없습니다.' });
  }

  const t0 = Date.now();
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 } },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    const rawText = textBlock ? textBlock.text : '';

    let parsed;
    try {
      parsed = extractJson(rawText);
    } catch (parseErr) {
      console.error('[server] Claude 응답 JSON 파싱 실패:', parseErr.message);
      return res.status(422).json({ error: 'Claude 응답 파싱 실패', rawText });
    }

    res.json({
      감지된텍스트: parsed.감지된텍스트 || [],
      timingMs: Date.now() - t0,
      usage: response.usage,
      model: response.model,
    });
  } catch (err) {
    const { status, message } = mapAnthropicError(err);
    console.error('[server] Claude Vision 호출 실패:', message);
    res.status(status).json({ error: message });
  }
});

app.listen(PORT, () => {
  console.log(`[server] 안심앨범 백엔드 실행 중 — http://localhost:${PORT}`);
  console.log(`[server] 모델: ${MODEL}`);
});
