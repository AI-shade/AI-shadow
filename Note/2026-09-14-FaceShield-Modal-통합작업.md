# FaceShield 아이SHADOW 통합 작업 — 2026-09-14

> 이 문서 하나만 읽어도 이어서 작업할 수 있게 썼습니다. 전날 검증 기록은
> [deepfake/Note/2026-09-14-FaceShield-Colab-실현가능성검증.md](../../Note/2026-09-14-FaceShield-Colab-실현가능성검증.md)
> 참고 (같은 날 오전에 작성, 이 문서는 그 후속 — 실제 서비스 통합 시도).

## 개요

전날 Colab에서 FaceShield(적대적 노이즈로 딥페이크 방어) 실현가능성을 검증 완료한
뒤(임베딩 거리 0.70 이동, SNS압축 후 79~90% 유지, 실제 페이스스왑 도구로도 검증),
이걸 실제로 아이SHADOW 서비스에 통합하는 작업을 진행했다. **결론: 배포 완료, 실제
동작 검증까지 끝남 — Express 서버 → Modal GPU 앱 → 실제 보호처리 → 응답까지 전체
경로가 실측으로 확인됐다.** 콜드스타트 78초, 웜 인스턴스 재사용 시 23초.

**현재 상태: `FACESHIELD_MODAL_URL`이 `server/.env`에 이미 설정돼 있고, `/api/faceshield-status`가 `{"ready":true}`를 반환한다. 백엔드는 완전히 살아있다.** 남은 건
프론트엔드(`index.html`) 카드 추가뿐.

## 진행된 작업 및 결정사항

1. **GPU 호스팅 플랫폼 결정 과정** (사용자 선택: fal.ai 커스텀 앱 → 실패 → Modal로 전환)
   - 처음엔 이미 계정이 있는 **fal.ai**를 선택 (Modal/Replicate는 새 계정 필요해서 후순위로 미룸)
   - `fal_app.py` 작성 완료, `fal run`으로 실제 배포 시도까지 감
   - **막힘**: fal.ai의 Serverless 커스텀 앱은 "enterprise customers only" — 신청 폼이
     "H100 100장 예약, InfiniBand 필요 여부" 같은 대기업 단위 질문들이라 학생 해커톤
     프로젝트가 쓸 자리가 아님. **폐기.**
   - **Modal로 전환**: 승인 절차 없이 카드 등록만으로 즉시 GPU 접근 가능. `fal_app.py`의
     로직(체크포인트 준비, `attack()` 호출 구조)을 `modal_app.py`로 그대로 이식 완료.
   - `fal_app.py`는 참고용으로 폴더에 남겨뒀지만 **실제로 쓸 건 `modal_app.py`**.

2. **`attack.py`를 서버리스 함수로 감싸는 방법** — `ddpwrapper.py`의 torchrun/DDP
   분산처리 스캐폴딩은 안 씀. `attack(args, gpu_num, gpu_no)` 함수 자체는 순수 함수라
   `args`를 `types.SimpleNamespace`로 직접 만들어서 `attack(args, 1, 0)`으로 바로 호출
   가능함을 확인 — 원본 코드를 거의 안 건드리고 그대로 재사용.

3. **체크포인트 준비 방식**: Colab에서 검증한 것과 동일 — 공식 `arcface50/100_checkpoint.tar`
   다운로드처가 죽어있어서, `custom_arcface.py`(TreB1eN IR-SE-50 아키텍처 + ImageNet↔[-1,1]
   정규화 어댑터)로 대체 체크포인트를 **컨테이너 시작 시(Modal의 `@modal.enter()`) 한 번만
   생성**해서 재사용하도록 함 (매 요청마다 다시 만들지 않음).

4. **Express 서버 연결**: `server/server.js`에 `/api/faceshield-status`,
   `/api/faceshield-protect` 두 엔드포인트 추가. 기존 fal.ai 모델 호출(`fal.subscribe`)
   패턴과 다르게, Modal 배포 URL은 평범한 HTTPS 엔드포인트라 **fal SDK 없이 그냥 `fetch`로
   직접 호출**하도록 구현. `FACESHIELD_MODAL_URL` 환경변수 있어야 활성화, 없으면 자동으로
   "준비 중" 501 응답 (기존 `/api/flux-status` 패턴과 동일).

