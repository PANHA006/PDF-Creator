const fs = require('fs');
const JSZip = require('jszip');
const sharp = require('sharp');
const { Document, Packer, Paragraph, ImageRun, AlignmentType, LineRuleType } = require('docx');

async function testShapeGeneration() {
  console.log('Testing OpenXML DrawingML Editable Shape generation...');

  // 1. Create a sample image
  const imgBuf = await sharp({
    create: { width: 350, height: 525, channels: 3, background: { r: 80, g: 120, b: 200 } }
  }).jpeg().toBuffer();

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: 5250, height: 7895 },
          margin: { top: 0, bottom: 0, left: 0, right: 0 }
        }
      },
      children: [
        new Paragraph({
          children: [
            new ImageRun({
              data: imgBuf,
              transformation: { width: 350, height: 525 },
              type: 'jpg'
            })
          ],
          alignment: AlignmentType.CENTER
        })
      ]
    }]
  });

  const baseDocxBuf = await Packer.toBuffer(doc);
  const zip = await JSZip.loadAsync(baseDocxBuf);

  let docXml = await zip.file('word/document.xml').async('text');

  // Let's inject an editable shape text box into document.xml
  const sampleText = 'តើឯងអាចធ្វើ\nបានទេ?';
  const lines = sampleText.split('\n');
  const paragraphsXml = lines.map(line => `
    <w:p>
      <w:pPr>
        <w:jc w:val="center"/>
        <w:spacing w:line="240" w:lineRule="auto" w:before="0" w:after="0"/>
        <w:shd w:val="clear" w:color="auto" w:fill="FFFFFF"/>
      </w:pPr>
      <w:r>
        <w:rPr>
          <w:rFonts w:ascii="Khmer OS Battambang" w:hAnsi="Khmer OS Battambang" w:cs="Khmer OS Battambang"/>
          <w:sz w:val="18"/>
          <w:szCs w:val="18"/>
          <w:color w:val="000000"/>
        </w:rPr>
        <w:t xml:space="preserve">${line}</w:t>
      </w:r>
    </w:p>
  `).join('');

  // 1 EMUs = 1 / 914400 inch. 1 px = 9525 EMUs.
  // Suppose box_2d is [300, 200, 500, 600] -> on 350x525 image:
  // top = 525 * 0.3 = 157.5 px -> 157.5 * 9525 = 1500187 EMUs
  // left = 350 * 0.2 = 70 px -> 70 * 9525 = 666750 EMUs
  // width = 350 * 0.4 = 140 px -> 140 * 9525 = 1333500 EMUs
  // height = 525 * 0.2 = 105 px -> 105 * 9525 = 1000125 EMUs

  const leftEmu = 666750;
  const topEmu = 1500187;
  const widthEmu = 1333500;
  const heightEmu = 1000125;

  const shapeXml = `
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
          <wp:docPr id="101" name="KhmerBubble101"/>
          <wp:cNvGraphicFramePr/>
          <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
            <a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
              <wps:wsp xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">
                <wps:cNvSpPr txBox="1"/>
                <wps:spPr>
                  <a:xfrm>
                    <a:off x="0" y="0"/>
                    <a:ext cx="${widthEmu}" cy="${heightEmu}"/>
                  </a:xfrm>
                  <a:prstGeom prst="rect">
                    <a:avLst/>
                  </a:prstGeom>
                  <a:noFill/>
                  <a:ln>
                    <a:noFill/>
                  </a:ln>
                </wps:spPr>
                <wps:txbx>
                  <w:txbxContent>
                    ${paragraphsXml}
                  </w:txbxContent>
                </wps:txbx>
                <wps:bodyPr vert="horz" lIns="36000" tIns="36000" rIns="36000" bIns="36000" anchor="ctr"/>
              </wps:wsp>
            </a:graphicData>
          </a:graphic>
        </wp:anchor>
      </w:drawing>
    </w:r>
  `;

  // Insert shapeXml right after the image run inside the first <w:p>
  docXml = docXml.replace('</w:p>', `${shapeXml}</w:p>`);
  zip.file('word/document.xml', docXml);

  const finalDocx = await zip.generateAsync({ type: 'nodebuffer' });
  console.log('✓ Successfully generated test DOCX with editable floating shapes, size:', finalDocx.length);
}

testShapeGeneration().catch(console.error);
