const { Document, Packer, Paragraph, ImageRun, AlignmentType } = require('docx');
const sharp = require('sharp');
const { renderMangaPageKhmer } = require('./imageOverlayService');

function pxToTwips(px) {
  return Math.round(px * 15);
}

async function generateDocxFromImages(imageItems = []) {
  if (!imageItems || imageItems.length === 0) {
    throw new Error('No images provided for DOCX generation');
  }

  const sections = [];

  for (let i = 0; i < imageItems.length; i++) {
    const item = imageItems[i];
    let imgBuffer = item.buffer;
    
    const metadata = await sharp(imgBuffer).metadata();
    let rawWidth = metadata.width || 800;
    let rawHeight = metadata.height || 1200;

    // Always normalize to standard JPEG buffer for Microsoft Word OpenXML parser
    imgBuffer = await sharp(imgBuffer).jpeg({ quality: 92 }).toBuffer();

    const targetWidthPx = Math.min(1000, Math.max(500, rawWidth));
    const scale = targetWidthPx / rawWidth;
    let targetHeightPx = Math.round(rawHeight * scale);

    const MAX_WORD_HEIGHT_PX = 1800;
    let finalWidthPx = targetWidthPx;
    if (targetHeightPx > MAX_WORD_HEIGHT_PX) {
      const shrinkRatio = MAX_WORD_HEIGHT_PX / targetHeightPx;
      targetHeightPx = MAX_WORD_HEIGHT_PX;
      finalWidthPx = Math.round(targetWidthPx * shrinkRatio);
    }

    const widthTwips = Math.min(31680, Math.max(720, pxToTwips(finalWidthPx)));
    const heightTwips = Math.min(31680, Math.max(720, pxToTwips(targetHeightPx)));

    sections.push({
      properties: {
        page: {
          size: {
            width: widthTwips,
            height: heightTwips
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
                width: finalWidthPx,
                height: targetHeightPx
              },
              type: 'jpg'
            })
          ],
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 0 }
        })
      ]
    });
  }

  const doc = new Document({
    sections: sections
  });

  return await Packer.toBuffer(doc);
}

/**
 * Generate 1:1 Full-page Visual Manga Word (.docx) document with Khmer speech bubbles burned onto images
 */
async function generateDocxVisualManga(pageImages = [], ocrItems = [], mangaTitle = 'Manga Document') {
  if (!pageImages || pageImages.length === 0) {
    throw new Error('No images provided for DOCX generation');
  }

  const renderedPages = [];

  for (let pIdx = 0; pIdx < pageImages.length; pIdx++) {
    const pageObj = pageImages[pIdx];
    const pageNum = pIdx + 1;
    let imgBuffer = pageObj.buffer;

    const pageItems = ocrItems.filter(item => parseInt(item.pageNum || 1, 10) === pageNum);

    // If there are Khmer translations for this page, render them onto the image buffer!
    if (pageItems.length > 0) {
      try {
        imgBuffer = await renderMangaPageKhmer(imgBuffer, pageItems);
      } catch (err) {
        console.warn(`[DocxService] Failed to overlay Khmer text on page ${pageNum}:`, err.message);
      }
    }

    renderedPages.push({
      pageNum,
      buffer: imgBuffer,
      name: pageObj.name || `page_${pageNum}.jpg`
    });
  }

  return await generateDocxFromImages(renderedPages);
}

module.exports = {
  generateDocxFromImages,
  generateDocxWithKhmerScript: generateDocxVisualManga,
  generateDocxVisualManga
};