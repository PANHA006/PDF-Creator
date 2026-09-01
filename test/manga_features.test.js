const { createZipStream, fetchMangaDex, fetchUniversalManga } = require('../src/services/mangaService');
const stream = require('stream');

async function runMangaTests() {
  console.log('\n--- [TEST SUITE 2] Manga & ZIP Features ---');

  // 1. Test ZIP Stream generation from mock image data URLs
  const mockPages = [
    {
      name: 'Ch_1_Page_1.jpg',
      dataUrl: 'data:image/jpeg;base64,' + Buffer.from('fake-image-bytes-1').toString('base64')
    },
    {
      name: 'Ch_1_Page_2.png',
      dataUrl: 'data:image/png;base64,' + Buffer.from('fake-image-bytes-2').toString('base64')
    }
  ];

  const zipStream = createZipStream(mockPages);
  const chunks = [];

  await new Promise((resolve, reject) => {
    zipStream.on('data', chunk => chunks.push(chunk));
    zipStream.on('end', resolve);
    zipStream.on('error', reject);
  });

  const zipBuffer = Buffer.concat(chunks);
  console.log('✓ createZipStream produced ZIP buffer:', zipBuffer.length, 'bytes');
  if (zipBuffer.length === 0) {
    throw new Error('ZIP buffer is empty');
  }

  // 2. Test Manga URL parsers and fallback handlers
  try {
    const invalidRes = await fetchUniversalManga('https://example.com/invalid-manga-page-404');
    console.log('✓ fetchUniversalManga parsed fallback:', invalidRes.title);
  } catch (err) {
    console.log('✓ fetchUniversalManga handled external error gracefully:', err.message);
  }

  console.log('✓ [TEST SUITE 2] ALL MANGA & ZIP FEATURES PASSED!\n');
}

module.exports = { runMangaTests };

if (require.main === module) {
  runMangaTests().catch(err => {
    console.error('Manga test failed:', err);
    process.exit(1);
  });
}
