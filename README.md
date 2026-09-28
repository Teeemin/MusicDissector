# StemLab · Phase 1

React + TypeScript + Vite 기반의 모바일 우선 로컬 음악 플레이어입니다. 기존 Vite 프로젝트를 이어서 구현했습니다.

## 구현 범위

- MP3 / WAV / FLAC / M4A 파일 선택과 drag & drop
- 재생 / 일시 정지, seek, 현재 시간 / 전체 시간, ±10초 이동, 음량 / 음소거
- 파일 이름, 확장자, 크기 표시와 손상되거나 지원하지 않는 파일의 오류 안내
- 좁은 화면의 1열, 700px 이상 넓은 화면의 2열 레이아웃
- 키보드 조작, 컨트롤 접근성 이름, 터치 영역, safe area, 모션 감소 설정 지원
- PWA manifest, standalone, PNG 앱 아이콘, maskable 아이콘, 설치 버튼 / 안내
- service worker를 통한 앱 화면의 오프라인 실행, 새 버전 수동 적용 안내

**Phase 2 이상은 구현하지 않았습니다.** 태그 메타데이터, 앨범 아트, 가사, 믹서, stem separation, BPM / Key / chord 분석, IndexedDB 분석 캐시, export는 포함하지 않습니다. 화면 제목은 파일 이름이며, 레코드 그림은 장식입니다. seek는 실제 오디오의 시간 정보를 사용합니다.

## 실행 명령어

Node.js 24 환경에서 검증했습니다. Windows의 VS Code 터미널에서도 아래 명령을 사용할 수 있습니다. 프로젝트 상위 폴더에서 시작한다면 먼저 `cd "Music dissector"`를 실행하세요. 폴더 이름에 공백이 있으므로 따옴표를 포함해야 합니다.

```sh
npm ci
npm run dev
```

터미널에 표시된 개발 주소(기본 `http://localhost:5173`)에 접속합니다. 개발 모드에서는 service worker를 등록하지 않습니다.

폴더 이름을 바꿀 때는 기존 개발 서버를 실행한 터미널에서 `Ctrl+C`로 종료한 다음, 새 폴더에서 `npm run dev`를 다시 실행하세요. 서버를 켜 둔 채 폴더 이름을 바꾸면 이전 경로를 참조해 404가 발생할 수 있습니다. 개발 포트는 5173으로 고정했으며, 이미 사용 중이면 다른 포트로 넘어가는 대신 오류를 표시합니다. 이 경우 기존 서버를 먼저 종료하세요.

### PWA 빌드 확인

```sh
npm run build
npm run preview -- --host 0.0.0.0
```

PC에서는 `http://localhost:4173`으로 확인합니다. `dist/`가 HTTPS 정적 호스팅에 배포할 결과물입니다. 기본 설정은 도메인의 루트 경로(`/`)에 배포하는 구성입니다.

휴대폰에서 `http://PC의-IP:4173`으로 접속하면 일반 UI 확인은 가능하지만, PWA 설치와 service worker 확인에는 **HTTPS 주소**가 필요합니다. localhost 예외는 접속하는 기기 자체의 localhost에만 적용됩니다. HTTPS 정적 호스팅에 `dist/`를 배포한 뒤 Galaxy Chrome에서 접속하세요. 실제 배포는 이 작업에 포함하지 않았습니다.

