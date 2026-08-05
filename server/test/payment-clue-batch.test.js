'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { previewPaymentClueBatch, MAX_PAYMENT_BATCH_ROWS } = require('../src/payment-clue-batch');

async function merchantWorkbook(rows, sheetName = '匿名小票') {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.addRow(['付款人姓名','支付时间','付款人手机号','支付金额','订单号','备注']);
  rows.forEach(row => sheet.addRow(row));
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  return { format:'xlsx', dataBase64:bytes.toString('base64') };
}

test('three merchant workbooks become one safe aggregate batch', async () => {
  const files = await Promise.all([
    merchantWorkbook([['匿名甲','2026-07-01','13800008000','1000','匿名单号甲','匿名备注甲']]),
    merchantWorkbook([['匿名乙','2026-07-02','13800008001','2000','匿名单号乙','匿名备注乙']]),
    merchantWorkbook([['匿名丙','2026-07-03','13800008002','3000','匿名单号丙','匿名备注丙']])
  ]);
  const result = await previewPaymentClueBatch({ paymentSource:'wechat_merchant_receipt', files });
  assert.equal(result.selectedFileCount, 3);
  assert.equal(result.validFileCount, 3);
  assert.equal(result.errorFileCount, 0);
  assert.equal(result.totalRows, 3);
  assert.equal(result.summary.matchingCandidateRows, 3);
  assert.equal(result.files.length, 3);
  const serialized = JSON.stringify(result);
  for (const secret of ['匿名甲','13800008000','1000','匿名单号甲','匿名备注甲','匿名小票']) assert.equal(serialized.includes(secret), false, secret);
  assert.equal(result.safeguards.determinesMembershipAlone, false);
  assert.equal(result.safeguards.publicDirectoryMutationAllowed, false);
});

test('one invalid workbook is isolated while valid files remain summarized', async () => {
  const validOne = await merchantWorkbook([['匿名甲','2026-07-01','13800008000','1000','','']]);
  const invalid = { format:'xlsx', dataBase64:Buffer.from('not-an-xlsx').toString('base64') };
  const validTwo = await merchantWorkbook([['匿名乙','','','','','']]);
  const result = await previewPaymentClueBatch({ paymentSource:'wechat_merchant_receipt', files:[validOne,invalid,validTwo] });
  assert.equal(result.batchStatus, 'partial_review_required');
  assert.equal(result.validFileCount, 2);
  assert.equal(result.errorFileCount, 1);
  assert.equal(result.totalRows, 2);
  assert.equal(result.files[1].status, 'error');
  assert.equal(result.files[1].error.code, 'SPREADSHEET_SIGNATURE_INVALID');
  assert.equal(result.files[2].summary.needsManualRows, 1);
});

test('merchant batch total row limit gives an actionable safe error', async () => {
  const rowsPerFile = Math.floor(MAX_PAYMENT_BATCH_ROWS / 4) + 1;
  const csv = `付款人姓名,支付时间,付款人手机号,支付金额\n${Array.from({length:rowsPerFile},(_,index)=>`匿名${index},2026-07-01,13800008000,1000`).join('\n')}`;
  const files = Array.from({ length:4 }, () => ({ format:'csv', csv }));
  await assert.rejects(
    () => previewPaymentClueBatch({ paymentSource:'wechat_merchant_receipt', files }),
    error => error.code === 'PAYMENT_BATCH_TOO_MANY_ROWS' && error.statusCode === 413 && error.safeBatch.totalRows > MAX_PAYMENT_BATCH_ROWS && !JSON.stringify(error.safeBatch).includes('13800008000')
  );
});

test('multi-file rules stay scoped to merchant receipts', async () => {
  const files = [await merchantWorkbook([['匿名甲','2026-07-01','13800008000','1000','','']]),await merchantWorkbook([['匿名乙','2026-07-02','13800008001','2000','','']])];
  await assert.rejects(() => previewPaymentClueBatch({ paymentSource:'wechat_shop_order', files }), error => error.code === 'PAYMENT_BATCH_SOURCE_UNSUPPORTED');
});
