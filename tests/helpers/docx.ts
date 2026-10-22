import { strToU8, zipSync } from 'fflate';

/** 1×1 red PNG. */
export const PNG_1PX = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/**
 * Minimal Word document for fixtures: a heading, bold text, a table, an equation
 * (optional, since jsdom can't render MathML), an external hyperlink, an embedded
 * image, and an image linked from a remote server (which must never be fetched).
 */
export function makeDocx({ title = 'Lab Report', equation = true } = {}): Uint8Array {
  const image = (attr: string) => `<w:r><w:drawing><wp:inline><wp:extent cx="95250" cy="95250"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:blipFill><a:blip ${attr}/></pic:blipFill><pic:spPr><a:xfrm><a:ext cx="95250" cy="95250"/></a:xfrm></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${title}</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">The counter is </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>synchronous</w:t></w:r><w:r><w:t>.</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Input</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Output</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>0</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
${equation ? `<w:p><m:oMath><m:f><m:num><m:r><m:t>V</m:t></m:r></m:num><m:den><m:r><m:t>R</m:t></m:r></m:den></m:f></m:oMath></w:p>` : ''}
<w:p><w:hyperlink r:id="rIdLink"><w:r><w:t>datasheet</w:t></w:r></w:hyperlink></w:p>
<w:p>${image('r:embed="rIdImg"')}${image('r:link="rIdRemote"')}</w:p>
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
</w:body></w:document>`;

  return zipSync({
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`),
    'word/document.xml': strToU8(document),
    'word/_rels/document.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdLink" Type="${R}/hyperlink" Target="https://example.com/datasheet" TargetMode="External"/><Relationship Id="rIdImg" Type="${R}/image" Target="media/image1.png"/><Relationship Id="rIdRemote" Type="${R}/image" Target="https://tracker.example/pixel.png" TargetMode="External"/></Relationships>`),
    'word/media/image1.png': PNG_1PX,
  });
}
