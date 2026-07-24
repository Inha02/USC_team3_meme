# facememe

웹캠 프리뷰를 노출하지 않고 표정을 계속 분석하다가, 60×60px 플로팅 버튼을 누른 순간의 표정으로 한국 짤을 추천하는 Electron 앱입니다. MediaPipe 추론은 렌더러에서, jalBot 검색과 파일 저장은 Electron 메인 프로세스에서 처리합니다.

## 먼저 확인할 edge-case

- 카메라 권한이 거부되거나 카메라가 다른 앱에서 사용 중이면 버튼이 회색 오류 상태가 됩니다.
- 얼굴 데이터가 한 프레임도 없으면 무표정으로 오판하지 않고 얼굴을 보여 달라는 안내를 표시합니다.
- 버튼을 누른 순간의 웹캠 프레임을 좌우 반전 JPEG로 캡처해 결과 창에서 표정과 함께 보여줍니다. 얼굴 이미지는 jalBot으로 전송하지 않습니다.
- 최근 5프레임을 먼저 평활화하고, 클릭 시점 직전 0.5초의 평활화 프레임을 다시 평균냅니다.
- 동시에 여러 규칙이 맞으면 JSON의 `priority`가 작은 규칙을 먼저 선택합니다. 현재 기본 설정은 웹캠 실측에 매우 민감하게 반응하도록 `>=`, 낮은 임계값, `minMatches`를 사용합니다. 놀람은 세 조건 중 두 개, 웃음·화남·울상은 좌우 또는 핵심 조건 중 하나만 통과해도 판정됩니다.
- MediaPipe GPU 초기화 실패 시 CPU로 재시도하며, 로컬 모델이 없으면 CDN 모델로 재시도합니다.
- jalBot 네트워크 오류, 빈 검색 결과, 이미지 조회·합성 실패 시 `assets/fallback`의 로컬 JPEG를 사용합니다.
- 생성 중 재클릭과 결과 창의 연속 요청은 잠급니다. 버튼 드래그는 클릭으로 처리하지 않습니다.
- 외부 이미지는 15초 타임아웃과 15MB 제한을 적용한 뒤 사용자가 고른 경로에 저장합니다.

## 설치와 실행

Node.js 20 이상을 권장합니다.

```bash
npm install
npm run prepare:assets
npm run dev
```

`prepare:assets`는 폴백 JPEG 5장을 만들고 MediaPipe WASM과 모델을 로컬에 준비합니다. 모델 다운로드가 실패해도 앱은 실행 시 CDN으로 재시도합니다. macOS는 최초 실행 때 시스템 설정의 카메라 권한을 허용해야 합니다.

jalBot 검색에는 별도의 API 키나 `.env` 설정이 필요하지 않습니다.

## 단계별 구현과 실행 확인

### 1. Electron 기본 창

관련 파일은 `electron/main.js`, `electron/preload.cjs`, `src/main.jsx`입니다. 메인 프로세스가 투명·항상 위·크기 고정 플로팅 창을 만들고, 결과 창은 처음 생성이 끝날 때 지연 생성합니다.

```bash
npm install
npm run dev
```

우측 하단에 원형 버튼이 보이고 드래그로 모니터 작업 영역 안에서 이동하면 정상입니다.

### 2. 웹캠과 FaceLandmarker

`src/hooks/useFaceLandmarker.js`가 숨긴 `<video>`에서 프레임을 읽고 `runningMode: "VIDEO"`, `outputFaceBlendshapes: true`로 FaceLandmarker를 실행합니다.

얼굴이 처음 감지된 약 45프레임 동안 랜드마크 `107/336`의 눈썹 안쪽 거리와
`33/263`의 눈 너비를 이용해 사용자 기준 거리를 보정합니다. 이후 정규화된
`browInnerDistanceDelta`를 화남·울상 구분에 함께 사용합니다.

```bash
npm run prepare:assets
npm run dev
```

개발자 도구 콘솔의 `blendshape` 객체에서 52종 점수를 확인할 수 있습니다. 프리뷰 영상은 화면에 표시되지 않습니다.

`npm run dev`를 실행한 터미널에는 버튼을 눌러 사진을 캡처한 순간에만 최근
0.5초 blendshape 평균과 최종 카테고리가 `[표정 인식] 클릭 스냅샷 → 판정`으로
출력됩니다.
판정되지 않은 규칙은 `[표정 인식] 미충족 조건` 로그에서 원인이 된 shape를 확인할
수 있습니다. `optionalConditions`는 진단용 보조 지표이며 필수 판정 조건은 아닙니다.

