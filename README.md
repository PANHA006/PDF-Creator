# PDF Creator & Manga Dialogue OCR Studio

<p align="center">
  <b>កម្មវិធីបម្លែងរូបភាពទៅជា PDF និង Word (.docx) ព្រមទាំងបកប្រែតួអក្សរ Manga/Comic ទៅជាភាសាខ្មែរដោយស្វ័យប្រវត្តិតាមរយៈ Google Gemini Vision AI</b>
  <br>
  <i>A modern, high-performance Node.js studio for PDF & DOCX creation, Manga chapter downloading, and AI-powered Khmer OCR translation with native editable Word text boxes.</i>
</p>

---

## 🌟 លក្ខណៈពិសេសចម្បងៗ (Key Features)

### 1. 📚 បម្លែងរូបភាពទៅជា PDF (Image to PDF Creator)
- បម្លែងរូបភាពច្រើនសន្លឹកចូលគ្នាទៅជាឯកសារ PDF តែមួយយ៉ាងរហ័ស។
- ជម្រើសទំហំទំព័រចម្រុះ៖ **Original Size**, **A4 Portrait**, ឬ **A4 Landscape** ដោយរក្សា Aspect Ratio ដើមមិនឱ្យបែក ឬខូចទ្រង់ទ្រាយ។
- បង្វិលទំព័រនីមួយៗ (90°, 180°, 270°) និងកំណត់កម្រិតគុណភាពរូបភាព (Compression Quality)។

### 2. 📝 បង្កើតឯកសារ Word (.docx) ដែលមាន Khmer Text Shapes កែប្រែបាន
- បម្លែងរូបភាព Manga ទៅជាឯកសារ **Microsoft Word (.docx)** ដែលមានទំហំទទឹងស្មើគ្នា (**Unified Width 350px / 5,250 Twips**)។
- កម្ពស់ទំព័រនីមួយៗគណនាស្វ័យប្រវត្តិសមាមាត្រទៅនឹងរូបភាព (Aspect Ratio) គ្មានគែមសល់ (Zero Margins)។
- Speech Bubbles ទាំងអស់ត្រូវបានបង្កប់ជា **Native Word Text Boxes (In Front of Text)** ជាមួយពុម្ពអក្សរខ្មែរ **Khmer OS Battambang** ដែលអាចចុច Edit អក្សរផ្ទាល់នៅលើ Microsoft Word ឬ WPS Office បានយ៉ាងងាយស្រួល។
- ប៊ូតុង **"បញ្ជូន DOCX ទៅ Manga Creator"** រក្សាទុកឯកសារដោយផ្ទាល់ទៅក្នុងបណ្ណាល័យ IndexedDB សម្រាប់បើកមើលភ្លាមៗ ដោយមិនបាច់រង់ចាំ Download ចូលក្នុង Chrome។

### 3. 👁️ Gemini Vision OCR & បកប្រែជាភាសាខ្មែរ (Khmer Translation)
- ប្រើប្រាស់បច្ចេកវិទ្យា Multimodal AI របស់ Google Gemini ដើម្បីស្វែងរកកន្លែងសន្ទនា (Speech Bubbles) និងស្រង់អក្សរដោយស្វ័យប្រវត្តិ។
- ប្រព័ន្ធ **Multi-Model Auto-Fallback**: ប្តូរម៉ូដែលស្វ័យប្រវត្តិនៅពេលមានបញ្ហា Quota ឬ High Traffic (`gemini-3.6-flash` ➜ `gemini-3.5-flash` ➜ `gemini-3.1-flash-lite` ➜ `gemini-2.5-flash`)។
- បកប្រែភាសាអង់គ្លេស ជប៉ុន ឬចិន ទៅជាភាសាខ្មែរបែបធម្មជាតិ រលូន និងត្រឹមត្រូវតាមវេយ្យាករណ៍។
- មុខងារ **"✨ AI Review"** សម្រាប់ជួយពិនិត្យអក្ខរាវិរុទ្ធ និងកែសម្រួលអត្ថន័យឱ្យកាន់តែពិរោះ។

### 4. 🎨 គូរអក្សរខ្មែរលើទំព័រដើម (Live Dialogue Overlay & PDF Export)
- លុបអក្សរដើមចេញពី Speech Bubble ដោយស្វ័យប្រវត្តិ (Whiteout background)។
- គូរអក្សរខ្មែរជំនួសវិញដោយប្រើពុម្ពអក្សរខ្មែរស្ដង់ដារ Windows (`Khmer OS Content`, `Khmer OS Battambang`, `Khmer UI`) តាមរយៈ `@napi-rs/canvas`។
- Export ជា **Khmer Translated PDF** ភ្លាមៗ។

### 5. 🌐 ទាញយក Manga ពីគេហទំព័រ (Universal Manga Downloader)
- ទាញយក Chapter រូបភាពផ្ទាល់ពី **MangaDex** ឬគេហទំព័រ Manga ទូទៅ។
- បង្កើតជាឯកសារ **ZIP** ឬបម្លែងទៅជា Volume PDF / DOCX ក្នុងពេលតែមួយ។

### 6. 🛑 ប្រព័ន្ធបោះបង់ដំណើរការ (Process Cancellation & Abort Control)
- មានប៊ូតុង **"បោះបង់ (Cancel)"** នៅគ្រប់ដំណើរការវែងៗ (Manga Downloader, Gemini OCR, AI Review)។
- ប្រើប្រាស់ `AbortController` ទាំង Frontend និង Backend ដើម្បីផ្ដាច់ Network Request ភ្លាមៗ សម្អាត Memory និងមិនឱ្យគាំង Browser។

