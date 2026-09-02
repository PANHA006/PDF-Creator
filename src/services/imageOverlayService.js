const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

// Register Khmer and common Windows fonts
const fontCandidates = [
  { path: 'C:\\Windows\\Fonts\\KhmerOScontent.ttf', family: 'Khmer OS Content' },
  { path: 'C:\\Windows\\Fonts\\KhmerOSbattambang.ttf', family: 'Khmer OS Battambang' },
  { path: 'C:\\Windows\\Fonts\\KhmerOSsiemreap.ttf', family: 'Khmer OS Siemreap' },
  { path: 'C:\\Windows\\Fonts\\KhmerOS.ttf', family: 'Khmer OS' },
  { path: 'C:\\Windows\\Fonts\\KhmerUI.ttf', family: 'Khmer UI' },
  { path: 'C:\\Windows\\Fonts\\khmerui.ttf', family: 'Khmer UI' },
  { path: 'C:\\Windows\\Fonts\\KhmerUIb.ttf', family: 'Khmer UI Bold' },
  { path: 'C:\\Windows\\Fonts\\daunpenh.ttf', family: 'DaunPenh' },
  { path: 'C:\\Windows\\Fonts\\moolboran.ttf', family: 'MoolBoran' },
  { path: 'C:\\Windows\\Fonts\\segoeui.ttf', family: 'Segoe UI' },
  { path: 'C:\\Windows\\Fonts\\arial.ttf', family: 'Arial' }
];

let registeredKhmerFont = 'sans-serif';
for (const font of fontCandidates) {
  if (fs.existsSync(font.path)) {
    try {
      GlobalFonts.registerFromPath(font.path, font.family);
      if (registeredKhmerFont === 'sans-serif') {
        registeredKhmerFont = `"${font.family}", sans-serif`;
      }
    } catch (err) {
      console.warn(`Font registration failed for ${font.family}:`, err.message);
    }
  }
}

/**
 * Draws a rounded rectangle path on canvas
 */
function drawRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * Renders Khmer dialogue text overlays on an image buffer.
 * Erases original speech bubble text with white fill and draws wrapped Khmer text.
 * @param {Buffer} imageBuffer - Input image buffer (PNG/JPEG)
 * @param {Array} ocrItems - List of OCR dialogue items
 * @returns {Promise<Buffer>} - Rendered PNG image buffer
 */
