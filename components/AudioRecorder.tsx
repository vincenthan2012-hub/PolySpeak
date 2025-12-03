import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, Loader2, AlertCircle, Pause, Play, X } from 'lucide-react';

// Web Speech API 类型定义
interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface Window {
  SpeechRecognition: new () => SpeechRecognition;
  webkitSpeechRecognition: new () => SpeechRecognition;
}

interface Props {
  onAudioCaptured: (base64: string, mimeType: string) => void;
  isAnalyzing: boolean;
  onStallDetected?: (transcription?: string) => void;
  onSpeechResumed?: () => void;
  targetLang?: string;
}

const AudioRecorder: React.FC<Props> = ({ onAudioCaptured, isAnalyzing, onStallDetected, onSpeechResumed, targetLang = 'en-US' }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const discardRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const silenceNotifiedRef = useRef(false);
  const monitorIntervalRef = useRef<number | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const speechRecognitionRef = useRef<SpeechRecognition | null>(null);
  const transcriptionRef = useRef<string>('');

  const preferredMimeTypeRef = useRef<string>('audio/webm');

  const stopSilenceMonitor = () => {
    if (monitorIntervalRef.current) {
      window.clearInterval(monitorIntervalRef.current);
      monitorIntervalRef.current = null;
    }
    silenceStartRef.current = null;
    silenceNotifiedRef.current = false;

    if (sourceRef.current) {
      try {
        sourceRef.current.disconnect();
      } catch {
        // ignore
      }
      sourceRef.current = null;
    }

    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }
  };

  const stopTranscriptionDetection = () => {
    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.stop();
      } catch {
        // ignore
      }
      speechRecognitionRef.current = null;
    }
    transcriptionRef.current = '';
  };

  useEffect(() => {
    return () => {
      stopSilenceMonitor();
      stopTranscriptionDetection();
      streamRef.current?.getTracks().forEach(track => track.stop());
    };
  }, []);

  const startSilenceMonitor = (stream: MediaStream) => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      const audioContext = new AudioCtx();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.fftSize);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      sourceRef.current = source;

      monitorIntervalRef.current = window.setInterval(() => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(dataArray);

        let sumSquares = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const value = (dataArray[i] - 128) / 128;
          sumSquares += value * value;
        }

        const rms = Math.sqrt(sumSquares / dataArray.length);
        const isSilent = rms < 0.02;
        const now = performance.now();

        if (isSilent) {
          if (silenceStartRef.current === null) {
            silenceStartRef.current = now;
          }
          if (!silenceNotifiedRef.current && now - silenceStartRef.current > 2000) {
            silenceNotifiedRef.current = true;
            // 获取最新的转录内容（包括最新的 interim results）
            const currentTranscription = transcriptionRef.current.trim();
            console.log('[AudioRecorder] Silence detected, transcription:', currentTranscription || '(empty)');
            
            // 只传递最近的内容（最后50个词），避免使用太旧的内容
            const words = currentTranscription.split(/\s+/);
            const recentWords = words.slice(Math.max(0, words.length - 50)).join(' ');
            const recentTranscription = recentWords.trim() || currentTranscription;
            
            console.log('[AudioRecorder] Recent transcription (last 50 words):', recentTranscription);
            onStallDetected?.(recentTranscription || undefined);
          }
        } else {
          silenceStartRef.current = null;
          if (silenceNotifiedRef.current) {
            silenceNotifiedRef.current = false;
            onSpeechResumed?.();
          }
        }
      }, 250);
    } catch (err) {
      console.warn('Silence monitor unavailable', err);
    }
  };

  const startTranscriptionDetection = (stream: MediaStream) => {
    try {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) {
        console.warn('Speech Recognition API not available');
        return;
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = targetLang;

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        // 分离 final 和 interim 结果
        let finalTranscript = '';
        let interimTranscript = '';
        
        for (let i = 0; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            // 最终结果：追加到完整转录
            finalTranscript += transcript + ' ';
          } else {
            // 临时结果：用于实时显示
            interimTranscript += transcript + ' ';
          }
        }
        
        // 更新完整转录（只使用 final results，避免重复）
        if (finalTranscript.trim()) {
          transcriptionRef.current += finalTranscript;
          // 清理多余空格
          transcriptionRef.current = transcriptionRef.current.replace(/\s+/g, ' ').trim();
        }
        
        // 构建最新的完整转录（final + 最新的 interim）
        // 这样在检测到静音时能获取到用户刚说的最新内容
        const latestTranscript = (transcriptionRef.current + ' ' + interimTranscript).trim();
        
        // 更新一个临时引用，用于静音检测时获取最新内容
        // 这个引用包含最新的 interim results
        if (latestTranscript) {
          // 存储最新的完整转录（包括 interim）
          transcriptionRef.current = latestTranscript;
        }
        
        // 如果检测到新的语音输入，清除hint通知标志并触发resume
        const currentTranscript = transcriptionRef.current.trim();
        if (currentTranscript && silenceNotifiedRef.current) {
          silenceNotifiedRef.current = false;
          onSpeechResumed?.();
        }
      };

      recognition.onerror = (event: any) => {
        console.warn('Speech recognition error:', event.error);
      };

      recognition.onend = () => {
        // 如果还在录音且未暂停，重新启动识别
        const shouldRestart = mediaRecorderRef.current?.state === 'recording' && streamRef.current;
        if (shouldRestart) {
          try {
            recognition.start();
          } catch {
            // 忽略错误，可能已经在运行
          }
        }
      };

      recognition.start();
      speechRecognitionRef.current = recognition;
    } catch (err) {
      console.warn('Transcription detection unavailable', err);
    }
  };

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredMimeType = typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function'
        ? (MediaRecorder.isTypeSupported('audio/mpeg') ? 'audio/mpeg' : 'audio/webm')
        : 'audio/webm';
      preferredMimeTypeRef.current = preferredMimeType;
      const recorderOptions = MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(preferredMimeType)
        ? { mimeType: preferredMimeType }
        : undefined;
      const mediaRecorder = new MediaRecorder(stream, recorderOptions);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      streamRef.current = stream;
      setIsPaused(false);
      discardRef.current = false;
      transcriptionRef.current = ''; // 重置转录
      stopSilenceMonitor();
      stopTranscriptionDetection();
      startSilenceMonitor(stream);
      startTranscriptionDetection(stream);

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const currentStream = streamRef.current;
        const shouldDiscard = discardRef.current;
        discardRef.current = false;

        const mimeType = mediaRecorderRef.current?.mimeType || preferredMimeTypeRef.current || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: mimeType });
        
        // Validate audio size (should be at least 1KB for a meaningful recording)
        if (!shouldDiscard && blob.size < 1000) {
          setError("Recording too short. Please record for at least 2-3 seconds.");
          currentStream?.getTracks().forEach(track => track.stop());
          return;
        }
        
        console.log('[AudioRecorder] Recording stopped, size:', blob.size, 'bytes');
        
        if (!shouldDiscard) {
          const reader = new FileReader();
          reader.readAsDataURL(blob);
          reader.onloadend = () => {
            const base64String = reader.result as string;
            const base64Data = base64String.split(',')[1];
            console.log('[AudioRecorder] Base64 data length:', base64Data.length);
            onAudioCaptured(base64Data, mimeType);
          };
          reader.onerror = () => {
            setError("Failed to process audio. Please try again.");
          };
        }

        currentStream?.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      setError("Mic access needed.");
    }
  };

  const finishRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      discardRef.current = false;
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);
      stopSilenceMonitor();
      stopTranscriptionDetection();
      onSpeechResumed?.();
    }
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current && isRecording && !isPaused && typeof mediaRecorderRef.current.pause === 'function') {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
      stopSilenceMonitor();
      stopTranscriptionDetection();
    }
  };

  const resumeRecording = () => {
    if (mediaRecorderRef.current && isPaused && typeof mediaRecorderRef.current.resume === 'function') {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
      if (streamRef.current) {
        startSilenceMonitor(streamRef.current);
        startTranscriptionDetection(streamRef.current);
      }
      onSpeechResumed?.();
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      discardRef.current = true;
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);
      setError(null);
      stopSilenceMonitor();
      stopTranscriptionDetection();
      onSpeechResumed?.();
    }
  };

  return (
    <div className="bg-white/90 backdrop-blur-md p-3 pl-4 rounded-full shadow-lg border border-indigo-100 flex items-center justify-between gap-4 max-w-md mx-auto transition-all hover:shadow-xl hover:shadow-indigo-500/10 ring-4 ring-white/50">
      
      {isAnalyzing ? (
         <div className="flex items-center gap-3 flex-1 px-2 py-1">
           <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
           <div className="flex flex-col">
              <span className="text-xs font-bold text-indigo-900">Analyzing speech...</span>
              <span className="text-[10px] text-indigo-400">Just a moment</span>
           </div>
         </div>
      ) : error ? (
        <div className="flex items-center gap-3 flex-1 px-2 text-red-500">
           <AlertCircle className="w-5 h-5" />
           <span className="text-xs font-medium">{error}</span>
           <button onClick={startRecording} className="text-xs underline font-bold">Retry</button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 flex-1 overflow-hidden">
             {isRecording ? (
               <div className="flex items-center gap-2 px-3">
                  <div className="flex gap-1 h-3 items-end">
                    <span className="w-1 bg-red-500 rounded-full animate-[bounce_1s_infinite] h-2"></span>
                    <span className="w-1 bg-red-500 rounded-full animate-[bounce_1.2s_infinite] h-3"></span>
                    <span className="w-1 bg-red-500 rounded-full animate-[bounce_0.8s_infinite] h-1.5"></span>
                  </div>
                  <span className="text-xs font-bold text-red-500 animate-pulse">
                    {isPaused ? 'Paused' : 'Recording...'}
                  </span>
               </div>
             ) : (
               <div className="px-3">
                 <p className="text-xs font-bold text-slate-700">Ready to practice?</p>
                 <p className="text-[10px] text-slate-400">Tap the mic to start</p>
               </div>
             )}
          </div>

          <div className="flex items-center gap-3">
            {isRecording && (
              <button
                onClick={cancelRecording}
                className="w-12 h-12 rounded-full bg-slate-100/90 text-slate-500 flex items-center justify-center border border-slate-200 shadow-sm hover:bg-slate-200 transition-all"
                title="Discard recording"
              >
                <X className="w-4 h-4" />
              </button>
            )}

            <button
              onClick={isRecording ? finishRecording : startRecording}
              className={`
                shrink-0 w-16 h-16 rounded-full flex items-center justify-center transition-all shadow-lg focus:outline-none
                ${isRecording 
                  ? 'bg-red-500 text-white hover:bg-red-600 ring-4 ring-red-100/80'
                  : 'bg-gradient-to-br from-red-500 to-pink-600 text-white hover:scale-105 active:scale-95'}
              `}
            >
              {isRecording ? (
                <Square className="w-5 h-5 fill-current" />
              ) : (
                <Mic className="w-6 h-6" />
              )}
            </button>

            {isRecording && (
              <button
                onClick={isPaused ? resumeRecording : pauseRecording}
                className="w-12 h-12 rounded-full bg-slate-100/90 text-slate-600 flex items-center justify-center border border-slate-200 shadow-sm hover:bg-slate-200 transition-all"
                title={isPaused ? '继续录音' : '暂停录音'}
              >
                {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default AudioRecorder;