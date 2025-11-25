import React, { useState } from 'react';
import { SavedItem, Expression, FeedbackItem } from '../types';
import { generateStory } from '../services/geminiService';
import { Sparkles, BookOpen, RotateCw, Loader2, AlertCircle, Check, X, Volume2, Plus, Download, Trash2 } from 'lucide-react';
import { 
  checkAnkiConnect, 
  getDeckNames, 
  getModelNames, 
  addExpressionToAnki, 
  addFeedbackToAnki,
  batchAddExpressionsToAnki,
  batchAddFeedbackToAnki,
  AnkiConfig
} from '../services/ankiService';

interface Props {
  savedItems: SavedItem[];
  onUpdateSavedItem: (updatedItem: SavedItem) => void;
  onDeleteSavedItem: (itemId: string, itemType: 'expression' | 'feedback') => void;
  onDeleteSavedItems: (itemIds: string[], itemType: 'expression' | 'feedback') => void;
  mode: 'favorites' | 'flashcards';
  targetLang: string;
}

const ReviewDashboard: React.FC<Props> = ({ savedItems, onUpdateSavedItem, onDeleteSavedItem, onDeleteSavedItems, mode, targetLang }) => {
  const [activeTab, setActiveTab] = useState<'phrases' | 'feedback'>('phrases');
  const [story, setStory] = useState<string | null>(null);
  const [isGeneratingStory, setIsGeneratingStory] = useState(false);
  const [selectedPhraseIds, setSelectedPhraseIds] = useState<Set<string>>(new Set());
  const [selectedFeedbackIds, setSelectedFeedbackIds] = useState<Set<string>>(new Set());
  
  // Anki State
  const [showAnkiModal, setShowAnkiModal] = useState(false);
  const [ankiConfig, setAnkiConfig] = useState<AnkiConfig>({ deckName: 'PolySpeak', modelName: '' });
  const [isExportingToAnki, setIsExportingToAnki] = useState(false);
  const [ankiDecks, setAnkiDecks] = useState<string[]>([]);
  const [ankiModels, setAnkiModels] = useState<string[]>([]);
  const [isAnkiModalOpen, setIsAnkiModalOpen] = useState(false);
  const [pendingAnkiItem, setPendingAnkiItem] = useState<{ type: 'expression' | 'feedback'; item: any } | null>(null);
  const [isBatchMode, setIsBatchMode] = useState(false);
  
  // Flashcard State
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);

  const phrases = savedItems.filter(i => i.type === 'expression').map(i => ({ ...i, data: i.data as Expression }));
  const feedback = savedItems.filter(i => i.type === 'feedback').map(i => i.data as FeedbackItem);
  const flashcards = phrases; 
 
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
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    const lang = detectSpeechLang(text);
    utterance.lang = lang;
    
    // Voice selection logic
    const voices = window.speechSynthesis.getVoices();
    const langCode = lang.split('-')[0];
    
    const preferredVoice = 
      voices.find(v => v.lang === lang && v.name.includes('Google')) ||
      voices.find(v => v.lang === lang && v.name.toLowerCase().includes('natural')) ||
      voices.find(v => v.lang === lang) ||
      voices.find(v => v.lang.startsWith(langCode) && v.name.includes('Google')) ||
      voices.find(v => v.lang.startsWith(langCode));

    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }

    window.speechSynthesis.speak(utterance);
  };

  const toggleSelection = (id: string) => {
    const newSet = new Set(selectedPhraseIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedPhraseIds(newSet);
  };

  const toggleFeedbackSelection = (id: string) => {
    const newSet = new Set(selectedFeedbackIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedFeedbackIds(newSet);
  };

  // Anki Functions
  const openAnkiModal = async (item?: { type: 'expression' | 'feedback'; item: any }, batch: boolean = false) => {
    try {
      const checkResult = await checkAnkiConnect();
      if (!checkResult.available) {
        alert(`无法连接到 AnkiConnect:\n\n${checkResult.error}\n\n请确保:\n1. Anki 正在运行\n2. AnkiConnect 插件已启用\n3. 已配置 CORS 设置`);
        return;
      }

      const [decks, models] = await Promise.all([getDeckNames(), getModelNames()]);
      setAnkiDecks(decks);
      setAnkiModels(models);
      
      if (item) {
        setPendingAnkiItem(item);
      }
      setIsBatchMode(batch);
      setShowAnkiModal(true);
    } catch (error) {
      alert(`检查 AnkiConnect 连接失败: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleAnkiExport = async () => {
    if (!ankiConfig.deckName) {
      alert('请选择或输入牌组名称');
      return;
    }

    setIsExportingToAnki(true);
    
    try {
      if (isBatchMode) {
        // Batch export
        if (activeTab === 'phrases' && selectedPhraseIds.size > 0) {
          const selectedPhrases = phrases.filter(p => selectedPhraseIds.has(p.data.id));
          const result = await batchAddExpressionsToAnki(
            selectedPhrases.map(p => ({
              phrase: p.data.phrase,
              explanation: p.data.explanation,
              example: p.data.example
            })),
            ankiConfig
          );
          alert(`批量导入完成！\n成功: ${result.success}\n失败: ${result.failed}${result.errors.length > 0 ? '\n\n错误:\n' + result.errors.slice(0, 5).join('\n') : ''}`);
          setSelectedPhraseIds(new Set());
        } else if (activeTab === 'feedback' && selectedFeedbackIds.size > 0) {
          const selectedFeedbacks = feedback.filter(f => selectedFeedbackIds.has(f.id));
          const result = await batchAddFeedbackToAnki(
            selectedFeedbacks.map(f => ({
              original: f.original,
              improved: f.improved,
              explanation: f.explanation
            })),
            ankiConfig
          );
          alert(`批量导入完成！\n成功: ${result.success}\n失败: ${result.failed}${result.errors.length > 0 ? '\n\n错误:\n' + result.errors.slice(0, 5).join('\n') : ''}`);
          setSelectedFeedbackIds(new Set());
        }
      } else if (pendingAnkiItem) {
        // Single export
        if (pendingAnkiItem.type === 'expression') {
          await addExpressionToAnki(pendingAnkiItem.item, ankiConfig);
          alert('✅ 短语已成功添加到 Anki！');
        } else {
          await addFeedbackToAnki(pendingAnkiItem.item, ankiConfig);
          alert('✅ 反馈已成功添加到 Anki！');
        }
      }
      
      setShowAnkiModal(false);
      setPendingAnkiItem(null);
    } catch (error) {
      alert(`导入失败: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsExportingToAnki(false);
    }
  };

  const handleGenerateStory = async () => {
    if (selectedPhraseIds.size === 0) return;
    setIsGeneratingStory(true);
    try {
      const selectedPhrases = phrases.filter(p => selectedPhraseIds.has(p.data.id));
      const phraseList = selectedPhrases.map(p => p.data.phrase);
      const storyText = await generateStory(phraseList, targetLang);
      setStory(storyText);
    } finally {
      setIsGeneratingStory(false);
    }
  };

  const handleBatchDeletePhrases = () => {
    if (selectedPhraseIds.size === 0) return;
    if (confirm(`确定要删除选中的 ${selectedPhraseIds.size} 个短语吗？`)) {
      onDeleteSavedItems(Array.from(selectedPhraseIds), 'expression');
      setSelectedPhraseIds(new Set());
    }
  };

  const handleBatchDeleteFeedback = () => {
    if (selectedFeedbackIds.size === 0) return;
    if (confirm(`确定要删除选中的 ${selectedFeedbackIds.size} 个反馈吗？`)) {
      onDeleteSavedItems(Array.from(selectedFeedbackIds), 'feedback');
      setSelectedFeedbackIds(new Set());
    }
  };

  const renderStory = (text: string) => {
    const parts = text.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <span key={i} className="bg-yellow-200 font-bold px-1 rounded text-slate-800">{part.slice(2, -2)}</span>;
      }
      return part;
    });
  };

  const handleFlashcardRate = (rating: 'again' | 'hard' | 'good' | 'easy') => {
    const currentItem = flashcards[currentCardIndex];
    let newInterval = currentItem.flashcard?.interval || 1;
    let newEase = currentItem.flashcard?.ease || 2.5;
    const reviews = (currentItem.flashcard?.reviews || 0) + 1;

    switch(rating) {
      case 'again':
        newInterval = 0;
        newEase = Math.max(1.3, newEase - 0.2);
        break;
      case 'hard':
        newInterval = newInterval * 1.2;
        newEase = Math.max(1.3, newEase - 0.15);
        break;
      case 'good':
        newInterval = newInterval * 2.5;
        break;
      case 'easy':
        newInterval = newInterval * 4;
        newEase += 0.15;
        break;
    }

    const updatedItem: SavedItem = {
      ...currentItem,
      flashcard: {
        interval: newInterval,
        ease: newEase,
        dueDate: Date.now() + (newInterval * 24 * 60 * 60 * 1000),
        reviews
      }
    };

    onUpdateSavedItem(updatedItem);
    setIsFlipped(false);
    setCurrentCardIndex(prev => (prev + 1) % flashcards.length);
  };

  const isFlashcardMode = mode === 'flashcards';

  return (
    <div className="max-w-5xl mx-auto">
      {!isFlashcardMode && (
        <div className="flex flex-wrap gap-2 border-b border-slate-200 mb-8 pb-1">
          {[
            { id: 'phrases', label: `Saved Phrases (${phrases.length})` },
            { id: 'feedback', label: `Saved Feedback (${feedback.length})` },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-5 py-3 text-sm font-medium rounded-t-lg transition-all border-b-2 
                ${activeTab === tab.id 
                  ? 'border-indigo-600 text-indigo-600 bg-indigo-50' 
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-[500px]">
        {!isFlashcardMode && activeTab === 'phrases' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-2 border-b border-slate-100">
                 <div className="w-full sm:w-auto">
                    <h3 className="text-lg font-bold text-slate-800">Your Collection</h3>
                    <p className="text-sm text-slate-500">Select phrases to generate a story or export to Anki.</p>
                 </div>
                 <div className="flex gap-2 w-full sm:w-auto">
                   {selectedPhraseIds.size > 0 && (
                     <>
                       <button 
                         onClick={handleBatchDeletePhrases} 
                         className="justify-center flex items-center gap-2 px-4 py-2 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 shadow-sm transition-all active:scale-95 text-sm"
                       >
                         <Trash2 className="w-4 h-4" />
                         批量删除 ({selectedPhraseIds.size})
                       </button>
                       <button 
                         onClick={() => openAnkiModal(undefined, true)} 
                         className="justify-center flex items-center gap-2 px-4 py-2 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 shadow-sm transition-all active:scale-95 text-sm"
                       >
                         <Download className="w-4 h-4" />
                         Export to Anki ({selectedPhraseIds.size})
                       </button>
                     </>
                   )}
                   <button 
                      onClick={handleGenerateStory} 
                      disabled={isGeneratingStory || selectedPhraseIds.size === 0}
                      className="justify-center flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95 text-sm"
                    >
                      {isGeneratingStory ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                      Generate Story
                      {selectedPhraseIds.size > 0 && <span className="bg-indigo-500 px-1.5 rounded text-xs ml-1">{selectedPhraseIds.size}</span>}
                    </button>
                 </div>
            </div>

             {story && (
                 <div className="bg-indigo-50 p-6 rounded-xl border border-indigo-100 shadow-inner animate-in fade-in slide-in-from-top-2 relative">
                   <button 
                     onClick={() => setStory(null)}
                     className="absolute top-3 right-3 p-1 text-indigo-300 hover:text-indigo-600 rounded-full hover:bg-indigo-100 transition-colors"
                   >
                     <X className="w-4 h-4" />
                   </button>
                   <div className="flex items-center gap-3 mb-3">
                     <h4 className="text-indigo-900 font-bold flex items-center gap-2">
                       <BookOpen className="w-4 h-4"/> 
                       AI Generated Story
                     </h4>
                     <button onClick={() => playAudio(story)} className="p-1.5 bg-indigo-200 text-indigo-700 rounded-full hover:bg-indigo-300 transition-colors">
                       <Volume2 className="w-4 h-4" />
                     </button>
                   </div>
                   <div className="prose prose-slate max-w-none leading-loose text-slate-700">
                     {renderStory(story)}
                   </div>
                 </div>
               )}

            <div>
              {phrases.length === 0 ? (
                 <div className="text-center py-12 bg-slate-50 rounded-xl border border-slate-200">
                   <p className="text-slate-500 mb-2">No phrases saved yet.</p>
                   <p className="text-sm text-slate-400">Practice speaking to collect expressions.</p>
                 </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {phrases.map(item => {
                    const p = item.data;
                    const isSelected = selectedPhraseIds.has(p.id);
                    
                    return (
                      <div 
                        key={p.id} 
                        onClick={() => toggleSelection(p.id)}
                        className={`
                          relative p-5 rounded-xl border shadow-sm transition-all cursor-pointer group select-none
                          ${isSelected 
                             ? 'bg-indigo-50 border-indigo-500 ring-1 ring-indigo-500' 
                             : 'bg-white border-slate-200 hover:border-indigo-300 hover:shadow-md'}
                        `}
                      >
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center gap-2">
                              <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors cursor-pointer
                                 ${isSelected ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300 bg-white'}
                              `}>
                                  {isSelected && <Check className="w-3 h-3 text-white" />}
                              </div>
                              <span className={`text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider
                                ${p.type === 'idiom' ? 'bg-purple-100 text-purple-700' : 
                                  p.type === 'slang' ? 'bg-pink-100 text-pink-700' : 'bg-blue-100 text-blue-700'}`}>
                                {p.type}
                              </span>
                          </div>
                          
                          <div className="flex gap-1">
                            <button 
                               onClick={(e) => { e.stopPropagation(); playAudio(p.phrase); }}
                               className="p-1.5 rounded-full text-slate-400 hover:bg-indigo-100 hover:text-indigo-600 transition-colors"
                            >
                               <Volume2 className="w-4 h-4" />
                            </button>
                            <button 
                               onClick={(e) => { 
                                 e.stopPropagation(); 
                                 openAnkiModal({ type: 'expression', item: { phrase: p.phrase, explanation: p.explanation, example: p.example } }, false);
                               }}
                               className="p-1.5 rounded-full text-slate-400 hover:bg-green-100 hover:text-green-600 transition-colors"
                               title="Add to Anki"
                            >
                               <Plus className="w-4 h-4" />
                            </button>
                            <button 
                               onClick={(e) => { 
                                 e.stopPropagation(); 
                                 if (confirm('确定要删除这个短语吗？')) {
                                   onDeleteSavedItem(p.id, 'expression');
                                 }
                               }}
                               className="p-1.5 rounded-full text-slate-400 hover:bg-red-100 hover:text-red-600 transition-colors"
                               title="删除"
                            >
                               <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        
                        <div className="font-bold text-lg text-slate-800 mb-2 group-hover:text-indigo-600 transition-colors ml-7">{p.phrase}</div>
                        <div className="text-sm text-slate-600 mb-3 ml-7">{p.explanation}</div>
                        <div className="text-xs bg-slate-50/50 p-2 rounded italic text-slate-500 border-l-2 border-slate-300 ml-7">"{p.example}"</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {!isFlashcardMode && activeTab === 'feedback' && (
           <div className="space-y-4 max-w-3xl mx-auto animate-in fade-in duration-300">
             <div className="flex justify-between items-center pb-2 border-b border-slate-100">
               <div>
                 <h3 className="text-lg font-bold text-slate-800">Saved Feedback</h3>
                 <p className="text-sm text-slate-500">Select feedback to export to Anki.</p>
               </div>
               {selectedFeedbackIds.size > 0 && (
                 <>
                   <button 
                     onClick={handleBatchDeleteFeedback} 
                     className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 shadow-sm transition-all active:scale-95 text-sm"
                   >
                     <Trash2 className="w-4 h-4" />
                     批量删除 ({selectedFeedbackIds.size})
                   </button>
                   <button 
                     onClick={() => openAnkiModal(undefined, true)} 
                     className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 shadow-sm transition-all active:scale-95 text-sm"
                   >
                     <Download className="w-4 h-4" />
                     Export to Anki ({selectedFeedbackIds.size})
                   </button>
                 </>
               )}
             </div>
             {feedback.length === 0 && (
               <div className="text-center py-12 bg-slate-50 rounded-xl border border-slate-200">
                 <p className="text-slate-500">No feedback saved yet.</p>
               </div>
             )}
             {feedback.map(f => {
               const isSelected = selectedFeedbackIds.has(f.id);
               return (
                 <div 
                   key={f.id} 
                   onClick={() => toggleFeedbackSelection(f.id)}
                   className={`bg-white p-6 rounded-xl border shadow-sm cursor-pointer transition-all ${
                     isSelected ? 'border-green-500 ring-1 ring-green-500 bg-green-50/30' : 'border-slate-200 hover:border-green-300'
                   }`}
                 >
                   <div className="flex justify-between items-start mb-4">
                     <div className="flex items-center gap-2">
                       <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors
                         ${isSelected ? 'bg-green-600 border-green-600' : 'border-slate-300 bg-white'}
                       `}>
                         {isSelected && <Check className="w-3 h-3 text-white" />}
                       </div>
                       <span className="text-xs font-bold text-slate-400">Click to select</span>
                     </div>
                     <div className="flex gap-1">
                       <button 
                         onClick={(e) => { 
                           e.stopPropagation(); 
                           openAnkiModal({ type: 'feedback', item: { original: f.original, improved: f.improved, explanation: f.explanation } }, false);
                         }}
                         className="p-1.5 rounded-full text-slate-400 hover:bg-green-100 hover:text-green-600 transition-colors"
                         title="Add to Anki"
                       >
                         <Plus className="w-4 h-4" />
                       </button>
                       <button 
                         onClick={(e) => { 
                           e.stopPropagation(); 
                           if (confirm('确定要删除这个反馈吗？')) {
                             onDeleteSavedItem(f.id, 'feedback');
                           }
                         }}
                         className="p-1.5 rounded-full text-slate-400 hover:bg-red-100 hover:text-red-600 transition-colors"
                         title="删除"
                       >
                         <Trash2 className="w-4 h-4" />
                       </button>
                     </div>
                   </div>
                   <div className="flex flex-col md:flex-row gap-4 mb-4">
                     <div className="flex-1 space-y-1">
                        <span className="text-xs font-bold text-red-500 uppercase">Original</span>
                        <div className="p-3 bg-red-50 rounded-lg text-red-900 text-sm border border-red-100">{f.original}</div>
                     </div>
                     <div className="hidden md:flex items-center justify-center text-slate-300">
                       <RotateCw className="w-5 h-5 rotate-90" />
                     </div>
                     <div className="flex-1 space-y-1">
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-bold text-green-600 uppercase">Improved</span>
                          <button 
                            onClick={(e) => { e.stopPropagation(); playAudio(f.improved); }} 
                            className="text-green-600 hover:text-green-800"
                          >
                            <Volume2 className="w-4 h-4"/>
                          </button>
                        </div>
                        <div className="p-3 bg-green-50 rounded-lg text-green-900 text-sm font-medium border border-green-100">{f.improved}</div>
                     </div>
                   </div>
                   <div className="flex items-start gap-2 text-slate-600 bg-slate-50 p-3 rounded-lg">
                      <AlertCircle className="w-4 h-4 mt-0.5 text-indigo-500 shrink-0" />
                      <p className="text-sm italic">{f.explanation}</p>
                   </div>
                 </div>
               );
             })}
           </div>
        )}

        {isFlashcardMode && (
           <div className="flex flex-col items-center justify-center py-6 h-full animate-in zoom-in duration-300">
             <h2 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2">
               <div className="w-2 h-8 bg-indigo-500 rounded-full"></div>
               Flashcard Review
             </h2>
             
             {flashcards.length === 0 ? (
               <div className="text-center p-12 bg-slate-50 rounded-2xl border border-dashed border-slate-300">
                 <p className="text-slate-500 text-lg">Save phrases to unlock flashcards.</p>
                 <button className="mt-4 px-4 py-2 bg-white border border-slate-300 rounded-lg text-slate-600 text-sm hover:bg-slate-50">Go to Practice Room</button>
               </div>
             ) : (
               <div className="w-full max-w-xl">
                  <div className="mb-4 flex justify-between text-sm text-slate-400">
                    <span>Card {currentCardIndex + 1} of {flashcards.length}</span>
                    <span>Reviews: {flashcards[currentCardIndex].flashcard?.reviews || 0}</span>
                  </div>

                  <div 
                    onClick={() => setIsFlipped(prev => !prev)}
                    className="relative h-80 cursor-pointer perspective-1000 group"
                  >
                    <div className={`relative w-full h-full duration-500 preserve-3d transition-all ${isFlipped ? 'rotate-y-180' : ''}`} style={{ transformStyle: 'preserve-3d', transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)' }}>
                      
                      <div className="absolute inset-0 backface-hidden bg-white border-2 border-indigo-50 rounded-3xl shadow-xl flex flex-col items-center justify-center p-10 text-center hover:border-indigo-200 transition-colors">
                         <span className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-6">Recall this phrase</span>
                         <h2 className="text-4xl font-bold text-slate-800">{flashcards[currentCardIndex].data.phrase}</h2>
                         <div className="absolute bottom-6 flex gap-2 z-10">
                            <button 
                              onClick={(e) => { e.stopPropagation(); playAudio(flashcards[currentCardIndex].data.phrase); }}
                              className="p-2 bg-indigo-100 text-indigo-600 rounded-full hover:bg-indigo-200 transition-colors"
                            >
                              <Volume2 className="w-5 h-5" />
                            </button>
                         </div>
                      </div>

                      <div className="absolute inset-0 backface-hidden bg-slate-800 rounded-3xl shadow-xl flex flex-col items-center justify-center p-10 text-center rotate-y-180 border-2 border-slate-700" style={{ transform: 'rotateY(180deg)', backfaceVisibility: 'hidden' }}>
                         <span className="text-xs font-bold text-indigo-300 uppercase tracking-widest mb-2">Explanation</span>
                         <p className="text-white text-xl mb-6 leading-relaxed">{flashcards[currentCardIndex].data.explanation}</p>
                         <div className="bg-slate-700 p-4 rounded-xl text-indigo-200 text-base italic w-full flex justify-between items-center">
                           <span>"{flashcards[currentCardIndex].data.example}"</span>
                           <button 
                             onClick={(e) => { e.stopPropagation(); playAudio(flashcards[currentCardIndex].data.example); }}
                             className="p-1 text-indigo-400 hover:text-white"
                           >
                             <Volume2 className="w-4 h-4" />
                           </button>
                         </div>
                      </div>
                    </div>
                  </div>

                  {isFlipped ? (
                    <div className="grid grid-cols-4 gap-3 mt-8 animate-in fade-in slide-in-from-bottom-4">
                      <button onClick={() => handleFlashcardRate('again')} className="flex flex-col items-center p-3 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 transition-colors">
                        <span className="font-bold text-sm mb-1">Again</span>
                        <span className="text-[10px] opacity-70">&lt; 1 min</span>
                      </button>
                      <button onClick={() => handleFlashcardRate('hard')} className="flex flex-col items-center p-3 rounded-xl bg-orange-50 hover:bg-orange-100 text-orange-700 border border-orange-200 transition-colors">
                        <span className="font-bold text-sm mb-1">Hard</span>
                        <span className="text-[10px] opacity-70">2 days</span>
                      </button>
                      <button onClick={() => handleFlashcardRate('good')} className="flex flex-col items-center p-3 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 transition-colors">
                        <span className="font-bold text-sm mb-1">Good</span>
                        <span className="text-[10px] opacity-70">4 days</span>
                      </button>
                      <button onClick={() => handleFlashcardRate('easy')} className="flex flex-col items-center p-3 rounded-xl bg-green-50 hover:bg-green-100 text-green-700 border border-green-200 transition-colors">
                        <span className="font-bold text-sm mb-1">Easy</span>
                        <span className="text-[10px] opacity-70">7 days</span>
                      </button>
                    </div>
                  ) : (
                    <div className="h-20 mt-8 flex items-center justify-center text-slate-400 text-sm italic">
                       Tap card to flip
                    </div>
                  )}
               </div>
             )}
           </div>
        )}
      </div>

      {/* Anki Config Modal */}
      {showAnkiModal && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
          onClick={(e) => e.target === e.currentTarget && setShowAnkiModal(false)}
        >
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 relative max-h-[90vh] overflow-y-auto">
            <button 
              onClick={() => setShowAnkiModal(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-2xl"
            >
              ×
            </button>
            
            <h3 className="text-xl font-semibold text-indigo-600 mb-4">
              {isBatchMode ? '批量导出到 Anki' : '添加到 Anki'}
            </h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  牌组名称
                </label>
                {ankiDecks.length > 0 ? (
                  <select
                    value={ankiConfig.deckName}
                    onChange={(e) => setAnkiConfig({ ...ankiConfig, deckName: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    {ankiDecks.map(deck => (
                      <option key={deck} value={deck}>{deck}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={ankiConfig.deckName}
                    onChange={(e) => setAnkiConfig({ ...ankiConfig, deckName: e.target.value })}
                    placeholder="输入牌组名称"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  标签 (可选，用逗号分隔)
                </label>
                <input
                  type="text"
                  value={ankiConfig.tags?.join(', ') || ''}
                  onChange={(e) => setAnkiConfig({ 
                    ...ankiConfig, 
                    tags: e.target.value ? e.target.value.split(',').map(t => t.trim()) : []
                  })}
                  placeholder="例如: polyspeak, expression"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>


              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleAnkiExport}
                  disabled={isExportingToAnki || !ankiConfig.deckName}
                  className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isExportingToAnki ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      导出中...
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      导出到 Anki
                    </>
                  )}
                </button>
                <button
                  onClick={() => {
                    setShowAnkiModal(false);
                    setPendingAnkiItem(null);
                  }}
                  className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReviewDashboard;