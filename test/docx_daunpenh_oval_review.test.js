const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const JSZip = require('jszip');
const { generateDocxWithKhmerScript } = require('../src/services/docxService');

async function runReviewAndTest() {
  console.log('================================================================');
  console.log('   COMPREHENSIVE REVIEW & TEST: DAUNPENH 11PT OVAL SHAPES       ');
  console.log('================================================================\n');

  // 1. Prepare 3 comic test pages with multi-line dialogues
  console.log('1. Preparing 3 comic test pages with multi-line dialogues...');
  const testImages = [];
  for (let i = 0; i < 3; i++) {
    const buf = await sharp({
      create: {
        width: 800,
        height: 1200 + i * 50,
        channels: 3,
        background: { r: 50 + i * 20, g: 80 + i * 15, b: 120 + i * 10 }
      }
    }).jpeg({ quality: 90 }).toBuffer();

    testImages.push({
      pageNum: i + 1,
      buffer: buf,
      name: `comic_page_${i + 1}.jpg`
    });
  }

  const sampleOcrItems = [
    {
      pageNum: 1,
      id: 'L1-1',
      lineText: 'SECOND SECT MASTER!',
      transText: 'លោកមេបក្សទីពីរ!\nតើលោកសុខសប្បាយជាទេ?',
      box_2d: [120, 150, 300, 580]
    },
    {
      pageNum: 1,
      id: 'L1-2',
      lineText: 'HM?',
      transText: 'ហឹម?',
      box_2d: [600, 680, 720, 820]
    },
    {
      pageNum: 2,
      id: 'L2-1',
      lineText: 'THE CLOUD SECT HAS ARRIVED!',
      transText: 'និកាយពពកបានមកដល់ហើយ!',
      box_2d: [180, 200, 380, 800]
    },
    {
      pageNum: 3,
      id: 'L3-1',
      lineText: 'PREPARE FOR BATTLE!',
      transText: 'ត្រៀមខ្លួនប្រយុទ្ធ!\nកុំឱ្យពួកគេរត់រួច!',
      box_2d: [250, 180, 480, 750]
    }
  ];

  // 2. Generate DOCX with DaunPenh 11pt Oval shapes
  console.log('2. Generating DOCX document with DaunPenh 11pt Oval bubbles...');
  const docxBuffer = await generateDocxWithKhmerScript(testImages, sampleOcrItems, 'Comic_DaunPenh_Review');
  console.log(`   ✓ Generated DOCX buffer size: ${docxBuffer.length} bytes`);

  // 3. OpenXML Inspection & Property Verification
  console.log('\n3. Inspecting OpenXML document.xml architecture...');
  const zip = await JSZip.loadAsync(docxBuffer);
  const docXml = await zip.file('word/document.xml').async('text');

  // A. Ellipse Geometry
  const ellipseMatches = docXml.match(/<a:prstGeom\s+prst="ellipse">/g) || [];
  console.log(`   • Ellipse geometry matches: ${ellipseMatches.length} / ${sampleOcrItems.length}`);
  if (ellipseMatches.length !== sampleOcrItems.length) {
    throw new Error(`Expected ${sampleOcrItems.length} ellipses, found ${ellipseMatches.length}`);
  }

  // B. Native Shape Check (No txBox flag)
  if (docXml.includes('txBox="1"')) {
    throw new Error('txBox="1" flag found! Expected pure native Shape.');
  }
  console.log('   • Native Oval Shape (txBox="1" absent): PASS');

  // C. Font Family DaunPenh
  const daunPenhMatches = docXml.match(/w:ascii="DaunPenh"\s+w:hAnsi="DaunPenh"\s+w:cs="DaunPenh"/g) || [];
  console.log(`   • DaunPenh font definition matches: ${daunPenhMatches.length}`);
  if (daunPenhMatches.length === 0) {
    throw new Error('Missing DaunPenh font definition in XML');
  }

  // D. Font Size 11pt (22 half-points)
  const szMatches = docXml.match(/<w:sz\s+w:val="22"\/>/g) || [];
  const szCsMatches = docXml.match(/<w:szCs\s+w:val="22"\/>/g) || [];
  console.log(`   • Font Size 11pt (22 half-points) matches: sz=${szMatches.length}, szCs=${szCsMatches.length}`);
  if (szMatches.length === 0 || szCsMatches.length === 0) {
    throw new Error('Missing Font size 11pt (22 half-points)');
  }

  // E. Line Spacing Multiple 0.7 (w:line="168")
  const spacingMatches = docXml.match(/<w:spacing\s+w:line="168"\s+w:lineRule="auto"\s+w:before="0"\s+w:after="0"\/>/g) || [];
  console.log(`   • Line Spacing 0.7 multiple (168 twentieths) matches: ${spacingMatches.length}`);
  if (spacingMatches.length === 0) {
    throw new Error('Missing line spacing 0.7 (w:line="168")');
  }

  // F. Alignment Center
  const centerMatches = docXml.match(/<w:jc\s+w:val="center"\/>/g) || [];
  console.log(`   • Center alignment matches: ${centerMatches.length}`);
  if (centerMatches.length === 0) {
    throw new Error('Missing center alignment');
  }

  // G. Solid White Oval Fill & No Outline
  const whiteFillMatches = docXml.match(/<a:solidFill>\s*<a:srgbClr\s+val="FFFFFF"\/>\s*<\/a:solidFill>/g) || [];
  const noOutlineMatches = docXml.match(/<a:ln>\s*<a:noFill\/>\s*<\/a:ln>/g) || [];
  console.log(`   • Solid White Fill matches: ${whiteFillMatches.length} / ${sampleOcrItems.length}`);
  console.log(`   • No Outline matches: ${noOutlineMatches.length} / ${sampleOcrItems.length}`);
  if (whiteFillMatches.length !== sampleOcrItems.length || noOutlineMatches.length !== sampleOcrItems.length) {
    throw new Error('Fill or outline properties mismatch');
  }

  // H. Body Insets Zero & Center Anchor
  const bodyPrMatches = docXml.match(/<wps:bodyPr\s+vert="horz"\s+lIns="0"\s+tIns="0"\s+rIns="0"\s+bIns="0"\s+anchor="ctr"\/>/g) || [];
  console.log(`   • Zero Margin/Padding Insets bodyPr matches: ${bodyPrMatches.length} / ${sampleOcrItems.length}`);
  if (bodyPrMatches.length !== sampleOcrItems.length) {
    throw new Error('Zero insets bodyPr mismatch');
  }

  // I. In Front of Text (behindDoc="0" and wrapNone)
  const behindDocMatches = docXml.match(/behindDoc="0"/g) || [];
  const wrapNoneMatches = docXml.match(/<wp:wrapNone\/>/g) || [];
  console.log(`   • In Front of Text matches: behindDoc="0"=${behindDocMatches.length}, wrapNone=${wrapNoneMatches.length}`);
  if (behindDocMatches.length !== sampleOcrItems.length || wrapNoneMatches.length !== sampleOcrItems.length) {
    throw new Error('In Front of Text wrapping mismatch');
  }

  // 4. Save sample docx file for verification
  const outputPath = path.join(__dirname, 'output_daunpenh_review.docx');
  fs.writeFileSync(outputPath, docxBuffer);
  console.log(`\n4. Saved sample output to: ${outputPath} (${fs.statSync(outputPath).size} bytes)`);

  console.log('\n================================================================');
  console.log('   🎉 ALL REVIEW CHECKS & TESTS PASSED WITH 100% ACCURACY!      ');
  console.log('================================================================\n');
}

runReviewAndTest().catch(err => {
  console.error('\n❌ REVIEW TEST FAILED:', err.message);
  process.exit(1);
});
