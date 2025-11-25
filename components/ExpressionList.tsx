import React from 'react';
import { Star, Info, Volume2 } from 'lucide-react';
import { Expression } from '../types';

interface Props {
  expressions: Expression[];
  favorites: Set<string>;
  toggleFavorite: (item: Expression) => void;
  targetLang: string;
}

const ExpressionList: React.FC<Props> = ({ expressions, favorites, toggleFavorite, targetLang }) => {
  // 根据文本内容粗略检测语言，用于选择更合适的朗读语言
  const detectSpeechLang = (text: string): string => {
    const fallback = targetLang || 'en-US';
    const hasHiraganaKatakana = /[\u3040-\u30FF]/.test(text); // 日文平假名/片假名
    const hasHangul = /[\uAC00-\uD7AF]/.test(text); // 韩文
    const hasCJK = /[\u4E00-\u9FFF]/.test(text); // 中日韩统一表意文字（这里主要当中文用）

    if (hasHiraganaKatakana) return 'ja-JP';
    if (hasHangul) return 'ko-KR';
    if (hasCJK) return 'zh-CN';

    // 如果文本几乎全是 ASCII，而当前学习语言是 CJK，则很大概率是英文短语
    const isAscii = /^[\x00-\x7F]+$/.test(text);
    const cjkTargets = ['ja-JP', 'zh-CN', 'ko-KR'];
    if (isAscii && cjkTargets.includes(fallback)) {
      return 'en-US';
    }

    // 其它情况退回到当前学习语言
    return fallback;
  };

  const playAudio = (text: string) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel(); // Stop previous
    
    const utterance = new SpeechSynthesisUtterance(text);
    const lang = detectSpeechLang(text);
    utterance.lang = lang;
    utterance.rate = 0.9; // Slightly slower for learners

    // Attempt to find a better voice (e.g., Google voices often sound more natural)
    const voices = window.speechSynthesis.getVoices();
    const langCode = lang.split('-')[0]; // Match 'en' from 'en-US'
    
    const preferredVoice = 
      // 1. Try to match full locale and "Google" (often higher quality)
      voices.find(v => v.lang === lang && v.name.includes('Google')) ||
      // 2. Try to match full locale and "Natural" (some systems)
      voices.find(v => v.lang === lang && v.name.toLowerCase().includes('natural')) ||
      // 3. Match full locale
      voices.find(v => v.lang === lang) ||
      // 4. Match just the language code and "Google"
      voices.find(v => v.lang.startsWith(langCode) && v.name.includes('Google')) ||
      // 5. Fallback to any match for language
      voices.find(v => v.lang.startsWith(langCode));

    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }

    window.speechSynthesis.speak(utterance);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {expressions.map((expr) => {
        const isFav = favorites.has(expr.id);
        return (
          <div key={expr.id} className="relative p-4 bg-white rounded-lg border border-slate-200 hover:shadow-md transition-shadow group">
            <div className="flex justify-between items-start mb-2">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold px-2 py-1 rounded uppercase tracking-wider
                  ${expr.type === 'idiom' ? 'bg-purple-100 text-purple-700' : 
                    expr.type === 'slang' ? 'bg-pink-100 text-pink-700' : 'bg-blue-100 text-blue-700'}`}>
                  {expr.type}
                </span>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => playAudio(expr.phrase)}
                  className="p-1.5 rounded-full text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
                  title="Listen"
                >
                  <Volume2 className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => toggleFavorite(expr)}
                  className={`p-1.5 rounded-full transition-colors ${isFav ? 'bg-yellow-100 text-yellow-500' : 'text-slate-300 hover:bg-slate-100 hover:text-slate-500'}`}
                >
                  <Star className={`w-4 h-4 ${isFav ? 'fill-current' : ''}`} />
                </button>
              </div>
            </div>
            
            <h4 className="text-lg font-bold text-slate-800 mb-1 cursor-pointer hover:text-indigo-600" onClick={() => playAudio(expr.phrase)}>
              {expr.phrase}
            </h4>
            
            <div className="text-sm text-slate-600 mb-3 leading-relaxed">
              <Info className="w-3 h-3 inline mr-1 text-slate-400" />
              {expr.explanation}
            </div>
            
            <div className="bg-slate-50 p-2 rounded border-l-4 border-blue-400 text-xs italic text-slate-700 flex justify-between items-start group/ex">
              <span className="flex-1">"{expr.example}"</span>
              <button 
                onClick={() => playAudio(expr.example)}
                className="opacity-0 group-hover/ex:opacity-100 p-1 text-slate-400 hover:text-indigo-600 transition-opacity"
              >
                <Volume2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ExpressionList;