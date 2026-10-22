import { strToU8, zipSync } from 'fflate';
import { PNG_1PX } from './docx';

const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const DGM = 'http://schemas.openxmlformats.org/drawingml/2006/diagram';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const A14 = 'http://schemas.microsoft.com/office/drawing/2010/main';
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const NS = `xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}"`;

const rels = (list: [id: string, type: string, target: string, external?: boolean][]) =>
  `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${PKG}">${list
    .map(([id, type, target, external]) => `<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"${external ? ' TargetMode="External"' : ''}/>`)
    .join('')}</Relationships>`;

const xfrm = (x: number, y: number, cx = 4000000, cy = 1000000) => `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`;
const ph = (id: number, name: string, phXml: string, body: string, pos = '') =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr>${phXml}</p:nvPr></p:nvSpPr><p:spPr>${pos}</p:spPr>${body}</p:sp>`;
const textBox = (id: number, x: number, y: number, body: string) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="TextBox ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(x, y)}</p:spPr>${body}</p:sp>`;
const txBody = (paragraphs: string) => `<p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</p:txBody>`;
const run = (text: string, rPr = '') => `<a:r>${rPr ? rPr : '<a:rPr lang="en-US"/>'}<a:t>${text}</a:t></a:r>`;
const pic = (id: number, x: number, y: number, blip: string, descr = '') =>
  `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Picture ${id}" descr="${descr}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill>${blip}</p:blipFill><p:spPr>${xfrm(x, y, 3048000, 1000000)}</p:spPr></p:pic>`;
const slideXml = (shapes: string, attrs = '') =>
  `<?xml version="1.0" encoding="UTF-8"?><p:sld ${NS}${attrs}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shapes}</p:spTree></p:cSld></p:sld>`;

/**
 * Three-slide presentation for fixtures:
 *   1. "Lab 3 Results": a bulleted body (two levels, bold run, link to example.com and a
 *      javascript: link), a picture, a numbered text box, an equation x/2, a linked
 *      remote image and an EMF picture, a footnote text box listed first in the XML but
 *      placed last on the slide, and speaker notes.
 *   2. "Data": a table with a merged header, a column chart, and SmartArt.
 *   3. Hidden "Backup" slide with a grouped text box.
 *   4. "Gallery": three pictures in a row (the middle one cropped) with centered
 *      captions under them (listed out of order in the XML), a theme-colored rounded
 *      "Step 1" shape, a connector line, and a light gray background.
 * The master has a theme (Georgia/Verdana, blue accent1), text sizes, and a footer bar.
 */