5. **프론트엔드(`index.html`)는 의도적으로 아직 안 건드림** — 438KB 단일 파일에 이미
   정교한 보정방식 카드 시스템(중복인물 감지, 동의모달, 폴백 로직)이 있는데, 백엔드가
   아직 실제 배포 전이라 검증할 방법이 없는 상태에서 그 복잡한 파일을 건드리는 건
   위험 대비 이득이 안 맞는다고 판단. **백엔드 실배포 확인 후 진행할 것.**

## 변경/생성된 파일

| 파일 | 역할 |
|---|---|
| `server/faceshield-fal/faceshield_repo/` | FaceShield 원본 repo `git clone` 그대로 (attack.py, utils/ 등) |
| `server/faceshield-fal/faceshield_repo/custom_arcface.py` | 대체 ArcFace 모델 정의 (Colab에서 쓴 것과 동일 내용) |
| `server/faceshield-fal/faceshield_repo/model_ir_se50.pth` | TreB1eN 공개 가중치 (167MB, OneDrive에서 받아둔 파일 복사) |
| `server/faceshield-fal/fal_app.py` | **폐기됨** (fal.ai enterprise 제한으로 못 씀, 참고용으로만 남김) |
| `server/faceshield-fal/modal_app.py` | **실제로 배포할 파일** — Modal 앱 정의, 상단 주석에 배포 절차 있음 |
| `server/server.js` | `/api/faceshield-status`, `/api/faceshield-protect` 엔드포인트 추가 (약 1285번째 줄 근처) |
| `server/.env.example` | `FACESHIELD_MODAL_URL` 항목 추가 |

## 발견한 문제와 해결

- **문제**: `fal run` 실행 시 `'cp949' codec can't decode byte 0xec... illegal multibyte sequence`.
  **원인**: 한국어 Windows(cp949 로캘)에서 내가 쓴 한글 주석 포함 `.py` 파일들을 fal CLI가
  텍스트 모드로 읽다가 인코딩 충돌. **해결**: `PYTHONUTF8=1`, `PYTHONIOENCODING=utf-8`
  환경변수를 CLI 실행 전에 설정. **다음에도 이 컴퓨터에서 fal이든 modal이든 Python CLI
  도구를 쓸 땐 이 두 환경변수를 항상 먼저 export할 것.**

- **문제**: `fal.api.api.function() got multiple values for keyword argument 'machine_type'`.
  **원인**: `class FaceShieldApp(fal.App, machine_type="GPU-A6000")`처럼 클래스 정의
  키워드 인자로 넘기면 CLI가 내부적으로 주입하는 값과 충돌. **해결**: 클래스 본문 안에
  일반 속성(`machine_type = "GPU-A6000"`)으로 쓰면 해결됨. (결국 안 쓰게 됐지만, Modal이나
  다른 프레임워크에서 비슷한 에러 나면 같은 방식으로 의심해볼 것)

- **문제**: fal.ai에 파일 업로드까지 다 되고 나서야 `Insufficient permissions: ...
  serverless-get-started` 에러. **원인**: fal Serverless 자체가 계정에 활성화 안 돼
  있었음 — 신청해보니 "enterprise customers only" 폼. **해결 아님, 플랫폼 자체를 포기하고
  Modal로 전환**. **교훈**: 새 GPU 호스팅 플랫폼을 고를 때, 코드 작성 전에 먼저
  "Serverless/커스텀 앱 배포" 기능이 실제로 셀프서브(자기 계정에서 바로 켤 수 있는지)인지
  엔터프라이�즈 세일즈 게이트인지부터 확인했어야 함 — 이번엔 순서가 거꾸로였음.

## 아직 안 끝난 것 / 다음 단계

