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
    intermediate: `DIFFICULTY: INTERMEDIATE
- Use MOSTLY high-frequency words with some variety
- Include MORE DETAILS in phrases and examples
- Mix EXPLICIT and IMPLICIT transitions
- Use VARIED CONNECTORS (e.g., "however", "moreover", "consequently")
- Examples can be longer (10-15 words)
- Use varied sentence structures`,
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
- explanation: in ${nativeLang}
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
    "explanation": "explanation in ${nativeLang}",
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
    Difficulty level: ${difficulty}
    
    ${difficultyInstructions[difficulty]}
    
    1. Select the most appropriate graphic organizer to help structure a speech on this topic.
       Options: "venn" (for comparison), "linear" (for process/chronology), "circle" (for brainstorming/central idea), "fishbone" (for cause/effect).
       Provide content for this organizer in the target language (${targetLang}).
       
    2. Generate ${expressionCount} useful expressions (mix of common phrases, idioms, and slang) relevant to this topic.
       - The phrase and example sentence must be in the target language (${targetLang}).
       - The explanation must be in the native language (${nativeLang}) to ensure understanding.
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
  whisperConfig: WhisperConfig
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
  
  const promptText = isLocalModel ? `
Analyze the following speech transcription from a student practicing "${targetLang}".
Transcription: "${transcription}"

Provide comprehensive feedback following IELTS Speaking criteria:

1. EXACT TRANSCRIPTION: Use the provided transcription above.

2. IMPROVED TEXT: A natural, polished version of the entire speech in "${targetLang}".

3. SENTENCE-BY-SENTENCE FEEDBACK: Identify specific sentences with errors. For each:
   - original: the original sentence
   - improved: corrected version (in ${targetLang})
   - explanation: concise explanation focusing on Task Response, Coherence, Cohesion, Vocabulary, or Grammar (in ${nativeLang})

4. OVERALL FEEDBACK (IELTS criteria):
   - taskResponse: Evaluate how well the speech addresses the topic, stays on topic, and develops ideas (in ${nativeLang})
   - cohesion: Evaluate use of connectors, pronouns, and logical flow between sentences (in ${nativeLang})
   - coherence: Evaluate logical consistency, detail development, and how easy it is to follow the argument (in ${nativeLang})
   - vocabulary: Evaluate vocabulary range, accuracy, and appropriateness (in ${nativeLang})
   - grammar: Evaluate grammatical accuracy and range of structures (in ${nativeLang})

OUTPUT FORMAT - Return ONLY valid JSON:
{
  "transcription": "...",
  "improvedText": "...",
  "feedback": [
    {"original": "...", "improved": "...", "explanation": "..."}
  ],
  "overallFeedback": {
    "taskResponse": "...",
    "cohesion": "...",
    "coherence": "...",
    "vocabulary": "...",
    "grammar": "..."
  }
}
  ` : `
    Analyze the following speech transcription from a student practicing "${targetLang}".
    The transcription is: "${transcription}"
    
    Please provide comprehensive feedback following IELTS Speaking criteria:
    
    1. The exact transcription (use the provided transcription above).
    2. An improved, natural version of the entire speech in "${targetLang}".
    3. Identify specific sentences with errors. For each error, provide:
       - original: the original sentence
       - improved: the corrected version (in ${targetLang})
       - explanation: a concise explanation focusing on Task Response, Coherence, Cohesion, Vocabulary, or Grammar (in ${nativeLang})
    4. Overall Feedback (IELTS criteria):
       - taskResponse: Evaluate how well the speech addresses the topic, stays on topic, and develops ideas (in ${nativeLang})
       - cohesion: Evaluate use of connectors, pronouns, and logical flow between sentences (in ${nativeLang})
       - coherence: Evaluate logical consistency, detail development, and how easy it is to follow the argument (in ${nativeLang})
       - vocabulary: Evaluate vocabulary range, accuracy, and appropriateness (in ${nativeLang})
       - grammar: Evaluate grammatical accuracy and range of structures (in ${nativeLang})
    
    Return valid JSON only with keys: transcription, improvedText, feedback (array of {original, improved, explanation}), overallFeedback (object with taskResponse, coherence, cohesion, vocabulary, grammar).
    Do not wrap in markdown code blocks.
  `;

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
    const feedback = (data.feedback || []).map((f: any) => ({...f, id: crypto.randomUUID()}));
    
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
  config: LLMConfig = DEFAULT_CONFIG
): Promise<string> => {
  const prompt = `
    Write a fun, engaging short story (approx 150 words) in ${targetLang} that incorporates the following expressions:
    ${JSON.stringify(phrases)}
    
    Please wrap the specific expressions used in the story with double asterisks, e.g., **piece of cake**.
  `;

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
  config: LLMConfig = DEFAULT_CONFIG
): Promise<string> => {
  const prompt = `
    Write a natural speech or monologue (approx 100-150 words) about "${topic}" in "${targetLang}".
    You MUST use at least ${Math.min(phrases.length, 5)} of the following expressions naturally in the text:
    ${JSON.stringify(phrases)}

    Please wrap the specific expressions used in the text with double asterisks, e.g., **piece of cake**.
  `;

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
  config: LLMConfig = DEFAULT_CONFIG
): Promise<string> => {
  const levelMap: Record<Difficulty, string> = {
    beginner: 'Beginner (A1-A2)',
    intermediate: 'Intermediate (B1-B2)',
    advanced: 'Advanced (C1-C2)'
  };

  const promptTypes = ['Descriptive', 'Narrative', 'Argumentative', 'Creative'];
  const trimmedHistory = previousPrompts.filter(p => typeof p === 'string' && p.trim().length > 0);
  const historyText = trimmedHistory.length
    ? `Previously generated prompts:\n${trimmedHistory.slice(0, 12).map((p, idx) => `${idx + 1}. ${p}`).join('\n')}\nAvoid repeating or closely paraphrasing these topics.`
    : 'No previous prompts to avoid for this learner.';

  const request = `
You are a structural speaking coach.

Learner level: ${levelMap[difficulty]}.

Choose exactly ONE prompt type from this list and reflect it naturally in the topic without naming the type: ${promptTypes.join(', ')}.

${historyText}

Requirements:
1. Generate ONE prompt only.
2. The sentence MUST start with exactly one of these stems: "Describe", "Discuss", or "Talk about".
3. The topic must be specific, age-appropriate, and achievable for ${levelMap[difficulty]} learners.
4. Encourage variety by using fresh settings, situations, emotions, or perspectives.
5. Keep output to a single sentence ending with a period. No bullet points, numbering, emojis, or explanations.

Return only the prompt text.`;

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