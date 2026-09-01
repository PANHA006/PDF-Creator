const axios = require('axios');
const sharp = require('sharp');

const MODELS_TO_TRY = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash-8b'
];

/**
 * Call Gemini REST API with fallback models
 */
async function callGeminiApi(apiKey, payload) {
  let lastError = '';

  for (const model of MODELS_TO_TRY) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    try {
      const resp = await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 60000
      });

      if (resp.status === 200 && resp.data) {
        return resp.data;
      }
    } catch (err) {
      const errMsg = err.response?.data?.error?.message || err.response?.data || err.message;
      lastError = `Model ${model} failed (${err.response?.status || 'Network'}): ${errMsg}`;
      console.warn(`[GeminiService] ${lastError}. Trying next model...`);
    }
  }

  throw new Error(`Gemini API Error: ${lastError}`);
}

/**
 * Clean Markdown backticks from JSON string
 */
function cleanJsonMarkdown(text) {
  let clean = text.trim();
  if (clean.startsWith('```')) {
    const lines = clean.split('\n');
    if (lines[0].startsWith('```')) lines.shift();
    if (lines.length && lines[lines.length - 1].startsWith('```')) lines.pop();
    clean = lines.join('\n').trim();
  }
  return clean;
}

/**
 * Scan OCR and translate manga/comic dialogues from page image buffer
 */
async function scanOcrImage(apiKey, imageBuffer, pageNum, langOption = 'auto', isMangaDirect = false) {
  let processedBuffer = imageBuffer;
  let mimeType = 'image/png';

  try {
    processedBuffer = await sharp(imageBuffer)
      .resize({ width: 1400, withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    mimeType = 'image/jpeg';
  } catch (err) {
    console.warn(`[GeminiService] Page ${pageNum} sharp optimization warning:`, err.message);
  }

  const base64Image = processedBuffer.toString('base64');

  let langRule = '6. LANGUAGE FILTERING: Extract meaningful dialogue and text. Filter out raw untranslated CJK sound effect noise.';
  if (langOption === 'eng') {
    langRule = `6. STRICT LANGUAGE FILTERING (USER SELECTED ENGLISH MODE):
   - Extract ONLY English text and dialogue.
   - STRICTLY IGNORE AND OMIT all raw untranslated Chinese, Japanese, Korean, or CJK sound effects (such as 啪, 轰, 唰, 裂, 呼, 空, 得下, 融入).
   - Do NOT include any non-English or CJK-only noise rows.`;
  } else if (langOption === 'khm') {
    langRule = `6. LANGUAGE FILTERING (USER SELECTED KHMER MODE):
   - Ensure all khmer_translation fields contain natural, fluent Khmer.
   - Ignore raw untranslated CJK sound effect noise.`;
  }

  let prompt = '';
  if (isMangaDirect) {
    prompt = `You are an expert manga OCR transcription and translation engine specializing in extracting character dialogues from manga and comics.

Your task is to scan the attached page image and extract ALL character speech bubbles and thought bubbles.

Follow these strict rules:
1. FOCUS ONLY ON CHARACTER DIALOGUE & THOUGHT BUBBLES.
2. IGNORE sound effects (SFX), page numbers, publisher logos, scan watermarks, or background text.
3. CONSOLIDATE MULTILINE BUBBLE DIALOGUES into single complete, coherent sentences. Do NOT split text inside the same speech bubble into separate rows.
4. ORDER THE DIALOGUES in standard Manga reading order (Top-to-Bottom, Right-to-Left or Left-to-Right based on layout).
5. TRANSLATE EACH DIALOGUE into natural, context-appropriate Khmer (ភាសាខ្មែរ).

Please respond ONLY with a JSON array matching this exact schema:
[
  {
    "bubble_id": "B1",
    "position": "Top-Right",
    "original_text": "Original speech bubble text in English/Japanese",
    "khmer_translation": "អត្ថបទបកប្រែជាភាសាខ្មែរយ៉ាងរលូន"
  }
]`;
  } else {
    prompt = `You are an expert OCR transcription and translation engine for Manga/Comic dialogues.

Your task is to scan the attached page image and extract ALL text, speech bubbles, and dialogue blocks.

Follow these strict rules:
1. EXTRACT ALL TEXT & DIALOGUE BLOCKS clearly.
2. IGNORE page numbers, publisher logos, scan watermarks, or background garbage noise.
3. CONSOLIDATE MULTILINE SENTENCES inside the same block/speech bubble into single complete, coherent sentences.
4. ORDER THE TEXT BLOCKS in standard reading order (Top-to-Bottom, Left-to-Right or Right-to-Left based on layout).
5. TRANSLATE TARGET: Translate ALL sentence dialogues, vocabulary, and titles (e.g. "Consort" -> "ព្រះស្នំ", "Crown Prince" -> "រជ្ជទាយាទ", "Emperor" -> "អធិរាជ", "Kingdom" -> "នគរ") into 100% fluent, natural KHMER (ភាសាខ្មែរ ONLY). Do NOT leave common English words or titles un-translated inside Khmer sentences!
6. PROPER CHARACTER NAMES: Only keep specific proper character names (e.g. "Wu Yu", "Yuan Xi") in their original Latin/English name form or transliterated cleanly inside the Khmer sentence. All other words and titles in the sentence MUST be fully translated into Khmer!
${langRule}

Please respond ONLY with a JSON array matching this exact schema:
[
  {
    "id": "L1",
    "position": "Top-Left",
    "original_text": "Original text content from document or manga",
    "khmer_translation": "អត្ថបទបកប្រែជាភាសាខ្មែរយ៉ាងរលូន"
  }
]`;
  }

  const payload = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Image
            }
          }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: 'application/json'
    }
  };

  const responseData = await callGeminiApi(apiKey, payload);
  const candidates = responseData.candidates || [];
  if (!candidates.length) {
    return [];
  }

  const rawText = candidates[0].content?.parts?.[0]?.text || '[]';
  const cleanJson = cleanJsonMarkdown(rawText);
  const blocks = JSON.parse(cleanJson);

  const results = [];
  const cjkRegex = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;
  const latinRegex = /[a-zA-Z]/;

  for (let idx = 0; idx < blocks.length; idx++) {
    const b = blocks[idx];
    const origText = (b.original_text || '').trim();
    const khmerText = (b.khmer_translation || '').trim();
    const posHint = b.position || '';

    // Backend CJK noise filter when user selected English
    if (langOption === 'eng' && origText && !latinRegex.test(origText) && cjkRegex.test(origText)) {
      continue;
    }

    if (origText || khmerText) {
      results.push({
        id: isMangaDirect ? `M${pageNum}-${idx + 1}` : `L${pageNum}-${idx + 1}`,
        lineNum: idx + 1,
        pageNum: pageNum,
        lineText: origText || khmerText,
        transText: khmerText,
        position: posHint,
        ...(isMangaDirect ? { isMangaBubble: true } : {})
      });
    }
  }

  return results;
}

