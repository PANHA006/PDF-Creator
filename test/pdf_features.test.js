const sharp = require('sharp');
const { generatePdfFromImages, renderPdfPagesToImages } = require('../src/services/pdfService');
const { renderMangaPageKhmer, registeredKhmerFont } = require('../src/services/imageOverlayService');

async function runPdfTests() {
  console.log('\n--- [TEST SUITE 1] PDF & Image Processing Features ---');

  // 1. Test Image to PDF generation with multiple options
  const img1 = await sharp({
    create: { width: 300, height: 400, channels: 3, background: { r: 59, g: 130, b: 246 } }
  }).jpeg().toBuffer();

  const img2 = await sharp({
    create: { width: 400, height: 300, channels: 3, background: { r: 16, g: 185, b: 129 } }
  }).jpeg().toBuffer();

  const filesMap = {
    'page1.jpg': { originalname: 'page1.jpg', buffer: img1 },
    'page2.jpg': { originalname: 'page2.jpg', buffer: img2 }
  };

  const metadata = [
    { filename: 'page1.jpg', rotation: 90 },
    { filename: 'page2.jpg', rotation: 0 }
  ];

  // A4 Portrait
  const pdfPortrait = await generatePdfFromImages(filesMap, metadata, 'a4-portrait', 85);
  console.log('✓ generatePdfFromImages (A4 Portrait):', pdfPortrait.length, 'bytes');

  // A4 Landscape
  const pdfLandscape = await generatePdfFromImages(filesMap, metadata, 'a4-landscape', 85);
  console.log('✓ generatePdfFromImages (A4 Landscape):', pdfLandscape.length, 'bytes');

  // Original Size
  const pdfOriginal = await generatePdfFromImages(filesMap, metadata, 'original', 90);
  console.log('✓ generatePdfFromImages (Original Size):', pdfOriginal.length, 'bytes');

  // 2. Test PDF to Image Rendering
  const renderedPages = await renderPdfPagesToImages(pdfPortrait, 150);
  console.log('✓ renderPdfPagesToImages page count:', renderedPages.length);
  if (renderedPages.length !== 2) {
    throw new Error(`Expected 2 rendered pages, got ${renderedPages.length}`);
  }
  console.log('✓ Page 1 data URL prefix:', renderedPages[0].dataUrl.slice(0, 35));

  // 3. Test Khmer Font Text Overlay
  console.log('✓ Registered Khmer Font Family:', registeredKhmerFont);
  const ocrItems = [
    {
      id: 'L1-1',
      lineText: 'Greetings',
      transText: 'សូមស្វាគមន៍មកកាន់ PDF Creator',
      x_pct: 50,
      y_pct: 30,
      fontSize: 16
    },
    {
      id: 'L1-2',
      lineText: 'How are you?',
      transText: 'តើអ្នកសុខសប្បាយជាទេ?',
      position: 'bottom-center',
      fontSize: 14
    }
  ];

  const overlaidPng = await renderMangaPageKhmer(renderedPages[0].buffer, ocrItems);
  console.log('✓ renderMangaPageKhmer output size:', overlaidPng.length, 'bytes');

  console.log('✓ [TEST SUITE 1] ALL PDF & IMAGE FEATURES PASSED!\n');
}

module.exports = { runPdfTests };

if (require.main === module) {
  runPdfTests().catch(err => {
    console.error('PDF test failed:', err);
    process.exit(1);
  });
}