- [x] ~~Modal 계정 가입~~ — 완료 (`hyeonmi300` 계정, 결제수단 미등록 상태로 $1 무료
      한도 안에서만 안전하게 동작 — 카드 등록 안 하는 이상 추가 과금 불가능)
- [x] ~~`modal deploy modal_app.py`~~ — 완료, 배포 URL:
      `https://hyeonmi300--faceshield-protect-faceshieldservice-protect.modal.run`
- [x] ~~실제 이미지로 `/protect` 테스트~~ — 완료. 콜드스타트 78초, 웜 인스턴스 23초
      (내부 처리시간 각각 58.4초/19.8초)
- [x] ~~Express `/api/faceshield-protect`까지 전체 경로 테스트~~ — 완료, 정상 동작
- [ ] **`index.html`에 5번째 보정방식 카드 추가** — 유일하게 남은 작업.
      ("실험적: AI 얼굴인식 방해" 등 이름으로) 기존 "AI 배경교체" 카드의 동의모달 패턴을
      그대로 따라가면 됨 (`fluxConsentModal` 코드 참고, `selectMethod()` 함수에 분기 추가).
      이제 백엔드가 실제로 살아있으니 안전하게 진행 가능
- [ ] 진짜 IR-SE-100 체크포인트 구하기 (지금은 50 복제품)
- [ ] Modal Spend Limit(지출 한도) 대시보드에서 $0으로 명시적으로 설정해두는 것 권장
      (지금은 결제수단 미등록이라 안전하지만, 나중에 카드 등록하게 되면 꼭 설정할 것)

### 배포 중 추가로 겪은 문제와 해결 (2차 세션)

- **`einops` 등 패키지 누락**: `attack.py`가 import하는 하위 모듈(`resampler.py`)이
  최상단에서 `from einops import rearrange`를 쓰는데, 손으로 추린 짧은 requirements
  목록에 빠뜨림 → **원본 `environment.yaml`의 pip 목록 거의 전체로 교체**해서 해결.
  (`utils/utils.py`도 최상단에서 무조건 `import dlib`을 해서, dlib을 실제로 안 써도
  설치는 필요함)
- **`ImportError: libGL.so.1: cannot open shared object file`**: `opencv-python`(GUI판)과
  `opencv-python-headless`를 둘 다 설치해서 GUI판이 덮어씀 — Modal의 최소 이미지엔
  GUI 라이브러리가 없어서 깨짐. **해결**: GUI판 제거 + `image.apt_install("libgl1",
  "libglib2.0-0")`로 시스템 라이브러리도 안전망으로 추가(insightface 등이 opencv-python을
  다시 끌고 올 수 있어서).
- **`fal.api.api.function() got multiple values for keyword argument 'machine_type'`**
  (fal.ai 시도 때) — `class X(fal.App, machine_type="...")` 대신 클래스 본문 안
  속성으로 쓰면 해결. (결국 fal은 안 쓰게 됐지만 기록 남김)
- **배포 중 `getaddrinfo failed`**: 로컬 네트워크 일시 문제, 재시도로 해결. 이미
  빌드된 이미지는 캐시돼서 재배포가 10초 만에 끝남.

### 3차 세션 — 화질 문제 발견 및 해결 (실사용 제보)

- **문제**: 실제 프론트에 붙여서 브라우저로 사진을 올려 테스트해보니, 결과물이 육안으로도
  보일 만큼 자글거림. "노이즈가 너무 강하다"처럼 보였음.
  **진짜 원인**: `attack.py`는 512px(기본 `resize_shape`)보다 큰 사진(폰 사진은 거의 항상
  해당, 보통 3000px대)을 **전체 사진 자체를 512px 근처로 축소**해서 처리한다. 그 저해상도
  결과를 프론트에서 원본 크기로 그냥 늘려서 보여주고 있었다 — "노이즈가 심함"의 정체는
  사실 **저해상도 이미지를 확대해서 생긴 화질 손실**이었다(적대적 섭동 자체 문제 아님).
  **해결**: 이 프로젝트가 예전에 `public/adversarial.js`에서 이미 썼던 기법을 서버 쪽에
  그대로 적용 — 결과 이미지 전체가 아니라 **"잔차(protected_저해상도 - source_저해상도)"만
  뽑아서, 그 잔차만 원본 해상도로 확대해 원본 위에 얹는다.** 노이즈 자체가 DCT
  저역통과 필터를 거친 저주파 패턴이라 확대해도 안 튀지만, 원본의 선명한 디테일은
  그대로 보존된다. `modal_app.py`의 `_run_attack`에 PIL/numpy로 구현함
  (`source.png`/`protected.png`는 `attack.py`가 이미 저장해두는 파일이라 추가 계산 없이
  바로 씀).
