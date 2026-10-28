# 폰 UI/UX 정비 · 사진 돌리기 복원 · 팀원 패치 · 재검증 오각형 — 2026-10-28 15:51

> 사용자: 이영우(leeyoungwoo). 한국어, 비개발자 설명을 쉬운 말로. 저장소 규칙은 `AGENTS.md` 우선
> (부탁이 아니라 차단, 동의 없이 원본 전송 금지, 키 출력 금지, 돈 드는 작업은 먼저 묻기, 커밋·푸시는 요청할 때만, 짐작 말고 재기).
> 직전 노트: `Note/2026-10-28-1439-correction-ai-buttons-deploy.md` (커밋 `ddf03a3`까지의 맥락).

## Background
사용자가 폰으로 써 보고 "전체적으로 문제가 있다"고 함. 요청: **돈(토큰) 안 쓰고** 폰 UI/UX 고치기.
제보 원문: "사진진단하면 컴퓨터 화면처럼 정보를 안줘 그냥 점수만줘", "사진 다운로드도 안되고"(카카오톡 링크로 열었을 때),
"모바일에서는 사진 돌리기가 안돼", "보정단계에서 그냥 바로 보정방식이 떳으면 좋겠어 보정 내용-고치기 눌러서 선택하는게 아니라",
"AI로 바꾸기 칸이 베이지색 테두리로 경계가 나눠져 있는데 경계없이 해줘", "보정후 재검증 단계에서 다시 오각형으로 점수화해서 시각적으로 점수가 내려간걸 보여주자".
재현은 모든 `/api`를 Playwright로 가로채 가짜 응답을 주는 방식(비용 0)으로 함.

## Progress / Decisions (전부 `index.html`, 커밋 안 함)
- **폰 진단 결과: 아래로 스크롤해서 전부 보여줌** — 장소 특정 카드(지도 칸 `.loc-right`만 숨김), 권장 조치 전체(첫 줄만 보이던 `nth-child(n+2)` 규칙 삭제), 종합 설명, 사진 번호 설명(`.factor-map`) 다시 보임. 카드 순서 order 1~6, `#screen-result` padding-bottom 5.5rem.
  **Why:** 원인은 예전 "폰은 한 화면" 요청 때문에 CSS로 일부러 숨긴 것. 사용자가 선택지 중 «그냥 아래로 스크롤» 선택. 폰 지도는 «장소 지도 ›» 칩 시트로만(자동 검색 안 함, `loc-map.js` 규칙 유지). 점수 내역 `#scoreBreakdown`은 칩 목록과 중복이라 계속 숨김 → `fold.js`는 원래부터 실패(이번 일 이전부터).
- **폰 보정: 방식 시트 없앰, AI 단추 셋을 사진 아래 바로** — `.method-row`·시트 손잡이/닫기/확인 숨김, `.correct-left`를 흐름 안 카드로(`order:2`, 사진 칸과 경계 없이 `margin:0 -1rem 8px`, `.correct-right{margin-bottom:0}`), «무엇을 바꿀까요?» 제목 숨김, 단추 3개 한 줄 grid, 미리보기 `max-height 36vh→30vh`. 393x852 한 화면, 375x667은 설명만 스크롤.
  **Why:** 사용자 요청 2건. 팀원 요청서의 «눌러야 나온다» 문제도 이걸로 해결됨.
- **보정 결과·오류 문구 `#previewCaption` 폰에서 보이게** — **Why:** display:none이라 AI가 «사람을 찾지 못해» 실패해도 폰엔 아무 반응 없었음(실측). AI 단추 클릭 시 시트 닫는 JS도 넣었으나 이제 시트가 없어 무해.
- **다운로드** — 결과 없을 때 «준비 중» 거짓 문구 → «아직 바꾼 사진이 없어요»; 폰이면 `navigator.share({files})`(사진첩 저장) 먼저; 카카오톡 등 앱 안 브라우저(`IN_APP_BROWSER` UA 정규식)면 `#saveSheet`에 사진 크게 띄워 «꾹 눌러 저장»; 그 외 기존 `<a download>`.
  **Why:** 카톡 인앱 브라우저가 blob 다운로드를 막음(사용자: 카톡 링크로 열었음). **실기기 카톡 확인은 아직 안 함** — UA 흉내로만 테스트.
- **사진 돌리기 복원** — `#rotateRow`/`#rotatePhotoBtn` «↻ 사진 돌리기», `rotatePhoto90`, `originalPhotoUrl`(EXIF는 원본에서 읽음), 얼굴 못 찾은 창에 안내 한 줄, 테스트 훅. 폰에선 설명 줄 숨김.
  **Why:** 폰만이 아니라 배포본 어디에도 없었음 — 10-27에 만들었다가 팀원 화면 채택 때 빠짐. `docs/2026-10-27-수정내역.patch`에서 되살림. 자동 방향 판단은 25장 중 5장 틀려서 여전히 안 씀.
- **팀원(김현미) zip `아이SHADOW_홈타일_결과오각형_보정스위치_1028.zip` 적용** — `아이SHADOW_홈타일_1028/`에 풀고 `git apply 홈타일_결과오각형.patch`(충돌 없음, CRLF 유지). 폰 홈에 «이런 단서를 찾아요» 예시 타일 3장(키 760px 이하 숨김), 폰 결과 오각형 가운데·등급 칩 오른쪽 위.
  **Why:** 덮어쓰기 대신 패치 — 내 index.html이 그 사이 바뀌었으므로. (직전 노트의 «홈 C안» 대기 건은 팀원 타일로 사실상 해결.)
