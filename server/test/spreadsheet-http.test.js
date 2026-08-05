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

test('payment XLSX preview reports safe workbook metadata and never persists or activates membership', async () => {
  const headers = ['order_placed_at','order_status','recipient_phone','actual_paid_cents','collected_cents','payment_at','product_name','refund_cents','source_batch'];
  const row = ['2026-07-01','paid',['1','38','0000','8000'].join(''),'10000','10000','2026-07-01','匿名产品','0','匿名批次'];
  const payload = await xlsxPayload(headers, row);
  payload.paymentSource = 'wechat_merchant_receipt';
  const response = await call('/api/admin/imports/wechat-shop-orders/preview', payload);
  assert.equal(response.status, 200);
  assert.equal(response.payload.persisted, false);
  assert.equal(response.payload.paymentSource, 'wechat_merchant_receipt');
  assert.equal(response.payload.spreadsheet.sheetName, '匿名付款样本');
  assert.equal(response.payload.spreadsheet.needsMapping, false);
  const serialized = JSON.stringify(response.payload);
  for (const raw of [row[2], row[3], row[4], row[5], row[6]]) assert.equal(serialized.includes(raw), false);
  assert.equal(response.payload.items[0].data.determinesMembershipAlone, false);
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
