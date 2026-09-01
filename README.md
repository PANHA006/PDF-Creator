# PDF Creator & Manga OCR Translation Studio

A modern, high-performance web application built with **Node.js** and **Express** for creating, managing, downloading, and translating Manga/Comic PDFs into fluent Khmer using **Google Gemini Vision AI**.

---

## 🌟 Key Features

1. **Image to PDF Creator**
   - Convert multiple images into a single PDF in seconds.
   - Customizable page options: **Original Size**, **A4 Portrait**, or **A4 Landscape** with automatic aspect ratio scaling and centering.
   - Individual page rotation (90°, 180°, 270°) and compression quality controls.

2. **Gemini Vision OCR & Khmer Translation**
   - Multimodal OCR dialogue extraction powered by **Gemini Vision API** (`gemini-2.0-flash`, `gemini-2.5-flash`, `gemini-flash-lite`).
   - Translates Japanese/English/Chinese dialogues and titles into 100% natural, fluent **Khmer (ភាសាខ្មែរ)** while preserving character proper names.
   - Intelligent CJK sound effect (SFX) noise filtering and multiline dialogue consolidation.

3. **Live Manga Dialogue Overlay & Export**
   - Automatically erases original speech bubbles with clean whiteout backgrounds.
   - Renders wrapped Khmer text directly onto page images using authentic Windows Khmer fonts (**Khmer OS Content**, **Khmer OS Battambang**, **Khmer UI**).
   - Export translated pages into a downloadable **Khmer Translated PDF** (`manga_khmer_translated.pdf`).

4. **Universal Manga Downloader & Chapter Compiler**
   - Scrape and download manga chapters from **MangaDex**, **ComicK**, and universal WordPress/Madara reader sites.
   - Automatically compile downloaded chapters into volume PDFs or export as a **ZIP** archive.

5. **AI Review & Proofreading**
   - One-click **"✨ AI Review"** button to proofread OCR transcripts, fix typos, and refine Khmer translations.

---

## 🚀 Installation & Setup

### 1. Prerequisites
- **Node.js**: `v18.0.0` or higher (`v20+` / `v24+` recommended)
- **npm**: `v9.0.0` or higher

### 2. Install Dependencies
```bash
npm install
```

### 3. Gemini API Key Configuration
Create a `.env` file in the project root directory:
```env
GEMINI_API_KEY=your_actual_gemini_api_key_here
PORT=5000
```
*(Get a free API key from [Google AI Studio](https://aistudio.google.com/))*

---

## 💻 Running the Application

### Start the Server:
```bash
npm start
```

### For Development (with auto-reload on file change):
```bash
npm run dev
```

Open your web browser and navigate to:
**[http://127.0.0.1:5000](http://127.0.0.1:5000)**

---

## 🧪 Running Automated Tests

Run the full end-to-end test suite covering all features and API endpoints:
```bash
npm test
```

### Test Suites Included:
- `test/pdf_features.test.js` — PDF generation, PDF page rendering, Khmer text overlay, and export.
- `test/manga_features.test.js` — Manga scrapers and ZIP stream creation.
- `test/gemini_features.test.js` — Gemini Vision OCR and AI Review handlers.
- `test/api_endpoints.test.js` — Express HTTP API integration tests.

---

## 🛠️ Technical Stack

- **Backend**: Node.js, Express.js
- **PDF Manipulation**: `pdf-lib`
- **PDF Rendering**: `pdfjs-dist` + `@napi-rs/canvas`
- **Image Processing**: `sharp` & `@napi-rs/canvas`
- **Web Scraping**: `axios`, `cheerio`
- **ZIP Creation**: `archiver`
- **AI & OCR Engine**: Google Gemini Multimodal Vision API
- **Frontend**: HTML5, Modern CSS, Vanilla JavaScript, Lucide Icons, IndexedDB