- **디버깅 함정**: 처음 이 수정을 배포했을 때 결과가 여전히 512x512로 나와서 "웜
  컨테이너가 예전 코드를 쓰나?"로 의심했으나, `modal app stop`으로 확인해보니 **떠있는
  컨테이너가 아예 없었음**(오해였음). 진단용 `print(..., flush=True)`를 코드에 박아넣고
  재배포 후 `modal app logs`로 직접 확인해서야 새 코드가 실행되는 걸 확인함. **교훈**:
  "배포가 반영 안 된 것 같다"는 의심이 들면 웜 컨테이너 탓으로 넘겨짚지 말고, 먼저
  진단 print를 넣고 로그로 직접 확인할 것 — 이번 경우처럼 실제로는 배포도 잘 됐고
  코드도 잘 도는데 원인은 다른 곳(정확히는 재현 안 됨, 두 번째 배포부턴 정상 동작)에
  있을 수 있다.
- 2048x2048 테스트 이미지로 재검증 완료 — 최종 결과물이 원본과 동일한 해상도로
  나오고 육안상 선명함 확인됨 (`server/faceshield-fal/big_result2.png`... 는 정리 과정에서
  삭제될 수 있음, 재현하려면 이 노트의 재현 절차대로 다시 테스트할 것).
- **문제(2차)**: 잔차 확대 기법 적용 후에도 사용자가 "그래도 자글거린다"고 재차 제보.
  `resize_shape`를 512→1024로 올려 업스케일 배율을 줄여봤지만(4배→2배) **오히려 더
  자글거려 보임** — 업스케일 시 bilinear 보간이 자연히 주는 "블러링"이 배율이 작을수록
  덜 걸려서, 절대 블록 크기는 작아져도 경계가 더 또렷하게 남는 역효과로 추정(정확한
  검증은 안 함).
  **진짜 원인**: `attack.py`의 DCT 저역통과 필터가 **8x8 블록 고정**(`utils/dct.py`의
  `dct_pass_filter`가 8x8 하드코딩 마스크, `attack.py`도 `N=8` 하드코딩)이었다. 이 블록
  크기는 `resize_shape`(처리 해상도)에서는 항상 8px이지만, 원본이 크면 클수록(즉
  업스케일 배율이 클수록) 잔차를 확대할 때 **그 8px 블록도 배율만큼 그대로 커진다** —
  Colab 검증(512 원본, 업스케일 없음)에선 8px 블록이 안 보였지만, 폰 사진(2000px대)을
  512로 축소했다가 4배 확대하면 32px 블록이 되어 눈에 띄게 된 것.
  **해결**: DCT 블록 크기(N)를 고정값이 아니라 **업스케일 배율에 반비례**하게 요청마다
  동적으로 계산하도록 고침 — `dct_block_size = round(8 / upscale_factor)` (최소 2로
  클램프), `upscale_factor = max(1, 원본 긴 변 / resize_shape)`. 이러면 최종(원본 크기)
  이미지에서 블록의 절대 픽셀 크기가 원본 크기·resize_shape 조합과 무관하게 항상
  Colab에서 검증된 ~8px 근처로 유지된다.
  - `utils/dct.py`: `dct_pass_filter(device)` → `dct_pass_filter(device, N=8)`로 시그니처
    변경, 하드코딩 8x8 행렬 대신 `u+v < 0.75*N` 삼각형 컷오프로 임의 N에 대해 일반화
    (N=8을 넣으면 원래 손튜닝 마스크와 근사한 비율 나옴 — 정확히 같은 모양은 아님).
  - `attack.py`: `N=8` 하드코딩 → `N = getattr(args, "dct_block_size", 8)`.
  - `modal_app.py`: `_run_attack`에서 원본 이미지 크기를 먼저 읽어 `upscale_factor`,
    `dct_block_size`를 계산해 `args`에 추가.
  - 재검증: `resize_shape` 기본값(512)으로 되돌리고 2048x2048 테스트 이미지로 재시도 →
    HTTP 200, 30초 처리(1024 테스트의 89초보다 오히려 빠름 — 512라 PGD 루프 자체가
    가벼움), 결과 2048x2048, 육안상 자글거림 크게 개선됨 확인.
