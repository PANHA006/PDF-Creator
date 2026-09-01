require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const {
  generatePdfFromImages,
  renderPdfPagesToImages,
  exportTranslatedPdf
} = require('./src/services/pdfService');

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

// Serve static assets
app.use('/static', express.static(path.join(__dirname, 'static')));

// Serve index.html UI
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'templates', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
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
 * POST /api/scan-ocr-pdf & /api/manga-ocr-direct
 * Run Gemini Vision OCR & translation on PDF pages
 */
async function handleOcrScan(req, res, isMangaDirect = false) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing GEMINI_API_KEY. Please configure it in your .env file.'
      });
    }

    const langOption = req.body.lang || 'auto';
    const pagesOption = req.body.pages || 'all';

    if (!req.file) {
      return res.status(400).json({ status: 'error', message: 'Missing PDF file' });
    }

    const allPages = await renderPdfPagesToImages(req.file.buffer, 150);
    const totalPages = allPages.length;

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

    const ocrResults = [];
    const BATCH_SIZE = 5; // Scan 5 pages concurrently
    for (let i = 0; i < targetPageIndices.length; i += BATCH_SIZE) {
      const batchIndices = targetPageIndices.slice(i, i + BATCH_SIZE);
      const batchPromises = batchIndices.map(async pIdx => {
        const pageObj = allPages[pIdx];
        const pageNum = pIdx + 1;
        try {
          const pageResults = await scanOcrImage(apiKey, pageObj.buffer, pageNum, langOption, isMangaDirect);
          return { pageNum, results: pageResults || [] };
        } catch (pageErr) {
          console.error(`[handleOcrScan] Page ${pageNum} failed:`, pageErr.message);
          return { pageNum, results: [] };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      batchResults.sort((a, b) => a.pageNum - b.pageNum);
      for (const item of batchResults) {
        ocrResults.push(...item.results);
      }
    }

    return res.json({
      status: 'success',
      results: ocrResults
    });
  } catch (err) {
    console.error('Error in OCR scan:', err);
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
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(400).json({
        status: 'error',
        message: 'Missing GEMINI_API_KEY environment variable. Please configure it in your .env file.'
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
 * POST /api/export-translated-pdf
 * Export modified PDF with translated pages replaced
 */
app.post('/api/export-translated-pdf', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ status: 'error', message: 'Missing PDF file' });
    }

    const ocrItemsStr = req.body.ocr_items || '[]';
    const ocrItems = JSON.parse(ocrItemsStr);

    const finalPdfBuffer = await exportTranslatedPdf(req.file.buffer, ocrItems);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="manga_khmer_translated.pdf"');
    return res.send(finalPdfBuffer);
  } catch (err) {
    console.error('Error exporting PDF:', err);
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
