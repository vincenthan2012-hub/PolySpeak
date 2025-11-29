import React, { useMemo, useRef, useState } from 'react';
import { AnalysisResult, FeedbackItem } from '../types';
import { CheckCircle, AlertTriangle, BookmarkPlus, Award, PlayCircle, PauseCircle, ArrowDownToLine } from 'lucide-react';

interface Props {
  result: AnalysisResult;
  onSaveFeedback: (item: FeedbackItem) => Promise<void> | void;
  savedFeedbackIds: Set<string>;
}

const FeedbackDisplay: React.FC<Props> = ({ result, onSaveFeedback, savedFeedbackIds }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const segmentEndRef = useRef<number | null>(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const downloadFileName = useMemo(() => {
    if (result.audioMimeType && result.audioMimeType.includes('mpeg')) {
      return 'polyspeak-recording.mp3';
    }
    return 'polyspeak-recording.webm';
  }, [result.audioMimeType]);

  const togglePlayback = () => {
    if (!audioRef.current) return;
    segmentEndRef.current = null;
    setActiveSegmentId(null);
    if (audioRef.current.paused) {
      audioRef.current.play().catch(() => undefined);
    } else {
      audioRef.current.pause();
    }
  };

  const handleAudioPlay = () => setIsAudioPlaying(true);
  const handleAudioPause = () => {
    setIsAudioPlaying(false);
    segmentEndRef.current = null;
    setActiveSegmentId(null);
  };
  const handleAudioEnded = () => setIsAudioPlaying(false);

  const handleAudioTimeUpdate = () => {
    if (!audioRef.current) return;
    if (segmentEndRef.current == null) return;
    if (audioRef.current.currentTime >= segmentEndRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = segmentEndRef.current;
      segmentEndRef.current = null;
      setActiveSegmentId(null);
    }
  };

  const handlePlaySentence = (item: FeedbackItem) => {
    if (!audioRef.current || !result.audioUrl) return;
    if (typeof item.audioStart !== 'number' || typeof item.audioEnd !== 'number') return;
    segmentEndRef.current = item.audioEnd;
    setActiveSegmentId(item.id);
    audioRef.current.currentTime = Math.max(0, item.audioStart);
    audioRef.current
      .play()
      .catch(() => {
        segmentEndRef.current = null;
        setActiveSegmentId(null);
      });
  };

  return (
    <div className="space-y-8">
      {/* Summary Section */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-200">
        <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
          <CheckCircle className="w-5 h-5 text-green-500" />
          Improvement Summary
        </h3>
        
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Your Transcription</h4>
            <p className="text-slate-600 leading-relaxed italic">"{result.transcription}"</p>
            {result.audioUrl && (
              <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
                <div className="flex items-center gap-2">
                  <button
                    onClick={togglePlayback}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-full border border-slate-200 text-slate-600 text-sm font-semibold bg-white hover:border-indigo-200 hover:text-indigo-600 transition-colors"
                  >
                    {isAudioPlaying ? <PauseCircle className="w-5 h-5" /> : <PlayCircle className="w-5 h-5" />}
                    {isAudioPlaying ? 'Pause Audio' : 'Play Audio'}
                  </button>
                  <audio
                    ref={audioRef}
                    controls
                    src={result.audioUrl}
                    className="w-full md:w-auto max-w-xs"
                    onPlay={handleAudioPlay}
                    onPause={handleAudioPause}
                    onEnded={handleAudioEnded}
                    onTimeUpdate={handleAudioTimeUpdate}
                  />
                </div>
                <a
                  href={result.audioUrl}
                  download={downloadFileName}
                  className="inline-flex items-center justify-center w-11 h-11 rounded-full border border-indigo-100 text-indigo-600 hover:bg-indigo-50 transition-colors"
                  aria-label={`Download audio ${downloadFileName}`}
                >
                  <ArrowDownToLine className="w-5 h-5" />
                </a>
              </div>
            )}
          </div>
          <div>
            <h4 className="text-xs font-bold text-green-600 uppercase tracking-wide mb-2">Improved Version</h4>
            <p className="text-slate-800 font-medium leading-relaxed">{result.improvedText}</p>
          </div>
        </div>
      </div>

      {/* Overall Feedback */}
      {result.overallFeedback && (
        <div>
          <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
            <Award className="w-5 h-5 text-blue-500" />
            Overall Feedback (IELTS Criteria)
          </h3>
          
          <div className="space-y-4">
            <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-bold text-blue-700 mb-2 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                    Task Response
                  </h4>
                  <p className="text-slate-700 leading-relaxed pl-4">{result.overallFeedback.taskResponse}</p>
                </div>
                
                <div>
                  <h4 className="text-sm font-bold text-indigo-700 mb-2 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
                    Coherence
                  </h4>
                  <p className="text-slate-700 leading-relaxed pl-4">{result.overallFeedback.coherence}</p>
                </div>
                
                <div>
                  <h4 className="text-sm font-bold text-purple-700 mb-2 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-purple-500"></div>
                    Cohesion
                  </h4>
                  <p className="text-slate-700 leading-relaxed pl-4">{result.overallFeedback.cohesion}</p>
                </div>
                
                <div>
                  <h4 className="text-sm font-bold text-pink-700 mb-2 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-pink-500"></div>
                    Vocabulary
                  </h4>
                  <p className="text-slate-700 leading-relaxed pl-4">{result.overallFeedback.vocabulary}</p>
                </div>
                
                <div>
                  <h4 className="text-sm font-bold text-rose-700 mb-2 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-rose-500"></div>
                    Grammar
                  </h4>
                  <p className="text-slate-700 leading-relaxed pl-4">{result.overallFeedback.grammar}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Detailed Feedback */}
      <div>
        <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-orange-500" />
          Sentence-by-Sentence Feedback
        </h3>
        
        <div className="space-y-4">
          {result.feedback.length === 0 ? (
            <div className="p-4 bg-green-50 text-green-800 rounded-lg text-center">
              Great job! No specific errors found.
            </div>
          ) : (
            result.feedback.map((item) => {
              const isSaved = savedFeedbackIds.has(item.id);
              return (
                <div key={item.id} className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 hover:border-orange-200 transition-colors">
                  <div className="flex justify-between items-start mb-3">
                    <div className="space-y-1 flex-1">
                       <div className="flex items-start gap-2">
                         <span className="bg-red-100 text-red-700 text-[10px] font-bold px-1.5 py-0.5 rounded mt-1">ORIGINAL</span>
                         <p className="text-slate-600 line-through decoration-red-300 flex-1">{item.original}</p>
                         {result.audioUrl && typeof item.audioStart === 'number' && typeof item.audioEnd === 'number' && (
                           <button
                             onClick={() => handlePlaySentence(item)}
                             className={`flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-full border transition-colors ${
                               activeSegmentId === item.id
                                 ? 'border-indigo-300 bg-indigo-50 text-indigo-600'
                                 : 'border-slate-200 text-slate-500 hover:border-indigo-200 hover:text-indigo-600'
                             }`}
                           >
                             <PlayCircle className="w-4 h-4" />
                             听此句
                           </button>
                         )}
                       </div>
                       <div className="flex items-start gap-2">
                         <span className="bg-green-100 text-green-700 text-[10px] font-bold px-1.5 py-0.5 rounded mt-1">BETTER</span>
                         <p className="text-slate-800 font-medium">{item.improved}</p>
                       </div>
                    </div>
                    <button
                      onClick={() => { void onSaveFeedback(item); }}
                      className={`ml-4 p-2 rounded-full transition-colors ${isSaved ? 'bg-orange-100 text-orange-600' : 'text-slate-300 hover:bg-slate-50 hover:text-slate-500'}`}
                      title="Save for review"
                    >
                      <BookmarkPlus className={`w-5 h-5 ${isSaved ? 'fill-current' : ''}`} />
                    </button>
                  </div>
                  
                  <div className="mt-3 pt-3 border-t border-slate-100 text-sm text-slate-600 flex gap-2">
                    <span className="font-semibold text-orange-600 shrink-0">Tutor:</span>
                    {item.explanation}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default FeedbackDisplay;
