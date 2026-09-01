from flask import Flask, render_template, send_from_directory, jsonify, request, send_file
import os
import io
import json
import base64
import fitz
from PIL import Image
import requests
# Load GEMINI_API_KEY from local .env file if it exists
if os.path.exists('.env'):
    with open('.env', 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#'):
                if '=' in line:
                    key, val = line.split('=', 1)
                    if key.strip() == 'GEMINI_API_KEY':
                        os.environ['GEMINI_API_KEY'] = val.strip()

app = Flask(__name__, template_folder='templates', static_folder='static')

# Ensure the upload folder exists
UPLOAD_FOLDER = os.path.join(app.root_path, 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

@app.route('/')
def index():
    """Render the main UI template."""
    return render_template('index.html')

# Endpoint to serve static files (automatic in Flask, but explicitly added if needed)
@app.route('/static/<path:path>')
def send_static(path):
    return send_from_directory('static', path)

# =====================================================================
# MOCK ENDPOINTS (Core backend code will be written here later)
# =====================================================================
# A4 dimensions in PDF points (72 points per inch)
A4_PORTRAIT = (595, 842)
A4_LANDSCAPE = (842, 595)

@app.route('/api/generate-pdf', methods=['POST'])
def generate_pdf():
    try:
        # Get metadata
        metadata_str = request.form.get('metadata')
        if not metadata_str:
            return jsonify({"status": "error", "message": "Missing metadata"}), 400
        
        metadata = json.loads(metadata_str)
        page_size_option = request.form.get('page_size', 'original')
        quality = int(float(request.form.get('quality', '1.0')) * 100)
        
        # Read uploaded files
        uploaded_files = request.files.getlist('images')
        file_map = {f.filename: f for f in uploaded_files}
        
        processed_images = []
        
        for item in metadata:
            filename = item.get('filename')
            rotation = int(item.get('rotation', 0))
            
            file_obj = file_map.get(filename)
            if not file_obj:
                continue
                
             # Open image from stream safely
            img = Image.open(io.BytesIO(file_obj.read()))
            
            # Apply rotation (Pillow rotates counter-clockwise, so clockwise is negative)
            if rotation != 0:
                img = img.rotate(-rotation, expand=True)
            
            # Convert to RGB (to avoid transparency issue in PDF format)
            if img.mode in ('RGBA', 'LA', 'P'):
                rgba_img = img.convert('RGBA')
                bg = Image.new('RGB', rgba_img.size, (255, 255, 255))
                bg.paste(rgba_img, mask=rgba_img.split()[3])
                img = bg
            else:
                img = img.convert('RGB')
                
            # Resize if A4 paper option chosen
            if page_size_option != 'original':
                target_size = A4_PORTRAIT if page_size_option == 'a4-portrait' else A4_LANDSCAPE
                # Thumbnail maintains ratio
                img.thumbnail(target_size, Image.Resampling.LANCZOS)
                
                # Center on white canvas
                a4_canvas = Image.new('RGB', target_size, (255, 255, 255))
                x_offset = (target_size[0] - img.width) // 2
                y_offset = (target_size[1] - img.height) // 2
                a4_canvas.paste(img, (x_offset, y_offset))
                img = a4_canvas
                
            processed_images.append(img)
            
        if not processed_images:
            return jsonify({"status": "error", "message": "No images processed"}), 400
            
        # Compile into single PDF in memory
        pdf_buffer = io.BytesIO()
        first_img = processed_images[0]
        first_img.save(
            pdf_buffer, 
            format='PDF', 
            save_all=True, 
            append_images=processed_images[1:],
            quality=quality
        )
        pdf_buffer.seek(0)
        
        return send_file(
            pdf_buffer,
            mimetype='application/pdf',
            as_attachment=True,
            download_name='generated.pdf'
        )
        
    except Exception as e:
        print(f"Error generating PDF: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/scan-ocr-pdf', methods=['POST'])
@app.route('/api/manga-ocr-direct', methods=['POST'])
def scan_ocr_pdf():
    """
    Direct Gemini Vision OCR engine designed for high-performance text and dialogue extraction.
    Analyzes page images, detects text blocks/speech bubbles, combines multiline sentences,
    filters out SFX/watermarks, and outputs original text along with Khmer translations.
    """
    try:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            return jsonify({
                "status": "error",
                "message": "Missing GEMINI_API_KEY. Please configure it in your .env file."
            }), 400

        lang_option = request.form.get('lang', 'auto')
        pages_option = request.form.get('pages', 'all')
        
        if 'file' not in request.files:
            return jsonify({"status": "error", "message": "Missing PDF file"}), 400
            
        file_obj = request.files['file']
        pdf_data = file_obj.read()
        
        doc = fitz.open(stream=pdf_data, filetype="pdf")
        total_pages = len(doc)
        
        target_pages = []
        if pages_option == 'all':
            target_pages = list(range(total_pages))
        else:
            try:
                for p in pages_option.split(','):
                    p_num = int(p.strip()) - 1
                    if 0 <= p_num < total_pages:
                        target_pages.append(p_num)
            except ValueError:
                target_pages = list(range(total_pages))
                
        ocr_results = []
        models_to_try = ["gemini-flash-lite-latest", "gemini-3.5-flash", "gemini-3-flash-preview", "gemini-3.1-flash-lite", "gemini-3.5-flash-lite"]
        
        lang_rule = ""
        if lang_option == 'eng':
            lang_rule = """
6. STRICT LANGUAGE FILTERING (USER SELECTED ENGLISH MODE):
   - Extract ONLY English text and dialogue.
   - STRICTLY IGNORE AND OMIT all raw untranslated Chinese, Japanese, Korean, or CJK sound effects (such as 啪, 轰, 唰, 裂, 呼, 空, 得下, 融入).
   - Do NOT include any non-English or CJK-only noise rows.
"""
        elif lang_option == 'khm':
            lang_rule = """
6. LANGUAGE FILTERING (USER SELECTED KHMER MODE):
   - Ensure all khmer_translation fields contain natural, fluent Khmer.
   - Ignore raw untranslated CJK sound effect noise.
"""
        else:
            lang_rule = """
6. LANGUAGE FILTERING:
   - Extract meaningful dialogue and text. Filter out raw untranslated CJK sound effect noise.
"""

        for p_idx in target_pages:
            page_num = p_idx + 1
            page = doc.load_page(p_idx)
            
            # Render PDF page to PNG image in memory (dpi=150 is ideal for vision)
            pix = page.get_pixmap(dpi=150)
            img_bytes = pix.tobytes("png")
            base64_image = base64.b64encode(img_bytes).decode("utf-8")
            
            prompt = f"""
You are an expert OCR transcription and translation engine for Manga/Comic dialogues.

Your task is to scan the attached page image and extract ALL text, speech bubbles, and dialogue blocks.

Follow these strict rules:
1. EXTRACT ALL TEXT & DIALOGUE BLOCKS clearly.
2. IGNORE page numbers, publisher logos, scan watermarks, or background garbage noise.
3. CONSOLIDATE MULTILINE SENTENCES inside the same block/speech bubble into single complete, coherent sentences.
4. ORDER THE TEXT BLOCKS in standard reading order (Top-to-Bottom, Left-to-Right or Right-to-Left based on layout).
5. TRANSLATE TARGET: Translate ALL sentence dialogues, vocabulary, and titles (e.g. "Consort" -> "ព្រះស្នំ", "Crown Prince" -> "រជ្ជទាយាទ", "Emperor" -> "អធិរាជ", "Kingdom" -> "នគរ") into 100% fluent, natural KHMER (ភាសាខ្មែរ ONLY). Do NOT leave common English words or titles un-translated inside Khmer sentences!
6. PROPER CHARACTER NAMES: Only keep specific proper character names (e.g. "Wu Yu", "Yuan Xi") in their original Latin/English name form (e.g. "Wu Yu", "Yuan Xi") or transliterated cleanly inside the Khmer sentence. All other words and titles in the sentence MUST be fully translated into Khmer!
{lang_rule}

Please respond ONLY with a JSON array matching this exact schema:
[
  {{
    "id": "L1",
    "position": "Top-Left",
    "original_text": "Original text content from document or manga",
    "khmer_translation": "អត្ថបទបកប្រែជាភាសាខ្មែរយ៉ាងរលូន"
  }}
]
"""
            
            payload = {
                "contents": [
                    {
                        "parts": [
                            {"text": prompt},
                            {
                                "inlineData": {
                                    "mimeType": "image/png",
                                    "data": base64_image
                                }
                            }
                        ]
                    }
                ],
                "generationConfig": {
                    "responseMimeType": "application/json"
                }
            }
            
            response = None
            last_err = ""
            for model in models_to_try:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
                headers = {"Content-Type": "application/json"}
                resp = requests.post(url, headers=headers, json=payload, timeout=60)
                if resp.status_code == 200:
                    response = resp
                    break
                else:
                    err_txt = resp.json().get('error', {}).get('message', resp.text) if resp.headers.get('content-type', '').startswith('application/json') else resp.text
                    last_err = f"Model {model} error ({resp.status_code}): {err_txt}"
                    print(f"INFO: {last_err}. Trying next fallback model...")
            
            if response and response.status_code == 200:
                response_json = response.json()
                try:
                    candidates = response_json.get("candidates", [])
                    if candidates:
                        content_text = candidates[0].get("content", {}).get("parts", [])[0].get("text", "")
                        clean_json_text = content_text.strip()
                        if clean_json_text.startswith("```"):
                            lines = clean_json_text.splitlines()
                            if lines[0].startswith("```"):
                                lines = lines[1:]
                            if lines and lines[-1].startswith("```"):
                                lines = lines[:-1]
                            clean_json_text = "\n".join(lines).strip()
                            
                        blocks = json.loads(clean_json_text)
                        import re
                        
                        for idx, block in enumerate(blocks):
                            orig_text = block.get("original_text", "").strip()
                            khmer_text = block.get("khmer_translation", "").strip()
                            pos_hint = block.get("position", "")
                            
                            # Backend CJK noise filter when user selected English
                            if lang_option == 'eng':
                                # If orig_text contains CJK characters and NO Latin letters, skip it
                                if orig_text and not re.search(r'[a-zA-Z]', orig_text) and re.search(r'[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]', orig_text):
                                    continue
                            
                            if orig_text or khmer_text:
                                ocr_results.append({
                                    "id": f"L{page_num}-{idx + 1}",
                                    "lineNum": idx + 1,
                                    "pageNum": page_num,
                                    "lineText": orig_text if orig_text else khmer_text,
                                    "transText": khmer_text,
                                    "position": pos_hint
                                })
                except Exception as parse_err:
                    print(f"Error parsing Gemini response for page {page_num}: {parse_err}")
            else:
                return jsonify({"status": "error", "message": f"Gemini API Error on page {page_num}: {last_err}"}), 500
                
        return jsonify({
            "status": "success",
            "results": ocr_results
        })
        
    except Exception as e:
        print(f"Error in Direct Vision OCR scan: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/ai-review', methods=['POST'])
def ai_review():
    try:
        # Check API Key
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            return jsonify({"status": "error", "message": "Missing GEMINI_API_KEY environment variable. Please configure it in your environment."}), 400
            
        # Get request parameters
        page_num = int(request.form.get('pageNum', 1))
        ocr_items_str = request.form.get('ocr_items', '[]')
        ocr_items = json.loads(ocr_items_str)
        
        if 'file' not in request.files:
            return jsonify({"status": "error", "message": "Missing PDF file"}), 400
            
        file_obj = request.files['file']
        pdf_data = file_obj.read()
        
        # Open PDF from memory stream
        doc = fitz.open(stream=pdf_data, filetype="pdf")
        
        if page_num < 1 or page_num > len(doc):
            return jsonify({"status": "error", "message": f"Page number {page_num} is out of bounds (1-{len(doc)})"}), 400
            
        # Load PDF page
        page = doc[page_num - 1]
        
        # Render PDF page to image in memory
        pix = page.get_pixmap(dpi=150)
        img_data = pix.tobytes("png")
        
        # Encode image to base64
        base64_image = base64.b64encode(img_data).decode("utf-8")
        
        # Format the OCR lines for the Gemini prompt
        ocr_text_formatted = "\n".join([f"ID: {item.get('id')} | Current Text: {item.get('lineText')}" for item in ocr_items])
        
        prompt = f"""
You are an expert OCR text proofreader and translation corrector for manga, comics, and scanned documents.
Your ONLY task is to review the provided OCR transcript items for the attached page image and suggest "update" corrections for existing rows.

Follow these strict rules:
1. CORRECT TYPOS & GRAMMAR: Fix misread characters, typos, punctuation, and formatting errors in original_text and khmer_translation.
2. PRESERVE PROPER NAMES: Keep proper character names (e.g., "Wu Yu", "Yuan Xi") in their original Latin/English name form while translating all other text and titles (e.g., "Consort" -> "ព្រះស្នំ", "Crown Prince" -> "រជ្ជទាយាទ", "Emperor" -> "អធិរាជ") into 100% fluent Khmer (ភាសាខ្មែរ ONLY).
3. DO NOT MERGE, DELETE, OR ADD ROWS: Do NOT perform any delete, merge, or add operations. You MUST ONLY suggest "update" operations for existing row IDs.

Here is the list of OCR items currently on the page:
{ocr_text_formatted}

Please respond ONLY with a JSON array matching this exact schema:
[
  {{
    "action": "update",
    "id": "item ID",
    "text": "corrected original text content",
    "khmer_translation": "corrected 100% natural Khmer translation"
  }}
]
"""
        
        # Construct raw payload for Gemini REST API
        payload = {
            "contents": [
                {
                    "parts": [
                        {
                            "text": prompt
                        },
                        {
                            "inlineData": {
                                "mimeType": "image/png",
                                "data": base64_image
                            }
                        }
                    ]
                }
            ],
            "generationConfig": {
                "responseMimeType": "application/json"
            }
        }
        
        models_to_try = ["gemini-flash-lite-latest", "gemini-3.5-flash", "gemini-3-flash-preview", "gemini-3.1-flash-lite", "gemini-3.5-flash-lite"]
        response = None
        last_error = ""

        for model in models_to_try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
            headers = {"Content-Type": "application/json"}
            resp = requests.post(url, headers=headers, json=payload, timeout=60)
            if resp.status_code == 200:
                response = resp
                break
            else:
                last_error = f"Model {model} failed ({resp.status_code}): {resp.text}"
                print(f"INFO: {last_error}. Trying next fallback model...")

        if not response or response.status_code != 200:
            return jsonify({
                "status": "error",
                "message": f"Gemini API Error: {last_error}"
            }), 500
            
        response_json = response.json()
        
        # Extract text response from Gemini response payload structure
        try:
            candidates = response_json.get("candidates", [])
            if not candidates:
                return jsonify({"status": "error", "message": "No candidates returned by Gemini API"}), 500
                
            content_text = candidates[0].get("content", {}).get("parts", [])[0].get("text", "")
            clean_json_text = content_text.strip()
            if clean_json_text.startswith("```"):
                lines = clean_json_text.splitlines()
                if lines[0].startswith("```"):
                    lines = lines[1:]
                if lines and lines[-1].startswith("```"):
                    lines = lines[:-1]
                clean_json_text = "\n".join(lines).strip()
                
            # Parse the returned JSON text block
            result_data = json.loads(clean_json_text)
            
            return jsonify({
                "status": "success",
                "results": result_data
            })
        except Exception as parse_err:
            print(f"Error parsing Gemini response: {parse_err}. Raw response: {response.text}")
            return jsonify({
                "status": "error",
                "message": f"Failed to parse Gemini response: {str(parse_err)}"
            }), 500
            
    except Exception as e:
        print(f"Error in AI review: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/manga-ocr-direct', methods=['POST'])
def manga_ocr_direct():
    """
    Direct Gemini Vision OCR designed specifically for Manga Dialogue extraction.
    Detects speech bubbles, combines multiline bubble dialogues, filters out SFX/watermarks,
    and returns both original dialogue and Khmer translation.
    """
    try:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            return jsonify({
                "status": "error",
                "message": "Missing GEMINI_API_KEY. Please configure it in your .env file."
            }), 400

        pages_option = request.form.get('pages', 'all')
        
        if 'file' not in request.files:
            return jsonify({"status": "error", "message": "Missing PDF file"}), 400
            
        file_obj = request.files['file']
        pdf_data = file_obj.read()
        
        doc = fitz.open(stream=pdf_data, filetype="pdf")
        total_pages = len(doc)
        
        target_pages = []
        if pages_option == 'all':
            target_pages = list(range(total_pages))
        else:
            try:
                for p in pages_option.split(','):
                    p_num = int(p.strip()) - 1
                    if 0 <= p_num < total_pages:
                        target_pages.append(p_num)
            except ValueError:
                target_pages = list(range(total_pages))
                
        ocr_results = []
        models_to_try = ["gemini-flash-latest", "gemini-2.0-flash", "gemini-flash-lite-latest"]
        
        for p_idx in target_pages:
            page_num = p_idx + 1
            page = doc.load_page(p_idx)
            
            # Render PDF page to PNG image in memory (dpi=150 is ideal for vision)
            pix = page.get_pixmap(dpi=150)
            img_bytes = pix.tobytes("png")
            base64_image = base64.b64encode(img_bytes).decode("utf-8")
            
            prompt = """
You are an expert manga OCR transcription and translation engine specializing in extracting character dialogues from manga and comics.

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
]
"""
            
            payload = {
                "contents": [
                    {
                        "parts": [
                            {"text": prompt},
                            {
                                "inlineData": {
                                    "mimeType": "image/png",
                                    "data": base64_image
                                }
                            }
                        ]
                    }
                ],
                "generationConfig": {
                    "responseMimeType": "application/json"
                }
            }
            
            response = None
            last_err = ""
            for model in models_to_try:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
                headers = {"Content-Type": "application/json"}
                resp = requests.post(url, headers=headers, json=payload, timeout=60)
                if resp.status_code == 200:
                    response = resp
                    break
                else:
                    err_txt = resp.json().get('error', {}).get('message', resp.text) if resp.headers.get('content-type', '').startswith('application/json') else resp.text
                    last_err = f"Model {model} error ({resp.status_code}): {err_txt}"
                    print(f"INFO: {last_err}. Trying next fallback model...")
            
            if response and response.status_code == 200:
                response_json = response.json()
                try:
                    candidates = response_json.get("candidates", [])
                    if candidates:
                        content_text = candidates[0].get("content", {}).get("parts", [])[0].get("text", "")
                        clean_json_text = content_text.strip()
                        if clean_json_text.startswith("```"):
                            lines = clean_json_text.splitlines()
                            if lines[0].startswith("```"):
                                lines = lines[1:]
                            if lines and lines[-1].startswith("```"):
                                lines = lines[:-1]
                            clean_json_text = "\n".join(lines).strip()
                            
                        bubbles = json.loads(clean_json_text)
                        
                        for idx, bubble in enumerate(bubbles):
                            orig_text = bubble.get("original_text", "").strip()
                            khmer_text = bubble.get("khmer_translation", "").strip()
                            pos_hint = bubble.get("position", "")
                            
                            if orig_text or khmer_text:
                                ocr_results.append({
                                    "id": f"M{page_num}-{idx + 1}",
                                    "lineNum": idx + 1,
                                    "pageNum": page_num,
                                    "lineText": orig_text if orig_text else khmer_text,
                                    "transText": khmer_text,
                                    "position": pos_hint,
                                    "isMangaBubble": True
                                })
                except Exception as parse_err:
                    print(f"Error parsing Gemini response for page {page_num}: {parse_err}")
            else:
                return jsonify({"status": "error", "message": f"Gemini API Error on page {page_num}: {last_err}"}), 500
                
        return jsonify({
            "status": "success",
            "results": ocr_results
        })
        
    except Exception as e:
        print(f"Error in Manga Direct OCR: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/upload-pdf', methods=['POST'])

def upload_pdf():
    try:
        # Check if file exists in request
        if 'file' not in request.files:
            return jsonify({"status": "error", "message": "Missing PDF file"}), 400
            
        file_obj = request.files['file']
        
        # Read file into memory buffer
        pdf_data = file_obj.read()
        
        # Open PDF from memory stream
        doc = fitz.open(stream=pdf_data, filetype="pdf")
        pages_list = []
        
        for page_num in range(len(doc)):
            page = doc.load_page(page_num)
            
            # Render page to image pixel map (dpi=150 is optimal for Tesseract legibility)
            pix = page.get_pixmap(dpi=150)
            img_bytes = pix.tobytes("png")
            
            # Encode image to base64 data URL
            encoded = base64.b64encode(img_bytes).decode('utf-8')
            data_url = f"data:image/png;base64,{encoded}"
            
            pages_list.append({
                "name": f"page_{page_num + 1}.png",
                "dataUrl": data_url
            })
            
        return jsonify({
            "status": "success",
            "pages": pages_list
        })
        
    except Exception as e:
        print(f"Error parsing PDF: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

import re
import urllib.request
import urllib.error
import urllib.parse

def make_mangadex_request(url):
    req = urllib.request.Request(url)
    req.add_header('User-Agent', 'PDF-Creator-Manga-Downloader/1.0')
    with urllib.request.urlopen(req) as response:
        return json.loads(response.read().decode('utf-8'))

def fetch_universal_manga(url):
    try:
        import cloudscraper
        from bs4 import BeautifulSoup
        
        scraper = cloudscraper.create_scraper()
        
        # 1. Special Handling for ComicK
        if 'comick.' in url or 'comick.io' in url or 'comick.app' in url:
            try:
                # Extract comic slug: e.g. https://comick.io/comic/solo-leveling
                comic_slug = url.strip('/').split('/')[-1].split('?')[0]
                api_url = f"https://api.comick.fun/comic/{comic_slug}"
                res = scraper.get(api_url, timeout=12).json()
                comic_data = res.get('comic', {})
                comic_hid = comic_data.get('hid')
                
                title = comic_data.get('title', 'Unknown Title')
                desc = comic_data.get('desc', '')
                status = "Completed" if comic_data.get('status') == 2 else "OnGoing"
                
                cover_url = ""
                if comic_data.get('md_covers'):
                    cover_bkey = comic_data['md_covers'][0].get('bkey')
                    cover_url = f"https://meo.comick.pictures/{cover_bkey}"
                    
                author = "Unknown Author"
                if comic_data.get('authors'):
                    author = ", ".join([a.get('name', '') for a in comic_data['authors'] if a.get('name')])
                    
                # Fetch chapters from ComicK API
                ch_api = f"https://api.comick.fun/comic/{comic_hid}/chapters?lang=en&limit=300"
                ch_res = scraper.get(ch_api, timeout=15).json()
                raw_chapters = ch_res.get('chapters', [])
                
                chapters = []
                for ch in raw_chapters:
                    ch_hid = ch.get('hid')
                    ch_num = ch.get('chap') or ""
                    ch_title = ch.get('title') or f"Chapter {ch_num}"
                    chapters.append({
                        "id": f"https://comick.io/chapter/{ch_hid}",
                        "volume": ch.get('vol') or "",
                        "chapter": str(ch_num),
                        "title": ch_title,
                        "pages": 0
                    })
                    
                def parse_comick_num(c):
                    try:
                        return float(c['chapter'])
                    except:
                        return 0.0
                chapters.sort(key=parse_comick_num)
                
                return jsonify({
                    "status": "success",
                    "manga": {
                        "id": url,
                        "title": title,
                        "author": author,
                        "status": status,
                        "description": desc,
                        "coverUrl": cover_url,
                        "chapters": chapters
                    }
                })
            except Exception as comick_err:
                print(f"Error parsing ComicK API: {comick_err}")

        # 2. General Scraper for WordPress, Madara, MangaStream, Asura, Manganato, Flame Comics, Reaper Scans
        # Detect parent series URL if a chapter URL was pasted
        parent_url = re.sub(r'(?:chapter|ch|episode|ep)[-_/][a-zA-Z0-9\-_.]+(?:/?)$', '', url, flags=re.IGNORECASE)
        if not parent_url.endswith('/') and not parent_url.endswith('.html'):
            parent_url += '/'
            
        is_chapter_url = parent_url != url
        requested_chapter_url = url if is_chapter_url else ""
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': parent_url
        }
        
        res = scraper.get(parent_url, headers=headers, timeout=15)
        html = res.text
        soup = BeautifulSoup(html, 'html.parser')
        
        # 1. Title extraction
        title_el = (soup.select_one('.post-title h1') or 
                    soup.select_one('.story-info-right h1') or 
                    soup.select_one('.manga-info-top h1') or 
                    soup.select_one('h1.entry-title') or 
                    soup.select_one('.series-title') or 
                    soup.select_one('h1'))
        title = title_el.text.strip() if title_el else "Unknown Title"
        
        # 2. Cover image
        cover_el = (soup.select_one('.summary_image img') or 
                    soup.select_one('.story-info-left img') or 
                    soup.select_one('.manga-info-pic img') or 
                    soup.select_one('.post-thumbnail img') or 
                    soup.select_one('.thumb img') or 
                    soup.select_one('.series-thumb img'))
        cover_url = ""
        if cover_el:
            cover_url = (cover_el.get('data-src') or 
                         cover_el.get('data-lazy-src') or 
                         cover_el.get('srcset', '').split(' ')[0] or 
                         cover_el.get('src') or "")
        
        # 3. Description
        desc_el = (soup.select_one('.description-summary') or 
                   soup.select_one('.panel-story-info-description') or 
                   soup.select_one('#noidungm') or 
                   soup.select_one('.manga-excerpt') or 
                   soup.select_one('.entry-content p'))
        description = desc_el.text.strip() if desc_el else ""
        
        # 4. Author & Status
        author = "Unknown Author"
        status = "OnGoing"
        
        full_text = soup.text.lower()
        if 'completed' in full_text and 'ongoing' not in full_text:
            status = "Completed"
            
        for item in soup.select('.post-content_item, .variations-tableInfo tr, .manga-info-top li'):
            text_block = item.text.strip().lower()
            if 'author' in text_block or 'tác giả' in text_block:
                author = item.text.split(':')[-1].strip()
            if 'status' in text_block:
                if 'completed' in text_block:
                    status = "Completed"
                elif 'ongoing' in text_block:
                    status = "OnGoing"
        
        # 5. Chapters list extraction
        chapter_elements = (soup.select('.wp-manga-chapter a') or 
                            soup.select('.row-content-chapter a.chapter-name') or 
                            soup.select('.row-content-chapter a') or 
                            soup.select('.chapter-list .row a') or 
                            soup.select('.eph-num a') or 
                            soup.select('.bxcl ul li a') or 
                            soup.select('.sub-chap-list a') or 
                            soup.select('a[href*="-chapter-"]') or 
                            soup.select('a[href*="/chapter-"]'))
        
        chapters = []
        seen_urls = set()
        
        for idx, el in enumerate(chapter_elements):
            ch_url = el.get('href', '').strip()
            if not ch_url or ch_url in seen_urls or ch_url.startswith('#'):
                continue
            seen_urls.add(ch_url)
            
            ch_title = el.text.strip()
            
            # Extract chapter number
            ch_num = ""
            match = re.search(r'(?:chapter|ch\.?|ep\.?)\s*([0-9\.]+)', ch_title + " " + ch_url, re.IGNORECASE)
            if match:
                ch_num = match.group(1)
            else:
                ch_num = str(idx + 1)
                
            chapters.append({
                "id": ch_url,
                "volume": "",
                "chapter": ch_num,
                "title": ch_title,
                "pages": 0
            })
            
        # Determine sorting: if first chapter is high number (e.g. 100) and last is 1, reverse to ascending
        if len(chapters) > 1:
            try:
                first_num = float(chapters[0]['chapter'])
                last_num = float(chapters[-1]['chapter'])
                if first_num > last_num:
                    chapters.reverse()
            except:
                chapters.reverse()
        
        return jsonify({
            "status": "success",
            "manga": {
                "id": parent_url,
                "title": title,
                "author": author,
                "status": status,
                "description": description,
                "coverUrl": cover_url,
                "chapters": chapters,
                "requestedChapterUrl": requested_chapter_url
            }
        })
    except Exception as e:
        print(f"Error fetching universal manga details: {e}")
        return jsonify({"status": "error", "message": f"Failed to parse website: {str(e)}"}), 500

def download_universal_chapter(chapter_url):
    try:
        import cloudscraper
        from bs4 import BeautifulSoup
        import requests
        
        scraper = cloudscraper.create_scraper()
        
        # 1. Special Handling for ComicK Chapter API
        if 'comick.io/chapter/' in chapter_url:
            ch_hid = chapter_url.strip('/').split('/')[-1]
            api_url = f"https://api.comick.fun/chapter/{ch_hid}"
            res = scraper.get(api_url, timeout=12).json()
            images = res.get('chapter', {}).get('images', [])
            page_urls = [f"https://meo.comick.pictures/{img['bkey']}" for img in images if 'bkey' in img]
        else:
            # 2. General Chapter Scraper
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': chapter_url
            }
            html = scraper.get(chapter_url, headers=headers, timeout=15).text
            soup = BeautifulSoup(html, 'html.parser')
            
            # Cascading selectors for chapter reader image containers
            img_elements = (soup.select('.container-chapter-reader img') or 
                            soup.select('#readerarea img') or 
                            soup.select('.reading-content img') or 
                            soup.select('.page-break img') or 
                            soup.select('.rd-img img') or 
                            soup.select('.entry-content img') or 
                            soup.select('.chapter-image img') or 
                            soup.select('img.wp-manga-chapter-img'))
            
            page_urls = []
            for el in img_elements:
                img_url = (el.get('data-src') or 
                           el.get('data-lazy-src') or 
                           el.get('data-original') or 
                           el.get('src') or "")
                img_url = img_url.strip()
                if img_url and not img_url.startswith('data:') and 'logo' not in img_url.lower() and 'banner' not in img_url.lower():
                    page_urls.append(img_url)
                    
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': chapter_url
        }
        
        from concurrent.futures import ThreadPoolExecutor
        
        def download_single_page(item):
            idx, page_url = item
            if not page_url:
                return idx, None
            if page_url.startswith('//'):
                page_url = 'https:' + page_url
                
            urls_to_try = [page_url]
            if 'files.wordpress.com' in page_url or 'wordpress.com' in page_url:
                clean_url = page_url.replace('https://', '').replace('http://', '')
                urls_to_try.insert(0, f"https://i0.wp.com/{clean_url}")
                urls_to_try.append(f"{page_url}?w=1200")
                
            img_data = None
            detected_mime = 'image/jpeg'
            
            # Special referer for Manganato/Mangakakalot CDN protection
            req_headers = headers.copy()
            if 'mkklcdn' in page_url or 'manganato' in page_url:
                req_headers['Referer'] = 'https://chapmanganato.to/'
            
            for u in urls_to_try:
                try:
                    img_res = scraper.get(u, headers=req_headers, timeout=12)
                    ct = img_res.headers.get('Content-Type', '')
                    if img_res.status_code == 200 and len(img_res.content) > 1000 and not ct.startswith('text/html'):
                        img_data = img_res.content
                        if ct.startswith('image/'):
                            detected_mime = ct.split(';')[0]
                        break
                except Exception:
                    pass
                    
                try:
                    img_res = requests.get(u, headers=req_headers, timeout=12)
                    ct = img_res.headers.get('Content-Type', '')
                    if img_res.status_code == 200 and len(img_res.content) > 1000 and not ct.startswith('text/html'):
                        img_data = img_res.content
                        if ct.startswith('image/'):
                            detected_mime = ct.split(';')[0]
                        break
                except Exception:
                    pass
                    
            if img_data:
                encoded = base64.b64encode(img_data).decode('utf-8')
                ext = 'jpg'
                if 'png' in detected_mime:
                    ext = 'png'
                elif 'webp' in detected_mime:
                    ext = 'webp'
                elif 'gif' in detected_mime:
                    ext = 'gif'
                    
                return idx, {
                    "name": f"page_{idx + 1}.{ext}",
                    "dataUrl": f"data:{detected_mime};base64,{encoded}"
                }
            return idx, None

        with ThreadPoolExecutor(max_workers=8) as executor:
            results = list(executor.map(download_single_page, enumerate(page_urls)))
            
        results.sort(key=lambda x: x[0])
        pages_list = [res[1] for res in results if res[1] is not None]
                
        return jsonify({
            "status": "success",
            "chapter_id": chapter_url,
            "pages": pages_list
        })
    except Exception as e:
        print(f"Error scraping chapter pages: {e}")
        return jsonify({"status": "error", "message": f"Failed to download chapter: {str(e)}"}), 500

@app.route('/api/manga/fetch', methods=['POST'])
def manga_fetch():
    try:
        url_or_id = request.form.get('url', '')
        if not url_or_id:
            return jsonify({"status": "error", "message": "Missing manga link or ID"}), 400
        
        # Check if it is a generic Web URL instead of a MangaDex UUID
        is_web_url = url_or_id.startswith('http://') or url_or_id.startswith('https://')
        is_mangadex = 'mangadex.org' in url_or_id
        
        if is_web_url and not is_mangadex:
            return fetch_universal_manga(url_or_id)
            
        # Extract UUID (MangaDex UUID flow below)
        manga_id = None
        match = re.search(r'title/([a-fA-F0-9\-]{36})', url_or_id)
        if match:
            manga_id = match.group(1)
        else:
            match_uuid = re.match(r'^([a-fA-F0-9\-]{36})$', url_or_id.strip())
            if match_uuid:
                manga_id = match_uuid.group(1)
                
        if not manga_id:
            return jsonify({"status": "error", "message": "Invalid MangaDex URL or ID format"}), 400
            
        # Get Manga Info
        manga_url = f"https://api.mangadex.org/manga/{manga_id}?includes[]=cover_art&includes[]=author"
        manga_data = make_mangadex_request(manga_url)
        
        manga_attr = manga_data['data']['attributes']
        title = manga_attr['title'].get('en') or next(iter(manga_attr['title'].values()), 'Unknown Title')
        description = manga_attr['description'].get('en') or next(iter(manga_attr['description'].values()), '')
        
        # Extract author name and status
        author = "Unknown Author"
        for rel in manga_data['data'].get('relationships', []):
            if rel.get('type') == 'author' and 'attributes' in rel:
                author = rel['attributes'].get('name', 'Unknown Author')
                
        status = manga_attr.get('status', 'ongoing').capitalize()
        
        # Find cover file name
        cover_filename = None
        for rel in manga_data['data'].get('relationships', []):
            if rel.get('type') == 'cover_art' and 'attributes' in rel:
                cover_filename = rel['attributes'].get('fileName')
                
        cover_url = ""
        if cover_filename:
            cover_url = f"https://uploads.mangadex.org/covers/{manga_id}/{cover_filename}.256.jpg"
            
        # Get Chapters Feed (sorted by chapter ascending)
        # Fetching English translation by default.
        feed_url = f"https://api.mangadex.org/manga/{manga_id}/feed?translatedLanguage[]=en&order[chapter]=asc&limit=500"
        feed_data = make_mangadex_request(feed_url)
        
        chapters = []
        for ch in feed_data.get('data', []):
            ch_attr = ch['attributes']
            chapters.append({
                "id": ch['id'],
                "volume": ch_attr.get('volume') or "",
                "chapter": ch_attr.get('chapter') or "",
                "title": ch_attr.get('title') or "",
                "pages": ch_attr.get('pages') or 0
            })
            
        # Sort chapters numerically
        def get_chapter_num(ch_obj):
            val = ch_obj.get('chapter')
            try:
                return float(val) if val else 0.0
            except ValueError:
                return 0.0
                
        chapters.sort(key=get_chapter_num)
        
        return jsonify({
            "status": "success",
            "manga": {
                "id": manga_id,
                "title": title,
                "author": author,
                "status": status,
                "description": description,
                "coverUrl": cover_url,
                "chapters": chapters
            }
        })
        
    except Exception as e:
        print(f"Error fetching manga metadata: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/manga/download-chapter', methods=['POST'])
def manga_download_chapter():
    try:
        chapter_id = request.form.get('chapter_id', '')
        if not chapter_id:
            return jsonify({"status": "error", "message": "Missing chapter ID"}), 400
            
        # Detect if it's a generic web chapter URL
        if chapter_id.startswith('http://') or chapter_id.startswith('https://'):
            return download_universal_chapter(chapter_id)
            
        # Get page list
        at_home_url = f"https://api.mangadex.org/at-home/server/{chapter_id}"
        at_home_data = make_mangadex_request(at_home_url)
        
        base_url = at_home_data['baseUrl']
        ch_hash = at_home_data['chapter']['hash']
        
        # Use dataSaver if available, otherwise fallback to data
        use_saver = 'dataSaver' in at_home_data['chapter']
        pages = at_home_data['chapter']['dataSaver'] if use_saver else at_home_data['chapter']['data']
        mode_path = 'data-saver' if use_saver else 'data'
        
        pages_list = []
        for idx, filename in enumerate(pages):
            page_url = f"{base_url}/{mode_path}/{ch_hash}/{filename}"
            
            # Fetch page image bytes
            img_req = urllib.request.Request(page_url)
            img_req.add_header('User-Agent', 'PDF-Creator-Manga-Downloader/1.0')
            
            try:
                with urllib.request.urlopen(img_req) as img_res:
                    img_data = img_res.read()
                    
                # Base64 encode
                encoded = base64.b64encode(img_data).decode('utf-8')
                
                # Deduce mime type
                ext = filename.split('.')[-1].lower()
                mime = f"image/{ext}"
                if ext == 'jpg':
                    mime = "image/jpeg"
                elif ext == 'webp':
                    mime = "image/webp"
                    
                data_url = f"data:{mime};base64,{encoded}"
                
                pages_list.append({
                    "name": f"page_{idx + 1}.{ext}",
                    "dataUrl": data_url
                })
            except Exception as page_err:
                print(f"Error downloading page {idx+1} from {page_url}: {page_err}")
                # Skip this page or return error. Let's raise to fail fast or just skip.
                continue
                
        return jsonify({
            "status": "success",
            "chapter_id": chapter_id,
            "pages": pages_list
        })
        
    except Exception as e:
        print(f"Error downloading chapter: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

import zipfile

@app.route('/api/manga/generate-zip', methods=['POST'])
def manga_generate_zip():
    try:
        # Get metadata containing file list
        files_json = request.form.get('files')
        if not files_json:
            return jsonify({"status": "error", "message": "Missing file list"}), 400
            
        files_data = json.loads(files_json)
        
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            for idx, item in enumerate(files_data):
                filename = item.get('name', f"page_{idx+1}.png")
                data_url = item.get('dataUrl', '')
                
                if not data_url:
                    continue
                    
                # Decode base64 image
                header, encoded = data_url.split(",", 1)
                img_bytes = base64.b64decode(encoded)
                
                zip_file.writestr(filename, img_bytes)
                
        zip_buffer.seek(0)
        
        manga_name = request.form.get('manga_title', 'manga_download')
        # Clean manga name for safe download filename
        safe_name = "".join([c for c in manga_name if c.isalpha() or c.isdigit() or c==' ']).rstrip()
        safe_name = safe_name.replace(' ', '_')
        if not safe_name:
            safe_name = 'manga_download'
            
        return send_file(
            zip_buffer,
            mimetype='application/zip',
            as_attachment=True,
            download_name=f'{safe_name}.zip'
        )
    except Exception as e:
        print(f"Error generating ZIP: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

from PIL import ImageDraw, ImageFont

def get_khmer_font(font_size=14):
    """Attempt to load system Khmer TTF font, or fallback to default PIL font."""
    font_paths = [
        r"C:\Windows\Fonts\khmerui.ttf",
        r"C:\Windows\Fonts\daunpenh.ttf",
        r"C:\Windows\Fonts\moolboran.ttf",
        r"C:\Windows\Fonts\segoeui.ttf",
        r"C:\Windows\Fonts\arial.ttf"
    ]
    for fp in font_paths:
        if os.path.exists(fp):
            try:
                return ImageFont.truetype(fp, int(font_size))
            except Exception:
                pass
    return ImageFont.load_default()

def render_manga_page_khmer(image_bytes, ocr_items):
    """
    Renders Khmer dialogue text overlays on a page image.
    Erases original speech bubble text with white fill and draws wrapped Khmer text.
    """
    img = Image.open(io.BytesIO(image_bytes)).convert("RGBA")
    draw = ImageDraw.Draw(img)
    w, h = img.size

    for idx, item in enumerate(ocr_items):
        text = (item.get("transText") or item.get("lineText") or "").strip()
        if not text:
            continue

        x_pct = float(item.get("x_pct", -1))
        y_pct = float(item.get("y_pct", -1))
        pos_hint = (item.get("position") or "").lower()

        if x_pct >= 0 and y_pct >= 0:
            cx = int((x_pct / 100.0) * w)
            cy = int((y_pct / 100.0) * h)
            bw = int(w * 0.35)
            bh = int(h * 0.12)
            box = (max(10, cx - bw // 2), max(10, cy - bh // 2), min(w - 10, cx + bw // 2), min(h - 10, cy + bh // 2))
        else:
            row_idx = idx % 8
            cx = int(w * 0.5)
            cy = int(h * (0.10 + row_idx * 0.11))
            bw = int(w * 0.40)
            bh = int(h * 0.09)

            if "top" in pos_hint:
                cy = int(h * (0.08 + (idx % 3) * 0.10))
            elif "bottom" in pos_hint:
                cy = int(h * (0.65 + (idx % 3) * 0.10))
            
            if "left" in pos_hint:
                cx = int(w * 0.28)
            elif "right" in pos_hint:
                cx = int(w * 0.72)

            box = (max(10, cx - bw // 2), max(10, cy - bh // 2), min(w - 10, cx + bw // 2), min(h - 10, cy + bh // 2))

        x0, y0, x1, y1 = box
        bw_box = x1 - x0
        bh_box = y1 - y0

        # 1. Whiteout original speech bubble area
        draw.rounded_rectangle([x0, y0, x1, y1], radius=12, fill=(255, 255, 255, 245), outline=(220, 220, 220, 255), width=2)

        # 2. Dynamic font sizing & text wrapping
        custom_font_size = float(item.get("fontSize", 13))
        font = get_khmer_font(custom_font_size)

        words = text.split(" ")
        lines = []
        cur_line = ""

        for word in words:
            test_line = f"{cur_line} {word}".strip()
            bbox = font.getbbox(test_line) if hasattr(font, 'getbbox') else (0, 0, font.getsize(test_line)[0], 16)
            line_w = bbox[2] - bbox[0]
            if line_w <= (bw_box - 16):
                cur_line = test_line
            else:
                if cur_line:
                    lines.append(cur_line)
                cur_line = word
        if cur_line:
            lines.append(cur_line)

        line_height = int(custom_font_size * 1.3)
        total_text_h = len(lines) * line_height
        start_y = y0 + max(4, (bh_box - total_text_h) // 2)

        for i, line_str in enumerate(lines):
            line_y = start_y + i * line_height
            if line_y + line_height > y1:
                break
            bbox = font.getbbox(line_str) if hasattr(font, 'getbbox') else (0, 0, font.getsize(line_str)[0], 16)
            lw = bbox[2] - bbox[0]
            line_x = x0 + max(4, (bw_box - lw) // 2)
            draw.text((line_x, line_y), line_str, fill=(15, 23, 42, 255), font=font)

    output = io.BytesIO()
    img.convert("RGB").save(output, format="PNG")
    return output.getvalue()

@app.route('/api/render-translated-page', methods=['POST'])
def render_translated_page():
    try:
        if 'file' not in request.files:
            return jsonify({"status": "error", "message": "Missing PDF file"}), 400
        
        pdf_file = request.files['file']
        page_num = int(request.form.get('pageNum', 1))
        ocr_items_str = request.form.get('ocr_items', '[]')
        ocr_items = json.loads(ocr_items_str)

        doc = fitz.open(stream=pdf_file.read(), filetype="pdf")
        if page_num < 1 or page_num > len(doc):
            return jsonify({"status": "error", "message": f"Invalid page number {page_num}"}), 400

        page = doc[page_num - 1]
        pix = page.get_pixmap(dpi=150)
        orig_img_bytes = pix.tobytes("png")

        rendered_img_bytes = render_manga_page_khmer(orig_img_bytes, ocr_items)
        base64_str = base64.b64encode(rendered_img_bytes).decode("utf-8")

        return jsonify({
            "status": "success",
            "pageNum": page_num,
            "dataUrl": f"data:image/png;base64,{base64_str}"
        })
    except Exception as e:
        print(f"Error rendering page: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/export-translated-pdf', methods=['POST'])
def export_translated_pdf():
    try:
        if 'file' not in request.files:
            return jsonify({"status": "error", "message": "Missing PDF file"}), 400

        pdf_file = request.files['file']
        ocr_items_str = request.form.get('ocr_items', '[]')
        ocr_items = json.loads(ocr_items_str)

        pdf_bytes = pdf_file.read()
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")

        translated_doc = fitz.open()

        for page_idx in range(len(doc)):
            page_num = page_idx + 1
            page = doc[page_idx]
            page_items = [r for r in ocr_items if r.get("pageNum") == page_num]

            if page_items:
                pix = page.get_pixmap(dpi=120)
                orig_img_bytes = pix.tobytes("png")
                rendered_bytes = render_manga_page_khmer(orig_img_bytes, page_items)

                new_page = translated_doc.new_page(width=page.rect.width, height=page.rect.height)
                new_page.insert_image(page.rect, stream=rendered_bytes)
            else:
                translated_doc.insert_pdf(doc, from_page=page_idx, to_page=page_idx)

        out_buffer = io.BytesIO()
        translated_doc.save(out_buffer)
        out_buffer.seek(0)

        return send_file(
            out_buffer,
            mimetype='application/pdf',
            as_attachment=True,
            download_name='manga_khmer_translated.pdf'
        )
    except Exception as e:
        print(f"Error exporting PDF: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

if __name__ == '__main__':
    print("PDF Creator server starting on http://127.0.0.1:5000...")
    app.run(debug=True, port=5000)
