const axios = require('axios');
const FormData = require('form-data');
const sharp = require('sharp');

function buildMangaCustomBaseName(mangaTitle, chapterEntries) {
  const rawTitle = (mangaTitle || 'Manga').trim();
  if (!chapterEntries || chapterEntries.length === 0) {
    return rawTitle;
  }
  if (chapterEntries.length === 1) {
    const ch = chapterEntries[0].chStr || chapterEntries[0].chNum || '1';
    return `ch-${ch}-${rawTitle}`;
  }
  const firstCh = chapterEntries[0].chStr || chapterEntries[0].chNum || '1';
  const lastCh = chapterEntries[chapterEntries.length - 1].chStr || chapterEntries[chapterEntries.length - 1].chNum || chapterEntries.length;
  return `ch-(${firstCh}-${lastCh})-${rawTitle}`;
}

async function testMangaNaming() {
  console.log('================================================================');
  console.log('   TEST: MANGA FILE & CHAPTER CUSTOM NAMING VERIFICATION       ');
  console.log('================================================================\n');

  // 1. Verify Naming Helper
  const title = 'Dragon Master';

  // Case A: Ch 1
  const name1 = buildMangaCustomBaseName(title, [{ chStr: '1' }]);
  console.log(`Single Ch 1: "${name1}"`);
  if (name1 !== 'ch-1-Dragon Master') throw new Error(`Expected 'ch-1-Dragon Master', got '${name1}'`);
  console.log('✓ PASS: ch-1-Dragon Master\n');

  // Case B: Ch 23
  const name23 = buildMangaCustomBaseName(title, [{ chStr: '23' }]);
  console.log(`Single Ch 23: "${name23}"`);
  if (name23 !== 'ch-23-Dragon Master') throw new Error(`Expected 'ch-23-Dragon Master', got '${name23}'`);
  console.log('✓ PASS: ch-23-Dragon Master\n');

  // Case C: Ch 1-10
  const chapters1to10 = Array.from({ length: 10 }, (_, i) => ({ chStr: String(i + 1) }));
  const name1to10 = buildMangaCustomBaseName(title, chapters1to10);
  console.log(`Multiple Ch 1-10: "${name1to10}"`);
  if (name1to10 !== 'ch-(1-10)-Dragon Master') throw new Error(`Expected 'ch-(1-10)-Dragon Master', got '${name1to10}'`);
  console.log('✓ PASS: ch-(1-10)-Dragon Master\n');

  // 2. Test Backend API endpoints with custom names
  const BASE_URL = 'http://127.0.0.1:5000';
  const dummyImg = await sharp({
    create: { width: 100, height: 100, channels: 3, background: { r: 100, g: 100, b: 200 } }
  }).jpeg().toBuffer();

  const dataUrl = `data:image/jpeg;base64,${dummyImg.toString('base64')}`;

  // Test ZIP endpoint with ch-(1-10)-Dragon Master
  const zipForm = new FormData();
  zipForm.append('files', JSON.stringify([{ name: 'p1.jpg', dataUrl }]));
  zipForm.append('manga_title', 'ch-(1-10)-Dragon Master');

  const zipRes = await axios.post(`${BASE_URL}/api/manga/generate-zip`, zipForm, {
    headers: zipForm.getHeaders(),
    responseType: 'arraybuffer'
  });

  console.log('ZIP Content-Disposition header:', zipRes.headers['content-disposition']);
  if (!zipRes.headers['content-disposition'].includes('ch-(1-10)-Dragon Master.zip')) {
    throw new Error('ZIP filename header does not match expected name');
  }
  console.log('✓ PASS: ZIP filename header matches ch-(1-10)-Dragon Master.zip\n');

  // Test DOCX endpoint with ch-23-Dragon Master
  const docxForm = new FormData();
  docxForm.append('files', JSON.stringify([{ name: 'p1.jpg', dataUrl }]));
  docxForm.append('manga_title', 'ch-23-Dragon Master');

  const docxRes = await axios.post(`${BASE_URL}/api/manga/generate-docx`, docxForm, {
    headers: docxForm.getHeaders(),
    responseType: 'arraybuffer'
  });

  console.log('DOCX Content-Disposition header:', docxRes.headers['content-disposition']);
  if (!docxRes.headers['content-disposition'].includes('ch-23-Dragon Master.docx')) {
    throw new Error('DOCX filename header does not match expected name');
  }
  console.log('✓ PASS: DOCX filename header matches ch-23-Dragon Master.docx\n');

  console.log('================================================================');
  console.log('   🎉 ALL MANGA CUSTOM NAMING TESTS PASSED 100%!                ');
  console.log('================================================================\n');
}

testMangaNaming().catch(err => {
  console.error('❌ TEST FAILED:', err.message);
  process.exit(1);
});
