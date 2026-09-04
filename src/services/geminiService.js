const axios = require('axios');
const sharp = require('sharp');

const MODELS_TO_TRY = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-3.7-flash',
  'gemini-flash-latest'
];

/**
 * Call Gemini REST API with fallback models
 */
async function callGeminiApi(apiKey, payload) {
  let lastError = '';

  for (const model of MODELS_TO_TRY) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const startReqTime = Date.now();
    try {
      console.log(`   📡 [Gemini AI] Connecting to model: \x1b[36m${model}\x1b[0m ...`);
      const resp = await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 45000
      });

      if (resp.status === 200 && resp.data) {
        const reqDuration = ((Date.now() - startReqTime) / 1000).toFixed(2);
        console.log(`   ✨ [Gemini AI] Model \x1b[32m${model}\x1b[0m responded successfully (\x1b[33m${reqDuration}s\x1b[0m)`);
        return resp.data;
      }
    } catch (err) {
      const errMsg = err.response?.data?.error?.message || err.response?.data || err.message;
      lastError = `Model ${model} failed (${err.response?.status || 'Network'}): ${errMsg}`;
      console.warn(`   ⚠️ [Gemini AI] ${lastError}. Trying next model...`);

      // Fast fail if API key is invalid or quota/permission blocked rather than waiting for all fallback loops
      if (err.response?.status === 400 && typeof errMsg === 'string' && (errMsg.includes('API key not valid') || errMsg.includes('API_KEY_INVALID') || errMsg.includes('API key expired'))) {
        throw new Error(`Gemini API Key មិនត្រឹមត្រូវ (API Key Invalid): សូមពិនិត្យមើល Gemini API Key របស់អ្នកម្តងទៀត។`);
      }
    }
  }

  throw new Error(`Gemini API Error: ${lastError}`);
}

/**
 * Parse and sanitize JSON returned by LLMs with auto-repair for common syntax issues
 */
function parseJsonSafely(text) {
  if (!text || typeof text !== 'string') return [];
  let clean = text.trim();

  // Strip markdown code fences
  clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

  // Extract JSON array or object if surrounded by explanatory text
  const firstArray = clean.indexOf('[');
  const lastArray = clean.lastIndexOf(']');
  if (firstArray !== -1 && lastArray !== -1 && lastArray > firstArray) {
    clean = clean.slice(firstArray, lastArray + 1);
  } else {
    const firstObj = clean.indexOf('{');
    const lastObj = clean.lastIndexOf('}');
    if (firstObj !== -1 && lastObj !== -1 && lastObj > firstObj) {
      clean = clean.slice(firstObj, lastObj + 1);
    }
  }

  // Remove trailing commas before closing braces/brackets
  clean = clean.replace(/,\s*([\]}])/g, '$1');

  try {
    return JSON.parse(clean);
  } catch (err1) {
    try {
      // Auto-repair unquoted property names or single-quoted strings: e.g. { id: "1" } -> { "id": "1" }
      const repaired = clean
        .replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":')
        .replace(/:\s*'([^']*)'/g, ':"$1"')
        .replace(/,\s*([\]}])/g, '$1');
      return JSON.parse(repaired);
    } catch (err2) {
      console.warn('[GeminiService] JSON parse repair failed. Original raw text:', text.slice(0, 300));
      return [];
    }
  }
}

/**
 * Remove trailing Khmer punctuation '។' (U+17D4) and surrounding whitespaces at the end of text or lines
 */
function cleanKhmerPunctuation(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .split(/\r?\n/)
    .map(line => line.replace(/[\s\u17D4]+$/g, '').trim())
    .join('\n')
    .replace(/[\s\u17D4]+$/g, '')
    .trim();
}

/**
 * Scan OCR and translate manga/comic dialogues from page image buffer
 */