- **문제(3차)**: dct_block_size 수정 후에도 사용자가 "그래도 좀 눈에 보인다"고 재차
  제보, "원본이랑 최대한 비슷했으면 좋겠다"고 요청.
  **시도 1(기각)**: `noise_clamp`를 12→8로 낮춰봄 — 로컬에서 같은 ArcFace 체크포인트로
  임베딩 거리를 직접 재보니(아래 검증 방법 참고) **보호 효과가 15%나 깎이는데 화질
  개선은 미미**(평균 픽셀 차이 2.875→2.775, 3.5%만 감소) — 남는 자글거림은 "노이즈가
  세서"가 아니라 "블록 경계가 또렷해서" 생기는 것이었기 때문. 채택 안 함.
  **원인**: `dct_block_size`로 블록의 절대 크기는 줄였지만, bilinear 확대가 만드는
  **블록 "경계"(가장자리)** 자체는 여전히 또렷하게 남아 자글자글해 보임.
  **해결**: 원본 위에 얹기 직전, 확대된 delta에 **가우시안 블러(radius=6)**를 한 번
  더 적용 — 경계를 부드럽게 풀어주되 delta의 저주파 형태(=보호 효과의 핵심)는 거의
  안 건드림. `modal_app.py`의 delta 리사이즈 직후에 `PIL.ImageFilter.GaussianBlur`
  한 줄 추가.
  **검증 방법(중요 — 추측하지 않고 직접 잼)**: 로컬에 CPU용 torch를 설치해서
  `faceshield_repo/custom_arcface.py` + `model_ir_se50.pth`로 원본 vs 각 결과물의
  ArcFace 임베딩 코사인 거리를 직접 계산 (얼굴 정렬 없이 112x112 리사이즈만 하는
  약식 비교라 절대값은 Colab 검증치 0.70과 다르지만, **후보안끼리 상대 비교**에는
  충분): blur 없음 기준 거리 0.1241 대비 — radius 3: -0.6%, radius 5: -3.0%,
  **radius 6: -4.5%**, radius 8: -8.5%, radius 10: -13.8%, radius 12: -19.1%,
  radius 16: -31.0%, radius 20: -42.9%, (참고) noise_clamp 8: -15%. 처음엔 radius
  6으로 배포했다가, 사용자가 "90%대 보호효과를 유지하면서 최대한 원본과 비슷하게"를
  요청해서 **radius 8(보호효과 91.5% 유지, 90%대의 사실상 한계선)로 최종 변경**.
  radius 10부터는 86.2%로 90% 밑으로 떨어짐.
  **한계**: 완전히 원본과 동일하게는 만들 수 없음(사용자가 "차이 0 + 보호효과 90%"를
  물어봐서 명확히 답함) — 노이즈가 아예 없으면 방어 효과도 0이 되는 게 이 기술의
  본질적 트레이드오프. 지금 버전은 "90%대 보호효과 유지" 조건 안에서 최대한 원본과
  비슷하게 만든 지점.
