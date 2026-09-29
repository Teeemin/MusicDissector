# Music Dissector · Phase 3

React + TypeScript + Vite 기반의 모바일 우선 로컬 음악 플레이어입니다. 기존 Vite 프로젝트를 이어서 구현했습니다.

## 구현 범위

- MP3 / WAV / FLAC / M4A 파일 선택과 drag & drop
- 재생 / 일시 정지, seek, 현재 시간 / 전체 시간, ±10초 이동, 음량 / 음소거
- 파일 이름, 확장자, 크기 표시와 손상되거나 지원하지 않는 파일의 오류 안내
- 좁은 화면의 1열, 700px 이상 넓은 화면의 2열 레이아웃
- 키보드 조작, 컨트롤 접근성 이름, 터치 영역, safe area, 모션 감소 설정 지원
- PWA manifest, standalone, PNG 앱 아이콘, maskable 아이콘, 설치 버튼 / 안내
- service worker를 통한 앱 화면의 오프라인 실행, 새 버전 수동 적용 안내
- Title / Artist / Album / Duration / Album artwork 읽기, 제목이 없으면 파일명 사용
- 내장 SYLT / LRC / 일반 가사 구분 및 표시
- 시간 가사의 현재 줄 강조, 줄 클릭 seek, 자동 스크롤과 Follow

**Phase 3까지만 구현했습니다.** 6개 stem의 믹서 설정과 mock 구조를 추가했습니다. 실제 stem separation, BPM / beat / Key / chord 분석, AI 가사 동기화, 서버 연동, export는 구현하지 않았습니다. 기존 파일 선택 / 재생 / seek / 볼륨 / PWA / metadata / artwork / 가사와 헤더는 유지합니다.

## Phase 3: Stem Mixer

기존 가사 아래에 믹서 영역을 추가했습니다. 700px 미만에서는 채널이 한 열, 넓은 화면에서는 두 열로 표시됩니다. 각 채널은 볼륨 0~100%, Mute, Solo를 가지며 터치 컨트롤 높이는 최소 44px입니다. `재생기로 이동` 링크로 기존 곡 정보와 transport에 복귀할 수 있습니다.

**현재 믹서는 설정 미리보기입니다.** 실제로 들리는 것은 기존 AudioEngine의 원본 음원입니다. MockStemSeparationEngine은 음원을 읽거나 복제하지 않고, 6개의 `null` source와 `processed: false`를 반환합니다. AI 실행이나 가짜 진행률이 없으며, 믹서 설정은 원본 재생 볼륨 / mute / seek에 영향을 주지 않습니다. 이 사실을 믹서 상단에 표시합니다.

- 고정 채널: Vocals / Guitar / Piano / Drums / Bass / Others.
- 볼륨은 선형 gain 0~1로 저장하며 UI는 0~100%로 표시합니다. 원본 플레이어의 볼륨과 별개입니다.
- 하나라도 Solo가 있으면 Solo 채널만 포함합니다. 여러 Solo를 동시에 켤 수 있습니다.
- **Mute가 Solo보다 우선합니다.** Solo이면서 Mute인 채널은 제외합니다. 유일한 Solo 채널이 Mute라면 모든 채널의 설정 gain은 0입니다.
- Original: 모든 볼륨 100%, Mute / Solo 해제.
- Vocal Only: 초기화 후 Vocals만 Solo.
- No Vocal / No Guitar / No Piano: 초기화 후 해당 채널만 Mute.
- 모든 프리셋은 이전 볼륨 / Mute / Solo를 먼저 초기화하여 결과가 일관됩니다. 이후 개별 조절이 가능하며, 값이 프리셋과 달라지면 버튼 강조가 해제됩니다.
- 유효한 새 파일이나 같은 파일을 다시 선택하면 모든 채널을 초기화하고 이전 mock 작업을 취소합니다. 잘못된 확장자 / 빈 파일 선택은 현재 재생 및 믹서 상태를 유지합니다. 늦게 도착한 이전 작업 결과 / 오류도 무시합니다.

### Phase 3 구조와 변경 파일

