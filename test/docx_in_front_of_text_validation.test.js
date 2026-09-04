const fs = require('fs');
const JSZip = require('jszip');
const sharp = require('sharp');
const { generateDocxWithKhmerScript } = require('../src/services/docxService');

async function testInFrontOfTextValidation() {
  console.log('\n================================================================');
  console.log('   VALIDATION TEST: IN FRONT OF TEXT WRAPPING & ZERO INSETS     ');
  console.log('================================================================\n');

  // 1. Create a dummy test image
  const imgBuf = await sharp({
    create: { width: 700, height: 1050, channels: 3, background: { r: 50, g: 90, b: 160 } }
  }).jpeg().toBuffer();

  const ocrItems = [
    {
      pageNum: 1,
      id: 'L1-1',
      lineText: 'YOU ARE STILL SELF INDULGENT',
      transText: 'អ្នកនៅតែមានចរិតបែបនេះទៀត?',
      box_2d: [170, 230, 350, 680]
    },
    {
      pageNum: 1,
      id: 'L1-2',
      lineText: 'HM?',
      transText: 'ហឹម?',
      box_2d: [558, 719, 688, 848]
    }
  ];

  const docxBuf = await generateDocxWithKhmerScript(
    [{ pageNum: 1, buffer: imgBuf, name: 'page_1.jpg' }],
    ocrItems,
    'InFrontOfText_Validation'
  );

  console.log(`✓ Generated DOCX buffer: ${docxBuf.length} bytes`);

  // 2. Load and inspect OpenXML document.xml
  const zip = await JSZip.loadAsync(docxBuf);
  const docXml = await zip.file('word/document.xml').async('text');

  console.log('\n2. Verifying OpenXML Properties:');

  // A. Verify In Front of Text (behindDoc="0" and <wp:wrapNone/>)
  const behindDocMatches = docXml.match(/behindDoc="0"/g) || [];
  const wrapNoneMatches = docXml.match(/<wp:wrapNone\/>/g) || [];
  console.log(`  • behindDoc="0" matches: ${behindDocMatches.length} (Expected: ${ocrItems.length})`);
  console.log(`  • <wp:wrapNone/> matches: ${wrapNoneMatches.length} (Expected: ${ocrItems.length})`);
  if (behindDocMatches.length !== ocrItems.length || wrapNoneMatches.length !== ocrItems.length) {
    throw new Error('In Front of Text wrapping properties are missing or incomplete');
  }

  // B. Verify Zero Body Insets (lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr")
  const bodyPrMatches = docXml.match(/lIns="0"\s+tIns="0"\s+rIns="0"\s+bIns="0"\s+anchor="ctr"/g) || [];
  console.log(`  • Zero insets bodyPr matches: ${bodyPrMatches.length} (Expected: ${ocrItems.length})`);
  if (bodyPrMatches.length !== ocrItems.length) {
    throw new Error('Zero insets bodyPr is missing or incomplete');
  }

  // C. Verify Khmer OS Battambang font & Size 9pt
  if (!docXml.includes('Khmer OS Battambang')) {
    throw new Error('Missing Khmer OS Battambang font');
  }
  console.log('  • Font Family: "Khmer OS Battambang" verified');

  if (!docXml.includes('w:sz w:val="18"')) {
    throw new Error('Missing Size 9pt (18 half-points)');
  }
  console.log('  • Font Size: 9pt (18 half-points) verified');

  // D. Verify Center Alignment & White Shading
  if (!docXml.includes('w:jc w:val="center"')) {
    throw new Error('Missing center alignment');
  }
  console.log('  • Alignment: Center verified');

  if (!docXml.includes('w:fill="FFFFFF"')) {
    throw new Error('Missing white paragraph shading');
  }
  console.log('  • Paragraph Shading: White (#FFFFFF) verified');

  // E. Verify Shape No Fill & No Outline
  const noFillMatches = docXml.match(/<a:noFill\/>/g) || [];
  console.log(`  • Shape No Fill & No Outline matches: ${noFillMatches.length}`);
  if (noFillMatches.length < ocrItems.length * 2) {
    throw new Error('Missing <a:noFill/> in shape properties');
  }

  console.log('\n================================================================');
  console.log('  🎉 ALL "IN FRONT OF TEXT" & ZERO INSETS TESTS PASSED 100%!    ');
  console.log('================================================================\n');
}

testInFrontOfTextValidation().catch(err => {
  console.error('\n❌ TEST FAILED:', err.message);
  process.exit(1);
});
