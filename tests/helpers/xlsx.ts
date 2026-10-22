import { strToU8, zipSync } from 'fflate';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/**
 * Small Excel workbook for fixtures. Sheet "Results":
 *
 *   |   A        | B                 | C                      | D:E (merged) |
 * 1 | Student*   | Score*            | Pct*                   | Notes*       |   * bold on yellow, bottom border
 * 2 | alice      | 90                | =B2/100 → 90.0%        | 1/1/2023     |
 * 3 | bob        | ($1,234.50) red   | =B3/100 (shared) → -1234.5% |         |
 * 4 | TRUE       | #DIV/0!           | =SUM(B2:B3), no saved result |        |
 *
 * plus a hidden sheet "Key" with an inline string.
 */
export function makeXlsx(): Uint8Array {
  const strings = ['Student', 'Score', 'Pct', 'Notes', 'alice', 'bob'];
  const sheet1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${NS}" xmlns:r="${R}">
<sheetViews><sheetView workbookViewId="0"/></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols><col min="1" max="1" width="14" customWidth="1"/><col min="4" max="5" width="12" customWidth="1"/></cols>
<sheetData>
<row r="1"><c r="A1" s="1" t="s"><v>0</v></c><c r="B1" s="1" t="s"><v>1</v></c><c r="C1" s="1" t="s"><v>2</v></c><c r="D1" s="1" t="s"><v>3</v></c><c r="E1" s="1"/></row>
<row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2"><v>90</v></c><c r="C2" s="2"><f t="shared" ref="C2:C3" si="0">B2/100</f><v>0.9</v></c><c r="D2" s="3"><v>44927</v></c></row>
<row r="3" ht="20" customHeight="1"><c r="A3" t="s"><v>5</v></c><c r="B3" s="4"><v>-1234.5</v></c><c r="C3" s="2"><f t="shared" si="0"/><v>-12.345</v></c></row>
<row r="4"><c r="A4" t="b"><v>1</v></c><c r="B4" t="e"><v>#DIV/0!</v></c><c r="C4"><f>SUM(B2:B3)</f></c></row>
</sheetData>
<mergeCells count="1"><mergeCell ref="D1:E1"/></mergeCells>
</worksheet>`;
  const sheet2 = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="${NS}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>secret</t></is></c></row></sheetData></worksheet>`;

  const styles = `<?xml version="1.0" encoding="UTF-8"?>
<styleSheet xmlns="${NS}">
<numFmts count="2"><numFmt numFmtId="164" formatCode="0.0%"/><numFmt numFmtId="165" formatCode="&quot;$&quot;#,##0.00_);[Red]\\(&quot;$&quot;#,##0.00\\)"/></numFmts>
<fonts count="2"><font><sz val="11"/><color theme="1"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF1F4E79"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/></patternFill></fill></fills>
<borders count="2"><border/><border><bottom style="medium"><color indexed="8"/></bottom></border></borders>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1"><alignment horizontal="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0"/>
<xf numFmtId="14" fontId="0" fillId="0" borderId="0"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0"/>
</cellXfs>
</styleSheet>`;

  const shared = `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="${NS}" count="${strings.length}">${strings.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`;

  return zipSync({
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="${NS}" xmlns:r="${R}"><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="Results" sheetId="1" r:id="rId1"/><sheet name="Key" sheetId="2" state="hidden" r:id="rId2"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${R}/worksheet" Target="/xl/worksheets/sheet2.xml"/><Relationship Id="rId3" Type="${R}/styles" Target="styles.xml"/><Relationship Id="rId4" Type="${R}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`),
    'xl/worksheets/sheet1.xml': strToU8(sheet1),
    'xl/worksheets/sheet2.xml': strToU8(sheet2),
    'xl/styles.xml': strToU8(styles),
    'xl/sharedStrings.xml': strToU8(shared),
  });
}
