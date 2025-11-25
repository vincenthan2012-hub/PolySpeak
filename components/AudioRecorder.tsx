import React, { useState, useRef } from 'react';
import { Mic, Square, Loader2, AlertCircle, Pause, Play, StopCircle } from 'lucide-react';

interface Props {
  onAudioCaptured: (base64: string) => void;
  isAnalyzing: boolean;
}

const AudioRecorder: React.FC<Props> = ({ onAudioCaptured, isAnalyzing }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const discardRef = useRef(false);

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      streamRef.current = stream;
      setIsPaused(false);
      discardRef.current = false;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const currentStream = streamRef.current;
        const shouldDiscard = discardRef.current;
        discardRef.current = false;

        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        
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
            onAudioCaptured(base64Data);
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
    }
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current && isRecording && !isPaused && typeof mediaRecorderRef.current.pause === 'function') {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
    }
  };

  const resumeRecording = () => {
    if (mediaRecorderRef.current && isPaused && typeof mediaRecorderRef.current.resume === 'function') {
      mediaRecorderRef.current.resume();
      setIsPaused(false);
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      discardRef.current = true;
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsPaused(false);
      setError(null);
    }
  };

  return (
    <div className="bg-white/90 backdrop-blur-md p-2 pr-4 rounded-full shadow-lg border border-indigo-100 flex items-center justify-between gap-4 max-w-md mx-auto transition-all hover:shadow-xl hover:shadow-indigo-500/10 ring-4 ring-white/50">
      
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

          {isRecording && (
            <div className="flex items-center gap-2">
              <button
                onClick={isPaused ? resumeRecording : pauseRecording}
                className="w-10 h-10 rounded-full border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50 transition-colors"
                title={isPaused ? '继续录音' : '暂停录音'}
              >
                {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
              </button>
              <button
                onClick={cancelRecording}
                className="w-10 h-10 rounded-full border border-red-200 flex items-center justify-center text-red-500 hover:bg-red-50 transition-colors"
                title="停止并丢弃录音"
              >
                <StopCircle className="w-4 h-4" />
              </button>
            </div>
          )}

          <button
            onClick={isRecording ? finishRecording : startRecording}
            className={`
              shrink-0 w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-md hover:shadow-lg focus:outline-none
              ${isRecording 
                ? 'bg-slate-900 text-white hover:bg-slate-800 ring-2 ring-red-200' 
                : 'bg-gradient-to-br from-red-500 to-pink-600 text-white hover:scale-105 active:scale-95'}
            `}
          >
            {isRecording ? (
              <Square className="w-5 h-5 fill-current" />
            ) : (
              <Mic className="w-6 h-6" />
            )}
          </button>
        </>
      )}
    </div>
  );
};

export default AudioRecorder;