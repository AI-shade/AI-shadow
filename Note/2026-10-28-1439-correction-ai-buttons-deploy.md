# 보정 화면 AI 단추 셋 · 배경 교체 fill · 로고 지우기 · 배포 — 2026-10-28 14:39

> 사용자: 이영우(leeyoungwoo, duddndlsla@gmail.com). 한국어로 대화. 비개발자 설명을 자주 요청하므로 쉬운 말로.
> 프로젝트 규칙은 저장소 `AGENTS.md`가 우선(마스크 규칙 «부탁이 아니라 차단», 동의 없이 원본 전송 금지, 키 출력 금지,
> 돈 드는 작업은 먼저 묻기, 커밋·푸시는 요청할 때만, 짐작하지 말고 재기).
> 더 자세한 기록: `docs/2026-10-27-수정내역.md`(맨 위 «10-27 저녁 갱신» 블록이 최신).

## Background
- 아이SHADOW: 아이 사진 SNS 업로드 전 위치 노출 위험 진단 → 보정 → 재검증 웹앱(`index.html` 한 파일 + `server/server.js`).
- 사용자 역할4 체크리스트(`docs/역할4-개발개선.md`, **커밋 안 함**, 사용자가 푸시에서 빼라고 함)를 순서대로 진행:
  1. 슈퍼베이스 연결 → 2. 옷 바꾸기 버그 → 3. 옷 색 → (4는 제외) → 5. 배포.
- 팀원 김현미가 화면 수정본 zip(`아이SHADOW_화면수정_1027.zip`, hyeon-latest 기준)을 줬고, 그걸 기준으로 합침.

## Progress / Decisions
- **슈퍼베이스**: 프로젝트 `ai-shadow-dev`(서울, 무료) 생성·연결만. 표·버킷·사진 업로드 안 함(사용자 "기다려").
  `server/.env`에 `SUPABASE_URL`/`SUPABASE_SECRET_KEY`(대화 중 키 노출 사고 → 재발급 완료). 확인: `node scripts/supabase-check.mjs`.
  — **Why:** 사진 유형별로 분석법을 달리하기 위한 개발용 정답셋 저장소. 서비스 사용자 사진은 저장 안 함.
- **`server/.env` 중복 키 제거**(구글 비전·학교 LLM·카카오가 아래 빈 줄에 덮여 빈 값이었음). git 밖 변경.
- **팀원 화면 수정본을 기준으로 채택**(내 «카드 2개» 화면은 버림). — **Why:** 화면은 팀원이 더 진행, 같은 곳 중복 수정 방지.
- **보정 화면 = AI 단추 셋만**: «로고 지우기»·«배경 교체하기»·«옷 전체 바꾸기». 자동 보정(글자 덮기·교복 색·배경 흐림),
  찾은 곳 목록, «+ 놓친 곳 추가», 상자 끌기, 간판 글자 AI, 폰 단계 스위치는 **숨김**(DOM은 `is-gone`로 남김, 코드 그대로).
  보정 화면 진입 시 글자 위치 재계산(구글 비전·Tesseract) 삭제 → 바로 원본 표시. 동의 거절 → `selectMethod(null)`.
  — **Why:** 사용자 "자동보정이 빼봐봐 … 더 불편", 놓친 곳 추가 등은 "바로바로 반영이 되는것도 아니고 로딩시간도 길고".
- **배경 교체 = `flux-pro/v1/fill` + 사람 마스크**(`buildBackgroundMask`·`runBackgroundFill`, 사람 마스크는 팀원 `getFullPersonMask`),
  긴 변 1024px(1회 약 $0.04), 서버 `/api/replace-background`는 마스크 없으면 400. 사람과 겹치는 얼굴·손만 딱 맞게 막음.
  — **Why:** kontext가 사람까지 다시 그려 옷이 바뀌고 이중 테두리. 사용자 확인 "이중테두리 사라졌어".
  자동 보정 위에서 시작해 뿌옇던 문제 해결(배경 선명도 7%→91%). 남은 원인: 1024px 업스케일(4032px 사진 ×3.9) → 1568px로 올릴지 미정.
- **로고 지우기 = 찾은 로고 자리만**(`findLogoRects`·`buildLogoMask`·`prefillWithSurround`): 옷에서 «주변 천과 다르고 날카로운
  꽉 찬 덩어리»(상자 채움≥0.5, 길쭉함≤2.5, 묶는 거리 0.3%), 찾는 범위 어깨선~얼굴 높이 1.9배(`EMBLEM_LOGO_SEARCH_RATIO`),
  얼굴 중심 0.7배 안. 연 자리는 둘레 천 최빈색으로 칠해 보냄. 못 찾으면 가슴 띠(1.4배) + 흐림.
  — **Why:** 가슴 띠 통째로 열어 옷이 바뀌고 원본을 보내 새 명찰이 그려짐. 기준값은 사진 4장으로 잼(앱 함수로 찍은 값).
  **지우기 vs 교체**: 지우기 유지(교체는 가짜 소속 생길 위험). 빈 가슴이 어색하면 «포켓» 되살리기 고려.