- **문제(4차, 가장 근본적인 원인 발견)**: blur로 경계는 풀었지만 사용자가 여전히
  "눈에 보인다"고 함. `attack.py` 원본 코드를 다시 보니 — 함수 이름은
  `face_detection_mask`인데 **실제 얼굴 검출/크롭 코드가 통째로 주석 처리**돼 있고
  (`utils/utils.py` 92, 108~110번 줄), 랜드마크 모델 파일(`shape_predictor_68_face_
  landmarks.dat`)도 저장소에 아예 없음 — `coord = (0, h, 0, w)`로 **사진 전체를
  "얼굴"로 취급**하고 있었다. 즉 논문 저자들도 이 크롭 단계 없이 배포한 것.
  **의미**: 논문의 "육안으로 안 보임" 검증은 전부 이미 얼굴만 있는 512px대 크롭
  이미지(CelebA-HQ, FFHQ 같은 연구용 데이터셋) 기준이다. 우리는 폰 사진 전체
  (2000~3000px대, 배경 포함)를 그대로 넣고 있었으니 delta를 훨씬 크게(배율 4배 이상)
  확대해야 했고, 그게 자글거림의 진짜 근본 원인이었다 — dct_block_size/blur는 전부
  증상 치료였다.
  **해결(진짜 원인 수정)**: `modal_app.py`에 자체 얼굴 검출을 추가해서, **얼굴 영역만
  크롭해 처리하고, 나머지(배경·머리카락·옷·다른 사람)는 원본을 전혀 건드리지 않고
  그대로 붙여넣는다.**
  - `insightface`는 이미 pip 의존성에 있었음(Colab 검증 때도 씀) — `FaceAnalysis`를
    `allowed_modules=["detection"]`로 검출기만 로드(인식/랜드마크 모델까지 받을
    필요 없어서 다운로드도 가볍고 로딩도 빠름), `@modal.enter()`에서 한 번만 준비.
  - `_detect_face_box()`: 가장 큰 얼굴 bbox에 0.6배 패딩(머리카락·목 포함)을 준
    사각형을 반환. 못 찾으면 `None` → 호출부가 예전처럼 사진 전체를 쓰도록 폴백
    (기능이 끊기지 않게). 클로즈업 사진에서 검출이 안 되는 문제(Colab에서 겪었던 것과
    동일)에 대비해, 첫 시도 실패 시 테두리를 패딩해서 한 번 더 시도하는 것도 그대로
    가져옴.
  - `_run_attack()`: 원본 전체가 아니라 크롭만 `attack.py`에 넘기고, dct_block_size도
    "크롭 크기 대 resize_shape" 비율로 계산하도록 바꿈. 최종적으로는 크롭 결과를
    원본 전체 이미지의 해당 좌표에만 붙여넣음(`final_arr[y1:y2, x1:x2] = ...`).
  **검증**: 기존 테스트 사진(2048x2048, 얼굴이 프레임을 거의 다 채우는 클로즈업)으로는
  크롭해도 패딩 후 거의 전체 프레임이 크롭 영역이 돼버려서(전체 픽셀의 99.5% 변경)
  개선이 안 보였음 — **테스트 사진 자체가 이 기능엔 안 맞는 케이스였음**. 배경이
  넓은 실제 사진(생일파티 단체사진, `샘플2.jpeg`, 909x1024)으로 재검증하니 확실히
  효과 있음: 전체 픽셀의 **83%가 원본과 100% 동일**해짐(크롭 영역인 16.8%만 수정),
  전체 이미지 기준 평균 픽셀 차이도 2.4~2.9 → **0.21**로 10배 이상 감소, 처리시간도
  23초로 오히려 더 빨라짐(크롭이 작아서 attack.py 내부 다운스케일 자체가 거의
  필요 없어짐).
  **한계(같은 세션에서 바로 해결)**: 처음엔 여러 명이 나온 사진에서 가장 큰 얼굴
  1명만 보호됐음 — 사용자 요청으로 바로 확장.
