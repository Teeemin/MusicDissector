# Music Dissector · Phase 6

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
- 내장 USLT / SYLT / LRC 가사를 정적 텍스트로 표시하는 접이식 패널 (기본 닫힘)
- BPM / beat 분석, 실제 AI 6-stem 분리와 믹서

**Phase 6까지 구현한 앱의 배포 전 UI/UX 정리 상태입니다.** Key / Chord 분석과 재생 연동 가사는 제거했습니다. 사용자 확인상 BS-RoFormer 실제 분리는 정상 동작하며 `phase6-stable` 태그가 기존 기준점입니다. 이후 반영된 6분 길이 제한 및 믹서 조작 시 Stem Mix 전환도 유지합니다. 이번 작업에서 모델, 추론, DSP, 청크, 모델 OPFS cache, 믹서 gain 계산은 변경하지 않았습니다. 배포나 다음 Phase 구현은 포함하지 않습니다.

## Phase 6: 실제 AI Stem Separation

1. HTTPS 또는 localhost의 WebGPU 지원 Chrome에서 음원을 선택합니다.
2. **모델 다운로드**를 눌러 최초 한 번 모델을 기기에 저장합니다. 자동으로 모델을 받거나 음악을 업로드하지 않습니다.
3. **분리 시작**을 누릅니다. 기존 BPM 자동 분석이 진행 중이면 먼저 끝나기를 기다립니다. 모델 로드, 오디오 준비, 청크 추론, 결과 준비를 구분하며 다운로드는 실제 수신 bytes, 분리는 완료 청크 수를 표시합니다. 첫 청크의 shader compilation이 오래 걸릴 수 있으며 가짜 진행률을 만들지 않습니다.
4. 완료 후 플레이어의 **Original / Stem Mix**로 같은 위치에서 A/B 비교합니다. Original은 원본 그대로, Stem Mix는 실제 여섯 결과 버퍼입니다. Stem Mix에서 볼륨, Mute, Solo/multi-solo, 기존 5개 프리셋이 실제 소리에 적용됩니다. 믹서의 Original 프리셋은 모든 stem 설정 초기화이며 플레이어의 원본 소스 선택과 구분됩니다.
5. **Guitar Solo**, **No Guitar**, Guitar 볼륨으로 기타 분리/감쇠를 확인합니다. 새 파일을 선택하면 이전 작업, 결과와 믹서 설정이 초기화됩니다. 명시적으로 저장하지 않은 음원과 stem은 새로고침 시 다시 선택/분리해야 합니다. 저장한 프로젝트는 아래 로컬 프로젝트 목록에서 복원할 수 있습니다.

분리 후 Original을 듣는 상태에서 채널 볼륨 / Mute / Solo / 프리셋을 조작하면 **같은 위치의 Stem Mix로 자동 전환**해 설정을 바로 들을 수 있습니다. 일시 정지 상태에서는 소스만 전환하고 재생은 시작하지 않습니다. 믹서 안내에 현재 소스를 표시하며 **Stem Mix로 듣기** 버튼도 제공합니다. 분리 전에는 채널 설정 동작을 유지합니다. 원본 A/B 비교는 재생기의 Original 버튼으로 선택합니다.

### 모델과 런타임

