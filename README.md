# PDF Creator & OCR Scanner Dashboard

A modern, high-performance web application designed for compiling, managing, and performing layout-aware OCR (Optical Character Recognition) on PDF documents. It features automatic manga downloader separation, fast direct PDF OCR parsing, and advanced AI-assisted review and transcription correction using Gemini.

---

## Key Features

1. **Manga Downloader with Chapter Separation**
   - Scrape and download manga pages from supported online sources.
   - Automatically compile pages into separate PDF files per chapter (e.g. `[Title] - Ch 1.pdf`, `[Title] - Ch 2.pdf`) instead of merging them all into one file.
   - Automatically saves chapters into the local PDF library.

2. **Direct PDF OCR Scanner (Tesseract)**
   - Per-page layout-aware OCR text extraction executed entirely in-memory using **PyMuPDF (`fitz`)** and **Tesseract**.
   - Groups text blocks logically, resolves hyphens, filters out scan noise, and formats paragraphs cleanly.
   - Fully interactive page range selector ("All pages", "Current page", or specific page index).

3. **Gemini AI OCR Review & Correction**
   - Features a **"✨ AI Review"** button to automatically review, correct, and restructure OCR transcripts.
   - Leverages **Gemini 2.0 Flash** via a direct HTTP REST API (bypassing restricted binary DLL blocks on Windows).
   - Multimodally analyzes the page image against the Tesseract transcript to:
     - **Update/Correct**: Fix misrecognized characters and typos.
     - **Delete**: Automatically remove watermark text and scan noise.
     - **Merge**: Combine dialogue splits belonging to the same speech bubble, concatenating their translations automatically.
     - **Add**: Identify and insert missing text bubbles that Tesseract skipped.

---

## Installation & Setup

### 1. Prerequisites
- Python 3.10 or higher.
- Tesseract OCR engine (required for local OCR scanning).

### 2. Install Tesseract OCR (Windows)
1. Download the Tesseract installer for Windows from:
   [UB-Mannheim Tesseract OCR Wiki](https://github.com/UB-Mannheim/tesseract/wiki).
2. During installation:
   - Make sure to check and download **Khmer** and **English** language scripts under the additional language settings.
3. The default path will be configured automatically at `C:\Program Files\Tesseract-OCR\tesseract.exe`.

### 3. Clone & Environment Setup
1. Setup Python virtual environment:
   ```bash
   python -m venv venv
   venv\Scripts\activate
   ```
2. Install Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```

### 4. Gemini API Key Configuration
Create a `.env` file in the project root directory and add your Google AI Studio Gemini API Key:
```env
GEMINI_API_KEY=your-actual-gemini-api-key-here
```
The application will automatically detect and load this key on startup.

---

## Running the Application

1. Start the Flask server:
   ```bash
   python app.py
   ```
2. Open your web browser and navigate to:
   **[http://127.0.0.1:5000](http://127.0.0.1:5000)**

---

## Technical Stack
- **Backend**: Python, Flask, PyMuPDF (fitz), Pillow, pytesseract, requests
- **Frontend**: HTML5, Vanilla CSS, Vanilla JS, Lucide icons, IndexedDB (local storage)
