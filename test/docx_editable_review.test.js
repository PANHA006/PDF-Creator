const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const axios = require('axios');
const FormData = require('form-data');
const { generateDocxWithKhmerScript, generateDocxFromImages } = require('../src/services/docxService');

async function testDocxGenerationAndStructure() {
  console.log('\n======================================================');
  console.log('   REVIEW & TEST: EDITABLE WORD SHAPE DOCX EXPORT    ');
  console.log('======================================================\n');

  // 1. Create a realistic sample Manga page image
  const sampleMangaImg = await sharp({
    create: {
      width: 800,
      height: 1200,
      channels: 3,
      background: { r: 30, g: 41, b: 59 }
    }
  }).jpeg().toBuffer();

  const ocrItems = [
    {
      pageNum: 1,
      id: 'T1',
      lineText: '[DING, TRIGGERED A PRE-TASK FOR THE MAIN QUEST]',
      transText: '[ពិត, បានដំណើរការបេសកកម្មបឋមសម្រាប់ដំណើរស្វែងរកចម្បង]',
      box_2d: [150, 100, 320, 850],
      shape: 'rounded',
      bgColor: '#ffffff',
      color: '#000000',
      fontFamily: 'Khmer OS Content',
      fontSize: 18,
      isBold: true,
      textAlign: 'center'
    },
    {
      pageNum: 1,
      id: 'T2',
      lineText: '[COMPLETE THE PRE-TASK TO CORRECT YOUR BODY]',
      transText: '[បំពេញបេសកកម្មបឋម ដើម្បីកែសម្រួលរាងកាយរបស់អ្នក]',
      box_2d: [600, 150, 800, 800],
      shape: 'rounded',
      bgColor: '#ffffff',
      color: '#000000',
      fontFamily: 'Khmer OS Content',
      fontSize: 18,
      isBold: true,
      textAlign: 'center'
    }
  ];

  console.log('1. Testing generateDocxWithKhmerScript service...');
  const pageImages = [{
    pageNum: 1,
    buffer: sampleMangaImg,
    name: 'manga_page_1.jpg'
  }];

  const docxBuffer = await generateDocxWithKhmerScript(pageImages, ocrItems, 'Test_Manga');
  console.log(`✓ Generated DOCX buffer size: ${docxBuffer.length} bytes`);

  if (!docxBuffer || docxBuffer.length < 1000) {
    throw new Error('DOCX buffer is invalid or too small');
  }

  // 2. Validate ZIP contents and OpenXML structure
  console.log('\n2. Validating OpenXML internal contents & Word Shapes...');
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(docxBuffer);

  const fileNames = Object.keys(zip.files);
  console.log('✓ Files present inside DOCX:', fileNames);

  const requiredFiles = [
    '[Content_Types].xml',
    '_rels/.rels',
    'word/_rels/document.xml.rels',
    'word/document.xml',
    'word/styles.xml',
    'word/fontTable.xml',
    'word/media/image1.jpg'
  ];

  for (const rf of requiredFiles) {
    if (!zip.files[rf]) {
      throw new Error(`Missing required OpenXML file in DOCX: ${rf}`);
    }
    console.log(`  ✓ Found ${rf}`);
  }

  // 3. Inspect word/document.xml
  const docXml = await zip.files['word/document.xml'].async('text');
  
  // Verify Image drawing element exists
  if (!docXml.includes('rIdImg1') || !docXml.includes('Manga Page 1')) {
    throw new Error('word/document.xml does not contain image drawing');
  }
  console.log('✓ Image drawing tag verified in document.xml');

  // Verify VML Shape roundrect tags exist
  if (!docXml.includes('v:roundrect') || !docXml.includes('fillcolor="#FFFFFF"')) {
    throw new Error('word/document.xml does not contain editable shape elements');
  }
  console.log('✓ VML Editable Shape (<v:roundrect fillcolor="#FFFFFF">) verified');

  // Verify Khmer Unicode text is present and correctly escaped
  if (!docXml.includes('បានដំណើរការបេសកកម្មបឋម') || !docXml.includes('ដើម្បីកែសម្រួលរាងកាយ')) {
    throw new Error('Khmer text was not found inside document.xml');
  }
  console.log('✓ Khmer translated dialogues verified inside <w:txbxContent>');

  // Verify Khmer Font
  if (!docXml.includes('Khmer OS Content')) {
    throw new Error('Khmer OS Content font definition missing');
  }
  console.log('✓ Font "Khmer OS Content" successfully applied to text runs');

  // 4. Test HTTP API endpoint /api/generate-docx
  console.log('\n3. Testing Express HTTP API endpoint POST /api/generate-docx...');
  const BASE_URL = 'http://127.0.0.1:5000';
  const form = new FormData();
  form.append('images', sampleMangaImg, { filename: 'manga_sample.jpg', contentType: 'image/jpeg' });
  form.append('ocr_items', JSON.stringify(ocrItems));
  form.append('title', 'Test_Manga_E2E');

  const apiRes = await axios.post(`${BASE_URL}/api/generate-docx`, form, {
    headers: form.getHeaders(),
    responseType: 'arraybuffer',
    timeout: 10000
  });

  console.log(`✓ API Response Status: ${apiRes.status}`);
  console.log(`✓ API Response Header Content-Type: ${apiRes.headers['content-type']}`);
  console.log(`✓ API Response Header Content-Disposition: ${apiRes.headers['content-disposition']}`);
  console.log(`✓ Downloaded DOCX size from API: ${apiRes.data.length} bytes`);

  if (apiRes.status !== 200 || apiRes.data.length === 0) {
    throw new Error('POST /api/generate-docx endpoint failed');
  }

  console.log('\n======================================================');
  console.log('  🎉 ALL REVIEW CHECKS & TESTS PASSED 100% PERFECTLY! ');
  console.log('======================================================\n');
}

testDocxGenerationAndStructure().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
