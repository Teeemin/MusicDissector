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
- 내장 SYLT / LRC / 일반 가사 구분 및 표시
- 시간 가사의 현재 줄 강조, 줄 클릭 seek, 자동 스크롤과 Follow

**Phase 6 범위까지 구현했습니다.** 기존 재생 / metadata / artwork / 가사 / BPM / beat / Key / chord / 믹서 설정과 파스텔 테마를 유지하며 로컬 WebGPU AI stem separation을 추가합니다. AI 가사 동기화, 서버 연동, export 등 Phase 7 기능은 포함하지 않습니다. 아래 이전 Phase 설명은 각 단계의 구현 기록이며, 현재 분리/재생 동작은 다음 Phase 6 설명을 기준으로 합니다.

## Phase 6: 실제 AI Stem Separation

1. HTTPS 또는 localhost의 WebGPU 지원 Chrome에서 음원을 선택합니다.
2. **모델 다운로드**를 눌러 최초 한 번 모델을 기기에 저장합니다. 자동으로 모델을 받거나 음악을 업로드하지 않습니다.
3. **분리 시작**을 누릅니다. 기존 BPM/chord 자동 분석이 진행 중이면 먼저 끝나기를 기다립니다. 모델 로드, 오디오 준비, 청크 추론, 결과 준비를 구분하며 다운로드는 실제 수신 bytes, 분리는 완료 청크 수를 표시합니다. 첫 청크의 shader compilation이 오래 걸릴 수 있으며 가짜 진행률을 만들지 않습니다.
4. 완료 후 플레이어의 **Original / Stem Mix**로 같은 위치에서 A/B 비교합니다. Original은 원본 그대로, Stem Mix는 실제 여섯 결과 버퍼입니다. Stem Mix에서 볼륨, Mute, Solo/multi-solo, 기존 5개 프리셋이 실제 소리에 적용됩니다. 믹서의 Original 프리셋은 모든 stem 설정 초기화이며 플레이어의 원본 소스 선택과 구분됩니다.
5. **Guitar Solo**, **No Guitar**, Guitar 볼륨으로 기타 분리/감쇠를 확인합니다. 새 파일을 선택하면 이전 작업, 결과와 믹서 설정이 초기화됩니다. 새로고침 시 모델만 남고 음원과 stem은 다시 선택/분리해야 합니다.

분리 후 Original을 듣는 상태에서 채널 볼륨 / Mute / Solo / 프리셋을 조작하면 **같은 위치의 Stem Mix로 자동 전환**해 설정을 바로 들을 수 있습니다. 일시 정지 상태에서는 소스만 전환하고 재생은 시작하지 않습니다. 믹서 안내에 현재 소스를 표시하며 **Stem Mix로 듣기** 버튼도 제공합니다. 분리 전에는 기존 설정 미리보기 동작을 유지합니다. 원본 A/B 비교는 재생기의 Original 버튼으로 선택합니다.

### 모델과 런타임

