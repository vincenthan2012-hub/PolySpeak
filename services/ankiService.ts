/**
 * Anki Connect Service
 * Handles communication with Anki via AnkiConnect plugin
 */

const ANKI_CONNECT_URL = 'http://127.0.0.1:8765';

export interface AnkiConfig {
  deckName: string;
  modelName: string;
  tags?: string[];
}

export interface AnkiNote {
  deckName: string;
  modelName: string;
  fields: Record<string, string>;
  options?: {
    allowDuplicate: boolean;
    duplicateScope: string;
  };
  tags?: string[];
}

/**
 * Make a request to AnkiConnect
 */
export const ankiConnectRequest = async (action: string, params: any = {}): Promise<any> => {
  try {
    const response = await fetch(ANKI_CONNECT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action,
        version: 6,
        params
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();

    if (result.error) {
      throw new Error(result.error);
    }

    return result.result;
  } catch (error) {
    console.error('AnkiConnect error:', error);
    if (error instanceof Error && error.message.includes('Failed to fetch')) {
      throw new Error('无法连接到 AnkiConnect。请确保 Anki 正在运行且 AnkiConnect 插件已启用。');
    }
    throw error;
  }
};

/**
 * Check if AnkiConnect is available
 */
export const checkAnkiConnect = async (): Promise<{ available: boolean; error?: string }> => {
  try {
    await ankiConnectRequest('version');
    return { available: true };
  } catch (error) {
    let errorMessage = '无法连接到 AnkiConnect';
    
    if (error instanceof Error) {
      if (error.message.includes('Failed to fetch')) {
        errorMessage = '无法连接到 AnkiConnect。请检查：\n1. Anki 是否已启动\n2. AnkiConnect 插件是否已启用\n3. 是否已配置 CORS 设置';
      } else {
        errorMessage = error.message;
      }
    }
    
    return { available: false, error: errorMessage };
  }
};

/**
 * Get available deck names
 */
export const getDeckNames = async (): Promise<string[]> => {
  return await ankiConnectRequest('deckNames');
};

/**
 * Get available model names
 */
export const getModelNames = async (): Promise<string[]> => {
  return await ankiConnectRequest('modelNames');
};

/**
 * Create a deck if it doesn't exist
 */
export const ensureDeck = async (deckName: string): Promise<void> => {
  const decks = await getDeckNames();
  if (!decks.includes(deckName)) {
    await ankiConnectRequest('createDeck', { deck: deckName });
  }
};

/**
 * Create Expression card model (for phrases)
 * Based on flashcard style
 */
export const ensureExpressionModel = async (): Promise<string> => {
  const modelName = 'PolySpeak Expression';
  
  try {
    const modelNames = await getModelNames();
    if (modelNames.includes(modelName)) {
      return modelName;
    }

    await ankiConnectRequest('createModel', {
      modelName: modelName,
      inOrderFields: ['Front', 'Back', 'Example'],
      css: `
        .card {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif;
          font-size: 20px;
          text-align: center;
          color: #1e293b;
          background-color: white;
        }
        .front {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 40px;
          min-height: 300px;
        }
        .back {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 40px;
          min-height: 300px;
          background: #1e293b;
          color: white;
        }
        .phrase {
          font-size: 36px;
          font-weight: bold;
          margin-bottom: 20px;
        }
        .label {
          font-size: 12px;
          font-weight: bold;
          text-transform: uppercase;
          letter-spacing: 2px;
          color: #818cf8;
          margin-bottom: 24px;
        }
        .explanation {
          font-size: 20px;
          margin-bottom: 20px;
          line-height: 1.6;
        }
        .example {
          background: #334155;
          padding: 16px;
          border-radius: 12px;
          font-size: 16px;
          font-style: italic;
          color: #e2e8f0;
          width: 100%;
        }
      `,
      cardTemplates: [{
        Name: 'Card 1',
        Front: `
<div class="front">
  <div class="label">Recall this phrase</div>
  <div class="phrase">{{Front}}</div>
</div>`,
        Back: `
<div class="back">
  <div class="label" style="color: #a5b4fc;">Explanation</div>
  <div class="explanation">{{Back}}</div>
  <div class="example">"{{Example}}"</div>
</div>`
      }],
      // Add TTS configuration (Anki will use this if audio file is not available)
      // Note: This requires Anki 2.1+ with TTS addon or built-in TTS support
      // The audio tag in the Front field will be used if audio file exists
    });

    return modelName;
  } catch (error) {
    console.error('Error creating Expression model:', error);
    throw error;
  }
};

/**
 * Create Feedback card model (for sentence improvements)
 */
export const ensureFeedbackModel = async (): Promise<string> => {
  const modelName = 'PolySpeak Feedback';
  
  try {
    const modelNames = await getModelNames();
    if (modelNames.includes(modelName)) {
      return modelName;
    }

    await ankiConnectRequest('createModel', {
      modelName: modelName,
      inOrderFields: ['Front', 'Improved', 'Back'],
      css: `
        .card {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif;
          font-size: 18px;
          text-align: left;
          color: #1e293b;
          background-color: white;
        }
        .front {
          padding: 20px;
        }
        .back {
          padding: 20px;
        }
        .original {
          background: #fef2f2;
          padding: 15px;
          border-radius: 8px;
          border-left: 4px solid #ef4444;
          margin-bottom: 20px;
        }
        .improved {
          background: #f0fdf4;
          padding: 15px;
          border-radius: 8px;
          border-left: 4px solid #10b981;
          margin-bottom: 20px;
        }
        .explanation {
          background: #eff6ff;
          padding: 15px;
          border-radius: 8px;
          border-left: 4px solid #3b82f6;
          font-style: italic;
          color: #1e40af;
        }
      `,
      cardTemplates: [{
        Name: 'Card 1',
        Front: `
<div class="front">
  <h3 style="color: #6b7280; font-size: 14px; margin-bottom: 10px;">原文</h3>
  <div class="original">{{Front}}</div>
</div>`,
        Back: `
<div class="back">
  <h3 style="color: #059669; font-size: 16px; margin-bottom: 10px;">✨ 改进版本</h3>
  <div class="improved">{{Improved}}</div>
  <h3 style="color: #3b82f6; font-size: 14px; margin-bottom: 10px; margin-top: 20px;">📝 反馈</h3>
  <div class="explanation">{{Back}}</div>
</div>`
      }]
    });

    return modelName;
  } catch (error) {
    console.error('Error creating Feedback model:', error);
    throw error;
  }
};

/**
 * Store media file in Anki
 */
export const storeMediaFile = async (filename: string, data: string): Promise<string> => {
  // data should be base64 encoded
  return await ankiConnectRequest('storeMediaFile', {
    filename,
    data
  });
};

/**
 * Add a note to Anki
 */
export const addNote = async (note: AnkiNote): Promise<number | null> => {
  return await ankiConnectRequest('addNote', { note });
};

/**
 * Format expression card for Anki (based on flashcard style)
 */
export const formatExpressionCard = (
  expression: { phrase: string; explanation: string; example: string }
): { Front: string; Back: string; Example: string } => {
  return {
    Front: expression.phrase,
    Back: expression.explanation,
    Example: expression.example
  };
};

/**
 * Escape HTML characters
 */
const escapeHtml = (text: string): string => {
  if (typeof document === 'undefined') {
    // Fallback for non-browser environments
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
};

/**
 * Format feedback card for Anki
 */
export const formatFeedbackCard = (
  feedback: { original: string; improved: string; explanation: string }
): { Front: string; Improved: string; Back: string } => {
  return {
    Front: escapeHtml(feedback.original),
    Improved: escapeHtml(feedback.improved),
    Back: escapeHtml(feedback.explanation)
  };
};

/**
 * Add expression to Anki
 */
export const addExpressionToAnki = async (
  expression: { phrase: string; explanation: string; example: string },
  config: AnkiConfig
): Promise<number | null> => {
  await ensureDeck(config.deckName);
  const modelName = await ensureExpressionModel();
  
  const fields = formatExpressionCard(expression);
  
  const note: AnkiNote = {
    deckName: config.deckName,
    modelName: modelName,
    fields: {
      Front: fields.Front,
      Back: fields.Back,
      Example: fields.Example
    },
    options: {
      allowDuplicate: false,
      duplicateScope: 'deck'
    },
    tags: config.tags || ['polyspeak', 'expression']
  };

  return await addNote(note);
};

/**
 * Add feedback to Anki
 */
export const addFeedbackToAnki = async (
  feedback: { original: string; improved: string; explanation: string },
  config: AnkiConfig
): Promise<number | null> => {
  await ensureDeck(config.deckName);
  const modelName = await ensureFeedbackModel();
  
  const fields = formatFeedbackCard(feedback);
  
  const note: AnkiNote = {
    deckName: config.deckName,
    modelName: modelName,
    fields: {
      Front: fields.Front,
      Improved: fields.Improved,
      Back: fields.Back
    },
    options: {
      allowDuplicate: false,
      duplicateScope: 'deck'
    },
    tags: config.tags || ['polyspeak', 'feedback']
  };

  return await addNote(note);
};

/**
 * Batch add expressions to Anki
 */
export const batchAddExpressionsToAnki = async (
  expressions: Array<{ phrase: string; explanation: string; example: string }>,
  config: AnkiConfig
): Promise<{ success: number; failed: number; errors: string[] }> => {
  await ensureDeck(config.deckName);
  const modelName = await ensureExpressionModel();
  
  let success = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const expr of expressions) {
    try {
      const fields = formatExpressionCard(expr);
      const note: AnkiNote = {
        deckName: config.deckName,
        modelName: modelName,
        fields: {
          Front: fields.Front,
          Back: fields.Back,
          Example: fields.Example
        },
        options: {
          allowDuplicate: false,
          duplicateScope: 'deck'
        },
        tags: config.tags || ['polyspeak', 'expression']
      };
      
      const result = await addNote(note);
      if (result) {
        success++;
      } else {
        failed++;
        errors.push(`Duplicate: ${expr.phrase}`);
      }
    } catch (error) {
      failed++;
      errors.push(`${expr.phrase}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  return { success, failed, errors };
};

/**
 * Batch add feedback to Anki
 */
export const batchAddFeedbackToAnki = async (
  feedbacks: Array<{ original: string; improved: string; explanation: string }>,
  config: AnkiConfig
): Promise<{ success: number; failed: number; errors: string[] }> => {
  await ensureDeck(config.deckName);
  const modelName = await ensureFeedbackModel();
  
  let success = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const fb of feedbacks) {
    try {
      const fields = formatFeedbackCard(fb);
      const note: AnkiNote = {
        deckName: config.deckName,
        modelName: modelName,
        fields: {
          Front: fields.Front,
          Improved: fields.Improved,
          Back: fields.Back
        },
        options: {
          allowDuplicate: false,
          duplicateScope: 'deck'
        },
        tags: config.tags || ['polyspeak', 'feedback']
      };
      
      const result = await addNote(note);
      if (result) {
        success++;
      } else {
        failed++;
        errors.push(`Duplicate: ${fb.original.substring(0, 30)}...`);
      }
    } catch (error) {
      failed++;
      errors.push(`${fb.original.substring(0, 30)}...: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  return { success, failed, errors };
};

