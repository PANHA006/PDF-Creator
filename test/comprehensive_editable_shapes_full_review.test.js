const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const axios = require('axios');
const FormData = require('form-data');
const JSZip = require('jszip');
const { generateDocxWithKhmerScript } = require('../src/services/docxService');

async function comprehensiveReviewAndTest() {
  console.log('\n================================================================');
  console.log('   COMPREHENSIVE REVIEW & TEST: EDITABLE KHMER SHAPES IN DOCX   ');
  console.log('================================================================\n');

  // 1. Generate 3 test pages with multi-line dialogues
  console.log('1. Preparing 3 test manga pages with Khmer dialogue bubbles...');
  const testImages = [];
  for (let i = 0; i < 3; i++) {
    const buf = await sharp({
      create: {
        width: 720,
        height: 1100 + i * 150,
        channels: 3,
        background: { r: 40 + i * 30, g: 70 + i * 20, b: 110 + i * 20 }
      }
    }).jpeg({ quality: 90 }).toBuffer();

    testImages.push({
      pageNum: i + 1,
      buffer: buf,
      name: `ch_page_${i + 1}.jpg`
    });
  }

  const sampleOcrItems = [
    {
      pageNum: 1,
      id: 'L1-1',
      lineText: 'CAN YOU BELIEVE IT?',
      transText: 'តើឯងអាចធ្វើ\nបានទេ?',
      box_2d: [150, 100, 320, 600]
    },
    {
      pageNum: 1,
      id: 'L1-2',
      lineText: 'HM?',
      transText: 'ហឹម?',
      box_2d: [550, 650, 700, 850]
    },
    {
      pageNum: 2,
      id: 'L2-1',
      lineText: 'THE CLOUD SECT HAS ALL DIED!',
      transText: 'និកាយពពកត្រូវបានកម្ទេចអស់ហើយ!',
      box_2d: [200, 150, 420, 850]
    },
    {
      pageNum: 3,
      id: 'L3-1',
      lineText: 'YOU ARE WRONG!',
      transText: 'ឯងគិតខុសហើយ!',
      box_2d: [350, 200, 500, 750]
    }
  ];

  // 2. Generate DOCX with Editable Khmer Shapes
  console.log('2. Generating DOCX with native DrawingML Editable Shapes...');
  const docxBuffer = await generateDocxWithKhmerScript(testImages, sampleOcrItems, 'Manga_Full_Review');
  console.log(`✓ Generated DOCX buffer size: ${docxBuffer.length} bytes`);

  // 3. Deep OpenXML Inspection & Property Verification
  console.log('\n3. Inspecting OpenXML document.xml architecture...');
  const zip = await JSZip.loadAsync(docxBuffer);
  const docXml = await zip.file('word/document.xml').async('text');

  // Verify Font Family
  const fontMatches = docXml.match(/w:ascii="Khmer OS Battambang"/g) || [];
  console.log(`✓ Verified: "Khmer OS Battambang" font matches count = ${fontMatches.length}`);
  if (fontMatches.length === 0) throw new Error('Missing Khmer OS Battambang font');

  // Verify Font Size = 9pt (18 half-points)
  const sizeMatches = docXml.match(/w:sz w:val="18"/g) || [];
  console.log(`✓ Verified: Size 9pt (18 half-points) matches count = ${sizeMatches.length}`);
  if (sizeMatches.length === 0) throw new Error('Missing font size 9pt');

  // Verify Center Alignment
  const alignMatches = docXml.match(/w:jc w:val="center"/g) || [];
  console.log(`✓ Verified: Center text alignment matches count = ${alignMatches.length}`);
  if (alignMatches.length === 0) throw new Error('Missing center alignment');

  // Verify White Paragraph Shading
  const shdMatches = docXml.match(/w:fill="FFFFFF"/g) || [];
  console.log(`✓ Verified: White paragraph shading (w:shd fill="FFFFFF") count = ${shdMatches.length}`);
  if (shdMatches.length === 0) throw new Error('Missing white paragraph shading');

  // Verify Shape Fill = None and Shape Outline = None
  const noFillMatches = docXml.match(/<a:noFill\/>/g) || [];
  console.log(`✓ Verified: Shape Fill & Outline = None (<a:noFill/>) count = ${noFillMatches.length}`);
  if (noFillMatches.length === 0) throw new Error('Missing <a:noFill/> in shape properties');

  // Verify Anchor DrawingML structure
  const anchorMatches = docXml.match(/<wp:anchor /g) || [];
  console.log(`✓ Verified: Floating DrawingML Anchors count = ${anchorMatches.length} (Expected: ${sampleOcrItems.length})`);
  if (anchorMatches.length !== sampleOcrItems.length) {
    throw new Error(`Expected ${sampleOcrItems.length} anchor shapes, got ${anchorMatches.length}`);
  }

  // 4. Test HTTP API POST /api/generate-docx with FormData
  console.log('\n4. Testing Express HTTP API POST /api/generate-docx...');
  const BASE_URL = 'http://127.0.0.1:5000';

  const formData = new FormData();
  testImages.forEach((img, idx) => {
    formData.append('images', img.buffer, { filename: img.name, contentType: 'image/jpeg' });
  });
  formData.append('ocr_items', JSON.stringify(sampleOcrItems));
  formData.append('title', 'API_DOCX_Test');

  const apiRes = await axios.post(`${BASE_URL}/api/generate-docx`, formData, {
    headers: formData.getHeaders(),
    responseType: 'arraybuffer',
    timeout: 20000
  });

  console.log(`✓ API Status: ${apiRes.status}`);
  console.log(`✓ API Content-Type: ${apiRes.headers['content-type']}`);
  console.log(`✓ Downloaded DOCX size: ${apiRes.data.length} bytes`);

  // Verify downloaded API docx also has the editable shapes
  const apiZip = await JSZip.loadAsync(apiRes.data);
  const apiDocXml = await apiZip.file('word/document.xml').async('text');
  if (!apiDocXml.includes('Khmer OS Battambang') || !apiDocXml.includes('w:fill="FFFFFF"')) {
    throw new Error('API output missing required shape formatting');
  }
  console.log('✓ Verified: API generated DOCX contains all editable shapes & typography');

  console.log('\n================================================================');
  console.log('  🎉 100% COMPREHENSIVE REVIEW & TESTS PASSED SUCCESSFULLY!     ');
  console.log('================================================================\n');
}

comprehensiveReviewAndTest().catch(err => {
  console.error('\n❌ TEST FAILED:', err.message);
  process.exit(1);
});
