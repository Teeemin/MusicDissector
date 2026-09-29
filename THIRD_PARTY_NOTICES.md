# Third-party sources and licenses

## BS-RoFormer browser DSP code

Source: https://github.com/elicwhite/bs-roformer-web
Reviewed revision: `c6047cd28c41f803339e9b8a5775a56932de7157`.
`src/separation/dsp/fft.ts` and `stft.ts` adapt `docs/fft-radix2.js` and
`docs/stft-worker.js`. Changes: TypeScript signatures, direct function exports,
ORT array byte offsets, correction of the conjugate mirror bin in iSTFT.
Chunk settings, linear overlap-add and the browser model contract also follow
the upstream pipeline. This app uses one sequential Worker instead of its pool.

MIT License

Copyright (c) 2026 Eli White

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## ONNX Runtime Web

`onnxruntime-web` and `onnxruntime-common`:
`1.24.0-dev.20251116-b39e144322` (same version as the reference implementation).
Source: https://github.com/microsoft/onnxruntime
License: MIT, Copyright (c) Microsoft Corporation.
The MIT permission/warranty text above also applies with this copyright owner.
Full upstream license: https://github.com/microsoft/onnxruntime/blob/b39e144322/LICENSE
Bundled dependency notices: https://github.com/microsoft/onnxruntime/blob/b39e144322/ThirdPartyNotices.txt
This dependency executes locally in the browser;
it is not a cloud separation service.

## ONNX export and original model weights

Export: https://huggingface.co/elicwhite/bs-roformer-sw-6stem-onnx
Revision: `a744f80957374e1735ad70fa122670b7961da8cc`.
File: `bs_roformer_sw_6stem_fp16.onnx`, 352,778,874 bytes.
SHA-256: `d3d2bac77a7023282cb5f35a5807179e34076b60589867b572275f1a8ec36444`.

The export repository's metadata labels it MIT. **This does not establish a
clear license for the original trained weights.** The upstream implementation
identifies the checkpoint source as
https://huggingface.co/jarredou/BS-ROFO-SW-Fixed ; an explicit applicable license
for those original weights was not established during this integration.
Do not infer weight redistribution/commercial rights from the browser code's
MIT license. The model is fetched directly, only after the user's download
action, and is not committed or bundled with this project.

## Existing runtime dependencies

- React / React DOM: MIT, https://github.com/facebook/react
- music-metadata: MIT, https://github.com/Borewit/music-metadata
- Essentia.js / Essentia: AGPL-3.0 (commercial licensing separately available),
  https://github.com/MTG/essentia.js and https://essentia.upf.edu/licensing_information.html

These existing licenses remain applicable; adding MIT-licensed inference/DSP
does not relicense the earlier analysis dependencies. Full installed package
license texts are available from the linked upstream distributions. Lockfile records the
exact dependency graph. Project-authored synthetic test tones contain no
third-party music recording.
