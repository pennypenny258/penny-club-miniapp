'use strict';

const ExcelJS = require('exceljs');
const JSZip = require('jszip');

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;
const MAX_DATA_ROWS = 500;
const MAX_COLUMNS = 64;
const DANGEROUS_FORMULA = /(?:\b(?:WEBSERVICE|HYPERLINK|RTD|DDE|CALL|EXEC|IMPORTXML|IMPORTDATA|IMAGE)\s*\(|https?:\/\/|\\\\|\[[^\]]+\]|cmd(?:\.exe)?|powershell)/i;

class SpreadsheetImportError extends Error {
  constructor(message, code = 'SPREADSHEET_INVALID', statusCode = 400) {
    super(message);
    this.name = 'SpreadsheetImportError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function decodeBase64(value) {
  const encoded = String(value || '');
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    throw new SpreadsheetImportError('Excel 文件编码无效', 'SPREADSHEET_ENCODING_INVALID');
  }
  const estimatedBytes = (encoded.length / 4) * 3 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
  if (estimatedBytes > MAX_UPLOAD_BYTES) throw new SpreadsheetImportError('Excel 文件超过 2MB，请拆分批次', 'SPREADSHEET_TOO_LARGE', 413);
  return Buffer.from(encoded, 'base64');
}

async function inspectArchive(buffer) {
  let archive;
  try {
    archive = await JSZip.loadAsync(buffer, { checkCRC32: true, createFolders: false });
  } catch {
    throw new SpreadsheetImportError('无法读取该 .xlsx；文件可能损坏、加密或受密码保护', 'SPREADSHEET_UNREADABLE');
  }
  const entries = Object.values(archive.files).filter(entry => !entry.dir);
  const lowerNames = entries.map(entry => entry.name.toLowerCase());
  if (lowerNames.some(name => /(?:vbaproject\.bin|xl\/macrosheets\/)/.test(name))) {
    throw new SpreadsheetImportError('不支持含宏的工作簿', 'SPREADSHEET_MACRO_REJECTED');
  }
  if (lowerNames.some(name => /xl\/(?:externalLinks|comments|threadedcomments|persons)\//i.test(name))) {
    throw new SpreadsheetImportError('工作簿含外部链接或隐藏批注，请移除后重试', 'SPREADSHEET_HIDDEN_CONTENT_REJECTED');
  }
  let uncompressedBytes = 0;
  for (const entry of entries) {
    const size = Number(entry._data?.uncompressedSize || 0);
    if (Number.isFinite(size)) uncompressedBytes += size;
    if (uncompressedBytes > MAX_UNCOMPRESSED_BYTES) {
      throw new SpreadsheetImportError('Excel 解压后内容过大，请拆分批次', 'SPREADSHEET_EXPANDED_TOO_LARGE', 413);
    }
    if (entry.name.toLowerCase().endsWith('.rels')) {
      const relationshipXml = await entry.async('string');
      if (/TargetMode\s*=\s*["']External["']/i.test(relationshipXml)) {
        throw new SpreadsheetImportError('工作簿含外部链接，请移除后重试', 'SPREADSHEET_EXTERNAL_LINK_REJECTED');
      }
    }
  }
}

function primitiveCellValue(cell) {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value !== 'object') return String(value);
  if (value.richText) return value.richText.map(part => part.text || '').join('');
  if (value.formula || value.sharedFormula) {
    const formula = String(value.formula || value.sharedFormula || '');
    if (DANGEROUS_FORMULA.test(formula)) throw new SpreadsheetImportError('工作表包含危险公式，已拒绝预检', 'SPREADSHEET_DANGEROUS_FORMULA');
    const result = value.result;
    if (result === null || result === undefined || typeof result === 'object') {
      throw new SpreadsheetImportError('工作表公式缺少安全的缓存值，请先固定为值', 'SPREADSHEET_FORMULA_WITHOUT_VALUE');
    }
    return String(result);
  }
  if (value.hyperlink) throw new SpreadsheetImportError('工作表包含外部链接，请移除后重试', 'SPREADSHEET_EXTERNAL_LINK_REJECTED');
  if (value.error) throw new SpreadsheetImportError('工作表包含公式错误，请修正后重试', 'SPREADSHEET_FORMULA_ERROR');
  throw new SpreadsheetImportError('工作表包含不支持的单元格类型', 'SPREADSHEET_CELL_UNSUPPORTED');
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function worksheetHasContent(sheet) {
  let found = false;
  sheet.eachRow({ includeEmpty: false }, row => {
    if (row.values.slice(1).some(value => value !== null && value !== undefined && String(value).trim() !== '')) found = true;
  });
  return found;
}

function worksheetToCsv(sheet) {
  const rows = [];
  let maxColumn = 0;
  let formulaCellsReadAsCachedValues = 0;
  sheet.eachRow({ includeEmpty: false }, row => {
    const lastColumn = row.actualCellCount ? row.cellCount : 0;
    maxColumn = Math.max(maxColumn, lastColumn);
    if (maxColumn > MAX_COLUMNS) throw new SpreadsheetImportError(`工作表超过 ${MAX_COLUMNS} 列`, 'SPREADSHEET_TOO_MANY_COLUMNS', 413);
    const values = [];
    for (let column = 1; column <= lastColumn; column += 1) {
      const cell = row.getCell(column);
      if (cell.note) throw new SpreadsheetImportError('工作表含隐藏批注，请移除后重试', 'SPREADSHEET_HIDDEN_CONTENT_REJECTED');
      if (cell.value && typeof cell.value === 'object' && (cell.value.formula || cell.value.sharedFormula)) formulaCellsReadAsCachedValues += 1;
      values.push(primitiveCellValue(cell));
    }
    if (values.some(value => String(value).trim() !== '')) rows.push(values);
  });
  if (!rows.length) throw new SpreadsheetImportError('工作簿没有可导入内容', 'SPREADSHEET_EMPTY');
  if (rows.length - 1 > MAX_DATA_ROWS) throw new SpreadsheetImportError(`单批最多 ${MAX_DATA_ROWS} 行，请拆分工作簿`, 'SPREADSHEET_TOO_MANY_ROWS', 413);
  const width = Math.max(...rows.map(row => row.length));
  const csv = rows.map(row => Array.from({ length: width }, (_, index) => csvCell(row[index] || '')).join(',')).join('\n');
  return { csv, rowCount: rows.length - 1, columnCount: width, formulaCellsReadAsCachedValues };
}

async function parseSpreadsheetUpload(input = {}) {
  const format = String(input.format || (typeof input.csv === 'string' ? 'csv' : '')).toLowerCase();
  if (format === 'csv') {
    const csv = String(input.csv || '');
    if (Buffer.byteLength(csv, 'utf8') > MAX_UPLOAD_BYTES) throw new SpreadsheetImportError('CSV 超过 2MB，请拆分批次', 'SPREADSHEET_TOO_LARGE', 413);
    return { csv, meta: { format: 'csv', sheetName: 'CSV', formulaCellsReadAsCachedValues: 0 } };
  }
  if (format !== 'xlsx') throw new SpreadsheetImportError('仅支持 .xlsx 和 .csv；旧版 .xls 与宏文件不支持', 'SPREADSHEET_FORMAT_UNSUPPORTED', 415);
  const buffer = decodeBase64(input.dataBase64);
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new SpreadsheetImportError('文件不是有效的 .xlsx，或已加密/受密码保护', 'SPREADSHEET_SIGNATURE_INVALID');
  await inspectArchive(buffer);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer, { ignoreNodes: ['dataValidations', 'drawing', 'picture', 'extLst'] });
  } catch {
    throw new SpreadsheetImportError('无法读取该 .xlsx；文件可能损坏、加密或受密码保护', 'SPREADSHEET_UNREADABLE');
  }
  const visibleSheets = workbook.worksheets.filter(sheet => sheet.state === 'visible' && worksheetHasContent(sheet));
  const requestedName = typeof input.sheetName === 'string' ? input.sheetName : '';
  const selected = requestedName ? visibleSheets.find(sheet => sheet.name === requestedName) : visibleSheets[0];
  if (!selected) throw new SpreadsheetImportError(requestedName ? '所选工作表不存在、隐藏或为空' : '工作簿没有可导入的可见工作表', 'SPREADSHEET_SHEET_UNAVAILABLE');
  const parsed = worksheetToCsv(selected);
  return { csv: parsed.csv, meta: { format: 'xlsx', sheetName: selected.name, rowCount: parsed.rowCount, columnCount: parsed.columnCount, formulaCellsReadAsCachedValues: parsed.formulaCellsReadAsCachedValues, firstVisibleNonEmptySheet: !requestedName } };
}

async function createXlsxTemplate(headers, sheetName = '导入模板') {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Venture Club';
  workbook.created = new Date('2026-01-01T00:00:00.000Z');
  const sheet = workbook.addWorksheet(sheetName, { state: 'visible' });
  sheet.addRow(headers);
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

module.exports = { MAX_UPLOAD_BYTES, MAX_DATA_ROWS, MAX_COLUMNS, SpreadsheetImportError, parseSpreadsheetUpload, createXlsxTemplate };
