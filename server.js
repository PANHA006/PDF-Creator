require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

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
    const filesMap = {};
    for (const f of files) {
      filesMap[f.originalname] = f;
    }

    const pdfBuffer = await generatePdfFromImages(filesMap, metadata, pageSizeOption, quality);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="generated.pdf"');
    return res.send(pdfBuffer);
  } catch (err) {
    console.error('Error generating PDF:', err);
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

    const pages = await renderPdfPagesToImages(req.file.buffer, 150);
    const pagesList = pages.map(p => ({
      name: p.name,
      dataUrl: p.dataUrl
    }));

    return res.json({
      status: 'success',
      pages: pagesList
    });
  } catch (err) {
    console.error('Error parsing PDF:', err);
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
      console.warn('\x1b[31m[OCR Scan] Failed: Missing GEMINI_API_KEY\x1b[0m');
      return res.status(400).json({
        status: 'error',
        message: 'មិនទាន់មាន Gemini API Key នៅឡើយទេ។ សូមបញ្ចូល Gemini API Key របស់អ្នកនៅក្នុងផ្ទាំង Settings ឬក្នុងឯកសារ .env។ (Missing GEMINI_API_KEY)'
      });
    }

    const langOption = req.body.lang || 'auto';
    const pagesOption = req.body.pages || 'all';

    if (!req.file) {
      console.warn('\x1b[31m[OCR Scan] Failed: Missing PDF file\x1b[0m');
      return res.status(400).json({ status: 'error', message: 'Missing PDF file' });
    }

    const fileName = req.file.originalname || 'document.pdf';
    console.log('\n\x1b[36m' + '='.repeat(68) + '\x1b[0m');
    console.log(`⚡ \x1b[1m\x1b[33m[START SCAN & TRANSLATE]\x1b[0m ${new Date().toLocaleTimeString()}`);
    console.log(`📄 File: \x1b[32m${fileName}\x1b[0m (${(req.file.size / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`🌐 Language: \x1b[35m${langOption}\x1b[0m | Target Pages: \x1b[36m${pagesOption}\x1b[0m | Mode: \x1b[34m${isMangaDirect ? 'Manga Direct' : 'Document PDF'}\x1b[0m`);
    console.log('🔄 Rendering PDF pages to Vision images (150 DPI)...');

    const renderStartTime = Date.now();
    const allPages = await renderPdfPagesToImages(req.file.buffer, 150);
    const totalPages = allPages.length;
    console.log(`✓ Rendered \x1b[32m${totalPages}\x1b[0m PDF page(s) in \x1b[33m${((Date.now() - renderStartTime) / 1000).toFixed(2)}s\x1b[0m`);

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

    console.log(`🎯 Pages to scan: \x1b[33m[${targetPageIndices.map(i => i + 1).join(', ')}]\x1b[0m (Total: ${targetPageIndices.length})`);
    console.log('\x1b[36m' + '-'.repeat(68) + '\x1b[0m');

    const ocrResults = [];
    const BATCH_SIZE = 3; // Scan 3 pages concurrently for optimal throughput without API timeout
    const totalBatches = Math.ceil(targetPageIndices.length / BATCH_SIZE);

    for (let i = 0; i < targetPageIndices.length; i += BATCH_SIZE) {
      const currentBatchNum = Math.floor(i / BATCH_SIZE) + 1;
      const batchIndices = targetPageIndices.slice(i, i + BATCH_SIZE);
      const batchPageNums = batchIndices.map(idx => idx + 1);

      console.log(`🚀 [Batch ${currentBatchNum}/${totalBatches}] Processing Page(s): \x1b[36m[${batchPageNums.join(', ')}]\x1b[0m`);

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
          console.error(`\x1b[31m   ✗ [Page ${pageNum}] OCR Error: ${pageErr.message}\x1b[0m`);
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
    console.log('\x1b[36m' + '-'.repeat(68) + '\x1b[0m');
    console.log(`🎉 \x1b[1m\x1b[32m[SCAN & TRANSLATE COMPLETE]\x1b[0m`);
    console.log(`📊 Scanned Pages: \x1b[32m${targetPageIndices.length}\x1b[0m | Total Dialogues Extracted: \x1b[33m${ocrResults.length}\x1b[0m`);
    console.log(`⏱️ Total Time Elapsed: \x1b[32m${totalDuration}s\x1b[0m`);
    console.log('\x1b[36m' + '='.repeat(68) + '\x1b[0m\n');

    return res.json({
      status: 'success',
      results: ocrResults
    });
  } catch (err) {
    const errorDuration = ((Date.now() - scanStartTime) / 1000).toFixed(2);
    console.error(`\x1b[31m[OCR Scan Error in ${errorDuration}s]:\x1b[0m`, err.message);
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

    const allPages = await renderPdfPagesToImages(req.file.buffer, 150);
    if (pageNum < 1 || pageNum > allPages.length) {
      return res.status(400).json({
        status: 'error',
        message: `Page number ${pageNum} is out of bounds (1-${allPages.length})`
      });
    }

    const targetPage = allPages[pageNum - 1];
    const updateResults = await aiReview(apiKey, targetPage.buffer, ocrItems, pageNum);

    return res.json({
      status: 'success',
      results: updateResults
    });
  } catch (err) {
    console.error('Error in AI review:', err);
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

    const isWebUrl = urlOrId.startsWith('http://') || urlOrId.startsWith('https://');
    const isMangaDex = urlOrId.includes('mangadex.org');

    if (isWebUrl && !isMangaDex) {
      const mangaData = await fetchUniversalManga(urlOrId);
      return res.json({
        status: 'success',
        manga: mangaData
      });
    }

    const mangaData = await fetchMangaDex(urlOrId);
    return res.json({
      status: 'success',
      manga: mangaData
    });
  } catch (err) {
    console.error('Error fetching manga:', err);
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

    if (chapterId.startsWith('http://') || chapterId.startsWith('https://')) {
      const pages = await downloadUniversalChapter(chapterId);
      return res.json({
        status: 'success',
        chapter_id: chapterId,
        pages
      });
    }

    const pages = await downloadMangaDexChapter(chapterId);
    return res.json({
      status: 'success',
      chapter_id: chapterId,
      pages
    });
  } catch (err) {
    console.error('Error downloading chapter:', err);
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
    const safeName = mangaTitle.replace(/[^a-zA-Z0-9_\-]/g, '_').replace(/_+/g, '_') || 'manga_download';

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.zip"`);

    const archiveStream = createZipStream(filesData);
    archiveStream.pipe(res);
  } catch (err) {
    console.error('Error generating ZIP:', err);
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
    const safeName = mangaTitle.replace(/[^a-zA-Z0-9_\-\u1780-\u17FF]/g, '_').replace(/_+/g, '_') || 'manga_chapter';

    const imageItems = filesData.map(f => {
      let b64 = f.dataUrl || '';
      if (b64.includes(',')) b64 = b64.split(',')[1];
      return {
        filename: f.name || 'page.png',
        buffer: Buffer.from(b64, 'base64')
      };
    });

    const docxBuffer = await generateDocxFromImages(imageItems);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.docx"`);
    return res.send(docxBuffer);
  } catch (err) {
    console.error('Error generating Manga DOCX:', err);
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

    let pageImages = [];
    if (files.length === 1 && (files[0].mimetype === 'application/pdf' || files[0].originalname.endsWith('.pdf') || files[0].buffer.slice(0, 4).toString() === '%PDF')) {
      const rendered = await renderPdfPagesToImages(files[0].buffer, 150);
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

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename="document.docx"');
    return res.send(docxBuffer);
  } catch (err) {
    console.error('Error generating DOCX:', err);
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

/**
 * POST /api/render-translated-page
 * Render translated Khmer speech bubbles onto a page image for live preview
 */
app.post('/api/render-translated-page', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ status: 'error', message: 'Missing PDF file' });
    }

    const pageNum = parseInt(req.body.pageNum || '1', 10);
    const ocrItemsStr = req.body.ocr_items || '[]';
    const ocrItems = JSON.parse(ocrItemsStr);

    const allPages = await renderPdfPagesToImages(req.file.buffer, 150);
    if (pageNum < 1 || pageNum > allPages.length) {
      return res.status(400).json({ status: 'error', message: `Invalid page number ${pageNum}` });
    }

    const origPage = allPages[pageNum - 1];
    const renderedPngBuffer = await renderMangaPageKhmer(origPage.buffer, ocrItems);
    const base64Str = renderedPngBuffer.toString('base64');

    return res.json({
      status: 'success',
      pageNum,
      dataUrl: `data:image/png;base64,${base64Str}`
    });
  } catch (err) {
    console.error('Error rendering translated page:', err);
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

    console.log(`\x1b[35m🎨 [APPLY KHMER OVERLAY] Processing ${ocrItems.length} translated items onto PDF...\x1b[0m`);
    const startTime = Date.now();
    const finalPdfBuffer = await applyKhmerOverlayToPdf(req.file.buffer, ocrItems);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\x1b[32m✨ [APPLY KHMER OVERLAY] PDF created successfully (${duration}s, size: ${(finalPdfBuffer.length / (1024 * 1024)).toFixed(2)} MB)\x1b[0m`);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="manga_khmer_translated.pdf"');
    return res.send(finalPdfBuffer);
  } catch (err) {
    console.error('Error applying Khmer text to PDF:', err);
    return res.status(500).json({ status: 'error', message: err.message });
  }
});



// Global Error Handler (Always return JSON instead of HTML error pages)
app.use((err, req, res, next) => {
  console.error('[Server Global Error]:', err);
  return res.status(err.status || 500).json({
    status: 'error',
    message: err.message || 'Internal Server Error'
  });
});

// Start Express Server
app.listen(PORT, () => {
  console.log(`PDF Creator Node.js Server is running on http://127.0.0.1:${PORT}`);
});
