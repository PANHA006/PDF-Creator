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

  // 5. POST /api/export-translated-pdf
  console.log('5. Testing POST /api/export-translated-pdf');
  const formExport = new FormData();
  formExport.append('file', pdfRes.data, { filename: 'doc.pdf', contentType: 'application/pdf' });
  formExport.append('ocr_items', JSON.stringify([
    { pageNum: 1, id: 'T1', lineText: 'Hello', transText: 'សួស្តី', x_pct: 50, y_pct: 50 }
  ]));

  const exportRes = await axios.post(`${BASE_URL}/api/export-translated-pdf`, formExport, {
    headers: formExport.getHeaders(),
    responseType: 'arraybuffer'
  });
  console.log('✓ POST /api/export-translated-pdf status:', exportRes.status, 'size:', exportRes.data.length);
  if (exportRes.status !== 200) throw new Error('POST /api/export-translated-pdf failed');

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

  console.log('✓ [TEST SUITE 4] ALL HTTP ENDPOINT INTEGRATION TESTS PASSED!\n');
}

module.exports = { runApiTests };
