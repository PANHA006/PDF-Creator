const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const axios = require('axios');
const FormData = require('form-data');
const JSZip = require('jszip');
const { generateDocxWithKhmerScript } = require('../src/services/docxService');

async function reviewAndTestDirectDocxPreview() {
  console.log('\n================================================================');
  console.log('   REVIEW & TEST: DIRECT DOCX PREVIEW & CLEAN ARCHITECTURE      ');
  console.log('================================================================\n');

  // 1. Verify HTML template cleanliness
  console.log('1. Validating index.html template...');
  const htmlContent = fs.readFileSync(path.join(__dirname, '../templates/index.html'), 'utf8');

  if (htmlContent.includes('id="word-editor-ribbon"')) {
    throw new Error('Obsolete word-editor-ribbon still found in index.html');
  }
  console.log('✓ Verified: Obsolete word-editor-ribbon successfully removed from index.html');

  if (!htmlContent.includes('jszip.min.js')) {
    throw new Error('JSZip script missing from index.html head');
  }
  console.log('✓ Verified: JSZip script tag included in index.html head');

  if (!htmlContent.includes('DOCX Preview')) {
    throw new Error('DOCX Preview badge text missing');
  }
  console.log('✓ Verified: DOCX Preview badge configured');

  // 2. Test Direct DOCX Creation & Client-Side Extraction Simulation
  console.log('\n2. Generating DOCX file and testing direct client-side extraction...');
  const testImages = [];
  for (let i = 0; i < 4; i++) {
    const buf = await sharp({
      create: {
        width: 720,
        height: 1280 + i * 200,
        channels: 3,
        background: { r: 60 + i * 20, g: 80 + i * 10, b: 120 + i * 5 }
      }
    }).jpeg({ quality: 90 }).toBuffer();

    testImages.push({
      pageNum: i + 1,
      buffer: buf,
      name: `chapter_page_${i + 1}.jpg`
    });
  }

  const docxBuffer = await generateDocxWithKhmerScript(testImages, [], 'Direct_Preview_Test');
  console.log(`✓ Generated DOCX buffer size: ${docxBuffer.length} bytes`);

  // Emulate JSZip extraction exactly as done in client-side main.js
  const startTime = Date.now();
  const zip = await JSZip.loadAsync(docxBuffer);
  const mediaFiles = Object.keys(zip.files).filter(f => f.startsWith('word/media/') && !zip.files[f].dir);
  mediaFiles.sort((a, b) => {
    const numA = parseInt((a.match(/\d+/) || [0])[0], 10);
    const numB = parseInt((b.match(/\d+/) || [0])[0], 10);
    return numA - numB;
  });

  const extractedPages = [];
  for (let i = 0; i < mediaFiles.length; i++) {
    const file = zip.files[mediaFiles[i]];
    const b64 = await file.async('base64');
    extractedPages.push({
      pageNum: i + 1,
      name: file.name,
      dataUrlLength: b64.length
    });
  }
  const extractionDuration = Date.now() - startTime;

  console.log(`✓ Direct extraction completed in ${extractionDuration}ms (Zero Server Latency)`);
  console.log(`✓ Extracted pages count: ${extractedPages.length} (Expected: ${testImages.length})`);
  if (extractedPages.length !== testImages.length) {
    throw new Error('Extracted pages count does not match input images count');
  }

  // 3. Test HTTP API Endpoints
  console.log('\n3. Testing Express HTTP API POST /api/manga/generate-docx...');
  const BASE_URL = 'http://127.0.0.1:5000';

  const clientPagesData = testImages.map(p => ({
    name: p.name,
    dataUrl: `data:image/jpeg;base64,${p.buffer.toString('base64')}`
  }));

  const formData = new FormData();
  formData.append('files', JSON.stringify(clientPagesData));
  formData.append('manga_title', 'Direct_Preview_Chapter');

  const apiRes = await axios.post(`${BASE_URL}/api/manga/generate-docx`, formData, {
    headers: formData.getHeaders(),
    responseType: 'arraybuffer',
    timeout: 15000
  });

  console.log(`✓ API Status: ${apiRes.status}`);
  console.log(`✓ API Content-Type: ${apiRes.headers['content-type']}`);
  console.log(`✓ Downloaded DOCX size from API: ${apiRes.data.length} bytes`);

  if (apiRes.status !== 200 || apiRes.data.length === 0) {
    throw new Error('API request failed');
  }

  console.log('\n================================================================');
  console.log('  🎉 ALL DIRECT DOCX PREVIEW & CLEANUP TESTS PASSED 100%!       ');
  console.log('================================================================\n');
}

reviewAndTestDirectDocxPreview().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
