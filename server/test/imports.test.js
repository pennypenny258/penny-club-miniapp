'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { KNOWLEDGE_DIRECTORIES, parseCsv, previewKnowledgeCsv, previewMemberOrdersCsv, previewCrmVerificationCsv, previewShopOrdersCsv, previewVoluntaryDirectoryCsv } = require('../src/imports');

test('CSV parser supports quoted commas and escaped quotes', () => {
  const parsed = parseCsv('title,summary\n"报告,第一期","含""引号"""\n');
  assert.equal(parsed.rows[0].title, '报告,第一期');
  assert.equal(parsed.rows[0].summary, '含"引号"');
});

test('CSV parser rejects hidden extra columns and mapped duplicate headers',()=>{
  assert.throws(()=>parseCsv('a,b\n1,2,3'),/列数/);
  const csv='internal_member_ref,contact_match_token,crm_verification_status,membership_start,membership_end,group_status,evidence_note,migration_status\nREF,X,verified,2026-01-01,2027-01-01,in_group,,ready';
  const result=previewCrmVerificationCsv(csv,{internal_member_ref:'contact_match_token'});
  assert.match(result.headerErrors.join(' '),/重复字段/);
});

test('all ten Feishu source directories have a routed destination', () => {
  assert.equal(Object.keys(KNOWLEDGE_DIRECTORIES).length, 10);
  for (const [source, rule] of Object.entries(KNOWLEDGE_DIRECTORIES)) {
    const type = rule.allowedResourceTypes?.[0] || rule.resourceType || rule.demandType || rule.destination;
    const access = rule.accessLevel || 'active_member';
    const csv = `title,summary,source_directory,type,tags,access_level,source_url,attachment_ref,published_at,migration_status\n示例,摘要,${source},${type},标签,${access},https://example.invalid/source,,2026-08-01,ready`;
    const result = previewKnowledgeCsv(csv);
    assert.equal(result.headerErrors.length, 0, source);
    assert.equal(result.results[0].valid, true, source);
    assert.equal(result.results[0].normalized.destination, rule.destination, source);
  }
});

test('knowledge preview rejects formula injection and sensitive headers', () => {
  const csv = 'title,summary,source_directory,type,tags,access_level,source_url,attachment_ref,published_at,migration_status,app_secret\n=cmd,摘要,industry_reports,industry_report,,active_member,https://example.invalid/source,,2026-08-01,ready,secret';
  const result = previewKnowledgeCsv(csv);
  assert.match(result.headerErrors.join(' '), /禁止导入的敏感字段/);
  assert.match(result.results[0].errors.join(' '), /CSV 公式/);
});

test('member order preview validates required fields, dates and group status', () => {
  const syntheticPhone = ['1','38','0000','8000'].join('');
  const good = `phone,wechat_operator_note,historical_price_cents,discount_reason,membership_start,membership_end,group_status,import_batch\n${syntheticPhone},已核验,199900,早期会员,2025-08-01,2026-08-01,in_group,BATCH-1`;
  assert.equal(previewMemberOrdersCsv(good).results[0].valid, true);
  const bad = 'phone,wechat_operator_note,historical_price_cents,discount_reason,membership_start,membership_end,group_status,import_batch\n123,=IMPORT(),-1,,2026-08-01,2025-08-01,inside,';
  const errors = previewMemberOrdersCsv(bad).results[0].errors.join(' ');
  assert.match(errors, /11 位/); assert.match(errors, /正整数分/); assert.match(errors, /晚于/); assert.match(errors, /group_status/); assert.match(errors, /CSV 公式/);
});

test('header mapping accepts safe aliases but cannot hide dangerous source columns', () => {
  const syntheticPhone = ['1','38','0000','8000'].join('');
  const csv = `手机号,备注,价格,优惠,开始,结束,群状态,批次,private_key\n${syntheticPhone},已核验,199900,,2025-08-01,2026-08-01,in_group,B1,x`;
  const mapping = { 手机号:'phone',备注:'wechat_operator_note',价格:'historical_price_cents',优惠:'discount_reason',开始:'membership_start',结束:'membership_end',群状态:'group_status',批次:'import_batch',private_key:'discount_reason' };
  assert.match(previewMemberOrdersCsv(csv, mapping).headerErrors.join(' '), /禁止导入的敏感字段/);
});