- **재검증 «처음 → 보정 후» 오각형** — `runVerificationPipeline`이 이미 보정 사진을 다시 읽으므로 그 판독으로 `addBelongClueByZoom` → `runRiskDiagnosisPipeline`을 검증 호출과 **동시에** 한 번 더(`buildAfterRisk`, `renderVerifyRadar`, `#verifyRadar`, `lastRiskInputs` 저장, `drawRadarGrid(n, grid)`로 일반화). 캡션·게시 습관(`PHOTO_INDEPENDENT`)은 처음 점수 그대로, 화면에 «사진과 무관». 다시 채점 실패 시 칸 숨김.
  **Why:** 사용자가 «같은 채점으로 다시 재기» 선택(검증 프롬프트에 점수 묻기는 판정이 두 곳이 되고, 규칙 계산은 잰 값이 아니라서 기각). 확대 재확인을 빼면 보정 후가 «다시 안 봐서» 낮게 나와 과장되므로 포함. 비용: 검증 1회당 약 2원, 확대 재확인이 돌면 약 5원. 판독 흔들림(±7%)으로 ▲가 나올 수 있고 그대로 보여줌. **실제 API로는 아직 안 돌려봄.**
- **`역할_데이터수집.zip` 풀기** — 저장소 안 `역할_데이터수집/`(53파일, Mac `__MACOSX`·`.DS_Store` 제외, NFD 파일명 → NFC). 내용: 수집규칙·유형분류표·라벨비교(103장 AI 2라벨 83% 일치)·실사 35장 라벨(97% 일치, 라벨러 둘 다 AI라 팀원 확인 필요)·정답표 json·`실사_인터넷/` 사진 35장.

## Files touched
- `index.html` — modified: 위 전부(+ 팀원 패치)
- `test/phone-info.js` — created: 폰 결과 정보 표시·보정 단추 바로 보임·문구·다운로드(공유/카톡/데스크톱/거짓문구) 23개
- `test/photo-rotate.js` — created(패치에서 복원 + 폰 2크기 검사 추가): 37개
- `test/verify-radar.js` — created: 재검증 오각형 26개 (`SHOT=<폴더>`로 스크린샷)
- `test/phone-fit.js` — modified: «보정 내용 행이 있다» → «방식이 시트가 아니라 사진 아래 바로 있다»
- `역할_데이터수집/`, `아이SHADOW_홈타일_1028/` — created(압축 풀기), 커밋 여부 미정
- 스크래치(저장소 밖): `C:\Users\duddn\AppData\Local\Temp\claude\c--Users-duddn-ax-ton---------AI-shadow\15be5068-049a-4160-aac4-207c636c1620\scratchpad\` — `cap.js`·`dl.js`·`shot-*.js`(재현·스크린샷용)

## 테스트 상태 (무료만, 8000번 정적 서버 기준)
- 전체 무료 테스트 54파일 중 실패: `fold.js`(원래부터), `outfit-modes`·`person-mask`·`visual-clues`(실제 아이 사진 파일 없음), `hallucinated-people`·`multi-person-align`(유료 live 테스트가 만드는 기준 사진 없음) — 전부 이번 수정과 무관.
- `phone-info.js`는 전체 묶음 실행 중 1회 1개 실패, 단독 6회 연속 통과 → 부하 시 타이밍 흔들림으로 판단(미해결, 기록만).
- ⚠ **유료 테스트 목록**: `*-live.js`, `photo-accuracy.js`, `regression.js`, **`schedule-holdout.js`**(이름에 live 없음, 머리에 «비용 발생»), `schedule-live.js`. 이번에 `schedule-holdout.js`를 실수로 돌렸으나 8000번(파이썬 SimpleHTTP)이 `/api` POST를 501로 거절해 **비용은 0**이었음.

## Next steps / open questions
- **사용자 결정 대기 ①: 팀원 요청서 `아이SHADOW_홈타일_1028/보정_스위치_전달.md`** — AI 단추 셋을 켜고 끄는 스위치로(켤 때마다 동의 유지, 끄면 AI 재호출 없이 그 전 사진). 정할 것: 먼저 켠 것을 끌 때 → 추천 «뒤에 켠 것도 같이 꺼짐»(돈 안 듦). 단추 id(`aiMarkBtn` 등) 유지 권장.
- **사용자 결정 대기 ②:** `역할_데이터수집/실사_인터넷/` 사진 35장을 `.gitignore`에 넣을지(문서는 «깃허브에 올리지 않아요»라는데 아직 무시 목록에 없음).
- 실기기 확인 요청할 것: 카카오톡에서 다운로드(공유 시트/꾹 눌러 저장), 재검증 오각형 실제 숫자(실제 API, 유료 소액).
- 커밋은 사용자 요청 시에만. 커밋 시 제외: `docs/역할4-개발개선.md`, `docs/*.patch`, `docs/tech-brief.html`, `5ea9dbc…jpg`, `결과표.pdf`, `*.zip`, 팀원 zip 폴더들, `역할_데이터수집/실사_인터넷/` 사진. 커밋 전 `bash scripts/check-secrets.sh`. 메시지는 한국어로 «무엇을 재서 무엇을 바꿨는지», 제보 문장 인용.
- 이전 노트에서 이어지는 미결: 배경 교체 뿌연 정도(1024→1568px?), 로고 판별 강화(Claude에 조각 묻기), 슈퍼베이스 표·버킷, 폰 실시간 보기(browser-sync) — 모두 사용자 결정 대기.
- 로컬 서버: 3001(`node server/server.js`, 실제 키 — 테스트는 여길 쓰지 말 것), 8000(`python -m http.server 8000`, 테스트용).
