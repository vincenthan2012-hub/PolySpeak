import React from 'react';
import { Star, Info, Volume2, Pause } from 'lucide-react';
import { Expression } from '../types';
import { detectSpeechLang } from '../services/audioService';
import { useSpeechPlayback } from '../hooks/useSpeechPlayback';

interface Props {
  expressions: Expression[];
  favorites: Set<string>;
  toggleFavorite: (item: Expression) => void;
  targetLang: string;
}

const ExpressionList: React.FC<Props> = ({ expressions, favorites, toggleFavorite, targetLang }) => {
  const { togglePlayback, isActive } = useSpeechPlayback();

  const handlePlayback = (id: string, text: string) => {
    const lang = detectSpeechLang(text, targetLang);
    togglePlayback(id, text, { lang, rate: 0.9 });
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
                  onClick={() => handlePlayback(`phrase-${expr.id}`, expr.phrase)}
                  className={`p-1.5 rounded-full transition-colors ${
                    isActive(`phrase-${expr.id}`)
                      ? 'bg-indigo-600 text-white shadow-inner'
                      : 'text-slate-400 hover:bg-indigo-50 hover:text-indigo-600'
                  }`}
                  title="Listen"
                >
                  {isActive(`phrase-${expr.id}`) ? <Pause className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
                <button 
                  onClick={() => toggleFavorite(expr)}
                  className={`p-1.5 rounded-full transition-colors ${isFav ? 'bg-yellow-100 text-yellow-500' : 'text-slate-300 hover:bg-slate-100 hover:text-slate-500'}`}
                >
                  <Star className={`w-4 h-4 ${isFav ? 'fill-current' : ''}`} />
                </button>
              </div>
            </div>
            
            <h4 className="text-lg font-bold text-slate-800 mb-1 cursor-pointer hover:text-indigo-600" onClick={() => handlePlayback(`phrase-${expr.id}`, expr.phrase)}>
              {expr.phrase}
            </h4>
            
            <div className="text-sm text-slate-600 mb-3 leading-relaxed">
              <Info className="w-3 h-3 inline mr-1 text-slate-400" />
              {expr.explanation}
            </div>
            
            <div className="bg-slate-50 p-2 rounded border-l-4 border-blue-400 text-xs italic text-slate-700 flex justify-between items-start group/ex">
              <span className="flex-1">"{expr.example}"</span>
              <button 
                onClick={() => handlePlayback(`example-${expr.id}`, expr.example)}
                className={`opacity-0 group-hover/ex:opacity-100 p-1 transition-all ${
                  isActive(`example-${expr.id}`)
                    ? 'text-indigo-600'
                    : 'text-slate-400 hover:text-indigo-600'
                }`}
              >
                {isActive(`example-${expr.id}`) ? <Pause className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ExpressionList;