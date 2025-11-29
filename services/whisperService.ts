import { pipeline, env } from '@xenova/transformers';
import { WhisperConfig, WhisperTranscription, WhisperSegment } from '../types';

// Configure transformers for browser environment
env.allowLocalModels = false;
env.allowRemoteModels = true;
// Use cache directory in browser's IndexedDB
env.useBrowserCache = true;
env.useCustomCache = true;

// Cache for the pipeline instance
let whisperPipeline: any = null;
let currentModel: string | null = null;

const waitForDocumentVisible = async () => {
  if (typeof document === 'undefined') return;
  if (!document.hidden) return;
  await new Promise<void>((resolve) => {
    const handle = () => {
      if (!document.hidden) {
        document.removeEventListener('visibilitychange', handle);
        resolve();
      }
    };
    document.addEventListener('visibilitychange', handle, { passive: true });
  });
};

/**
 * Initialize Whisper pipeline with the specified model
 */
const initializeWhisper = async (model: string): Promise<any> => {
  if (whisperPipeline && currentModel === model) {
    console.log(`[Whisper] Using cached model: ${model}`);
    return whisperPipeline;
  }

  try {
    console.log(`[Whisper] Loading model: ${model}...`);
    console.log(`[Whisper] This may take a while on first use (downloading from CDN)...`);
    
    whisperPipeline = await pipeline(
      'automatic-speech-recognition',
      `Xenova/whisper-${model}`,
      {
        progress_callback: (progress: any) => {
          if (progress.status === 'progress') {
            console.log(`[Whisper] Download progress: ${Math.round(progress.progress * 100)}%`);
          }
        }
      }
    );
    
    currentModel = model;
    console.log(`[Whisper] Model ${model} loaded successfully`);
    
    // Verify pipeline is working by checking if it has the expected methods
    if (!whisperPipeline || typeof whisperPipeline !== 'function') {
      throw new Error('Pipeline initialization failed - pipeline is not a function');
    }
    
    return whisperPipeline;
  } catch (error) {
    console.error('[Whisper] Error initializing Whisper:', error);
    whisperPipeline = null;
    currentModel = null;
    throw new Error(
      `Failed to load Whisper model: ${model}.\n` +
      `Error: ${error instanceof Error ? error.message : 'Unknown error'}\n\n` +
      `Please check:\n` +
      `1. Network connection (model needs to be downloaded)\n` +
      `2. Browser compatibility (Chrome/Edge recommended)\n` +
      `3. Try a smaller model (tiny or base)`
    );
  }
};

/**
 * Convert base64 audio to ArrayBuffer
 */
const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
};

/**
 * Convert AudioBuffer to Float32Array (for direct use with Whisper)
 */
const audioBufferToFloat32Array = (audioBuffer: AudioBuffer): Float32Array => {
  // If already mono, return first channel
  if (audioBuffer.numberOfChannels === 1) {
    return audioBuffer.getChannelData(0);
  }
  
  // Convert to mono by averaging channels
  const leftChannel = audioBuffer.getChannelData(0);
  const rightChannel = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : leftChannel;
  const mono = new Float32Array(audioBuffer.length);
  
  for (let i = 0; i < audioBuffer.length; i++) {
    mono[i] = (leftChannel[i] + rightChannel[i]) / 2;
  }
  
  return mono;
};

/**
 * Convert webm audio blob to wav format for Whisper
 * Note: This is a simplified conversion. For production, consider using a proper audio converter.
 */
