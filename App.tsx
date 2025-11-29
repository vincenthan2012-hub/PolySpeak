import React, { useState, useEffect, useRef } from 'react';
import { Mic, ChevronDown, Star, Layers, Settings, Languages, X, Sparkles, Server, Key, Globe, Loader2, BookOpen, Volume2, Pause } from 'lucide-react';
import { generateScaffold, analyzeAudio, generateSampleSpeech, generateInspirePrompt, generateLiveHint, DEFAULT_PROMPT_TEMPLATES } from './services/geminiService';
import { GraphicData, Expression, AnalysisResult, SavedItem, FeedbackItem, LANGUAGES, LLMConfig, WhisperConfig, Difficulty, PromptSettings } from './types';
import { getAvailableModels } from './services/whisperService';
import GraphicOrganizer from './components/GraphicOrganizer';
import ExpressionList from './components/ExpressionList';
import AudioRecorder from './components/AudioRecorder';
import FeedbackDisplay from './components/FeedbackDisplay';
import ReviewDashboard from './components/ReviewDashboard';
import { useSpeechPlayback } from './hooks/useSpeechPlayback';
import StructureOutline from './components/StructureOutline';
import { clipAudioSegmentFromDataUrl } from './services/audioService';

enum View {
  PRACTICE = 'practice',
  FAVORITES = 'favorites',
  FLASHCARDS = 'flashcards'
}

const PROVIDERS = [
  { id: 'gemini', name: 'Google Gemini', defaultModel: 'gemini-2.5-flash', defaultUrl: '' },
  { id: 'openai', name: 'OpenAI', defaultModel: 'gpt-4o', defaultUrl: 'https://api.openai.com/v1' },
  { id: 'deepseek', name: 'DeepSeek', defaultModel: 'deepseek-chat', defaultUrl: 'https://api.deepseek.com' },
  { id: 'siliconflow', name: 'SiliconFlow', defaultModel: 'deepseek-ai/DeepSeek-V3', defaultUrl: 'https://api.siliconflow.cn/v1' },
  { id: 'ollama', name: 'Ollama (Local)', defaultModel: 'llama3', defaultUrl: 'http://localhost:11434' },
];

const MAX_PROMPT_HISTORY = 20;

