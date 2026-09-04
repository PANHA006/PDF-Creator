const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const axios = require('axios');
const FormData = require('form-data');
const { generateDocxWithKhmerScript } = require('../src/services/docxService');

async function testDocxDirectConversion() {
  console.log('\n================================================================');
  console.log('   TESTING: POST /api/generate-docx WITH DIRECT .DOCX FILE INPUT ');
  console.log('================================================================\n');

  // 1. Create a dummy test DOCX file
  const testImages = [];
  for (let i = 0; i < 2; i++) {
    const buf = await sharp({
      create: { width: 500, height: 750, channels: 3, background: { r: 60, g: 100, b: 150 } }
    }).jpeg().toBuffer();
    testImages.push({ pageNum: i + 1, buffer: buf, name: `page_${i + 1}.jpg` });
  }

  const initialDocx = await generateDocxWithKhmerScript(testImages, [], 'Initial_Chapter');
  console.log(`✓ Initial DOCX created: ${initialDocx.length} bytes`);

  // 2. Post the DOCX file to /api/generate-docx with translated transcript
  const sampleOcr = [
    {
      pageNum: 1,
      id: 'L1-1',
      lineText: 'CAN YOU BELIEVE IT?',
      transText: 'តើឯងអាចធ្វើ\nបានទេ?',
      box_2d: [150, 100, 320, 600]
    }
  ];

  const formData = new FormData();
  formData.append('images', initialDocx, {
    filename: 'My Disciples Are All Big Villains - Ch 43.docx',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  });
  formData.append('ocr_items', JSON.stringify(sampleOcr));
  formData.append('title', 'My Disciples Are All Big Villains - Ch 43 - Khmer Translated');

  const BASE_URL = 'http://127.0.0.1:5000';
  const res = await axios.post(`${BASE_URL}/api/generate-docx`, formData, {
    headers: formData.getHeaders(),
    responseType: 'arraybuffer',
    timeout: 20000
  });

  console.log(`✓ Response status: ${res.status}`);
  console.log(`✓ Response content-type: ${res.headers['content-type']}`);
  console.log(`✓ Generated Khmer DOCX size: ${res.data.length} bytes`);

  if (res.status === 200 && res.data.length > 5000) {
    console.log('\n================================================================');
    console.log('  🎉 DIRECT .DOCX TO KHMER DOCX GENERATION PASSED 100%!         ');
    console.log('================================================================\n');
  } else {
    throw new Error('Unexpected response status or empty output');
  }
}

testDocxDirectConversion().catch(err => {
  console.error('\n❌ TEST FAILED:', err.message);
  process.exit(1);
});
