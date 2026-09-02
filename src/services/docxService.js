const { Document, Packer, Paragraph, ImageRun, Table, TableRow, TableCell, WidthType, AlignmentType, TextRun, HeadingLevel } = require('docx');
const sharp = require('sharp');

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


async function generateDocxWithKhmerScript(pageImages = [], ocrItems = [], mangaTitle = 'Manga Document') {
  const children = [];

  children.push(
    new Paragraph({
      text: '📖 ' + mangaTitle,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 100 }
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: 'Khmer Manga Transcript & Images | Total Pages: ' + pageImages.length,
          color: '64748b',
          size: 18,
          italics: true
        })
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 }
    })
  );

  for (let pIdx = 0; pIdx < pageImages.length; pIdx++) {
    const pageObj = pageImages[pIdx];
    const pageNum = pIdx + 1;
    let imgBuffer = pageObj.buffer;

    const metadata = await sharp(imgBuffer).metadata();
    const origW = metadata.width || 800;
    const origH = metadata.height || 1200;

    // Normalize to standard JPEG for Microsoft Word OpenXML
    imgBuffer = await sharp(imgBuffer).jpeg({ quality: 90 }).toBuffer();

    const displayW = 540;
    const displayH = Math.min(780, Math.round((origH / origW) * displayW));

    const pageItems = ocrItems.filter(item => parseInt(item.pageNum || 1, 10) === pageNum);

    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: '📄 Page ' + pageNum,
            bold: true,
            size: 24,
            color: '4338ca'
          })
        ],
        spacing: { before: 300, after: 150 }
      }),
      new Paragraph({
        children: [
          new ImageRun({
            data: imgBuffer,
            transformation: {
              width: displayW,
              height: displayH
            },
            type: 'jpg'
          })
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 }
      })
    );

    if (pageItems.length > 0) {
      const tableRows = [
        new TableRow({
          tableHeader: true,
          children: [
            new TableCell({
              width: { size: 10, type: WidthType.PERCENTAGE },
              children: [new Paragraph({ children: [new TextRun({ text: 'ID', bold: true, size: 18, color: 'ffffff' })], alignment: AlignmentType.CENTER })],
              shading: { fill: '4338ca' }
            }),
            new TableCell({
              width: { size: 45, type: WidthType.PERCENTAGE },
              children: [new Paragraph({ children: [new TextRun({ text: 'Original Text', bold: true, size: 18, color: 'ffffff' })] })],
              shading: { fill: '4338ca' }
            }),
            new TableCell({
              width: { size: 45, type: WidthType.PERCENTAGE },
              children: [new Paragraph({ children: [new TextRun({ text: 'Khmer Translation (អត្ថបទខ្មែរ)', bold: true, size: 18, color: 'ffffff' })] })],
              shading: { fill: '4338ca' }
            })
          ]
        })
      ];

      for (let i = 0; i < pageItems.length; i++) {
        const item = pageItems[i];
        const rowBg = i % 2 === 0 ? 'f8fafc' : 'ffffff';
        tableRows.push(
          new TableRow({
            children: [
              new TableCell({
                width: { size: 10, type: WidthType.PERCENTAGE },
                children: [new Paragraph({ children: [new TextRun({ text: '#' + (i + 1), size: 18, color: '64748b' })], alignment: AlignmentType.CENTER })],
                shading: { fill: rowBg }
              }),
              new TableCell({
                width: { size: 45, type: WidthType.PERCENTAGE },
                children: [new Paragraph({ children: [new TextRun({ text: item.lineText || item.original_text || '', size: 20 })] })],
                shading: { fill: rowBg }
              }),
              new TableCell({
                width: { size: 45, type: WidthType.PERCENTAGE },
                children: [new Paragraph({ children: [new TextRun({ text: item.transText || item.khmer_translation || '', bold: true, size: 20, color: '0f172a' })] })],
                shading: { fill: rowBg }
              })
            ]
          })
        );
      }

      children.push(
        new Table({
          rows: tableRows,
          width: { size: 100, type: WidthType.PERCENTAGE }
        }),
        new Paragraph({ text: '', spacing: { after: 300 } })
      );
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 720,
              bottom: 720,
              left: 720,
              right: 720
            }
          }
        },
        children: children
      }
    ]
  });

  return await Packer.toBuffer(doc);
}

module.exports = {
  generateDocxFromImages,
  generateDocxWithKhmerScript
};