/**
 * Minimal, dependency-free .xlsx (OOXML) writer.
 *
 * Produces a valid single-sheet workbook using inline strings and a
 * "stored" (uncompressed) ZIP container — enough for data export, opens
 * cleanly in Excel / Google Sheets / LibreOffice. No external packages.
 */

// ---- CRC32 (for ZIP entries) ----
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---- XML helpers ----
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // strip control characters not allowed in XML 1.0
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
}

function colLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function sheetXml(headers: string[], rows: string[][]): string {
  const allRows = [headers, ...rows];
  const rowXml = allRows
    .map((cells, r) => {
      const cellXml = cells
        .map((val, c) => {
          const ref = `${colLetter(c)}${r + 1}`;
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(
            val ?? ""
          )}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cellXml}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

function workbookXml(sheetName: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(
    sheetName
  ).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
}

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;

// ---- ZIP (store method, no compression) ----
interface ZipEntry {
  name: string;
  data: Buffer;
  crc: number;
  offset: number;
}

function zip(files: { name: string; content: string }[]): Buffer {
  const chunks: Buffer[] = [];
  const entries: ZipEntry[] = [];
  let offset = 0;

  for (const f of files) {
    const data = Buffer.from(f.content, "utf8");
    const nameBuf = Buffer.from(f.name, "utf8");
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method: store
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0, 12); // mod date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra len

    entries.push({ name: f.name, data, crc, offset });
    chunks.push(local, nameBuf, data);
    offset += local.length + nameBuf.length + data.length;
  }

  const central: Buffer[] = [];
  let centralSize = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, "utf8");
    const hdr = Buffer.alloc(46);
    hdr.writeUInt32LE(0x02014b50, 0); // central dir signature
    hdr.writeUInt16LE(20, 4); // version made by
    hdr.writeUInt16LE(20, 6); // version needed
    hdr.writeUInt16LE(0, 8); // flags
    hdr.writeUInt16LE(0, 10); // method
    hdr.writeUInt16LE(0, 12); // mod time
    hdr.writeUInt16LE(0, 14); // mod date
    hdr.writeUInt32LE(e.crc, 16);
    hdr.writeUInt32LE(e.data.length, 20);
    hdr.writeUInt32LE(e.data.length, 24);
    hdr.writeUInt16LE(nameBuf.length, 28);
    hdr.writeUInt16LE(0, 30); // extra len
    hdr.writeUInt16LE(0, 32); // comment len
    hdr.writeUInt16LE(0, 34); // disk number start
    hdr.writeUInt16LE(0, 36); // internal attrs
    hdr.writeUInt32LE(0, 38); // external attrs
    hdr.writeUInt32LE(e.offset, 42); // local header offset
    central.push(hdr, nameBuf);
    centralSize += hdr.length + nameBuf.length;
  }

  const centralOffset = offset;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central dir signature
  end.writeUInt16LE(0, 4); // disk number
  end.writeUInt16LE(0, 6); // disk with central dir
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20); // comment len

  return Buffer.concat([...chunks, ...central, end]);
}

export function buildXlsx(
  headers: string[],
  rows: string[][],
  sheetName = "Data"
): Buffer {
  return zip([
    { name: "[Content_Types].xml", content: CONTENT_TYPES },
    { name: "_rels/.rels", content: ROOT_RELS },
    { name: "xl/workbook.xml", content: workbookXml(sheetName) },
    { name: "xl/_rels/workbook.xml.rels", content: WORKBOOK_RELS },
    { name: "xl/worksheets/sheet1.xml", content: sheetXml(headers, rows) },
  ]);
}
