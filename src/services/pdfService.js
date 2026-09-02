const { PDFDocument, rgb } = require('pdf-lib');
const sharp = require('sharp');
const { createCanvas, DOMMatrix, Path2D } = require('@napi-rs/canvas');
const path = require('path');
const { renderMangaPageKhmer } = require('./imageOverlayService');

// Polyfill globals for pdfjs-dist
if (typeof global.DOMMatrix === 'undefined' && typeof DOMMatrix !== 'undefined') {
  global.DOMMatrix = DOMMatrix;
}
if (typeof global.Path2D === 'undefined' && typeof Path2D !== 'undefined') {
  global.Path2D = Path2D;
}

// Lazy load pdfjs-dist
let pdfjsLib = null;
function getPdfJs() {
  if (!pdfjsLib) {
    try {
      pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
    } catch (e) {
      pdfjsLib = require('pdfjs-dist');
    }
  }
  return pdfjsLib;
}

// Canvas Factory for pdfjs rendering in Node.js
class NodeCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height)));
    const context = canvas.getContext('2d');
    return { canvas, context };
  }
  reset(canvasAndContext, width, height) {
    canvasAndContext.canvas.width = Math.max(1, Math.floor(width));
    canvasAndContext.canvas.height = Math.max(1, Math.floor(height));
  }
  destroy(canvasAndContext) {
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}

// Standard A4 dimensions in PDF points (72 DPI)
const A4_PORTRAIT = { width: 595.28, height: 841.89 };
const A4_LANDSCAPE = { width: 841.89, height: 595.28 };

/**
 * Generate a single PDF document from a list of uploaded images with ordering, rotation & resizing options.
 */
async function generatePdfFromImages(filesMap, metadata, pageSizeOption = 'original', quality = 90) {
  const pdfDoc = await PDFDocument.create();

  for (const item of metadata) {
    const filename = item.filename;
    const rotation = parseInt(item.rotation || 0, 10);
    const fileObj = filesMap[filename];
    if (!fileObj || !fileObj.buffer) continue;

    // Process image with sharp: rotate and normalize to JPEG
    let sharpInstance = sharp(fileObj.buffer);
    if (rotation !== 0) {
      sharpInstance = sharpInstance.rotate(rotation);
    }

    // Convert to RGB JPEG with specified quality
    const processedJpegBuffer = await sharpInstance
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .jpeg({ quality: Math.min(100, Math.max(10, quality)) })
      .toBuffer();

    const embeddedImage = await pdfDoc.embedJpg(processedJpegBuffer);
    const { width: imgW, height: imgH } = embeddedImage;

    if (pageSizeOption === 'original') {
      const page = pdfDoc.addPage([imgW, imgH]);
      page.drawImage(embeddedImage, {
        x: 0,
        y: 0,
        width: imgW,
        height: imgH
      });
    } else {
      const targetSize = pageSizeOption === 'a4-portrait' ? A4_PORTRAIT : A4_LANDSCAPE;
      const page = pdfDoc.addPage([targetSize.width, targetSize.height]);

      // Calculate scale to fit inside page while maintaining aspect ratio
      const scale = Math.min(targetSize.width / imgW, targetSize.height / imgH);
      const scaledW = imgW * scale;
      const scaledH = imgH * scale;
      const xOffset = (targetSize.width - scaledW) / 2;
      const yOffset = (targetSize.height - scaledH) / 2;

      page.drawImage(embeddedImage, {
        x: xOffset,
        y: yOffset,
        width: scaledW,
        height: scaledH
      });
    }
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

/**
 * Render PDF pages to PNG/JPEG image buffers & base64 data URLs with high performance
 */
async function renderPdfPagesToImages(pdfBuffer, dpi = 110) {
  const pdfjs = getPdfJs();
  const canvasFactory = new NodeCanvasFactory();

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(pdfBuffer),
    canvasFactory: canvasFactory,
    cMapUrl: path.join(__dirname, '../../node_modules/pdfjs-dist/cmaps/'),
    cMapPacked: true
  });

  const doc = await loadingTask.promise;
  const numPages = doc.numPages;
  const pages = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await doc.getPage(i);
    // Target optimal ~1100-1300px width for fast rendering and high OCR accuracy
    const rawViewport = page.getViewport({ scale: 1.0 });
    const targetScale = Math.min(2.0, Math.max(1.0, 1200 / (rawViewport.width || 800)));
    const viewport = page.getViewport({ scale: targetScale });

    const canvasAndContext = canvasFactory.create(viewport.width, viewport.height);
    const renderContext = {
      canvasContext: canvasAndContext.context,
      viewport: viewport,
      canvasFactory: canvasFactory
    };

    await page.render(renderContext).promise;
    const jpegBuffer = canvasAndContext.canvas.toBuffer('image/jpeg', { quality: 0.85 });
    const base64 = jpegBuffer.toString('base64');

    pages.push({
      pageNum: i,
      name: `page_${i}.jpg`,
      buffer: jpegBuffer,
      dataUrl: `data:image/jpeg;base64,${base64}`
    });

    canvasFactory.destroy(canvasAndContext);
  }

  return pages;
}

/**
 * Apply Khmer translated text overlays directly into PDF speech bubbles
 */
async function applyKhmerOverlayToPdf(pdfBuffer, ocrItems = []) {
  const renderedPages = await renderPdfPagesToImages(pdfBuffer, 120);
  const originalDoc = await PDFDocument.load(pdfBuffer);
  const outDoc = await PDFDocument.create();

  const totalPages = originalDoc.getPageCount();

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const pageNum = pageIdx + 1;
    const origPage = originalDoc.getPage(pageIdx);
    const { width: pWidth, height: pHeight } = origPage.getSize();

    const pageItems = ocrItems.filter(r => parseInt(r.pageNum, 10) === pageNum);

    if (pageItems.length > 0) {
      const pageImageObj = renderedPages.find(p => p.pageNum === pageNum);
      if (pageImageObj) {
        // Clean speech bubbles & overlay Khmer text onto rendered page image
        const translatedImgBuffer = await renderMangaPageKhmer(pageImageObj.buffer, pageItems);
        const embeddedImg = await outDoc.embedPng(translatedImgBuffer);

        const newPage = outDoc.addPage([pWidth, pHeight]);
        newPage.drawImage(embeddedImg, {
          x: 0,
          y: 0,
          width: pWidth,
          height: pHeight
        });
        continue;
      }
    }

    // Otherwise copy original page as-is
    const [copiedPage] = await outDoc.copyPages(originalDoc, [pageIdx]);
    outDoc.addPage(copiedPage);
  }

  const outBytes = await outDoc.save();
  return Buffer.from(outBytes);
}

module.exports = {
  generatePdfFromImages,
  renderPdfPagesToImages,
  applyKhmerOverlayToPdf
};
