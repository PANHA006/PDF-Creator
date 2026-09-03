const fs = require('fs');
const JSZip = require('jszip');
const { generateDocxWithKhmerScript } = require('../src/services/docxService');
const sharp = require('sharp');

async function testOrder() {
  const images = [];
  for (let i = 0; i < 5; i++) {
    const buf = await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: i * 40, g: 100, b: 100 } } }).jpeg().toBuffer();
    images.push({ pageNum: i + 1, buffer: buf, name: `page_${i + 1}.jpg` });
  }
  const docxBuf = await generateDocxWithKhmerScript(images, [], 'Test');
  const zip = await JSZip.loadAsync(docxBuf);

  // 1. Parse word/_rels/document.xml.rels
  const relsMap = {};
  if (zip.file('word/_rels/document.xml.rels')) {
    const relsXml = await zip.file('word/_rels/document.xml.rels').async('text');
    const relMatches = relsXml.matchAll(/<Relationship\s+[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g);
    for (const match of relMatches) {
      const id = match[1];
      let target = match[2];
      if (!target.startsWith('word/')) {
        target = 'word/' + target.replace(/^\//, '');
      }
      relsMap[id] = target;
    }
  }
  console.log('Rels map:', relsMap);

  // 2. Parse word/document.xml for r:embed order
  const orderedMediaFiles = [];
  if (zip.file('word/document.xml')) {
    const docXml = await zip.file('word/document.xml').async('text');
    const embedMatches = docXml.matchAll(/r:embed="([^"]+)"/g);
    for (const match of embedMatches) {
      const rId = match[1];
      const target = relsMap[rId];
      if (target && zip.files[target]) {
        orderedMediaFiles.push(target);
      }
    }
  }

  console.log('Final Ordered Media Files (Exact Page 1..N):', orderedMediaFiles);
}

testOrder().catch(console.error);
