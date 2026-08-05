'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { previewPaymentClueCsv } = require('../src/payment-clue-import');

test('realistic WeChat shop headers read only four clue categories and silently ignore other columns', () => {
  const headers = ['订单编号','收件人姓名','收件人手机','订单发货时间','商品实际价格(单件)','商品实际价格(总共)','订单状态','买家留言','收货地址','物流单号','退款状态'];
  const phone = ['1','38','0000','8000'].join('');
  const csv = `${headers.join(',')}\n匿名订单号,匿名收件人,${phone},2026-08-01,1999,1999,已完成,匿名备注,匿名地址,匿名物流号,未退款`;
  const preview = previewPaymentClueCsv(csv,{source:'wechat_shop_order',priceRoleRules:{a1:'1999',a2:'2999'}});
  assert.deepEqual(preview.recognizedFields,['收件人姓名','订单发货时间','收件人手机号','商品价格','退款/售后提示']);
  assert.equal(preview.ignoredColumnCount,6);
  assert.equal(preview.counts.totalRows,1);
  assert.equal(preview.counts.matchingCandidateRows,1);
  assert.equal(preview.counts.groupEntryClueRows,1);
  assert.equal(preview.counts.a1CandidateRows,1);
  assert.equal(preview.counts.needsManualRows,0);
  const safe = JSON.stringify(preview);
  for (const forbidden of ['匿名订单号','匿名收件人',phone,'1999','匿名备注','匿名地址','匿名物流号','订单编号','收货地址']) assert.equal(safe.includes(forbidden),false,forbidden);
  assert.equal(preview.safeguards.determinesMembershipAlone,false);
  assert.equal(preview.safeguards.publicDirectoryMutationAllowed,false);
});

test('missing shop clues become row-level manual counts without blocking the batch', () => {
  const csv = '收件人姓名,收件人手机号,订单发货时间,商品价格(单件)\n匿名甲,,,\n,13800008000,2026-08-01,2999';
  const preview = previewPaymentClueCsv(csv,{source:'wechat_shop_order',priceRoleRules:{a1:'1999',a2:'2999'}});
  assert.equal(preview.counts.totalRows,2);
  assert.equal(preview.counts.matchingCandidateRows,2);
  assert.equal(preview.counts.needsManualRows,2);
  assert.equal(preview.counts.a2CandidateRows,1);
  assert.equal(preview.counts.priceUnclassifiedRows,1);
});

test('refund columns are optional and only produce a safe aggregate candidate count', () => {
  const base = previewPaymentClueCsv('收件人姓名,订单发货时间,收件人手机号,商品价格(单件)\n匿名甲,2026-08-01,13800008000,1999',{source:'wechat_shop_order',priceRoleRules:{a1:'1999'}});
  assert.equal(base.counts.possibleRefundRows,0);
  const refund = previewPaymentClueCsv('收件人姓名,订单发货时间,收件人手机号,商品价格(单件),退款状态\n匿名甲,2026-08-01,13800008000,1999,已退款',{source:'wechat_shop_order',priceRoleRules:{a1:'1999'}});
  assert.equal(refund.counts.possibleRefundRows,1);
  assert.equal(refund.counts.needsManualRows,1);
});

test('merchant receipts and manual transfers use independent minimal aliases', () => {
  const merchant=previewPaymentClueCsv('付款人姓名,支付时间,付款人手机号,支付金额,商户订单号\n匿名甲,2026-08-01,13800008000,100,匿名订单',{source:'wechat_merchant_receipt'});
  assert.deepEqual(merchant.recognizedFields,['付款人姓名','支付时间','付款人手机号','支付金额']);
  assert.equal(merchant.counts.needsManualRows,0);
  const manual=previewPaymentClueCsv('成员姓名,转账时间,手机号,转账金额,内部备注\n匿名乙,2026-08-02,13800008000,200,匿名备注',{source:'manual_transfer'});
  assert.deepEqual(manual.recognizedFields,['成员姓名','转账时间','手机号','转账金额']);
  assert.equal(manual.counts.needsManualRows,0);
});
