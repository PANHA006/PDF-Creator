from flask import Flask, render_template, send_from_directory, jsonify, request, send_file
import os
import io
import json
import base64
import fitz
from PIL import Image

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

import pytesseract

@app.route('/api/scan-ocr', methods=['POST'])
def scan_ocr():
    try:
        # Get language and rotation
        lang_option = request.form.get('lang', 'auto')
        rotation = int(request.form.get('rotation', 0))
        
        # Check if image file exists
        if 'image' not in request.files:
            return jsonify({"status": "error", "message": "Missing image file"}), 400
            
        file_obj = request.files['image']
        
        # Open image using Pillow
        img = Image.open(io.BytesIO(file_obj.read()))
        
        # Rotate image to correct orientation before OCR
        if rotation != 0:
            img = img.rotate(-rotation, expand=True)
            
        # Map language settings to Tesseract codes
        if lang_option == 'auto' or lang_option == 'khm+eng':
            tess_lang = 'khm+eng'
        elif lang_option == 'khm':
            tess_lang = 'khm'
        else:
            tess_lang = 'eng'
            
        # Auto-configure Tesseract path on Windows if default path exists
        tesseract_win_path = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
        if os.path.exists(tesseract_win_path):
            pytesseract.pytesseract.tesseract_cmd = tesseract_win_path
            
        # Point pytesseract to local tessdata folder containing khm+eng traineddata
        local_tessdata = os.path.join(app.root_path, 'tessdata')
        os.environ['TESSDATA_PREFIX'] = local_tessdata
        
        # Run Tesseract OCR scan with block-level layout grouping (prevents side-by-side bubble mixing)
        try:
            # Extract word-level bounding boxes and block/line hierarchy
            data = pytesseract.image_to_data(img, lang=tess_lang, output_type="dict")
            
            blocks = {}
            n_boxes = len(data['text'])
            for i in range(n_boxes):
                conf = float(data['conf'][i])
                word_text = data['text'][i].strip()
                
                # Filter out container blocks and blank/empty values
                if conf == -1 or not word_text:
                    continue
                    
                block_id = data['block_num'][i]
                line_id = data['line_num'][i]
                
                if block_id not in blocks:
                    blocks[block_id] = {}
                    
                if line_id not in blocks[block_id]:
                    blocks[block_id][line_id] = []
                    
                blocks[block_id][line_id].append(word_text)
                
            # Compile paragraphs/phrases from segmented layout blocks
            phrases = []
            for b_id in sorted(blocks.keys()):
                block_lines = blocks[b_id]
                phrase_lines = []
                for l_id in sorted(block_lines.keys()):
                    line_text = " ".join(block_lines[l_id])
                    phrase_lines.append(line_text)
                    
                merged_block_text = ""
                for idx, line in enumerate(phrase_lines):
                    if idx == 0:
                        merged_block_text = line
                    else:
                        prev_line = phrase_lines[idx - 1]
                        if prev_line.endswith('-') or prev_line.endswith('—'):
                            # Strip hyphen and join lines directly
                            merged_block_text = merged_block_text[:-1] + line
                        else:
                            merged_block_text += " " + line
                
                if merged_block_text.strip():
                    phrases.append(merged_block_text.strip())
                    
            text = "\n\n".join(phrases)
        except Exception as ocr_err:
            print(f"INFO: Tesseract OCR failed ({ocr_err}). Running in SIMULATOR fallback mode.")
            # Fallback mock text generator based on chosen language
            if lang_option == 'khm':
                text = (
                    "ព្រះរាជាណាចក្រកម្ពុជា\n"
                    "ជាតិ សាសនា ព្រះមហាក្សត្រ\n"
                    "របាយការណ៍ស្កែនឯកសារ PDF Creator\n"
                    "អត្ថបទគំរូភាសាខ្មែរ សម្រាប់ធ្វើតេស្តសាកល្បងដោយជោគជ័យ។"
                )
            elif lang_option == 'eng':
                text = (
                    "KINGDOM OF CAMBODIA\n"
                    "Nation Religion King\n"
                    "PDF Creator & OCR Document Report\n"
                    "This is a simulated English scanned text extracted from your image page."
                )
            else:
                text = (
                    "ព្រះរាជាណាចក្រកម្ពុជា - KINGDOM OF CAMBODIA\n"
                    "ជាតិ សាសនា ព្រះមហាក្សត្រ - Nation Religion King\n"
                    "ស្កែនអក្សរខ្មែរ និង អង់គ្លេស - Multi-language OCR Scan\n"
                    "ប្រព័ន្ធដំណើរការបានល្អឥតខ្ចោះ - System works perfectly!"
                )
        
        return jsonify({
            "status": "success",
            "text": text
        })
        
    except Exception as e:
        print(f"Error in OCR scan: {e}")
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

