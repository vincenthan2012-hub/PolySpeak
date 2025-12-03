import React, { useMemo, useState } from 'react';
import { SavedItem, Expression, FeedbackItem, LLMConfig, PromptSettings } from '../types';
import { generateStory } from '../services/geminiService';
import { Sparkles, BookOpen, Loader2, AlertCircle, X, Volume2, Pause, Plus, Download, Trash2, FileText } from 'lucide-react';
import { detectSpeechLang } from '../services/audioService';
import { useSpeechPlayback } from '../hooks/useSpeechPlayback';
import { 
  checkAnkiConnect, 
  getDeckNames, 
  addExpressionToAnki, 
  addFeedbackToAnki,
  batchAddExpressionsToAnki,
  batchAddFeedbackToAnki,
  AnkiConfig
} from '../services/ankiService';
import { useToast } from './ToastProvider';

interface Props {
  savedItems: SavedItem[];
  onUpdateSavedItem: (updatedItem: SavedItem) => void;
  onDeleteSavedItem: (itemId: string, itemType: 'expression' | 'feedback') => void;
  onDeleteSavedItems: (itemIds: string[], itemType: 'expression' | 'feedback') => void;
  mode: 'favorites' | 'flashcards';
  targetLang: string;
  llmConfig: LLMConfig;
  promptSettings: PromptSettings;
}