test('distributed CSV templates are valid and contain no real personal data', () => {
  const root = path.join(__dirname, '..', '..');
  const knowledge = previewKnowledgeCsv(fs.readFileSync(path.join(root, 'templates', 'feishu-knowledge-import.csv'), 'utf8'));
  const orders = previewMemberOrdersCsv(fs.readFileSync(path.join(root, 'templates', 'historical-member-orders.csv'), 'utf8'));
  assert.equal(knowledge.results.length, 10);
  assert.equal(knowledge.results.every(x => x.valid), true);
  assert.equal(new Set(knowledge.results.map(x => x.normalized.source_directory)).size, 10);
  assert.equal(orders.results.length, 0);
  assert.equal(orders.headers.includes('phone'), true);
  const shop = previewShopOrdersCsv(fs.readFileSync(path.join(root, 'templates', 'wechat-shop-order-evidence.csv'), 'utf8'));
  const directory = previewVoluntaryDirectoryCsv(fs.readFileSync(path.join(root, 'templates', 'voluntary-directory-import.csv'), 'utf8'));
  const crm = previewCrmVerificationCsv(fs.readFileSync(path.join(root, 'templates', 'internal-crm-verification.csv'), 'utf8'));
  assert.equal(shop.results.length, 0); assert.equal(directory.results.length, 0); assert.equal(crm.results.length, 0);
});

test('shop orders are only payment evidence candidates and sensitive payment fields are not echoed', () => {
  const header = 'order_placed_at,order_status,recipient_phone,actual_paid_cents,collected_cents,payment_at,product_name,refund_cents,source_batch';
  const syntheticPhone = ['1','38','0000','8000'].join('');
  const paid = previewShopOrdersCsv(`${header}\n2026-07-01,paid,${syntheticPhone},10000,10000,2026-07-01,会籍产品,0,B1`).results[0];
  assert.equal(paid.disposition, 'needs_human_review'); assert.equal(paid.normalized.determinesMembershipAlone, false);
  for (const field of ['recipient_phone','actual_paid_cents','collected_cents','refund_cents','payment_at','order_placed_at','product_name']) assert.equal(field in paid.normalized, false);
  const refunded = previewShopOrdersCsv(`${header}\n2026-07-01,refunded,${syntheticPhone},10000,10000,2026-07-01,会籍产品,10000,B1`).results[0];
  assert.equal(refunded.disposition, 'excluded');
});

test('shop status and product rules are supplied by the operator', () => {
  const header = 'order_placed_at,order_status,recipient_phone,actual_paid_cents,collected_cents,payment_at,product_name,refund_cents,source_batch';
  const syntheticPhone = ['1','38','0000','8000'].join('');
  const csv = `${header}\n2026-07-01,完成状态,${syntheticPhone},10000,10000,2026-07-01,产品代号A,0,B1`;
  const accepted = previewShopOrdersCsv(csv, {}, { statusMapping:{完成状态:'completed'},eligibleProducts:['产品代号A'] }).results[0];
  assert.equal(accepted.disposition, 'needs_human_review'); assert.equal(accepted.normalized.productRuleStatus, 'matched');
  const excluded = previewShopOrdersCsv(csv, {}, { statusMapping:{完成状态:'completed'},eligibleProducts:['其他产品'] }).results[0];
  assert.equal(excluded.disposition, 'excluded'); assert.equal(excluded.normalized.productRuleStatus, 'not_matched');
});

test('voluntary directory requires separate consent and request-only contact mode', () => {
  const header = 'member_reference,public_display_name,organization,industry,interests,investment_stage,city,expertise,bio,public_display_consent,contact_mode,source_sheet,migration_status';
  const row = 'REF-A,公开别名,演示机构,科技,投资,成长期,示例城市,研究,公开简介,yes,request_only,自愿登记表,ready';
  const accepted = previewVoluntaryDirectoryCsv(`${header}\n${row}`).results[0];
  assert.equal(accepted.disposition, 'needs_human_review'); assert.equal(accepted.normalized.crmSyncAllowed, false);
  const noConsent = previewVoluntaryDirectoryCsv(`${header}\nREF-B,公开别名,演示机构,科技,投资,成长期,示例城市,研究,公开简介,no,request_only,自愿登记表,ready`).results[0];
  assert.equal(noConsent.disposition, 'excluded');
  const withContact = previewVoluntaryDirectoryCsv(`${header},联系方式\n${row},contact`).headerErrors;
  assert.match(withContact.join(' '), /未知字段/);
});
