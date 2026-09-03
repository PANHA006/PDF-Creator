const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const axios = require('axios');
const FormData = require('form-data');
const JSZip = require('jszip');
const { generateDocxWithKhmerScript, generateDocxFromImages } = require('../src/services/docxService');

async function reviewAndTestDocx() {
  console.log('\n======================================================');
  console.log('   COMPREHENSIVE REVIEW & TEST: FULL BLEED DOCX EXPORT ');
  console.log('======================================================\n');

  // 1. Generate multi-page simulation with diverse dimensions (standard, tall webtoon strip, wide spread)
  const pageSpecs = [
    { name: 'cover.jpg', w: 800, h: 1200 },
    { name: 'webtoon_strip_1.jpg', w: 720, h: 1600 },
    { name: 'webtoon_strip_2.jpg', w: 720, h: 2200 },
    { name: 'double_spread.jpg', w: 1400, h: 1000 },
    { name: 'standard_page.jpg', w: 800, h: 1150 }
  ];

  console.log(`1. Generating ${pageSpecs.length} diverse test pages (Webtoon strips, spreads, standard)...`);
  const pageImages = [];
  for (let i = 0; i < pageSpecs.length; i++) {
    const spec = pageSpecs[i];
    const buf = await sharp({
      create: {
        width: spec.w,
        height: spec.h,
        channels: 3,
        background: { r: 35 + i * 15, g: 50 + i * 10, b: 80 + i * 12 }
      }
    }).jpeg({ quality: 90 }).toBuffer();

    pageImages.push({
      pageNum: i + 1,
      buffer: buf,
      name: spec.name
    });
  }

  const ocrItems = [
    {
      pageNum: 2,
      id: 'T1',
      lineText: 'Dragon Master Chapter 195',
      transText: 'មេបញ្ជាការនាគ ភាគ ១៩៥',
      box_2d: [100, 100, 200, 900]
    }
  ];

  console.log('2. Running generateDocxWithKhmerScript service...');
  const docxBuffer = await generateDocxWithKhmerScript(pageImages, ocrItems, 'Dragon_Master_Ch_195');
  console.log(`✓ Generated DOCX buffer size: ${docxBuffer.length} bytes`);

  if (!docxBuffer || docxBuffer.length < 5000) {
    throw new Error('Generated DOCX buffer is too small or invalid');
  }

  // 3. Inspect OpenXML ZIP structure
  console.log('\n3. Validating OpenXML Internal Archive Structure...');
  const zip = await JSZip.loadAsync(docxBuffer);
  const filesList = Object.keys(zip.files);
  console.log(`✓ Total archive files inside DOCX: ${filesList.length}`);

  const requiredFiles = [
    '[Content_Types].xml',
    '_rels/.rels',
    'word/_rels/document.xml.rels',
    'word/document.xml',
    'word/styles.xml',
    'word/settings.xml'
  ];

  for (const rf of requiredFiles) {
    if (!zip.files[rf]) {
      throw new Error(`Missing essential OpenXML file: ${rf}`);
    }
    console.log(`  ✓ Verified: ${rf}`);
  }

  // 4. Validate document.xml content
  const docXml = await zip.files['word/document.xml'].async('text');

  // Verify all sections exist
  const sectCount = (docXml.match(/<w:sectPr/g) || []).length;
  console.log(`✓ Section count in document.xml: ${sectCount} (Expected: ${pageSpecs.length})`);
  if (sectCount !== pageSpecs.length) {
    throw new Error(`Section count mismatch: expected ${pageSpecs.length}, got ${sectCount}`);
  }

  // Verify Zero Margins are set on every section
  const zeroMarCount = (docXml.match(/w:top="0" w:right="0" w:bottom="0" w:left="0"/g) || []).length;
  console.log(`✓ Zero margin sections verified: ${zeroMarCount}/${pageSpecs.length}`);
  if (zeroMarCount !== pageSpecs.length) {
    throw new Error('Not all sections have zero margins');
  }

  // Verify Exact Line Spacing rule is present (prevents page overflow)
  const lineExactCount = (docXml.match(/w:lineRule="exactly"/g) || []).length;
  console.log(`✓ Exact line spacing rules verified: ${lineExactCount}/${pageSpecs.length}`);
  if (lineExactCount !== pageSpecs.length) {
    throw new Error('Not all paragraphs have exact line rules');
  }

  // 5. Test Express HTTP API Endpoint
  console.log('\n4. Testing Express HTTP API Endpoint POST /api/manga/generate-docx...');
  const BASE_URL = 'http://127.0.0.1:5000';

  const clientPagesData = pageImages.map(p => ({
    name: p.name,
    dataUrl: `data:image/jpeg;base64,${p.buffer.toString('base64')}`
  }));

  const formData = new FormData();
  formData.append('files', JSON.stringify(clientPagesData));
  formData.append('manga_title', 'Dragon Master - Ch 195');

  const apiRes = await axios.post(`${BASE_URL}/api/manga/generate-docx`, formData, {
    headers: formData.getHeaders(),
    responseType: 'arraybuffer',
    timeout: 15000
  });

  console.log(`✓ API Status: ${apiRes.status}`);
  console.log(`✓ API Content-Type: ${apiRes.headers['content-type']}`);
  console.log(`✓ API Content-Disposition: ${apiRes.headers['content-disposition']}`);
  console.log(`✓ Downloaded DOCX size from API: ${apiRes.data.length} bytes`);

  if (apiRes.status !== 200 || apiRes.data.length === 0) {
    throw new Error('POST /api/manga/generate-docx API failed');
  }

  console.log('\n======================================================');
  console.log('  🎉 ALL DOCX VALIDATION & API TESTS PASSED 100%!     ');
  console.log('======================================================\n');
}

reviewAndTestDocx().catch(err => {
  console.error('\n❌ REVIEW & TEST FAILED:', err);
  process.exit(1);
});
