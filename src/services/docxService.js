const {
  Document,
  Packer,
  Paragraph,
  ImageRun,
  AlignmentType,
  LineRuleType
} = require('docx');
const sharp = require('sharp');
const JSZip = require('jszip');

/**
 * Convert pixel to OpenXML Twips (1 px = 15 Twips at 96 DPI)
 */
function pxToTwips(px) {
  return Math.round(px * 15);
}

// Unified standard width for all pages (350px = 5,250 Twips = ~9.26cm Compact Manga Size)
const UNIFIED_WIDTH_PX = 350;
const UNIFIED_WIDTH_TWIPS = pxToTwips(UNIFIED_WIDTH_PX); // 5,250 Twips
// Microsoft Word maximum safe page height limit (31,000 Twips = ~2,066px)
const MAX_WORD_TWIPS = 31000;
const MIN_WORD_TWIPS = 720;
// 1 px = 9525 EMUs (English Metric Units) in OpenXML DrawingML
const EMU_PER_PX = 9525;

/**
 * Generate a 100% Microsoft Word (.docx) compliant document
 * where ALL pages have the EXACT SAME uniform width (350px / 5,250 Twips),
 * height dynamically and automatically follows each image's true aspect ratio (zero distortion),
 * and speech bubbles are embedded as native EDITABLE Word Text Boxes (No Fill, No Outline, Khmer OS Battambang 9pt, White Shading).
 */