### 3. 규칙 기반 분류기

임계값과 우선순위는 `public/config/expressionRules.json`, 순수 분류 로직은 `src/classifier/classifier.js`에 있습니다. 튜닝할 때 JSON만 수정하면 Vite 개발 서버가 반영합니다.

```bash
npm test
```

우선순위 충돌, 경계값, 누락 shape, 평균, 0.5초 윈도우 테스트가 실행됩니다.

### 4. 클릭 스냅샷과 결과 창

`src/ui/FloatingApp.jsx`가 포인터를 놓는 순간 blendshape 버퍼와 웹캠 프레임을 함께 캡처하고 분류한 뒤 제한된 IPC를 호출합니다. 메인 프로세스는 결과 창을 열어 캡처된 표정과 최신 밈 결과를 전달합니다.

### 5. jalBot API

`src/services/jjalbotService.js`가 앱 시작 시 각 표정에 맞는 한국어 검색어로
`GET https://api.jjalbot.com/jjals`를 호출합니다. `nsfw=false`를 고정하고
GIF, `videoUrl`이 있는 움직이는 짤, 비디오와 유효하지 않은 이미지 URL을
제거하고 JPEG·PNG·정적 WebP만 남긴 뒤, 중복 제거 및 조회수 정렬을
수행합니다. 실행 중에는 표정별 후보를 `jjalBotMap.json`으로 캐시하며 캡처와
다시 생성 때 라운드로빈으로 순환합니다. 앱이 완전히 종료되면 검색 캐시는
자동 삭제되어 다음 실행 때 새로 검색합니다.

선택한 jalBot 정적 이미지는 가공하거나 캡션을 추가하지 않고 원본 URL을
그대로 미리보기에 사용합니다. jalBot 검색 API에는 별도의 API 키가 필요하지 않습니다.

`npm run dev` 터미널에는 `[jalBot]` 접두어로 검색 키워드, 결과 수, 캐시 위치,
카테고리별 후보 개수, 순환 순번, 이미지 URL과 폴백 이유가 출력됩니다.

### 6. 결과 UI와 다운로드

`src/ui/ResultApp.jsx`에 미리보기, 다운로드, 다시 생성, 닫기 버튼이 있습니다. 다운로드는 preload IPC를 거쳐 메인 프로세스의 `dialog.showSaveDialog`와 파일 쓰기로만 수행됩니다.

### 7. 전체 검증

```bash
npm test
npm run lint
npm run build
npm run dev
```

## 통합 테스트 시나리오

1. 앱을 실행하고 카메라를 허용합니다. 얼굴을 보인 뒤 버튼을 누르면 jalBot 원본 짤이 결과 창에 나와야 합니다.
2. 얼굴을 화면 밖으로 옮기고 앱을 재시작한 직후 누릅니다. API를 호출하지 않고 얼굴 안내만 보여야 합니다.
3. 눈을 크게 뜨고 입을 벌린 채 누릅니다. `surprised`가 웃음보다 우선해야 합니다.
4. 버튼을 여러 번 빠르게 누릅니다. 하나의 생성 요청만 진행되어야 합니다.
5. 버튼을 화면 모서리로 드래그합니다. 작업 영역 밖으로 사라지지 않아야 하며 결과 창이 열리지 않아야 합니다.
6. 네트워크를 끊고 실행합니다. 앱이 중단되지 않고 로컬 JPEG와 경고가 보여야 합니다.
7. 네트워크를 연결하고 실행합니다. `[jalBot]` 검색 결과와 선택된 짤 URL이 보여야 합니다.
8. 다운로드를 누르고 취소합니다. 오류 문구 없이 결과 창이 유지되어야 합니다.
9. 네트워크를 끊고 다시 생성을 누릅니다. 로컬 폴백 결과로 복구되어야 합니다.

## 주요 구조

```text
electron/                 메인 프로세스와 안전한 IPC
src/classifier/           프레임 평균과 우선순위 분류
src/hooks/                MediaPipe·웹캠 분석 루프
src/services/             jalBot 검색·순환 모듈
src/ui/                   플로팅 버튼·결과 팝업 React UI
public/config/            조정 가능한 표정 규칙
assets/fallback/          카테고리별 로컬 JPEG
tests/                    분류기 단위 테스트
```

jalBot 검색 결과는 Electron 사용자 데이터 폴더의 `jjalBotMap.json`에 24시간 캐시됩니다.
