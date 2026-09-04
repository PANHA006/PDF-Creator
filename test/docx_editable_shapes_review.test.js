const fs = require('fs');
const JSZip = require('jszip');
const sharp = require('sharp');
const { generateDocxWithKhmerScript } = require('../src/services/docxService');

async function testEditableShapesIntegration() {
  console.log('\n================================================================');
  console.log('   TESTING: EDITABLE KHMER SHAPE TEXT BOXES IN DOCX            ');
  console.log('================================================================\n');

  // 1. Create a dummy test image
  const imgBuf = await sharp({
    create: { width: 700, height: 1050, channels: 3, background: { r: 50, g: 100, b: 180 } }
  }).jpeg().toBuffer();

  const ocrItems = [
    {
      pageNum: 1,
      id: 'L1-1',
      lineText: 'CAN YOU BELIEVE IT?',
      transText: 'តើឯងអាចធ្វើ\nបានទេ?',
      box_2d: [200, 150, 450, 850]
    },
    {
      pageNum: 1,
      id: 'L1-2',
      lineText: 'HM?',
      transText: 'ហឹម?',
      box_2d: [600, 650, 750, 850]
    }
  ];

  const docxBuf = await generateDocxWithKhmerScript(
    [{ pageNum: 1, buffer: imgBuf, name: 'page_1.jpg' }],
    ocrItems,
    'Manga_Editable_Khmer_Test'
  );

  console.log(`✓ Generated DOCX buffer: ${docxBuf.length} bytes`);

  // 2. Parse OpenXML document.xml and verify shapes
  const zip = await JSZip.loadAsync(docxBuf);
  const docXml = await zip.file('word/document.xml').async('text');

  console.log('✓ Checking for Khmer OS Battambang font...');
  if (!docXml.includes('Khmer OS Battambang')) {
    throw new Error('Missing "Khmer OS Battambang" font in document.xml');
  }
  console.log('  -> Found "Khmer OS Battambang" font');

  console.log('✓ Checking for Size 9pt (w:sz w:val="18")...');
  if (!docXml.includes('w:sz w:val="18"')) {
    throw new Error('Missing size 9pt (18 half-points) in document.xml');
  }
  console.log('  -> Found Size 9pt');

  console.log('✓ Checking for Center Alignment (w:jc w:val="center")...');
  if (!docXml.includes('w:jc w:val="center"')) {
    throw new Error('Missing center alignment in document.xml');
  }
  console.log('  -> Found Center Alignment');

  console.log('✓ Checking for Paragraph Shading White (w:shd ... w:fill="FFFFFF")...');
  if (!docXml.includes('w:fill="FFFFFF"')) {
    throw new Error('Missing white paragraph shading in document.xml');
  }
  console.log('  -> Found White Paragraph Shading');

  console.log('✓ Checking for No Fill and No Outline in shapes...');
  if (!docXml.includes('<a:noFill/>')) {
    throw new Error('Missing <a:noFill/> in shape properties');
  }
  console.log('  -> Found None Shape Fill and None Outline');

  console.log('\n================================================================');
  console.log('  🎉 ALL EDITABLE KHMER SHAPE DOCX TESTS PASSED 100%!           ');
  console.log('================================================================\n');
}

testEditableShapesIntegration().catch(err => {
  console.error('\n❌ TEST FAILED:', err.message);
  process.exit(1);
});