async function generateDocxWithKhmerScript(pageImages = [], ocrItems = [], title = 'Manga Document') {
  if (!pageImages || pageImages.length === 0) {
    throw new Error('No images provided for DOCX generation');
  }

  const sections = [];
  const pageMetrics = [];

  for (let pIdx = 0; pIdx < pageImages.length; pIdx++) {
    const pageObj = pageImages[pIdx];
    const pageNum = pIdx + 1;
    let imgBuffer = pageObj.buffer;

    if (!imgBuffer || imgBuffer.length === 0) {
      continue;
    }

    // 1. Read image metadata to calculate aspect ratio
    let rawWidth = 350;
    let rawHeight = 525;
    try {
      const metadata = await sharp(imgBuffer).metadata();
      rawWidth = metadata.width || 350;
      rawHeight = metadata.height || 525;
      imgBuffer = await sharp(imgBuffer).jpeg({ quality: 95 }).toBuffer();
    } catch (err) {
      console.warn(`[DocxService] Image normalization warning on page ${pageNum}:`, err.message);
      continue;
    }

    // 2. Calculate Height proportionally based on UNIFIED_WIDTH_PX (Equal Width = 350px)
    let targetWidthPx = UNIFIED_WIDTH_PX;
    const scale = targetWidthPx / rawWidth;
    let targetHeightPx = Math.round(rawHeight * scale);

    let widthTwips = UNIFIED_WIDTH_TWIPS;
    let heightTwips = pxToTwips(targetHeightPx);

    // If an ultra-long strip still exceeds Word's maximum height limit (31,000 Twips),
    // scale BOTH width and height proportionally so the whole image fits 100% on 1 page without cutting!
    if (heightTwips > MAX_WORD_TWIPS) {
      const shrinkRatio = MAX_WORD_TWIPS / heightTwips;
      heightTwips = MAX_WORD_TWIPS;
      targetHeightPx = Math.floor(MAX_WORD_TWIPS / 15);
      targetWidthPx = Math.round(targetWidthPx * shrinkRatio);
    }
    heightTwips = Math.max(MIN_WORD_TWIPS, heightTwips);

    pageMetrics.push({
      pageNum,
      widthPx: targetWidthPx,
      heightPx: targetHeightPx,
      widthTwips,
      heightTwips
    });

    // 3. Section with UNIFIED WIDTH for every page + Dynamic Aspect Ratio Height + Zero Margins
    sections.push({
      properties: {
        page: {
          size: {
            width: widthTwips,       // Uniform 5,250 Twips (350px)
            height: heightTwips + 20 // Dynamic height matching image aspect ratio
          },
          margin: {
            top: 0,
            bottom: 0,
            left: 0,
            right: 0
          }
        }
      },
      children: [
        new Paragraph({
          children: [
            new ImageRun({
              data: imgBuffer,
              transformation: {
                width: targetWidthPx,
                height: targetHeightPx
              },
              type: 'jpg'
            })
          ],
          alignment: AlignmentType.CENTER,
          spacing: {
            before: 0,
            after: 0,
            line: 20,
            lineRule: LineRuleType.EXACTLY
          }
        })
      ]
    });
  }

  if (sections.length === 0) {
    throw new Error('No valid image sections could be generated for DOCX');
  }

  const doc = new Document({
    title: title || 'Manga Document',
    description: 'High-Definition Uniform-Width Manga Document with Editable Shapes',
    sections: sections
  });

  const baseDocxBuf = await Packer.toBuffer(doc);

  // If there are no OCR speech bubbles, return base document directly
  if (!ocrItems || ocrItems.length === 0) {
    return baseDocxBuf;
  }

  // 4. Inject Native DrawingML Editable Shapes into document.xml using JSZip
  try {
    const zip = await JSZip.loadAsync(baseDocxBuf);
    let docXml = await zip.file('word/document.xml').async('text');

    // Extract ONLY genuine image paragraphs (filter out Section Break paragraphs <w:sectPr>)
    const pRegex = /<w:p(?:\s+[^>]*)?>[\s\S]*?<\/w:p>/g;
    const allParagraphs = docXml.match(pRegex) || [];
    const imageParagraphs = allParagraphs.filter(p => p.includes('<w:drawing>') && !p.includes('<w:sectPr>'));

    let modified = false;
    let shapeIdCounter = 200;

    for (let pIdx = 0; pIdx < Math.min(imageParagraphs.length, pageMetrics.length); pIdx++) {
      const pXml = imageParagraphs[pIdx];
      const metrics = pageMetrics[pIdx];
      const pageNum = metrics.pageNum;

      const pageBoxes = ocrItems.filter(item => parseInt(item.pageNum || 1, 10) === pageNum);
      if (pageBoxes.length === 0) continue;

      let shapesXml = '';

      pageBoxes.forEach((item, itemIdx) => {
        const transText = (item.transText || item.khmer_translation || item.lineText || '').trim();
        if (!transText) return;

        // Coordinates resolution from box_2d [ymin, xmin, ymax, xmax] normalized 0-1000
        let leftEmu = 0;
        let topEmu = 0;
        let widthEmu = Math.round(metrics.widthPx * 0.5 * EMU_PER_PX);
        let heightEmu = Math.round(metrics.heightPx * 0.08 * EMU_PER_PX);

        let rawBox = item.box_2d;
        if (typeof rawBox === 'string') {
          try { rawBox = JSON.parse(rawBox); } catch (e) { rawBox = null; }
        }

        if (Array.isArray(rawBox) && rawBox.length === 4) {
          const [ymin, xmin, ymax, xmax] = rawBox.map(Number);
          const topPct = Math.max(0, Math.min(0.96, ymin / 1000));
          const leftPct = Math.max(0, Math.min(0.96, xmin / 1000));
          const widthPct = Math.max(0.06, Math.min(0.98 - leftPct, (xmax - xmin) / 1000));
          const heightPct = Math.max(0.04, Math.min(0.98 - topPct, (ymax - ymin) / 1000));

          const leftPx = Math.round(metrics.widthPx * leftPct);
          const topPx = Math.round(metrics.heightPx * topPct);
          const widthPx = Math.round(metrics.widthPx * widthPct);
          const heightPx = Math.round(metrics.heightPx * heightPct);

          leftEmu = Math.round(leftPx * EMU_PER_PX);
          topEmu = Math.round(topPx * EMU_PER_PX);
          widthEmu = Math.round(widthPx * EMU_PER_PX);
          heightEmu = Math.round(heightPx * EMU_PER_PX);
        } else {
          const itemTopPct = 0.15 + ((itemIdx % 6) * 0.14);
          leftEmu = Math.round(metrics.widthPx * 0.15 * EMU_PER_PX);
          topEmu = Math.round(metrics.heightPx * itemTopPct * EMU_PER_PX);
          widthEmu = Math.round(metrics.widthPx * 0.7 * EMU_PER_PX);
          heightEmu = Math.round(metrics.heightPx * 0.1 * EMU_PER_PX);
        }

        shapeIdCounter++;
        const shapeId = shapeIdCounter;

        // Split multiple lines for natural typesetting and clean trailing '។'
        const cleanTrans = (transText || '').replace(/[\s\u17D4]+$/g, '').trim();
        const lines = cleanTrans.split(/\r?\n/).map(l => l.replace(/[\s\u17D4]+$/g, '').trim()).filter(l => l.length > 0);
        const textLines = lines.length > 0 ? lines : (cleanTrans ? [cleanTrans] : []);

        const innerParagraphsXml = textLines.map(line => `
          <w:p>
            <w:pPr>
              <w:jc w:val="center"/>
              <w:spacing w:line="192" w:lineRule="auto" w:before="0" w:after="0"/>
            </w:pPr>
            <w:r>
              <w:rPr>
                <w:rFonts w:ascii="DaunPenh" w:hAnsi="DaunPenh" w:cs="DaunPenh"/>
                <w:sz w:val="24"/>
                <w:szCs w:val="24"/>
                <w:color w:val="000000"/>
              </w:rPr>
              <w:t xml:space="preserve">${line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</w:t>
            </w:r>
          </w:p>
        `).join('');

        // Floating Shape strictly [In Front of Text] (behindDoc="0", wrapNone, zero insets, White Oval Fill)
        shapesXml += `
          <w:r>
            <w:drawing>
              <wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251658240" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">
                <wp:simplePos x="0" y="0"/>
                <wp:positionH relativeFrom="page">
                  <wp:posOffset>${leftEmu}</wp:posOffset>
                </wp:positionH>
                <wp:positionV relativeFrom="page">
                  <wp:posOffset>${topEmu}</wp:posOffset>
                </wp:positionV>
                <wp:extent cx="${widthEmu}" cy="${heightEmu}"/>
                <wp:effectExtent l="0" t="0" r="0" b="0"/>
                <wp:wrapNone/>
                <wp:docPr id="${shapeId}" name="KhmerBubble_${shapeId}"/>
                <wp:cNvGraphicFramePr/>
                <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                  <a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
                    <wps:wsp xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
                      <wps:cNvSpPr/>
                      <wps:spPr>
                        <a:xfrm>
                          <a:off x="0" y="0"/>
                          <a:ext cx="${widthEmu}" cy="${heightEmu}"/>
                        </a:xfrm>
                        <a:prstGeom prst="ellipse">
                          <a:avLst/>
                        </a:prstGeom>
                        <a:solidFill>
                          <a:srgbClr val="FFFFFF"/>
                        </a:solidFill>
                        <a:ln>
                          <a:noFill/>
                        </a:ln>
                      </wps:spPr>
                      <wps:txbx>
                        <w:txbxContent>
                          ${innerParagraphsXml}
                        </w:txbxContent>
                      </wps:txbx>
                      <wps:bodyPr vert="horz" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr"/>
                    </wps:wsp>
                  </a:graphicData>
                </a:graphic>
              </wp:anchor>
            </w:drawing>
          </w:r>
        `;
      });

      if (shapesXml) {
        const updatedParagraph = pXml.replace('</w:p>', `${shapesXml}</w:p>`);
        docXml = docXml.replace(pXml, updatedParagraph);
        modified = true;
      }
    }

    if (modified) {
      zip.file('word/document.xml', docXml);
      return await zip.generateAsync({ type: 'nodebuffer' });
    }
  } catch (err) {
    console.warn('[DocxService] Warning during DrawingML shape injection:', err.message);
  }

  return baseDocxBuf;
}

/**
 * Generate standard DOCX without OCR transcript (Visual Pages Only)
 */
async function generateDocxFromImages(imageItems = []) {
  return await generateDocxWithKhmerScript(imageItems, [], 'Manga Document');
}

module.exports = {
  generateDocxFromImages,
  generateDocxWithKhmerScript,
  generateDocxVisualManga: generateDocxWithKhmerScript,
  generateDocxWithEditableShapes: generateDocxWithKhmerScript
};