require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const JSZip = require('jszip');

const {
  generatePdfFromImages,
  renderPdfPagesToImages,
  applyKhmerOverlayToPdf
} = require('./src/services/pdfService');

const {
  generateDocxFromImages,
  generateDocxWithKhmerScript
} = require('./src/services/docxService');

const {
  scanOcrImage,
  aiReview
} = require('./src/services/geminiService');

const {
  fetchMangaDex,
  downloadMangaDexChapter,
  fetchUniversalManga,
  downloadUniversalChapter,
  createZipStream
} = require('./src/services/mangaService');

const { renderMangaPageKhmer } = require('./src/services/imageOverlayService');

const app = express();
const PORT = process.env.PORT || 5000;

// ANSI Terminal Color Codes & Log State Helpers
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
  gray: '\x1b[90m'
};

function getTimestamp() {
  const now = new Date();
  return now.toLocaleTimeString('en-US', { hour12: false });
}

function logState(category, icon, message, color = colors.cyan) {
  const time = `${colors.gray}[${getTimestamp()}]${colors.reset}`;
  const tag = `${color}${colors.bright}[${category}]${colors.reset}`;
  console.log(`${time} ${tag} ${icon} ${message}`);
}

// Setup upload handler in memory with large 500MB capacity
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 500 * 1024 * 1024,  // 500MB per file
    fieldSize: 500 * 1024 * 1024  // 500MB for large JSON fields
  }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));

// Global HTTP Request & Activity Logger Middleware
app.use((req, res, next) => {
  if (req.path.startsWith('/static/')) return next();

  const start = Date.now();
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  let isFinished = false;

  res.on('finish', () => {
    isFinished = true;
    const duration = Date.now() - start;
    const status = res.statusCode;
    const statusColor = status >= 500 ? colors.red : (status >= 400 ? colors.yellow : colors.green);
    const methodColor = req.method === 'POST' ? colors.cyan : colors.blue;
    
    console.log(
      `${colors.gray}[${getTimestamp()}]${colors.reset} ` +
      `${methodColor}${req.method}${colors.reset} ${req.originalUrl} ` +
      `${statusColor}${status}${colors.reset} ` +
      `${colors.dim}(${duration}ms - ${clientIp})${colors.reset}`
    );
  });

  res.on('close', () => {
    if (!res.writableFinished && !isFinished) {
      const duration = Date.now() - start;
      logState('CANCEL', '⚠️', `${colors.yellow}Client aborted ${req.method} ${req.originalUrl} (${duration}ms)${colors.reset}`, colors.yellow);
    }
  });

  next();
});

// Serve static assets with no-cache headers for instant updates
app.use('/static', express.static(path.join(__dirname, 'static'), {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  }
}));

