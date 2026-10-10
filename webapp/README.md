# 바른생활 웹 버전 (체험판)

설치 없이 브라우저에서 바로 써 보는 버전입니다. 화면·판정 코드는 데스크톱 앱(`app/`)과 같은 파일을 씁니다.

| 파일 | 역할 |
|---|---|
| `bridge.js` | 데스크톱 앱 본체(`app/main.js`)가 하던 일을 브라우저 안에서 대신함. 화면 코드가 쓰는 `window.barun` 통로를 같은 이름으로 제공 |
| `index.html`, `web.css` | 웹 전용 페이지 틀: 페이지 안 캐릭터, 화면 흐림, 교정 유도 화면·셀프 체크 틀 |
| `build.mjs` | `app/renderer`, `app/shared` 를 `dist/` 로 모아 웹 사이트를 만듦 |
| `vercel.json` | Vercel 배포 설정(빌드 명령·출력 폴더) |

판정 후처리(`app/shared/core.js`)와 저장 로직(`app/shared/storecore.js`)은 앱과 웹이 함께 씁니다. 저장은 브라우저 localStorage, MediaPipe 는 CDN에서 받습니다.

## 실행

```bash
cd webapp
node build.mjs                 # dist/ 생성
cd dist && python3 -m http.server 5180   # http://localhost:5180 (카메라는 localhost·https 에서만 열림)
```

시험: `dist/` 에 정면 사진을 두고 `http://localhost:5180/?fake=사진.jpg` 로 열면 카메라 대신 사진을 씁니다.

## Vercel 배포

Root Directory `webapp`, Application Preset `Other`. 빌드 명령·출력 폴더는 `vercel.json` 에 있습니다.

## 데스크톱 앱과 다른 점

- 다른 앱 위에 항상 떠 있는 위젯: 크롬·엣지의 "작은 위젯 창"(Document Picture-in-Picture)으로만 가능
- 메뉴바 아이콘 대신 탭 제목·아이콘으로 상태 표시
- 화면 흐림·교정 유도 화면은 이 페이지 안에서만
- 기본 모드의 키보드·마우스 사용 감지는 이 페이지 안에서만
- 탭을 닫으면 분석이 멈춤. 기록은 이 브라우저에만 저장
