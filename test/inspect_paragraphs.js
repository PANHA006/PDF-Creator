const fs = require('fs');
const JSZip = require('jszip');
const sharp = require('sharp');
const { Document, Packer, Paragraph, ImageRun, AlignmentType } = require('docx');

async function testFilter() {
  const sections = [];
  for (let i = 0; i < 5; i++) {
    const buf = await sharp({
      create: { width: 350, height: 500, channels: 3, background: { r: 30 * i, g: 100, b: 150 } }
    }).jpeg().toBuffer();

    sections.push({
      properties: {
        page: { size: { width: 5250, height: 7500 }, margin: { top: 0, bottom: 0, left: 0, right: 0 } }
      },
      children: [
        new Paragraph({
          children: [
            new ImageRun({
              data: buf,
              transformation: { width: 350, height: 500 },
              type: 'jpg'
            })
          ],
          alignment: AlignmentType.CENTER
        })
      ]
    });
  }

  const doc = new Document({ sections });
  const buf = await Packer.toBuffer(doc);
  const zip = await JSZip.loadAsync(buf);
  let docXml = await zip.file('word/document.xml').async('text');

  const pRegex = /<w:p(?:\s+[^>]*)?>[\s\S]*?<\/w:p>/g;
  const allParagraphs = docXml.match(pRegex) || [];
  console.log(`Total raw paragraphs: ${allParagraphs.length}`);

  const imageParagraphs = allParagraphs.filter(p => p.includes('<w:drawing>') && !p.includes('<w:sectPr>'));
  console.log(`Filtered image paragraphs: ${imageParagraphs.length} (Expected: 5)`);

  for (let pIdx = 0; pIdx < imageParagraphs.length; pIdx++) {
    const originalP = imageParagraphs[pIdx];
    const pageNum = pIdx + 1;
    const marker = `<w:r><w:t>PAGE_${pageNum}_MARKER</w:t></w:r>`;
    const updatedP = originalP.replace('</w:p>', `${marker}</w:p>`);
    docXml = docXml.replace(originalP, updatedP);
  }

  zip.file('word/document.xml', docXml);
  const finalDocx = await zip.generateAsync({ type: 'nodebuffer' });
  const finalZip = await JSZip.loadAsync(finalDocx);
  const finalXml = await finalZip.file('word/document.xml').async('text');

  for (let pageNum = 1; pageNum <= 5; pageNum++) {
    const found = finalXml.includes(`PAGE_${pageNum}_MARKER`);
    console.log(`Page ${pageNum} marker injected cleanly:`, found);
  }
}

testFilter().catch(console.error);