- **옷 전체 바꾸기**: 회색 대신 옷끼리만 흐린 원본(3.5%, `blurInsideMask`), 하의 띠에서 상의 색 빼고 읽기(`medianClothesColor` notLike),
  «원래와 비슷한 차분한 색» 문구(`outfitColorPhrase` shift). 팀원 수정(`worn by a young child` 제거, 상반신 하의 생략) 유지.
  — **Why:** 패딩 아이 몸 전체가 새로 그려짐, 베이지 바지를 black으로 읽음, 사용자 "옷색은 너무 극단적으로 바뀌지만 않았으면".
- **사진 돌리기 버튼(내 버전)·자동 방향 판단**: 팀원 버전 채택하며 빠짐(패치에만 있음). 자동 판단은 25장 중 5장 틀려서 안 함.
- **배포 완료**: 커밋 `ddf03a3`(main, 작성자 leeyoungwoo, 31파일) → GitHub Actions가 버셀 배포. child-tawny.vercel.app에서
  새 코드 확인. 서버는 접근 코드 때문에 직접 확인 못 함. 팀원 hyeon-latest 커밋 15개는 GitHub에 없음 → 팀원은 main을 받아 맞춰야 함.
- **홈 화면 여백(폰)**: 목업 A(3단계 텍스트)·B(3단계 아이콘 카드)·C(«이런 사진, 위험할 수 있어요» 예시 사진 썸네일 4장, 알아보기
  «올리기 전에 잠깐» 사진·문구 재사용). 내 추천 **C안**. **아직 코드에 안 넣음** — 사용자 결정 대기.

## Files touched
- `index.html` — modified(커밋됨): 팀원 화면 + 위 엔진들 + AI 단추 셋 + 로고 찾기
- `server/server.js` — modified(커밋됨): `/api/replace-background` fill·마스크 필수, `FLUX_PROMPT_SYSTEM`
- `server/.env.example`, `.gitignore`(KakaoTalk_*, *보고서.pdf) — modified(커밋됨)
- `test/logo-erase.js`, `test/ai-bg-base.js`, `test/background-mask.js`, `test/bg-endpoint.js` — created(커밋됨)
- `test/outfit-blank.js`, `test/outfit-colors.js`, `test/pill-wrap.js`, `test/auto-correction.js` 등 — modified(커밋됨)
- `docs/2026-10-27-수정내역.md`, `docs/superpowers/{specs,plans}/2026-10-27-보정-단순화*.md`, `docs/실험/*.js`, `scripts/supabase-check.mjs` — created(커밋됨)
- `docs/역할4-개발개선.md` — modified, **커밋 제외**(사용자 요청)
- `docs/2026-10-27-수정내역.patch` — created, 커밋 안 함(GitHub 71ee78a 기준 옛 버전 복구용)
- `server/.env` — modified(git 밖, 절대 커밋 금지)
- 커밋 금지 파일(저장소 폴더 안): `5ea9dbc71e46783428759727cda45b62.jpg`(상업 모델 사진), `결과표.pdf`, `아이SHADOW_화면수정_1027/`, `docs/tech-brief.html`
- `C:\Users\duddn\ax-ton 멋쟁이사자처럼\목업\*.png` — 홈 화면 목업(저장소 밖)

## Next steps / open questions
- **홈 화면 C안을 코드에 넣을지** 사용자 답 대기(넣으면: `.app-trust` 뒤, flex `order` 지정 필수 — 안 주면 맨 위로 감; 375×667 이하 숨김; `›`는 알아보기 «올리기 전에 잠깐»으로).
- **폰 화면 실시간 보기**: 사용자가 물어봄. 추천 = browser-sync 등 자동 새로고침 + 같은 와이파이 폰 접속(`http://PC IP:3001`, 방화벽 허용). 설정 제안만 했고 미실행.
- 실제 AI 결과는 사용자가 직접 테스트 중(fal 유료). 확인할 것: 로고 지우기(교복 칼라 여밈·단추가 같이 지워지는 한계), 배경 교체 뿌연 정도(→1568px?), 배경에 사람이 새로 그려짐(«no other people» 무시) 기록만.
- 로고 판별 강화안: 후보 조각을 확대해 Claude에 «로고인가» 묻기(1회 몇 원) — 사용자 관심 있음, 미착수.
- 슈퍼베이스 표·버킷·사진 유형 기준·업로드는 사용자 결정 대기.
- 로컬 서버: 3001(`node server/server.js`), 8000(`python -m http.server 8000`, 테스트용) — 세션 종료 시 꺼질 수 있음.
- 테스트는 무료부터(`cd test && node logo-erase.js` 등). `regression.js`·`*-live.js`·`photo-accuracy.js`는 **유료**(실수로 돌리지 말 것).
