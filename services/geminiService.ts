import { GoogleGenAI, Type } from "@google/genai";
import { GraphicData, Expression, AnalysisResult, LLMConfig, WhisperConfig, Difficulty, WhisperSegment } from "../types";
import { transcribeAudio } from "./whisperService";

// Default config if none provided
const DEFAULT_CONFIG: LLMConfig = {
  provider: 'gemini',
  apiKey: process.env.API_KEY || '',
  baseUrl: '',
  model: 'gemini-2.5-flash'
};

export const DEFAULT_PROMPT_TEMPLATES = {
  inspire: `You are a structural speaking coach.

Learner level: {{level}}.

CRITICAL: You MUST generate a {{requiredType}} prompt this time. Do NOT use {{avoidTypes}}.

Available prompt types: {{promptTypes}}

{{history}}

Requirements:
1. Generate ONE prompt only.
2. The sentence MUST start with exactly one of these stems: "Describe", "Discuss", or "Talk about".
3. The topic must be specific, age-appropriate, and achievable for the learner.
4. The prompt MUST be {{requiredType}} type:
   - Descriptive: Focus on describing a place, person, object, or scene in detail
   - Narrative: Focus on telling a story or recounting an experience with a clear sequence
   - Argumentative: Focus on expressing and supporting an opinion or argument
   - Creative: Focus on imaginative scenarios, hypothetical situations, or creative thinking
5. Encourage variety by using fresh settings, situations, emotions, or perspectives.
6. Keep output to a single sentence ending with a period. No bullet points, numbering, emojis, or explanations.

Return only the prompt text.`,
  liveHint: `You are an encouraging speaking coach helping a learner discuss "{{topic}}" at the {{difficulty}} level.

{{transcriptionContext}}

{{recentInsightsSection}}

Direct quote of their latest words (use naturally, do NOT repeat verbatim if it sounds awkward):
"{{meaningfulSnippet}}"

The learner paused and needs a quick nudge to continue. Actively listen to what they said and provide either:
1. A follow-up question that references specific details from their speech (places, people, activities, experiences they mentioned), OR
2. A hint that suggests a connector, structure, or expression to help them continue.

{{transcriptionGuidance}}

{{hintStrategy}}

IMPORTANT RULES:
- Do NOT summarize or paraphrase the learner's speech. Do NOT restate what they said in other words.
- Go straight to a guiding QUESTION or a concrete NEXT-STEP HINT.
- Always reference a real detail from their RECENT speech (names, places, activities, feelings, contrasts)
- Use proper grammar: convert verbs to noun phrases (e.g., "went to Paris" → "the trip" or "your visit to Paris")
- Be specific and contextual - avoid generic questions like "What made you think that?" unless they actually said "I think..."
- Prefer a follow-up question when details are available; otherwise offer a concrete strategy or connector
- When giving a hint, DO NOT repeat what the learner already said; directly tell them what they can add next (e.g., "Explain why you enjoyed the museum" or "Add a detail about who you went with.")
- Keep it warm, encouraging, and under 35 words
- Make it feel natural and conversational

OUTPUT FORMAT:
Return ONLY valid JSON in this exact format:
{"type":"question"|"hint","message":"Your question or hint here"}

Examples:
- Question: "What did you see in Paris?" (if they mentioned Paris)
- Question: "What kind of books do you enjoy?" (if they mentioned reading)
- Hint: "Try using 'For example...' to give a specific example"
- Hint: "You could continue with 'Another thing I like is...'"`,
  story: `Write a fun, engaging short story (around 150 words) in {{targetLang}} that naturally uses the following expressions: {{phrases}}.
Wrap each used expression in double asterisks, e.g., **expression**. Keep the story student-friendly and cohesive.`,
  feedback: `Analyze the following speech transcription from a student practicing "{{targetLang}}".

Transcription: "{{transcription}}"
The student's native language for explanations is "{{nativeLang}}".

Provide comprehensive feedback following IELTS Speaking criteria:
1. "transcription": repeat the provided transcription exactly.
2. "improvedText": a polished version of the entire speech in {{targetLang}}.
3. "feedback": array of objects { "original", "improved", "explanation" } where explanation is in {{nativeLang}}.
4. "overallFeedback": object with keys taskResponse, cohesion, coherence, vocabulary, grammar (all in {{nativeLang}}).

Return ONLY valid JSON with those keys. Do not wrap in markdown.`,
  sample: `Write a natural speech or monologue (about 100-150 words) about "{{topic}}" in "{{targetLang}}".
You MUST use at least {{minCount}} of the following expressions naturally: {{phrases}}.
Wrap each expression you use in double asterisks, e.g., **expression**. Keep the tone motivational and learner-friendly.`
};

const applyPromptTemplate = (template: string, values: Record<string, string>): string => {
  return template.replace(/\{\{\s*(.+?)\s*\}\}/g, (_, key) => {
    const replacement = values[key.trim()];
    return typeof replacement === 'string' ? replacement : '';
  });
};

