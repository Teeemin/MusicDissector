// Adapted from elicwhite/bs-roformer-web, commit c6047cd (MIT).
// Copyright (c) 2026 Eli White. See THIRD_PARTY_NOTICES.md.
export interface StftSettings { nFft: number; hopLength: number; winLength: number }
export interface IstftInput extends StftSettings { id?: number; realBuf: ArrayBuffer; imagBuf: ArrayBuffer; realOffset?: number; imagOffset?: number; numStems: number; numChannels: number; F: number; T: number; length: number }
/**
 * Per-chunk STFT and iSTFT, called sequentially inside the separation Worker.
 * iSTFT processes all stems with shared cached windows and normalization.
 *
 * `audioBuf` layout is Float32 [numStems, numChannels, length] planar per
 * (stem, channel).
 */

import { fftRadix2InPlace } from './fft';

// ----- Shared helpers -----
function makeHannWindow(n: number) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / n));
  return w;
}

// Reflect index into [0, len). Used to emulate torch.stft(center=True).
function reflectIndex(i: number, len: number) {
  if (i >= 0 && i < len) return i;
  if (len === 1) return 0;
  const period = 2 * (len - 1);
  i = ((i % period) + period) % period;
  return i < len ? i : period - i;
}

// ----- Forward STFT (matches torch.stft center=True, normalized=False, hann) -----
export function stftStereo(planarAudio: Float32Array, { nFft, hopLength, winLength }: StftSettings) {
  const numSamples = planarAudio.length / 2;
  const numChannels = 2;
  const window = makeHannWindow(winLength);
  const halfNFft = Math.floor(nFft / 2);
  const T = Math.floor(numSamples / hopLength) + 1;
  const F = halfNFft + 1;
  const real = new Float32Array(numChannels * F * T);
  const imag = new Float32Array(numChannels * F * T);
  const fftBuf = new Float32Array(nFft * 2);

  for (let c = 0; c < numChannels; c++) {
    const chanOffset = c * numSamples;
    for (let t = 0; t < T; t++) {
      const frameStart = t * hopLength - halfNFft; // can be negative → reflect
      for (let i = 0; i < nFft; i++) {
        const srcIdx = reflectIndex(frameStart + i, numSamples);
        fftBuf[i * 2]     = planarAudio[chanOffset + srcIdx] * window[i];
        fftBuf[i * 2 + 1] = 0;
      }
      fftRadix2InPlace(fftBuf, nFft);
      for (let k = 0; k < F; k++) {
        real[(c * F + k) * T + t] = fftBuf[k * 2];
        imag[(c * F + k) * T + t] = fftBuf[k * 2 + 1];
      }
    }
  }
  return { real, imag, F, T };
}

// ----- iSTFT cache: window·invN and 1/windowSum precomputed per signature -----
const cache = new Map<string, { windowInvN: Float32Array; invWindowSum: Float32Array; paddedLen: number; pad: number }>();
function getCached(nFft: number, T: number, hopLength: number, winLength: number) {
  const key = `${nFft}-${T}-${hopLength}-${winLength}`;
  let entry = cache.get(key);
  if (entry) return entry;
  const window = makeHannWindow(winLength);
  const pad = Math.floor(nFft / 2);
  const paddedLen = (T - 1) * hopLength + nFft;
  const windowSum = new Float32Array(paddedLen);
  for (let t = 0; t < T; t++) {
    const frameStart = t * hopLength;
    for (let i = 0; i < nFft; i++) windowSum[frameStart + i] += window[i] * window[i];
  }
  const invN = 1 / nFft;
  const windowInvN = new Float32Array(nFft);
  for (let i = 0; i < nFft; i++) windowInvN[i] = window[i] * invN;
  const invWindowSum = new Float32Array(paddedLen);
  for (let i = 0; i < paddedLen; i++) {
    invWindowSum[i] = windowSum[i] > 1e-8 ? 1 / windowSum[i] : 0;
  }
  entry = { windowInvN, invWindowSum, paddedLen, pad };
  cache.set(key, entry);
  return entry;
}

// ----- Batched iSTFT for all (stem, channel) slices in one call -----
export function istftBatch(msg: IstftInput) {
  const t0 = performance.now();
  const { realBuf, imagBuf, numStems, numChannels, F, T, length,
          nFft, hopLength, winLength } = msg;

  const real = new Float32Array(realBuf, msg.realOffset ?? 0, numStems * numChannels * F * T);
  const imag = new Float32Array(imagBuf, msg.imagOffset ?? 0, numStems * numChannels * F * T);
  const { windowInvN, invWindowSum, paddedLen, pad } = getCached(nFft, T, hopLength, winLength);

  const audio = new Float32Array(numStems * numChannels * length);
  const fftBuf = new Float32Array(nFft * 2);
  const padded = new Float32Array(paddedLen);
  const sliceStride = F * T;
  const perStemStride = numChannels * sliceStride;

  for (let s = 0; s < numStems; s++) {
    for (let c = 0; c < numChannels; c++) {
      const inOff = s * perStemStride + c * sliceStride;
      padded.fill(0);

      for (let t = 0; t < T; t++) {
        // iFFT via FFT(conj(X)) / N. Fill positive bins and mirror negatives
        // in one fused loop so we skip the leading fftBuf.fill(0).
        // bin 0 (DC) and bin F-1 (Nyquist) don't have negative mirrors.
        fftBuf[0] =  real[inOff + 0 * T + t];
        fftBuf[1] = -imag[inOff + 0 * T + t];
        fftBuf[(F - 1) * 2]     =  real[inOff + (F - 1) * T + t];
        fftBuf[(F - 1) * 2 + 1] = -imag[inOff + (F - 1) * T + t];
        for (let k = 1; k < F - 1; k++) {
          const idx = inOff + k * T + t;
          const re =  real[idx];
          const im = -imag[idx];
          fftBuf[k * 2]     = re;
          fftBuf[k * 2 + 1] = im;
          const mirror = nFft - k;
          fftBuf[mirror * 2]     =  re;
          fftBuf[mirror * 2 + 1] = -im;
        }
        // Keep every conjugate mirror bin; Nyquist was already set at F-1.
        fftRadix2InPlace(fftBuf, nFft);

        const frameStart = t * hopLength;
        for (let i = 0; i < nFft; i++) {
          padded[frameStart + i] += fftBuf[i * 2] * windowInvN[i];
        }
      }

      const outOff = s * numChannels * length + c * length;
      for (let i = 0; i < length; i++) {
        audio[outOff + i] = padded[pad + i] * invWindowSum[pad + i];
      }
    }
  }

  return {
    id: msg.id, type: 'istft-batch',
    audioBuf: audio.buffer,
    numStems, numChannels, length,
    elapsedMs: performance.now() - t0,
  };
}