PWA의 설치 요건은 [MDN의 설치 가이드](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)를 참고하세요. service worker는 [Vite PWA의 prompt 전략](https://vite-pwa-org.netlify.app/guide/prompt-for-update)으로 등록하여 재생 도중 새 버전이 강제로 적용되지 않게 했습니다.

## 직접 확인하는 순서

1. MP3 / WAV / FLAC / M4A 음악 하나를 선택합니다. 제목, 파일 크기, 전체 시간이 나오는지 확인합니다. 각 확장자의 실제 재생 가능 여부는 파일 코덱과 브라우저에 따라 다릅니다.
2. 재생 / 일시 정지, seek 드래그, ±10초 이동, 음량 / 음소거를 확인합니다. 파일을 선택하는 것만으로 자동 재생하지 않습니다.
3. 재생 중 다른 파일을 선택해 기존 재생이 멈추고 새 파일이 0초에서 준비되는지 확인합니다. 같은 파일도 다시 선택할 수 있습니다.
4. 빈 파일, 지원하지 않는 확장자, 손상된 음악 파일의 안내를 확인합니다. 잘못된 확장자와 빈 파일은 현재 음악을 중단하지 않습니다.
5. 개발자 도구의 화면 크기를 320px / 412px / 800px로 바꿔 가로 스크롤 없이 사용할 수 있는지 확인합니다. Fold7에서도 접고 펼쳐 확인하세요.
6. 프로덕션 미리보기에서 Chrome DevTools → Application → Manifest의 아이콘과 Service Workers의 활성 상태를 확인합니다.
7. HTTPS 주소로 Galaxy Chrome에 접속해 상단 **앱 설치** 또는 Chrome 메뉴의 **홈 화면에 추가 → 설치**를 사용합니다. 설치 안내는 브라우저의 지원과 이미 설치되었는지에 따라 달라집니다.
8. 온라인 상태에서 앱을 한 번 열고 **오프라인 사용 준비 완료** 안내를 확인합니다. 필요하면 새로고침하여 service worker가 페이지를 제어하는지 확인합니다. 이후 비행기 모드에서 앱을 다시 열어 기기의 파일을 선택하고 재생합니다.

음악은 서버에 업로드하지 않으며 브라우저 캐시에도 저장하지 않습니다. 앱을 새로 열거나 새로고침하면 파일을 다시 선택해야 합니다. 오프라인 기능은 앱 화면과 코드의 캐시이며, 브라우저에서 사이트 데이터를 지우면 다시 온라인 접속이 필요합니다.

## 자동 검증

```sh
npm run lint
npx playwright install chromium
npm run test:e2e
```

Linux에서 브라우저 시스템 라이브러리가 없다면 `npx playwright install --with-deps chromium`이 필요할 수 있습니다.

Playwright는 실제 프로덕션 빌드를 생성하고 4173 포트에서 미리보기를 실행합니다. 해당 포트는 비워 두세요. 테스트에서 생성한 실제 PCM WAV로 재생 / seek / 음량 / 끝까지 재생 / 재시작, 파일 교체와 URL 해제, drag & drop, 오류 복구, 좁고 넓은 화면, 설치 안내, Chrome 설치 요건, 아이콘 크기, 오프라인 새로고침 후 로컬 재생을 검증합니다. 모바일 에뮬레이션에서는 터치 재생 / seek, Web Audio의 실제 오디오 신호, 화면 너비 변경 시 재생 위치 유지도 확인합니다. 브라우저의 재생 상태를 mock하지 않습니다. 실패 시 trace와 반응형 스크린샷은 `test-results/`에 기록됩니다.

이 자동 검증은 Chromium 기반이며, Galaxy Fold7 실기기의 설치 및 운영체제의 파일 선택기는 위 수동 순서로 확인해야 합니다.

## 생성 / 수정 파일

| 경로 | 역할 |
| --- | --- |
| `src/App.tsx`, `src/App.css`, `src/index.css` | 전체 화면과 모바일 반응형 스타일 (기존 템플릿 교체) |
| `src/components/FilePicker.tsx` | 파일 선택, drop, 선택 오류, 파일 정보 |
| `src/components/Player.tsx` | 재생 / seek / 음량 컨트롤과 장식 레코드 |
| `src/components/PwaControls.tsx` | 설치, 오프라인 완료, 업데이트 안내 |
| `src/components/Icon.tsx` | 자체 SVG 아이콘 |
| `src/audio/AudioEngine.ts` | 한 개의 HTMLAudioElement와 Web Audio 출력, 파일 URL 수명 관리 |
| `src/stores/playbackStore.ts` | useSyncExternalStore 기반 공유 playback state |
| `src/hooks/useInstall.ts` | 브라우저 설치 이벤트와 standalone 상태 |
| `src/types/audio.ts`, `src/utils/format.ts` | 타입과 시간 / 용량 표시 |
| `src/vite-env.d.ts` | Vite PWA 가상 모듈 타입 |
| `vite.config.ts`, `index.html` | manifest 생성, service worker, 한국어와 PWA 문서 설정 |
| `public/favicon.svg`, `public/icons/*.png` | 192 / 512 / maskable / Apple 앱 아이콘 |
| `scripts/generate-icons.mjs` | 외부 의존성 없이 PNG 아이콘 재생성 (`npm run icons`) |
| `playwright.config.ts`, `tests/phase1.spec.ts` | 실제 브라우저 기능 검증 |
| `package.json`, `package-lock.json`, `.gitignore`, `README.md` | 의존성, 실행 명령, 검증 안내 |

기본 템플릿의 미사용 React / Vite 이미지와 `public/icons.svg`는 제거했습니다. `src/main.tsx`는 기존 StrictMode 진입점을 유지합니다. 후속 Phase용 빈 서비스나 mock 기능은 만들지 않았습니다.

## 오디오 구조

한 곡의 재생 시간은 HTMLAudioElement 하나가 관리하며, 전역 snapshot을 React 컴포넌트에서 구독합니다. 재생 버튼의 사용자 동작 안에서 AudioContext를 생성 / resume하고 `MediaElementAudioSourceNode → destination`으로 연결합니다. Web Audio API가 없는 브라우저는 HTMLAudioElement 기본 출력으로 재생합니다.

파일을 통째로 AudioBuffer로 디코딩하지 않아 긴 음악을 위한 메모리 복사를 피합니다. 파일 교체 시 이전 Object URL을 해제하고 재생을 멈춥니다. 비동기 play가 진행 중일 때 파일이 바뀌면 이전 작업의 결과는 무시합니다. 이후 개발은 Phase 1을 확인한 다음 별도 요청에 따라 진행합니다.
