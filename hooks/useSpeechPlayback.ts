import { useCallback, useState } from 'react';
import { speakText } from '../services/audioService';

type SpeakOptions = {
  lang?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
};

const cancelSpeech = () => {
  try {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  } catch (error) {
    console.error('Speech synthesis cancel failed:', error);
  }
};

export const useSpeechPlayback = (defaultOptions?: SpeakOptions) => {
  const [activeId, setActiveId] = useState<string | null>(null);

  const togglePlayback = useCallback(
    async (id: string, text: string, overrideOptions?: SpeakOptions) => {
      if (!text) return;
      if (activeId === id) {
        cancelSpeech();
        setActiveId(null);
        return;
      }

      setActiveId(id);
      try {
        await speakText(text, { ...defaultOptions, ...overrideOptions });
      } catch (error) {
        console.error('Speech synthesis failed:', error);
      } finally {
        setActiveId((current) => (current === id ? null : current));
      }
    },
    [activeId, defaultOptions]
  );

  const stopPlayback = useCallback(() => {
    cancelSpeech();
    setActiveId(null);
  }, []);

  const isActive = useCallback(
    (id: string) => activeId === id,
    [activeId]
  );

  return {
    activeId,
    isActive,
    togglePlayback,
    stopPlayback,
  };
};

