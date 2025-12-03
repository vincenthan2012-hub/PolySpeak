import { SentenceTiming } from '../types';

export const normalizeSentenceForMatch = (text?: string): string => {
  if (!text || typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

export const findSentenceTimingMatch = (
  text: string,
  timings?: SentenceTiming[]
): SentenceTiming | null => {
  if (!timings?.length) return null;
  const normalizedTarget = normalizeSentenceForMatch(text);
  if (!normalizedTarget) return null;

  let exactMatch: SentenceTiming | null = null;
  let fallbackMatch: SentenceTiming | null = null;
  let bestOverlapMatch: SentenceTiming | null = null;
  let bestOverlapScore = 0;

  for (const timing of timings) {
    if (typeof timing.start !== 'number' || typeof timing.end !== 'number') continue;
    const normalizedTiming = normalizeSentenceForMatch(timing.text);
    if (!normalizedTiming) continue;

    // 精确匹配（最高优先级）
    if (normalizedTiming === normalizedTarget) {
      exactMatch = timing;
      break; // 找到精确匹配后立即返回
    }

    // 计算重叠度（用于更准确的匹配）
    const targetWords = normalizedTarget.split(/\s+/).filter(Boolean);
    const timingWords = normalizedTiming.split(/\s+/).filter(Boolean);
    const targetSet = new Set(targetWords);
    const timingSet = new Set(timingWords);
    
    let overlap = 0;
    targetSet.forEach(word => {
      if (timingSet.has(word)) overlap++;
    });
    
    const overlapScore = overlap / Math.max(targetWords.length, timingWords.length);
    
    // 如果重叠度超过80%，认为是很好的匹配
    if (overlapScore > 0.8 && overlapScore > bestOverlapScore) {
      bestOverlapScore = overlapScore;
      bestOverlapMatch = timing;
    }

    // 包含关系匹配（较低优先级）
    if (
      !fallbackMatch &&
      (normalizedTiming.includes(normalizedTarget) || normalizedTarget.includes(normalizedTiming))
    ) {
      fallbackMatch = timing;
    }
  }

  // 按优先级返回：精确匹配 > 高重叠度匹配 > 包含关系匹配
  return exactMatch || bestOverlapMatch || fallbackMatch;
};