// Serve index.html UI with dynamic cache-busting timestamp
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'templates', 'index.html');
  if (fs.existsSync(indexPath)) {
    let html = fs.readFileSync(indexPath, 'utf8');
    const timestamp = Date.now();
    html = html.replace(/main\.js(\?v=[^"']*)?/g, `main.js?v=${timestamp}`);
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.send(html);
  } else {
    res.status(404).send('index.html not found in templates directory');
  }
});

// =====================================================================
// API ENDPOINTS
// =====================================================================

/**
 * POST /api/generate-pdf
 * Generate a PDF from uploaded images
 */
app.post('/api/generate-pdf', upload.array('images'), async (req, res) => {
  try {
    const metadataStr = req.body.metadata;
    if (!metadataStr) {
      return res.status(400).json({ status: 'error', message: 'Missing metadata' });
    }

    const metadata = JSON.parse(metadataStr);
    const pageSizeOption = req.body.page_size || 'original';
    const quality = Math.round(parseFloat(req.body.quality || '1.0') * 100);

    const files = req.files || [];
    logState('PDF', '📚', `Generating PDF with ${files.length} images (Size: ${pageSizeOption}, Quality: ${quality}%)`, colors.blue);

    const filesMap = {};
    for (const f of files) {
      filesMap[f.originalname] = f;
    }

    const pdfBuffer = await generatePdfFromImages(filesMap, metadata, pageSizeOption, quality);
    logState('PDF', '✓', `PDF generated successfully (${(pdfBuffer.length / (1024 * 1024)).toFixed(2)} MB)`, colors.green);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="generated.pdf"');
    return res.send(pdfBuffer);
  } catch (err) {
    logState('PDF', '✗', `${colors.red}PDF Generation Error: ${err.message}${colors.reset}`, colors.red);
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * POST /api/upload-pdf
 * Parse an uploaded PDF and render each page as PNG base64 data URL
 */
app.post('/api/upload-pdf', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ status: 'error', message: 'Missing PDF file' });
    }

    const fileName = req.file.originalname || 'document.pdf';
    logState('PDF', '📄', `Extracting pages from uploaded PDF: "${fileName}" (${(req.file.size / 1024 / 1024).toFixed(2)} MB)`, colors.blue);

    const pages = await renderPdfPagesToImages(req.file.buffer, 150);
    logState('PDF', '✓', `Rendered ${pages.length} pages to high-res images`, colors.green);

    const pagesList = pages.map(p => ({
      name: p.name,
      dataUrl: p.dataUrl
    }));

    return res.json({
      status: 'success',
      pages: pagesList
    });
  } catch (err) {
    logState('PDF', '✗', `${colors.red}PDF Parsing Error: ${err.message}${colors.reset}`, colors.red);
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * GET /api/gemini/status
 * Check if Gemini API key is configured
 */
app.get('/api/gemini/status', (req, res) => {
  const envKeyPresent = !!process.env.GEMINI_API_KEY;
  return res.json({
    status: 'success',
    hasEnvKey: envKeyPresent,
    maskedKey: envKeyPresent && process.env.GEMINI_API_KEY.length > 8
      ? `${process.env.GEMINI_API_KEY.slice(0, 4)}...${process.env.GEMINI_API_KEY.slice(-4)}`
      : null
  });
});

/**
 * POST /api/scan-ocr-pdf & /api/manga-ocr-direct
 * Run Gemini Vision OCR & translation on PDF pages
 */
async function handleOcrScan(req, res, isMangaDirect = false) {
  const scanStartTime = Date.now();
  try {
    const apiKey = (req.headers['x-gemini-api-key'] || req.body.apiKey || process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) {
      logState('GEMINI AI', '✗', `${colors.red}OCR Scan Failed: Missing GEMINI_API_KEY${colors.reset}`, colors.red);
      return res.status(400).json({
        status: 'error',
        message: 'មិនទាន់មាន Gemini API Key នៅឡើយទេ។ សូមបញ្ចូល Gemini API Key របស់អ្នកនៅក្នុងផ្ទាំង Settings ឬក្នុងឯកសារ .env។ (Missing GEMINI_API_KEY)'
      });
    }

    const langOption = req.body.lang || 'auto';
    const pagesOption = req.body.pages || 'all';

    if (!req.file) {
      logState('GEMINI AI', '✗', `${colors.red}OCR Scan Failed: Missing file${colors.reset}`, colors.red);
      return res.status(400).json({ status: 'error', message: 'Missing PDF file' });
    }

    const fileName = req.file.originalname || 'document.pdf';
    const isDocx = fileName.toLowerCase().endsWith('.docx') ||
                   (req.file.mimetype && req.file.mimetype.includes('wordprocessingml'));

    logState('GEMINI AI', '👁️', `Starting Vision OCR on ${colors.bright}"${fileName}"${colors.reset} (Lang: ${langOption}, Target: ${pagesOption}, Format: ${isDocx ? 'Word' : 'PDF'})`, colors.magenta);

    const renderStartTime = Date.now();
    let allPages = [];

    if (isDocx) {
      logState('DOCX', '🔄', `Extracting images directly from Word .docx file (OpenXML)...`, colors.cyan);
      const zip = await JSZip.loadAsync(req.file.buffer);
      let orderedMediaFiles = [];

      // 1. Build Relationship map from word/_rels/document.xml.rels
      const relsMap = {};
      const relsFile = zip.file('word/_rels/document.xml.rels');
      if (relsFile) {
        const relsXml = await relsFile.async('text');
        const relMatches = relsXml.matchAll(/<Relationship\s+[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g);
        for (const match of relMatches) {
          const id = match[1];
          let target = match[2];
          if (!target.toLowerCase().startsWith('word/')) {
            target = 'word/' + target.replace(/^\//, '');
          }
          relsMap[id] = target;
        }
      }

      // 2. Extract in strict sequential page order from word/document.xml
      const docFile = zip.file('word/document.xml');
      if (docFile) {
        const docXml = await docFile.async('text');
        const embedMatches = docXml.matchAll(/r:embed="([^"]+)"/g);
        for (const match of embedMatches) {
          const rId = match[1];
          const target = relsMap[rId];
          if (target && zip.files[target] && !orderedMediaFiles.includes(target)) {
            orderedMediaFiles.push(target);
          }
        }
      }

      // 3. Fallback if document.xml didn't provide embed relationships
      if (orderedMediaFiles.length === 0) {
        orderedMediaFiles = Object.keys(zip.files).filter(f => f.toLowerCase().startsWith('word/media/') && !zip.files[f].dir);
        orderedMediaFiles.sort((a, b) => {
          const numA = parseInt((a.replace(/\D/g, '') || '0'), 10);
          const numB = parseInt((b.replace(/\D/g, '') || '0'), 10);
          return numA - numB;
        });
      }

      for (let i = 0; i < orderedMediaFiles.length; i++) {
        const file = zip.files[orderedMediaFiles[i]];
        if (!file) continue;
        const buf = await file.async('nodebuffer');
        allPages.push({
          name: file.name,
          buffer: buf
        });
      }
    } else {
      logState('PDF', '🔄', `Rendering PDF pages to Vision images (150 DPI)...`, colors.cyan);
      allPages = await renderPdfPagesToImages(req.file.buffer, 150);
    }

    const totalPages = allPages.length;
    logState('PDF', '✓', `Loaded ${totalPages} page(s) in ${((Date.now() - renderStartTime) / 1000).toFixed(2)}s`, colors.green);

    let targetPageIndices = [];
    if (pagesOption === 'all') {
      targetPageIndices = allPages.map((_, i) => i);
    } else {
      try {
        const parts = pagesOption.split(',');
        for (const p of parts) {
          const pNum = parseInt(p.trim(), 10) - 1;
          if (pNum >= 0 && pNum < totalPages) {
            targetPageIndices.push(pNum);
          }
        }
      } catch (e) {
        targetPageIndices = allPages.map((_, i) => i);
      }
    }

    logState('GEMINI AI', '🎯', `Pages queued to scan: [${targetPageIndices.map(i => i + 1).join(', ')}] (Total: ${targetPageIndices.length})`, colors.magenta);

    const ocrResults = [];
    const BATCH_SIZE = 3; // Scan 3 pages concurrently for optimal throughput without API timeout
    const totalBatches = Math.ceil(targetPageIndices.length / BATCH_SIZE);

    for (let i = 0; i < targetPageIndices.length; i += BATCH_SIZE) {
      const currentBatchNum = Math.floor(i / BATCH_SIZE) + 1;
      const batchIndices = targetPageIndices.slice(i, i + BATCH_SIZE);
      const batchPageNums = batchIndices.map(idx => idx + 1);

      logState('GEMINI AI', '🚀', `[Batch ${currentBatchNum}/${totalBatches}] Processing Page(s): [${batchPageNums.join(', ')}]`, colors.magenta);

      const batchPromises = batchIndices.map(async (pIdx, offset) => {
        if (offset > 0) {
          await new Promise(r => setTimeout(r, offset * 180)); // Stagger concurrent requests to prevent burst throttling
        }
        const pageObj = allPages[pIdx];
        const pageNum = pIdx + 1;
        try {
          const pageResults = await scanOcrImage(apiKey, pageObj.buffer, pageNum, langOption, isMangaDirect);
          return { pageNum, results: pageResults || [] };
        } catch (pageErr) {
          logState('GEMINI AI', '✗', `${colors.red}[Page ${pageNum}] OCR Error: ${pageErr.message}${colors.reset}`, colors.red);
          throw pageErr;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      batchResults.sort((a, b) => a.pageNum - b.pageNum);
      for (const item of batchResults) {
        ocrResults.push(...item.results);
      }
    }

    const totalDuration = ((Date.now() - scanStartTime) / 1000).toFixed(2);
    logState('GEMINI AI', '✨', `OCR & Translation complete: ${targetPageIndices.length} pages scanned, ${ocrResults.length} dialogues extracted (${totalDuration}s)`, colors.green);

    return res.json({
      status: 'success',
      results: ocrResults
    });
  } catch (err) {
    const errorDuration = ((Date.now() - scanStartTime) / 1000).toFixed(2);
    logState('GEMINI AI', '✗', `${colors.red}OCR Scan Error (${errorDuration}s): ${err.message}${colors.reset}`, colors.red);
    return res.status(500).json({ status: 'error', message: err.message });
  }
}

app.post('/api/scan-ocr-pdf', upload.single('file'), (req, res) => handleOcrScan(req, res, false));
app.post('/api/manga-ocr-direct', upload.single('file'), (req, res) => handleOcrScan(req, res, true));

/**
 * POST /api/ai-review
 * Proofread and improve OCR transcript items
 */
app.post('/api/ai-review', upload.single('file'), async (req, res) => {
  try {
    const apiKey = (req.headers['x-gemini-api-key'] || req.body.apiKey || process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) {
      logState('GEMINI AI', '✗', `${colors.red}AI Review Failed: Missing GEMINI_API_KEY${colors.reset}`, colors.red);
      return res.status(400).json({
        status: 'error',
        message: 'មិនទាន់មាន Gemini API Key នៅឡើយទេ។ សូមបញ្ចូល Gemini API Key របស់អ្នកនៅក្នុងផ្ទាំង Settings ឬក្នុងឯកសារ .env។'
      });
    }

    const pageNum = parseInt(req.body.pageNum || '1', 10);
    const ocrItemsStr = req.body.ocr_items || '[]';
    const ocrItems = JSON.parse(ocrItemsStr);

    if (!req.file) {
      return res.status(400).json({ status: 'error', message: 'Missing PDF file' });
    }

    logState('GEMINI AI', '✨', `Running AI Review & Proofreading on Page ${pageNum} (${ocrItems.length} phrases)...`, colors.magenta);

    const allPages = await renderPdfPagesToImages(req.file.buffer, 150);
    if (pageNum < 1 || pageNum > allPages.length) {
      return res.status(400).json({
        status: 'error',
        message: `Page number ${pageNum} is out of bounds (1-${allPages.length})`
      });
    }

    const targetPage = allPages[pageNum - 1];
    const updateResults = await aiReview(apiKey, targetPage.buffer, ocrItems, pageNum);

    logState('GEMINI AI', '✓', `AI Review completed for Page ${pageNum} (${updateResults.length} operations)`, colors.green);

    return res.json({
      status: 'success',
      results: updateResults
    });
  } catch (err) {
    logState('GEMINI AI', '✗', `${colors.red}AI Review Error: ${err.message}${colors.reset}`, colors.red);
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * POST /api/manga/fetch
 * Fetch manga info & chapters
 */
app.post('/api/manga/fetch', upload.none(), async (req, res) => {
  try {
    const urlOrId = req.body.url || '';
    if (!urlOrId) {
      return res.status(400).json({ status: 'error', message: 'Missing manga link or ID' });
    }

    logState('MANGA', '🔍', `User fetching manga URL: "${urlOrId.slice(0, 80)}"`, colors.cyan);

    const isWebUrl = urlOrId.startsWith('http://') || urlOrId.startsWith('https://');
    const isMangaDex = urlOrId.includes('mangadex.org');

    let mangaData;
    if (isWebUrl && !isMangaDex) {
      mangaData = await fetchUniversalManga(urlOrId);
    } else {
      mangaData = await fetchMangaDex(urlOrId);
    }

    logState('MANGA', '✓', `Found "${mangaData.title}" (${(mangaData.chapters || []).length} chapters)`, colors.green);

    return res.json({
      status: 'success',
      manga: mangaData
    });
  } catch (err) {
    logState('MANGA', '✗', `${colors.red}Error fetching manga: ${err.message}${colors.reset}`, colors.red);
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * POST /api/manga/download-chapter
 * Download pages for a specific manga chapter
 */
app.post('/api/manga/download-chapter', upload.none(), async (req, res) => {
  try {
    const chapterId = req.body.chapter_id || '';
    if (!chapterId) {
      return res.status(400).json({ status: 'error', message: 'Missing chapter ID' });
    }

    logState('MANGA', '📥', `Downloading chapter ID: ${chapterId.slice(0, 32)}...`, colors.cyan);

    let pages;
    if (chapterId.startsWith('http://') || chapterId.startsWith('https://')) {
      pages = await downloadUniversalChapter(chapterId);
    } else {
      pages = await downloadMangaDexChapter(chapterId);
    }

    logState('MANGA', '✓', `Downloaded ${pages.length} pages for chapter ${chapterId.slice(0, 16)}...`, colors.green);

    return res.json({
      status: 'success',
      chapter_id: chapterId,
      pages
    });
  } catch (err) {
    logState('MANGA', '✗', `${colors.red}Error downloading chapter: ${err.message}${colors.reset}`, colors.red);
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * POST /api/manga/generate-zip
 * Create and download a ZIP archive from image data URLs
 */
app.post('/api/manga/generate-zip', upload.none(), async (req, res) => {
  try {
    const filesJson = req.body.files;
    if (!filesJson) {
      return res.status(400).json({ status: 'error', message: 'Missing file list' });
    }

    const filesData = JSON.parse(filesJson);
    const mangaTitle = req.body.manga_title || 'manga_download';
    const safeName = mangaTitle.replace(/[^\w\s\-().\u1780-\u17FF]/g, '_').replace(/\s+/g, ' ').trim() || 'manga_download';

    logState('ZIP', '📦', `Packing ZIP archive: "${safeName}.zip" (${filesData.length} images)...`, colors.yellow);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.zip"; filename*=UTF-8''${encodeURIComponent(safeName)}.zip`);

    const archiveStream = createZipStream(filesData);
    archiveStream.pipe(res);
  } catch (err) {
    logState('ZIP', '✗', `${colors.red}Error generating ZIP: ${err.message}${colors.reset}`, colors.red);
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * POST /api/manga/generate-docx
 * Generate and download a Word (.docx) document from Manga page images
 */
app.post('/api/manga/generate-docx', upload.none(), async (req, res) => {
  try {
    const filesJson = req.body.files;
    if (!filesJson) {
      return res.status(400).json({ status: 'error', message: 'Missing file list' });
    }

    const filesData = JSON.parse(filesJson);
    const mangaTitle = req.body.manga_title || 'manga_chapter';
    const safeName = mangaTitle.replace(/[^\w\s\-().\u1780-\u17FF]/g, '_').replace(/\s+/g, ' ').trim() || 'manga_chapter';

    logState('DOCX', '📝', `Compiling Manga Word document: "${safeName}.docx" (${filesData.length} pages)...`, colors.blue);

    const imageItems = filesData.map(f => {
      let b64 = f.dataUrl || '';
      if (b64.includes(',')) b64 = b64.split(',')[1];
      return {
        filename: f.name || 'page.png',
        buffer: Buffer.from(b64, 'base64')
      };
    });

    const ocrItemsStr = req.body.ocr_items || '[]';
    let ocrItems = [];
    try {
      ocrItems = JSON.parse(ocrItemsStr);
    } catch (e) {
      ocrItems = [];
    }

    const docxBuffer = await generateDocxWithKhmerScript(imageItems, ocrItems, mangaTitle);
    logState('DOCX', '✓', `Manga DOCX created (${(docxBuffer.length / 1024).toFixed(1)} KB)`, colors.green);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.docx"; filename*=UTF-8''${encodeURIComponent(safeName)}.docx`);
    return res.send(docxBuffer);
  } catch (err) {
    logState('DOCX', '✗', `${colors.red}Error generating Manga DOCX: ${err.message}${colors.reset}`, colors.red);
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * POST /api/generate-docx
 * Generate a Word (.docx) document from uploaded images or PDF with optional OCR transcript
 */
app.post('/api/generate-docx', upload.array('images'), async (req, res) => {
  try {
    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ status: 'error', message: 'No images uploaded' });
    }

    const ocrItemsStr = req.body.ocr_items || '[]';
    const ocrItems = JSON.parse(ocrItemsStr);
    const title = req.body.title || 'Document';

    logState('DOCX', '🎨', `Generating Word (.docx) with editable Khmer shapes: "${title}" (${files.length} uploaded file/pages, ${ocrItems.length} transcript items)`, colors.blue);

    let pageImages = [];
    const firstFile = files[0];
    const isDocx = files.length === 1 && (
      (firstFile.originalname && firstFile.originalname.toLowerCase().endsWith('.docx')) ||
      (firstFile.mimetype && firstFile.mimetype.includes('wordprocessingml')) ||
      (firstFile.buffer && firstFile.buffer.length > 4 && firstFile.buffer.slice(0, 2).toString() === 'PK')
    );
    const isPdf = !isDocx && files.length === 1 && (
      (firstFile.mimetype === 'application/pdf') ||
      (firstFile.originalname && firstFile.originalname.toLowerCase().endsWith('.pdf')) ||
      (firstFile.buffer && firstFile.buffer.length > 4 && firstFile.buffer.slice(0, 4).toString() === '%PDF')
    );

    if (isDocx) {
      const zip = await JSZip.loadAsync(firstFile.buffer);
      let orderedMediaFiles = [];

      const relsMap = {};
      const relsFile = zip.file('word/_rels/document.xml.rels');
      if (relsFile) {
        const relsXml = await relsFile.async('text');
        const relMatches = relsXml.matchAll(/<Relationship\s+[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g);
        for (const match of relMatches) {
          const id = match[1];
          let target = match[2];
          if (!target.toLowerCase().startsWith('word/')) {
            target = 'word/' + target.replace(/^\//, '');
          }
          relsMap[id] = target;
        }
      }

      const docFile = zip.file('word/document.xml');
      if (docFile) {
        const docXml = await docFile.async('text');
        const embedMatches = docXml.matchAll(/r:embed="([^"]+)"/g);
        for (const match of embedMatches) {
          const rId = match[1];
          const target = relsMap[rId];
          if (target && zip.files[target] && !orderedMediaFiles.includes(target)) {
            orderedMediaFiles.push(target);
          }
        }
      }

      if (orderedMediaFiles.length === 0) {
        orderedMediaFiles = Object.keys(zip.files).filter(f => f.toLowerCase().startsWith('word/media/') && !zip.files[f].dir);
        orderedMediaFiles.sort((a, b) => {
          const numA = parseInt((a.replace(/\D/g, '') || '0'), 10);
          const numB = parseInt((b.replace(/\D/g, '') || '0'), 10);
          return numA - numB;
        });
      }

      for (let i = 0; i < orderedMediaFiles.length; i++) {
        const file = zip.files[orderedMediaFiles[i]];
        if (!file) continue;
        const buf = await file.async('nodebuffer');
        pageImages.push({
          pageNum: i + 1,
          buffer: buf,
          name: file.name
        });
      }
    } else if (isPdf) {
      const rendered = await renderPdfPagesToImages(firstFile.buffer, 150);
      pageImages = rendered.map((p, idx) => ({
        pageNum: idx + 1,
        buffer: p.buffer,
        name: `page_${idx + 1}.jpg`
      }));
    } else {
      pageImages = files.map((f, idx) => ({
        pageNum: idx + 1,
        buffer: f.buffer,
        name: f.originalname
      }));
    }

    let docxBuffer;
    if (ocrItems.length > 0) {
      docxBuffer = await generateDocxWithKhmerScript(pageImages, ocrItems, title);
    } else {
      docxBuffer = await generateDocxFromImages(pageImages);
    }

    logState('DOCX', '✓', `Khmer Word document created (${(docxBuffer.length / 1024).toFixed(1)} KB)`, colors.green);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(title || 'document')}.docx"`);
    return res.send(docxBuffer);
  } catch (err) {
    logState('DOCX', '✗', `${colors.red}Error generating DOCX: ${err.message}${colors.reset}`, colors.red);
    return res.status(500).json({ status: 'error', message: err.message });
  }
});


/**
 * POST /api/apply-khmer-pdf
 * Apply Khmer translated text overlays directly into PDF speech bubbles
 */
app.post('/api/apply-khmer-pdf', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ status: 'error', message: 'Missing PDF file' });
    }

    const ocrItemsStr = req.body.ocr_items || '[]';
    const ocrItems = JSON.parse(ocrItemsStr);

    logState('OVERLAY', '🎨', `Applying Khmer speech bubbles overlay to PDF (${ocrItems.length} items)...`, colors.cyan);
    const startTime = Date.now();
    const finalPdfBuffer = await applyKhmerOverlayToPdf(req.file.buffer, ocrItems);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    logState('OVERLAY', '✨', `PDF overlay applied successfully (${duration}s, size: ${(finalPdfBuffer.length / (1024 * 1024)).toFixed(2)} MB)`, colors.green);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="manga_khmer_translated.pdf"');
    return res.send(finalPdfBuffer);
  } catch (err) {
    logState('OVERLAY', '✗', `${colors.red}Error applying Khmer text to PDF: ${err.message}${colors.reset}`, colors.red);
    return res.status(500).json({ status: 'error', message: err.message });
  }
});



// Global Error Handler (Always return JSON instead of HTML error pages)
app.use((err, req, res, next) => {
  logState('ERROR', '💥', `${colors.red}[Server Global Error]: ${err.message}${colors.reset}`, colors.red);
  return res.status(err.status || 500).json({
    status: 'error',
    message: err.message || 'Internal Server Error'
  });
});

// Start Express Server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n${colors.bright}${colors.green}====================================================${colors.reset}`);
    console.log(`  🚀 ${colors.bright}PDF Creator Server running on http://127.0.0.1:${PORT}${colors.reset}`);
    console.log(`  📊 Real-time User Activity & State Logging: ${colors.green}ACTIVE${colors.reset}`);
    console.log(`${colors.bright}${colors.green}====================================================${colors.reset}\n`);
  });
}

module.exports = app;
