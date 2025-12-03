/**
 * Audio Service
 * Handles Web Speech API helpers shared across the app
 * Includes fallback to Edge TTS for users in regions where Web Speech API may not work
 */

const isBrowser = typeof window !== 'undefined';
const DEFAULT_LANG = 'en-US';
let cachedVoicesPromise: Promise<SpeechSynthesisVoice[]> | null = null;

// Edge TTS configuration
const EDGE_TTS_BASE_URL = 'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices';
const EDGE_TTS_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';

// Google Translate TTS (as an alternative fallback)
// This is a simple TTS service that works in browsers without CORS issues
const GOOGLE_TTS_BASE_URL = 'https://translate.google.com/translate_tts';

// Language mapping for Edge TTS
const EDGE_LANG_MAP: Record<string, string> = {
  'en-US': 'en-US-AriaNeural',
  'en-GB': 'en-GB-SoniaNeural',
  'zh-CN': 'zh-CN-XiaoxiaoNeural',
  'zh-TW': 'zh-TW-HsiaoChenNeural',
  'ja-JP': 'ja-JP-NanamiNeural',
  'ko-KR': 'ko-KR-SunHiNeural',
  'es-ES': 'es-ES-ElviraNeural',
  'fr-FR': 'fr-FR-DeniseNeural',
  'de-DE': 'de-DE-KatjaNeural',
  'it-IT': 'it-IT-ElsaNeural',
  'pt-BR': 'pt-BR-FranciscaNeural',
  'ru-RU': 'ru-RU-SvetlanaNeural',
};

// Cache for Edge TTS voices
let edgeVoicesCache: any[] | null = null;

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
 * Check if Web Speech API is available and working
 */
const isWebSpeechAvailable = (): boolean => {
  return isBrowser && 
         !!window.speechSynthesis && 
         !!window.SpeechSynthesisUtterance;
};

/**
 * Test if Web Speech API actually works (not just available)
 */
const testWebSpeech = async (): Promise<boolean> => {
  if (!isWebSpeechAvailable()) return false;
  
  return new Promise((resolve) => {
    try {
      const testUtterance = new SpeechSynthesisUtterance('');
      let resolved = false;
      
      const cleanup = () => {
        if (resolved) return;
        resolved = true;
        testUtterance.onend = null;
        testUtterance.onerror = null;
        window.speechSynthesis.cancel();
      };
      
      testUtterance.onend = () => {
        cleanup();
        resolve(true);
      };
      
      testUtterance.onerror = () => {
        cleanup();
        resolve(false);
      };
      
      // Set a timeout to avoid hanging
      setTimeout(() => {
        if (!resolved) {
          cleanup();
          resolve(false);
        }
      }, 2000);
      
      window.speechSynthesis.speak(testUtterance);
    } catch {
      resolve(false);
    }
  });
};

/**
 * Get Edge TTS voice for a language
 */
const getEdgeVoice = async (lang: string): Promise<string> => {
  // Use cached mapping first
  if (EDGE_LANG_MAP[lang]) {
    return EDGE_LANG_MAP[lang];
  }
  
  // Try to fetch voices list if not cached
  if (!edgeVoicesCache) {
    try {
      const response = await fetch(
        `${EDGE_TTS_BASE_URL}/list?trustedclienttoken=${EDGE_TTS_TOKEN}`
      );
      if (response.ok) {
        edgeVoicesCache = await response.json();
      }
    } catch (error) {
      console.warn('[TTS] Failed to fetch Edge TTS voices:', error);
    }
  }
  
  // Find matching voice
  if (edgeVoicesCache) {
    const langCode = lang.split('-')[0];
    const match = edgeVoicesCache.find((v: any) => 
      v.Locale === lang || v.Locale?.startsWith(langCode)
    );
    if (match) {
      return match.ShortName || match.Name;
    }
  }
  
  // Fallback to default
  return EDGE_LANG_MAP['en-US'] || 'en-US-AriaNeural';
};

/**
 * Speak text using Google Translate TTS (simple fallback)
 * This is a basic TTS that works without CORS issues in most cases
 * Uses Audio element directly, which bypasses CORS restrictions
 */
const speakWithGoogleTTS = async (
  text: string,
  options?: {
    lang?: string;
    rate?: number;
    pitch?: number;
    volume?: number;
  }
): Promise<void> => {
  const resolvedLang = options?.lang || DEFAULT_LANG;
  // Convert language code (e.g., 'en-US' -> 'en', 'zh-CN' -> 'zh')
  const langCode = resolvedLang.split('-')[0];
  
  // Google TTS has character limit (~200 chars), split long text
  const maxLength = 200;
  const chunks: string[] = [];
  const words = text.split(/\s+/);
  let currentChunk = '';
  
  // Split by words to avoid breaking words
  for (const word of words) {
    if ((currentChunk + ' ' + word).length > maxLength && currentChunk) {
      chunks.push(currentChunk.trim());
      currentChunk = word;
    } else {
      currentChunk = currentChunk ? currentChunk + ' ' + word : word;
    }
  }
  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }
  
  if (chunks.length === 0) return;
  
  try {
    // Play chunks sequentially
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk.trim()) continue;
      
      // Google TTS URL - using Audio element directly bypasses CORS
      const url = `${GOOGLE_TTS_BASE_URL}?ie=UTF-8&tl=${langCode}&client=tw-ob&q=${encodeURIComponent(chunk)}`;
      
      const audio = new Audio(url);
      audio.volume = options?.volume ?? 1;
      
      // Adjust playback rate if supported
      if (options?.rate && 'playbackRate' in audio) {
        audio.playbackRate = Math.max(0.5, Math.min(2.0, options.rate));
      }
      
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Google TTS playback timeout'));
        }, 30000); // 30 second timeout
        
        audio.onended = () => {
          clearTimeout(timeout);
          resolve();
        };
        
        audio.onerror = (error) => {
          clearTimeout(timeout);
          console.error('[TTS] Google TTS audio error:', error);
          reject(new Error('Google TTS playback failed'));
        };
        
        audio.play().catch((playError) => {
          clearTimeout(timeout);
          reject(playError);
        });
      });
    }
  } catch (error) {
    console.error('[TTS] Google TTS failed:', error);
    throw error;
  }
};