- **개선(단체사진 전원 보호)**: `_detect_face_box`(단일 반환) → `_detect_face_boxes`
  (검출된 모든 얼굴 반환)로 변경. 얼굴 상자끼리 패딩 때문에 겹칠 수 있어(사람들이
  붙어 서 있는 경우) `_merge_overlapping_boxes()`로 겹치는 상자를 하나로 합쳐 중복
  처리를 막음. `_run_attack`은 검출된 얼굴마다 순회하며 각각 크롭+attack.py 실행+
  delta 합성을 반복(`_process_one_face`로 분리)하고, 마지막에 각 결과를 원본의 해당
  좌표에만 붙여넣는다. 응답에 `faces_protected` 개수 추가.
  **검증**: 같은 생일파티 사진(아이 3명)으로 재테스트 → `faces_protected: 3`,
  109초(얼굴당 ~36초, 웜 컨테이너 기준), 세 명 모두 얼굴에 보호 적용 확인, 배경/음식은
  그대로. **주의**: 얼굴 수만큼 attack.py를 반복 실행하므로 처리 시간이 얼굴 수에
  비례해서 늘어난다 — `@app.cls(timeout=280)` 기준 대략 7~8명이 넘는 단체사진은
  타임아웃날 수 있음(다음에 필요해지면 timeout 값을 올릴 것).
- **개선(blur radius도 배율에 비례하게)**: 사용자가 "보호효과 95% 이상이어도 차이가
  없는지" 확인해달라고 함 — 확인해보니 `DELTA_BLUR_RADIUS=8` 고정값이 문제였다.
  로컬에 insightface를 설치해서 생일파티 사진(`샘플2.jpeg`)의 실제 크롭 크기를
  재보니 3명 다 512px보다 작음(가장 큰 것도 358x449) — 즉 attack.py 내부에서 애초에
  다운스케일이 안 일어나서 **블록 경계 자체가 생기지 않는 상황**인데도 고정 blur를
  걸어서 화질 이득 없이 보호효과만 8.5% 공짜로 깎아먹고 있었다.
  **해결**: `dct_block_size`와 같은 원리로 blur radius도 `upscale_factor`에 비례하게
  변경 — `radius = round(8 * (upscale_factor-1) / (4-1))`, upscale_factor가 1이면
  (=크롭이 resize_shape보다 작아서 업스케일이 아예 없으면) radius도 0. 기준점(4배
  업스케일일 때 radius=8)은 기존에 검증한 값을 그대로 씀.
  **검증**: 같은 생일파티 사진 재테스트 → 고정 radius=8과 육안·수치(mean_abs_diff
  0.2827 vs 0.2817, 거의 동일) 모두 차이 없음을 확인 — 이 사진에서는 blur가 애초에
  화질에 기여를 안 하고 있었다는 뜻. 즉 **크롭이 resize_shape보다 작은 일반적인
  사진(얼굴이 사진 전체를 꽉 채우지 않는 대부분의 경우)에서는 화질 손해 없이 보호
  효과를 거의 100% 유지**할 수 있게 됨. "90%대 유지" 트레이드오프는 얼굴이 프레임을
  거의 다 채우는 클로즈업 사진(첫 테스트 이미지 같은 경우)에만 여전히 적용됨.

## 주의사항

- `server/faceshield-fal/faceshield_repo/model_ir_se50.pth`(167MB)와 나머지 대용량
  파일들(`ip-adapter_sd15.bin` 44MB, `FaceParser.pth` 53MB)은 **git에 커밋하지 말 것**
  — `.gitignore`에 `server/faceshield-fal/faceshield_repo/*.pth`,
  `server/faceshield-fal/faceshield_repo/**/*.bin` 추가 필요 (아직 안 해뒀음, 다음
  세션에서 커밋 전에 확인할 것)
- 이 기능은 원본 사진(마스킹 없음)을 외부 GPU 서버로 보낸다 — 기존 "AI 배경교체"와
  같은 프라이버시 예외 카테고리. 프론트에 붙일 때 반드시 동의 모달 필요
- Modal 요금은 GPU 사용 시간 기준 종량제 — 배포만 해두면 호출 전까진 비용 거의 없음
  (scaledown_window=180초로 설정해둠, 필요시 조정)
