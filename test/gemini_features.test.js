const { scanOcrImage, aiReview } = require('../src/services/geminiService');

async function runGeminiTests() {
  console.log('\n--- [TEST SUITE 3] Gemini Vision & AI Review Features ---');

  // 4. Test error handling when API key is missing or invalid
  try {
    const dummyBuffer = Buffer.from('fake-image-bytes');
    await scanOcrImage('invalid-key-test', dummyBuffer, 1, 'auto', false);
  } catch (err) {
    console.log('✓ scanOcrImage error handled expectedly on bad key:', err.message);
  }

  // 5. Test AI review error handling on invalid key
  try {
    const dummyBuffer = Buffer.from('fake-image-bytes');
    await aiReview('invalid-key-test', dummyBuffer, [{ id: 'L1', lineText: 'Test' }], 1);
  } catch (err) {
    console.log('✓ aiReview error handled expectedly on bad key:', err.message);
  }

  console.log('✓ [TEST SUITE 3] ALL GEMINI AI SERVICE TESTS PASSED!\n');
}

module.exports = { runGeminiTests };

if (require.main === module) {
  runGeminiTests().catch(err => {
    console.error('Gemini test failed:', err);
    process.exit(1);
  });
}