async function scanOcrImage(apiKey, imageBuffer, pageNum, langOption = 'auto', isMangaDirect = false) {
  let processedBuffer = imageBuffer;
  let mimeType = 'image/jpeg';

  try {
    processedBuffer = await sharp(imageBuffer)
      .resize({ width: 1100, withoutEnlargement: true })
      .jpeg({ quality: 80, progressive: true })
      .toBuffer();
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

Your task is to scan the attached page image and extract ALL character speech bubbles and thought bubbles with their exact 2D bounding box coordinates on the page.

Follow these strict rules:
1. FOCUS ONLY ON CHARACTER DIALOGUE & THOUGHT BUBBLES.
2. IGNORE sound effects (SFX), page numbers, publisher logos, scan watermarks, scanlation credits, or background text.
3. DETECT EXACT BOUNDING BOX (box_2d) for each speech bubble as [ymin, xmin, ymax, xmax] on a normalized 0-1000 coordinate scale.
4. CONSOLIDATE MULTILINE BUBBLE DIALOGUES into single complete, coherent sentences. Do NOT split text inside the same speech bubble into separate rows.
5. ORDER THE DIALOGUES in standard Manga reading order (Top-to-Bottom, Right-to-Left or Left-to-Right based on layout).
6. TRANSLATE EACH DIALOGUE into natural, context-appropriate Khmer (ភាសាខ្មែរ).
7. PUNCTUATION RULE: Do NOT add the Khmer full-stop mark '។' (Khan/period) at the end of speech bubble dialogue lines.

Please respond ONLY with a JSON array matching this exact schema:
[
  {
    "bubble_id": "B1",
    "box_2d": [ymin, xmin, ymax, xmax],
    "original_text": "Original speech bubble text in English/Japanese",
    "khmer_translation": "អត្ថបទបកប្រែជាភាសាខ្មែរយ៉ាងរលូន"
  }
]`;
  } else {
    prompt = `You are an expert OCR transcription and translation engine for Manga/Comic dialogues.

Your task is to scan the attached page image and extract ALL text, speech bubbles, and dialogue blocks with their exact 2D bounding box coordinates on the page.

Follow these strict rules:
1. EXTRACT ALL SPEECH BUBBLES & DIALOGUE BLOCKS clearly.
2. IGNORE page numbers, publisher credits/banners, scan watermarks, or background garbage noise.
3. DETECT EXACT BOUNDING BOX (box_2d) for each speech bubble as [ymin, xmin, ymax, xmax] on a normalized 0-1000 coordinate scale.
4. CONSOLIDATE MULTILINE SENTENCES inside the same block/speech bubble into single complete, coherent sentences.
5. ORDER THE TEXT BLOCKS in standard reading order (Top-to-Bottom, Left-to-Right or Right-to-Left based on layout).
6. TRANSLATE TARGET: Translate ALL sentence dialogues, vocabulary, and titles (e.g. "Consort" -> "ព្រះស្នំ", "Crown Prince" -> "រជ្ជទាយាទ", "Emperor" -> "អធិរាជ", "Kingdom" -> "នគរ") into 100% fluent, natural KHMER (ភាសាខ្មែរ ONLY). Do NOT leave common English words or titles un-translated inside Khmer sentences!
7. PROPER CHARACTER NAMES: Only keep specific proper character names (e.g. "Wu Yu", "Yuan Xi") in their original Latin/English name form or transliterated cleanly inside the Khmer sentence. All other words and titles in the sentence MUST be fully translated into Khmer!
8. PUNCTUATION RULE: Do NOT add the Khmer full-stop mark '។' (Khan/period) at the end of speech bubbles or dialogue sentences.
${langRule}

Please respond ONLY with a JSON array matching this exact schema:
[
  {
    "id": "L1",
    "box_2d": [ymin, xmin, ymax, xmax],
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
  const blocks = parseJsonSafely(rawText);

  const results = [];
  const cjkRegex = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;
  const latinRegex = /[a-zA-Z]/;

  for (let idx = 0; idx < blocks.length; idx++) {
    const b = blocks[idx];
    const origText = (b.original_text || '').trim();
    const khmerText = cleanKhmerPunctuation(b.khmer_translation || '');
    const posHint = b.position || '';
    const box2d = Array.isArray(b.box_2d) && b.box_2d.length === 4 ? b.box_2d : null;

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
        box_2d: box2d,
        ...(isMangaDirect ? { isMangaBubble: true } : {})
      });
    }
  }

  console.log(`   ✓ [Page ${pageNum}] Extracted \x1b[32m${results.length}\x1b[0m dialogues/text blocks (Khmer translated)`);
  if (results.length > 0) {
    const sample = results[0];
    console.log(`     ↳ Sample: "${sample.lineText.slice(0, 40)}" ➜ \x1b[35m"${sample.transText.slice(0, 40)}"\x1b[0m`);
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
4. PUNCTUATION RULE: Do NOT add the Khmer full-stop mark '។' (Khan/period) at the end of speech bubbles or dialogue sentences.

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
  const parsed = parseJsonSafely(rawText);
  if (Array.isArray(parsed)) {
    parsed.forEach(item => {
      if (item.khmer_translation) {
        item.khmer_translation = cleanKhmerPunctuation(item.khmer_translation);
      }
    });
  }
  return parsed;
}

module.exports = {
  scanOcrImage,
  aiReview,
  cleanKhmerPunctuation
};