const normalizeSentence = (text: string) => text
  .toLowerCase()
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u201C\u201D]/g, '"')
  .replace(/[^a-z0-9\s]/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const stripTimestampArtifacts = (text: string) => {
  if (!text) return '';
  return text
    .replace(/\[(?:\d{1,2}:){1,2}\d{1,2}(?:\.\d{1,3})?\]/g, ' ')
    .replace(/^\s*\d{1,2}:\d{2}(?:\.\d{1,3})?\s*/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const splitTranscriptionIntoSentences = (transcription: string): string[] => {
  const cleanText = stripTimestampArtifacts(transcription)
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleanText) return [];

  const matches = cleanText.match(/[^.!?]+[.!?]?/g);
  if (!matches) return [cleanText];

  return matches
    .map(sentence => sentence.trim())
    .filter(Boolean);
};

type SentenceReference = {
  original: string;
  normalized: string;
  start?: number;
  end?: number;
};

const SENTENCE_END_REGEX = /[.!?。！？…]+['")\]]*$/;

const mergeSegmentsIntoSentences = (segments: WhisperSegment[]): SentenceReference[] => {
  if (!segments?.length) return [];
  const merged: SentenceReference[] = [];
  let bufferText = '';
  let bufferStart: number | undefined;
  let lastEnd: number | undefined;

  segments.forEach((segment, index) => {
    const text = (segment.text || '').trim();
    if (!text) return;

    const start = typeof segment.start === 'number' ? segment.start : lastEnd;
    const end = typeof segment.end === 'number' ? segment.end : start;

    if (!bufferText) {
      bufferText = text;
      bufferStart = start;
    } else {
      bufferText = `${bufferText} ${text}`.replace(/\s+/g, ' ');
    }
    lastEnd = end;

    const reachedBoundary = SENTENCE_END_REGEX.test(text);
    const exceededLength = bufferText.length >= 200;
    const isLastSegment = index === segments.length - 1;

    if (reachedBoundary || exceededLength || isLastSegment) {
      const cleaned = bufferText.trim();
      if (cleaned) {
        merged.push({
          original: cleaned,
          normalized: normalizeSentence(cleaned),
          start: bufferStart,
          end
        });
      }
      bufferText = '';
      bufferStart = undefined;
    }
  });

  return merged;
};

const buildSentenceReferences = (transcription: string, segments?: WhisperSegment[]): SentenceReference[] => {
  const sentences = splitTranscriptionIntoSentences(transcription).map(sentence => ({
    original: sentence,
    normalized: normalizeSentence(sentence)
  }));

  if (!sentences.length) return [];
  if (!segments?.length) return sentences;

  const mergedSegments = mergeSegmentsIntoSentences(segments);
  if (!mergedSegments.length) return sentences;

  return sentences.map((sentence, sentenceIndex) => {
    // 首先尝试精确匹配
    const exactMatch = mergedSegments.find(seg => 
      seg.normalized === sentence.normalized
    );
    if (exactMatch && typeof exactMatch.start === 'number' && typeof exactMatch.end === 'number') {
      return {
        ...sentence,
        start: exactMatch.start,
        end: exactMatch.end
      };
    }

    // 如果精确匹配失败，尝试使用findBestSentenceMatch，但使用更严格的阈值
    const match = findBestSentenceMatch(sentence.normalized, mergedSegments);
    if (!match) return sentence;

    // 验证匹配质量：计算相似度
    const sentenceWords = sentence.normalized.split(/\s+/).filter(Boolean);
    const matchWords = match.normalized.split(/\s+/).filter(Boolean);
    const sentenceSet = new Set(sentenceWords);
    const matchSet = new Set(matchWords);
    
    let overlap = 0;
    sentenceSet.forEach(word => {
      if (matchSet.has(word)) overlap++;
    });
    
    const similarity = overlap / Math.max(sentenceWords.length, matchWords.length);
    
    // 只有当相似度足够高时才使用匹配的时间轴
    // 如果相似度不够高，不设置时间轴，让后续流程从sentenceTimings中查找
    if (similarity >= 0.6 && typeof match.start === 'number' && typeof match.end === 'number') {
      return {
        ...sentence,
        start: match.start,
        end: match.end
      };
    }

    // 如果匹配质量不够，返回不带时间轴的句子
    return sentence;
  });
};

const countWords = (text: string) => (text.match(/\b\w+\b/g) || []).length;

const ensureSentenceEnding = (text: string, fallback: string) => {
  if (!text) return fallback;
  const trimmed = text.trim();
  if (!trimmed) return fallback;
  return /[.!?…"]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

const replaceFragmentWithinSentence = (sentence: string, fragment: string, replacement: string) => {
  if (!sentence || !fragment || !replacement) return sentence;
  const escaped = fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escaped, 'i');
  if (!regex.test(sentence)) return sentence;
  return sentence.replace(regex, replacement.trim());
};

const isLikelyFullSentence = (text: string, referenceWordCount: number) => {
  if (!text) return false;
  const words = countWords(text);
  if (!words) return false;
  const ratio = words / Math.max(referenceWordCount, 1);
  return ratio >= 0.6 && /[.!?…"]$/.test(text.trim());
};

const computeTokenOverlap = (a: string, b: string) => {
  if (!a || !b) return 0;
  const aTokens = new Set(a.split(' ').filter(Boolean));
  const bTokens = new Set(b.split(' ').filter(Boolean));
  if (!aTokens.size || !bTokens.size) return 0;
  let overlap = 0;
  aTokens.forEach(token => {
    if (bTokens.has(token)) overlap++;
  });
  return overlap / Math.min(aTokens.size, bTokens.size);
};

/**
 * 基于完整的 transcription 和 improvedText 构造逐句反馈
 * 不再依赖音频时间轴或 fragment 级别的 original/improved
 */
const buildSentenceFeedbackFromFullTexts = (
  transcription: string,
  improvedText: string,
  rawItems: Array<{ original?: string; improved?: string; explanation?: string }>
) => {
  const originalSentences = splitTranscriptionIntoSentences(transcription);
  const improvedSentences = splitTranscriptionIntoSentences(improvedText);

  if (!originalSentences.length) return [] as any[];

  // 1) 先把模型给的 explanation 按「最接近的原句」聚合
  const explanationsByIndex: string[][] = originalSentences.map(() => []);

  rawItems.forEach(item => {
    const rawOriginal = (item.original || '').trim();
    const explanation = (item.explanation || '').trim();
    if (!rawOriginal && !explanation) return;

    const normalizedTarget = normalizeSentence(rawOriginal);
    if (!normalizedTarget) return;

    let bestIndex = -1;
    let bestScore = 0;

    originalSentences.forEach((sentence, index) => {
      const normalizedSentence = normalizeSentence(sentence);
      if (!normalizedSentence) return;

      // 精确匹配优先
      if (normalizedSentence === normalizedTarget) {
        bestIndex = index;
        bestScore = 1;
        return;
      }

      const score = computeTokenOverlap(normalizedTarget, normalizedSentence);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });

    // 只有相似度足够高时才认为是同一句
    if (bestIndex >= 0 && bestScore >= 0.4 && explanation) {
      explanationsByIndex[bestIndex].push(explanation);
    }
  });

  // 2) 按句子顺序生成反馈条目
  const feedback: any[] = [];

  originalSentences.forEach((originalSentence, index) => {
    const original = originalSentence.trim();
    const improved =
      (improvedSentences[index] || originalSentence || '').trim();

    const normalizedOriginal = normalizeSentence(original);
    const normalizedImproved = normalizeSentence(improved);

    const explanations = explanationsByIndex[index];
    let explanation = '';
    if (explanations.length === 1) {
      explanation = explanations[0];
    } else if (explanations.length > 1) {
      explanation = explanations
        .map((text, i) => `${i + 1}. ${text}`)
        .join('\n');
    }

    // 只有在句子真的被修改了，或者有解释时，才生成一条逐句反馈
    const hasTextChange = normalizedOriginal && normalizedOriginal !== normalizedImproved;
    const hasExplanation = explanation.trim().length > 0;

    if (hasTextChange || hasExplanation) {
      feedback.push({
        id: crypto.randomUUID(),
        original,
        improved,
        explanation
      });
    }
  });

  return feedback;
};

const findBestSentenceMatch = <T extends { original: string; normalized: string }>(
  fragmentNormalized: string,
  sentences: T[]
): T | null => {
  if (!fragmentNormalized) return null;

  // 首先尝试精确匹配
  const exactMatch = sentences.find(sentence =>
    sentence.normalized === fragmentNormalized
  );
  if (exactMatch) return exactMatch;

  // 然后尝试包含关系匹配
  const direct = sentences.find(sentence =>
    sentence.normalized.includes(fragmentNormalized)
  );
  if (direct) return direct;

  const reverse = sentences.find(sentence =>
    fragmentNormalized.includes(sentence.normalized)
  );
  if (reverse) return reverse;

  // 最后使用相似度匹配，但提高阈值以确保准确性
  let bestMatch: T | null = null;
  let bestScore = 0;

  sentences.forEach(sentence => {
    const score = computeTokenOverlap(fragmentNormalized, sentence.normalized);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = sentence;
    }
  });

  // 提高阈值从0.35到0.5，确保匹配更准确
  return bestScore >= 0.5 ? bestMatch : null;
};

const buildImprovedSentence = (
  resolvedSentence: string,
  fragmentOriginal: string,
  fragmentImproved: string
) => {
  if (!resolvedSentence) {
    const fallback = fragmentOriginal || fragmentImproved || '';
    return ensureSentenceEnding(fragmentImproved || fallback, fallback);
  }
  const referenceCount = countWords(resolvedSentence);
  if (isLikelyFullSentence(fragmentImproved, referenceCount)) {
    return ensureSentenceEnding(fragmentImproved, resolvedSentence);
  }

  const rebuilt = replaceFragmentWithinSentence(
    resolvedSentence,
    fragmentOriginal,
    fragmentImproved
  );

  if (rebuilt !== resolvedSentence) {
    return ensureSentenceEnding(rebuilt, rebuilt);
  }

  // Fallback to the original sentence if we can't safely rebuild
  return ensureSentenceEnding(fragmentImproved || resolvedSentence, resolvedSentence);
};

const consolidateFeedbackBySentence = (feedbackItems: any[], improvedText?: string, transcription?: string) => {
  const grouped = new Map<string, any[]>();

  feedbackItems.forEach(item => {
    if (!item?.original) return;
    const key = item.original.trim();
    if (!key) return;
    grouped.set(key, [...(grouped.get(key) || []), item]);
  });

  // 优先从完整的improvedText中提取对应句子的完整版本
  const selectBestImproved = (items: any[], originalSentence: string) => {
    // 如果提供了improvedText和transcription，优先从完整文本中提取
    if (improvedText && transcription) {
      const extractedImproved = extractImprovedSentenceFromFullText(
        originalSentence,
        improvedText,
        transcription
      );
      if (extractedImproved) {
        return extractedImproved;
      }
    }
    
    // 如果无法从improvedText中提取，则从已有的items中选择最长的版本
    const unique = Array.from(
      new Set(
        items
          .map(it => (it.improved || '').trim())
          .filter(Boolean)
      )
    );
    if (!unique.length) return '';
    return unique.sort((a, b) => countWords(b) - countWords(a))[0];
  };

  const buildExplanation = (items: any[]) => {
    const explanations = items
      .map(it => (it.explanation || '').trim())
      .filter(Boolean);
    if (!explanations.length) return '';
    if (explanations.length === 1) return explanations[0];
    return explanations
      .map((text, index) => `${index + 1}. ${text}`)
      .join('\n');
  };

  const resolveTiming = (items: any[]) => {
    // 优先查找有完整且有效时间轴的item（必须是完整的句子时间轴，不是fragment时间轴）
    for (const item of items) {
      if (typeof item?.audioStart === 'number' && typeof item?.audioEnd === 'number' && item.audioEnd > item.audioStart) {
        return {
          audioStart: item.audioStart,
          audioEnd: item.audioEnd,
          // 记录这个时间轴来自哪个item，以便后续使用对应的improved版本
          sourceItem: item
        };
      }
    }
    // 如果都没有完整时间轴，返回空对象，让后续流程从sentenceTimings中查找
    // 不要使用fragment的时间轴，因为它们不准确
    return {};
  };

    const consolidated: any[] = [];
    grouped.forEach((items, sentence) => {
      // 优先从完整的improvedText中提取对应句子的完整版本
      let bestImproved = selectBestImproved(items, sentence) || sentence;
      
      // 获取时间轴信息
      const timing = resolveTiming(items);
      
      // 如果从improvedText中提取失败，且时间轴来自某个item，优先使用该item的improved版本
      // 这样可以确保时间轴和improved版本的对应关系
      if (improvedText && transcription) {
        const extractedImproved = extractImprovedSentenceFromFullText(
          sentence,
          improvedText,
          transcription
        );
        if (!extractedImproved && timing.sourceItem && timing.sourceItem.improved) {
          // 如果提取失败，但时间轴来自某个item，使用该item的improved版本
          const sourceImproved = timing.sourceItem.improved.trim();
          if (sourceImproved) {
            bestImproved = sourceImproved;
          }
        }
      } else if (timing.sourceItem && timing.sourceItem.improved) {
        // 如果没有improvedText，但时间轴来自某个item，使用该item的improved版本
        const sourceImproved = timing.sourceItem.improved.trim();
        if (sourceImproved) {
          bestImproved = sourceImproved;
        }
      }
      
      consolidated.push({
        ...items[0],
        id: crypto.randomUUID(),
        original: sentence,
        improved: bestImproved,
        explanation: buildExplanation(items),
        // 只有当timing有完整时间轴时才使用，否则设为undefined，让后续流程从sentenceTimings中查找
        audioStart: typeof timing.audioStart === 'number' && typeof timing.audioEnd === 'number' ? timing.audioStart : undefined,
        audioEnd: typeof timing.audioStart === 'number' && typeof timing.audioEnd === 'number' ? timing.audioEnd : undefined
      });
    });

  return consolidated;
};

/**
 * 从完整改进文本中提取对应句子，确保与 improvedText 一致
 * 使用文本相似度匹配而不是索引位置，确保准确性
 */
const extractImprovedSentenceFromFullText = (
  originalSentence: string,
  improvedText: string,
  transcription: string
): string | null => {
  if (!improvedText || !transcription || !originalSentence) return null;

  // 将原始转录和改进文本都分割成句子
  const originalSentences = splitTranscriptionIntoSentences(transcription);
  const improvedSentences = splitTranscriptionIntoSentences(improvedText);

  if (!originalSentences.length || !improvedSentences.length) return null;

  // 找到原始句子在转录中的位置
  const originalNormalized = normalizeSentence(originalSentence);
  
  // 首先找到原始句子在transcription中的最佳匹配位置
  let bestOriginalIndex = -1;
  let bestOriginalScore = 0;

  for (let i = 0; i < originalSentences.length; i++) {
    const origNormalized = normalizeSentence(originalSentences[i]);
    
    // 精确匹配（最高优先级）
    if (origNormalized === originalNormalized) {
      bestOriginalIndex = i;
      bestOriginalScore = 1.0;
      break;
    }
    
    // 计算相似度
    const targetWords = originalNormalized.split(/\s+/).filter(Boolean);
    const origWords = origNormalized.split(/\s+/).filter(Boolean);
    const targetSet = new Set(targetWords);
    const origSet = new Set(origWords);
    
    let overlap = 0;
    targetSet.forEach(word => {
      if (origSet.has(word)) overlap++;
    });
    
    const score = overlap / Math.max(targetWords.length, origWords.length);
    if (score > bestOriginalScore && score > 0.5) {
      bestOriginalScore = score;
      bestOriginalIndex = i;
    }
  }

  if (bestOriginalIndex < 0) return null;

  // 找到对应的原始句子
  const matchedOriginalSentence = originalSentences[bestOriginalIndex];
  const matchedOriginalNormalized = normalizeSentence(matchedOriginalSentence);

  // 现在在improvedSentences中查找与matchedOriginalSentence最相似的句子
  // 使用文本相似度匹配，而不是简单的索引位置
  let bestImprovedIndex = -1;
  let bestImprovedScore = 0;

  for (let i = 0; i < improvedSentences.length; i++) {
    const improvedNormalized = normalizeSentence(improvedSentences[i]);
    
    // 计算改进句子与原始句子的相似度
    // 使用单词重叠度来判断
    const originalWords = matchedOriginalNormalized.split(/\s+/).filter(Boolean);
    const improvedWords = improvedNormalized.split(/\s+/).filter(Boolean);
    const originalSet = new Set(originalWords);
    const improvedSet = new Set(improvedWords);
    
    let overlap = 0;
    originalSet.forEach(word => {
      if (improvedSet.has(word)) overlap++;
    });
    
    // 相似度计算：考虑两个方向的重叠
    const score = overlap / Math.max(originalWords.length, improvedWords.length);
    
    // 如果句子数量相同且索引位置接近，给予额外权重
    if (originalSentences.length === improvedSentences.length) {
      const indexProximity = 1 - Math.abs(i - bestOriginalIndex) / Math.max(originalSentences.length, 1);
      const adjustedScore = score * 0.7 + indexProximity * 0.3;
      if (adjustedScore > bestImprovedScore && adjustedScore > 0.3) {
        bestImprovedScore = adjustedScore;
        bestImprovedIndex = i;
      }
    } else {
      // 如果句子数量不同，只使用相似度
      if (score > bestImprovedScore && score > 0.4) {
        bestImprovedScore = score;
        bestImprovedIndex = i;
      }
    }
  }

  // 如果找到匹配的改进句子，返回它
  if (bestImprovedIndex >= 0 && bestImprovedIndex < improvedSentences.length) {
    return improvedSentences[bestImprovedIndex] || null;
  }

  return null;
};

const mapFragmentsToFullSentences = (
  feedbackItems: any[], 
  sentenceReferences: SentenceReference[],
  improvedText?: string,
  transcription?: string
) => {
  if (!sentenceReferences?.length) return feedbackItems;

  const resolvedItems = feedbackItems.map(item => {
    if (!item) return item;
    const fragmentOriginal = item.original || '';
    const fragmentImproved = item.improved || '';
    const fragmentNormalized = normalizeSentence(fragmentOriginal);

    const match = findBestSentenceMatch(fragmentNormalized, sentenceReferences);
    if (!match) {
      const improvedSentence = buildImprovedSentence(fragmentOriginal, fragmentOriginal, fragmentImproved);
      return {
        ...item,
        original: fragmentOriginal.trim(),
        improved: improvedSentence
      };
    }

    // 优先从 improvedText 中提取对应句子，确保一致性
    let improvedSentence: string;
    if (improvedText && transcription) {
      const extractedImproved = extractImprovedSentenceFromFullText(
        match.original,
        improvedText,
        transcription
      );
      if (extractedImproved) {
        improvedSentence = extractedImproved;
      } else {
        // 如果无法从 improvedText 中提取，使用原来的逻辑
        improvedSentence = buildImprovedSentence(
          match.original,
          fragmentOriginal,
          fragmentImproved
        );
      }
    } else {
      // 如果没有 improvedText，使用原来的逻辑
      improvedSentence = buildImprovedSentence(
        match.original,
        fragmentOriginal,
        fragmentImproved
      );
    }

    // 确保使用完整句子的时间轴，而不是fragment的时间轴
    // 如果match有完整的时间轴，优先使用；否则清除fragment的时间轴，让后续流程从sentenceTimings中查找
    const resolved = {
      ...item,
      original: match.original,
      improved: improvedSentence,
      // 只有当match有完整的时间轴时才使用，否则设为undefined，让后续流程从sentenceTimings中查找
      audioStart: typeof match.start === 'number' && typeof match.end === 'number' ? match.start : undefined,
      audioEnd: typeof match.start === 'number' && typeof match.end === 'number' ? match.end : undefined
    };

    return resolved;
  }).filter(item => item?.original?.trim());

  // 传递 improvedText 和 transcription 给 consolidateFeedbackBySentence，
  // 确保合并时也能从完整的improvedText中提取对应句子的完整版本
  return consolidateFeedbackBySentence(resolvedItems, improvedText, transcription);
};

// Helper to get Gemini Client dynamically
const getGeminiClient = (apiKey: string) => {
  return new GoogleGenAI({ apiKey: apiKey || process.env.API_KEY });
};

// Helper to check if Ollama is running
const checkOllamaConnection = async (baseUrl: string): Promise<boolean> => {
  try {
    // Remove /v1 if present for health check
    const healthUrl = baseUrl.replace('/v1', '').replace(/\/$/, '');
    const response = await fetch(`${healthUrl}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000) // 3 second timeout
    });
    return response.ok;
  } catch (error) {
    console.warn('Ollama health check failed:', error);
    return false;
  }
};

// Helper for OpenAI-compatible APIs (Ollama, OpenAI, DeepSeek, SiliconFlow)
const getOpenAICompatibleResponse = async (
  config: LLMConfig,
  messages: any[],
  jsonMode: boolean = false
) => {
  let baseUrl = config.baseUrl;
  
  // Set default Base URLs if missing
  if (!baseUrl || baseUrl.trim() === '') {
    switch (config.provider) {
      case 'openai': baseUrl = 'https://api.openai.com/v1'; break;
      case 'deepseek': baseUrl = 'https://api.deepseek.com'; break;
      case 'siliconflow': baseUrl = 'https://api.siliconflow.cn/v1'; break;
      case 'ollama': baseUrl = 'http://localhost:11434/v1'; break;
    }
  }

  // For Ollama, check if service is running
  if (config.provider === 'ollama') {
    console.log('[Ollama] Checking connection to:', baseUrl);
    const isRunning = await checkOllamaConnection(baseUrl);
    if (!isRunning) {
      throw new Error(
        'Ollama service is not running. Please make sure Ollama is installed and running.\n' +
        'Start Ollama with: ollama serve\n' +
        'Or check if Ollama is running on: http://localhost:11434'
      );
    }
    console.log('[Ollama] Connection successful');
  }

  // Normalize URL: ensure it ends with /chat/completions
  let url = baseUrl || '';
  if (url.endsWith('/')) url = url.slice(0, -1);
  
  if (!url.endsWith('/chat/completions')) {
     if (url.endsWith('/v1')) {
        url += '/chat/completions';
     } else if (config.provider === 'ollama' && !url.includes('/v1')) {
        // Ollama raw base url often provided without /v1
        url += '/v1/chat/completions';
     } else {
        // Generic append
        url += '/chat/completions';
     }
  }

  console.log(`[${config.provider}] Calling API:`, url);
  console.log(`[${config.provider}] Model:`, config.model);
  console.log(`[${config.provider}] Messages:`, messages.length, 'messages');

  const headers: any = {
    'Content-Type': 'application/json',
  };
  // Ollama doesn't need API key, but some providers do
  if (config.apiKey && config.provider !== 'ollama') {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  const body: any = {
    model: config.model,
    messages: messages,
    stream: false
  };

  // 为 Ollama 设置一个较大的默认 max_tokens（例如 10000），避免长文本被过早截断
  if (config.provider === 'ollama') {
    // 如果未来在其他地方已经显式传入 max_tokens，这里会尊重已有配置
    if (typeof body.max_tokens !== 'number') {
      body.max_tokens = 10000;
    }
  }

  // Only use response_format for providers that support it (not Ollama)
  if (jsonMode && config.provider !== 'ollama') {
    body.response_format = { type: "json_object" };
  }

  // Set longer timeout for local models like Ollama
  const timeout = config.provider === 'ollama' ? 300000 : 120000; // 5 min for Ollama, 2 min for others

  try {
    const startTime = Date.now();
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout)
    });

    const duration = Date.now() - startTime;
    console.log(`[${config.provider}] Response received in ${duration}ms, status:`, response.status);

    if (!response.ok) {
        const errText = await response.text();
        console.error(`[${config.provider}] API Error:`, response.status, errText);
        throw new Error(`${config.provider} API Error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    console.log(`[${config.provider}] Response length:`, content.length, 'characters');
    
    if (!content) {
      console.warn(`[${config.provider}] Empty response from API:`, data);
    }
    
    return content;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError' || error.message.includes('timeout')) {
        console.error(`[${config.provider}] Request timeout`);
        throw new Error(`${config.provider} request timed out. The model might be too slow or the service is not responding.`);
      }
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        console.error(`[${config.provider}] Network error:`, error.message);
        if (config.provider === 'ollama') {
          throw new Error(
            'Cannot connect to Ollama. Please check:\n' +
            '1. Ollama is installed and running (ollama serve)\n' +
            '2. Ollama is accessible at: ' + baseUrl + '\n' +
            '3. No firewall is blocking the connection'
          );
        }
      }
    }
    console.error(`[${config.provider}] Error:`, error);
    throw error;
  }
};

export const generateScaffold = async (
  topic: string, 
  expressionCount: number, 
  targetLang: string, 
  nativeLang: string,
  expressionLang: string,
  config: LLMConfig = DEFAULT_CONFIG,
  difficulty: Difficulty = 'intermediate'
): Promise<{ structure: GraphicData, expressions: Expression[] }> => {
  // Optimized prompt for local models (Ollama)
  const isLocalModel = config.provider === 'ollama';
  
  // Difficulty-specific instructions
  const difficultyInstructions = {
    beginner: `DIFFICULTY: BEGINNER
- Use HIGH-FREQUENCY WORDS only
- Keep phrases SHORT and SIMPLE
- Use EXPLICIT transitions (e.g., "first", "then", "finally")
- Keep examples SHORT (5-10 words)
- Use simple sentence structures`,
    'pre-intermediate': `DIFFICULTY: PRE-INTERMEDIATE
- Use MOSTLY high-frequency words with a few new terms
- Provide CLEAR context or definitions for any new phrases
- Keep sentences between 8-12 words with limited subordinate clauses
- Encourage connectors such as "because", "so", "while"
- Examples should model everyday conversations`,
    intermediate: `DIFFICULTY: INTERMEDIATE
- Use MOSTLY high-frequency words with some variety
- Include MORE DETAILS in phrases and examples
- Mix EXPLICIT and IMPLICIT transitions
- Use VARIED CONNECTORS (e.g., "however", "moreover", "consequently")
- Examples can be longer (10-15 words)
- Use varied sentence structures`,
    'upper-intermediate': `DIFFICULTY: UPPER-INTERMEDIATE
- Blend conversational and academic vocabulary with occasional idioms
- Use COMPLEX sentences with subordinate clauses and contrast markers
- Encourage nuanced transitions ("nevertheless", "in contrast", "on the flip side")
- Examples can be 15-18 words and include descriptive detail
- Highlight subtle tone shifts or pragmatic cues`,
    advanced: `DIFFICULTY: ADVANCED
- Use SOPHISTICATED VOCABULARY and expressions
- Include complex sentence structures
- Use ADVANCED TRANSITIONS and connectors
- Examples can be longer and more complex (15-20 words)
- Use idiomatic expressions and nuanced language`
  };
  
  const systemPrompt = isLocalModel ? `
You are an expert language tutor. Create a speaking lesson plan in JSON format.

Topic: "${topic}"
Target language: ${targetLang}
Native language: ${nativeLang}
Expression explanation language: ${expressionLang}
Difficulty level: ${difficulty}

${difficultyInstructions[difficulty]}

TASK 1: Choose ONE graphic organizer type:
- "venn" for comparing two things
- "linear" for steps/process/chronology  
- "circle" for brainstorming/central idea
- "fishbone" for cause and effect

TASK 2: Generate exactly ${expressionCount} expressions. Each expression needs:
- phrase: in ${targetLang} (follow difficulty guidelines above)
- type: "idiom", "slang", or "common"
- explanation: in ${expressionLang}
- example: sentence in ${targetLang} (follow difficulty guidelines above)

OUTPUT FORMAT - Return ONLY valid JSON, no markdown, no explanation:

For "venn" type:
{
  "structure": {
    "type": "venn",
    "title": "Title in ${targetLang}",
    "content": {
      "labelA": "First topic",
      "labelB": "Second topic",
      "setA": [
        {"text": "item1", "details": ["detail1", "detail2", "detail3"]},
        {"text": "item2", "details": ["detail1", "detail2", "detail3"]}
      ],
      "setB": [
        {"text": "item4", "details": ["detail1", "detail2", "detail3"]},
        {"text": "item5", "details": ["detail1", "detail2", "detail3"]}
      ],
      "intersection": [
        {"text": "common item1", "details": ["detail1", "detail2", "detail3"]}
      ]
    }
  }
}

For "linear" type:
{
  "structure": {
    "type": "linear",
    "title": "Title in ${targetLang}",
    "content": {
      "steps": [
        {"text": "Step 1", "details": ["detail1", "detail2", "detail3"]},
        {"text": "Step 2", "details": ["detail1", "detail2", "detail3"]}
      ]
    }
  }
}

For "circle" type:
{
  "structure": {
    "type": "circle",
    "title": "Title in ${targetLang}",
    "content": {
      "center": "Main topic in ${targetLang}",
      "nodes": [
        {"text": "Node 1", "details": ["detail1", "detail2", "detail3"]},
        {"text": "Node 2", "details": ["detail1", "detail2", "detail3"]}
      ]
    }
  }
}

For "fishbone" type:
{
  "structure": {
    "type": "fishbone",
    "title": "Title in ${targetLang}",
    "content": {
      "head": "Main problem in ${targetLang}",
      "ribs": [
        {
          "category": "Category 1",
          "items": [
            {"text": "item1", "details": ["detail1", "detail2", "detail3"]},
            {"text": "item2", "details": ["detail1", "detail2", "detail3"]}
          ]
        }
      ]
    }
  }
}

Expressions array (same for all types):
"expressions": [
  {
    "phrase": "phrase in ${targetLang}",
    "type": "idiom",
    "explanation": "explanation in ${expressionLang}",
    "example": "example sentence in ${targetLang}"
  }
]

IMPORTANT: 
- Fill ALL required fields for your chosen organizer type
- For "circle": provide "center" (string) and "nodes" (array of 4-8 objects with "text" and "details")
- For "fishbone": provide "head" (string) and "ribs" (array with 3-6 categories, each with items as objects)
- For "venn": provide all 5 fields (labelA, labelB, setA, setB, intersection), where setA, setB, and intersection are arrays of objects
- For "linear": provide "steps" array with 4-8 objects, each with "text" and "details"
- Each subpoint MUST be an object with "text" (the main point) and "details" (array of 2-4 specific expressions in ${targetLang})
- Details should be SPECIFIC EXPRESSIONS (2-6 words each) that are directly related to the subpoint's content. These should be concrete phrases, vocabulary, or expressions the learner can use when discussing THIS SPECIFIC point, NOT generic connectors. Examples: if subpoint is "Visit museums", details could be "art exhibitions", "cultural heritage", "historical artifacts"; if subpoint is "Try local food", details could be "traditional dishes", "street vendors", "regional specialties"
  ` : `
    You are an expert language tutor. Create a speaking lesson plan for the topic: "${topic}".
    The student's target language is "${targetLang}" and their native language is "${nativeLang}".
    Provide expression explanations in "${expressionLang}".
    Difficulty level: ${difficulty}
    
    ${difficultyInstructions[difficulty]}
    
    1. Select the most appropriate graphic organizer to help structure a speech on this topic.
       Options: "venn" (for comparison), "linear" (for process/chronology), "circle" (for brainstorming/central idea), "fishbone" (for cause/effect).
       Provide content for this organizer in the target language (${targetLang}).
       
    2. Generate ${expressionCount} useful expressions (mix of common phrases, idioms, and slang) relevant to this topic.
       - The phrase and example sentence must be in the target language (${targetLang}).
       - The explanation must be in ${expressionLang} to ensure understanding.
       - Follow the difficulty guidelines above for vocabulary and sentence complexity.
    
    3. For each subpoint in the structure, provide 2-4 specific expressions (2-6 words each) in ${targetLang} that are directly related to the subpoint's content.
       Each subpoint must be an object with "text" (the main point) and "details" (array of specific expressions related to that point). These should be concrete vocabulary, phrases, or expressions the learner can use when discussing THIS SPECIFIC subpoint, NOT generic connectors. For example, if the subpoint is "Visit museums", details could be "art exhibitions", "cultural heritage", "historical artifacts"; if the subpoint is "Try local food", details could be "traditional dishes", "street vendors", "regional specialties".
    
    Return valid JSON only. Do not wrap in markdown code blocks.
    
    Structure format examples:
    - For arrays like "steps", "nodes", "setA", etc., use: [{"text": "point", "details": ["detail1", "detail2", "detail3"]}, ...]
    - For "ribs" items: [{"category": "Category", "items": [{"text": "item", "details": ["detail1", "detail2", "detail3"]}, ...]}, ...]
  `;

  // Define subpoint schema (object with text and details)
  const subpointSchema = {
    type: Type.OBJECT,
    properties: {
      text: { type: Type.STRING },
      details: { type: Type.ARRAY, items: { type: Type.STRING } }
    },
    required: ["text", "details"]
  };

  // Schema for Gemini
  const schema = {
    type: Type.OBJECT,
    properties: {
      structure: {
        type: Type.OBJECT,
        properties: {
          type: { type: Type.STRING, enum: ["venn", "linear", "circle", "fishbone"] },
          title: { type: Type.STRING },
          content: { 
            type: Type.OBJECT,
            properties: {
              labelA: { type: Type.STRING },
              labelB: { type: Type.STRING },
              setA: { type: Type.ARRAY, items: subpointSchema },
              setB: { type: Type.ARRAY, items: subpointSchema },
              intersection: { type: Type.ARRAY, items: subpointSchema },
              steps: { type: Type.ARRAY, items: subpointSchema },
              center: { type: Type.STRING },
              nodes: { type: Type.ARRAY, items: subpointSchema },
              head: { type: Type.STRING },
              ribs: { 
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    category: { type: Type.STRING },
                    items: { type: Type.ARRAY, items: subpointSchema }
                  }
                }
              }
            }
          } 
        },
        required: ["type", "title", "content"]
      },
      expressions: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            phrase: { type: Type.STRING },
            type: { type: Type.STRING, enum: ["idiom", "slang", "common"] },
            explanation: { type: Type.STRING },
            example: { type: Type.STRING }
          },
          required: ["phrase", "type", "explanation", "example"]
        }
      }
    },
    required: ["structure", "expressions"]
  };

  try {
    let jsonText = "";

    if (config.provider === 'gemini') {
      // Default Gemini SDK
      const ai = getGeminiClient(config.apiKey);
      const result = await ai.models.generateContent({
        model: config.model || "gemini-2.5-flash",
        contents: systemPrompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: schema
        }
      });
      jsonText = result.text || "{}";
    } else {
      // OpenAI Compatible Providers (including Ollama)
      const systemMessage = isLocalModel 
        ? "You are a helpful assistant that outputs ONLY valid JSON. No markdown, no explanations, just JSON."
        : "You are a JSON-speaking API. You only output valid JSON matching the requested structure. Do not include markdown fencing.";
      
      const messages = [
        { role: "system", content: systemMessage },
        { role: "user", content: systemPrompt }
      ];
      
      // For Ollama, don't use jsonMode (it doesn't support response_format)
      jsonText = await getOpenAICompatibleResponse(config, messages, !isLocalModel);
    }

    // Clean JSON if needed (remove markdown fences if provider added them)
    jsonText = jsonText.trim()
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .replace(/^[^{[]*/, '') // Remove any text before first { or [
      .replace(/[^}\]]*$/, '') // Remove any text after last } or ]
      .trim();
    
    // For Ollama, try to extract JSON from response if it's wrapped
    if (config.provider === 'ollama') {
      // Try to find JSON object in the response
      const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonText = jsonMatch[0];
      }
    }
    
    let data: any;
    try {
      data = JSON.parse(jsonText);
    } catch (parseError) {
      console.error("Failed to parse JSON response. Raw text:", jsonText.substring(0, 500));
      console.error("Parse error:", parseError);
      throw new Error(
        `Invalid JSON response from ${config.provider}.\n` +
        `The model may have returned invalid JSON. Please try again with a simpler topic or check the browser console for details.`
      );
    }
    
    // Validate data structure
    if (!data || typeof data !== 'object') {
      throw new Error(`Invalid response structure from ${config.provider}`);
    }
    
    if (!data.structure || typeof data.structure !== 'object') {
      console.error("Missing or invalid structure in response:", data);
      throw new Error(`Missing structure in response from ${config.provider}. Please try again.`);
    }
    
    if (!data.expressions || !Array.isArray(data.expressions)) {
      console.error("Missing or invalid expressions in response:", data);
      throw new Error(`Missing expressions in response from ${config.provider}. Please try again.`);
    }
    
    // Helper function to convert old format (string array) to new format (object array with details)
    const normalizeSubpoints = (items: any[]): any[] => {
      if (!Array.isArray(items)) return [];
      return items.map((item: any) => {
        // If it's already in the new format (object with text and details)
        if (typeof item === 'object' && item !== null && 'text' in item && 'details' in item) {
          return item;
        }
        // If it's a string (old format), convert to new format
        if (typeof item === 'string') {
          return {
            text: item,
            details: [] // Empty details for backward compatibility
          };
        }
        return null;
      }).filter(Boolean);
    };

    // Normalize structure content to ensure all subpoints have the new format
    if (data.structure && data.structure.content) {
      const content = data.structure.content;
      
      // Normalize arrays that contain subpoints
      if (Array.isArray(content.steps)) {
        content.steps = normalizeSubpoints(content.steps);
      }
      if (Array.isArray(content.nodes)) {
        content.nodes = normalizeSubpoints(content.nodes);
      }
      if (Array.isArray(content.setA)) {
        content.setA = normalizeSubpoints(content.setA);
      }
      if (Array.isArray(content.setB)) {
        content.setB = normalizeSubpoints(content.setB);
      }
      if (Array.isArray(content.intersection)) {
        content.intersection = normalizeSubpoints(content.intersection);
      }
      if (Array.isArray(content.ribs)) {
        content.ribs = content.ribs.map((rib: any) => {
          if (rib && typeof rib === 'object' && Array.isArray(rib.items)) {
            return {
              ...rib,
              items: normalizeSubpoints(rib.items)
            };
          }
          return rib;
        });
      }
    }
    
    // Add IDs to expressions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const expressions = data.expressions.map((ex: any) => ({ ...ex, id: crypto.randomUUID() }));
    
    return { structure: data.structure, expressions };

  } catch (error) {
    console.error("Error generating scaffold:", error);
    if (error instanceof Error && error.message.includes('Invalid') || error.message.includes('Missing')) {
      throw error;
    }
    throw new Error(`Failed to generate scaffold: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

export const analyzeAudio = async (
  audioBase64: string,
  targetLang: string, 
  nativeLang: string,
  config: LLMConfig = DEFAULT_CONFIG,
  whisperConfig: WhisperConfig,
  promptTemplate: string = DEFAULT_PROMPT_TEMPLATES.feedback
): Promise<AnalysisResult> => {
  // Step 1: Transcribe audio using Whisper
  let transcriptionResult: { text: string; segments: WhisperSegment[] } = { text: '', segments: [] };
  let transcription = '';
  try {
    if (!whisperConfig.enabled) {
      throw new Error('Whisper is not enabled. Please enable Whisper in settings.');
    }
    transcriptionResult = await transcribeAudio(audioBase64, whisperConfig);
    transcription = transcriptionResult.text || '';
    console.log('Whisper transcription:', transcription);
  } catch (error) {
    console.error('Whisper transcription error:', error);
    throw new Error(`Failed to transcribe audio: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  // Step 2: Analyze transcription using LLM
  const isLocalModel = config.provider === 'ollama';
  const promptText = applyPromptTemplate(promptTemplate, {
    targetLang,
    nativeLang,
    transcription
  });

  try {
    let jsonText = "";

    if (config.provider === 'gemini') {
      // Use Gemini SDK
      const ai = getGeminiClient(config.apiKey);
      const schema = {
        type: Type.OBJECT,
        properties: {
          transcription: { type: Type.STRING },
          improvedText: { type: Type.STRING },
          feedback: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                original: { type: Type.STRING },
                improved: { type: Type.STRING },
                explanation: { type: Type.STRING }
              },
              required: ["original", "improved", "explanation"]
            }
          },
          overallFeedback: {
            type: Type.OBJECT,
            properties: {
              taskResponse: { type: Type.STRING },
              coherence: { type: Type.STRING },
              cohesion: { type: Type.STRING },
              vocabulary: { type: Type.STRING },
              grammar: { type: Type.STRING }
            },
            required: ["taskResponse", "coherence", "cohesion", "vocabulary", "grammar"]
          }
        },
        required: ["transcription", "improvedText", "feedback", "overallFeedback"]
      };

      const result = await ai.models.generateContent({
        model: config.model || "gemini-2.5-flash",
        contents: promptText,
        config: {
          responseMimeType: "application/json",
          responseSchema: schema
        }
      });
      jsonText = result.text || "{}";
    } else {
      // Use OpenAI-compatible API
      const messages = [
        { role: "system", content: "You are a JSON-speaking API. You only output valid JSON matching the requested structure. Do not include markdown fencing." },
        { role: "user", content: promptText }
      ];
      jsonText = await getOpenAICompatibleResponse(config, messages, true);
    }

    // Clean JSON if needed
    jsonText = jsonText.trim()
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .replace(/^[^{[]*/, '')
      .replace(/[^}\]]*$/, '')
      .trim();
    
    // For Ollama, try to extract JSON from response if it's wrapped
    if (config.provider === 'ollama') {
      const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonText = jsonMatch[0];
      }
    }
    
    let data: any;
    try {
      data = JSON.parse(jsonText);
    } catch (parseError) {
      console.error("Failed to parse JSON response:", jsonText.substring(0, 500));
      throw new Error(`Invalid JSON response from ${config.provider}. Please try again.`);
    }
    
    // Ensure transcription matches Whisper output
    if (data.transcription !== transcription) {
      data.transcription = transcription;
    }
    
    // Build sentence references with timing info（仅用于整体转录的时间轴展示，不再驱动逐句反馈）
    const sentenceReferences = buildSentenceReferences(transcription, transcriptionResult.segments);

    // 基于完整的 transcription 和 improvedText 构造逐句反馈
    // 不再依赖 fragment 或音频时间轴，避免句子错配
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawFeedbackItems: any[] = Array.isArray(data.feedback) ? data.feedback : [];
    // 逐句反馈直接基于完整文本构造，保证 original / better 一一对应
    const feedback = buildSentenceFeedbackFromFullTexts(
      data.transcription || transcription,
      data.improvedText || transcription,
      rawFeedbackItems
    );
    
    // Validate and extract overallFeedback
    const overallFeedback = data.overallFeedback ? {
      taskResponse: data.overallFeedback.taskResponse || '',
      coherence: data.overallFeedback.coherence || '',
      cohesion: data.overallFeedback.cohesion || '',
      vocabulary: data.overallFeedback.vocabulary || '',
      grammar: data.overallFeedback.grammar || ''
    } : undefined;
    
    return { 
      transcription: data.transcription || transcription,
      improvedText: data.improvedText || transcription,
      feedback,
      overallFeedback,
      sentenceTimings: sentenceReferences.map(ref => ({
        text: ref.original,
        start: ref.start,
        end: ref.end
      })),
      transcriptionSegments: transcriptionResult.segments
    };

  } catch (error) {
    console.error("Error analyzing transcription:", error);
    throw new Error(`Failed to analyze transcription: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

export const generateStory = async (
  phrases: string[], 
  targetLang: string,
  config: LLMConfig = DEFAULT_CONFIG,
  promptTemplate: string = DEFAULT_PROMPT_TEMPLATES.story
): Promise<string> => {
  const prompt = applyPromptTemplate(promptTemplate, {
    targetLang,
    phrases: JSON.stringify(phrases)
  });

  try {
    if (config.provider === 'gemini') {
      const ai = getGeminiClient(config.apiKey);
      const result = await ai.models.generateContent({
        model: config.model || "gemini-2.5-flash",
        contents: prompt,
      });
      return result.text || "Could not generate story.";
    } else {
      // OpenAI Compatible
      const messages = [{ role: "user", content: prompt }];
      return await getOpenAICompatibleResponse(config, messages);
    }
  } catch (error) {
    console.error("Error generating story", error);
    return "Error generating story.";
  }
};

export const generateSampleSpeech = async (
  topic: string,
  phrases: string[],
  targetLang: string,
  config: LLMConfig = DEFAULT_CONFIG,
  promptTemplate: string = DEFAULT_PROMPT_TEMPLATES.sample
): Promise<string> => {
  const prompt = applyPromptTemplate(promptTemplate, {
    topic,
    targetLang,
    phrases: JSON.stringify(phrases),
    minCount: Math.min(phrases.length, 5).toString()
  });

  try {
    if (config.provider === 'gemini') {
      const ai = getGeminiClient(config.apiKey);
      const result = await ai.models.generateContent({
        model: config.model || "gemini-2.5-flash",
        contents: prompt,
      });
      return result.text || "Could not generate sample.";
    } else {
      // OpenAI Compatible
      const messages = [{ role: "user", content: prompt }];
      return await getOpenAICompatibleResponse(config, messages);
    }
  } catch (error) {
    console.error("Error generating sample speech", error);
    return "Error generating sample speech.";
  }
};

// Helper function to detect prompt type from text
const detectPromptType = (prompt: string): 'Descriptive' | 'Narrative' | 'Argumentative' | 'Creative' | null => {
  const lower = prompt.toLowerCase();
  
  // Descriptive indicators
  if (lower.includes('describe') || lower.match(/\b(what|how|where)\s+(does|is|are|look|feel|sound|smell|taste)/)) {
    return 'Descriptive';
  }
  
  // Narrative indicators
  if (lower.includes('tell') || lower.includes('story') || lower.includes('experience') || 
      lower.includes('happened') || lower.includes('when you') || lower.match(/\b(tell|recount|share)\s+(me|us|about)/)) {
    return 'Narrative';
  }
  
  // Argumentative indicators
  if (lower.includes('discuss') || lower.includes('opinion') || lower.includes('agree') || 
      lower.includes('disagree') || lower.includes('think') || lower.includes('believe') ||
      lower.includes('should') || lower.includes('why') || lower.match(/\b(do you think|what is your opinion|do you agree)/)) {
    return 'Argumentative';
  }
  
  // Creative indicators
  if (lower.includes('imagine') || lower.includes('if you') || lower.includes('would you') ||
      lower.includes('suppose') || lower.includes('pretend') || lower.match(/\b(what if|imagine if|suppose you)/)) {
    return 'Creative';
  }
  
  return null;
};

// Helper function to determine which type to use next
const determineNextType = (previousPrompts: string[]): {
  requiredType: string;
  avoidTypes: string;
} => {
  const promptTypes = ['Descriptive', 'Narrative', 'Argumentative', 'Creative'];
  
  // If no history, start with Descriptive
  if (previousPrompts.length === 0) {
    return {
      requiredType: 'Descriptive',
      avoidTypes: 'Narrative, Argumentative, or Creative'
    };
  }
  
  // Analyze last few prompts to determine types used
  const recentPrompts = previousPrompts.slice(0, 4); // Check last 4 prompts
  const usedTypes: string[] = [];
  
  for (const prompt of recentPrompts) {
    const detectedType = detectPromptType(prompt);
    if (detectedType) {
      usedTypes.push(detectedType);
    }
  }
  
  // Count occurrences of each type
  const typeCounts: Record<string, number> = {
    Descriptive: 0,
    Narrative: 0,
    Argumentative: 0,
    Creative: 0
  };
  
  usedTypes.forEach(type => {
    if (typeCounts.hasOwnProperty(type)) {
      typeCounts[type]++;
    }
  });
  
  // Find the least recently used type
  let leastUsedType = promptTypes[0];
  let leastUsedCount = typeCounts[leastUsedType];
  
  for (const type of promptTypes) {
    if (typeCounts[type] < leastUsedCount) {
      leastUsedType = type;
      leastUsedCount = typeCounts[type];
    }
  }
  
  // If all types have been used equally, rotate based on last used type
  if (usedTypes.length > 0 && leastUsedCount === typeCounts[usedTypes[0]]) {
    const lastUsedType = usedTypes[0];
    const lastIndex = promptTypes.indexOf(lastUsedType);
    const nextIndex = (lastIndex + 1) % promptTypes.length;
    leastUsedType = promptTypes[nextIndex];
  }
  
  // Build avoid types list (exclude the required type)
  const avoidTypes = promptTypes.filter(t => t !== leastUsedType).join(', ');
  
  return {
    requiredType: leastUsedType,
    avoidTypes: avoidTypes || 'other types'
  };
};

export const generateInspirePrompt = async (
  difficulty: Difficulty,
  previousPrompts: string[],
  config: LLMConfig = DEFAULT_CONFIG,
  promptTemplate: string = DEFAULT_PROMPT_TEMPLATES.inspire
): Promise<string> => {
  const levelMap: Record<Difficulty, string> = {
    beginner: 'Beginner (A1-A2)',
    'pre-intermediate': 'Pre-intermediate (A2-B1)',
    intermediate: 'Intermediate (B1-B2)',
    'upper-intermediate': 'Upper-intermediate (B2-C1)',
    advanced: 'Advanced (C1-C2)'
  };

  const promptTypes = ['Descriptive', 'Narrative', 'Argumentative', 'Creative'];
  
  // Determine which type to use next
  const { requiredType, avoidTypes } = determineNextType(previousPrompts);
  
  console.log('[generateInspirePrompt] Required type:', requiredType);
  console.log('[generateInspirePrompt] Avoid types:', avoidTypes);
  
  const trimmedHistory = previousPrompts.filter(p => typeof p === 'string' && p.trim().length > 0);
  const historyText = trimmedHistory.length
    ? `Previously generated prompts:\n${trimmedHistory.slice(0, 12).map((p, idx) => `${idx + 1}. ${p}`).join('\n')}\n\nIMPORTANT: Avoid repeating or closely paraphrasing these topics. Also avoid using the same prompt type as the most recent prompts.`
    : 'No previous prompts to avoid for this learner.';

  const request = applyPromptTemplate(promptTemplate, {
    level: levelMap[difficulty],
    promptTypes: promptTypes.join(', '),
    requiredType: requiredType,
    avoidTypes: avoidTypes,
    history: historyText
  });

  try {
    let rawResponse = '';

    if (config.provider === 'gemini') {
      const ai = getGeminiClient(config.apiKey);
      const result = await ai.models.generateContent({
        model: config.model || "gemini-2.5-flash",
        contents: request,
      });
      rawResponse = result.text || '';
    } else {
      const messages = [
        { role: "system", content: "You create concise speaking prompts. Output exactly one sentence starting with Describe, Discuss, or Talk about." },
        { role: "user", content: request }
      ];
      rawResponse = await getOpenAICompatibleResponse(config, messages);
    }

    const cleaned = rawResponse
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)[0] || '';

    const promptText = cleaned
      .replace(/^["'`]+/, '')
      .replace(/["'`]+$/, '')
      .replace(/^[*-]\s*/, '')
      .trim();

    if (!promptText) {
      throw new Error('Empty prompt returned from model.');
    }

    const stemMatch = /^(Describe|Discuss|Talk about)\b/.test(promptText);
    if (!stemMatch) {
      throw new Error(`Invalid prompt format: "${promptText}".`);
    }

    return promptText.endsWith('.') ? promptText : `${promptText}.`;
  } catch (error) {
    console.error('Error generating inspire prompt:', error);
    throw new Error(`Failed to generate speaking prompt: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

// Helper function to clean transcription and extract meaningful words
const extractMeaningfulContent = (text: string): string => {
  if (!text) return '';
  
  // Remove common filler words (but keep some that might be part of meaningful phrases)
  const fillerWords = ['um', 'uh', 'er', 'ah', 'eh', 'oh'];
  const words = text.toLowerCase()
    .replace(/[.,!?;:]/g, ' ')
    .split(/\s+/)
    .filter(word => {
      const cleanWord = word.trim();
      // Keep words longer than 2 characters, but filter out pure filler words
      return cleanWord.length > 2 && !fillerWords.includes(cleanWord);
    });
  
  // Return meaningful words (at least 3 words, max 15 to preserve more context)
  return words.slice(0, 15).join(' ');
};

// Enhanced function to analyze transcription and extract key information
interface TranscriptionAnalysis {
  entities: string[];      // People, places, objects mentioned
  actions: string[];       // Actions/verbs mentioned
  topics: string[];        // Main topics/subjects
  opinions: string[];      // Opinion indicators
  lastSentence: string;    // Last complete sentence
  lastWords: string;       // Last few words (to identify where they stopped)
  isIncomplete: boolean;   // Whether the last sentence seems incomplete
  needsExample: boolean;   // Whether they might need an example
  needsDetail: boolean;     // Whether they might need more detail
  needsTransition: boolean; // Whether they might need a transition to next point
  keyPhrases: string[];    // Important phrases extracted from speech
}

const analyzeTranscription = (text: string): TranscriptionAnalysis => {
  if (!text || !text.trim()) {
    return { 
      entities: [], actions: [], topics: [], opinions: [], 
      lastSentence: '', lastWords: '', isIncomplete: false,
      needsExample: false, needsDetail: false, needsTransition: false,
      keyPhrases: []
    };
  }

  const cleanText = text.trim();
  const sentences = cleanText.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const lastSentence = sentences.length > 0 ? sentences[sentences.length - 1].trim() : cleanText;
  const isIncomplete = !/[.!?]$/.test(cleanText.trim());
  
  // Extract last few words to understand where they stopped
  const words = cleanText.split(/\s+/);
  const lastWords = words.slice(Math.max(0, words.length - 5)).join(' ').toLowerCase();

  // Extract entities (capitalized words, likely proper nouns)
  const entityPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;
  const entities: string[] = [];
  let match;
  while ((match = entityPattern.exec(cleanText)) !== null) {
    const entity = match[1].toLowerCase();
    if (entity.length > 2 && !entities.includes(entity)) {
      entities.push(entity);
    }
  }

  // Extract actions (common verbs) - more comprehensive list
  const actionVerbs = ['went', 'visited', 'saw', 'did', 'made', 'took', 'got', 'met', 'learned', 'read', 'watched', 'played', 'cooked', 'traveled', 'enjoyed', 'liked', 'loved', 'hated', 'thought', 'believed', 'felt', 'experienced', 'tried', 'started', 'finished', 'decided', 'wanted', 'needed', 'helped', 'taught', 'studied', 'worked', 'lived', 'stayed', 'bought', 'sold', 'gave', 'received'];
  const wordsLower = cleanText.toLowerCase().split(/\s+/);
  const actions: string[] = [];
  actionVerbs.forEach(verb => {
    if (wordsLower.includes(verb) && !actions.includes(verb)) {
      actions.push(verb);
    }
  });

  // Extract topics (nouns that appear frequently) - expanded list
  const commonNouns = ['book', 'movie', 'place', 'person', 'food', 'hobby', 'sport', 'music', 'travel', 'trip', 'experience', 'job', 'work', 'school', 'home', 'family', 'friend', 'city', 'country', 'restaurant', 'museum', 'park', 'beach', 'mountain', 'dish', 'cuisine', 'language', 'culture', 'festival', 'event', 'activity', 'skill', 'subject', 'course', 'class', 'teacher', 'student', 'colleague', 'neighbor', 'pet', 'animal', 'plant', 'garden', 'kitchen', 'room', 'building', 'street', 'neighborhood'];
  const topics: string[] = [];
  commonNouns.forEach(noun => {
    const regex = new RegExp(`\\b${noun}\\w*\\b`, 'i');
    if (regex.test(cleanText) && !topics.includes(noun)) {
      topics.push(noun);
    }
  });

  // Extract opinion indicators
  const opinionWords = ['think', 'believe', 'feel', 'opinion', 'like', 'dislike', 'love', 'hate', 'prefer', 'enjoy', 'favorite', 'best', 'worst', 'interesting', 'boring', 'amazing', 'terrible', 'wonderful', 'awful', 'great', 'good', 'bad', 'nice', 'beautiful', 'ugly'];
  const opinions: string[] = [];
  opinionWords.forEach(word => {
    if (wordsLower.includes(word) && !opinions.includes(word)) {
      opinions.push(word);
    }
  });

  // Extract key phrases (important noun phrases, verb phrases)
  const keyPhrases: string[] = [];
  // Look for patterns like "I [verb] [noun]" or "[adjective] [noun]"
  const phrasePatterns = [
    /\bI\s+(went|visited|saw|did|made|took|got|met|learned|read|watched|played|cooked|traveled|enjoyed|liked|loved|hated|thought|believed|felt|experienced|tried|started|finished|decided|wanted|needed|helped|taught|studied|worked|lived|stayed|bought|sold|gave|received)\s+([a-z]+(?:\s+[a-z]+){0,3})/gi,
    /\b(my|the|a|an)\s+([a-z]+(?:\s+[a-z]+){0,2})\s+(is|was|are|were|has|have|had)/gi,
    /\b([a-z]+(?:\s+[a-z]+){0,2})\s+(in|at|on|from|to|with|for)\s+([A-Z][a-z]+)/gi
  ];
  
  phrasePatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(cleanText)) !== null) {
      const phrase = match[0].toLowerCase().trim();
      if (phrase.length > 5 && phrase.length < 50 && !keyPhrases.includes(phrase)) {
        keyPhrases.push(phrase);
      }
    }
  });

  // Determine what kind of help they might need
  const needsExample = lastWords.includes('like') || lastWords.includes('such as') || 
                       lastWords.includes('for example') || lastWords.includes('example') ||
                       lastSentence.toLowerCase().includes('like') && !lastSentence.toLowerCase().includes('i like');
  
  const needsDetail = lastWords.includes('because') || lastWords.includes('why') ||
                      lastWords.includes('how') || lastWords.includes('what') ||
                      isIncomplete && lastWords.length < 10;
  
  const needsTransition = sentences.length > 1 && !isIncomplete &&
                          (lastSentence.toLowerCase().includes('and') || 
                           lastSentence.toLowerCase().includes('also') ||
                           lastSentence.toLowerCase().includes('then'));

  return {
    entities: entities.slice(0, 5),
    actions: actions.slice(0, 5),
    topics: topics.slice(0, 5),
    opinions: opinions.slice(0, 5),
    lastSentence,
    lastWords,
    isIncomplete,
    needsExample,
    needsDetail,
    needsTransition,
    keyPhrases: keyPhrases.slice(0, 5)
  };
};

export const generateLiveHint = async (
  topic: string,
  difficulty: Difficulty,
  config: LLMConfig = DEFAULT_CONFIG,
  promptTemplate: string = DEFAULT_PROMPT_TEMPLATES.liveHint,
  transcription?: string
): Promise<{ type: 'question' | 'hint'; message: string }> => {
  const hasTranscription = transcription && transcription.trim();
  // 只使用最后的部分，确保是最新的内容
  // 提取最后2-3句话，避免使用太旧的内容
  let cleanTranscription = '';
  if (hasTranscription) {
    const sentences = transcription.trim().split(/[.!?]+/).filter(s => s.trim().length > 0);
    // 只取最后2-3句话（最新的内容）
    const recentSentences = sentences.slice(Math.max(0, sentences.length - 3));
    cleanTranscription = recentSentences.join('. ').trim();
    
    // 如果提取的内容太短，使用原始内容
    if (cleanTranscription.length < 20) {
      cleanTranscription = transcription.trim();
    }
    
    console.log('[generateLiveHint] Full transcription length:', transcription.length);
    console.log('[generateLiveHint] Recent transcription (last 2-3 sentences):', cleanTranscription);
  }

  const transcriptAnalysis = hasTranscription ? analyzeTranscription(cleanTranscription) : undefined;
  const meaningfulSnippet = hasTranscription ? extractMeaningfulContent(cleanTranscription) : '';

  const insightBullets: string[] = [];
  if (transcriptAnalysis?.entities?.length) {
    insightBullets.push(`People/places mentioned: ${transcriptAnalysis.entities.join(', ')}`);
  }
  if (transcriptAnalysis?.keyPhrases?.length) {
    insightBullets.push(`Key phrases: ${transcriptAnalysis.keyPhrases.join('; ')}`);
  }
  if (transcriptAnalysis?.actions?.length) {
    insightBullets.push(`Actions taken: ${transcriptAnalysis.actions.join(', ')}`);
  }
  if (transcriptAnalysis?.opinions?.length) {
    insightBullets.push(`Opinion words: ${transcriptAnalysis.opinions.join(', ')}`);
  }
  if (!insightBullets.length && transcriptAnalysis?.lastSentence) {
    insightBullets.push(`Latest line: ${transcriptAnalysis.lastSentence}`);
  }

  const recentInsightsSection = insightBullets.length
    ? `Key details to reference:\n- ${insightBullets.join('\n- ')}`
    : hasTranscription
      ? 'Key details to reference:\n- Use the exact nouns, places, or experiences from their latest sentence.'
      : '';

  const strategyParts: string[] = [];
  if (transcriptAnalysis?.needsExample) {
    strategyParts.push('They seem to search for examples. Offer a prompt that asks for one concrete story or example.');
  }
  if (transcriptAnalysis?.needsDetail) {
    strategyParts.push('Encourage them to explain a reason, feeling, or consequence connected to the last thing they said.');
  }
  if (transcriptAnalysis?.needsTransition) {
    strategyParts.push('Suggest a connector ("Another reason...", "After that...") so they can move to the next idea.');
  }
  if (transcriptAnalysis?.isIncomplete) {
    strategyParts.push('Help them finish the incomplete sentence by asking what happened next or how they felt.');
  }

  const hintStrategy = strategyParts.length
    ? `Hint strategy:\n${strategyParts.join(' ')}`
    : hasTranscription
      ? 'Hint strategy:\nReference their latest detail directly and invite them to add a feeling, reason, or next step.'
      : 'Hint strategy:\nOffer a concrete opening angle (time, place, feeling, or reason) to help them begin.';
  
  // 构建转录上下文
  const transcriptionContext = hasTranscription
    ? `The learner has JUST spoken (most recent words): "${cleanTranscription}"

They paused and need a quick nudge. Your question or hint MUST reference what they JUST said - focus on the most recent things they mentioned (places, people, activities, or experiences).`
    : `The learner just started discussing "${topic}" and paused. They need a quick nudge to begin speaking.`;
  
  // 构建转录指导
  const transcriptionGuidance = hasTranscription
    ? `CRITICAL: The learner JUST said: "${cleanTranscription}"

Focus on the MOST RECENT things they mentioned. Extract specific details from their latest words (places, people, activities, experiences). Your question/hint MUST reference these RECENT elements. Use proper grammar - convert verbs to noun phrases (e.g., "went to Paris" → "the trip" or "your visit to Paris").`
    : `Generate a SPECIFIC opening question about "${topic}" that focuses on one concrete aspect. Make it inviting and easy to answer.`;

  // 构建完整提示
  const request = applyPromptTemplate(promptTemplate, {
    topic,
    difficulty,
    transcriptionContext,
    transcriptionGuidance,
    recentInsightsSection,
    hintStrategy,
    meaningfulSnippet
  });
  
  console.log('[generateLiveHint] Topic:', topic);
  console.log('[generateLiveHint] Transcription:', transcription || '(none)');

  try {
    let responseText = '';

    if (config.provider === 'gemini') {
      const ai = getGeminiClient(config.apiKey);
      const result = await ai.models.generateContent({
        model: config.model || "gemini-2.5-flash",
        contents: request,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              type: { type: Type.STRING, enum: ["question", "hint"] },
              message: { type: Type.STRING }
            },
            required: ["type", "message"]
          }
        }
      });
      responseText = result.text || '';
    } else {
      const systemMessage = hasTranscription
        ? `You are a speaking coach. The learner is discussing "${topic}" and has already said: "${transcription?.trim()}"

Provide either a follow-up question that references what they said, or a hint to help them continue. Return JSON with 'type' ('question' or 'hint') and 'message' fields.`
        : `You are a speaking coach. The learner is about to discuss "${topic}"

Provide either a specific opening question or a hint to help them start. Return JSON with 'type' ('question' or 'hint') and 'message' fields.`;
      
      const messages = [
        { role: "system", content: systemMessage },
        { role: "user", content: request }
      ];
      responseText = await getOpenAICompatibleResponse(config, messages, true);
    }

    // Clean JSON if needed
    responseText = responseText.trim()
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .replace(/^[^{[]*/, '')
      .replace(/[^}\]]*$/, '')
      .trim();

    const parsed = JSON.parse(responseText);
    if (!parsed || typeof parsed.message !== 'string' || (parsed.type !== 'question' && parsed.type !== 'hint')) {
      console.error('[generateLiveHint] Invalid hint payload:', parsed);
      throw new Error('Invalid hint payload');
    }
    
    console.log('[generateLiveHint] Generated hint:', parsed);
    return parsed;
  } catch (error) {
    console.error("Error generating live hint:", error);
    
    // Fallback: 根据是否有转录生成不同的提示
    if (hasTranscription && cleanTranscription.length > 10) {
      // 尝试提取关键词
      const words = cleanTranscription.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const meaningfulWords = words.slice(0, 3);
      
      if (meaningfulWords.length > 0) {
        return {
          type: 'question',
          message: `Can you tell me more about ${meaningfulWords.join(' ')}?`
        };
      }
    }
    
    // 默认fallback
    return {
      type: 'hint',
      message: 'Try describing how the situation made you feel or what you learned from it.'
    };
  }
};