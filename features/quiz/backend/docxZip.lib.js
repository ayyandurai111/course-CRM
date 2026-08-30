const zlib = require("zlib");

/**
 * A .docx file is a plain ZIP archive containing WordprocessingML XML
 * parts (word/document.xml holds the visible body text). This module
 * reads just enough of the ZIP format to locate and decompress a single
 * named entry, with zero external dependencies — the project has no
 * network access to `npm install` a library like `mammoth` or
 * `adm-zip`, and Node's built-in `zlib` already exposes raw DEFLATE
 * inflate, which is all a ZIP entry needs (ZIP framing itself is simple
 * enough to parse by hand).
 *
 * This is intentionally minimal: it only supports finding an entry by
 * name and decompressing it (STORED or DEFLATE, the only two methods
 * any real-world .docx writer — Word, LibreOffice, Google Docs — uses).
 * It is not a general-purpose ZIP library.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;

/**
 * Locates the End Of Central Directory record by scanning backward from
 * the end of the buffer (it can be followed by a variable-length
 * comment field, so its position isn't fixed).
 */
function findEndOfCentralDirectory(buf) {
  const maxCommentLength = 65535;
  const searchStart = Math.max(0, buf.length - 22 - maxCommentLength);
  for (let i = buf.length - 22; i >= searchStart; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  return -1;
}

/**
 * Reads every central directory entry into a name -> {offset, compressedSize, uncompressedSize, method} map.
 */
function readCentralDirectory(buf) {
  const eocdOffset = findEndOfCentralDirectory(buf);
  if (eocdOffset === -1) {
    throw new Error("Not a valid .docx file (ZIP end-of-central-directory record not found).");
  }
  const entryCount = buf.readUInt16LE(eocdOffset + 10);
  let cdOffset = buf.readUInt32LE(eocdOffset + 16);

  const entries = new Map();
  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(cdOffset) !== CENTRAL_DIR_SIGNATURE) {
      throw new Error("Not a valid .docx file (malformed ZIP central directory).");
    }
    const method = buf.readUInt16LE(cdOffset + 10);
    const compressedSize = buf.readUInt32LE(cdOffset + 20);
    const uncompressedSize = buf.readUInt32LE(cdOffset + 24);
    const nameLength = buf.readUInt16LE(cdOffset + 28);
    const extraLength = buf.readUInt16LE(cdOffset + 30);
    const commentLength = buf.readUInt16LE(cdOffset + 32);
    const localHeaderOffset = buf.readUInt32LE(cdOffset + 42);
    const name = buf.toString("utf8", cdOffset + 46, cdOffset + 46 + nameLength);

    entries.set(name, { method, compressedSize, uncompressedSize, localHeaderOffset });
    cdOffset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Decompresses a single named entry from the ZIP, returning a Buffer. */
function readZipEntry(buf, entries, entryName) {
  const entry = entries.get(entryName);
  if (!entry) return null;

  const off = entry.localHeaderOffset;
  if (buf.readUInt32LE(off) !== LOCAL_FILE_SIGNATURE) {
    throw new Error("Not a valid .docx file (malformed ZIP local file header).");
  }
  const nameLength = buf.readUInt16LE(off + 26);
  const extraLength = buf.readUInt16LE(off + 28);
  const dataStart = off + 30 + nameLength + extraLength;
  const compressed = buf.subarray(dataStart, dataStart + entry.compressedSize);

  if (entry.method === 0) return Buffer.from(compressed); // stored, no compression
  if (entry.method === 8) return zlib.inflateRawSync(compressed); // deflate
  throw new Error(`Unsupported ZIP compression method (${entry.method}) inside .docx file.`);
}

/**
 * Reads a named part (e.g. "word/document.xml") out of a .docx buffer.
 * Returns the part's UTF-8 text, or null if the part doesn't exist.
 */
function readDocxPart(docxBuffer, partName) {
  const entries = readCentralDirectory(docxBuffer);
  const raw = readZipEntry(docxBuffer, entries, partName);
  return raw ? raw.toString("utf8") : null;
}

module.exports = { readDocxPart };
