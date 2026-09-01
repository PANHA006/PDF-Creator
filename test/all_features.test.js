const { spawn } = require('child_process');
const path = require('path');
const { runPdfTests } = require('./pdf_features.test');
const { runMangaTests } = require('./manga_features.test');
const { runGeminiTests } = require('./gemini_features.test');
const { runApiTests } = require('./api_endpoints.test');

async function runAllFeaturesTest() {
  console.log('====================================================');
  console.log('    PDF-CREATOR COMPREHENSIVE ALL-FEATURES TEST     ');
  console.log('====================================================');

  const startTime = Date.now();

  // 1. PDF and Image Processing
  await runPdfTests();

  // 2. Manga Scraping & ZIP Creation
  await runMangaTests();

  // 3. Gemini Vision & Translation
  await runGeminiTests();

  // 4. Server API Integration
  console.log('Starting Express server for API integration tests...');
  const serverProcess = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit'
  });

  // Give server 1.5s to listen
  await new Promise(r => setTimeout(r, 1500));

  try {
    await runApiTests();
  } finally {
    serverProcess.kill();
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('====================================================');
  console.log(` ALL FEATURES TESTED & PASSED SUCCESSFULLY IN ${duration}s! `);
  console.log('====================================================');
}

runAllFeaturesTest().catch(err => {
  console.error('\n ALL-FEATURES TEST SUITE FAILED:', err);
  process.exit(1);
});
