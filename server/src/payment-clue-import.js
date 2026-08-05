'use strict';

const { parseCsv } = require('./imports');

const WECHAT_SHOP_TEMPLATE_HEADERS = ['收件人姓名','订单发货时间','收件人手机号','商品价格(单件)'];
const MERCHANT_RECEIPT_TEMPLATE_HEADERS = ['付款人姓名','支付时间','付款人手机号','支付金额'];
const MANUAL_TRANSFER_TEMPLATE_HEADERS = ['成员姓名','转账时间','手机号','转账金额'];

const ALIASES = Object.freeze({
  wechat_shop_order: {
    recipientName: ['收件人姓名','收货人姓名','收件人','收货人'],
    occurredAt: ['订单发货时间','发货时间','商品发货时间','全部发货时间'],
    phone: ['收件人手机号','收件人手机','收货人手机号','收货人手机','联系电话'],
    amount: ['商品实际价格(总共)','商品实际价格（总共）','商品实际价格(单件)','商品实际价格（单件）','商品价格(单件)','商品价格（单件）','商品实际价格','商品价格']
  },
  wechat_merchant_receipt: {
    recipientName: ['付款人姓名','支付人姓名','客户姓名','姓名'],
    occurredAt: ['支付时间','交易时间','付款时间'],
    phone: ['付款人手机号','支付人手机号','手机号','联系电话'],
    amount: ['支付金额','交易金额','付款金额','金额']
  },
  manual_transfer: {
    recipientName: ['成员姓名','转账人姓名','付款人姓名','姓名'],
    occurredAt: ['转账时间','付款时间','登记时间'],
    phone: ['手机号','成员手机号','联系电话'],
    amount: ['转账金额','付款金额','金额']
  }
});

const SAFE_LABELS = Object.freeze({
  wechat_shop_order:{recipientName:'收件人姓名',occurredAt:'订单发货时间',phone:'收件人手机号',amount:'商品价格'},
  wechat_merchant_receipt:{recipientName:'付款人姓名',occurredAt:'支付时间',phone:'付款人手机号',amount:'支付金额'},
  manual_transfer:{recipientName:'成员姓名',occurredAt:'转账时间',phone:'手机号',amount:'转账金额'}
});

function normalizeHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/[（]/g,'(').replace(/[）]/g,')').replace(/[\s_\-]/g,'');
}

function findHeader(headers, candidates) {
  const wanted = new Set(candidates.map(normalizeHeader));
  return headers.find(header => wanted.has(normalizeHeader(header))) || null;
}

function valueAt(row, header) { return header ? String(row[header] || '').trim() : ''; }
function hasValue(value) { return Boolean(String(value || '').trim()); }
function validPhone(value) { return /^1[3-9]\d{9}$/.test(String(value || '').replace(/\D/g,'')); }
function validDate(value) { return hasValue(value) && !Number.isNaN(Date.parse(String(value).replace(/\//g,'-'))); }

function priceCents(value) {
  const normalized = String(value || '').replace(/[¥￥,，\s]/g,'').replace(/元$/,'');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null;
}

function parseRuleList(value) {
  const parts = Array.isArray(value) ? value : String(value || '').split(/[，,\n]/);
  const values = new Set();
  for (const part of parts) {
    if (!String(part).trim()) continue;
    const cents = priceCents(part);
    if (cents === null) continue;
    values.add(cents);
    if (values.size >= 20) break;
  }
  return values;
}

function refundHeaders(headers) { return headers.filter(header => /退款|退货|售后/.test(String(header))); }
function possibleRefund(row, headers) {
  return headers.some(header => {
    const value = valueAt(row, header);
    if (!value || /^(?:0|0\.0+|无|否|未退款|未发生|正常)$/.test(value)) return false;
    return true;
  });
}

function previewPaymentClueCsv(csv, { source = 'wechat_shop_order', priceRoleRules = {} } = {}) {
  const parsed = parseCsv(csv);
  const aliases = ALIASES[source];
  if (!aliases) throw Object.assign(new Error('付款来源不受支持'), { statusCode:400, code:'PAYMENT_SOURCE_UNSUPPORTED' });
  const selected = Object.fromEntries(Object.entries(aliases).map(([key,candidates]) => [key, findHeader(parsed.headers,candidates)]));
  const refundFields = refundHeaders(parsed.headers);
  const a1Prices = parseRuleList(priceRoleRules.a1);
  const a2Prices = parseRuleList(priceRoleRules.a2);
  const configured = a1Prices.size > 0 || a2Prices.size > 0;
  const counts = { totalRows:parsed.rows.length, matchingCandidateRows:0, needsManualRows:0, groupEntryClueRows:0, phoneClueRows:0, nameClueRows:0, priceClueRows:0, priceUnclassifiedRows:0, possibleRefundRows:0, a1CandidateRows:0, a2CandidateRows:0 };
  for (const row of parsed.rows) {
    const namePresent = hasValue(valueAt(row,selected.recipientName));
    const phonePresent = validPhone(valueAt(row,selected.phone));
    const occurredAtPresent = validDate(valueAt(row,selected.occurredAt));
    const cents = priceCents(valueAt(row,selected.amount));
    const refund = possibleRefund(row,refundFields);
    const role = cents !== null && a1Prices.has(cents) ? 'a1' : cents !== null && a2Prices.has(cents) ? 'a2' : null;
    if (namePresent) counts.nameClueRows += 1;
    if (phonePresent) counts.phoneClueRows += 1;
    if (occurredAtPresent) counts.groupEntryClueRows += 1;
    if (cents !== null) counts.priceClueRows += 1;
    if (refund) counts.possibleRefundRows += 1;
    if (role === 'a1') counts.a1CandidateRows += 1;
    if (role === 'a2') counts.a2CandidateRows += 1;
    if (cents === null || !role) counts.priceUnclassifiedRows += 1;
    const matchable = namePresent || phonePresent;
    if (matchable) counts.matchingCandidateRows += 1;
    const amountReady = source === 'wechat_shop_order' ? Boolean(role) : cents !== null;
    if (!matchable || !occurredAtPresent || !phonePresent || !namePresent || !amountReady || refund) counts.needsManualRows += 1;
  }
  const recognizedFields = Object.entries(selected).filter(([,header])=>Boolean(header)).map(([key])=>SAFE_LABELS[source][key]);
  if (refundFields.length) recognizedFields.push('退款/售后提示');
  return {
    kind: 'payment_clue_summary', source, recognizedFields,
    ignoredColumnCount: Math.max(0,parsed.headers.length-new Set(Object.values(selected).filter(Boolean)).size-refundFields.length),
    pricingRulesConfigured: configured,
    counts,
    safeguards: { rawValuesReturned:false, rawHeadersReturned:false, rowsReturned:false, determinesMembershipAlone:false, publicDirectoryMutationAllowed:false }
  };
}

module.exports = { WECHAT_SHOP_TEMPLATE_HEADERS, MERCHANT_RECEIPT_TEMPLATE_HEADERS, MANUAL_TRANSFER_TEMPLATE_HEADERS, previewPaymentClueCsv, priceCents };
