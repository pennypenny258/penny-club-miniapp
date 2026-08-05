'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const ExcelJS = require('exceljs');
const server = require('../src/server');

function call(pathname, body) {
  return new Promise((resolve, reject) => {
    const req = new PassThrough();
    req.method = 'POST';
    req.url = pathname;
    req.headers = { host: 'localhost', 'x-demo-role': 'administrator', 'content-type': 'application/json' };
    const response = { statusCode: 200, headers: {}, writeHead(status, headers) { this.statusCode = status; this.headers = headers || {}; }, end(chunk = '') { const text = String(chunk || ''); resolve({ status: this.statusCode, payload: text ? JSON.parse(text) : {} }); } };
    req.on('error', reject);
    server.emit('request', req, response);
    req.end(JSON.stringify(body));
  });
}

function download(pathname) {
  return new Promise((resolve, reject) => {
    const req = new PassThrough();
    req.method = 'GET';
    req.url = pathname;
    req.headers = { host: 'localhost', 'x-demo-role': 'administrator' };
    const response = { statusCode: 200, headers: {}, writeHead(status, headers) { this.statusCode = status; this.headers = headers || {}; }, end(chunk = '') { resolve({ status: this.statusCode, headers: this.headers, body: Buffer.from(chunk) }); } };
    req.on('error', reject);
    server.emit('request', req, response);
    req.end();
  });
}

async function xlsxPayload(headers, row) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('匿名付款样本');
  sheet.addRow(headers);
  sheet.addRow(row);
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  return { format: 'xlsx', dataBase64: bytes.toString('base64') };
}

test('payment XLSX preview accepts realistic shop columns, ignores extras and returns aggregate metadata only', async () => {
  const headers = ['订单编号','收件人姓名','收件人手机','订单发货时间','商品实际价格(单件)','商品实际价格(总共)','买家留言','收货地址','退款状态'];
  const row = ['匿名订单号','匿名收件人',['1','38','0000','8000'].join(''),'2026-07-01','1999','1999','匿名备注','匿名地址','未退款'];
  const payload = await xlsxPayload(headers, row);
  payload.paymentSource = 'wechat_shop_order';
  payload.priceRoleRules = { a1:'1999',a2:'2999' };
  const response = await call('/api/admin/imports/wechat-shop-orders/preview', payload);
  assert.equal(response.status, 200);
  assert.equal(response.payload.persisted, false);
  assert.equal(response.payload.paymentSource, 'wechat_shop_order');
  assert.equal(response.payload.spreadsheet.sheetName, '匿名付款样本');
  assert.equal(response.payload.spreadsheet.needsMapping, false);
  assert.equal(response.payload.summary.a1CandidateRows,1);
  assert.equal(response.payload.summary.needsManualRows,0);
  assert.deepEqual(response.payload.items,[]);
  const serialized = JSON.stringify(response.payload);
  for (const raw of row) assert.equal(serialized.includes(raw), false,raw);
  assert.equal(response.payload.safeguards.determinesMembershipAlone, false);
  assert.equal(response.payload.safeguards.publicDirectoryMutationAllowed, false);
});

test('three merchant receipt workbooks share one safe preview batch', async () => {
  const headers = ['付款人姓名','支付时间','付款人手机号','支付金额','订单号','备注'];
  const files = await Promise.all([
    xlsxPayload(headers,['匿名付款人甲','2026-07-01','13800008000','1000','匿名订单甲','匿名备注甲']),
    xlsxPayload(headers,['匿名付款人乙','2026-07-02','13800008001','2000','匿名订单乙','匿名备注乙']),
    xlsxPayload(headers,['匿名付款人丙','2026-07-03','13800008002','3000','匿名订单丙','匿名备注丙'])
  ]);
  const response = await call('/api/admin/imports/wechat-shop-orders/preview', { paymentSource:'wechat_merchant_receipt', files });
  assert.equal(response.status, 200);
  assert.equal(response.payload.selectedFileCount, 3);
  assert.equal(response.payload.validFileCount, 3);
  assert.equal(response.payload.totalRows, 3);
  assert.equal(response.payload.files.length, 3);
  assert.equal(response.payload.batch.selectedFileCount, 3);
  assert.deepEqual(response.payload.items, []);
  const serialized = JSON.stringify(response.payload);
  for (const raw of ['匿名付款人甲','13800008000','1000','匿名订单甲','匿名备注甲','匿名付款样本']) assert.equal(serialized.includes(raw), false, raw);
  assert.equal(response.payload.safeguards.determinesMembershipAlone, false);
  assert.equal(response.payload.safeguards.publicDirectoryMutationAllowed, false);
});

test('merchant batch reports one unsafe file without dropping safe siblings', async () => {
  const headers = ['付款人姓名','支付时间','付款人手机号','支付金额'];
  const validOne = await xlsxPayload(headers,['匿名甲','2026-07-01','13800008000','1000']);
  const invalid = { format:'xlsx', dataBase64:Buffer.from('broken').toString('base64') };
  const validTwo = await xlsxPayload(headers,['匿名乙','','','']);
  const response = await call('/api/admin/imports/wechat-shop-orders/preview', { paymentSource:'wechat_merchant_receipt', files:[validOne,invalid,validTwo] });
  assert.equal(response.status, 200);
  assert.equal(response.payload.batchStatus, 'partial_review_required');
  assert.equal(response.payload.validFileCount, 2);
  assert.equal(response.payload.errorFileCount, 1);
  assert.equal(response.payload.files[1].error.code, 'SPREADSHEET_SIGNATURE_INVALID');
  assert.equal(response.payload.files[2].summary.needsManualRows, 1);
});

test('all five Excel template endpoints return readable header-only XLSX files', async () => {
  for (const name of ['wechat-shop-orders','wechat-merchant-receipts','manual-transfers','internal-crm','voluntary-directory']) {
    const response = await download(`/api/admin/import-templates/${name}.xlsx`);
    assert.equal(response.status, 200, name);
    assert.match(response.headers['content-type'], /spreadsheetml/, name);
    assert.equal(response.body[0], 0x50, name);
    assert.equal(response.body[1], 0x4b, name);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.body);
    assert.equal(workbook.worksheets[0].rowCount, 1, name);
    assert.ok(workbook.worksheets[0].columnCount > 0, name);
  }
});
