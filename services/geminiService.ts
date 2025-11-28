import { GoogleGenAI, Type } from "@google/genai";
import { GraphicData, Expression, AnalysisResult, LLMConfig, WhisperConfig, Difficulty } from "../types";
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

Choose exactly ONE prompt type from this list and reflect it naturally in the topic without naming the type: {{promptTypes}}.

{{history}}

Requirements:
1. Generate ONE prompt only.
2. The sentence MUST start with exactly one of these stems: "Describe", "Discuss", or "Talk about".
3. The topic must be specific, age-appropriate, and achievable for the learner.
4. Encourage variety by using fresh settings, situations, emotions, or perspectives.
5. Keep output to a single sentence ending with a period. No bullet points, numbering, emojis, or explanations.

Return only the prompt text.`,
  liveHint: `You are an encouraging speaking coach helping a learner discuss "{{topic}}" at the {{difficulty}} level.
The learner paused and needs a quick nudge. Provide either:
1. A follow-up question to keep them talking, or
2. A hint that suggests a connector, structure, or expression.

Keep it under 35 words, warm in tone, and output JSON like {"type":"question"|"hint","message":"..."} with double quotes.`,
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

const findBestSentenceMatch = (
  fragmentNormalized: string,
  sentences: Array<{ original: string; normalized: string }>
) => {
  if (!fragmentNormalized) return null;

  const direct = sentences.find(sentence =>
    sentence.normalized.includes(fragmentNormalized)
  );
  if (direct) return direct;

  const reverse = sentences.find(sentence =>
    fragmentNormalized.includes(sentence.normalized)
  );
  if (reverse) return reverse;

  let bestMatch: { original: string; normalized: string } | null = null;
  let bestScore = 0;

  sentences.forEach(sentence => {
    const score = computeTokenOverlap(fragmentNormalized, sentence.normalized);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = sentence;
    }
  });

  return bestScore >= 0.35 ? bestMatch : null;
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

const consolidateFeedbackBySentence = (feedbackItems: any[]) => {
  const grouped = new Map<string, any[]>();

  feedbackItems.forEach(item => {
    if (!item?.original) return;
    const key = item.original.trim();
    if (!key) return;
    grouped.set(key, [...(grouped.get(key) || []), item]);
  });

  const selectBestImproved = (items: any[]) => {
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

  const consolidated: any[] = [];
  grouped.forEach((items, sentence) => {
    const bestImproved = selectBestImproved(items) || sentence;
    consolidated.push({
      ...items[0],
      id: crypto.randomUUID(),
      original: sentence,
      improved: bestImproved,
      explanation: buildExplanation(items)
    });
  });

  return consolidated;
};

const mapFragmentsToFullSentences = (feedbackItems: any[], transcription: string) => {
  if (!transcription) return feedbackItems;
  const sentences = splitTranscriptionIntoSentences(transcription);
  if (!sentences.length) return feedbackItems;

  const normalizedSentences = sentences.map(sentence => ({
    original: sentence,
    normalized: normalizeSentence(sentence)
  }));

  const resolvedItems = feedbackItems.map(item => {
    if (!item) return item;
    const fragmentOriginal = item.original || '';
    const fragmentImproved = item.improved || '';
    const fragmentNormalized = normalizeSentence(fragmentOriginal);

    const match = findBestSentenceMatch(fragmentNormalized, normalizedSentences);
    if (!match) {
      const improvedSentence = buildImprovedSentence(fragmentOriginal, fragmentOriginal, fragmentImproved);
      return {
        ...item,
        original: fragmentOriginal.trim(),
        improved: improvedSentence
      };
    }

    const improvedSentence = buildImprovedSentence(
      match.original,
      fragmentOriginal,
      fragmentImproved
    );

    return {
      ...item,
      original: match.original,
      improved: improvedSentence
    };
  }).filter(item => item?.original?.trim());

  return consolidateFeedbackBySentence(resolvedItems);
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
      "setA": ["item1", "item2", "item3"],
      "setB": ["item4", "item5", "item6"],
      "intersection": ["common item1", "common item2"]
    }
  }
}

For "linear" type:
{
  "structure": {
    "type": "linear",
    "title": "Title in ${targetLang}",
    "content": {
      "steps": ["Step 1", "Step 2", "Step 3", "Step 4"]
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
      "nodes": ["Node 1", "Node 2", "Node 3", "Node 4", "Node 5"]
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
        {"category": "Category 1", "items": ["item1", "item2"]},
        {"category": "Category 2", "items": ["item3", "item4"]}
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
- For "circle": provide "center" (string) and "nodes" (array of 4-8 strings)
- For "fishbone": provide "head" (string) and "ribs" (array with 3-6 categories)
- For "venn": provide all 5 fields (labelA, labelB, setA, setB, intersection)
- For "linear": provide "steps" array with 4-8 steps
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
    
    Return valid JSON only. Do not wrap in markdown code blocks.
  `;

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
              setA: { type: Type.ARRAY, items: { type: Type.STRING } },
              setB: { type: Type.ARRAY, items: { type: Type.STRING } },
              intersection: { type: Type.ARRAY, items: { type: Type.STRING } },
              steps: { type: Type.ARRAY, items: { type: Type.STRING } },
              center: { type: Type.STRING },
              nodes: { type: Type.ARRAY, items: { type: Type.STRING } },
              head: { type: Type.STRING },
              ribs: { 
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    category: { type: Type.STRING },
                    items: { type: Type.ARRAY, items: { type: Type.STRING } }
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
  let transcription: string;
  try {
    if (!whisperConfig.enabled) {
      throw new Error('Whisper is not enabled. Please enable Whisper in settings.');
    }
    transcription = await transcribeAudio(audioBase64, whisperConfig);
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
    
    // Add IDs to feedback items
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let feedback = (data.feedback || []).map((f: any) => ({...f, id: crypto.randomUUID()}));
    feedback = mapFragmentsToFullSentences(feedback, transcription);
    
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
      overallFeedback
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
  const trimmedHistory = previousPrompts.filter(p => typeof p === 'string' && p.trim().length > 0);
  const historyText = trimmedHistory.length
    ? `Previously generated prompts:\n${trimmedHistory.slice(0, 12).map((p, idx) => `${idx + 1}. ${p}`).join('\n')}\nAvoid repeating or closely paraphrasing these topics.`
    : 'No previous prompts to avoid for this learner.';

  const request = applyPromptTemplate(promptTemplate, {
    level: levelMap[difficulty],
    promptTypes: promptTypes.join(', '),
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

export const generateLiveHint = async (
  topic: string,
  difficulty: Difficulty,
  config: LLMConfig = DEFAULT_CONFIG,
  promptTemplate: string = DEFAULT_PROMPT_TEMPLATES.liveHint
): Promise<{ type: 'question' | 'hint'; message: string }> => {
  const request = applyPromptTemplate(promptTemplate, {
    topic,
    difficulty
  });

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
      const messages = [
        { role: "system", content: "You provide brief JSON hints to help language learners continue speaking." },
        { role: "user", content: request }
      ];
      responseText = await getOpenAICompatibleResponse(config, messages, true);
    }

    const parsed = JSON.parse(responseText);
    if (!parsed || typeof parsed.message !== 'string' || (parsed.type !== 'question' && parsed.type !== 'hint')) {
      throw new Error('Invalid hint payload');
    }
    return parsed;
  } catch (error) {
    console.error("Error generating live hint:", error);
    return {
      type: 'hint',
      message: 'Try describing how the situation made you feel or what you learned from it.'
    };
  }
};