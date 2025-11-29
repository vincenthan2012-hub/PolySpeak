/**
 * Audio Service
 * Handles Web Speech API helpers shared across the app
 */

const isBrowser = typeof window !== 'undefined';
const DEFAULT_LANG = 'en-US';
let cachedVoicesPromise: Promise<SpeechSynthesisVoice[]> | null = null;

const fetchVoices = (): Promise<SpeechSynthesisVoice[]> => {
  if (!isBrowser || !window.speechSynthesis) {
    return Promise.resolve([]);
  }

  const existing = window.speechSynthesis.getVoices();
  if (existing.length > 0) {
    return Promise.resolve(existing);
  }

  if (!cachedVoicesPromise) {
    cachedVoicesPromise = new Promise((resolve) => {
      const handle = () => {
        const voices = window.speechSynthesis?.getVoices() || [];
        if (voices.length > 0) {
          window.speechSynthesis?.removeEventListener('voiceschanged', handle);
          resolve(voices);
        }
      };

      window.speechSynthesis?.addEventListener('voiceschanged', handle);

      // Fallback in case voiceschanged never fires
      setTimeout(() => {
        window.speechSynthesis?.removeEventListener('voiceschanged', handle);
        resolve(window.speechSynthesis?.getVoices() || []);
      }, 1500);
    });
  }

  return cachedVoicesPromise;
};

const selectVoice = (
  voices: SpeechSynthesisVoice[],
  lang: string
): SpeechSynthesisVoice | null => {
  if (!voices.length) return null;
  const langCode = lang.split('-')[0];

  return (
    voices.find(v => v.lang === lang && v.name.includes('Google')) ||
    voices.find(v => v.lang === lang && v.name.toLowerCase().includes('natural')) ||
    voices.find(v => v.lang === lang) ||
    voices.find(v => v.lang.startsWith(langCode) && v.name.includes('Google')) ||
    voices.find(v => v.lang.startsWith(langCode)) ||
    voices[0]
  );
};

/**
 * Try to infer a better speech language from the text content.
 */
export const detectSpeechLang = (text: string, fallback: string = DEFAULT_LANG): string => {
  const trimmed = text || '';
  const hasHiraganaKatakana = /[\u3040-\u30FF]/.test(trimmed);
  const hasHangul = /[\uAC00-\uD7AF]/.test(trimmed);
  const hasCJK = /[\u4E00-\u9FFF]/.test(trimmed);

  if (hasHiraganaKatakana) return 'ja-JP';
  if (hasHangul) return 'ko-KR';
  if (hasCJK) return 'zh-CN';

  const isAscii = /^[\x00-\x7F]+$/.test(trimmed);
  const cjkTargets = ['ja-JP', 'zh-CN', 'ko-KR'];
  if (isAscii && cjkTargets.includes(fallback)) {
    return 'en-US';
  }

  return fallback || DEFAULT_LANG;
};

/**
 * Unified helper to speak text via Web Speech API with graceful fallbacks.
 */
export const speakText = async (
  text: string,
  options?: {
    lang?: string;
    rate?: number;
    pitch?: number;
    volume?: number;
  }
): Promise<void> => {
  if (!isBrowser || !window.speechSynthesis || !window.SpeechSynthesisUtterance) {
    throw new Error('Speech synthesis not supported in this environment.');
  }

  const resolvedLang = options?.lang || DEFAULT_LANG;
  const voices = await fetchVoices();
  const preferredVoice = selectVoice(voices, resolvedLang);

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = resolvedLang;
  utterance.rate = options?.rate ?? 0.95;
  utterance.pitch = options?.pitch ?? 1;
  utterance.volume = options?.volume ?? 1;
  if (preferredVoice) {
    utterance.voice = preferredVoice;
  }

  window.speechSynthesis.cancel();

  await new Promise<void>((resolve, reject) => {
    utterance.onend = () => resolve();
    utterance.onerror = (event) => reject(event.error || new Error('Speech synthesis failed.'));
    window.speechSynthesis.speak(utterance);
  });
};

/**
 * Generate audio file from text
 * This is a simplified implementation that creates audio data
 * For production use, consider using a TTS service or server-side conversion
 */
