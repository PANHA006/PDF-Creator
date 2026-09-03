const { spawn } = require('child_process');
const path = require('path');
const axios = require('axios');
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
  const serverProcess = spawn(`"${process.execPath}"`, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    shell: true
  });

  // Give server time to listen with retries
  let isReady = false;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    try {
      const res = await axios.get('http://127.0.0.1:5000/api/gemini/status', { timeout: 1000 });
      if (res.status === 200) {
        isReady = true;
        break;
      }
    } catch (e) {
      // still starting
    }
  }

  try {
    if (!isReady) console.warn('Server startup polling timed out, attempting tests anyway...');
    await runApiTests();
  } finally {
    try {
      process.kill(-serverProcess.pid);
    } catch (e) {
      serverProcess.kill();
    }
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