| 구분 | 파일 | 역할 |
| --- | --- | --- |
| 생성 | `src/separation/StemSeparationEngine.ts` | 취소 신호를 받는 separation 인터페이스, 6개 source를 갖는 mock / separated 결과 타입 |
| 생성 | `src/separation/MockStemSeparationEngine.ts` | source가 전부 null인 즉시 mock 결과 |
| 생성 | `src/mixer/mixerTypes.ts`, `mixerRules.ts` | 채널 타입, source / loading / error 확장점, Mute / Solo gain 규칙, 프리셋 |
| 생성 | `src/mixer/mixerStore.ts`, `useMixer.ts` | 독립 외부 store와 React 구독, 파일 교체 / 취소 / 초기화 |
| 생성 | `src/audio/StemMixPlan.ts` | 미래 backend용 source / gain 계획 및 공통 clock 시작 시점 계약 |
| 생성 | `src/components/StemMixer.tsx`, `StemChannel.tsx`, `MixerPresets.tsx`, `StemMixer.css` | 믹서 영역과 반응형 채널 UI |
| 수정 | `src/audio/AudioEngine.ts` | 유효한 파일 선택 시 mixer 초기화, dispose 시 정리만 연결 |
| 수정 | `src/App.tsx` | 믹서 컴포넌트 추가 |
| 생성 | `tests/mixer.spec.ts`, `tests/phase3.spec.ts` | 규칙 / 상태 / 경쟁 조건 및 브라우저 통합 테스트 |
| 수정 | `README.md` | Phase 3 동작, 범위, 구조, 확인 방법 |

새 package는 설치하지 않았습니다. Phase 1 / Phase 2 테스트 파일도 수정하지 않았습니다.

실제 buffer는 미래에 `StemAudioSource`로 전달하도록 타입을 분리했습니다. `createStemMixPlan()`은 채널별 source / gain을 계산하는 순수 함수입니다. `SharedStemStart`는 하나의 AudioContext clock 시점과 원본 타임라인 offset을 정의합니다. Phase 6 backend에서 모든 AudioBufferSourceNode를 동일한 `contextTime` / `offsetSeconds`로 시작하고 각 GainNode로 연결하는 구조를 위한 계약이며, 현재 이 backend나 sample-accurate stem 재생을 구현한 것은 아닙니다. 현재 AudioEngine의 단일 HTMLAudioElement 및 재생 경로는 그대로입니다.

## Phase 2 동작과 의존성

