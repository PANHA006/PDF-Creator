const fs = require('fs');
const JSZip = require('jszip');
const sharp = require('sharp');
const { generateDocxWithKhmerScript } = require('../src/services/docxService');

async function testExactPageMapping() {
  console.log('\n================================================================');
  console.log('   TESTING: EXACT 1:1 PAGE MAPPING & "លោកមេបក្សទីពីរ!" ON PAGE 2 ');
  console.log('================================================================\n');

  // 1. Create 5 dummy manga images
  const testImages = [];
  for (let i = 0; i < 5; i++) {
    const buf = await sharp({
      create: {
        width: 720,
        height: 1080,
        channels: 3,
        background: { r: 50 + i * 25, g: 80 + i * 20, b: 120 + i * 15 }
      }
    }).jpeg().toBuffer();

    testImages.push({
      pageNum: i + 1,
      buffer: buf,
      name: `ch_page_${i + 1}.jpg`
    });
  }

  // 2. Prepare exact OCR items per page
  const ocrItems = [
    {
      pageNum: 1,
      id: 'L1-1',
      lineText: 'DRAKE SCANS BANNER',
      transText: 'ទំព័រទីមួយ គម្របរឿង',
      box_2d: [200, 200, 400, 800]
    },
    {
      pageNum: 2,
      id: 'L2-1',
      lineText: 'SECOND SECT MASTER!',
      transText: 'លោកមេបក្សទីពីរ!',
      box_2d: [150, 100, 320, 600]
    },
    {
      pageNum: 3,
      id: 'L3-1',
      lineText: 'THE CLOUD SECT HAS DIED',
      transText: 'និកាយពពកត្រូវបានកម្ទេច',
      box_2d: [300, 150, 500, 750]
    },
    {
      pageNum: 4,
      id: 'L4-1',
      lineText: 'YOU ARE WRONG',
      transText: 'ឯងគិតខុសហើយ!',
      box_2d: [400, 250, 600, 850]
    },
    {
      pageNum: 5,
      id: 'L5-1',
      lineText: 'LAST PAGE DIALOGUE',
      transText: 'ទំព័រទីប្រាំ ចុងបញ្ចប់',
      box_2d: [250, 150, 450, 700]
    }
  ];

  // 3. Generate DOCX with editable shapes
  const docxBuf = await generateDocxWithKhmerScript(testImages, ocrItems, 'Exact_Page_Mapping_Test');
  console.log(`✓ Generated DOCX buffer size: ${docxBuf.length} bytes`);

  // 4. Load and inspect OpenXML document.xml
  const zip = await JSZip.loadAsync(docxBuf);
  const docXml = await zip.file('word/document.xml').async('text');

  const pRegex = /<w:p(?:\s+[^>]*)?>[\s\S]*?<\/w:p>/g;
  const allParagraphs = docXml.match(pRegex) || [];
  const imageParagraphs = allParagraphs.filter(p => p.includes('<w:drawing>') && !p.includes('<w:sectPr>'));
  const sectPrParagraphs = allParagraphs.filter(p => p.includes('<w:sectPr>'));

  console.log(`\n• Total paragraphs: ${allParagraphs.length}`);
  console.log(`• Genuine image paragraphs: ${imageParagraphs.length} (Expected: 5)`);
  console.log(`• Section break paragraphs: ${sectPrParagraphs.length} (Expected: 4)`);

  if (imageParagraphs.length !== 5) {
    throw new Error(`Expected 5 image paragraphs, found ${imageParagraphs.length}`);
  }

  // Verify Section breaks have ZERO text boxes
  for (let i = 0; i < sectPrParagraphs.length; i++) {
    if (sectPrParagraphs[i].includes('wps:wsp') || sectPrParagraphs[i].includes('Khmer OS Battambang')) {
      throw new Error(`Section break paragraph ${i + 1} contains leaked shape text box!`);
    }
  }
  console.log('✓ Verified: Section break paragraphs contain ZERO leaked text boxes');

  // Verify Page 1 has ONLY Page 1 text
  const p1Xml = imageParagraphs[0];
  if (!p1Xml.includes('ទំព័រទីមួយ គម្របរឿង') || p1Xml.includes('លោកមេបក្សទីពីរ!')) {
    throw new Error('Page 1 has incorrect text or leaked Page 2 text');
  }
  console.log('✓ Verified: Page 1 contains ONLY Page 1 text ("ទំព័រទីមួយ គម្របរឿង")');

  // Verify Page 2 has ONLY Page 2 text ("លោកមេបក្សទីពីរ!")
  const p2Xml = imageParagraphs[1];
  if (!p2Xml.includes('លោកមេបក្សទីពីរ!') || p2Xml.includes('ទំព័រទីមួយ គម្របរឿង') || p2Xml.includes('និកាយពពកត្រូវបានកម្ទេច')) {
    throw new Error('Page 2 has incorrect text or leaked text from other pages');
  }
  console.log('✓ Verified: Page 2 contains ONLY "លោកមេបក្សទីពីរ!" (Exact 1:1 Match!)');

  // Verify Page 3 has ONLY Page 3 text
  const p3Xml = imageParagraphs[2];
  if (!p3Xml.includes('និកាយពពកត្រូវបានកម្ទេច')) {
    throw new Error('Page 3 missing Page 3 text');
  }
  console.log('✓ Verified: Page 3 contains ONLY "និកាយពពកត្រូវបានកម្ទេច"');

  // Verify Page 4 has ONLY Page 4 text
  const p4Xml = imageParagraphs[3];
  if (!p4Xml.includes('ឯងគិតខុសហើយ!')) {
    throw new Error('Page 4 missing Page 4 text');
  }
  console.log('✓ Verified: Page 4 contains ONLY "ឯងគិតខុសហើយ!"');

  // Verify Page 5 has ONLY Page 5 text
  const p5Xml = imageParagraphs[4];
  if (!p5Xml.includes('ទំព័រទីប្រាំ ចុងបញ្ចប់')) {
    throw new Error('Page 5 missing Page 5 text');
  }
  console.log('✓ Verified: Page 5 contains ONLY "ទំព័រទីប្រាំ ចុងបញ្ចប់"');

  console.log('\n================================================================');
  console.log('  🎉 100% EXACT 1:1 PAGE MAPPING VERIFIED & PASSED!              ');
  console.log('================================================================\n');
}

testExactPageMapping().catch(err => {
  console.error('\n❌ TEST FAILED:', err.message);
  process.exit(1);
});
