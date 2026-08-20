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
    // 가장 구체적인 예외부터 확인 (문자열 매칭 대신 타입 체크)
    let status = 500;
    let message = err.message || 'Claude Vision 호출 실패';
    if (err instanceof Anthropic.AuthenticationError) {
      status = 401; message = 'API 키가 유효하지 않습니다.';
    } else if (err instanceof Anthropic.RateLimitError) {
      status = 429; message = '요청이 너무 많습니다 (rate limit).';
    } else if (err instanceof Anthropic.APIConnectionError) {
      status = 503; message = 'Anthropic API에 연결할 수 없습니다 (네트워크 문제).';
    } else if (err instanceof Anthropic.APIError) {
      status = err.status || 500;
    }
    console.error('[server] Claude Vision 호출 실패:', message);
    res.status(status).json({ error: message });
  }
});

app.listen(PORT, () => {
  console.log(`[server] 안심앨범 백엔드 실행 중 — http://localhost:${PORT}`);
  console.log(`[server] 모델: ${MODEL}`);
});
