const FormData = require('form-data');
const sharp = require('sharp');
const axios = require('axios');
const http = require('http');

async function runApiTests() {
  console.log('\n--- [TEST SUITE 4] Express HTTP API Integration Tests ---');
  const BASE_URL = 'http://127.0.0.1:5000';

  // 1. GET / (UI Template)
  console.log('1. Testing GET /');
  const indexRes = await axios.get(`${BASE_URL}/`);
  console.log('✓ GET / status:', indexRes.status, 'HTML length:', indexRes.data.length);
  if (indexRes.status !== 200) throw new Error('GET / failed');

  // 2. POST /api/generate-pdf
  console.log('2. Testing POST /api/generate-pdf');
  const testImg = await sharp({
    create: { width: 120, height: 120, channels: 3, background: { r: 244, g: 63, b: 94 } }
  }).jpeg().toBuffer();

  const formGen = new FormData();
  formGen.append('metadata', JSON.stringify([{ filename: 'photo.jpg', rotation: 0 }]));
  formGen.append('page_size', 'a4-portrait');
  formGen.append('quality', '0.9');
  formGen.append('images', testImg, { filename: 'photo.jpg', contentType: 'image/jpeg' });

  const pdfRes = await axios.post(`${BASE_URL}/api/generate-pdf`, formGen, {
    headers: formGen.getHeaders(),
    responseType: 'arraybuffer'
  });
  console.log('✓ POST /api/generate-pdf status:', pdfRes.status, 'size:', pdfRes.data.length);
  if (pdfRes.status !== 200) throw new Error('POST /api/generate-pdf failed');

  // 3. POST /api/upload-pdf
  console.log('3. Testing POST /api/upload-pdf');
  const formUpload = new FormData();
  formUpload.append('file', pdfRes.data, { filename: 'doc.pdf', contentType: 'application/pdf' });

  const uploadRes = await axios.post(`${BASE_URL}/api/upload-pdf`, formUpload, {
    headers: formUpload.getHeaders()
  });
  console.log('✓ POST /api/upload-pdf status:', uploadRes.data.status, 'pages count:', uploadRes.data.pages.length);
  if (uploadRes.data.status !== 'success' || uploadRes.data.pages.length === 0) {
    throw new Error('POST /api/upload-pdf failed');
  }

  // 4. POST /api/render-translated-page
  console.log('4. Testing POST /api/render-translated-page');
  const formRender = new FormData();
  formRender.append('file', pdfRes.data, { filename: 'doc.pdf', contentType: 'application/pdf' });
  formRender.append('pageNum', '1');
  formRender.append('ocr_items', JSON.stringify([
    { id: 'T1', lineText: 'Hello', transText: 'សួស្តី', x_pct: 50, y_pct: 50 }
  ]));

  const renderRes = await axios.post(`${BASE_URL}/api/render-translated-page`, formRender, {
    headers: formRender.getHeaders()
  });
  console.log('✓ POST /api/render-translated-page status:', renderRes.data.status, 'preview length:', renderRes.data.dataUrl.length);
  if (renderRes.data.status !== 'success') throw new Error('POST /api/render-translated-page failed');


  // 5. POST /api/apply-khmer-pdf
  console.log('5. Testing POST /api/apply-khmer-pdf (Khmer Speech Bubble Overlay)');
  const formApply = new FormData();
  formApply.append('file', pdfRes.data, { filename: 'doc.pdf', contentType: 'application/pdf' });
  formApply.append('ocr_items', JSON.stringify([
    { pageNum: 1, id: 'T1', lineText: 'Hello', transText: 'សួស្តីកម្ពុជា', x_pct: 50, y_pct: 50 }
  ]));

  const applyRes = await axios.post(`${BASE_URL}/api/apply-khmer-pdf`, formApply, {
    headers: formApply.getHeaders(),
    responseType: 'arraybuffer'
  });
  console.log('✓ POST /api/apply-khmer-pdf status:', applyRes.status, 'size:', applyRes.data.length);
  if (applyRes.status !== 200) throw new Error('POST /api/apply-khmer-pdf failed');

  // 6. POST /api/manga/generate-zip
  console.log('6. Testing POST /api/manga/generate-zip');
  const zipForm = new FormData();
  zipForm.append('files', JSON.stringify(uploadRes.data.pages));
  zipForm.append('manga_title', 'Sample_Manga');

  const zipRes = await axios.post(`${BASE_URL}/api/manga/generate-zip`, zipForm, {
    headers: zipForm.getHeaders(),
    responseType: 'arraybuffer'
  });
  console.log('✓ POST /api/manga/generate-zip status:', zipRes.status, 'size:', zipRes.data.length);
  if (zipRes.status !== 200) throw new Error('POST /api/manga/generate-zip failed');

  // 6b. POST /api/manga/generate-docx
  console.log('6b. Testing POST /api/manga/generate-docx (Word Document 1:1)');
  const docxMangaForm = new FormData();
  docxMangaForm.append('files', JSON.stringify(uploadRes.data.pages));
  docxMangaForm.append('manga_title', 'Sample_Manga');

  const docxMangaRes = await axios.post(`${BASE_URL}/api/manga/generate-docx`, docxMangaForm, {
    headers: docxMangaForm.getHeaders(),
    responseType: 'arraybuffer'
  });
  console.log('✓ POST /api/manga/generate-docx status:', docxMangaRes.status, 'size:', docxMangaRes.data.length);
  if (docxMangaRes.status !== 200) throw new Error('POST /api/manga/generate-docx failed');

  // 6c. POST /api/generate-docx
  console.log('6c. Testing POST /api/generate-docx (Uploaded images with transcript)');
  const docxForm = new FormData();
  docxForm.append('images', testImg, { filename: 'page1.jpg', contentType: 'image/jpeg' });
  docxForm.append('ocr_items', JSON.stringify([
    { pageNum: 1, lineText: 'Hello Word', transText: 'សួស្តី Word' }
  ]));
  docxForm.append('title', 'Test_Doc');

  const docxRes = await axios.post(`${BASE_URL}/api/generate-docx`, docxForm, {
    headers: docxForm.getHeaders(),
    responseType: 'arraybuffer'
  });
  console.log('✓ POST /api/generate-docx status:', docxRes.status, 'size:', docxRes.data.length);
  if (docxRes.status !== 200) throw new Error('POST /api/generate-docx failed');

  // 7. GET /api/gemini/status
  console.log('7. Testing GET /api/gemini/status');
  const geminiStatusRes = await axios.get(`${BASE_URL}/api/gemini/status`);
  console.log('✓ GET /api/gemini/status:', geminiStatusRes.data);
  if (geminiStatusRes.data.status !== 'success') throw new Error('GET /api/gemini/status failed');

  // 8. POST /api/scan-ocr-pdf
  console.log('8. Testing POST /api/scan-ocr-pdf (Gemini Vision OCR)');
  const scanForm = new FormData();
  scanForm.append('file', pdfRes.data, { filename: 'sample_doc.pdf', contentType: 'application/pdf' });
  scanForm.append('lang', 'auto');
  scanForm.append('pages', '1');

  const scanRes = await axios.post(`${BASE_URL}/api/scan-ocr-pdf`, scanForm, {
    headers: scanForm.getHeaders(),
    timeout: 35000
  });
  console.log('✓ POST /api/scan-ocr-pdf status:', scanRes.data.status, 'results count:', scanRes.data.results?.length || 0);
  if (scanRes.data.status !== 'success') throw new Error('POST /api/scan-ocr-pdf failed');

  console.log('✓ [TEST SUITE 4] ALL HTTP ENDPOINT INTEGRATION TESTS PASSED!\n');
}

module.exports = { runApiTests };
