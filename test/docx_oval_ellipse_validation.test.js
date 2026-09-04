const fs = require('fs');
const JSZip = require('jszip');
const sharp = require('sharp');
const { generateDocxWithKhmerScript } = require('../src/services/docxService');

async function testOvalEllipseValidation() {
  console.log('\n================================================================');
  console.log('   VALIDATION TEST: OVAL / ELLIPSE SHAPE GEOMETRY IN DOCX       ');
  console.log('================================================================\n');

  // 1. Create a dummy test image
  const imgBuf = await sharp({
    create: { width: 700, height: 1050, channels: 3, background: { r: 60, g: 100, b: 170 } }
  }).jpeg().toBuffer();

  const ocrItems = [
    {
      pageNum: 1,
      id: 'L1-1',
      lineText: 'SECOND SECT MASTER!',
      transText: 'លោកមេបក្សទីពីរ!',
      box_2d: [150, 100, 320, 600]
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
    'Oval_Shape_Validation'
  );

  console.log(`✓ Generated DOCX buffer size: ${docxBuf.length} bytes`);

  // 2. Load and inspect OpenXML document.xml
  const zip = await JSZip.loadAsync(docxBuf);
  const docXml = await zip.file('word/document.xml').async('text');

  console.log('\n2. Verifying Oval (Ellipse) OpenXML Properties:');

  // A. Verify Oval Preset Geometry (<a:prstGeom prst="ellipse">)
  const ellipseMatches = docXml.match(/<a:prstGeom\s+prst="ellipse">/g) || [];
  console.log(`  • <a:prstGeom prst="ellipse"> matches: ${ellipseMatches.length} (Expected: ${ocrItems.length})`);
  if (ellipseMatches.length !== ocrItems.length) {
    throw new Error(`Expected ${ocrItems.length} ellipse shapes, found ${ellipseMatches.length}`);
  }

  // A2. Verify Native Oval Shape (<wps:cNvSpPr/> without txBox flag)
  if (docXml.includes('txBox="1"')) {
    throw new Error('txBox="1" flag found! Expected pure native Oval Shape <wps:cNvSpPr/>');
  }
  console.log('  • Native Oval Shape (<wps:cNvSpPr/> without txBox flag) verified');

  // B. Verify In Front of Text (behindDoc="0" and <wp:wrapNone/>)
  const behindDocMatches = docXml.match(/behindDoc="0"/g) || [];
  const wrapNoneMatches = docXml.match(/<wp:wrapNone\/>/g) || [];
  console.log(`  • behindDoc="0" matches: ${behindDocMatches.length} (Expected: ${ocrItems.length})`);
  console.log(`  • <wp:wrapNone/> matches: ${wrapNoneMatches.length} (Expected: ${ocrItems.length})`);
  if (behindDocMatches.length !== ocrItems.length || wrapNoneMatches.length !== ocrItems.length) {
    throw new Error('In Front of Text wrapping properties are missing');
  }

  // C. Verify Zero Body Insets (lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr")
  const bodyPrMatches = docXml.match(/lIns="0"\s+tIns="0"\s+rIns="0"\s+bIns="0"\s+anchor="ctr"/g) || [];
  console.log(`  • Zero insets bodyPr matches: ${bodyPrMatches.length} (Expected: ${ocrItems.length})`);
  if (bodyPrMatches.length !== ocrItems.length) {
    throw new Error('Zero insets bodyPr is missing');
  }

  // D. Verify DaunPenh font, Size 11pt (22 half-points), and Line Spacing 0.7 (168 twentieths)
  if (!docXml.includes('DaunPenh')) throw new Error('Missing DaunPenh font');
  console.log('  • Font Family: "DaunPenh" verified');

  if (!docXml.includes('w:sz w:val="22"')) throw new Error('Missing Size 11pt (22 half-points)');
  console.log('  • Font Size: 11pt (22 half-points) verified');

  if (!docXml.includes('w:spacing w:line="168"')) throw new Error('Missing Line Spacing 0.7 (168 twentieths)');
  console.log('  • Line Spacing: 0.7 multiple (168 twentieths) verified');

  // E. Verify Center Alignment & Text Shading: none
  if (!docXml.includes('w:jc w:val="center"')) throw new Error('Missing center alignment');
  console.log('  • Alignment: Center verified');

  // F. Verify Solid White Oval Fill & No Outline
  const whiteFillMatches = docXml.match(/<a:solidFill>\s*<a:srgbClr\s+val="FFFFFF"\/>\s*<\/a:solidFill>/g) || [];
  console.log(`  • Solid White Oval Fill matches: ${whiteFillMatches.length} (Expected: ${ocrItems.length})`);
  if (whiteFillMatches.length !== ocrItems.length) {
    throw new Error('Missing Solid White Oval Fill');
  }

  const noLineMatches = docXml.match(/<a:ln>\s*<a:noFill\/>\s*<\/a:ln>/g) || [];
  console.log(`  • Shape No Outline matches: ${noLineMatches.length} (Expected: ${ocrItems.length})`);
  if (noLineMatches.length !== ocrItems.length) {
    throw new Error('Missing Shape No Outline');
  }

  console.log('\n================================================================');
  console.log('  🎉 ALL OVAL (ELLIPSE) SHAPE TESTS PASSED 100%!                ');
  console.log('================================================================\n');
}

testOvalEllipseValidation().catch(err => {
  console.error('\n❌ TEST FAILED:', err.message);
  process.exit(1);
});