async function renderMangaPageKhmer(imageBuffer, ocrItems = []) {
  const img = await loadImage(imageBuffer);
  const w = img.width;
  const h = img.height;

  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  // Draw background image
  ctx.drawImage(img, 0, 0, w, h);

  for (let idx = 0; idx < ocrItems.length; idx++) {
    const item = ocrItems[idx];
    const text = (item.transText || item.lineText || item.khmer_translation || '').trim();
    if (!text) continue;

    let box;

    // A. Direct Gemini Vision Bounding Box [ymin, xmin, ymax, xmax] (0-1000 scale)
    if (item.box_2d && Array.isArray(item.box_2d) && item.box_2d.length === 4) {
      const [ymin, xmin, ymax, xmax] = item.box_2d;
      const x0 = Math.max(0, Math.floor((xmin / 1000.0) * w));
      const y0 = Math.max(0, Math.floor((ymin / 1000.0) * h));
      const x1 = Math.min(w, Math.floor((xmax / 1000.0) * w));
      const y1 = Math.min(h, Math.floor((ymax / 1000.0) * h));
      box = { x0, y0, x1, y1 };
    } 
    // B. Relative Percentage (x_pct, y_pct)
    else if (!isNaN(parseFloat(item.x_pct)) && !isNaN(parseFloat(item.y_pct)) && parseFloat(item.x_pct) >= 0) {
      const xPct = parseFloat(item.x_pct);
      const yPct = parseFloat(item.y_pct);
      const cx = Math.floor((xPct / 100.0) * w);
      const cy = Math.floor((yPct / 100.0) * h);
      const bw = Math.floor(w * 0.32);
      const bh = Math.floor(h * 0.11);
      box = {
        x0: Math.max(10, cx - Math.floor(bw / 2)),
        y0: Math.max(10, cy - Math.floor(bh / 2)),
        x1: Math.min(w - 10, cx + Math.floor(bw / 2)),
        y1: Math.min(h - 10, cy + Math.floor(bh / 2))
      };
    } 
    // C. Positional Fallback
    else {
      const posHint = (item.position || '').toLowerCase();
      const rowIdx = idx % 8;
      let cx = Math.floor(w * 0.5);
      let cy = Math.floor(h * (0.10 + rowIdx * 0.11));
      const bw = Math.floor(w * 0.38);
      const bh = Math.floor(h * 0.09);

      if (posHint.includes('top')) {
        cy = Math.floor(h * (0.08 + (idx % 3) * 0.10));
      } else if (posHint.includes('bottom')) {
        cy = Math.floor(h * (0.65 + (idx % 3) * 0.10));
      }

      if (posHint.includes('left')) {
        cx = Math.floor(w * 0.28);
      } else if (posHint.includes('right')) {
        cx = Math.floor(w * 0.72);
      }

      box = {
        x0: Math.max(10, cx - Math.floor(bw / 2)),
        y0: Math.max(10, cy - Math.floor(bh / 2)),
        x1: Math.min(w - 10, cx + Math.floor(bw / 2)),
        y1: Math.min(h - 10, cy + Math.floor(bh / 2))
      };
    }

    const { x0, y0, x1, y1 } = box;
    const bwBox = Math.max(20, x1 - x0);
    const bhBox = Math.max(20, y1 - y0);

    // 1. Clean / Whiteout original speech bubble area with smooth oval/rounded-rect
    drawRoundedRect(ctx, x0, y0, bwBox, bhBox, Math.min(16, Math.floor(bhBox * 0.3)));
    ctx.fillStyle = item.bgColor || '#ffffff';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#e2e8f0';
    ctx.stroke();

    // 2. Dynamic font sizing based on bubble area & text length
    let targetFontSize = parseFloat(item.fontSize);
    if (!targetFontSize || isNaN(targetFontSize) || targetFontSize <= 0) {
      const charCount = text.length;
      if (charCount > 60) {
        targetFontSize = Math.min(14, Math.max(10, Math.floor(bhBox / 4.5)));
      } else if (charCount > 30) {
        targetFontSize = Math.min(16, Math.max(11, Math.floor(bhBox / 3.5)));
      } else {
        targetFontSize = Math.min(20, Math.max(13, Math.floor(bhBox / 2.8)));
      }
    }

    ctx.font = `bold ${targetFontSize}px ${registeredKhmerFont}`;
    ctx.fillStyle = '#09090b';
    ctx.textBaseline = 'top';

    const words = text.split(' ');
    const lines = [];
    let curLine = '';

    for (const word of words) {
      const testLine = curLine ? `${curLine} ${word}` : word;
      const metrics = ctx.measureText(testLine);
      if (metrics.width <= (bwBox - 16)) {
        curLine = testLine;
      } else {
        if (curLine) lines.push(curLine);
        curLine = word;
      }
    }
    if (curLine) lines.push(curLine);

    const lineHeight = Math.floor(targetFontSize * 1.3);
    const totalTextH = lines.length * lineHeight;
    const startY = y0 + Math.max(4, Math.floor((bhBox - totalTextH) / 2));

    for (let i = 0; i < lines.length; i++) {
      const lineStr = lines[i];
      const lineY = startY + i * lineHeight;
      if (lineY + lineHeight > y1) break;

      const metrics = ctx.measureText(lineStr);
      const lineX = x0 + Math.max(4, Math.floor((bwBox - metrics.width) / 2));
      ctx.fillText(lineStr, lineX, lineY);
    }
  }

  return canvas.toBuffer('image/png');
}

module.exports = {
  renderMangaPageKhmer,
  registeredKhmerFont
};
