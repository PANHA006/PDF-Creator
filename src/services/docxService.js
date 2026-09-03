const {
  Document,
  Packer,
  Paragraph,
  ImageRun,
  AlignmentType,
  LineRuleType
} = require('docx');
const sharp = require('sharp');
const { renderMangaPageKhmer } = require('./imageOverlayService');

/**
 * Convert pixel to OpenXML Twips (1 px = 15 Twips at 96 DPI)
 */
function pxToTwips(px) {
  return Math.round(px * 15);
}

// Unified standard width for all pages (350px = 5,250 Twips = ~9.26cm Compact Manga Size)
// 350px allows viewing 3-4 pages side-by-side in Word multi-page grid and guarantees zero slicing for tall strips
const UNIFIED_WIDTH_PX = 350;
const UNIFIED_WIDTH_TWIPS = pxToTwips(UNIFIED_WIDTH_PX); // 5,250 Twips
// Microsoft Word maximum safe page height limit (31,000 Twips = ~2,066px)
const MAX_WORD_TWIPS = 31000;
const MIN_WORD_TWIPS = 720;

/**
 * Generate a 100% Microsoft Word (.docx) compliant document
 * where ALL pages have the EXACT SAME uniform width (350px / 5,250 Twips),
 * height dynamically and automatically follows each image's true aspect ratio (zero distortion),
 * and whole images stay 100% intact on single pages without any cutting through speech bubbles.
 */
async function generateDocxWithKhmerScript(pageImages = [], ocrItems = [], title = 'Manga Document') {
  if (!pageImages || pageImages.length === 0) {
    throw new Error('No images provided for DOCX generation');
  }

  const sections = [];

  for (let pIdx = 0; pIdx < pageImages.length; pIdx++) {
    const pageObj = pageImages[pIdx];
    const pageNum = pIdx + 1;
    let imgBuffer = pageObj.buffer;

    if (!imgBuffer || imgBuffer.length === 0) {
      continue;
    }

    const pageBoxes = ocrItems.filter(item => parseInt(item.pageNum || 1, 10) === pageNum);

    // 1. Overlay clean solid-white speech bubbles & Khmer text if translations exist
    if (pageBoxes.length > 0) {
      try {
        imgBuffer = await renderMangaPageKhmer(imgBuffer, pageBoxes);
      } catch (err) {
        console.warn(`[DocxService] Overlay warning on page ${pageNum}:`, err.message);
      }
    }

    // 2. Read image metadata to calculate aspect ratio
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

    // 3. Calculate Height proportionally based on UNIFIED_WIDTH_PX (Equal Width = 350px)
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

    // 4. Section with UNIFIED WIDTH for every page + Dynamic Aspect Ratio Height + Zero Margins
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
    description: 'High-Definition Uniform-Width Manga Document (350px)',
    sections: sections
  });

  return await Packer.toBuffer(doc);
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