# 바른생활 앱 (초안)

웹캠으로 자세를 분석하고, 화면 구석의 동물 위젯이 내 자세를 따라 하는 데스크톱 앱입니다.
화면 구성은 `design/barun-ui-standalone.html`(기현 디자인) S1~S12를 따릅니다.

## 실행

```bash
# 1) 저장소 루트에서 MediaPipe 모델 받기(처음 한 번). models/ 는 Git에 올리지 않음
mkdir -p models && for v in lite full heavy; do curl -sfL -o models/pose_landmarker_$v.task \
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_$v/float16/latest/pose_landmarker_$v.task"; done

# 2) 앱 실행
cd app
npm install
npm start
```

처음 실행하면 모드 선택(S1) → 기준 자세 측정(S2, 10초) → 캐릭터 선택 순서로 진행합니다.
맥은 처음에 카메라 권한을 물어봅니다(시스템 설정 → 개인정보 보호 및 보안 → 카메라).

## 구조

| 파일 | 역할 | 디자인 |
|---|---|---|
| `main.js` | 앱 본체: 창·메뉴바, 단계적 개입(3초 노랑 → 10초 빨강+알림 → 화면 흐림 → 교정 유도 화면), 오래 앉음, 기본 모드 셀프 체크 | S7, S9, S10 |
| `renderer/analyzer.*` | 숨은 분석 창: 웹캠 → MediaPipe → 판정, 초당 8회. 영상은 저장·전송하지 않음 | – |
| `renderer/index.html`, `app.js` | 메인 창: 온보딩, 홈, 리포트, 스트레칭, 설정 | S1~S6 |
| `renderer/widget.*` | 데스크톱 위젯: 끌어서 이동(위치 기억), 클릭하면 메뉴 | S7, S8 |
| `renderer/critter.js` | 캐릭터 그림(동물 5종 × 자세 9종). 디자인의 Critter 컴포넌트를 옮긴 것 | S8 |
| `renderer/lock.*` | 교정 유도 화면: 바른 자세 3초 → 문장 입력, 비상 해제 | S11 |
| `renderer/overlay.html` | 화면 흐림 | S10 ③ |
| `renderer/selfcheck.html` | 기본 모드 셀프 체크 | S12 |
| `shared/rules.js` | 판정 규칙. `scripts/front_rules.py`, `posture_rules.py` 와 같아야 함 | – |
| `shared/stretches.js` | 스트레칭 목록과 카메라 동작 확인 규칙 | S5 |
| `store.js` | 설정·기준 자세·기록 저장(앱 데이터 폴더의 `barun-data.json`) | – |

## 판정 규칙을 고칠 때

파이썬(`scripts/front_rules.py`)과 JS(`app/shared/rules.js`)를 함께 고치고 결과가 같은지 확인합니다.

```bash
.venv/bin/python scripts/export_parity.py   # 저장소 루트에서
cd app && npm test                           # 불일치 0개여야 함
```

## 시험 모드(카메라 없이)

사진을 카메라 대신 넣고 S1~S12 화면을 자동으로 캡처합니다. 창은 화면에 띄우지 않습니다.

```bash
JASAI_FAKE_IMAGE=정면사진.jpg JASAI_SHOTS=/tmp/shots JASAI_USERDATA=/tmp/barun-test JASAI_SEED=1 npx electron .
```

- `JASAI_SEED=1`: 리포트를 미리 볼 수 있게 지난 2주 가짜 기록을 만듭니다(시험용 데이터 폴더에서만 쓰세요)
- `JASAI_DEBUG=1`: 각 창의 콘솔 오류를 터미널에 출력

## 초안에서 아직 안 된 것

- 화상회의·전체 화면 자동 감지(지금은 메뉴바의 "회의 중"으로 직접 멈춤)
- 정밀 모드는 CVA 규칙만 사용(측면 RF 모델은 ONNX 변환 후 연결 예정)
- 기록 저장은 JSON 파일(기록이 길어지면 SQLite로)
- 맥 알림의 버튼(스트레칭 보기 등)은 서명된 앱에서만 동작
- 배포 파일(.dmg, 윈도우 설치 파일) 만들기