const convertWebmToWav = async (webmData: ArrayBuffer): Promise<ArrayBuffer> => {
  try {
    console.log('[Whisper] Converting audio format, size:', webmData.byteLength, 'bytes');
    
    // Create an AudioContext to decode the audio
    await waitForDocumentVisible();
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (audioContext.state === 'suspended') {
      try {
        await audioContext.resume();
      } catch (resumeError) {
        console.warn('[Whisper] Failed to resume AudioContext:', resumeError);
      }
    }
    
    // Check if audio is valid
    if (webmData.byteLength === 0) {
      throw new Error('Audio data is empty');
    }
    
    const audioBuffer = await audioContext.decodeAudioData(webmData.slice(0));
    
    console.log('[Whisper] Audio decoded:', {
      sampleRate: audioBuffer.sampleRate,
      duration: audioBuffer.duration,
      channels: audioBuffer.numberOfChannels,
      length: audioBuffer.length
    });
    
    // Check if audio is too short
    if (audioBuffer.duration < 0.5) {
      throw new Error('Audio is too short (less than 0.5 seconds). Please record for at least 1-2 seconds.');
    }
    
    // Convert to mono 16kHz PCM (Whisper's preferred format)
    const sampleRate = 16000;
    const numChannels = 1;
    const length = audioBuffer.length * (sampleRate / audioBuffer.sampleRate);
    const newBuffer = audioContext.createBuffer(numChannels, length, sampleRate);
    
    // Resample and convert to mono
    const sourceData = audioBuffer.getChannelData(0);
    const targetData = newBuffer.getChannelData(0);
    const ratio = audioBuffer.sampleRate / sampleRate;
    
    for (let i = 0; i < length; i++) {
      const srcIndex = Math.floor(i * ratio);
      targetData[i] = sourceData[srcIndex];
    }
    
    // Convert to WAV format
    const wavBuffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(wavBuffer);
    
    // WAV header
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, length * 2, true);
    
    // Convert float samples to 16-bit PCM
    let offset = 44;
    for (let i = 0; i < length; i++) {
      const sample = Math.max(-1, Math.min(1, targetData[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
    
    return wavBuffer;
  } catch (error) {
    console.warn('Error converting audio format, trying direct approach:', error);
    // Fallback: return original data (Whisper might still work)
    return webmData;
  }
};

/**
 * Normalize chunk text spacing
 */
const sanitizeChunkText = (text: string | undefined): string => {
  if (!text || typeof text !== 'string') return '';
  return text.replace(/\s+/g, ' ').trim();
};

/**
 * Convert Whisper chunks/segments to timeline info
 */
const buildSegmentsFromResult = (result: any): WhisperSegment[] => {
  const rawChunks = Array.isArray(result?.chunks)
    ? result.chunks
    : Array.isArray(result?.segments)
      ? result.segments
      : [];

  if (!rawChunks.length) return [];

  return rawChunks
    .map((chunk: any, index: number) => {
      const text = sanitizeChunkText(chunk?.text || chunk?.sentence);
      if (!text) return null;

      let start: number | undefined;
      let end: number | undefined;
      const timestamp = Array.isArray(chunk?.timestamp)
        ? chunk.timestamp
        : Array.isArray(chunk?.timestamps)
          ? chunk.timestamps
          : null;

      if (timestamp) {
        start = typeof timestamp[0] === 'number' ? timestamp[0] : undefined;
        end = typeof timestamp[1] === 'number' ? timestamp[1] : undefined;
      } else {
        start = typeof chunk?.start === 'number' ? chunk.start : undefined;
        end = typeof chunk?.end === 'number' ? chunk.end : undefined;
      }

      if (start !== undefined && end === undefined && typeof chunk?.duration === 'number') {
        end = start + chunk.duration;
      }

      if (start === undefined && typeof chunk?.offset === 'number') {
        start = chunk.offset;
      }

      return {
        id: chunk?.id ? String(chunk.id) : `chunk-${index}`,
        text,
        start,
        end
      } as WhisperSegment;
    })
    .filter((segment): segment is WhisperSegment => Boolean(segment));
};

/**
 * Extract transcription and segments from pipeline result
 */
const extractTranscriptionResult = (result: any): WhisperTranscription => {
  if (!result) return { text: '', segments: [] };

  if (typeof result === 'string') {
    return { text: result.trim(), segments: [] };
  }

  const directText = sanitizeChunkText(result.text);
  const chunkText = Array.isArray(result?.chunks)
    ? result.chunks
        .map((chunk: any) => sanitizeChunkText(chunk?.text))
        .filter(Boolean)
        .join(' ')
        .trim()
    : '';

  const text = directText || chunkText;
  const segments = buildSegmentsFromResult(result);

  if (!text && !segments.length) {
    console.warn('[Whisper] Unexpected result format:', result);
  }

  return {
    text,
    segments
  };
};

/**
 * Transcribe audio using local Whisper model
 * @param audioBase64 Base64 encoded audio (webm format)
 * @param config Whisper configuration
 * @returns Transcribed text
 */
export const transcribeAudio = async (
  audioBase64: string,
  config: WhisperConfig
): Promise<WhisperTranscription> => {
  if (!config.enabled) {
    throw new Error('Whisper is not enabled');
  }

  try {
    // Initialize pipeline if needed
    const pipeline = await initializeWhisper(config.model);
    
    // Convert base64 to ArrayBuffer
    console.log('[Whisper] Base64 length:', audioBase64.length);
    const audioArrayBuffer = base64ToArrayBuffer(audioBase64);
    console.log('[Whisper] ArrayBuffer size:', audioArrayBuffer.byteLength, 'bytes');
    
    // Decode audio first to get AudioBuffer
    let audioBuffer: AudioBuffer;
    try {
      await waitForDocumentVisible();
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (audioContext.state === 'suspended') {
        try {
          await audioContext.resume();
        } catch (resumeError) {
          console.warn('[Whisper] Failed to resume AudioContext:', resumeError);
        }
      }
      audioBuffer = await audioContext.decodeAudioData(audioArrayBuffer.slice(0));
      console.log('[Whisper] Audio decoded:', {
        sampleRate: audioBuffer.sampleRate,
        duration: audioBuffer.duration,
        channels: audioBuffer.numberOfChannels
      });
      
      // Check if audio is too short
      if (audioBuffer.duration < 0.5) {
        throw new Error('Audio is too short (less than 0.5 seconds). Please record for at least 1-2 seconds.');
      }
    } catch (decodeError) {
      console.error('[Whisper] Failed to decode audio:', decodeError);
      throw new Error(`Failed to decode audio: ${decodeError instanceof Error ? decodeError.message : 'Unknown error'}`);
    }
    
    // Helper to invoke Whisper pipeline with consistent settings
    const invokePipeline = async (input: string | File): Promise<WhisperTranscription> => {
      const transcriptionPromise = pipeline(input, {
        language: config.language || null,
        task: 'transcribe',
        chunk_length_s: 30,
        return_timestamps: true,
      });

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Timeout')), 60000);
      });

      const result = await Promise.race([transcriptionPromise, timeoutPromise]) as any;
      return extractTranscriptionResult(result);
    };
    
    // Try multiple approaches to transcribe
    // Approach 1: Convert to WAV and use blob URL
    try {
      console.log('[Whisper] Attempting WAV conversion approach...');
      const processedAudio = await convertWebmToWav(audioArrayBuffer);
      const audioBlob = new Blob([processedAudio], { type: 'audio/wav' });
      const audioUrl = URL.createObjectURL(audioBlob);
      
      try {
        const transcriptionResult = await invokePipeline(audioUrl);
        if (transcriptionResult.text) {
          console.log('[Whisper] Transcription successful with WAV format:', transcriptionResult.text.substring(0, 50));
          return transcriptionResult;
        }
      } catch (pipelineError) {
        console.warn('[Whisper] Pipeline call failed:', pipelineError);
        throw pipelineError;
      } finally {
        URL.revokeObjectURL(audioUrl);
      }
    } catch (wavError) {
      console.warn('[Whisper] WAV approach failed:', wavError);
    }
    
    // Approach 2: Use original WebM format
    try {
      console.log('[Whisper] Attempting WebM format approach...');
      const originalBlob = new Blob([audioArrayBuffer], { type: 'audio/webm' });
      const originalUrl = URL.createObjectURL(originalBlob);
      
      try {
        const transcriptionResult = await invokePipeline(originalUrl);
        if (transcriptionResult.text) {
          console.log('[Whisper] Transcription successful with WebM format:', transcriptionResult.text.substring(0, 50));
          return transcriptionResult;
        }
      } finally {
        URL.revokeObjectURL(originalUrl);
      }
    } catch (webmError) {
      console.warn('[Whisper] WebM approach failed:', webmError);
    }
    
    // Approach 3: Use File object
    try {
      console.log('[Whisper] Attempting File object approach...');
      const audioBlob = new Blob([audioArrayBuffer], { type: 'audio/webm' });
      const audioFile = new File([audioBlob], 'audio.webm', { type: 'audio/webm' });
      
      const transcriptionResult = await invokePipeline(audioFile);
      if (transcriptionResult.text) {
        console.log('[Whisper] Transcription successful with File object:', transcriptionResult.text.substring(0, 50));
        return transcriptionResult;
      }
    } catch (fileError) {
      console.warn('[Whisper] File object approach failed:', fileError);
    }
    
    // If all approaches failed, provide detailed error
    console.error('[Whisper] All transcription approaches failed');
    console.error('[Whisper] Audio info:', {
      duration: audioBuffer.duration,
      sampleRate: audioBuffer.sampleRate,
      channels: audioBuffer.numberOfChannels,
      size: audioArrayBuffer.byteLength
    });
    
    throw new Error(
      'Whisper transcription failed. Possible reasons:\n' +
      '1. Audio is too quiet or has no speech\n' +
      '2. Language setting doesn\'t match the spoken language\n' +
      '3. Model is still loading (first time use)\n' +
      '4. Browser compatibility issue\n\n' +
      'Please check the browser console (F12) for detailed error messages.'
    );
    
  } catch (error) {
    console.error('Error transcribing audio with Whisper:', error);
    throw new Error(`Whisper transcription failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Get available Whisper models
 */
export const getAvailableModels = (): Array<{ value: string; label: string; size: string }> => {
  return [
    { value: 'tiny', label: 'Tiny', size: '~75 MB' },
    { value: 'base', label: 'Base', size: '~150 MB' },
    { value: 'small', label: 'Small', size: '~500 MB' },
    { value: 'medium', label: 'Medium', size: '~1.5 GB' },
    { value: 'large', label: 'Large', size: '~3 GB' },
    { value: 'large-v2', label: 'Large v2', size: '~3 GB' },
    { value: 'large-v3', label: 'Large v3', size: '~3 GB' },
  ];
};