### 7. 📊 Real-Time Terminal Activity & State Logging
- ផ្ទាំង Terminal បង្ហាញ State និងពណ៌តាមប្រភេទសកម្មភាពរបស់អ្នកប្រើប្រាស់ (ឧទាហរណ៍ `[USER]`, `[PDF]`, `[DOCX]`, `[GEMINI AI]`, `[CANCEL]`) ជាមួយនឹងរយៈពេល Execution Time និង IP Address យ៉ាងច្បាស់លាស់។

---

## 📁 រចនាសម្ព័ន្ធគម្រោង (Project Architecture)

```text
PDF-Creator/
├── src/
│   └── services/
│       ├── docxService.js         # Word (.docx) Engine & Khmer Text Shapes
│       ├── geminiService.js       # Gemini Vision OCR & Multi-Model Engine
│       ├── imageOverlayService.js # Canvas Text & Speech Bubble Overlay
│       ├── mangaService.js        # Manga Scraper & ZIP Stream
│       └── pdfService.js          # PDF Generator & High-Res Page Renderer
├── static/
│   ├── css/
│   │   └── custom.css             # Modern Responsive Layout & Styling
│   └── js/
│       └── main.js                # Frontend Logic, IndexedDB & AbortController
├── templates/
│   └── index.html                 # Web Studio UI & Controls
├── test/
│   ├── all_features.test.js       # Main Automated Test Runner
│   ├── api_endpoints.test.js      # REST API Integration Tests
│   ├── gemini_features.test.js    # Gemini OCR & Review Tests
│   ├── manga_features.test.js     # Manga Fetching & ZIP Tests
│   └── pdf_features.test.js       # PDF & Image Engine Tests
├── nodemon.json                   # Dev Mode Watcher Configuration
├── package.json                   # Dependencies & Scripts
├── README.md                      # Project Documentation
├── run_dev.bat                    # Quick Start Script for Windows
└── server.js                      # Express Server & Real-time State Logger
```

---

## 🚀 ការដំឡើង និងដំណើរការ (Installation & Setup)

### ១. តម្រូវការជាមុន (Prerequisites)
- **Node.js**: កំណែ `v18.0.0` ឬខ្ពស់ជាងនេះ (`v20+` / `v24+` ត្រូវបានណែនាំ)
- **npm**: កំណែ `v9.0.0` ឬខ្ពស់ជាងនេះ

### ២. ទាញយក Dependencies
```bash
npm install
```

### ៣. កំណត់ Gemini API Key (.env)
បង្កើតឯកសារ `.env` នៅកម្រិត Root នៃគម្រោង៖
```env
GEMINI_API_KEY=your_actual_gemini_api_key_here
PORT=5000
```
*(អ្នកអាចទទួលបាន API Key ឥតគិតថ្លៃពី [Google AI Studio](https://aistudio.google.com/))*

---

## 💻 របៀបដំណើរការកម្មវិធី (Running the App)

### ដំណើរការសម្រាប់ Production (Start Server):
```bash
npm start
```

### ដំណើរការក្នុង Developer Mode (Auto-reload ពេលកែប្រែកូដ):
```bash
npm run dev
```
*(ឬចុច Double-Click លើឯកសារ `run_dev.bat` លើ Windows)*

បើក Web Browser របស់អ្នកទៅកាន់៖
👉 **[http://127.0.0.1:5000](http://127.0.0.1:5000)**

---

## 🧪 ការតេស្តសាកល្បងស្វ័យប្រវត្តិ (Automated Tests)

ដំណើរការ Test Suite គ្របដណ្តប់គ្រប់មុខងារទាំងអស់៖
```bash
npm test
```

### កញ្ចប់តេស្តរួមមាន៖
- `test/pdf_features.test.js` — តេស្តការបង្កើត PDF, ការបម្លែង Resolution និងការ Overlay អក្សរខ្មែរ។
- `test/manga_features.test.js` — តេស្ត Scraper និងការវេចខ្ចប់ ZIP។
- `test/gemini_features.test.js` — តេស្ត Gemini OCR, Multi-model fallback និង AI Review។
- `test/api_endpoints.test.js` — តេស្ត Express REST APIs គ្រប់ Endpoints។

---

## 🛠️ បច្ចេកវិទ្យាដែលបានប្រើប្រាស់ (Tech Stack)

| ផ្នែក | បច្ចេកវិទ្យា |
| :--- | :--- |
| **Backend** | Node.js, Express.js |
| **Document Processing** | `docx`, `pdf-lib`, `pdfjs-dist`, `jszip`, `archiver` |
| **Image & Canvas Rendering**| `sharp`, `@napi-rs/canvas` |
| **Web Scraping** | `axios`, `cheerio` |
| **AI Vision & Translation** | Google Gemini Vision API (`@google/generative-ai` compatible REST/SDK) |
| **Frontend** | Vanilla JavaScript, HTML5, Modern CSS, IndexedDB, Lucide Icons |
| **Khmer Fonts** | Khmer OS Content, Khmer OS Battambang, DaunPenh, Khmer UI |

---

## 📄 អាជ្ញាប័ណ្ណ (License)

គម្រោងនេះត្រូវបានចែកចាយក្រោមអាជ្ញាប័ណ្ណ **MIT License**។
