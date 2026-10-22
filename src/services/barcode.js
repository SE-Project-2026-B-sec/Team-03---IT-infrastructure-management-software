'use strict';

/**
 * Code 128 (code set B) barcode encoder producing an SVG asset label
 * (IT-F-003). Handheld USB/Bluetooth scanners decode the bars and "type" the
 * asset tag, which the dashboard resolves through the scan-lookup endpoint.
 */

// Bar/space module widths for symbol values 0..105; 106 is the stop pattern.
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112'
];

const START_B = 104;
const STOP = 106;
const QUIET_ZONE = 10;

/** Returns the symbol values for a string, including start, checksum and stop. */
function encodeValues(text) {
  if (typeof text !== 'string' || text.length === 0 || text.length > 48) {
    throw new Error('Barcode text must be 1-48 characters');
  }
  const values = [START_B];
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126) throw new Error('Barcode text must be printable ASCII');
    values.push(code - 32);
  }
  let checksum = START_B;
  for (let i = 1; i < values.length; i += 1) checksum += values[i] * i;
  values.push(checksum % 103);
  values.push(STOP);
  return values;
}

/** Module widths (alternating bar, space, bar...) for the full symbol. */
function encodeModules(text) {
  return encodeValues(text).flatMap((v) => PATTERNS[v].split('').map(Number));
}

const escapeXml = (s) =>
  String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);

/** Renders a printable SVG label with the barcode and human-readable text. */
function renderLabelSvg(text, { moduleWidth = 2, barHeight = 70, caption } = {}) {
  const modules = encodeModules(text);
  const totalModules = modules.reduce((a, b) => a + b, 0) + QUIET_ZONE * 2;
  const width = totalModules * moduleWidth;
  const height = barHeight + 44;
  let x = QUIET_ZONE * moduleWidth;
  const bars = [];
  modules.forEach((w, i) => {
    const px = w * moduleWidth;
    if (i % 2 === 0) bars.push(`<rect x="${x}" y="8" width="${px}" height="${barHeight}"/>`);
    x += px;
  });
  const label = escapeXml(text);
  const sub = caption ? escapeXml(caption) : '';
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Barcode for asset ${label}">`,
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
    `<g fill="#000000">${bars.join('')}</g>`,
    `<text x="${width / 2}" y="${barHeight + 26}" font-family="monospace" font-size="16" text-anchor="middle" fill="#000000">${label}</text>`,
    sub ? `<text x="${width / 2}" y="${barHeight + 40}" font-family="sans-serif" font-size="10" text-anchor="middle" fill="#333333">${sub}</text>` : '',
    '</svg>'
  ].join('');
}

/** Decodes module widths back into text; used by tests to verify labels. */
function decodeModules(modules) {
  const values = [];
  for (let i = 0; i < modules.length; ) {
    const isStop = modules.length - i === 7;
    const size = isStop ? 7 : 6;
    const pattern = modules.slice(i, i + size).join('');
    const value = PATTERNS.indexOf(pattern);
    if (value < 0) throw new Error(`Invalid symbol at module ${i}`);
    values.push(value);
    i += size;
  }
  if (values[0] !== START_B || values[values.length - 1] !== STOP) throw new Error('Missing start/stop symbol');
  const data = values.slice(1, -2);
  let checksum = START_B;
  data.forEach((v, idx) => {
    checksum += v * (idx + 1);
  });
  if (checksum % 103 !== values[values.length - 2]) throw new Error('Checksum mismatch');
  return data.map((v) => String.fromCharCode(v + 32)).join('');
}

module.exports = { encodeValues, encodeModules, renderLabelSvg, decodeModules, PATTERNS };
