'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { parseSpreadsheetUpload, MAX_DATA_ROWS } = require('../src/spreadsheet-import');
const { previewCrmVerificationCsv, previewShopOrdersCsv, previewVoluntaryDirectoryCsv } = require('../src/imports');
const { previewPaymentClueCsv } = require('../src/payment-clue-import');

async function syntheticWorkbook(headers, rows, customize) {
  const workbook = new ExcelJS.Workbook();
  const hidden = workbook.addWorksheet('匿名隐藏空表');
  hidden.state = 'hidden';
  const sheet = workbook.addWorksheet('匿名导入样本');
  sheet.addRow(headers);
  rows.forEach(row => sheet.addRow(row));
  if (customize) customize(sheet, workbook);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function upload(buffer, extra = {}) {
  return { format: 'xlsx', dataBase64: buffer.toString('base64'), ...extra };
}

test('synthetic XLSX uses the first visible non-empty sheet and matches CSV payment normalization', async () => {
  const headers = ['order_placed_at','order_status','recipient_phone','actual_paid_cents','collected_cents','payment_at','product_name','refund_cents','source_batch'];
  const phone = ['1','38','0000','8000'].join('');
  const row = ['2026-07-01','paid',phone,'10000','10000','2026-07-01','匿名会籍产品','0','匿名批次'];
  const parsed = await parseSpreadsheetUpload(upload(await syntheticWorkbook(headers, [row])));
  const xlsxPreview = previewShopOrdersCsv(parsed.csv);
  const csvPreview = previewShopOrdersCsv(`${headers.join(',')}\n${row.join(',')}`);
  assert.equal(parsed.meta.sheetName, '匿名导入样本');
  assert.equal(parsed.meta.rowCount, 1);
  assert.deepEqual(xlsxPreview, csvPreview);
  assert.equal(xlsxPreview.results[0].normalized.determinesMembershipAlone, false);
  for (const field of ['recipient_phone','actual_paid_cents','collected_cents','payment_at','product_name']) assert.equal(field in xlsxPreview.results[0].normalized, false);
});

test('a regular 5,000-row payment export is accepted without manual splitting', async () => {
  const headers = ['订单编号','收件人姓名','收件人手机','订单发货时间','商品实际价格(总共)','订单状态','收货地址'];
  const phone = ['1','38','0000','8000'].join('');
  const rows = Array.from({ length: 5000 }, (_, index) => [`匿名订单-${index}`,'匿名收件人',phone,'2026-07-01','666','已完成','匿名地址']);
  const parsed = await parseSpreadsheetUpload(upload(await syntheticWorkbook(headers, rows)));
  const preview = previewPaymentClueCsv(parsed.csv,{source:'wechat_shop_order'});
  assert.equal(parsed.meta.rowCount, 5000);
  assert.equal(preview.counts.totalRows, 5000);
  assert.equal(preview.counts.a1CandidateRows, 5000);
  assert.equal(preview.counts.needsManualRows, 0);
  assert.equal(preview.ignoredColumnCount, 3);
});

test('CRM and voluntary directory XLSX use the same allowlists and human review boundaries', async () => {
  const crmHeaders = ['internal_member_ref','contact_match_token','crm_verification_status','membership_start','membership_end','group_status','evidence_note','migration_status'];
  const crm = await parseSpreadsheetUpload(upload(await syntheticWorkbook(crmHeaders, [['匿名引用','匿名匹配令牌','verified','2026-01-01','2027-01-01','in_group','匿名核验','ready']])));
  const crmResult = previewCrmVerificationCsv(crm.csv).results[0];
  assert.equal(crmResult.disposition, 'needs_human_review');
  assert.equal(crmResult.normalized.determinesMembershipAlone, false);
  for (const field of ['internal_member_ref','contact_match_token','evidence_note']) assert.equal(field in crmResult.normalized, false);

  const directoryHeaders = ['member_reference','public_display_name','organization','industry','interests','investment_stage','city','expertise','bio','public_display_consent','contact_mode','source_sheet','migration_status'];
  const directory = await parseSpreadsheetUpload(upload(await syntheticWorkbook(directoryHeaders, [['匿名引用','公开别名','匿名机构','科技','研究','早期','示例城市','研究','公开简介','yes','request_only','匿名自愿表','ready']])));
  const directoryResult = previewVoluntaryDirectoryCsv(directory.csv).results[0];
  assert.equal(directoryResult.disposition, 'needs_human_review');
  assert.equal(directoryResult.normalized.crmSyncAllowed, false);
});

test('XLSX rejects dangerous formulas, comments, unsupported formats and oversized row counts', async () => {
  const dangerous = await syntheticWorkbook(['field'], [['safe']], sheet => { sheet.getCell('A2').value = { formula: 'WEBSERVICE("https://example.invalid")', result: 'hidden' }; });
  await assert.rejects(() => parseSpreadsheetUpload(upload(dangerous)), error => error.code === 'SPREADSHEET_DANGEROUS_FORMULA');

  const commented = await syntheticWorkbook(['field'], [['safe']], sheet => { sheet.getCell('A2').note = '匿名隐藏批注'; });
  await assert.rejects(() => parseSpreadsheetUpload(upload(commented)), error => error.code === 'SPREADSHEET_HIDDEN_CONTENT_REJECTED');
  await assert.rejects(() => parseSpreadsheetUpload({ format: 'xls', dataBase64: '' }), error => error.code === 'SPREADSHEET_FORMAT_UNSUPPORTED');
  await assert.rejects(() => parseSpreadsheetUpload(upload(Buffer.from('not-an-xlsx'))), error => error.code === 'SPREADSHEET_SIGNATURE_INVALID');

  const rows = Array.from({ length: MAX_DATA_ROWS + 1 }, (_, index) => [`匿名-${index}`]);
  const tooMany = await syntheticWorkbook(['field'], rows);
  await assert.rejects(() => parseSpreadsheetUpload(upload(tooMany)), error => error.code === 'SPREADSHEET_TOO_MANY_ROWS');
});

test('safe cached formula values are read without evaluating the formula', async () => {
  const workbook = await syntheticWorkbook(['value'], [['placeholder']], sheet => { sheet.getCell('A2').value = { formula: '1+1', result: 2 }; });
  const parsed = await parseSpreadsheetUpload(upload(workbook));
  assert.equal(parsed.meta.formulaCellsReadAsCachedValues, 1);
  assert.match(parsed.csv, /\n2$/);
});

test('CSV uses the same 10,000-row hard limit as XLSX', async () => {
  const accepted = `field\n${Array.from({ length: 5000 }, (_, index) => `匿名-${index}`).join('\n')}`;
  const parsed = await parseSpreadsheetUpload({ format: 'csv', csv: accepted });
  assert.equal(parsed.meta.rowCount, 5000);
  const rejected = `field\n${Array.from({ length: MAX_DATA_ROWS + 1 }, (_, index) => `匿名-${index}`).join('\n')}`;
  await assert.rejects(() => parseSpreadsheetUpload({ format: 'csv', csv: rejected }), error => error.code === 'SPREADSHEET_TOO_MANY_ROWS' && /月份或时间段/.test(error.message));
});
