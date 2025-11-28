export enum GraphicType {
  VENN = 'venn',
  LINEAR = 'linear',
  CIRCLE = 'circle',
  FISHBONE = 'fishbone'
}

export interface Expression {
  id: string;
  phrase: string;
  type: 'idiom' | 'slang' | 'common';
  explanation: string;
  example: string;
}

export interface GraphicData {
  type: GraphicType;
  title: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content: any; 
}

export interface FeedbackItem {
  id: string;
  original: string;
  improved: string;
  explanation: string;
}

export interface OverallFeedback {
  taskResponse: string;
  coherence: string;
  cohesion: string;
  vocabulary: string;
  grammar: string;
}

export interface AnalysisResult {
  transcription: string;
  improvedText: string;
  feedback: FeedbackItem[];
  overallFeedback?: OverallFeedback;
  audioUrl?: string;
  audioMimeType?: string;
}

export type Difficulty = 'beginner' | 'pre-intermediate' | 'intermediate' | 'upper-intermediate' | 'advanced';

export interface FlashcardState {
  ease: number;
  interval: number; // in days
  dueDate: number; // timestamp
  reviews: number;
}

export interface SavedItem {
  type: 'expression' | 'feedback';
  data: Expression | FeedbackItem;
  timestamp: number;
  flashcard?: FlashcardState;
}

export interface Language {
  code: string;
  name: string;
  voiceCode?: string; // Helper for speech synthesis voice matching
}

export interface LLMConfig {
  provider: 'gemini' | 'ollama' | 'openai' | 'deepseek' | 'siliconflow';
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface WhisperConfig {
  enabled: boolean;
  model: 'tiny' | 'base' | 'small' | 'medium' | 'large' | 'large-v2' | 'large-v3';
  language?: string; // Optional language code (e.g., 'en', 'es', 'zh')
}

export interface PromptSettings {
  inspire: string;
  liveHint: string;
  story: string;
  feedback: string;
  sample: string;
}

export const LANGUAGES: Language[] = [
  { code: 'en-US', name: 'English' },
  { code: 'es-ES', name: 'Spanish' },
  { code: 'fr-FR', name: 'French' },
  { code: 'de-DE', name: 'German' },
  { code: 'zh-CN', name: 'Chinese (Mandarin)' },
  { code: 'ja-JP', name: 'Japanese' },
  { code: 'ko-KR', name: 'Korean' },
  { code: 'it-IT', name: 'Italian' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)' },
  { code: 'ru-RU', name: 'Russian' }
];