- 참고 구현: [elicwhite/bs-roformer-web](https://github.com/elicwhite/bs-roformer-web), 검토 commit `c6047cd28c41f803339e9b8a5775a56932de7157`. JS STFT/iSTFT와 radix-2 FFT를 타입화하여 재사용하고 iSTFT의 잘못 지워지던 conjugate bin을 수정했습니다. 별도 왕복 복원 테스트로 확인합니다.
- 모델: [BS-RoFormer-SW 6-stem FP16 ONNX](https://huggingface.co/elicwhite/bs-roformer-sw-6stem-onnx). [고정 revision 다운로드 URL](https://huggingface.co/elicwhite/bs-roformer-sw-6stem-onnx/resolve/a744f80957374e1735ad70fa122670b7961da8cc/bs_roformer_sw_6stem_fp16.onnx).
- 크기 **352,778,874 bytes = 약 336.4 MiB / 352.8 MB**. SHA-256 `d3d2bac77a7023282cb5f35a5807179e34076b60589867b572275f1a8ec36444`. Git/dist에는 모델을 포함하지 않습니다. 브라우저는 고정 revision, 정확한 byte 수와 완료 marker를 검사하며 전체 SHA 해시 재계산은 하지 않습니다.
- 원본 학습 그래프가 아닌 공개 프로젝트의 WebGPU 대응 export입니다. axes 정규화, 큰 Split/Concat 분할로 Chrome의 storage buffer 제한에 대응합니다. FP16 **저장 weight**이며 입력/출력과 JS DSP는 float32입니다.
- 새 dependency **`onnxruntime-web@1.24.0-dev.20251116-b39e144322`**, MIT. 최신 버전 추정 대신 공개 구현과 같은 버전을 정확히 고정했습니다. 이 버전의 `/webgpu` entry는 native Asyncify WASM을 요구하므로 upstream과 동일한 **`onnxruntime-web/all` + JSEP WASM**을 사용합니다. `executionProviders: ['webgpu']`만 설정하며 WebGL/CPU 전체 추론 fallback을 제공하지 않습니다. ORT가 배치하는 일부 보조 연산은 WASM에서 실행될 수 있습니다.
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

기존 AudioEngine의 **동일 AudioContext**에서 6개 AudioBufferSourceNode → 개별 GainNode → master GainNode → destination으로 연결합니다. 모두 같은 `context.currentTime + 0.02`와 동일 offset으로 시작하며 seek/pause/resume 시 함께 재생성합니다. 믹서 gain은 짧게 smoothing합니다. Original의 HTMLAudioElement는 Stem Mix에서 멈추며, UI의 `playback.currentTime`은 선택한 transport 하나에서만 갱신합니다. 가사/chord/beat는 계속 이 공통 state를 사용합니다.

### Phase 6 검증

2026-09-30 검증 기록:

- `npm run build`, `npm run lint` 성공. 빌드에는 ONNX Runtime 의존성 내부의 direct `eval`에 대한 bundler 경고가 남으며 오류는 없습니다.
- 기존 86개 + Phase 6 11개 = **97개 자동 테스트 통과**. 320/412/800px 반응형, 오프라인 기존 분석/재생 회귀 포함.
- **실제 FP16 모델의 성공 검증은 미완료**입니다. 실물 GPU 없는 Linux Chromium에서 모델 파일의 크기/SHA를 확인하고 4초 합성 WAV로 실제 ONNX 실행을 시도했습니다. 사용 가능한 adapter는 `google / swiftshader`, WebGPU 자체는 가능하지만 `shader-f16`이 없습니다. FP16 Cast shader 오류로 6개 출력이 모두 0이어서 실패로 판정했습니다. 이 결과를 분리 성공이나 품질 검증으로 계산하지 않습니다.
- 발견한 문제를 반영해 main/Worker 양쪽에서 shader-f16을 검사하고, GPU validation/device lost 및 비정상 무음 결과를 실패 처리합니다. 최종 빌드의 미지원 GPU 안내를 확인했습니다. 시스템 Mesa/Vulkan 선택도 시도했으나 이 Chromium 환경에서는 같은 SwiftShader만 선택되었습니다.
- **FP16 지원 실제 Chrome/Fold7에서 첫 분리 성공, 재실행 캐시, 분리 품질·속도·장시간 메모리 확인이 남습니다.** 아래 스크립트로 재현할 수 있습니다. 소프트웨어 GPU 추론과 전체 회귀 테스트를 동시에 실행하면 이 환경에서 자원 경합으로 timeout이 발생하므로 각각 독립 실행했습니다.

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

## Phase 5: 코드 진행과 가사

플레이어 상단에서 이전 / 현재 / 다음 코드를 확인합니다. 분석 영역에는 가로 코드 타임라인, 현재 구간 강조, 클릭 seek, 수동 스크롤 시 따라가기 중지와 `따라가기` 재개가 있습니다. 코드가 없는 구간은 `—`입니다. 곡 끝의 정확한 end timestamp에서는 활성 구간이 없습니다. 기존 playback currentTime 하나를 사용하며 별도 재생 엔진/시계를 만들지 않습니다.

시간이 있는 LRC/SYLT 가사는 현재 줄부터 다음 시작 시간까지 겹치는 코드를 줄 위에 시간 순서대로 표시합니다. 같은 시작 시간의 줄은 같은 범위를 공유하고 마지막 줄은 곡 끝까지입니다. 단어 위치를 추정하지 않습니다. 가사 버튼은 줄 시작으로, 별도 코드 버튼은 실제 코드 시작으로 이동합니다. 일반 USLT/시간 없는 텍스트에는 코드를 배정하지 않습니다. 가사 Follow와 코드 따라가기는 독립이며 새 파일/재분석 시 코드 타임라인 스크롤 상태도 초기화됩니다.

### 분석 방식과 한계

- **추가 패키지 없음.** 기존 `essentia.js@0.1.3` (AGPL-3.0)과 실제 설치 API `Windowing → Spectrum → SpectralPeaks → HPCP`를 사용합니다. [HPCP 공식 문서](https://essentia.upf.edu/reference/std_HPCP.html)의 A-first 출력을 C-first pitch class로 변환합니다.
- 입력은 기존 분석용 44.1 kHz mono 전처리입니다. **8192 samples(약 186ms) Blackman-Harris 92dB window / 4410 samples(100ms) hop**으로 곡 전체를 분석합니다. window는 timestamp를 중심으로 하며 시작/끝은 zero padding합니다. 55–3500 Hz의 최대 60 spectral peaks, 12-bin HPCP를 사용합니다.
- **Major / Minor / 7 / maj7 / m7 / sus2 / sus4 / dim / aug** × 12근음의 템플릿과 cosine similarity를 비교합니다. chord constituent별 근거와 chroma 설명 비율을 검사하며 4음 코드에는 작은 복잡도 패널티를 줍니다. 입력이 부족하거나 무음/잡음이면 `N`입니다. confidence는 알고리즘 점수이고 정확도 확률이 아닙니다.
- **Viterbi smoothing**은 전환 비용 0.35로 프레임 수 × 상태 수에 비례하는 계산을 합니다. 300ms 미만의 일시적 코드 흔들림과 불확실한 전환 프레임을 정리합니다. RMS/flatness가 확인한 실제 무음/잡음은 이 과정에서 채우지 않습니다.
- **Beat snapping은 적용하지 않습니다.** BPM/beat 추정 오류가 chord 경계를 바꾸지 않게 독립적인 100ms 시간축을 유지합니다. beat와 chord는 동일한 원곡 초 단위 좌표를 사용합니다.
- Key/chord는 `pitchNames.ts`의 공통 sharp 규칙(C#, D#, F#, G#, A#)을 사용합니다. 반개구간 `[start, end)`의 현재/이전/다음 코드를 이진 탐색합니다. `ChordSegment`는 start/end/chord/confidence를 가진 수정 가능한 데이터 구조이며 편집 UI는 없습니다.
- 실제 음악에서는 배음/보컬/저음 때문에 코드가 단순화되거나 잘못 추정될 수 있습니다. 같은 pitch-class set인 sus2/sus4 전위, aug의 대칭 근음 등은 유일한 정답으로 구별할 수 없습니다. 9/11/13/altered, slash chord, 정확한 단어 alignment는 추정하지 않습니다.

### 상태, 캐시와 모바일 성능

- 기다림 → 분석용 음원 준비 → 특징 추출 → 코드 진행 분석 → 완료/실패. 실제 단계에만 spinner를 표시하며 가짜 백분율은 없습니다. 실패해도 재생과 기존 BPM/Key 결과는 유지됩니다.
- `코드 재분석`은 코드 캐시를 건너뛰고 갱신합니다. 기존 `다시 분석`은 BPM/beat/Key를 갱신하는 Phase 4 동작을 유지합니다.
- `IndexedResultCache`를 재사용하며 별도 IndexedDB `music-dissector-chords/results`에 chords/engineVersion/analyzedAt을 저장합니다. Phase 4 데이터베이스 이름·스키마는 유지합니다. 동일한 bounded file fingerprint에 독립적인 chord engine version을 넣어 서로 충돌하지 않습니다. 저장 실패 시에도 분석은 사용 가능합니다.
- 기본적으로 Phase 4 작업이 끝나거나 실패한 뒤 코드 분석을 실행하여 최초 두 전체 곡 분석의 CPU/RAM 경쟁을 줄입니다. 디코딩 코드를 재사용하되, 큰 PCM을 계속 보관하지 않도록 코드 분석 시 다시 디코딩합니다. 재분석은 각 작업별로 독립적입니다.
- 실제 FFT/HPCP/template/Viterbi는 전용 Worker에서 수행합니다. `workerJob.ts`가 Phase 4/5의 timeout, transferable mono 전송, abort, 종료를 공통 처리합니다. 프레임별 WASM vector를 즉시 delete하고, 12-bin chroma는 저장하지 않으며 작은 score 배열/Uint8 backpointer만 유지합니다. 완료/취소 시 Worker와 WASM heap을 해제합니다.
- 파일 교체/dispose 시 이전 작업을 취소하고, 파일 identity와 AbortController 검사로 늦은 성공/오류/단계를 모두 무시합니다. Phase 4의 입력 256MiB/디코딩 PCM 256MiB/15분 한계와 Worker 180초 제한을 재사용합니다.

### Phase 5 변경 파일

| 경로 | 내용 |
| --- | --- |
| `src/analysis/ChordAnalysisEngine.ts`, `chordTypes.ts`, `chordDetection.ts` | 코드 분석 계약과 템플릿/Viterbi |
| `src/workers/chordAnalysis.worker.ts` | 실제 waveform 특징 추출과 분석 |
| `src/analysis/chordUtils.ts`, `pitchNames.ts` | 현재/이전/다음/가사 범위 검색과 공통 표기 |
| `src/analysis/chordStore.ts`, `useChords.ts` | 선택·상태·캐시·재분석·취소·React 구독 |
| `src/analysis/workerJob.ts`, `MusicAnalysisEngine.ts`, `analysisCache.ts`, `essentia.d.ts` | Worker/cache 공통화와 검증된 API 타입 |
| `src/workers/musicAnalysis.worker.ts` | Key 표기의 공통 utility 연결 |
| `src/components/ChordDisplay.tsx`, `ChordDisplay.css` | 현재 코드와 타임라인 UI |
| `src/components/Player.tsx`, `AnalysisSummary.tsx`, `LyricsPanel.tsx` | 기존 UI와 코드/가사 연결 |
| `src/audio/AudioEngine.ts`, `src/lyrics/useLyricsFollow.ts` | 파일/dispose 수명주기와 가사+코드 높이 반영 |
| `tests/chords.spec.ts`, `tests/phase5.spec.ts`, `tests/fixtures/chordAudio.ts` | 단위/mock 테스트와 실제 오디오/오프라인/모바일 검증 |

최종 검증(2026-09-29): `npm run build`, `npm run lint`, `git diff --check` 통과. 기존 Phase 1~4 **61개**와 Phase 5 **25개**, 총 **86개** 테스트가 모두 통과했습니다(실패/건너뜀/재시도 없음). 실제 22초 PCM의 9가지 코드와 무음/잡음, 실제 오프라인 분석, 캐시 복원/재분석, 가사·코드 클릭 seek, 독립적인 Follow, 320/412/800px 화면을 검증했습니다. CPU 4배 감속 Chromium에서 터치 재생/seek와 412→800px 펼침 중 관측 최대 프레임 간격은 약 33.4ms, long task는 0개였습니다(테스트 파일 전송 이후 관측). Galaxy Z Fold7 실기기 측정이나 일반 상용 음원의 정확도 보장은 아닙니다.

Phase 6는 구현하지 않았습니다.

## Phase 4: 로컬 음악 분석

파일을 선택하면 곡 정보 아래 BPM / KEY / 현재 beat가 표시됩니다. `음원 준비 → BPM 분석 → Key 분석 → 완료` 상태만 표시하며 가짜 진행률은 없습니다. BPM은 화면에서 반올림하고 내부에는 원래 소수 값을 보존합니다. Key는 C# / D# / F# / G# / A#으로 통일합니다. `다시 분석`은 캐시를 건너뛰고 갱신합니다.

- 새 패키지: **`essentia.js@0.1.3`** (정확한 버전 고정, AGPL-3.0). [공식 프로젝트](https://github.com/MTG/essentia.js)의 브라우저 WASM 빌드와 실제 설치된 ES API를 사용합니다. 간접 의존성 `node-wav@0.0.2`는 브라우저 번들에서 사용하지 않습니다.
- BPM / beat: [RhythmExtractor2013](https://essentia.upf.edu/reference/std_RhythmExtractor2013.html)의 `multifeature`, 40–208 BPM. 이 알고리즘이 요구하는 44,100 Hz로 Web Audio 디코딩/리샘플링 후 채널 평균을 사용합니다. 결과 ticks는 곡 시작 기준 초 단위이며 BPM으로 균일한 가짜 beat를 생성하지 않습니다.
- Key: [KeyExtractor](https://essentia.upf.edu/reference/std_KeyExtractor.html)의 전체 곡 HPCP / `bgate` 프로파일, 기본 4096 frame/hop, 440 Hz 튜닝. 시간별 modulation/chord는 분석하지 않습니다.
- 무음/2초 미만은 값을 표시하지 않습니다. rhythm native confidence < 1, key strength < 0.5이면 해당 값을 `--`로 둡니다. 이 기준은 보수적인 표시 정책이며, native score를 확률이나 정확도 백분율로 해석하지 않습니다. 실제 음악의 반/배속 BPM, 상대 장·단조 혼동 등 추정 한계는 남아 있습니다.
- 캐시: IndexedDB `music-dissector-analysis/results`. 파일명·크기·lastModified와 시작/중간/끝 최대 192 KiB의 SHA-256을 결합합니다. 전체 파일을 해시하지 않으며, 샘플 영역 밖만 수정하고 identity도 보존한 파일까지 완전히 구분하는 content hash는 아닙니다. 분석 버전이 key와 결과에 포함되어 알고리즘 변경 시 이전 캐시는 사용하지 않습니다. 저장 내용은 결과뿐이며 음원/파형은 저장하지 않습니다. 저장 차단/할당량 오류가 나도 분석과 재생은 가능합니다.
- 성능: 무거운 WASM 계산은 전용 Worker, mono buffer는 transferable로 전달합니다. JS downmix는 65,536 samples마다 UI에 실행을 양보합니다. 분석 후 native vector와 Worker를 해제하고, 곡 교체/재분석/dispose에서 Worker를 종료합니다. native decode는 중간 취소 API가 없어 직렬화하고 취소된 대기 작업과 늦은 결과를 무시합니다. 분석용 OfflineAudioContext는 출력에 연결되지 않으며 재생 엔진/clock은 기존 한 개입니다.
- 모바일 메모리 보호: 입력 256 MiB 초과는 분석을 생략합니다. 디코딩 후 15분 또는 PCM 256 MiB 초과도 분석하지 않습니다. 디코딩은 브라우저 API 특성상 전체 버퍼를 일시적으로 필요로 하므로 압축률이 높은 긴 파일은 이 사후 한계 검사 전에 메모리를 사용할 수 있습니다. Worker 계산 제한은 180초이며 실패해도 원본 재생은 유지됩니다.
- WASM 포함 모든 분석 코드는 앱과 함께 로컬 제공/오프라인 precache됩니다. CDN이나 음원 업로드는 없습니다. 번들에는 약 2.56 MB의 Essentia WASM 내장 ESM asset이 추가됩니다.

### Phase 4 파일

| 파일 | 역할 |
| --- | --- |
| `src/analysis/analysisTypes.ts`, `essentia.d.ts` | 결과/상태 계약, 버전, 검증, 설치 API 타입 |
| `src/analysis/audioDecode.ts`, `MusicAnalysisEngine.ts` | 분석 전용 decode/downmix, Worker와 취소/시간 제한 |
| `src/workers/musicAnalysis.worker.ts` | 실제 Essentia BPM/beat/Key 계산, native memory 정리 |
| `src/analysis/analysisCache.ts`, `analysisStore.ts` | fingerprint, IndexedDB, 재분석, 파일 교체/경쟁 조건 차단 |
| `src/analysis/beatTimeline.ts` | 기존 currentTime의 현재 beat 이진 탐색 |
| `src/components/AnalysisSummary.tsx`, `AnalysisSummary.css` | 작은 결과/상태/재분석 영역 |
| `src/components/Player.tsx`, `src/audio/AudioEngine.ts` | 표시, 파일 선택/dispose 연결 |
| `vite.config.ts`, `package.json`, `package-lock.json` | ESM Worker, WASM offline cache, 의존성 |
| `tests/analysis.spec.ts`, `tests/phase4.spec.ts`, `tests/fixtures/analysisAudio.ts` | mock engine 단위 테스트와 실제 파형/WASM 브라우저 테스트 |

Phase 4 테스트는 실제 120 BPM / C Major 합성 PCM을 22.05 kHz에서 44.1 kHz로 리샘플링하여 결과와 beat 시간축을 확인합니다. 별도 mock 테스트는 결과 반올림, 캐시 재사용/갱신, 곡 교체, 지연된 결과/오류/단계, 저장 실패 및 재생 유지를 검증합니다. 무음, 오프라인 신규 분석, CPU 4배 감속 상태에서 재생/seek 및 412→800px 화면 변경도 검사합니다. Galaxy Z Fold7 실기기 성능과 다양한 실제 곡의 정확도는 별도 확인이 필요합니다.

최종 검증(2026-09-29): `npm run build`, `npm run lint` 통과. 전체 Playwright **61개 통과**(기존 49개 + Phase 4 12개), 실패/건너뜀 없음. 실제 24초 fixture에서 화면 BPM 120, C Major, beat 47개를 확인했습니다. CPU 4배 감속 Chromium의 해당 샘플 측정은 약 2.53초였고, 테스트 파일 전달 이후 관측 구간의 최대 프레임 간격은 약 33.4ms, 50ms 이상 long task는 0개였습니다. 이는 테스트 환경의 합성 샘플 결과이며 실기기/긴 곡 처리 시간 보장은 아닙니다.

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
12. Stem Mixer에서 개별 볼륨, Mute / Solo, 여러 Solo, 5개 프리셋을 조작하세요. Original 소스에서는 원본 소리가 그대로이며, 분리 완료 후 Stem Mix에서 실제 stem 소리가 바뀝니다. 다른 곡을 선택하면 모든 채널이 100% / Mute 해제 / Solo 해제로 돌아갑니다.

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

원본 스트리밍 재생은 파일 전체 AudioBuffer 없이 동작합니다. Phase 4/5 분석은 임시 버퍼를 사용하고, Phase 6 Stem Mix는 위에서 설명한 여섯 AudioBuffer를 사용합니다. 파일 교체 시 이전 Object URL과 stem을 해제하고 재생을 멈춥니다. 비동기 작업의 이전 결과는 무시하며 메타데이터와 가사, 현재 beat/chord는 같은 AudioEngine의 playback state에 연결됩니다. Phase 7 이후 개발은 별도 요청에 따라 진행합니다.