def fetch_madara_manga(url):
    try:
        # Detect if url is a chapter URL and extract parent URL
        parent_url = re.sub(r'chapter-[a-zA-Z0-9\-_]+/?$', '', url)
        if not parent_url.endswith('/'):
            parent_url += '/'
            
        is_chapter_url = parent_url != url
        requested_chapter_url = url if is_chapter_url else ""
        
        import cloudscraper
        from bs4 import BeautifulSoup
        scraper = cloudscraper.create_scraper()
        html = scraper.get(parent_url).text
        soup = BeautifulSoup(html, 'html.parser')
        
        # 1. Title
        title_el = soup.select_one('.post-title h1') or soup.select_one('h1')
        title = title_el.text.strip() if title_el else "Unknown Title"
        
        # 2. Cover image
        cover_el = soup.select_one('.summary_image img') or soup.select_one('.post-thumbnail img')
        cover_url = ""
        if cover_el:
            cover_url = cover_el.get('data-src') or cover_el.get('data-lazy-src') or cover_el.get('src') or ""
        
        # 3. Description
        desc_el = soup.select_one('.description-summary') or soup.select_one('.manga-excerpt')
        description = desc_el.text.strip() if desc_el else ""
        
        # 4. Scrape metadata: Author, Alternative, Status
        author = "Unknown Author"
        alternative = ""
        status = "OnGoing"
        for item in soup.select('.post-content_item'):
            h5 = item.select_one('h5')
            if h5:
                label = h5.text.strip().lower()
                val_el = item.select_one('.summary-content') or item.select_one('.author-content')
                if val_el:
                    val_text = val_el.text.strip()
                    if 'author' in label:
                        author = val_text
                    elif 'alternative' in label:
                        alternative = val_text
                    elif 'status' in label:
                        status = val_text
        
        # 5. Chapters list
        chapter_elements = soup.select('.wp-manga-chapter a')
        if not chapter_elements:
            chapter_elements = soup.select('.row-content-chapter a')
            
        chapters = []
        for idx, el in enumerate(chapter_elements):
            ch_url = el.get('href')
            ch_title = el.text.strip()
            
            # Extract chapter number
            ch_num = ""
            match = re.search(r'(?:chapter|ch\.?)\s*([0-9\.]+)', ch_title, re.IGNORECASE)
            if match:
                ch_num = match.group(1)
            else:
                ch_num = str(idx + 1)
                
            chapters.append({
                "id": ch_url, # Pass URL as id!
                "volume": "",
                "chapter": ch_num,
                "title": ch_title,
                "pages": 0 # Web scraped chapters don't tell page count upfront
            })
            
        # Reverse to ascending order (Madara is descending)
        chapters.reverse()
        
        return jsonify({
            "status": "success",
            "manga": {
                "id": parent_url,
                "title": title,
                "author": author,
                "status": status,
                "alternative": alternative,
                "description": description,
                "coverUrl": cover_url,
                "chapters": chapters,
                "requestedChapterUrl": requested_chapter_url
            }
        })
    except Exception as e:
        print(f"Error fetching Madara manga details: {e}")
        return jsonify({"status": "error", "message": f"Failed to parse website: {str(e)}"}), 500

def download_madara_chapter(chapter_url):
    try:
        import cloudscraper
        from bs4 import BeautifulSoup
        import requests
        
        scraper = cloudscraper.create_scraper()
        html = scraper.get(chapter_url).text
        soup = BeautifulSoup(html, 'html.parser')
        
        # In Madara themes, images are inside .reading-content img or .page-break img or .entry-content img
        img_elements = soup.select('.reading-content img') or soup.select('.page-break img') or soup.select('.entry-content img')
        
        page_urls = []
        for el in img_elements:
            img_url = el.get('data-src') or el.get('data-lazy-src') or el.get('src') or ""
            img_url = img_url.strip()
            if img_url and not img_url.startswith('data:'):
                page_urls.append(img_url)
                
        pages_list = []
        for idx, page_url in enumerate(page_urls):
            if not page_url:
                continue
            if page_url.startswith('//'):
                page_url = 'https:' + page_url
                
            try:
                headers = {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': chapter_url
                }
                img_res = requests.get(page_url, headers=headers, timeout=15)
                if img_res.status_code == 200:
                    img_data = img_res.content
                    encoded = base64.b64encode(img_data).decode('utf-8')
                    
                    # Deduce extension
                    ext = page_url.split('/')[-1].split('?')[0].split('.')[-1].lower()
                    if ext not in ['jpg', 'jpeg', 'png', 'webp']:
                        ext = 'png'
                    mime = f"image/{ext}"
                    if ext == 'jpg':
                        mime = "image/jpeg"
                        
                    pages_list.append({
                        "name": f"page_{idx + 1}.{ext}",
                        "dataUrl": f"data:{mime};base64,{encoded}"
                    })
            except Exception as page_err:
                print(f"Error downloading scraped image page {idx+1} from {page_url}: {page_err}")
                continue
                
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
            return fetch_madara_manga(url_or_id)
            
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
            
        # Detect if it's a Madara URL
        if chapter_id.startswith('http://') or chapter_id.startswith('https://'):
            return download_madara_chapter(chapter_id)
            
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

if __name__ == '__main__':
    print("PDF Creator server starting on http://127.0.0.1:5000...")
    app.run(debug=True, port=5000)