새 런타임 의존성은 **`music-metadata@11.16.1`** (`package.json`: `^11.16.1`, lockfile에 설치 버전 고정)입니다. [공식 프로젝트](https://github.com/Borewit/music-metadata)의 브라우저 `parseBlob(File)` API, 내장 TypeScript 타입, MP3 / WAV / FLAC / M4A 및 ID3 / Vorbis / MP4 태그 지원을 사용합니다. 오래된 별도 `music-metadata-browser` 패키지나 Node 전용 `parseFile()`은 사용하지 않습니다.

- 파일은 서버로 보내지 않으며 별도 Web Worker에서 태그를 읽습니다. 파서 Worker도 앱 shell과 함께 오프라인 캐시됩니다. 음원과 태그 결과는 영구 저장하지 않습니다.
- 파일을 교체하면 이전 Worker를 종료하고, artwork Object URL을 해제합니다. 선택 ID와 AbortSignal로 늦게 도착한 이전 결과를 무시합니다. 제목 / 가수 / 앨범 / 가사 / 스크롤 / Follow 상태를 새 곡 기준으로 초기화합니다.
- 메타데이터 읽기가 실패하거나 30초 안에 끝나지 않으면 파일명과 안내를 사용합니다. 기존 AudioEngine의 재생 가능 여부와는 별개이며 재생 / seek를 막지 않습니다.
- 파서가 제공하는 duration을 저장하며, 재생기의 실제 duration과 currentTime은 기존 HTMLAudioElement가 계속 관리합니다. 긴 MP3의 길이를 얻기 위해 파일 전체를 추가로 스캔하지 않습니다.
- 가사 우선순위는 사용할 수 있는 SYLT → LRC → 일반 가사입니다. 여러 언어가 있으면 해당 우선순위에서 첫 항목을 선택합니다.
- SYLT의 밀리초 timestamp를 초로 변환합니다. 명시적 줄바꿈이 있는 syllable 조각은 줄 단위로 묶습니다. MPEG 프레임 번호 기반 SYLT는 정확한 시간 변환을 추측하지 않고 일반 가사로 표시합니다.
- LRC는 여러 timestamp, 소수 초, 정렬, 같은 시간의 번역 줄, 빈 구간과 offset을 처리합니다. 양수 offset은 가사를 앞당깁니다. 일부 줄에 시간이 없으면 해당 줄은 별도 일반 텍스트로 보존합니다.
- 시간 없는 가사에는 timestamp나 클릭 seek를 만들지 않습니다. `동기화 정보 없음`으로 표시합니다. 가사가 없으면 `내장 가사가 없습니다`로 표시합니다.
- 현재 줄은 playback state로 찾습니다. 자동 스크롤은 가사 패널 내부만 움직입니다. 휠 / 터치 / 스크롤바 / 키보드로 직접 읽으면 Follow가 멈추며, **Follow**를 누를 때 다시 따라갑니다. 곡의 실제 길이를 넘어서는 timestamp의 seek는 비활성화됩니다.

### Phase 2 생성 / 수정 파일

| 구분 | 파일 | 내용 |
| --- | --- | --- |
| 생성 | `src/metadata/MetadataReader.ts`, `metadata.worker.ts`, `extractMetadata.ts`, `types.ts` | 취소 가능한 Worker, 태그 / 이미지 / 가사 추출과 메시지 타입 |
| 생성 | `src/lyrics/LyricsParser.ts`, `types.ts`, `useLyricsFollow.ts` | 가사 형식 구분, 타임라인 정규화, 현재 줄 탐색, Follow |
| 생성 | `src/components/LyricsPanel.tsx`, `LyricsPanel.css`, `TrackArtwork.tsx` | 가사 패널, 모바일 스타일, 이미지 오류 fallback |
| 수정 | `src/audio/AudioEngine.ts`, `src/types/audio.ts` | 기존 엔진에 메타데이터 상태 / 작업 취소 / artwork 정리 연결 |
| 수정 | `src/components/Player.tsx`, `src/App.tsx` | 실제 태그 제목 / 가수 / 앨범 / artwork 표시, 가사 패널 배치 |
| 수정 | `package.json`, `package-lock.json`, `README.md` | 파서 설치와 사용 / 검증 문서 |
| 생성 | `tests/lyrics-parser.spec.ts`, `tests/phase2.spec.ts`, `tests/fixtures/*`, `scripts/generate-audio-fixtures.mjs` | 파서 및 실제 태그 / 재생 통합 검증, 합성 테스트 음원 |

기존 `tests/phase1.spec.ts`는 수정하지 않았습니다. FFmpeg는 테스트 음원 생성 시에만 임시 도구로 사용했으며 앱 의존성에 추가하지 않았습니다. 테스트는 포함된 합성 음원을 사용하므로 FFmpeg 설치 없이 실행할 수 있습니다.

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
9. `tests/fixtures/tagged.flac` 또는 `tagged.m4a`를 선택하면 테스트 제목 / 가수 / 앨범 / artwork와 LRC 가사가 표시됩니다. 첫 줄은 1초, 둘째 줄은 4초이며 클릭으로 이동할 수 있습니다.
10. 시간 가사를 직접 스크롤한 뒤 **Follow**로 현재 줄에 복귀하는지 확인합니다. 일반 embedded lyrics 파일에서는 원문이 표시되며 클릭해도 재생 위치가 바뀌지 않습니다. 가사 없는 파일도 오류 없이 사용할 수 있습니다.
11. 다른 곡으로 교체해 이전 태그 / 이미지 / 가사가 남지 않는지 확인합니다. Fold7에서 파일을 열고 접거나 펼쳐 가사 패널과 재생 컨트롤을 확인하세요.
12. Stem Mixer에서 개별 볼륨, Mute / Solo, 여러 Solo, 5개 프리셋을 조작하세요. 원본 소리는 계속 그대로 재생되어야 합니다. 다른 곡을 선택하면 모든 채널이 100% / Mute 해제 / Solo 해제로 돌아갑니다.

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

Phase 2 검증에서는 실제 MP3 / WAV / FLAC / M4A의 내장 태그를 읽고, title / artist / album / duration / artwork, SYLT와 LRC 우선순위, 일반 가사 / 없는 가사, seek와 현재 줄, Follow 중지 / 재개, 늦은 이전 결과 차단, artwork URL 해제, 이미지 오류 fallback, 오프라인 Worker, 320 / 412 / 800px 화면을 확인합니다. `tests/lyrics-parser.spec.ts`는 가사 정규화의 경계 조건을 별도로 검사합니다.

Phase 3 테스트는 6개 채널, 볼륨 범위, Mute 우선 규칙, Solo / multi-solo, 모든 프리셋과 이후 개별 조절, 새 파일 초기화, 취소 및 늦은 결과, 오류 복구, 320 / 412 / 800px 화면과 터치 크기, 모바일 조작 / 화면 펼침, 오프라인 사용을 검증합니다. 실제 Audio 생성 수가 1개이고 추가 buffer source가 0개이며, 모든 채널을 Mute해도 원본의 재생 / 볼륨 / 음소거가 바뀌지 않는지도 검사합니다.

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

파일을 통째로 AudioBuffer로 디코딩하지 않아 긴 음악을 위한 메모리 복사를 피합니다. 파일 교체 시 이전 Object URL을 해제하고 재생을 멈춥니다. 비동기 play가 진행 중일 때 파일이 바뀌면 이전 작업의 결과는 무시합니다. 메타데이터와 가사도 같은 AudioEngine 및 playback state에 연결되어 있으며, 두 번째 재생 엔진은 없습니다. Phase 4 이후 개발은 별도 요청에 따라 진행합니다.
