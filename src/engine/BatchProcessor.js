import JSZip from 'jszip';
import { buildAmbigram } from './AmbigramBuilder.js';
import { exportToSTLBlob } from './STLExporter.js';

/**
 * Extract Google Sheet ID from various URL formats.
 */
function extractSheetId(url) {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

/**
 * Parse CSV text into array of rows (each row = array of strings).
 */
function parseCSV(text) {
  const rows = [];
  let current = '';
  let inQuotes = false;
  let row = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(current.trim());
        current = '';
      } else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
        row.push(current.trim());
        if (row.some(cell => cell !== '')) rows.push(row);
        row = [];
        current = '';
        if (ch === '\r') i++;
      } else {
        current += ch;
      }
    }
  }
  // Last row
  row.push(current.trim());
  if (row.some(cell => cell !== '')) rows.push(row);

  return rows;
}

/**
 * Fetch rows from a Google Sheet, generate STLs + G-code, upload to Drive,
 * and download STLs as ZIP.
 *
 * @param {string} sheetUrl - Google Sheets URL
 * @param {Object} options - Font/size/radius/thickness settings
 * @param {Function} onProgress - Called with (current, total, status)
 * @returns {Promise<Array>} report — per-order results
 */
export async function processBatch(sheetUrl, options, onProgress) {
  // Extract sheet ID
  const sheetId = extractSheetId(sheetUrl);
  if (!sheetId) {
    throw new Error('Invalid Google Sheets URL');
  }

  // Fetch CSV
  onProgress(0, 0, 'Fetching sheet...');
  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
  const response = await fetch(csvUrl);
  if (!response.ok) {
    throw new Error('Could not fetch sheet. Make sure it is shared as "Anyone with the link".');
  }

  const csvText = await response.text();
  const allRows = parseCSV(csvText);

  if (allRows.length < 2) {
    throw new Error('Sheet has no data rows (need header + at least 1 row).');
  }

  // Skip header row — columns: Order number, Color, Name 1, Name 2, Text on base, Pad Before, Pad After
  const dataRows = allRows.slice(1).filter(row => row[2] && row[3]);

  if (dataRows.length === 0) {
    throw new Error('No valid rows found. Each row needs Order number, Name 1, and Name 2.');
  }

  const safe = (s) => s.replace(/[^a-zA-Z0-9\u0600-\u06FF_-]/g, '_');
  const total = dataRows.length;
  const zip = new JSZip();
  const report = [];

  for (let i = 0; i < total; i++) {
    await new Promise(r => setTimeout(r, 0)); // yield to main thread for UI updates
    const [orderNum, color, textA, textB, inscription, padBeforeStr, padAfterStr] = dataRows[i];
    const colorPart = color ? `-${safe(color)}` : '';
    const filename = `DN-${safe(orderNum || String(i + 1))}-${safe(textA)}-${safe(textB)}${colorPart}.stl`;

    const entry = {
      order: orderNum || String(i + 1),
      textA,
      textB,
      stl: false,
      gcode: false,
      drive: false,
      failedAt: null
    };

    // Step 1: Generate STL
    onProgress(i + 1, total, `[${i + 1}/${total}] STL: ${textA} + ${textB}...`);
    let blob;
    try {
      const model = await buildAmbigram({
        textA,
        textB,
        fontUrl:            options.fontUrl,
        fontSize:           options.fontSize,
        cornerRadius:       options.cornerRadius,
        baseHeight:         options.baseThickness,
        heartStyle:         options.heartStyle || 1,
        inscriptionText:    inscription || '',
        inscriptionFontUrl: options.inscriptionFontUrl,
        orderNumber:        orderNum || '',
        padBefore:          parseInt(padBeforeStr) || 0,
        padAfter:           parseInt(padAfterStr) || 0
      });

      blob = exportToSTLBlob(model);
      zip.file(filename, blob);
      entry.stl = true;

      // Dispose geometries to free memory
      model.traverse(child => {
        if (child.isMesh) {
          child.geometry.dispose();
          child.material.dispose();
        }
      });
    } catch (err) {
      console.warn(`STL failed row ${i + 1} (${textA} + ${textB}): ${err.message}`);
      entry.failedAt = 'STL';
      report.push(entry);
      continue;
    }

    // Step 2: Generate G-code + upload to Drive
    onProgress(i + 1, total, `[${i + 1}/${total}] G-code: ${textA} + ${textB}...`);
    try {
      const form = new FormData();
      form.append('stl', blob, filename);
      form.append('profile', options.profile || 'default');
      form.append('filename', filename);
      if (inscription) form.append('hasInscription', '1');

      const res = await fetch('/api/slice-and-upload', { method: 'POST', body: form });
      if (!res.ok) throw new Error('Server error');

      const result = await res.json();
      entry.gcode = result.gcode;
      entry.drive = result.drive;

      if (!result.gcode) {
        entry.failedAt = 'G-code';
      } else if (!result.drive) {
        entry.failedAt = 'Drive upload';
      }
    } catch (err) {
      console.warn(`G-code failed row ${i + 1} (${textA} + ${textB}): ${err.message}`);
      entry.failedAt = 'G-code';
    }

    report.push(entry);
  }

  // Generate ZIP of STLs
  onProgress(total, total, 'Creating ZIP...');
  const zipBlob = await zip.generateAsync({ type: 'blob' });

  // Trigger download
  const url = URL.createObjectURL(zipBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'DualName_Batch.zip';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  onProgress(total, total, 'Done!');
  return report;
}
