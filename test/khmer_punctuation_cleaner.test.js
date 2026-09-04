const { cleanKhmerPunctuation } = require('../src/services/geminiService');
const { generateDocxWithKhmerScript } = require('../src/services/docxService');
const sharp = require('sharp');
const JSZip = require('jszip');

async function testKhmerPunctuationCleaner() {
  console.log('================================================================');
  console.log('   TEST: KHMER PUNCTUATION "។" REMOVAL VERIFICATION             ');
  console.log('================================================================\n');

  // 1. Test cleanKhmerPunctuation function directly
  const testCases = [
    { input: 'ម្ចាស់និកាយទីពីរបានចាញ់ហើយ។', expected: 'ម្ចាស់និកាយទីពីរបានចាញ់ហើយ' },
    { input: 'ក្នុងនាមជាអ្នកក្រៅ យើងមិនអាចយល់ពីអារម្មណ៍...ឡើយ។ ', expected: 'ក្នុងនាមជាអ្នកក្រៅ យើងមិនអាចយល់ពីអារម្មណ៍...ឡើយ' },
    { input: 'បន្ទាត់ទីមួយ។\nបន្ទាត់ទីពីរ។', expected: 'បន្ទាត់ទីមួយ\nបន្ទាត់ទីពីរ' },
    { input: 'ត្រៀមខ្លួនប្រយុទ្ធ!។', expected: 'ត្រៀមខ្លួនប្រយុទ្ធ!' },
    { input: 'អត្ថបទធម្មតា', expected: 'អត្ថបទធម្មតា' },
    { input: 'ពិតជាគួរឱ្យអាណិតណាស់។។។   ', expected: 'ពិតជាគួរឱ្យអាណិតណាស់' }
  ];

  for (const tc of testCases) {
    const result = cleanKhmerPunctuation(tc.input);
    console.log(`Input:    "${tc.input}"`);
    console.log(`Cleaned:  "${result}"`);
    console.log(`Expected: "${tc.expected}"`);
    if (result !== tc.expected) {
      throw new Error(`cleanKhmerPunctuation failed for "${tc.input}" -> got "${result}", expected "${tc.expected}"`);
    }
    console.log('✓ PASS\n');
  }

  // 2. Test DOCX generation with items containing ending "។"
  const imgBuf = await sharp({
    create: { width: 600, height: 900, channels: 3, background: { r: 50, g: 50, b: 50 } }
  }).jpeg().toBuffer();

  const ocrItems = [
    {
      pageNum: 1,
      id: 'L1',
      lineText: 'SAMPLE TEXT',
      transText: 'ម្ចាស់និកាយទីពីរបានចាញ់ហើយ។\nតែមួយដៃនោះ។',
      box_2d: [100, 100, 300, 500]
    }
  ];

  const docxBuf = await generateDocxWithKhmerScript(
    [{ pageNum: 1, buffer: imgBuf, name: 'page1.jpg' }],
    ocrItems,
    'Test_Punctuation_Doc'
  );

  const zip = await JSZip.loadAsync(docxBuf);
  const docXml = await zip.file('word/document.xml').async('text');

  if (docXml.includes('ម្ចាស់និកាយទីពីរបានចាញ់ហើយ។') || docXml.includes('តែមួយដៃនោះ។')) {
    throw new Error('Found trailing "។" mark in generated DOCX document XML!');
  }

  if (!docXml.includes('ម្ចាស់និកាយទីពីរបានចាញ់ហើយ') || !docXml.includes('តែមួយដៃនោះ')) {
    throw new Error('Expected clean translated text without trailing "។" in DOCX document XML');
  }

  console.log('✓ DOCX XML verified: No trailing "។" found in any speech bubble text!');
  console.log('\n================================================================');
  console.log('   🎉 ALL KHMER PUNCTUATION CLEANER TESTS PASSED 100%!          ');
  console.log('================================================================\n');
}

testKhmerPunctuationCleaner().catch(err => {
  console.error('❌ TEST FAILED:', err.message);
  process.exit(1);
});