export function makePptx(): Uint8Array {
  const master = `<?xml version="1.0" encoding="UTF-8"?><p:sldMaster ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
${ph(2, 'Title', '<p:ph type="title"/>', txBody('<a:p/>'), xfrm(838200, 365125))}
${ph(3, 'Body', '<p:ph type="body" idx="1"/>', txBody('<a:p/>'), xfrm(838200, 1825625))}
<p:sp><p:nvSpPr><p:cNvPr id="4" name="Footer bar"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(0, 6658000, 12192000, 200000)}<a:prstGeom prst="rect"/><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></p:spPr></p:sp>
</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:txStyles><p:titleStyle><a:lvl1pPr><a:buNone/><a:defRPr sz="4400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle>
<p:bodyStyle><a:lvl1pPr marL="228600" indent="-228600"><a:buFont typeface="Arial"/><a:buChar char="•"/><a:defRPr sz="2800"/></a:lvl1pPr><a:lvl2pPr marL="685800" indent="-228600"><a:buFont typeface="Wingdings"/><a:buChar char="§"/><a:defRPr sz="2400"/></a:lvl2pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;
  const layout = `<?xml version="1.0" encoding="UTF-8"?><p:sldLayout ${NS}><p:cSld name="Title and Content"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
${ph(2, 'Title', '<p:ph type="title"/>', txBody('<a:p><a:r><a:t>Click to add title</a:t></a:r></a:p>'))}
${ph(3, 'Content', '<p:ph idx="1"/>', txBody('<a:p><a:r><a:t>Click to add text</a:t></a:r></a:p>'))}
</p:spTree></p:cSld></p:sldLayout>`;

  const equation = `<mc:AlternateContent xmlns:mc="${MC}" xmlns:a14="${A14}"><mc:Choice Requires="a14">${textBox(
    9, 838200, 4200000,
    txBody(`<a:p><a14:m><m:oMathPara xmlns:m="${M}"><m:oMath><m:r><m:t>y=</m:t></m:r><m:f><m:num><m:r><m:t>x</m:t></m:r></m:num><m:den><m:r><m:t>2</m:t></m:r></m:den></m:f></m:oMath></m:oMathPara></a14:m></a:p>`),
  )}</mc:Choice><mc:Fallback>${pic(9, 838200, 4200000, '<a:blip r:embed="rId9"/>')}</mc:Fallback></mc:AlternateContent>`;

  const slide1 = slideXml(`
${textBox(8, 838200, 6000000, txBody('<a:p><a:r><a:t>Footnote text</a:t></a:r></a:p>'))}
${ph(2, 'Title 1', '<p:ph type="title"/>', txBody(`<a:p>${run('Lab 3 Results')}</a:p>`))}
${ph(3, 'Content 2', '<p:ph idx="1"/>', txBody(
    `<a:p>${run('Measured ')}${run('voltage', '<a:rPr lang="en-US" b="1"/>')}</a:p>` +
    `<a:p><a:pPr lvl="1"/>${run('within 5%')}</a:p>` +
    `<a:p>${run('See ')}${run('the docs', '<a:rPr lang="en-US"><a:hlinkClick r:id="rId4"/></a:rPr>')}${run(' or ')}${run('this', '<a:rPr lang="en-US"><a:hlinkClick r:id="rId5"/></a:rPr>')}</a:p>`,
  ), xfrm(838200, 1825625, 5000000, 2000000))}
${pic(4, 6400000, 1900000, '<a:blip r:embed="rId3"/>', 'Circuit photo')}
${textBox(5, 838200, 3900000, txBody(`<a:p><a:pPr><a:buAutoNum type="arabicPeriod"/></a:pPr>${run('First step')}</a:p><a:p><a:pPr><a:buAutoNum type="arabicPeriod"/></a:pPr>${run('Second step')}</a:p>`))}
${equation}
${pic(6, 838200, 5000000, '<a:blip r:link="rId6"/>')}
${pic(7, 6400000, 5000000, '<a:blip r:embed="rId7"/>')}
`);

  const table = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="838200" y="1500000"/><a:ext cx="6000000" cy="1000000"/></p:xfrm><a:graphic><a:graphicData uri="${A}/table"><a:tbl><a:tblGrid><a:gridCol w="3000000"/><a:gridCol w="3000000"/></a:tblGrid>
<a:tr h="370840"><a:tc gridSpan="2">${txBody(`<a:p>${run('Trial results')}</a:p>`).replace(/p:txBody/g, 'a:txBody')}</a:tc><a:tc hMerge="1"><a:txBody><a:bodyPr/><a:p/></a:txBody></a:tc></a:tr>
<a:tr h="370840"><a:tc><a:txBody><a:bodyPr/><a:p>${run('Trial 1')}</a:p></a:txBody></a:tc><a:tc><a:txBody><a:bodyPr/><a:p>${run('4.98 V')}</a:p></a:txBody></a:tc></a:tr>
</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
  const chartFrame = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="3" name="Chart"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="838200" y="3000000"/><a:ext cx="6000000" cy="2000000"/></p:xfrm><a:graphic><a:graphicData uri="${C}"><c:chart xmlns:c="${C}" r:id="rId3"/></a:graphicData></a:graphic></p:graphicFrame>`;
  const smartArt = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Diagram"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="838200" y="5200000"/><a:ext cx="6000000" cy="1000000"/></p:xfrm><a:graphic><a:graphicData uri="${DGM}"><dgm:relIds xmlns:dgm="${DGM}" r:dm="rId4" r:lo="rId5" r:qs="rId6" r:cs="rId7"/></a:graphicData></a:graphic></p:graphicFrame>`;
  const slide2 = slideXml(`${ph(2, 'Title 1', '<p:ph type="title"/>', txBody(`<a:p>${run('Data')}</a:p>`))}${smartArt}${chartFrame}${table}`);

  const chart = `<?xml version="1.0" encoding="UTF-8"?><c:chartSpace xmlns:c="${C}" xmlns:a="${A}"><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>Voltage by trial</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:barChart><c:barDir val="col"/>
<c:ser><c:idx val="0"/><c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Volts</c:v></c:pt></c:strCache></c:strRef></c:tx>
<c:cat><c:strRef><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>Trial 1</c:v></c:pt><c:pt idx="1"><c:v>Trial 2</c:v></c:pt></c:strCache></c:strRef></c:cat>
<c:val><c:numRef><c:numCache><c:formatCode>0.00</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>4.98</c:v></c:pt><c:pt idx="1"><c:v>5.1</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser>
</c:barChart></c:plotArea></c:chart></c:chartSpace>`;

  const diagram = `<?xml version="1.0" encoding="UTF-8"?><dgm:dataModel xmlns:dgm="${DGM}" xmlns:a="${A}"><dgm:ptLst>
<dgm:pt modelId="0" type="doc"><dgm:t><a:bodyPr/><a:p/></dgm:t></dgm:pt>
<dgm:pt modelId="1"><dgm:t><a:bodyPr/><a:p><a:r><a:t>Design</a:t></a:r></a:p></dgm:t></dgm:pt>
<dgm:pt modelId="2"><dgm:t><a:bodyPr/><a:p><a:r><a:t>Build</a:t></a:r></a:p></dgm:t></dgm:pt>
<dgm:pt modelId="3"><dgm:t><a:bodyPr/><a:p><a:r><a:t>Solder parts</a:t></a:r></a:p></dgm:t></dgm:pt>
<dgm:pt modelId="9" type="sibTrans"><dgm:t><a:bodyPr/><a:p><a:r><a:t>ignored</a:t></a:r></a:p></dgm:t></dgm:pt>
</dgm:ptLst><dgm:cxnLst><dgm:cxn modelId="10" srcId="0" destId="2" srcOrd="1"/><dgm:cxn modelId="11" srcId="0" destId="1" srcOrd="0"/><dgm:cxn modelId="12" srcId="2" destId="3" srcOrd="0"/><dgm:cxn modelId="13" type="presOf" srcId="1" destId="3" srcOrd="0"/></dgm:cxnLst></dgm:dataModel>`;

  const group = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="5" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="100000" y="100000"/><a:ext cx="2000000" cy="1000000"/><a:chOff x="0" y="0"/><a:chExt cx="2000000" cy="1000000"/></a:xfrm></p:grpSpPr>${textBox(6, 0, 0, txBody(`<a:p>${run('Grouped note')}</a:p>`))}</p:grpSp>`;
  const slide3 = slideXml(`${group}${ph(2, 'Title 1', '<p:ph type="title"/>', txBody(`<a:p>${run('Backup')}</a:p>`))}`, ' show="0"');

  const caption = (id: number, x: number, text: string) =>
    textBox(id, x, 3600000, txBody(`<a:p><a:pPr algn="ctr"/>${run(text, '<a:rPr lang="en-US" sz="1400"/>')}</a:p>`)).replace(xfrm(x, 3600000), xfrm(x, 3600000, 3000000, 400000));
  const galleryPic = (id: number, x: number, crop = '') =>
    pic(id, x, 1500000, `<a:blip r:embed="rId2"/>${crop}<a:stretch><a:fillRect/></a:stretch>`).replace(xfrm(x, 1500000, 3048000, 1000000), xfrm(x, 1500000, 3000000, 2000000));
  const step = `<p:sp><p:nvSpPr><p:cNvPr id="20" name="Step"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(500000, 4500000, 2000000, 800000)}<a:prstGeom prst="roundRect"/></p:spPr><p:style><a:lnRef idx="2"><a:schemeClr val="accent2"><a:shade val="50000"/></a:schemeClr></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent2"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent2"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style><p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/>${run('Step 1')}</a:p></p:txBody></p:sp>`;
  const connector = `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="21" name="Arrow"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrm(2500000, 4900000, 2000000, 0)}<a:prstGeom prst="straightConnector1"/><a:ln w="25400"><a:solidFill><a:srgbClr val="333333"/></a:solidFill></a:ln></p:spPr></p:cxnSp>`;
  const slide4 = slideXml(
    `${ph(2, 'Title 1', '<p:ph type="title"/>', txBody(`<a:p>${run('Gallery')}</a:p>`))}` +
      caption(13, 8500000, 'Figure 3: Final build') + caption(11, 500000, 'Figure 1: Breadboard') + caption(12, 4500000, 'Figure 2: Scope trace') +
      galleryPic(14, 500000) + galleryPic(15, 4500000, '<a:srcRect l="10000" r="10000"/>') + galleryPic(16, 8500000) + step + connector,
  ).replace('<p:cSld>', '<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="F0F0F0"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>');

  const theme = `<?xml version="1.0" encoding="UTF-8"?><a:theme xmlns:a="${A}" name="Test"><a:themeElements><a:clrScheme name="Test"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2A44"/></a:dk2><a:lt2><a:srgbClr val="EEEEEE"/></a:lt2><a:accent1><a:srgbClr val="1E5AA8"/></a:accent1><a:accent2><a:srgbClr val="C0504D"/></a:accent2><a:accent3><a:srgbClr val="9BBB59"/></a:accent3><a:accent4><a:srgbClr val="8064A2"/></a:accent4><a:accent5><a:srgbClr val="4BACC6"/></a:accent5><a:accent6><a:srgbClr val="F79646"/></a:accent6><a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme><a:fontScheme name="Test"><a:majorFont><a:latin typeface="Georgia"/></a:majorFont><a:minorFont><a:latin typeface="Verdana"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`;

  const notes = `<?xml version="1.0" encoding="UTF-8"?><p:notes ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
${ph(2, 'Slide Image', '<p:ph type="sldImg"/>', '')}
${ph(3, 'Notes', '<p:ph type="body" idx="1"/>', txBody(`<a:p>${run('Remember to mention error bars')}</a:p>`))}
${ph(4, 'Number', '<p:ph type="sldNum" idx="5"/>', txBody(`<a:p>${run('1')}</a:p>`))}
</p:spTree></p:cSld></p:notes>`;

  return zipSync({
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/></Types>`),
    '_rels/.rels': strToU8(rels([['rId1', 'officeDocument', 'ppt/presentation.xml']])),
    'ppt/presentation.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/><p:sldId id="258" r:id="rId4"/><p:sldId id="259" r:id="rId5"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`),
    'ppt/_rels/presentation.xml.rels': strToU8(rels([
      ['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'],
      ['rId2', 'slide', 'slides/slide1.xml'],
      ['rId3', 'slide', 'slides/slide2.xml'],
      ['rId4', 'slide', '/ppt/slides/slide3.xml'],
      ['rId5', 'slide', 'slides/slide4.xml'],
    ])),
    'ppt/slideMasters/slideMaster1.xml': strToU8(master),
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': strToU8(rels([['rId1', 'theme', '../theme/theme1.xml']])),
    'ppt/theme/theme1.xml': strToU8(theme),
    'ppt/slideLayouts/slideLayout1.xml': strToU8(layout),
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': strToU8(rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']])),
    'ppt/slides/slide1.xml': strToU8(slide1),
    'ppt/slides/_rels/slide1.xml.rels': strToU8(rels([
      ['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'],
      ['rId2', 'notesSlide', '../notesSlides/notesSlide1.xml'],
      ['rId3', 'image', '../media/image1.png'],
      ['rId4', 'hyperlink', 'https://example.com/docs', true],
      ['rId5', 'hyperlink', 'javascript:alert(1)', true],
      ['rId6', 'image', 'https://tracker.example/pixel.png', true],
      ['rId7', 'image', '../media/image2.emf'],
      ['rId9', 'image', '../media/image1.png'],
    ])),
    'ppt/slides/slide2.xml': strToU8(slide2),
    'ppt/slides/_rels/slide2.xml.rels': strToU8(rels([
      ['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'],
      ['rId3', 'chart', '../charts/chart1.xml'],
      ['rId4', 'diagramData', '../diagrams/data1.xml'],
    ])),
    'ppt/slides/slide3.xml': strToU8(slide3),
    'ppt/slides/_rels/slide3.xml.rels': strToU8(rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']])),
    'ppt/slides/slide4.xml': strToU8(slide4),
    'ppt/slides/_rels/slide4.xml.rels': strToU8(rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'image', '../media/image1.png']])),
    'ppt/notesSlides/notesSlide1.xml': strToU8(notes),
    'ppt/charts/chart1.xml': strToU8(chart),
    'ppt/diagrams/data1.xml': strToU8(diagram),
    'ppt/media/image1.png': PNG_1PX,
    'ppt/media/image2.emf': new Uint8Array([1, 0, 0, 0]),
  });
}