/**
 * Proofread and correct OCR / translations
 */
async function aiReview(apiKey, imageBuffer, ocrItems, pageNum) {
  const base64Image = imageBuffer.toString('base64');
  const ocrFormatted = ocrItems
    .map(item => `ID: ${item.id} | Current Text: ${item.lineText || item.text}`)
    .join('\n');

  const prompt = `You are an expert OCR text proofreader and translation corrector for manga, comics, and scanned documents.
Your ONLY task is to review the provided OCR transcript items for the attached page image and suggest "update" corrections for existing rows.

Follow these strict rules:
1. CORRECT TYPOS & GRAMMAR: Fix misread characters, typos, punctuation, and formatting errors in original_text and khmer_translation.
2. PRESERVE PROPER NAMES: Keep proper character names (e.g., "Wu Yu", "Yuan Xi") in their original Latin/English name form while translating all other text and titles (e.g., "Consort" -> "ព្រះស្នំ", "Crown Prince" -> "រជ្ជទាយាទ", "Emperor" -> "អធិរាជ") into 100% fluent Khmer (ភាសាខ្មែរ ONLY).
3. DO NOT MERGE, DELETE, OR ADD ROWS: Do NOT perform any delete, merge, or add operations. You MUST ONLY suggest "update" operations for existing row IDs.

Here is the list of OCR items currently on the page:
${ocrFormatted}

Please respond ONLY with a JSON array matching this exact schema:
[
  {
    "action": "update",
    "id": "item ID",
    "text": "corrected original text content",
    "khmer_translation": "corrected 100% natural Khmer translation"
  }
]`;

  const payload = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: 'image/png',
              data: base64Image
            }
          }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: 'application/json'
    }
  };

  const responseData = await callGeminiApi(apiKey, payload);
  const candidates = responseData.candidates || [];
  if (!candidates.length) {
    throw new Error('No candidates returned by Gemini API');
  }

  const rawText = candidates[0].content?.parts?.[0]?.text || '[]';
  const cleanJson = cleanJsonMarkdown(rawText);
  return JSON.parse(cleanJson);
}

module.exports = {
  scanOcrImage,
  aiReview
};