const ReviewDashboard: React.FC<Props> = ({ savedItems, onUpdateSavedItem, onDeleteSavedItem, onDeleteSavedItems, mode, targetLang, llmConfig, promptSettings }) => {
  const [activeTab, setActiveTab] = useState<'phrases' | 'feedback'>('phrases');
  const [story, setStory] = useState<string | null>(null);
  const [isGeneratingStory, setIsGeneratingStory] = useState(false);
  const [selectedPhraseIds, setSelectedPhraseIds] = useState<Set<string>>(new Set());
  const [selectedFeedbackIds, setSelectedFeedbackIds] = useState<Set<string>>(new Set());
  const [phraseSort, setPhraseSort] = useState<{ field: 'phrase' | 'date'; direction: 'asc' | 'desc' }>({ field: 'date', direction: 'desc' });
  const [feedbackSort, setFeedbackSort] = useState<{ field: 'original' | 'date'; direction: 'asc' | 'desc' }>({ field: 'date', direction: 'desc' });
  
  // Anki State
  const [showAnkiModal, setShowAnkiModal] = useState(false);
  const [ankiConfig, setAnkiConfig] = useState<AnkiConfig>({ deckName: 'PolySpeak', modelName: '' });
  const [isExportingToAnki, setIsExportingToAnki] = useState(false);
  const [ankiDecks, setAnkiDecks] = useState<string[]>([]);
  const [pendingAnkiItem, setPendingAnkiItem] = useState<{ type: 'expression' | 'feedback'; item: any } | null>(null);
  const [isBatchMode, setIsBatchMode] = useState(false);
  
  // Flashcard State
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const { showToast: showGlobalToast } = useToast();

  const expressions = savedItems
    .filter(i => i.type === 'expression')
    .map(i => ({ ...i, data: i.data as Expression }));
  const feedbackItems = savedItems
    .filter(i => i.type === 'feedback')
    .map(i => ({ ...i, data: i.data as FeedbackItem }));
  const flashcards = expressions;
  const { togglePlayback, isActive } = useSpeechPlayback();

  const formatDate = (timestamp?: number) => {
    if (!timestamp) return '—';
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const sortedExpressions = useMemo(() => {
    const items = [...expressions];
    items.sort((a, b) => {
      if (phraseSort.field === 'phrase') {
        const aPhrase = a.data.phrase.toLowerCase();
        const bPhrase = b.data.phrase.toLowerCase();
        const comparison = aPhrase.localeCompare(bPhrase, undefined, { sensitivity: 'base' });
        return phraseSort.direction === 'asc' ? comparison : -comparison;
      }
      const aTime = a.timestamp ?? 0;
      const bTime = b.timestamp ?? 0;
      return phraseSort.direction === 'asc' ? aTime - bTime : bTime - aTime;
    });
    return items;
  }, [expressions, phraseSort]);

  const sortedFeedback = useMemo(() => {
    const items = [...feedbackItems];
    items.sort((a, b) => {
      if (feedbackSort.field === 'original') {
        const aText = a.data.original.toLowerCase();
        const bText = b.data.original.toLowerCase();
        const comparison = aText.localeCompare(bText, undefined, { sensitivity: 'base' });
        return feedbackSort.direction === 'asc' ? comparison : -comparison;
      }
      const aTime = a.timestamp ?? 0;
      const bTime = b.timestamp ?? 0;
      return feedbackSort.direction === 'asc' ? aTime - bTime : bTime - aTime;
    });
    return items;
  }, [feedbackItems, feedbackSort]);

  const togglePhraseSort = (field: 'phrase' | 'date') => {
    setPhraseSort(prev => {
      if (prev.field === field) {
        return { field, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { field, direction: 'asc' };
    });
  };

  const toggleFeedbackSort = (field: 'original' | 'date') => {
    setFeedbackSort(prev => {
      if (prev.field === field) {
        return { field, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { field, direction: 'asc' };
    });
  };

  const areAllExpressionsSelected = sortedExpressions.length > 0 && sortedExpressions.every(item => selectedPhraseIds.has(item.data.id));
  const areAllFeedbackSelected = sortedFeedback.length > 0 && sortedFeedback.every(item => selectedFeedbackIds.has(item.data.id));

  const toggleAllExpressions = (checked: boolean) => {
    if (checked) {
      setSelectedPhraseIds(new Set(sortedExpressions.map(item => item.data.id)));
    } else {
      setSelectedPhraseIds(new Set());
    }
  };

  const toggleAllFeedback = (checked: boolean) => {
    if (checked) {
      setSelectedFeedbackIds(new Set(sortedFeedback.map(item => item.data.id)));
    } else {
      setSelectedFeedbackIds(new Set());
    }
  };

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    showGlobalToast(message, type === 'success' ? 'success' : 'error');
  };

  const handlePlayback = (id: string, text: string) => {
    const lang = detectSpeechLang(text, targetLang);
    togglePlayback(id, text, { lang });
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
        showToast(`无法连接到 AnkiConnect:\n\n${checkResult.error}\n\n请确保:\n1. Anki 正在运行\n2. AnkiConnect 插件已启用\n3. 已配置 CORS 设置`, 'error');
        return;
      }

      const decks = await getDeckNames();
      setAnkiDecks(decks);
      
      if (item) {
        setPendingAnkiItem(item);
      }
      setIsBatchMode(batch);
      setShowAnkiModal(true);
    } catch (error) {
      showToast(`检查 AnkiConnect 连接失败: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    }
  };

  const handleAnkiExport = async () => {
    if (!ankiConfig.deckName) {
      showToast('请选择或输入牌组名称', 'error');
      return;
    }

    setIsExportingToAnki(true);
    
    try {
      if (isBatchMode) {
        // Batch export
        if (activeTab === 'phrases' && selectedPhraseIds.size > 0) {
          const selectedPhrases = expressions.filter(p => selectedPhraseIds.has(p.data.id));
          const result = await batchAddExpressionsToAnki(
            selectedPhrases.map(p => ({
              phrase: p.data.phrase,
              explanation: p.data.explanation,
              example: p.data.example
            })),
            ankiConfig
          );
          if (result.failed > 0 || result.errors.length > 0) {
            showToast(`批量导入完成，但有部分失败。\n成功: ${result.success}\n失败: ${result.failed}${result.errors.length > 0 ? '\n\n错误:\n' + result.errors.slice(0, 5).join('\n') : ''}`, 'error');
          } else {
            showToast(`批量导入完成！成功: ${result.success} 张卡片`, 'success');
          }
          setSelectedPhraseIds(new Set());
        } else if (activeTab === 'feedback' && selectedFeedbackIds.size > 0) {
          const selectedFeedbacks = feedbackItems.filter(f => selectedFeedbackIds.has(f.data.id));
          const result = await batchAddFeedbackToAnki(
            selectedFeedbacks.map(f => f.data),
            ankiConfig
          );
          if (result.failed > 0 || result.errors.length > 0) {
            showToast(`批量导入完成，但有部分失败。\n成功: ${result.success}\n失败: ${result.failed}${result.errors.length > 0 ? '\n\n错误:\n' + result.errors.slice(0, 5).join('\n') : ''}`, 'error');
          } else {
            showToast(`批量导入完成！成功: ${result.success} 张卡片`, 'success');
          }
          setSelectedFeedbackIds(new Set());
        } else {
          showToast('请选择要导出的项目', 'error');
        }
      } else if (pendingAnkiItem) {
        // Single export
        if (pendingAnkiItem.type === 'expression') {
          await addExpressionToAnki(pendingAnkiItem.item, ankiConfig);
          showToast('✅ 短语已成功添加到 Anki！');
        } else {
          await addFeedbackToAnki(pendingAnkiItem.item, ankiConfig);
          showToast('✅ 反馈已成功添加到 Anki！');
        }
      }
      
      setShowAnkiModal(false);
      setPendingAnkiItem(null);
    } catch (error) {
      showToast(`导入失败: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    } finally {
      setIsExportingToAnki(false);
    }
  };

  const handleGenerateStory = async () => {
    if (selectedPhraseIds.size === 0) return;
    setIsGeneratingStory(true);
    try {
      const selectedPhrases = expressions.filter(p => selectedPhraseIds.has(p.data.id));
      const phraseList = selectedPhrases.map(p => p.data.phrase);
      const storyText = await generateStory(phraseList, targetLang, llmConfig, promptSettings.story);
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

  // CSV Export Functions
  const escapeCSV = (text: string): string => {
    if (!text) return '';
    // Escape quotes and wrap in quotes if contains comma, newline, or quote
    if (text.includes(',') || text.includes('\n') || text.includes('"')) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const exportPhrasesToCSV = () => {
    if (selectedPhraseIds.size === 0) {
      showToast('请先选择要导出的短语', 'error');
      return;
    }

    const selectedPhrases = expressions.filter(p => selectedPhraseIds.has(p.data.id));
    
    // CSV Header
    const headers = ['Type', 'Expression', 'Explanation', 'Example', 'Date'];
    const csvRows = [headers.join(',')];

    // CSV Data
    selectedPhrases.forEach(item => {
      const p = item.data;
      const row = [
        escapeCSV(p.type),
        escapeCSV(p.phrase),
        escapeCSV(p.explanation),
        escapeCSV(p.example),
        escapeCSV(formatDate(item.timestamp))
      ];
      csvRows.push(row.join(','));
    });

    // Create and download CSV file
    const csvContent = csvRows.join('\n');
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' }); // BOM for Excel UTF-8 support
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `polyspeak-phrases-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast(`已导出 ${selectedPhrases.length} 个短语到 CSV 文件`, 'success');
  };

  const exportFeedbackToCSV = () => {
    if (selectedFeedbackIds.size === 0) {
      showToast('请先选择要导出的反馈', 'error');
      return;
    }

    const selectedFeedbacks = feedbackItems.filter(f => selectedFeedbackIds.has(f.data.id));
    
    // CSV Header
    const headers = ['Original', 'Improved', 'Feedback', 'Date'];
    const csvRows = [headers.join(',')];

    // CSV Data
    selectedFeedbacks.forEach(item => {
      const f = item.data;
      const row = [
        escapeCSV(f.original),
        escapeCSV(f.improved),
        escapeCSV(f.explanation),
        escapeCSV(formatDate(item.timestamp))
      ];
      csvRows.push(row.join(','));
    });

    // Create and download CSV file
    const csvContent = csvRows.join('\n');
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' }); // BOM for Excel UTF-8 support
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `polyspeak-feedback-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast(`已导出 ${selectedFeedbacks.length} 个反馈到 CSV 文件`, 'success');
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
            { id: 'phrases', label: `Saved Phrases (${expressions.length})` },
            { id: 'feedback', label: `Saved Feedback (${feedbackItems.length})` },
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
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between pb-4 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-bold text-slate-800">Saved Expressions</h3>
                <p className="text-sm text-slate-500">Sort, batch export, or build a story from your favorites.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button 
                  onClick={() => openAnkiModal(undefined, true)} 
                  disabled={selectedPhraseIds.size === 0}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed bg-green-600 text-white hover:bg-green-700"
                >
                  <Download className="w-4 h-4" />
                  Export as Anki card
                </button>
                <button 
                  onClick={exportPhrasesToCSV} 
                  disabled={selectedPhraseIds.size === 0}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed bg-blue-600 text-white hover:bg-blue-700"
                >
                  <FileText className="w-4 h-4" />
                  Export as CSV
                </button>
                <button 
                  onClick={handleBatchDeletePhrases} 
                  disabled={selectedPhraseIds.size === 0}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed bg-red-600 text-white hover:bg-red-700"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete Selected
                </button>
                <button 
                  onClick={handleGenerateStory} 
                  disabled={isGeneratingStory || selectedPhraseIds.size === 0}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed bg-indigo-600 text-white hover:bg-indigo-700"
                >
                  {isGeneratingStory ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  Generate Story
                </button>
              </div>
            </div>

            {story && (
              <div className="bg-indigo-50 p-6 rounded-xl border border-indigo-100 shadow-inner relative">
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
                  <button 
                    onClick={() => handlePlayback('story', story)} 
                    className={`p-1.5 rounded-full transition-colors ${
                      isActive('story') ? 'bg-indigo-600 text-white shadow-inner' : 'bg-indigo-200 text-indigo-700 hover:bg-indigo-300'
                    }`}
                  >
                    {isActive('story') ? <Pause className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  </button>
                </div>
                <div className="prose prose-slate max-w-none leading-loose text-slate-700">
                  {renderStory(story)}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-2">
                <button
                  onClick={() => togglePhraseSort('phrase')}
                  className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${phraseSort.field === 'phrase' ? 'border-indigo-500 text-indigo-600 bg-indigo-50' : 'border-slate-200 text-slate-500 hover:text-slate-700'}`}
                >
                  Expression {phraseSort.field === 'phrase' ? (phraseSort.direction === 'asc' ? '↑' : '↓') : '↕'}
                </button>
                <button
                  onClick={() => togglePhraseSort('date')}
                  className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${phraseSort.field === 'date' ? 'border-indigo-500 text-indigo-600 bg-indigo-50' : 'border-slate-200 text-slate-500 hover:text-slate-700'}`}
                >
                  Date {phraseSort.field === 'date' ? (phraseSort.direction === 'asc' ? '↑' : '↓') : '↕'}
                </button>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input 
                  type="checkbox" 
                  checked={areAllExpressionsSelected} 
                  onChange={(e) => toggleAllExpressions(e.target.checked)} 
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                Select All ({selectedPhraseIds.size}/{sortedExpressions.length})
              </label>
            </div>

            <div className="overflow-x-auto bg-white border border-slate-200 rounded-2xl shadow-sm">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="w-10 px-4 py-3">
                      <input 
                        type="checkbox" 
                        checked={areAllExpressionsSelected} 
                        onChange={(e) => toggleAllExpressions(e.target.checked)} 
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                    </th>
                    <th className="px-4 py-3 text-left">Type</th>
                    <th className="px-4 py-3 text-left">Expression</th>
                    <th className="px-4 py-3 text-left">Explanation</th>
                    <th className="px-4 py-3 text-left">Example sentence</th>
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {sortedExpressions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-slate-400">No phrases saved yet.</td>
                    </tr>
                  ) : (
                    sortedExpressions.map(item => {
                      const p = item.data;
                      const isSelected = selectedPhraseIds.has(p.id);
                      return (
                        <tr
                          key={p.id}
                          onClick={() => toggleSelection(p.id)}
                          className={`cursor-pointer ${isSelected ? 'bg-indigo-50/70' : 'hover:bg-slate-50'}`}
                        >
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelection(p.id)}
                              onClick={(e) => e.stopPropagation()}
                              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-[11px] font-bold px-2 py-1 rounded uppercase tracking-wider
                              ${p.type === 'idiom' ? 'bg-purple-100 text-purple-700' : 
                                p.type === 'slang' ? 'bg-pink-100 text-pink-700' : 'bg-blue-100 text-blue-700'}`}>
                              {p.type}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-slate-900">{p.phrase}</span>
                              <button 
                                onClick={(e) => { e.stopPropagation(); handlePlayback(`saved-phrase-${p.id}`, p.phrase); }}
                                className={`p-1.5 rounded-full transition-colors ${
                                  isActive(`saved-phrase-${p.id}`)
                                    ? 'bg-indigo-600 text-white shadow-inner'
                                    : 'text-slate-400 hover:bg-indigo-100 hover:text-indigo-600'
                                }`}
                                title="Play audio"
                              >
                                {isActive(`saved-phrase-${p.id}`) ? <Pause className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                              </button>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-600">{p.explanation}</td>
                          <td className="px-4 py-3 text-slate-500 italic">"{p.example}"</td>
                          <td className="px-4 py-3 text-slate-500">{formatDate(item.timestamp)}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <button 
                                onClick={(e) => { 
                                  e.stopPropagation(); 
                                  openAnkiModal({ type: 'expression', item: { phrase: p.phrase, explanation: p.explanation, example: p.example } }, false);
                                }}
                                className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-green-200 text-green-600 hover:bg-green-50 transition-colors"
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
                                className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
                                title="Delete"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!isFlashcardMode && activeTab === 'feedback' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between pb-4 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-bold text-slate-800">Saved Feedback</h3>
                <p className="text-sm text-slate-500">Review, sort, and push corrections directly to Anki.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button 
                  onClick={() => openAnkiModal(undefined, true)} 
                  disabled={selectedFeedbackIds.size === 0}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed bg-green-600 text-white hover:bg-green-700"
                >
                  <Download className="w-4 h-4" />
                  Export as Anki card
                </button>
                <button 
                  onClick={exportFeedbackToCSV} 
                  disabled={selectedFeedbackIds.size === 0}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed bg-blue-600 text-white hover:bg-blue-700"
                >
                  <FileText className="w-4 h-4" />
                  Export as CSV
                </button>
                <button 
                  onClick={handleBatchDeleteFeedback} 
                  disabled={selectedFeedbackIds.size === 0}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed bg-red-600 text-white hover:bg-red-700"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete Selected
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-2">
                <button
                  onClick={() => toggleFeedbackSort('original')}
                  className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${feedbackSort.field === 'original' ? 'border-green-500 text-green-600 bg-green-50' : 'border-slate-200 text-slate-500 hover:text-slate-700'}`}
                >
                  Original {feedbackSort.field === 'original' ? (feedbackSort.direction === 'asc' ? '↑' : '↓') : '↕'}
                </button>
                <button
                  onClick={() => toggleFeedbackSort('date')}
                  className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${feedbackSort.field === 'date' ? 'border-green-500 text-green-600 bg-green-50' : 'border-slate-200 text-slate-500 hover:text-slate-700'}`}
                >
                  Date {feedbackSort.field === 'date' ? (feedbackSort.direction === 'asc' ? '↑' : '↓') : '↕'}
                </button>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input 
                  type="checkbox" 
                  checked={areAllFeedbackSelected} 
                  onChange={(e) => toggleAllFeedback(e.target.checked)} 
                  className="rounded border-slate-300 text-green-600 focus:ring-green-500"
                />
                Select All ({selectedFeedbackIds.size}/{sortedFeedback.length})
              </label>
            </div>

            <div className="overflow-x-auto bg-white border border-slate-200 rounded-2xl shadow-sm">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="w-10 px-4 py-3">
                      <input 
                        type="checkbox" 
                        checked={areAllFeedbackSelected} 
                        onChange={(e) => toggleAllFeedback(e.target.checked)} 
                        className="rounded border-slate-300 text-green-600 focus:ring-green-500"
                      />
                    </th>
                    <th className="px-4 py-3 text-left">Original</th>
                    <th className="px-4 py-3 text-left">Improved</th>
                    <th className="px-4 py-3 text-left">Feedback</th>
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {sortedFeedback.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-slate-400">No feedback saved yet.</td>
                    </tr>
                  ) : (
                    sortedFeedback.map(item => {
                      const f = item.data;
                      const isSelected = selectedFeedbackIds.has(f.id);
                      return (
                        <tr
                          key={f.id}
                          onClick={() => toggleFeedbackSelection(f.id)}
                          className={`cursor-pointer ${isSelected ? 'bg-green-50/70' : 'hover:bg-slate-50'}`}
                        >
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleFeedbackSelection(f.id)}
                              onClick={(e) => e.stopPropagation()}
                              className="rounded border-slate-300 text-green-600 focus:ring-green-500"
                            />
                          </td>
                          <td className="px-4 py-3 text-red-600">
                            <div className="space-y-1">
                              <span className="text-[11px] font-bold uppercase tracking-wide text-red-400">Original</span>
                              <p className="bg-red-50 border border-red-100 rounded-lg p-2 text-sm text-red-900">{f.original}</p>
                              {f.audioClipUrl && (
                                <audio
                                  controls
                                  src={f.audioClipUrl}
                                  className="mt-2 w-full max-w-xs rounded-lg border border-slate-200"
                                  preload="metadata"
                                >
                                  您的浏览器不支持音频播放。
                                </audio>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-green-700">
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-bold uppercase tracking-wide text-green-500">Improved</span>
                                <button 
                                  onClick={(e) => { e.stopPropagation(); handlePlayback(`feedback-${f.id}`, f.improved); }} 
                                  className={`p-1 rounded-full transition-colors ${
                                    isActive(`feedback-${f.id}`)
                                      ? 'bg-green-600 text-white shadow-inner'
                                      : 'text-green-600 hover:bg-green-100'
                                  }`}
                                  title="Play audio"
                                >
                                  {isActive(`feedback-${f.id}`) ? <Pause className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                                </button>
                              </div>
                              <p className="bg-green-50 border border-green-100 rounded-lg p-2 text-sm font-medium text-green-900">{f.improved}</p>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            <div className="space-y-1">
                              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Feedback</span>
                              <p className="bg-slate-50 border border-slate-100 rounded-lg p-2 text-sm italic flex gap-2">
                                <AlertCircle className="w-4 h-4 text-indigo-500 shrink-0" />
                                {f.explanation}
                              </p>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-500">{formatDate(item.timestamp)}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                                <button 
                                  onClick={(e) => { 
                                  e.stopPropagation(); 
                                  openAnkiModal({ type: 'feedback', item: f }, false);
                                }}
                                className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-green-200 text-green-600 hover:bg-green-50 transition-colors"
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
                                className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
                                title="Delete"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
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
                              onClick={(e) => { e.stopPropagation(); handlePlayback(`flashcard-phrase-${flashcards[currentCardIndex].data.id}`, flashcards[currentCardIndex].data.phrase); }}
                              className={`p-2 rounded-full transition-colors ${
                                isActive(`flashcard-phrase-${flashcards[currentCardIndex].data.id}`)
                                  ? 'bg-indigo-600 text-white shadow-inner'
                                  : 'bg-indigo-100 text-indigo-600 hover:bg-indigo-200'
                              }`}
                            >
                              {isActive(`flashcard-phrase-${flashcards[currentCardIndex].data.id}`) ? <Pause className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                            </button>
                         </div>
                      </div>

                      <div className="absolute inset-0 backface-hidden bg-slate-800 rounded-3xl shadow-xl flex flex-col items-center justify-center p-10 text-center rotate-y-180 border-2 border-slate-700" style={{ transform: 'rotateY(180deg)', backfaceVisibility: 'hidden' }}>
                         <span className="text-xs font-bold text-indigo-300 uppercase tracking-widest mb-2">Explanation</span>
                         <p className="text-white text-xl mb-6 leading-relaxed">{flashcards[currentCardIndex].data.explanation}</p>
                         <div className="bg-slate-700 p-4 rounded-xl text-indigo-200 text-base italic w-full flex justify-between items-center">
                           <span>"{flashcards[currentCardIndex].data.example}"</span>
                           <button 
                             onClick={(e) => { e.stopPropagation(); handlePlayback(`flashcard-example-${flashcards[currentCardIndex].data.id}`, flashcards[currentCardIndex].data.example); }}
                             className={`p-1 transition-colors ${
                               isActive(`flashcard-example-${flashcards[currentCardIndex].data.id}`)
                                 ? 'text-white'
                                 : 'text-indigo-400 hover:text-white'
                             }`}
                           >
                             {isActive(`flashcard-example-${flashcards[currentCardIndex].data.id}`) ? <Pause className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
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