const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const axios = require('axios');
const FormData = require('form-data');
const JSZip = require('jszip');
const { generateDocxWithKhmerScript } = require('../src/services/docxService');

async function reviewUniformWidth350Docx() {
  console.log('\n================================================================');
  console.log('   REVIEW & TEST: UNIFORM WIDTH (350px) & NO SLICING DOCX EXPORT ');
  console.log('================================================================\n');

  // 1. Create test pages including a tall webtoon image
  const testPageConfigs = [
    { name: 'cover.jpg', origW: 600, origH: 900 },
    { name: 'large_hd.jpg', origW: 1600, origH: 2400 },
    { name: 'webtoon_action.jpg', origW: 720, origH: 2600 },
    { name: 'square_panel.jpg', origW: 1000, origH: 1000 },
    { name: 'wide_scene.jpg', origW: 1400, origH: 800 }
  ];

  console.log(`1. Generating ${testPageConfigs.length} diverse images...`);
  const pageImages = [];
  for (let i = 0; i < testPageConfigs.length; i++) {
    const cfg = testPageConfigs[i];
    const buf = await sharp({
      create: {
        width: cfg.origW,
        height: cfg.origH,
        channels: 3,
        background: { r: 45 + i * 15, g: 65 + i * 12, b: 95 + i * 8 }
      }
    }).jpeg({ quality: 90 }).toBuffer();

    pageImages.push({
      pageNum: i + 1,
      buffer: buf,
      name: cfg.name
    });
  }

  const ocrItems = [
    {
      pageNum: 3,
      id: 'T1',
      lineText: 'I LIKE THIS!',
      transText: 'ខ្ញុំចូលចិត្តបែបនេះ!',
      box_2d: [150, 100, 300, 800]
    }
  ];

  console.log('2. Generating DOCX with generateDocxWithKhmerScript...');
  const docxBuffer = await generateDocxWithKhmerScript(pageImages, ocrItems, 'Uniform_350_Manga');
  console.log(`✓ Generated DOCX buffer size: ${docxBuffer.length} bytes`);

  if (!docxBuffer || docxBuffer.length < 5000) {
    throw new Error('Generated DOCX buffer is invalid');
  }

  // 3. Inspect OpenXML document.xml
  console.log('\n3. Validating OpenXML Section Widths (Expected: 5,250 Twips / 350px)...');
  const zip = await JSZip.loadAsync(docxBuffer);
  const docXml = await zip.files['word/document.xml'].async('text');

  const pgSzMatches = Array.from(docXml.matchAll(/<w:pgSz\s+w:w="(\d+)"\s+w:h="(\d+)"/g));
  console.log(`✓ Total pages in document.xml: ${pgSzMatches.length} (Expected: exactly ${testPageConfigs.length} - NO CUTTING)`);

  if (pgSzMatches.length !== testPageConfigs.length) {
    throw new Error(`Expected exactly ${testPageConfigs.length} intact pages, but found ${pgSzMatches.length}`);
  }

  const UNIFIED_WIDTH_TWIPS = 5250; // 350px * 15 twips
  pgSzMatches.forEach((match, idx) => {
    const wTwips = parseInt(match[1], 10);
    const hTwips = parseInt(match[2], 10);
    const cfg = testPageConfigs[idx];

    console.log(`  • Page ${idx + 1} (${cfg.name}): Width = ${wTwips} twips | Height = ${hTwips} twips`);

    if (wTwips !== UNIFIED_WIDTH_TWIPS) {
      throw new Error(`Page ${idx + 1} width mismatch! Expected: ${UNIFIED_WIDTH_TWIPS}, Got: ${wTwips}`);
    }

    if (hTwips > 31020) {
      throw new Error(`Page ${idx + 1} height exceeds Word limit!`);
    }
  });

  console.log('✓ Verified: ALL pages have the EXACT SAME uniform width (5,250 Twips / 350px)!');
  console.log('✓ Verified: NO IMAGES WERE CUT/SLICED! Whole images remain 100% intact on single pages!');

  // 4. Test HTTP API Endpoint
  console.log('\n4. Testing Express HTTP API Endpoint POST /api/manga/generate-docx...');
  const BASE_URL = 'http://127.0.0.1:5000';

  const clientPagesData = pageImages.map(p => ({
    name: p.name,
    dataUrl: `data:image/jpeg;base64,${p.buffer.toString('base64')}`
  }));

  const formData = new FormData();
  formData.append('files', JSON.stringify(clientPagesData));
  formData.append('manga_title', 'Uniform_350_Test');

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
  console.log('  🎉 ALL 350PX UNIFORM-WIDTH & NO-CUTTING TESTS PASSED 100%!   ');
  console.log('================================================================\n');
}

reviewUniformWidth350Docx().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