- 참고 구현: [elicwhite/bs-roformer-web](https://github.com/elicwhite/bs-roformer-web), 검토 commit `c6047cd28c41f803339e9b8a5775a56932de7157`. JS STFT/iSTFT와 radix-2 FFT를 타입화하여 재사용하고 iSTFT의 잘못 지워지던 conjugate bin을 수정했습니다. 별도 왕복 복원 테스트로 확인합니다.
- 모델: [BS-RoFormer-SW 6-stem FP16 ONNX](https://huggingface.co/elicwhite/bs-roformer-sw-6stem-onnx). [고정 revision 다운로드 URL](https://huggingface.co/elicwhite/bs-roformer-sw-6stem-onnx/resolve/a744f80957374e1735ad70fa122670b7961da8cc/bs_roformer_sw_6stem_fp16.onnx).
- 크기 **352,778,874 bytes = 약 336.4 MiB / 352.8 MB**. SHA-256 `d3d2bac77a7023282cb5f35a5807179e34076b60589867b572275f1a8ec36444`. Git/dist에는 모델을 포함하지 않습니다. 브라우저는 고정 revision, 정확한 byte 수와 완료 marker를 검사하며 전체 SHA 해시 재계산은 하지 않습니다.
- 원본 학습 그래프가 아닌 공개 프로젝트의 WebGPU 대응 export입니다. axes 정규화, 큰 Split/Concat 분할로 Chrome의 storage buffer 제한에 대응합니다. FP16 **저장 weight**이며 입력/출력과 JS DSP는 float32입니다.
- dependency **`onnxruntime-web@1.24.0-dev.20251116-b39e144322`**, MIT. 최신 버전 추정 대신 공개 구현과 같은 버전을 정확히 고정했습니다. 이 버전의 `/webgpu` entry는 native Asyncify WASM을 요구하므로 upstream과 동일한 **`onnxruntime-web/all` + JSEP WASM**을 사용합니다. `executionProviders: ['webgpu']`만 설정하며 WebGL/CPU 전체 추론 fallback을 제공하지 않습니다. ORT가 배치하는 일부 보조 연산은 WASM에서 실행될 수 있습니다.
- JSEP mjs/wasm은 Vite가 로컬 assets로 빌드하며 PWA에서 precache합니다. 앱 shell은 약 28 MiB 커집니다. 모델은 service worker precache와 분리된 OPFS입니다. WASM `numThreads=1`로 SharedArrayBuffer와 COOP/COEP 헤더 없이 동작합니다. HTTPS는 production 필수입니다.
- `navigator.gpu`, 실제 adapter의 **shader-f16** 지원, storage buffer 한도, secure context, OPFS, Worker, OfflineAudioContext를 검사합니다. Worker에서도 같은 조건을 재검사합니다. 실제 모델 호환성/메모리는 명시적 분리 시 session 생성으로 확인합니다. GPU validation/device lost와 유효한 입력의 전부 0인 출력도 오류로 처리합니다. 지원 실패 시 분리만 비활성화하고 기존 플레이어/가사/분석을 유지합니다.

### 처리 규격과 메모리

- OfflineAudioContext로 **44,100 Hz** decode/resample. stereo를 유지하고 mono는 양 채널에 복제합니다. 다채널 음원은 지원하지 않습니다.
- **176,400 samples / 4초** 고정 segment, **44,100 samples / 1초(25%)** overlap, **132,300 samples / 3초** stride. 마지막 청크는 zero padding 후 원래 길이로 자릅니다. 경계에는 상보적 linear crossfade/overlap-add를 적용합니다.
- **FFT 2048 / hop 512 / periodic Hann 2048 / center reflect / normalized=false**. 입력 `spec_real`, `spec_imag`: `[1, 2, 1025, 345]`. 출력 `out_spec_real`, `out_spec_imag`: `[1, 6, 2, 1025, 345]`. 출력 순서 `bass, drums, other, vocals, guitar, piano`를 기존 `others` 포함 여섯 채널 ID에 명시적으로 매핑합니다.
- 하나의 Worker에서 STFT → WebGPU inference → iSTFT → overlap-add를 순차 실행합니다. 입력/출력 tensor를 매 청크 dispose하고 결과 transfer 후 session/Worker를 해제합니다. 분리 중 UI 스크롤/취소는 main thread에서 계속 처리합니다. 백그라운드 전환 시 다음 청크 전 대기합니다. 이미 진행 중인 GPU 연산을 숨김 전환만으로 중단하지는 않습니다.
- **현재 상한은 6분(360초)·128 MiB 입력**입니다. 6분까지는 bitrate와 관계없이 허용하며, 길이를 초과하면 분리 버튼 옆에 붉은 글씨로 `최대 해부 길이는 6분입니다`를 표시합니다. 완성 stem 여섯 개를 Web Audio에 유지하므로 6분 PCM만 약 762 MB이며 모델·GPU 임시 버퍼가 추가됩니다. 상한은 모든 모바일에서의 성공을 보증하지 않습니다. 더 긴 곡의 디스크 기반 transport는 이번 범위에 넣지 않았습니다.
- AbortController + track ID + Worker terminate로 취소/파일 교체 시 늦은 결과를 차단합니다. 재분리 전 이전 stem을 비우며 원본으로 돌아갑니다. 기존 artwork/원본 Object URL 해제도 유지합니다. 모델은 앱의 한 분리 작업에서 하나만 로드합니다. 여러 브라우저 탭에서 동시에 분리하는 것은 피하세요.
- WebGPU 미지원 / 다운로드·저장 실패 / 모델 로드 / 오디오 decode / 메모리·quota / inference / 취소를 구분합니다. 브라우저나 OS가 프로세스 자체를 강제 종료하는 메모리 부족은 JavaScript에서 복구할 수 없습니다.

### 캐시와 공통 재생 시계

OPFS `music-dissector-models/<revision>-<filename>`에 스트리밍 저장합니다. `.part` 임시 파일과 정확한 크기 검증 후 최종 파일과 완료 marker를 생성합니다. 실패/취소된 partial은 ready로 취급하지 않습니다. 다운로드 중 임시·최종 파일이 함께 있을 수 있어 약 2.1배 여유 공간을 검사합니다. 재시작은 이어받기가 아닌 처음부터입니다. **모델 삭제**는 파일/marker/partial을 제거합니다. 브라우저 저장소 삭제/eviction 시 다시 다운로드하며 영구 저장 요청이 거절되어도 앱은 동작합니다.

기존 AudioEngine의 **동일 AudioContext**에서 6개 AudioBufferSourceNode → 개별 GainNode → master GainNode → destination으로 연결합니다. 모두 같은 `context.currentTime + 0.02`와 동일 offset으로 시작하며 seek/pause/resume 시 함께 재생성합니다. 믹서 gain은 짧게 smoothing합니다. Original의 HTMLAudioElement는 Stem Mix에서 멈추며, UI의 `playback.currentTime`은 선택한 transport 하나에서만 갱신합니다. beat는 이 공통 state를 사용합니다. 가사는 playback 시간과 무관한 정적 텍스트입니다.

### Phase 6 검증

자동 테스트는 실제 브라우저의 재생 / OPFS / 디코딩 / Web Audio 출력을 검증합니다. ONNX Worker 결과를 대체하는 테스트와 실제 모델 실행은 구분합니다. 실물 GPU가 없는 개발 환경의 SwiftShader는 shader-f16이 없어 실제 FP16 추론을 검증할 수 없습니다. 사용자의 정상 작동 확인을 기준으로 분리 코어를 보존합니다.

```sh
npm run build
npm run lint
npm run test:e2e
```

`tests/separation.spec.ts`는 DSP 왕복 복원, overlap 경계, 모델 상태/취소/경쟁 조건과 채널 매핑을 검사합니다. `tests/phase6.spec.ts`는 ONNX Worker만 합성 결과로 대체하고 실제 브라우저 OPFS, decode/resample, Web Audio 6채널, 출력 신호, Guitar Solo/No Guitar, 볼륨/multi-solo, 공통 seek와 가사, A/B, 파일 교체를 검사합니다. 일반 테스트는 거대한 모델을 다운로드하지 않습니다.

실제 모델을 별도로 다운로드한 뒤 SHA를 확인하고 선택적 검증을 실행할 수 있습니다. 앱은 별도 터미널에서 `npm run build && npm run preview -- --port 4180`으로 실행하세요. 검사 스크립트는 입력 음원을 직접 합성하고 진짜 ONNX 결과 여섯 버퍼의 길이/채널/유한값/에너지를 검사합니다. 모델 다운로드 UI 테스트를 대체하지 않으며 외부 모델 파일을 OPFS에 미리 넣어 네트워크 재다운로드를 줄입니다.

```sh
MODEL_PATH=/absolute/path/bs_roformer_sw_6stem_fp16.onnx \
APP_URL=http://127.0.0.1:4180 node scripts/verify-real-separation.mjs
```

`SOFTWARE_GPU=1`은 CI의 SwiftShader capability 진단 옵션이며 shader-f16이 없으면 즉시 중단합니다. 앱에서 소프트웨어 GPU를 강제하지 않습니다. 결과 JSON/스크린샷은 `/tmp/music-real-separation.*`에 기록됩니다. 합성 음원의 유효한 모델 출력을 확인하는 테스트는 실제 보컬/기타 분리 품질을 보증하지 않습니다. Fold7 실기기에서는 HTTPS PWA 설치, 처음/재실행 캐시, 실제 곡의 각 Solo와 Guitar 감쇠, 접기/펼치기, 백그라운드 복귀, 열/메모리/속도를 확인해야 합니다.

### Phase 6 파일

- `src/separation/{BSRoformerWebEngine,separationTypes,capabilities,modelCache,separationStore,separationPipeline}.ts`, `dsp/{fft,stft}.ts`: 모델/상태/DSP/캐시/취소
- `src/workers/stemAudio.worker.ts`: 실제 WebGPU inference
- `src/audio/StemAudioEngine.ts`, `AudioEngine.ts`, `src/types/audio.ts`: 공통 transport, A/B와 playback state
- `src/components/SeparationPanel.tsx`, `SeparationPanel.css`, `StemMixer.tsx`, `Player.tsx`: 기존 영역 안의 분리 UI와 소스 선택
- `src/mixer/mixerStore.ts`, `src/separation/StemSeparationEngine.ts`: 실제 결과와 기존 믹서 연결
- `tests/{separation,phase6}.spec.ts`, `scripts/verify-real-separation.mjs`: 단위/브라우저/선택적 실제 모델 검사
- `package.json`, `package-lock.json`, `vite.config.ts`, `README.md`, `THIRD_PARTY_NOTICES.md`: 런타임과 오프라인 빌드/출처

## BPM과 분석 캐시

`essentia.js@0.1.3`의 RhythmExtractor2013 multifeature로 BPM / beat만 계산합니다. BPM은 추정값이며 화면에서 반올림합니다. 분석 Worker의 KeyExtractor / chroma / chord 연산은 제거했습니다. 무음이나 근거가 부족한 오디오에는 값을 만들어 표시하지 않습니다. 실패해도 원본 재생은 가능합니다.

분석 엔진 버전은 `essentia.js-0.1.3:rhythm-multifeature:v2`, IndexedDB `music-dissector-analysis`는 버전 2입니다. 업그레이드 시 이전 결과 store를 비우고 BPM만 다시 계산합니다. 앱 시작 시 사용하지 않는 `music-dissector-chords` DB를 삭제합니다. 다른 탭이나 저장소 제한으로 삭제가 지연되어도 재생을 막지 않습니다. OPFS 모델 캐시는 이 작업의 영향을 받지 않습니다.

## Metadata와 가사

브라우저용 `music-metadata` Worker가 Title / Artist / Album / Duration / artwork / embedded lyrics를 읽습니다. 제목이 없으면 파일명을 사용하며 새 파일 선택 시 이전 Worker 결과를 차단하고 artwork URL을 해제합니다.

가사는 기본으로 닫힌 **가사 ▼** 버튼을 눌러 펼칩니다. USLT는 원문 텍스트로, SYLT / LRC는 시간표시를 제외한 가사 텍스트로 표시합니다. 가사가 없으면 **포함된 가사가 없습니다.**를 표시합니다. 현재 줄 강조 / 자동 스크롤 / Follow / 가사 클릭 seek는 제공하지 않습니다. 새 곡은 패널 닫힘과 스크롤 위치를 초기화합니다. 순수 파서는 향후 재사용을 위해 형식과 timestamp 정보를 유지합니다.

## UI/UX 정리

- 헤더의 로컬 플레이어, 설정 미리보기, 좌측 하단 슬로건, LOCAL FIRST 문구 제거.
- 02 재생기 / 04 Dissector로 변경. Music Dissector / 음악해체분석기 헤더, 기존 레이아웃과 파스텔 팔레트 유지.
- 기존 크기와 우측 정렬의 `Made By KTM - MuDissector`, 가까운 하단 우측에 `Contact: mindalpang27@naver.com` 표시.
- Mute / Solo 활성 상태는 `#035AA6` 배경과 흰 글씨. 복수 Solo와 hover에서도 동일하게 명확히 표시.
- 모든 실제 버튼은 누르는 동안 0.97배 / 100ms 반응. 레이아웃 크기는 그대로이며 reduced-motion에서는 모션 제거.
- 새 패키지 및 제거한 패키지 없음. Essentia는 BPM, music-metadata는 태그, ONNX Runtime은 기존 분리에 계속 필요합니다.

변경 영역: App / 공통 스타일, Player / StemMixer / AnalysisSummary / LyricsPanel, LyricsParser, BPM worker / 타입 / 캐시. AudioEngine에서는 제거된 chord 수명주기 호출만 삭제했고 separationStore에서는 chord 대기만 제거했습니다. 회귀 테스트와 선택적 실제 분리 검사 스크립트의 합성 fixture 참조도 정리했습니다.

삭제한 파일:

- `src/analysis/ChordAnalysisEngine.ts`, `chordDetection.ts`, `chordStore.ts`, `chordTypes.ts`, `chordUtils.ts`, `pitchNames.ts`, `useChords.ts`
- `src/components/ChordDisplay.tsx`, `ChordDisplay.css`
- `src/workers/chordAnalysis.worker.ts`
- `src/lyrics/useLyricsFollow.ts`
- `tests/chords.spec.ts`, `tests/phase5.spec.ts`, `tests/fixtures/chordAudio.ts`

## 실행 / 검증

```sh
npm ci
npm run dev
npm run build
npm run lint
npx playwright install chromium
npm run test:e2e
```

Playwright는 프로덕션 빌드 후 localhost:4173에서 실행합니다. Linux 브라우저 시스템 라이브러리는 별도로 필요할 수 있습니다. 전체 suite에는 파일 선택 / playback / seek / metadata / 정적 가사 dropdown / BPM과 v1 캐시 교체 / 6채널 볼륨·mute·solo·multi-solo·preset / OPFS / separation 구조 / Original·Stem Mix / 파일 교체 초기화 / 오프라인 PWA / 320·412·800px / 버튼 색상·누름·모션 감소가 포함됩니다. 모델과 추론 테스트의 범위는 위 Phase 6 검증 설명을 참고하세요.

음악 파일은 서버로 업로드하거나 자동으로 영구 저장하지 않습니다. 사용자가 분리 결과 저장을 누른 프로젝트만 기기에 보관합니다. 저장하지 않은 세션은 새로고침 후 파일을 다시 선택해야 합니다. 모델은 OPFS에 유지되며 사이트 저장소 삭제 시 다시 받아야 합니다. 이번 정리 작업에서는 HTTPS 배포를 수행하지 않습니다.

검증 결과 (2026-09-30 UI/UX 정리): `npm run build`, `npm run lint`, `git diff --check` 통과. 전체 Playwright suite **78개 통과, 실패/건너뜀 없음** (46.5초). 기존 ONNX Runtime 내부 direct eval 빌드 경고는 유지되며 빌드 오류는 없습니다. 실제 FP16 모델 추론은 이번 자동 suite에서 재실행하지 않았습니다.

## Player compact / Repeat

재생 컨트롤은 `Volume · −10초 · Play/Pause · +10초 · Repeat` 순서로 한 줄에 배치합니다. 볼륨의 별도 하단 행과 `ORIGINAL AUDIO`, `FROM YOUR DEVICE` 표시를 제거했고, artwork와 제목 사이는 18–20px로 줄였습니다. Play 버튼 60px와 아이콘 버튼 최소 44px 터치 영역을 유지하며 카드 너비에 따라 슬라이더와 간격을 줄입니다. 320px부터 한 줄을 유지하고, 그보다 더 좁아 컨트롤이 들어가지 않는 경우에만 볼륨을 줄바꿈합니다. Original / Stem Mix 선택은 기존 상단 위치를 유지합니다.

`PlaybackState.repeatEnabled`는 기본 false이며 곡을 바꿔도 유지됩니다. Original은 기존 HTMLAudioElement의 `loop`, Stem Mix는 기존 종료 처리와 `AudioEngine.play()`를 재사용해 여섯 소스를 같은 시각의 0초부터 다시 시작합니다. 믹서 설정과 전체 볼륨은 유지하며, 일시 정지 상태에서 Repeat만 켠다고 재생을 시작하지 않습니다. 페이지를 다시 열면 OFF로 초기화됩니다. 활성 상태는 진한 파랑 / 흰 아이콘 / `aria-pressed`로 표시하며 기존 누름 효과와 reduced-motion 설정을 따릅니다.

이번 수정 파일: `src/components/Player.tsx`, `Icon.tsx`, `AnalysisSummary.css`, `src/App.css`, `src/types/audio.ts`, `src/audio/AudioEngine.ts`, `tests/player.spec.ts`, `tests/phase6.spec.ts`, `README.md`. StemAudioEngine, separation 모델 / Worker / DSP / chunk / cache, BPM 분석 로직은 변경하지 않았습니다.

Player 변경 검증 (2026-09-30): build / lint / 전체 87개 테스트 통과 (53.6초), git diff --check 통과. 동일한 artwork·제목·아티스트·앨범을 가진 합성 음원으로 측정한 카드 높이는 320/412px 화면에서 787→649px (17.5%), 800px에서 805→654px (18.8%), 1280px에서 838→693px (17.3%)입니다. 메타데이터 줄 수에 따라 실제 높이는 달라집니다. 테스트는 실제 HTMLAudioElement 반복 및 합성 stem의 실제 Web Audio 반복 / 동시 시작 / gain 유지 / OFF 종료를 확인합니다. 기존 ONNX Runtime direct eval 빌드 경고 외 오류는 없으며 실제 AI 모델 추론을 다시 실행하거나 배포하지 않았습니다.


## 로컬 분리 프로젝트 저장

기본 동작은 **Session Only**입니다. AI 분리가 끝나도 프로젝트를 자동으로 저장하지 않습니다. Dissector 아래 **분리 결과 저장**을 누를 때만 6개 stem, 원본 파일, metadata, artwork, 가사 텍스트, 당시 BPM 결과 및 volume/mute/solo 설정을 저장합니다. 원본은 재실행 후에도 Original / Stem Mix 비교와 사용자가 요청한 BPM 재분석을 유지하기 위해 함께 저장합니다. Key/Chord는 저장하지 않습니다.

**저장된 분리 결과** 목록에서 제목 / 가수 / 저장 시각 / 실제 미디어 파일 byte 합계와 불러오기 / 삭제를 제공합니다. 저장 공간 표시는 `navigator.storage.estimate()`의 사이트 전체 사용량과 할당량이며 모델 / PWA 캐시도 포함합니다. 다운로드 폴더나 서버에 저장하지 않습니다.

### 저장 위치 / 스키마

```text
OPFS /
  music-dissector-models/          # 기존 모델 cache: 변경 없음
  music-dissector-projects/
    p-<uuid>/
      original.audio              # 원본 bytes 그대로, 원래 이름/MIME는 IDB
      artwork                     # 있는 경우만, 원래 MIME는 IDB
      vocals.flac                 # stem별 FLAC 또는 WAV fallback
      guitar.flac
      piano.flac
      drums.flac
      bass.flac
      others.flac

IndexedDB music-dissector-projects (DB version 1)
  projects [keyPath: id]
  jobs     [keyPath: id]           # writing / deleting 복구 기록
```

프로젝트 형식 v1: id, appVersion, version, title/artist/album/duration, originalFilename/Type/LastModified/Bytes, artwork MIME/bytes, savedAt/updatedAt, 전체 미디어 bytes, 가사 텍스트, 선택적인 BPM 결과, 6개 stem의 파일명/형식/frames/channels/sampleRate/bytes, 6개 채널의 volume/muted/solo. 파일 경로는 정해진 이름만 허용하고 길이·채널·크기·설정·버전을 읽기 전에 검증합니다. 호환되지 않는 버전은 자동 삭제하지 않고 불러오기만 막으며 사용자가 삭제할 수 있습니다.

### 실제 FLAC / WAV 저장

새 dependency **`libflacjs@5.6.0`** (MIT)를 추가했습니다. [공식 프로젝트](https://github.com/mmig/libflac.js)의 WebAssembly encoder를 별도 Worker에서 실행합니다. 샘플 16,384개씩 한 번에 한 블록만 전달하고 OPFS write 완료 후 다음 블록을 보냅니다. 전체 곡의 인코딩 결과를 한 ArrayBuffer에 모으지 않습니다. 인코더와 WASM은 PWA에 포함되어 오프라인에서도 사용할 수 있습니다.

기본 형식은 **FLAC / 24-bit PCM / 44.1 kHz**입니다. Float32 stem을 24-bit 정수로 양자화한 PCM을 무손실 압축하므로 원래 Float32와 비트 단위로 동일하지는 않습니다. 인코더 verify를 켜고, 완료 후 STREAMINFO의 frame 크기와 MD5를 기록합니다. 테스트에서 파일의 실제 `fLaC` 헤더, native decoder 복원 및 sample 오차를 검증합니다.

인코더 실패·초기화/응답 실패 또는 Float32 값이 정수 PCM 범위 밖인 경우에는 해당 stem만 **IEEE Float32 WAV**로 다시 기록합니다. `.wav` 확장자와 `wav-float32` 형식을 기록하므로 가짜 FLAC이 아닙니다. 오버슈트를 clipping하지 않습니다. 저장 공간 부족은 더 큰 WAV로 재시도하지 않고 롤백합니다. 최악의 WAV 용량과 원본을 기준으로 여유 공간을 먼저 확인하며, 브라우저의 실제 quota 실패도 처리합니다.

### 복원 / 명시적인 설정 저장

불러오기는 모델을 받거나 AI를 다시 실행하지 않습니다. 원본·artwork와 6개 stem을 검증하고, FLAC은 44.1 kHz OfflineAudioContext에서 stem별로 decode, WAV는 작은 블록으로 AudioBuffer에 복원합니다. 전부 성공하면 기존 AudioEngine / MixerStore에 한 번에 연결하고 Stem Mix를 선택한 일시 정지 상태로 준비합니다. 기존 StemAudioEngine은 변경하지 않았습니다. 재생, seek, Repeat, presets, mute/solo/multi-solo, Original 비교가 그대로 동작합니다.

로드 중 취소·새 파일 선택·손상이 발생하면 이전 세션을 유지하거나 사용자의 새 파일을 존중합니다. 한 번에 6개의 복원된 AudioBuffer가 필요하며 기존 세션은 검증 완료 전까지 남아 있습니다. 긴 곡에서는 기기의 메모리 한도에 영향을 받을 수 있습니다. 저장은 순차 스트리밍이며 FLAC decode도 한 stem씩 수행합니다.

Mixer를 바꿔도 자동 저장하지 않습니다. **현재 설정 저장**은 IDB의 mixer 및 updatedAt만 바꾸며 OPFS 오디오를 다시 쓰지 않습니다. 저장 도중 변경한 설정도 저장 버튼을 누른 시점의 snapshot과 구분됩니다. 새 파일 / 재분리 결과는 기존 프로젝트 설정에 잘못 연결되지 않습니다.

### 삭제 / 중단 복구 / 저장소 보호

삭제 확인을 받은 뒤 `jobs`에 삭제 의도를 기록하고 프로젝트 OPFS 디렉터리 전체를 지운 다음 IDB metadata와 journal을 함께 제거합니다. 사용 중인 해당 프로젝트는 재생과 세션 참조도 해제합니다. 모델 디렉터리에는 접근하지 않습니다. 모델 삭제 역시 기존 구현 그대로라 프로젝트를 지우지 않습니다.

OPFS와 IDB는 하나의 원자적 transaction을 공유할 수 없어 journal로 복구합니다. 신규 저장은 `writing` 기록 → OPFS 파일 작성 → IDB metadata 확정과 journal 제거 순서입니다. 실패/취소 시 정리하며, 브라우저 강제 종료 또는 삭제 실패로 남은 작업은 다음 목록 조회/재실행에서 다시 정리합니다. 정리 실패 항목은 재시도할 수 있도록 목록에 남깁니다. metadata 없는 프로젝트 디렉터리도 자체 namespace 내에서만 회수합니다. Web Locks로 여러 탭의 저장/복구/불러오기/삭제를 직렬화하여 진행 중인 다른 탭의 파일을 orphan으로 지우지 않습니다.

첫 명시적 저장 시 세션당 한 번 `navigator.storage.persist()`를 요청합니다. 거절/미지원이어도 일반 저장을 진행합니다. 영구 저장 허용 여부를 UI에 표시하며, 사이트 데이터 직접 삭제는 어떤 경우에도 저장 결과를 지웁니다. OPFS / IndexedDB / Web Locks를 사용할 수 없는 환경에서는 프로젝트 저장을 비활성화하고 기존 세션 재생을 유지합니다.

### 변경 파일과 검증 범위

- 신규: `src/projects/{projectTypes,projectDatabase,ProjectRepository,projectStore,stemStorage,wavStorage,flac.worker}.ts`, `src/components/SavedProjects.tsx`, `SavedProjects.css`.
- 연결: `App.tsx`, `StemMixer.tsx`, `FilePicker.tsx`, `AudioEngine.ts`, `mixerStore.ts`, `analysisStore.ts`, `types/audio.ts`.
- 의존성/문서: `package.json`, `package-lock.json`, `THIRD_PARTY_NOTICES.md`, `README.md`.
- 테스트: `tests/projects.spec.ts`, 기존 Phase 6의 합성 추론 helpers를 공유하는 `tests/fixtures/separationHarness.ts`, `tests/phase6.spec.ts`.
- BS-RoFormer 추론, 모델 다운로드/cache, chunk/DSP, StemAudioEngine, mixer gain 규칙, Player UI는 변경하지 않았습니다.

현재 작업 트리에는 MP3 믹스 내보내기 기능이 없습니다. 이번 기능은 프로젝트 저장에 한정되며 MP3 bounce/download를 추가하거나 이를 프로젝트 저장으로 대체하지 않습니다. HTTPS 배포도 진행하지 않습니다.

프로젝트 저장 최종 검증 (2026-09-30): `npm run build`, `npm run lint`, `git diff --check` 통과. 전체 **100개 테스트 통과** (기존 87 + 프로젝트 13, 실패/건너뜀 없음, 1.3분). 실제 FLAC 인코딩 / 파일 헤더 / native decoding 샘플 오차 / OPFS·IndexedDB / 모델 없는 오프라인 재생 / 설정만 갱신 / 삭제·quota·취소·복구·동시 탭·손상·버전·늦은 로드 처리를 검증했습니다. AI 분리 테스트는 기존 합성 추론 fixture를 사용하며 실제 FP16 모델을 재실행하지 않았습니다. 기존 ONNX Runtime 내부 direct eval 빌드 경고 외 오류는 없습니다.

### 첫 파일 선택이 사라지는 개발 서버 문제

캐시 없는 Vite에서 첫 파일 선택 후 metadata/BPM Worker가 시작되면 `music-metadata`와 `essentia.js/dist/essentia.js-core.es.js`를 뒤늦게 발견했습니다. 실제 재현 로그는 `FILE_SELECTED → track id 2 → dependencies optimized → optimized dependencies changed. reloading → 새 문서 navigation` 순서였습니다. 이때 `AudioEngine.dispose()` 호출은 없었으며, 전체 페이지 새로고침이 Session Only 상태를 지웠습니다. OPFS/IndexedDB 복구가 현재 곡을 초기화하는 문제는 아니었습니다.

`vite.config.ts`의 `optimizeDeps.include`에 worker 전용 의존성을 명시했습니다. 이후 처음 시작하는 separation worker도 같은 문제를 일으키지 않도록 `onnxruntime-web/all`을 포함합니다. 모델 다운로드·추론·DSP·chunk 설정은 변경하지 않습니다.

별도로 `App.tsx`의 effect cleanup에서 전역 `audioEngine.dispose()`를 호출하던 코드도 제거했습니다. 화면 mount/StrictMode effect 재실행은 사용자의 세션 종료가 아닙니다. 세션은 파일 선택·프로젝트 불러오기·명시적인 삭제 등 기존 사용자 action으로 관리하며, 기존 track generation/AbortController 검사를 유지합니다. 프로젝트 시작 시 복구·목록·용량 조회는 프로젝트 저장소 상태만 갱신합니다. 임의 delay나 StrictMode 비활성화는 사용하지 않습니다.

회귀 테스트: `tests/startup-dev.spec.ts`는 독립적인 빈 Vite 캐시와 실제 개발 서버에서 첫 파일의 metadata/artwork·실제 Essentia BPM·재생 및 자동 reload 부재를 검사하고, StrictMode effect replay와 App 재마운트 후 선택·재생·Repeat 유지도 검증합니다. `tests/startup.spec.ts`는 fresh context에서 복구 전과 storage estimate 완료 전을 Promise gate로 각각 막은 뒤 파일을 한 번만 선택하고, 뒤늦은 journal/orphan 정리·저장 목록 갱신 후에도 metadata·재생·seek·분리가 유지되는지 검사합니다. 분리 Worker 응답은 기존 합성 fixture이며 실제 AI 모델을 실행하는 테스트는 아닙니다.

수정 후 검증: `npm run build`, `npm run lint`, `npm run test:e2e` 통과. 전체 **103개 통과** (기존 100 + 시작/StrictMode 회귀 3, 1.5분). 기존 ONNX Runtime 내부 direct eval 경고 외 build/lint 오류는 없습니다. 임시 diagnostic log는 앱 코드에 남기지 않았습니다.

## Cloudflare Workers 모델 다운로드 프록시

브라우저의 모델 다운로드 URL은 개발/preview/production 모두 **`/api/model/bs-roformer-sw-6stem-fp16`**입니다. 브라우저는 Hugging Face나 signed CDN 주소를 직접 요청하지 않습니다. `worker/modelProxy.ts`가 다음 upstream을 서버에서 `redirect: 'follow'`로 요청하고 `new Response(upstream.body, …)`로 그대로 전달합니다.

```text
https://huggingface.co/elicwhite/bs-roformer-sw-6stem-onnx/resolve/a744f80957374e1735ad70fa122670b7961da8cc/bs_roformer_sw_6stem_fp16.onnx
```

Worker에는 `arrayBuffer()`/`blob()`/전체 모델 버퍼나 Cache API 저장 로직이 없습니다. Content-Type, Content-Length, ETag, Last-Modified와 필요한 Content-Encoding을 전달합니다. Cache-Control은 `no-store`이며 영구 보관은 기존 OPFS가 담당합니다. 404/429/5xx는 upstream 상태를 유지하고, 네트워크 실패 또는 성공 상태의 빈 body는 502입니다. 이 endpoint는 GET만 허용하며 임의 URL이나 query parameter를 받지 않습니다. 요청자의 쿠키·Authorization·Range·조건부 요청 헤더도 upstream에 전달하지 않습니다.

`src/separation/separationTypes.ts`에서는 URL만 변경했습니다. expected bytes **352778874**, revision **a744f80957374e1735ad70fa122670b7961da8cc**, SHA-256 상수 **d3d2bac77a7023282cb5f35a5807179e34076b60589867b572275f1a8ec36444**와 기존 모델 파일명은 그대로입니다. `OPFSModelCache`의 byte progress, 크기 검증, `.part`, 완료 marker, 취소, 모델 삭제 코드는 변경하지 않았습니다. 추론/DSP/chunking도 그대로입니다.

### 개발 및 배포 설정

`worker/viteModelProxy.ts`는 같은 proxy handler를 Vite dev/preview에 연결하는 Node streaming adapter입니다. `npm run dev`로 기존 localhost 개발을 계속하며, `npm run preview`도 같은 endpoint를 제공합니다. 브라우저 연결 종료는 upstream AbortSignal에 전달됩니다. PWA의 navigation fallback에서는 `/api`를 제외해 API 오류가 `index.html`로 감춰지지 않습니다.

`wrangler.jsonc`는 [Cloudflare Static Assets의 현재 binding 방식](https://developers.cloudflare.com/workers/static-assets/binding/)을 사용합니다.

- Worker 이름: `musicdissector`; entry: `worker/index.ts`.
- Assets: `./dist`, binding: `ASSETS`, SPA fallback: `single-page-application`.
- `run_worker_first`: `/api`와 `/api/*`; 나머지 정적 파일은 Assets에서 제공합니다.
- compatibility date: `2026-09-26`; 개발 의존성 `wrangler@4.144.0` 고정.
- `npm run build`에 Worker TypeScript 검사도 포함됩니다.

GitHub 연동 Cloudflare Workers Build의 프로젝트 root는 `package.json`과 `wrangler.jsonc`가 있는 `Music dissector` 디렉터리입니다. 해당 디렉터리가 이미 repository root라면 root 설정을 추가할 필요가 없습니다. Node.js 22 이상을 사용하며 기존 build/deploy 명령은 다음과 같습니다.

```bash
npm ci
npm run build
npx wrangler deploy
```

Cloudflare GitHub 연동의 기존 배포 인증을 사용합니다. 저장소에는 토큰·계정 비밀값·모델 파일을 추가하지 않습니다. `npx wrangler deploy --dry-run`은 외부 배포 없이 bundle과 assets binding을 확인합니다. `npm run build` 후 `npx wrangler dev --local`로 Cloudflare runtime의 API/SPA routing도 로컬에서 확인할 수 있습니다.

### 프록시 테스트

`tests/model-proxy.spec.ts`는 첫 청크를 받기 전까지 producer를 완료시키지 않는 스트림과 body identity 검사를 사용해 전체 buffering이 없음을 검증합니다. 실제 로컬 HTTP 302 redirect follow, 전달 헤더, 404/429/5xx, network failure, body 부재, cancellation, 고정 endpoint와 모델 검증 상수도 검사합니다.

`tests/model-download.spec.ts`는 테스트 서버의 모의 upstream → 동일 proxy handler → 브라우저 → 실제 OPFS 경로를 검증합니다. 모델 크기와 동일한 352778874바이트를 작은 zero-filled 청크로 생성하며 원격 336 MiB 모델은 받지 않습니다. producer를 첫 청크 뒤에 멈춰 byte progress와 취소를 검사한 다음 재시도로 실제 저장·완료 marker·reload 재사용·삭제를 검증합니다. Chromium incognito의 별도 메모리 파일시스템 한도를 피하기 위해 새 임시 디스크 프로필을 쓰고 테스트 후 삭제합니다. 기존 separation 테스트 역시 유지됩니다.

최종 검증 (2026-09-30): `npm run build`, `npm run lint`, `git diff --check` 통과. `npm run test:e2e` **114개 전체 통과** (기존 103 + 신규 11, 1.6분). `npx wrangler deploy --dry-run`에서 Worker 2.29 KiB와 ASSETS binding을 확인했습니다. 로컬 `wrangler dev`에서 정적 앱/SPA fallback/manifest의 200 및 잘못된 API/query의 404/400도 확인했습니다. 기존 ONNX Runtime direct eval 경고 외 build 오류는 없습니다. 실제 remote 모델 다운로드·AI 추론 재실행·production 배포는 수행하지 않았습니다.