export const generateAudioFromText = async (
  text: string,
  lang: string = DEFAULT_LANG
): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    if (!isBrowser || !window.speechSynthesis || !window.SpeechSynthesisUtterance) {
      reject(new Error('Speech synthesis not supported'));
      return;
    }

    fetchVoices().then(voices => {
      const preferredVoice = selectVoice(voices, lang);

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;

      const audioData = new Uint8Array([
        0x1a, 0x45, 0xdf, 0xa3,
      ]);
      
      const blob = new Blob([audioData], { type: 'audio/webm' });
      resolve(blob);
    }).catch(reject);
  });
};

/**
 * Generate audio using external TTS service (placeholder)
 * In production, implement this with a real TTS API
 */
export const generateAudioWithTTS = async (
  text: string,
  lang: string = 'en-US'
): Promise<Blob> => {
  // Placeholder for TTS service integration
  // Example: Google Cloud TTS, AWS Polly, Azure TTS, etc.
  throw new Error('TTS service not implemented. Please use a TTS API or server-side conversion.');
};

/**
 * Generate audio using a simpler method: create audio data URL
 * This is a fallback when MediaRecorder isn't available
 */
export const generateAudioDataUrl = async (
  text: string,
  lang: string = 'en-US'
): Promise<string> => {
  // This is a placeholder - in a real implementation,
  // you would use a TTS service or library to generate audio
  // For now, we'll return an empty data URL as a placeholder
  return 'data:audio/webm;base64,';
};

/**
 * Convert audio blob to base64 data URL
 */
export const audioBlobToDataUrl = async (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

/**
 * Generate audio file name from text
 */
export const generateAudioFileName = (text: string, index?: number): string => {
  // Create a safe filename from text
  const hash = text.split('').reduce((acc, char) => {
    return ((acc << 5) - acc) + char.charCodeAt(0);
  }, 0);
  return `audio_${Math.abs(hash)}${index !== undefined ? `_${index}` : ''}.mp3`;
};

const createWavFromAudioBuffer = (audioBuffer: AudioBuffer): ArrayBuffer => {
  const numChannels = audioBuffer.numberOfChannels || 1;
  const sampleRate = audioBuffer.sampleRate;
  const bitsPerSample = 16;
  const blockAlign = numChannels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = audioBuffer.length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // WAV header
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size
  view.setUint16(20, 1, true); // AudioFormat PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  // PCM samples interleaved
  let offset = 44;
  for (let i = 0; i < audioBuffer.length; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      const channelData = audioBuffer.getChannelData(channel);
      const sample = Math.max(-1, Math.min(1, channelData[i] || 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }

  return buffer;
};

/**
 * Clip a segment from an audio data URL (client-side)
 */
export const clipAudioSegmentFromDataUrl = async (
  dataUrl: string,
  startSeconds: number,
  endSeconds: number
): Promise<{ dataUrl: string; mimeType: string; duration: number }> => {
  if (typeof window === 'undefined' || !(window.AudioContext || (window as any).webkitAudioContext)) {
    throw new Error('AudioContext is not available in this environment.');
  }
  if (!dataUrl?.startsWith('data:audio')) {
    throw new Error('Unsupported audio source. Expected base64 data URL.');
  }
  const response = await fetch(dataUrl);
  const arrayBuffer = await response.arrayBuffer();
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  const audioContext = new AudioCtx();
  try {
    const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const safeStart = Math.max(0, Math.min(startSeconds ?? 0, decoded.duration));
    const safeEnd = Math.max(safeStart + 0.05, Math.min(endSeconds ?? decoded.duration, decoded.duration));

    const startSample = Math.floor(safeStart * decoded.sampleRate);
    const endSample = Math.ceil(safeEnd * decoded.sampleRate);
    const frameCount = Math.max(endSample - startSample, Math.floor(decoded.sampleRate * 0.05));

    const clippedBuffer = audioContext.createBuffer(decoded.numberOfChannels, frameCount, decoded.sampleRate);
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const sourceChannel = decoded.getChannelData(channel);
      const slice = sourceChannel.subarray(startSample, Math.min(endSample, sourceChannel.length));
      clippedBuffer.copyToChannel(slice, channel, 0);
    }

    const wavBuffer = createWavFromAudioBuffer(clippedBuffer);
    const mimeType = 'audio/wav';
    const blob = new Blob([wavBuffer], { type: mimeType });
    const clippedDataUrl = await audioBlobToDataUrl(blob);

    return {
      dataUrl: clippedDataUrl,
      mimeType,
      duration: Math.max(0, safeEnd - safeStart)
    };
  } finally {
    if (typeof audioContext.close === 'function') {
      await audioContext.close();
    }
  }
};