function App() {
  // State
  const [view, setView] = useState<View>(View.PRACTICE);
  const [showSettings, setShowSettings] = useState(false);
  
  // Language State
  const [targetLang, setTargetLang] = useState(() => {
    const saved = localStorage.getItem('lingua_target_lang');
    return saved || 'es-ES'; // Default Spanish
  });
  const [nativeLang, setNativeLang] = useState(() => {
    const saved = localStorage.getItem('lingua_native_lang');
    return saved || 'en-US'; // Default English
  });
  
  // LLM Config State
  const [llmConfig, setLlmConfig] = useState<LLMConfig>(() => {
    const saved = localStorage.getItem('lingua_llm_config');
    return saved ? JSON.parse(saved) : {
      provider: 'gemini',
      apiKey: '',
      baseUrl: '',
      model: 'gemini-2.5-flash'
    };
  });

  // Saved LLM models (per provider), displayed as tags
  const [savedLlmModels, setSavedLlmModels] = useState<{ provider: LLMConfig['provider']; model: string }[]>(() => {
    try {
      const raw = localStorage.getItem('lingua_llm_saved_models');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (m: any) =>
          m &&
          typeof m.model === 'string' &&
          m.model.trim().length > 0 &&
          ['gemini', 'ollama', 'openai', 'deepseek', 'siliconflow'].includes(m.provider)
      );
    } catch {
      return [];
    }
  });

  // Whisper Config State
  const [whisperConfig, setWhisperConfig] = useState<WhisperConfig>(() => {
    const saved = localStorage.getItem('lingua_whisper_config');
    return saved ? JSON.parse(saved) : {
      enabled: true,
      model: 'base',
      language: undefined
    };
  });

  const [expressionExplanationLang, setExpressionExplanationLang] = useState(() => {
    const saved = localStorage.getItem('lingua_expression_lang');
    if (saved) return saved;
    return nativeLang;
  });

  const [promptSettings, setPromptSettings] = useState<PromptSettings>(() => {
    const saved = localStorage.getItem('lingua_prompt_settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return { ...DEFAULT_PROMPT_TEMPLATES, ...parsed };
      } catch {
        return { ...DEFAULT_PROMPT_TEMPLATES };
      }
    }
    return { ...DEFAULT_PROMPT_TEMPLATES };
  });

  // Save configs when changed
  useEffect(() => {
    localStorage.setItem('lingua_llm_config', JSON.stringify(llmConfig));
  }, [llmConfig]);

  useEffect(() => {
    localStorage.setItem('lingua_llm_saved_models', JSON.stringify(savedLlmModels));
  }, [savedLlmModels]);

  useEffect(() => {
    localStorage.setItem('lingua_whisper_config', JSON.stringify(whisperConfig));
  }, [whisperConfig]);

  useEffect(() => {
    localStorage.setItem('lingua_prompt_settings', JSON.stringify(promptSettings));
  }, [promptSettings]);

  useEffect(() => {
    localStorage.setItem('lingua_expression_lang', expressionExplanationLang);
  }, [expressionExplanationLang]);

  // Save language settings when changed
  useEffect(() => {
    localStorage.setItem('lingua_target_lang', targetLang);
  }, [targetLang]);

  useEffect(() => {
    localStorage.setItem('lingua_native_lang', nativeLang);
  }, [nativeLang]);

  const prevNativeLangRef = useRef(nativeLang);
  useEffect(() => {
    if (expressionExplanationLang === prevNativeLangRef.current) {
      setExpressionExplanationLang(nativeLang);
    }
    prevNativeLangRef.current = nativeLang;
  }, [nativeLang, expressionExplanationLang]);

  // Practice State
  const [topic, setTopic] = useState('');
  const topicInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [expressionCount, setExpressionCount] = useState<number>(5);
  const [difficulty, setDifficulty] = useState<Difficulty>('intermediate');
  const [isLoadingScaffold, setIsLoadingScaffold] = useState(false);
  const [scaffoldData, setScaffoldData] = useState<{structure: GraphicData, expressions: Expression[]} | null>(null);
  const [structureViewMode, setStructureViewMode] = useState<'graphic' | 'outline'>('graphic');
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [promptHistory, setPromptHistory] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('lingua_prompt_history');
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed.filter((item: unknown): item is string => typeof item === 'string') : [];
    } catch {
      return [];
    }
  });
  
  // Sample Speech State
  const [sampleSpeech, setSampleSpeech] = useState<string | null>(null);
  const [isGeneratingSample, setIsGeneratingSample] = useState(false);
  const [showSampleModal, setShowSampleModal] = useState(false);
  
  // Analysis State
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const { togglePlayback: toggleSamplePlayback, isActive: isSampleActive } = useSpeechPlayback();

  // Live Hint State
  const [liveHint, setLiveHint] = useState<{ type: 'question' | 'hint'; message: string } | null>(null);
  const [isGeneratingHint, setIsGeneratingHint] = useState(false);
  const hintCooldownRef = useRef<number>(0);

  // Saved Data
  const [savedItems, setSavedItems] = useState<SavedItem[]>(() => {
    const saved = localStorage.getItem('lingua_saved');
    return saved ? JSON.parse(saved) : [];
  });

  useEffect(() => {
    localStorage.setItem('lingua_saved', JSON.stringify(savedItems));
  }, [savedItems]);

  useEffect(() => {
    localStorage.setItem('lingua_prompt_history', JSON.stringify(promptHistory.slice(0, MAX_PROMPT_HISTORY)));
  }, [promptHistory]);

  const adjustTopicTextareaHeight = (textarea: HTMLTextAreaElement | null) => {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(textarea.scrollHeight, 64)}px`;
  };

  useEffect(() => {
    adjustTopicTextareaHeight(topicInputRef.current);
  }, [topic]);

  const savedPhrases = new Set(
    savedItems.filter(i => i.type === 'expression').map(i => (i.data as Expression).id)
  );
  const savedFeedbackIds = new Set(
    savedItems.filter(i => i.type === 'feedback').map(i => (i.data as FeedbackItem).id)
  );

  // Helper to format error messages
  const formatError = (error: unknown): string => {
    if (error instanceof Error) {
      const message = error.message;
      // Check for Ollama-specific errors
      if (message.includes('Ollama') || message.includes('ollama')) {
        return `Ollama 连接错误:\n\n${message}\n\n请检查:\n1. Ollama 是否已安装并运行 (ollama serve)\n2. 模型是否已下载 (ollama pull ${llmConfig.model})\n3. 浏览器控制台是否有更多错误信息`;
      }
      // Check for timeout errors
      if (message.includes('timeout') || message.includes('timed out')) {
        const isOllama = llmConfig.provider === 'ollama';
        return `请求超时:\n\n${message}\n\n建议:\n${isOllama ? '1. 使用更小的模型 (如 llama3:8b 而不是 llama3:70b)\n2. 尝试更简单的主题\n3. 确保系统有足够的内存和 CPU 资源\n4. 等待时间可能需要 2-5 分钟' : '1. 检查网络连接\n2. 稍后重试'}`;
      }
      // Check for JSON parsing errors
      if (message.includes('JSON') || message.includes('Invalid')) {
        const isOllama = llmConfig.provider === 'ollama';
        return `JSON 解析错误:\n\n${message}\n\n建议:\n${isOllama ? '1. 尝试使用更新的模型 (如 llama3.1 或 llama3.2)\n2. 使用更简单的主题\n3. 检查浏览器控制台查看原始响应' : '1. 稍后重试\n2. 检查浏览器控制台'}`;
      }
      return message;
    }
    return "未知错误，请查看浏览器控制台获取详细信息";
  };

  // Handlers
  const handleTopicInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    adjustTopicTextareaHeight(event.currentTarget);
    setTopic(event.target.value);
  };

  const handlePromptChange = (key: keyof PromptSettings, value: string) => {
    setPromptSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleGenerateScaffold = async () => {
    if (!topic.trim()) return;
    setIsLoadingScaffold(true);
    setScaffoldData(null);
    setSampleSpeech(null);
    setShowSampleModal(false);
    setAnalysisResult(null);
    try {
      const data = await generateScaffold(
        topic,
        expressionCount,
        targetLang,
        nativeLang,
        expressionExplanationLang,
        llmConfig,
        difficulty
      );
      setScaffoldData(data);
    } catch (error) {
      console.error('Error generating scaffold:', error);
      alert(`生成计划失败:\n\n${formatError(error)}`);
    } finally {
      setIsLoadingScaffold(false);
    }
  };

  const handleShowSample = async () => {
    if (sampleSpeech) {
        setShowSampleModal(true);
        return;
    }
    if (!scaffoldData) return;

    setIsGeneratingSample(true);
    try {
        const phrases = scaffoldData.expressions.map(e => e.phrase);
        const text = await generateSampleSpeech(topic, phrases, targetLang, llmConfig, promptSettings.sample);
        setSampleSpeech(text);
        setShowSampleModal(true);
    } catch (e) {
        console.error('Error generating sample:', e);
        alert(`生成示例失败:\n\n${formatError(e)}`);
    } finally {
        setIsGeneratingSample(false);
    }
  };

  const handleInspireMe = async () => {
    if (isGeneratingPrompt) return;
    setIsGeneratingPrompt(true);
    try {
      const prompt = await generateInspirePrompt(difficulty, promptHistory, llmConfig, promptSettings.inspire);
      const cleanPrompt = prompt.trim();
      if (cleanPrompt) {
        setTopic(cleanPrompt);
        setPromptHistory(prev => {
          const updated = [cleanPrompt, ...prev.filter(item => item !== cleanPrompt)];
          return updated.slice(0, MAX_PROMPT_HISTORY);
        });
      }
    } catch (error) {
      console.error('Error generating inspire prompt:', error);
      alert(`生成话题失败:\n\n${formatError(error)}`);
    } finally {
      setIsGeneratingPrompt(false);
    }
  };

  const handleAudioCaptured = async (base64: string, mimeType: string) => {
    const safeMime = mimeType || 'audio/webm';
    const dataUrl = `data:${safeMime};base64,${base64}`;
    setIsAnalyzing(true);
    try {
      // Get language code for Whisper (e.g., 'es' from 'es-ES')
      const whisperLangCode = targetLang.split('-')[0].toLowerCase();
      const whisperConfigWithLang = {
        ...whisperConfig,
        language: whisperConfig.language || whisperLangCode
      };
      const result = await analyzeAudio(base64, targetLang, nativeLang, llmConfig, whisperConfigWithLang, promptSettings.feedback);
      setAnalysisResult({ ...result, audioUrl: dataUrl, audioMimeType: safeMime });
    } catch (error) {
      console.error('Error analyzing audio:', error);
      alert(`分析失败:\n\n${formatError(error)}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleRecordingStall = async () => {
    if (!topic.trim() || isGeneratingHint) return;
    const now = Date.now();
    if (now - hintCooldownRef.current < 15000) return;
    setIsGeneratingHint(true);
    try {
      const hint = await generateLiveHint(topic, difficulty, llmConfig, promptSettings.liveHint);
      setLiveHint(hint);
      hintCooldownRef.current = now;
    } catch (error) {
      console.error('Error generating live hint:', error);
    } finally {
      setIsGeneratingHint(false);
    }
  };

  const handleRecordingResume = () => {
    setLiveHint(null);
    setIsGeneratingHint(false);
  };

  const togglePhraseFavorite = (expr: Expression) => {
    setSavedItems(prev => {
      const exists = prev.find(i => i.type === 'expression' && (i.data as Expression).id === expr.id);
      if (exists) {
        return prev.filter(i => i !== exists);
      } else {
        return [...prev, { type: 'expression', data: expr, timestamp: Date.now() }];
      }
    });
  };

  const saveFeedback = async (item: FeedbackItem) => {
    let enrichedItem = item;
    const hasAudioSegment = analysisResult?.audioUrl &&
      typeof item.audioStart === 'number' &&
      typeof item.audioEnd === 'number' &&
      item.audioEnd > item.audioStart;

    if (hasAudioSegment && analysisResult?.audioUrl) {
      try {
        const clip = await clipAudioSegmentFromDataUrl(
          analysisResult.audioUrl,
          item.audioStart!,
          item.audioEnd!
        );
        enrichedItem = {
          ...item,
          audioClipUrl: clip.dataUrl,
          audioClipMimeType: clip.mimeType,
          audioClipDuration: clip.duration
        };
      } catch (error) {
        console.warn('Failed to clip audio segment for feedback favorite:', error);
      }
    }

    setSavedItems(prev => {
      if (prev.some(i => i.type === 'feedback' && (i.data as FeedbackItem).id === enrichedItem.id)) return prev;
      return [...prev, { type: 'feedback', data: enrichedItem, timestamp: Date.now() }];
    });
  };

  const updateSavedItem = (updatedItem: SavedItem) => {
    setSavedItems(prev => prev.map(item => {
      // @ts-ignore
      if (item.data.id === updatedItem.data.id) return updatedItem;
      return item;
    }));
  };

  const deleteSavedItem = (itemId: string, itemType: 'expression' | 'feedback') => {
    setSavedItems(prev => prev.filter(item => {
      if (item.type !== itemType) return true;
      // @ts-ignore
      return item.data.id !== itemId;
    }));
  };

  const deleteSavedItems = (itemIds: string[], itemType: 'expression' | 'feedback') => {
    setSavedItems(prev => prev.filter(item => {
      if (item.type !== itemType) return true;
      // @ts-ignore
      return !itemIds.includes(item.data.id);
    }));
  };

  const handleProviderChange = (providerId: string) => {
    const providerDef = PROVIDERS.find(p => p.id === providerId);
    setLlmConfig(prev => ({
      ...prev,
      provider: providerId as LLMConfig['provider'],
      model: providerDef?.defaultModel || prev.model,
      baseUrl: providerDef?.defaultUrl || prev.baseUrl,
    }));
  };

  const handleSaveCurrentModel = () => {
    const modelName = llmConfig.model.trim();
    if (!modelName) return;
    setSavedLlmModels(prev => {
      // Avoid duplicates per provider + model
      if (prev.some(m => m.provider === llmConfig.provider && m.model === modelName)) {
        return prev;
      }
      return [...prev, { provider: llmConfig.provider, model: modelName }];
    });
  };

  const handleApplySavedModel = (modelName: string) => {
    setLlmConfig(prev => ({ ...prev, model: modelName }));
  };

  const handleDeleteSavedModel = (provider: LLMConfig['provider'], modelName: string) => {
    setSavedLlmModels(prev => prev.filter(m => !(m.provider === provider && m.model === modelName)));
  };

  const handleSamplePlayback = (text: string) => {
    if (!text) return;
    const cleanText = text.replace(/\*\*/g, '');
    toggleSamplePlayback('sample-speech', cleanText, { lang: targetLang });
  };

  const renderHighlightedText = (text: string) => {
    const parts = text.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <span key={i} className="bg-indigo-100 text-indigo-700 font-bold px-1 rounded border border-indigo-200">{part.slice(2, -2)}</span>;
      }
      return part;
    });
  };

  const promptFieldMeta: { key: keyof PromptSettings; label: string; helper: string }[] = [
    {
      key: 'inspire',
      label: 'Inspire Me',
      helper: 'Placeholders: {{level}}, {{promptTypes}}, {{history}}'
    },
    {
      key: 'liveHint',
      label: 'AI Hint',
      helper: 'Placeholders: {{topic}}, {{difficulty}}'
    },
    {
      key: 'story',
      label: 'Generate Story',
      helper: 'Placeholders: {{targetLang}}, {{phrases}}'
    },
    {
      key: 'feedback',
      label: 'Feedback',
      helper: 'Placeholders: {{targetLang}}, {{nativeLang}}, {{transcription}}'
    },
    {
      key: 'sample',
      label: 'Show Sample',
      helper: 'Placeholders: {{topic}}, {{targetLang}}, {{phrases}}, {{minCount}}'
    }
  ];

  const NavigationContent = () => (
    <nav className="space-y-2">
      <button 
        onClick={() => setView(View.PRACTICE)}
        className={`flex items-center w-full px-4 py-3 rounded-xl transition-all font-medium duration-200 ${view === View.PRACTICE ? 'bg-white/10 text-white shadow-inner border border-white/10' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
      >
        <Mic className="w-5 h-5 mr-3" />
        Practice Room
      </button>
      <button 
          onClick={() => setView(View.FAVORITES)}
        className={`flex items-center w-full px-4 py-3 rounded-xl transition-all font-medium duration-200 ${view === View.FAVORITES ? 'bg-white/10 text-white shadow-inner border border-white/10' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
      >
        <Star className="w-5 h-5 mr-3" />
        Favorites
      </button>
      <button 
          onClick={() => setView(View.FLASHCARDS)}
        className={`flex items-center w-full px-4 py-3 rounded-xl transition-all font-medium duration-200 ${view === View.FLASHCARDS ? 'bg-white/10 text-white shadow-inner border border-white/10' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
      >
        <Layers className="w-5 h-5 mr-3" />
        Flashcards
      </button>
    </nav>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row font-sans text-slate-900">
      
      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-[60] bg-slate-900/20 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 border border-slate-100 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Settings className="w-5 h-5 text-slate-400" />
                Settings
              </h3>
              <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {/* Language Settings */}
            <div className="space-y-4 mb-8">
              <h4 className="text-sm font-bold text-indigo-600 uppercase tracking-wider border-b border-slate-100 pb-2 mb-4">Languages</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">I speak (Native)</label>
                  <div className="relative">
                    <select 
                      value={nativeLang}
                      onChange={(e) => setNativeLang(e.target.value)}
                      className="w-full pl-3 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 focus:ring-2 focus:ring-indigo-100 outline-none appearance-none"
                    >
                      {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">I am learning</label>
                  <div className="relative">
                    <select 
                      value={targetLang}
                      onChange={(e) => setTargetLang(e.target.value)}
                      className="w-full pl-3 pr-8 py-2 bg-indigo-50 border border-indigo-100 rounded-lg text-sm font-medium text-indigo-700 focus:ring-2 focus:ring-indigo-200 outline-none appearance-none"
                    >
                      {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-indigo-400 pointer-events-none" />
                  </div>
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Expression Explanations</label>
                  <div className="relative">
                    <select
                      value={expressionExplanationLang}
                      onChange={(e) => setExpressionExplanationLang(e.target.value)}
                      className="w-full pl-3 pr-8 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 focus:ring-2 focus:ring-indigo-100 outline-none appearance-none"
                    >
                      {LANGUAGES.map(l => <option key={`expr-${l.code}`} value={l.code}>{l.name}</option>)}
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1">Choose the language used for expression explanations.</p>
                </div>
              </div>
            </div>

            {/* LLM Settings */}
            <div className="space-y-4">
              <h4 className="text-sm font-bold text-purple-600 uppercase tracking-wider border-b border-slate-100 pb-2 mb-4 flex items-center gap-2">
                <Server className="w-4 h-4" />
                AI Provider
              </h4>
              
              {/* Provider Selector Grid */}
              <div className="grid grid-cols-3 gap-2 mb-6">
                 {PROVIDERS.map(p => (
                   <button
                     key={p.id}
                     onClick={() => handleProviderChange(p.id)}
                     className={`py-2 px-1 text-xs font-bold rounded-lg border transition-all ${llmConfig.provider === p.id ? 'bg-slate-800 text-white border-slate-800 shadow-md' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'}`}
                   >
                     {p.name}
                   </button>
                 ))}
              </div>

              <div className="space-y-4">
                <div>
                   <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                     API Key 
                     {llmConfig.provider === 'gemini' && ' (Optional)'}
                     {llmConfig.provider === 'ollama' && ' (Not Required)'}
                   </label>
                   <div className="relative">
                     <input 
                        type="password" 
                        value={llmConfig.apiKey}
                        onChange={(e) => setLlmConfig(prev => ({...prev, apiKey: e.target.value}))}
                        placeholder={llmConfig.provider === 'gemini' ? "Use default or custom key" : "sk-..."}
                        disabled={llmConfig.provider === 'ollama'}
                        className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 focus:ring-2 focus:ring-indigo-100 outline-none disabled:opacity-50"
                     />
                     <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                   </div>
                </div>

                {llmConfig.provider !== 'gemini' && (
                  <div>
                     <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Base URL</label>
                     <div className="relative">
                        <input 
                            type="text" 
                            value={llmConfig.baseUrl}
                            onChange={(e) => setLlmConfig(prev => ({...prev, baseUrl: e.target.value}))}
                            placeholder="https://api..."
                            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 focus:ring-2 focus:ring-indigo-100 outline-none"
                        />
                        <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                     </div>
                  </div>
                )}

                <div className="space-y-2">
                   <div className="flex items-center justify-between gap-3">
                     <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">
                       Model Name
                     </label>
                     <button
                       type="button"
                       onClick={handleSaveCurrentModel}
                       className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-600 border border-indigo-100 hover:bg-indigo-100 transition-colors"
                     >
                       Save Model
                     </button>
                   </div>
                   <input 
                      type="text" 
                      value={llmConfig.model}
                      onChange={(e) => setLlmConfig(prev => ({...prev, model: e.target.value}))}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 focus:ring-2 focus:ring-indigo-100 outline-none"
                   />
                   {savedLlmModels.filter(m => m.provider === llmConfig.provider).length > 0 && (
                     <div className="pt-1 space-y-1">
                       <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                         Saved Models
                       </span>
                       <div className="flex flex-wrap gap-2">
                         {savedLlmModels
                           .filter(m => m.provider === llmConfig.provider)
                           .map(m => (
                             <button
                               key={`${m.provider}-${m.model}`}
                               type="button"
                               onClick={() => handleApplySavedModel(m.model)}
                               className="group relative inline-flex items-center gap-1 pl-3 pr-2 py-1.5 rounded-full bg-slate-100 text-slate-700 text-[11px] font-medium border border-slate-200 hover:bg-indigo-50 hover:border-indigo-200 hover:text-indigo-600 transition-colors"
                             >
                               <span className="max-w-[160px] truncate text-left">{m.model}</span>
                               <span
                                 onClick={(e) => {
                                   e.stopPropagation();
                                   handleDeleteSavedModel(m.provider, m.model);
                                 }}
                                 className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                               >
                                 <X className="w-3 h-3" />
                               </span>
                             </button>
                           ))}
                       </div>
                     </div>
                   )}
                </div>
                
              </div>
            </div>

            {/* Whisper Settings */}
            <div className="space-y-4">
              <h4 className="text-sm font-bold text-blue-600 uppercase tracking-wider border-b border-slate-100 pb-2 mb-4 flex items-center gap-2">
                <Mic className="w-4 h-4" />
                Speech Recognition (Whisper)
              </h4>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Enable Whisper</label>
                    <p className="text-[10px] text-slate-500">Use local Whisper model for speech-to-text</p>
                  </div>
                  <button
                    onClick={() => setWhisperConfig(prev => ({ ...prev, enabled: !prev.enabled }))}
                    className={`relative w-12 h-6 rounded-full transition-colors ${
                      whisperConfig.enabled ? 'bg-indigo-600' : 'bg-slate-300'
                    }`}
                  >
                    <div
                      className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                        whisperConfig.enabled ? 'translate-x-6' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {whisperConfig.enabled && (
                  <>
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                        Model Size
                        <span className="ml-2 text-[10px] text-slate-400 font-normal">(Larger = More Accurate, Slower)</span>
                      </label>
                      <div className="relative">
                        <select
                          value={whisperConfig.model}
                          onChange={(e) => setWhisperConfig(prev => ({ ...prev, model: e.target.value as WhisperConfig['model'] }))}
                          className="w-full pl-3 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 focus:ring-2 focus:ring-indigo-100 outline-none appearance-none"
                        >
                          {getAvailableModels().map(m => (
                            <option key={m.value} value={m.value}>
                              {m.label} ({m.size})
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                        Language
                        <span className="ml-2 text-[10px] text-slate-400 font-normal">(Leave empty for auto-detect)</span>
                      </label>
                      <input
                        type="text"
                        value={whisperConfig.language || ''}
                        onChange={(e) => setWhisperConfig(prev => ({ ...prev, language: e.target.value || undefined }))}
                        placeholder="Auto-detect (e.g., en, es, zh)"
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 focus:ring-2 focus:ring-indigo-100 outline-none"
                      />
                    </div>

                    <div className="p-3 bg-blue-50 rounded-lg border border-blue-100 flex gap-2 items-start">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0"></div>
                      <p className="text-[10px] text-blue-800 leading-tight">
                        <strong>Note:</strong> The first time you use Whisper, the model will be downloaded (one-time download). 
                        Larger models provide better accuracy but require more time and memory.
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Prompt Templates */}
            <div className="space-y-4 mt-8">
              <h4 className="text-sm font-bold text-rose-600 uppercase tracking-wider border-b border-slate-100 pb-2 mb-2 flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                Prompt Templates
              </h4>
              <p className="text-xs text-slate-500">
                Adjust the instructions sent to the AI. Use the placeholders shown for each template (e.g., <span className="font-mono text-[11px] bg-slate-100 px-1 rounded">{'{{topic}}'}</span>).
              </p>
              <div className="space-y-4">
                {promptFieldMeta.map((field) => (
                  <div key={field.key} className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">{field.label}</span>
                      <span className="text-[10px] text-slate-400">{field.helper}</span>
                    </div>
                    <textarea
                      value={promptSettings[field.key]}
                      onChange={(e) => handlePromptChange(field.key, e.target.value)}
                      rows={5}
                      className="w-full text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg p-3 focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 resize-vertical"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-slate-100">
              <button 
                onClick={() => setShowSettings(false)}
                className="w-full py-3 bg-slate-900 text-white font-semibold rounded-xl hover:bg-slate-800 transition-colors shadow-lg shadow-slate-200"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Sample Speech Modal */}
      {showSampleModal && sampleSpeech && (
         <div className="fixed inset-0 z-[70] bg-slate-900/20 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 border border-slate-100 flex flex-col max-h-[85vh]">
               <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-3">
                  <h3 className="text-lg font-bold text-indigo-900 flex items-center gap-2">
                    <BookOpen className="w-5 h-5 text-indigo-500" />
                    Sample Speech
                  </h3>
                  <button 
                    onClick={() => setShowSampleModal(false)} 
                    className="p-2 hover:bg-slate-100 rounded-full text-slate-400 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
               </div>
               
               <div className="flex-1 overflow-y-auto px-2 mb-4">
                 <div className="prose prose-indigo max-w-none leading-loose text-lg text-slate-700 font-medium">
                   {renderHighlightedText(sampleSpeech)}
                 </div>
               </div>

              <div className="flex justify-end pt-4 border-t border-slate-100">
                  <button 
                    onClick={() => handleSamplePlayback(sampleSpeech)}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold shadow-lg shadow-indigo-200 transition-all active:scale-95 ${
                      isSampleActive('sample-speech') ? 'bg-slate-900 text-white' : 'bg-indigo-600 text-white hover:bg-indigo-700'
                    }`}
                  >
                    {isSampleActive('sample-speech') ? <Pause className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                    {isSampleActive('sample-speech') ? 'Pause Sample' : 'Listen to Sample'}
                  </button>
               </div>
            </div>
         </div>
      )}

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-72 bg-slate-900 text-white h-screen sticky top-0 z-50 shadow-2xl border-r border-slate-800">
        <div className="p-8 mb-2">
           <div className="flex items-center gap-3">
             <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-blue-500 flex items-center justify-center shadow-lg shadow-indigo-500/30">
               <Sparkles className="w-5 h-5 text-white" />
             </div>
             <div>
               <h1 className="text-xl font-bold tracking-tight text-white">PolySpeak</h1>
             </div>
           </div>
           <p className="text-slate-500 text-xs mt-2 font-medium pl-11">Structural Speaking Coach</p>
        </div>
        
        <div className="px-4 flex-1">
          <NavigationContent />
        </div>

        <div className="p-6 space-y-4">
           <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/50 text-xs text-slate-400 backdrop-blur-sm">
              <p className="font-bold text-slate-300 mb-1 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
                Pro Tip
              </p>
              Check out the different graphic organizers generated for each topic to structure your thoughts!
           </div>
           <div className="text-center text-[10px] text-slate-600 font-medium">
              v1.0.0 • Powered by {PROVIDERS.find(p => p.id === llmConfig.provider)?.name}
           </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-screen relative bg-slate-50/50">
        
        {/* Header (Mobile & Desktop) */}
        <header className="bg-white border-b border-slate-200/60 px-6 py-4 flex justify-between items-center sticky top-0 z-20 backdrop-blur-xl bg-white/80 supports-[backdrop-filter]:bg-white/60">
          <div className="md:hidden flex items-center gap-2">
             <div className="w-6 h-6 rounded bg-gradient-to-br from-indigo-500 to-blue-500 flex items-center justify-center">
               <Sparkles className="w-3 h-3 text-white" />
             </div>
             <h1 className="text-lg font-bold text-slate-800">PolySpeak</h1>
          </div>
          
          {/* Spacer for desktop to push settings to right */}
          <div className="hidden md:block"></div> 

          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-indigo-50 rounded-full border border-indigo-100 text-xs font-bold text-indigo-600">
              <Languages className="w-3 h-3" />
              {LANGUAGES.find(l => l.code === targetLang)?.name || 'Target'}
            </div>
            <button 
              onClick={() => setShowSettings(true)}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-all"
              title="Settings"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto scroll-smooth relative">
          <div className="p-4 pb-36 md:p-10 md:pb-32 max-w-7xl mx-auto">
            {view === View.PRACTICE ? (
              <div className="space-y-8 animate-in fade-in duration-500">
                
                {/* Hero Input Section */}
                <section className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 border border-white p-1 relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500"></div>
                  <div className="p-6 md:p-8 space-y-6">
                    {/* Responsive Layout Adjustments */}
                    <div className="flex flex-col lg:flex-row gap-6 items-stretch lg:items-end">
                      <div className="flex-1 w-full space-y-3">
                        <div className="flex items-center justify-between">
                          <label className="block text-sm font-bold text-slate-700 pl-1">Topic</label>
                        </div>
                        <div className="relative">
                          <textarea
                            ref={topicInputRef}
                            rows={1}
                            value={topic}
                            onChange={handleTopicInput}
                            placeholder="What would you like to practice talking about?"
                            className="w-full px-6 pr-32 py-4 text-lg bg-slate-50 rounded-2xl border-2 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 transition-all outline-none placeholder:text-slate-400 font-medium resize-none overflow-hidden"
                            style={{ minHeight: '64px', height: topic ? undefined : '64px' }}
                          />
                          <button
                            type="button"
                            onClick={handleInspireMe}
                            disabled={isGeneratingPrompt}
                            className="absolute top-1/2 right-3 -translate-y-1/2 inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl border border-indigo-100 text-indigo-600 bg-white/90 hover:bg-white transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
                          >
                            {isGeneratingPrompt ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                            Inspire Me
                          </button>
                        </div>
                      </div>
                      
                      {/* Controls Group */}
                      <div className="flex flex-col md:flex-row gap-4 lg:w-auto shrink-0">
                        <div className="w-full md:w-32 space-y-3">
                          <label className="block text-sm font-bold text-slate-700 pl-1">Expressions</label>
                          <div className="relative">
                            <input
                              type="number"
                              min="1"
                              max="20"
                              list="default-numbers"
                              value={expressionCount}
                              onChange={(e) => setExpressionCount(Number(e.target.value))}
                              className="w-full px-5 py-4 text-lg bg-slate-50 rounded-2xl border-2 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none font-medium text-slate-700"
                            />
                            <datalist id="default-numbers">
                              <option value="3"></option>
                              <option value="5"></option>
                              <option value="8"></option>
                              <option value="10"></option>
                            </datalist>
                          </div>
                        </div>
                        <div className="w-full md:w-44 space-y-3">
                          <label className="block text-sm font-bold text-slate-700 pl-1">Difficulty</label>
                          <div className="relative">
                            <select
                              value={difficulty}
                              onChange={(e) => setDifficulty(e.target.value as Difficulty)}
                              className="w-full px-5 py-4 text-lg bg-slate-50 rounded-2xl border-2 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none font-medium text-slate-700 appearance-none"
                            >
                              <option value="beginner">Beginner</option>
                            <option value="pre-intermediate">Pre-intermediate</option>
                              <option value="intermediate">Intermediate</option>
                            <option value="upper-intermediate">Upper-intermediate</option>
                              <option value="advanced">Advanced</option>
                            </select>
                            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />
                          </div>
                        </div>
                        <div className="w-full md:w-auto space-y-3 flex items-end">
                          <button 
                            onClick={handleGenerateScaffold}
                            disabled={isLoadingScaffold || !topic}
                            className="h-14 px-8 bg-slate-900 text-white font-bold text-base rounded-2xl hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/40 hover:-translate-y-0.5 active:translate-y-0 active:shadow-none whitespace-nowrap w-full md:w-auto"
                          >
                            {isLoadingScaffold ? (
                              <span className="flex items-center gap-2"><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> Working...</span>
                            ) : (
                              'Create Plan'
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                {scaffoldData && scaffoldData.structure && (
                  <div className="grid lg:grid-cols-12 gap-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
                    
                    {/* Left Column: Structure (7 columns) */}
                    <div className="lg:col-span-7 space-y-6 min-w-0">
                      <div className="flex items-center justify-between px-1 gap-3 flex-wrap">
                          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                            <div className="w-2 h-6 bg-indigo-500 rounded-full"></div>
                            Speaking Structure
                          </h2>
                          <div className="flex items-center gap-3">
                            {scaffoldData.structure.type && (
                              <span className="text-[10px] font-bold px-3 py-1 bg-white border border-indigo-100 text-indigo-600 rounded-full uppercase tracking-wider shadow-sm">
                                {scaffoldData.structure.type}
                              </span>
                            )}
                            <div className="bg-slate-100 rounded-full p-1 flex text-xs font-semibold text-slate-500">
                              <button
                                type="button"
                                onClick={() => setStructureViewMode('graphic')}
                                className={`px-3 py-1.5 rounded-full transition-colors ${structureViewMode === 'graphic' ? 'bg-white text-indigo-600 shadow-sm' : 'hover:text-slate-700'}`}
                              >
                                Graphic
                              </button>
                              <button
                                type="button"
                                onClick={() => setStructureViewMode('outline')}
                                className={`px-3 py-1.5 rounded-full transition-colors ${structureViewMode === 'outline' ? 'bg-white text-indigo-600 shadow-sm' : 'hover:text-slate-700'}`}
                              >
                                Outline
                              </button>
                            </div>
                          </div>
                       </div>
                       
                       {/* Graphic Organizer Container - "Picture Frame" look */}
                       {structureViewMode === 'graphic' ? (
                         <div className="rounded-xl overflow-hidden shadow-md border border-slate-200 bg-white">
                            <GraphicOrganizer data={scaffoldData.structure} />
                         </div>
                       ) : (
                         <StructureOutline data={scaffoldData.structure} />
                       )}
                    </div>

                    {/* Right Column: Expressions (5 columns) */}
                    <div className="lg:col-span-5 space-y-6 min-w-0">
                      <div className="flex justify-between items-center px-1">
                        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                            <div className="w-2 h-6 bg-pink-500 rounded-full"></div>
                            Expressions
                        </h2>
                        <button 
                          onClick={handleShowSample}
                          disabled={isGeneratingSample}
                          className="text-xs font-bold px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-full border border-indigo-100 hover:bg-indigo-100 transition-colors flex items-center gap-1.5"
                        >
                          {isGeneratingSample ? <Loader2 className="w-3 h-3 animate-spin" /> : <BookOpen className="w-3 h-3" />}
                          Show Sample
                        </button>
                      </div>
                      <div className="h-[600px] overflow-y-auto pr-2 scrollbar-thin">
                        {scaffoldData.expressions && scaffoldData.expressions.length > 0 ? (
                          <ExpressionList 
                            expressions={scaffoldData.expressions}
                            favorites={savedPhrases}
                            toggleFavorite={togglePhraseFavorite}
                            targetLang={targetLang}
                          />
                        ) : (
                          <div className="p-8 text-center text-slate-400">
                            <p>No expressions available</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Analysis Result */}
                {analysisResult && (
                  <section className="animate-in fade-in zoom-in duration-500 pt-8 border-t border-slate-200">
                     <h2 className="text-2xl font-bold text-slate-800 mb-6 flex items-center gap-2">
                       <Sparkles className="w-6 h-6 text-indigo-500" />
                       Feedback & Correction
                     </h2>
                      <FeedbackDisplay 
                        result={analysisResult} 
                        savedFeedbackIds={savedFeedbackIds}
                        onSaveFeedback={saveFeedback}
                      />
                  </section>
                )}

              </div>
            ) : (
              <ReviewDashboard 
                savedItems={savedItems} 
                onUpdateSavedItem={updateSavedItem}
                onDeleteSavedItem={deleteSavedItem}
                onDeleteSavedItems={deleteSavedItems}
                mode={view === View.FLASHCARDS ? 'flashcards' : 'favorites'}
                targetLang={targetLang}
                llmConfig={llmConfig}
                promptSettings={promptSettings}
              />
            )}
          </div>
          
          {/* Sticky Recorder at Bottom - Available only in Practice View */}
          {view === View.PRACTICE && (
            <div className="fixed bottom-20 md:bottom-6 left-0 right-0 z-40 flex justify-center px-4 pointer-events-none">
               <div className="w-full max-w-xl pointer-events-auto animate-in slide-in-from-bottom-4 fade-in duration-500 space-y-3">
                 {(isGeneratingHint || liveHint) && (
                   <div className="flex justify-center">
                     <div className="bg-slate-900/90 text-white px-4 py-3 rounded-2xl shadow-xl flex items-start gap-3 w-full">
                        <div className="w-8 h-8 rounded-full bg-indigo-500/40 flex items-center justify-center mt-0.5">
                          <Sparkles className="w-4 h-4 text-white" />
                        </div>
                        <div className="flex-1">
                          <p className="text-[10px] uppercase tracking-[0.2em] text-indigo-200 font-semibold mb-1">
                            {liveHint ? (liveHint.type === 'question' ? 'AI Question' : 'AI Hint') : 'AI Coach'}
                          </p>
                          <p className="text-sm leading-snug">
                            {liveHint ? liveHint.message : 'Thinking of the next nudge...'}
                          </p>
                        </div>
                        <button
                          onClick={() => setLiveHint(null)}
                          className="text-white/60 hover:text-white transition-colors"
                          aria-label="Close hint"
                        >
                          <X className="w-4 h-4" />
                        </button>
                     </div>
                   </div>
                 )}
                 <AudioRecorder 
                   onAudioCaptured={handleAudioCaptured} 
                   isAnalyzing={isAnalyzing} 
                   onStallDetected={handleRecordingStall}
                   onSpeechResumed={handleRecordingResume}
                 />
               </div>
            </div>
          )}
        </main>

        {/* Mobile Bottom Navigation Bar */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-lg border-t border-slate-200 flex justify-around items-center pb-safe z-50 shadow-[0_-8px_30px_rgba(0,0,0,0.04)]">
           <button 
             onClick={() => setView(View.PRACTICE)}
             className={`flex flex-col items-center p-4 flex-1 active:bg-slate-50 transition-colors ${view === View.PRACTICE ? 'text-indigo-600' : 'text-slate-400'}`}
           >
             <Mic className={`w-6 h-6 ${view === View.PRACTICE ? 'fill-indigo-100' : ''} transition-transform active:scale-90`} />
             <span className={`text-[10px] font-bold mt-1 ${view === View.PRACTICE ? 'opacity-100' : 'opacity-60'}`}>Practice</span>
           </button>
           <button 
             onClick={() => setView(View.FAVORITES)}
             className={`flex flex-col items-center p-4 flex-1 active:bg-slate-50 transition-colors ${view === View.FAVORITES ? 'text-indigo-600' : 'text-slate-400'}`}
           >
             <Star className={`w-6 h-6 ${view === View.FAVORITES ? 'fill-indigo-100' : ''} transition-transform active:scale-90`} />
             <span className={`text-[10px] font-bold mt-1 ${view === View.FAVORITES ? 'opacity-100' : 'opacity-60'}`}>Favorites</span>
           </button>
           <button 
             onClick={() => setView(View.FLASHCARDS)}
             className={`flex flex-col items-center p-4 flex-1 active:bg-slate-50 transition-colors ${view === View.FLASHCARDS ? 'text-indigo-600' : 'text-slate-400'}`}
           >
             <Layers className={`w-6 h-6 ${view === View.FLASHCARDS ? 'fill-indigo-100' : ''} transition-transform active:scale-90`} />
             <span className={`text-[10px] font-bold mt-1 ${view === View.FLASHCARDS ? 'opacity-100' : 'opacity-60'}`}>Flashcards</span>
           </button>
        </nav>
      </div>
    </div>
  );
}

export default App;