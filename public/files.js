import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { createWorker } from 'tesseract.js';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

const asset = name => new URL(`vendor/${name}`, document.baseURI).href;
const text = value => value == null ? '' : value instanceof Date ? value.toISOString().slice(0, 10) : typeof value === 'object' ? (value.text ?? value.result ?? '') : String(value);
const bytes = base64 => Uint8Array.from(atob(base64), char => char.charCodeAt(0));
export const toBase64 = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1]);
  reader.onerror = () => reject(new Error('無法讀取檔案'));
  reader.readAsDataURL(file);
});

export function parseCsv(source) {
  const matrix = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"') { if (quoted && source[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (ch === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && source[i + 1] === '\n') i++;
      row.push(cell); if (row.some(Boolean)) matrix.push(row);
      row = []; cell = '';
    } else cell += ch;
  }
  if (quoted) throw new Error('CSV 引號沒有正確關閉');
  row.push(cell); if (row.some(Boolean)) matrix.push(row);
  const headers = (matrix.shift() || []).map((h, index) => index ? h.trim() : h.replace(/^\uFEFF/, '').trim());
  return { headers, rows: matrix.map(values => Object.fromEntries(headers.map((h, index) => [h, values[index] ?? '']))) };
}

async function workbookFrom(contentBase64) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes(contentBase64));
  if (!workbook.worksheets.length) throw new Error('Excel 沒有工作表');
  return workbook;
}
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const child = (node, name) => [...(node?.children || [])].find(item => item.localName === name);
const children = (node, name) => [...(node?.children || [])].filter(item => item.localName === name);
function xml(source) {
  const doc = new DOMParser().parseFromString(source, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Excel XML is invalid');
  return doc;
}
function excelDate(serial, date1904 = false) {
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return new Date(base + Number(serial) * 86400000).toISOString().slice(0, 10);
}
async function fallbackPreview(contentBase64) {
  const zip = await JSZip.loadAsync(bytes(contentBase64));
  const readXml = async path => {
    const part = zip.file(path);
    if (!part) throw new Error(`Excel is missing ${path}`);
    return xml(await part.async('string'));
  };
  const workbook = await readXml('xl/workbook.xml');
  const sheet = workbook.getElementsByTagNameNS(NS, 'sheet')[0];
  if (!sheet) throw new Error('Excel workbook has no worksheets');
  const relationId = sheet.getAttributeNS(REL_NS, 'id');
  const relations = await readXml('xl/_rels/workbook.xml.rels');
  const relation = [...relations.documentElement.children].find(item => item.getAttribute('Id') === relationId);
  if (!relation) throw new Error('Excel worksheet relationship is missing');
  const target = relation.getAttribute('Target');
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  const normalizedPath = path.replace(/\/\.\//g, '/').replace(/xl\/xl\//, 'xl/');
  const worksheet = await readXml(normalizedPath);
  let shared = [];
  if (zip.file('xl/sharedStrings.xml')) {
    const strings = await readXml('xl/sharedStrings.xml');
    shared = [...strings.getElementsByTagNameNS(NS, 'si')].map(item => [...item.getElementsByTagNameNS(NS, 't')].map(part => part.textContent).join(''));
  }
  const date1904 = workbook.getElementsByTagNameNS(NS, 'workbookPr')[0]?.getAttribute('date1904') === '1';
  const dateStyles = new Set();
  if (zip.file('xl/styles.xml')) {
    const styles = await readXml('xl/styles.xml');
    const custom = new Map([...styles.getElementsByTagNameNS(NS, 'numFmt')].map(item => [Number(item.getAttribute('numFmtId')), item.getAttribute('formatCode') || '']));
    [...styles.getElementsByTagNameNS(NS, 'cellXfs')[0]?.children || []].forEach((item, index) => {
      const format = Number(item.getAttribute('numFmtId'));
      if (format >= 14 && format <= 22 || /(?<!\\)[ymd]/i.test(custom.get(format) || '')) dateStyles.add(index);
    });
  }
  const matrix = [];
  for (const row of worksheet.getElementsByTagNameNS(NS, 'row')) {
    const values = [];
    for (const cell of children(row, 'c')) {
      const reference = cell.getAttribute('r') || '';
      const letters = reference.match(/^[A-Z]+/i)?.[0] || '';
      const column = [...letters.toUpperCase()].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
      if (column < 0) continue;
      const kind = cell.getAttribute('t');
      const raw = child(cell, 'v')?.textContent ?? '';
      let value = raw;
      if (kind === 's') value = shared[Number(raw)] ?? '';
      else if (kind === 'inlineStr') value = [...cell.getElementsByTagNameNS(NS, 't')].map(part => part.textContent).join('');
      else if (kind === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
      else if (kind === 'n' || !kind) {
        if (raw && dateStyles.has(Number(cell.getAttribute('s') || 0))) value = excelDate(raw, date1904);
      }
      values[column] = value;
    }
    if (values.some(value => value !== '' && value != null)) matrix.push(values);
  }
  const headers = (matrix.shift() || []).map(value => String(value ?? '').trim());
  if (!headers.length || headers.some(value => !value) || new Set(headers).size !== headers.length) throw new Error('Excel 首行需要不重複的欄位名稱');
  return { headers, rows: matrix.map(values => Object.fromEntries(headers.map((header, index) => [header, String(values[index] ?? '')]))) };
}
export async function previewFile(filename, contentBase64) {
  if (/\.csv$/i.test(filename)) return parseCsv(new TextDecoder().decode(bytes(contentBase64)));
  if (!/\.xlsx$/i.test(filename)) throw new Error('只支援 CSV 或 XLSX');
  try {
    const sheet = (await workbookFrom(contentBase64)).worksheets[0];
    const headers = sheet.getRow(1).values.slice(1).map(text).map(h => h.trim());
    if (!headers.length || headers.some(h => !h) || new Set(headers).size !== headers.length) throw new Error('Excel 首行需要不重複的欄位名稱');
    const rows = [];
    sheet.eachRow((row, index) => {
      if (index === 1) return;
      const record = Object.fromEntries(headers.map((h, column) => [h, text(row.getCell(column + 1).value)]));
      if (Object.values(record).some(Boolean)) rows.push(record);
    });
    return { headers, rows };
  } catch (originalError) {
    try { return await fallbackPreview(contentBase64); }
    catch { throw new Error('無法讀取此 Excel 檔案。請確認是有效的 .xlsx，或另存為 CSV 後匯入。'); }
  }
}

export function csvBlob(headers, rows) {
  const cell = value => {
    const raw = String(value ?? '');
    const safe = /^[=+@-]/.test(raw) && !/^[-+]?\d+(?:\.\d+)?$/.test(raw) ? `'${raw}` : raw;
    return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
  };
  return new Blob(['\uFEFF', [headers, ...rows].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
}
export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export async function newWorkbook(headers, rows, variables) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Data');
  sheet.addRow(headers);
  rows.forEach(row => sheet.addRow(row));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  const codebook = workbook.addWorksheet('Codebook');
  codebook.addRow(['variable', 'label', 'type', 'unit', 'missing_codes', 'value_labels']);
  variables.forEach(v => codebook.addRow([v.key, v.label, v.type, v.unit, ['INTEGER','DECIMAL','CATEGORY'].includes(v.type) ? '-99=Not recorded; -98=Not assessable' : '', v.codes.map(c => `${c.code}=${c.label}`).join('; ')]));
  return new Blob([await workbook.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export async function mergeWorkbook(contentBase64, mapping, records, variables) {
  const workbook = await workbookFrom(contentBase64);
  const sheet = workbook.worksheets[0];
  const headers = sheet.getRow(1).values.slice(1).map(text);
  const columns = Object.fromEntries(Object.entries(mapping).filter(([, header]) => header).map(([key, header]) => [key, headers.indexOf(header) + 1]));
  if (!columns.subject_id || !columns.assessment_date) throw new Error('請對應受試者編號和評估日期');
  const existing = new Map();
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    const subject = text(row.getCell(columns.subject_id).value).trim();
    const date = text(row.getCell(columns.assessment_date).value).trim();
    if (subject && date) existing.set(`${subject}|${date}`, row);
  });
  for (const record of records) {
    const key = `${record.subject_code}|${record.assessment_date}`;
    const row = existing.get(key) || sheet.addRow([]);
    row.getCell(columns.subject_id).value = record.subject_code;
    row.getCell(columns.assessment_date).value = record.assessment_date;
    for (const variable of variables) {
      if (!columns[variable.key]) continue;
      const value = record.values[variable.key];
      row.getCell(columns[variable.key]).value = value == null ? (['INTEGER','DECIMAL','CATEGORY'].includes(variable.type) ? (record.missingReasons?.[variable.key] === 'NOT_ASSESSABLE' ? -98 : -99) : '') : value;
    }
    existing.set(key, row);
  }
  return new Blob([await workbook.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

let ocrWorker;
async function recognize(image) {
  if (!ocrWorker) ocrWorker = await createWorker('eng+chi_tra', 1, {
    workerPath: asset('worker.min.js'), corePath: asset('tesseract-core-lstm.wasm.js'), langPath: new URL('vendor/', document.baseURI).href,
    gzip: true, workerBlobURL: false
  });
  return (await ocrWorker.recognize(image)).data.text;
}
export async function readNote(file) {
  const extension = file.name.split('.').pop().toLowerCase();
  if (extension === 'txt') return file.text();
  if (['png','jpg','jpeg'].includes(extension)) return recognize(file);
  if (extension !== 'pdf') throw new Error('只支援 TXT、PDF、PNG 和 JPG');
  const loading = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await loading.promise;
  if (pdf.numPages > 30) { await loading.destroy(); throw new Error('PDF 最多支援 30 頁'); }
  const parts = [];
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      let pageText = content.items.map(item => item.str).join(' ');
      if (pageText.trim().length < 30) {
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width; canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport, canvas }).promise;
        pageText = await recognize(canvas);
      }
      parts.push(pageText);
    }
  } finally { await loading.destroy(); }
  return parts.join('\n');
}