/**
 * Speak text using Edge TTS
 * Uses Microsoft Edge TTS API via HTTP - works in any browser (Chrome, Firefox, Safari, etc.)
 * Note: Edge TTS is a web API service, NOT tied to Edge browser
 * Note: May have CORS restrictions - will fallback to Google TTS if needed
 */
const speakWithEdgeTTS = async (
  text: string,
  options?: {
    lang?: string;
    rate?: number;
    pitch?: number;
    volume?: number;
  }
): Promise<void> => {
  const resolvedLang = options?.lang || DEFAULT_LANG;
  const voice = await getEdgeVoice(resolvedLang);
  
  // Convert rate to Edge TTS format (0.5x to 2.0x)
  const rate = options?.rate ?? 0.95;
  const edgeRate = Math.max(0.5, Math.min(2.0, rate));
  
  // Build SSML for Edge TTS
  const ssml = `<speak version='1.0' xml:lang='${resolvedLang}'>
    <voice xml:lang='${resolvedLang}' name='${voice}'>
      <prosody rate='${edgeRate.toFixed(2)}x'>
        ${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}
      </prosody>
    </voice>
  </speak>`;
  
  // Try direct Edge TTS API
  // Note: Edge TTS API may have CORS restrictions in some browsers
  try {
    const response = await fetch(
      `${EDGE_TTS_BASE_URL}/v3?TrustedClientToken=${EDGE_TTS_TOKEN}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
        },
        body: ssml,
        mode: 'cors',
      }
    );
    
    if (!response.ok) {
      throw new Error(`Edge TTS request failed: ${response.status}`);
    }
    
    const audioBlob = await response.blob();
    if (audioBlob.size === 0) {
      throw new Error('Empty audio response');
    }
    
    return playAudioBlob(audioBlob, options?.volume);
  } catch (error: any) {
    console.warn('[TTS] Edge TTS failed (likely CORS), trying Google TTS fallback:', error);
    
    // Fallback to Google TTS if Edge TTS fails
    try {
      return await speakWithGoogleTTS(text, options);
    } catch (googleError) {
      console.error('[TTS] All TTS methods failed:', googleError);
      throw new Error('TTS服务暂时不可用。可能的原因：1) 网络连接问题，2) CORS限制，3) 服务暂时不可用。建议：使用VPN或配置代理服务器。');
    }
  }
};

/**
 * Helper function to play an audio blob
 */
const playAudioBlob = (audioBlob: Blob, volume?: number): Promise<void> => {
  const audioUrl = URL.createObjectURL(audioBlob);
  const audio = new Audio(audioUrl);
  audio.volume = volume ?? 1;
  
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      URL.revokeObjectURL(audioUrl);
      audio.onended = null;
      audio.onerror = null;
    };
    
    audio.onended = () => {
      cleanup();
      resolve();
    };
    
    audio.onerror = (error) => {
      cleanup();
      reject(error);
    };
    
    audio.play().catch((playError) => {
      cleanup();
      reject(playError);
    });
  });
};

// Cache for Web Speech availability test
let webSpeechTestResult: boolean | null = null;
let webSpeechTestPromise: Promise<boolean> | null = null;

/**
 * Test Web Speech API availability (with caching)
 */
const getWebSpeechAvailability = async (): Promise<boolean> => {
  if (webSpeechTestResult !== null) {
    return webSpeechTestResult;
  }
  
  if (webSpeechTestPromise) {
    return webSpeechTestPromise;
  }
  
  webSpeechTestPromise = testWebSpeech().then(result => {
    webSpeechTestResult = result;
    webSpeechTestPromise = null;
    return result;
  });
  
  return webSpeechTestPromise;
};

/**
 * Unified helper to speak text via Web Speech API with graceful fallbacks.
 * Automatically falls back to Edge TTS if Web Speech API is unavailable or fails.
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
  // Try Web Speech API first
  if (isWebSpeechAvailable()) {
    try {
      const isAvailable = await getWebSpeechAvailability();
      if (isAvailable) {
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

        try {
          await new Promise<void>((resolve, reject) => {
            utterance.onend = () => resolve();
            utterance.onerror = (event) => reject(event.error || new Error('Speech synthesis failed.'));
            window.speechSynthesis.speak(utterance);
            
            // Timeout fallback
            setTimeout(() => {
              if (window.speechSynthesis.speaking) {
                window.speechSynthesis.cancel();
                reject(new Error('Speech synthesis timeout'));
              }
            }, 30000);
          });
          return; // Success, return early
        } catch (error) {
          console.warn('[TTS] Web Speech API failed, falling back to Edge TTS:', error);
          // Fall through to Edge TTS
        }
      }
    } catch (error) {
      console.warn('[TTS] Web Speech API test failed, using Edge TTS:', error);
      // Fall through to Edge TTS
    }
  }
  
  // Fallback to Edge TTS
  await speakWithEdgeTTS(text, options);
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

