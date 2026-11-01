/**
 * Minimal text-only PDF writer with no dependencies.
 * Owner: Harsh Pandya | PES1UG24CS182
 * REQ-7.3 | ARC-RPT | DSN-07
 */
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 50;
const LINE_HEIGHT = 15;
const FONT_SIZE = 10;
const HEADING_SIZE = 16;
const WRAP_COLUMNS = 90;
const LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - 2 * MARGIN) / LINE_HEIGHT);

// Helvetica with WinAnsiEncoding can't show other characters, so they become '?'.
function toPdfString(text) {
  return String(text)
    .replace(/\s+/g, ' ')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')
    .replace(/[\\()]/g, '\\$&');
}

function wrap(text, indent = '') {
  const lines = [];
  let current = indent;
  String(text).split(/\s+/).filter(Boolean).forEach(word => {
    while (word.length > WRAP_COLUMNS - indent.length) {
      if (current !== indent) {
        lines.push(current);
        current = indent;
      }
      lines.push(indent + word.slice(0, WRAP_COLUMNS - indent.length));
      word = word.slice(WRAP_COLUMNS - indent.length);
    }
    const separator = current === indent ? '' : ' ';
    if ((current + separator + word).length > WRAP_COLUMNS) {
      lines.push(current);
      current = indent + word;
    } else {
      current += separator + word;
    }
  });
  if (current !== indent) lines.push(current);
  return lines.length ? lines : [''];
}

function pageContent(lines, { heading }) {
  const commands = ['BT', `1 0 0 1 ${MARGIN} ${PAGE_HEIGHT - MARGIN} Tm`, `${LINE_HEIGHT} TL`];
  lines.forEach((line, index) => {
    const size = heading && index === 0 ? HEADING_SIZE : FONT_SIZE;
    commands.push(`/F1 ${size} Tf`, `(${toPdfString(line)}) Tj`, 'T*');
  });
  commands.push('ET');
  return commands.join('\n');
}

/**
 * Builds a PDF from a heading and lines of text, adding wrapping and pages as needed.
 */
function buildPdf(heading, lines) {
  const wrapped = [heading, ...lines.flatMap(line => {
    if (line === '') return [''];
    const indent = line.match(/^ */)[0];
    return wrap(line, indent);
  })];

  const pages = [];
  for (let i = 0; i < wrapped.length; i += LINES_PER_PAGE) {
    pages.push(wrapped.slice(i, i + LINES_PER_PAGE));
  }

  const objects = [];
  const kids = pages.map((_, index) => `${4 + index * 2} 0 R`).join(' ');
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;
  objects[2] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  pages.forEach((pageLines, index) => {
    const pageObject = 4 + index * 2;
    const content = pageContent(pageLines, { heading: index === 0 });
    objects[pageObject - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${pageObject + 1} 0 R >>`;
    objects[pageObject] = `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`;
  });

  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, index) => {
    const offset = Buffer.byteLength(pdf, 'latin1');
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach(offset => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

module.exports = { buildPdf };
