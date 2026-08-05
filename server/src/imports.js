'use strict';

const KNOWLEDGE_DIRECTORIES = {
  usage_guide: { label: '使用说明', destination: 'knowledge_base', resourceType: 'usage_guide' },
  member_directory: { label: '会员名册', destination: 'member_directory', accessLevel: 'admin_only' },
  fundraising_connections: { label: '融资资源对接', destination: 'demand_center', demandType: 'fundraising' },
  recruitment: { label: '招聘专区', destination: 'demand_center', demandType: 'recruitment' },
  activity_notices: { label: '活动发布通知', destination: 'activity_center' },
  meeting_replays: { label: '历史线上回放', destination: 'knowledge_base', resourceType: 'meeting_replay' },
  group_digests: { label: '群聊精华', destination: 'knowledge_base', resourceType: 'group_digest' },
  industry_reports: { label: '行业报告', destination: 'knowledge_base', resourceType: 'industry_report' },
  books: { label: '书籍资源', destination: 'knowledge_base', resourceType: 'book' },
  data_files_tools: { label: '常用数据源/文件/工具', destination: 'knowledge_base', resourceType: 'tool', allowedResourceTypes: ['data_source', 'tool'] }
};
const ACCESS_LEVELS = ['active_member', 'selected_member', 'admin_only'];
const MIGRATION_STATUSES = ['pending', 'ready', 'skip'];
const GROUP_STATUSES = ['in_group', 'left', 'removed', 'unknown'];
const DANGEROUS_HEADERS = /(password|secret|token|app_?secret|payment_?key|private_?key|openid|unionid|id_?card|bank_?card|meeting_?link)/i;

function parseCsv(input) {
  const text = String(input || '').replace(/^\uFEFF/, '');
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (quoted) throw new Error('CSV 存在未闭合的引号');
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  const nonEmpty = rows.filter(r => r.some(v => v.trim()));
  if (!nonEmpty.length) return { headers: [], rows: [] };
  const headers = nonEmpty[0].map(v => v.trim());
  if (new Set(headers).size !== headers.length) throw new Error('CSV 表头存在重复字段');
  return { headers, rows: nonEmpty.slice(1).map(values => Object.fromEntries(headers.map((h, i) => [h, (values[i] || '').trim()]))) };
}

function isUnsafeCell(value) { return /^[=+@]/.test(String(value || '').trim()) || /^-\D/.test(String(value || '').trim()); }
function isIsoDate(value) { return /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) && !Number.isNaN(Date.parse(value)); }
function baseHeaderErrors(headers, allowed) {
  const errors = [];
  const dangerous = headers.filter(h => DANGEROUS_HEADERS.test(h));
  const unknown = headers.filter(h => !allowed.includes(h));
  if (dangerous.length) errors.push(`包含禁止导入的敏感字段：${dangerous.join('、')}`);
  if (unknown.length) errors.push(`包含未知字段：${unknown.join('、')}`);
  return errors;
}
function mappedRows(parsed, mapping = {}) {
  return parsed.rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [mapping[key] || key, value])));
}

const knowledgeFields = ['title','summary','source_directory','type','tags','access_level','source_url','attachment_ref','published_at','migration_status'];
function validateKnowledgeRow(row, index) {
  const errors = []; const warnings = [];
  for (const field of ['title','summary','source_directory','type','access_level','migration_status']) if (!row[field]) errors.push(`${field} 不能为空`);
  const directory = KNOWLEDGE_DIRECTORIES[row.source_directory];
  if (row.source_directory && !directory) errors.push('source_directory 不在十类目录中');
  const expectedTypes = directory?.allowedResourceTypes || [directory?.resourceType || directory?.demandType || directory?.destination];
  if (directory && row.type && !expectedTypes.includes(row.type)) errors.push(`type 与目录不匹配，应为 ${expectedTypes.join(' 或 ')}`);
  if (row.access_level && !ACCESS_LEVELS.includes(row.access_level)) errors.push('access_level 无效');
  if (directory?.accessLevel && row.access_level !== directory.accessLevel) errors.push('会员名册只能使用 admin_only 权限导入');
  if (!row.source_url && !row.attachment_ref) errors.push('source_url 与 attachment_ref 至少填写一项');
  if (row.source_url && !/^https:\/\//i.test(row.source_url)) errors.push('source_url 必须是 HTTPS 链接');
  if (row.published_at && !isIsoDate(row.published_at)) errors.push('published_at 必须是有效日期');
  if (row.migration_status && !MIGRATION_STATUSES.includes(row.migration_status)) errors.push('migration_status 无效');
  for (const [key, value] of Object.entries(row)) if (isUnsafeCell(value)) errors.push(`${key} 疑似 CSV 公式，已拒绝`);
  if (directory && directory.destination !== 'knowledge_base') warnings.push(`该目录应迁移到${directory.destination}，不能直接上架知识库`);
  return { index, valid: errors.length === 0, errors, warnings, normalized: { ...row, tags: row.tags ? row.tags.split('|').map(x => x.trim()).filter(Boolean) : [], destination: directory?.destination, resourceType: directory?.resourceType } };
}
function previewKnowledgeCsv(csv, mapping = {}) {
  const parsed = parseCsv(csv); const mapped = mappedRows(parsed, mapping);
  const headers = parsed.headers.map(h => mapping[h] || h);
  const dangerous = parsed.headers.filter(h => DANGEROUS_HEADERS.test(h));
  const headerErrors = [...(dangerous.length ? [`原始表头包含禁止导入的敏感字段：${dangerous.join('、')}`] : []), ...baseHeaderErrors(headers, knowledgeFields)];
  return { kind: 'knowledge', headers, headerErrors: [...new Set(headerErrors)], results: mapped.map(validateKnowledgeRow) };
}

const memberOrderFields = ['phone','wechat_operator_note','historical_price_cents','discount_reason','membership_start','membership_end','group_status','import_batch'];
function validateMemberOrderRow(row, index) {
  const errors = []; const warnings = [];
  for (const field of ['phone','wechat_operator_note','historical_price_cents','membership_start','membership_end','group_status','import_batch']) if (!row[field]) errors.push(`${field} 不能为空`);
  if (row.phone && !/^1[3-9]\d{9}$/.test(row.phone)) errors.push('phone 不是有效的 11 位中国大陆手机号');
  if (row.historical_price_cents && (!/^\d+$/.test(row.historical_price_cents) || Number(row.historical_price_cents) <= 0)) errors.push('historical_price_cents 必须是正整数分');
  if (row.membership_start && !isIsoDate(row.membership_start)) errors.push('membership_start 必须是有效日期');
  if (row.membership_end && !isIsoDate(row.membership_end)) errors.push('membership_end 必须是有效日期');
  if (isIsoDate(row.membership_start) && isIsoDate(row.membership_end) && new Date(row.membership_end) <= new Date(row.membership_start)) errors.push('membership_end 必须晚于 membership_start');
  if (row.group_status && !GROUP_STATUSES.includes(row.group_status)) errors.push('group_status 无效');
  if (row.wechat_operator_note?.length > 500) errors.push('wechat_operator_note 超过 500 字');
  for (const [key, value] of Object.entries(row)) if (key !== 'phone' && isUnsafeCell(value)) errors.push(`${key} 疑似 CSV 公式，已拒绝`);
  if (!row.discount_reason) warnings.push('discount_reason 未填写，将按无优惠导入');
  const { phone, wechat_operator_note, ...safe } = row;
  return { index, valid: errors.length === 0, errors, warnings, normalized: { ...safe, phonePresent: Boolean(phone), operatorNotePresent: Boolean(wechat_operator_note) }, protected: { phone, wechat_operator_note } };
}
function previewMemberOrdersCsv(csv, mapping = {}) {
  const parsed = parseCsv(csv); const mapped = mappedRows(parsed, mapping);
  const headers = parsed.headers.map(h => mapping[h] || h);
  const dangerous = parsed.headers.filter(h => DANGEROUS_HEADERS.test(h));
  const headerErrors = [...(dangerous.length ? [`原始表头包含禁止导入的敏感字段：${dangerous.join('、')}`] : []), ...baseHeaderErrors(headers, memberOrderFields)];
  return { kind: 'member_order', headers, headerErrors: [...new Set(headerErrors)], results: mapped.map(validateMemberOrderRow) };
}

const shopOrderFields = ['order_placed_at','order_status','recipient_phone','actual_paid_cents','collected_cents','payment_at','product_name','refund_cents','source_batch'];
const SHOP_STATUSES = ['paid','completed','partial_refund','cancelled','refunded','pending'];
function validateShopOrderRow(row, index, options = {}) {
  const errors = []; const warnings = [];
  for (const field of ['order_placed_at','order_status','recipient_phone','actual_paid_cents','collected_cents','product_name','refund_cents','source_batch']) if (!row[field]) errors.push(`${field} 不能为空`);
  if (row.recipient_phone && !/^1[3-9]\d{9}$/.test(row.recipient_phone)) errors.push('recipient_phone 格式无效');
  for (const field of ['actual_paid_cents','collected_cents','refund_cents']) if (row[field] && !/^\d+$/.test(row[field])) errors.push(`${field} 必须是非负整数分`);
  for (const field of ['order_placed_at','payment_at']) if (row[field] && !isIsoDate(row[field])) errors.push(`${field} 必须是有效日期时间`);
  if (row.order_status && !SHOP_STATUSES.includes(row.order_status)) errors.push('order_status 无效，需先映射为标准状态');
  for (const [key, value] of Object.entries(row)) if (key !== 'recipient_phone' && isUnsafeCell(value)) errors.push(`${key} 疑似 CSV 公式，已拒绝`);
  const netPositive = /^\d+$/.test(row.collected_cents || '') && /^\d+$/.test(row.refund_cents || '') && Number(row.collected_cents) > Number(row.refund_cents);
  const excludedByStatus = ['cancelled','refunded','pending'].includes(row.order_status);
  const hasProductRules = Array.isArray(options.eligibleProducts) && options.eligibleProducts.length > 0;
  const productMatched = hasProductRules ? options.eligibleProducts.includes(row.product_name) : null;
  const evidenceCandidate = errors.length === 0 && !excludedByStatus && netPositive && productMatched !== false && Boolean(row.payment_at || row.order_placed_at);
  if (excludedByStatus) warnings.push('订单状态不构成有效付款证据，已排除');
  if (!netPositive && !excludedByStatus) warnings.push('退款后净收款不为正，已排除');
  if (productMatched === false) warnings.push('商品未命中本批次会籍产品规则，已排除');
  if (productMatched === null) warnings.push('会籍产品规则尚未配置，只能进入人工复核候选');
  if (row.order_status === 'partial_refund' && netPositive) warnings.push('部分退款订单必须人工复核产品规则和剩余金额');
  const { recipient_phone, actual_paid_cents, collected_cents, refund_cents, payment_at, order_placed_at, product_name, ...safe } = row;
  return { index, valid: errors.length === 0, disposition: evidenceCandidate ? 'needs_human_review' : 'excluded', errors, warnings, normalized: { ...safe, phonePresent: Boolean(recipient_phone), paymentTimePresent: Boolean(payment_at || order_placed_at), productNamePresent: Boolean(product_name), productRuleStatus: productMatched === null ? 'pending_configuration' : (productMatched ? 'matched' : 'not_matched'), netPositive, evidenceCandidate, determinesMembershipAlone: false }, protected: { recipient_phone, actual_paid_cents, collected_cents, refund_cents, payment_at, order_placed_at, product_name } };
}
function previewShopOrdersCsv(csv, mapping = {}, options = {}) {
  const parsed = parseCsv(csv); const mapped = mappedRows(parsed, mapping).map(row => ({ ...row, order_status: options.statusMapping?.[row.order_status] || row.order_status })); const headers = parsed.headers.map(h => mapping[h] || h);
  const dangerous = parsed.headers.filter(h => DANGEROUS_HEADERS.test(h));
  const headerErrors = [...(dangerous.length ? [`原始表头包含禁止导入的敏感字段：${dangerous.join('、')}`] : []), ...baseHeaderErrors(headers, shopOrderFields)];
  return { kind: 'shop_order_evidence', headers, headerErrors: [...new Set(headerErrors)], results: mapped.map((row,index)=>validateShopOrderRow(row,index,options)) };
}

const voluntaryDirectoryFields = ['member_reference','public_display_name','organization','industry','interests','investment_stage','city','expertise','bio','public_display_consent','contact_mode','source_sheet','migration_status'];
function validateVoluntaryDirectoryRow(row, index) {
  const errors = []; const warnings = [];
  for (const field of ['member_reference','public_display_name','industry','public_display_consent','contact_mode','source_sheet','migration_status']) if (!row[field]) errors.push(`${field} 不能为空`);
  if (!['yes','no','withdrawn'].includes(row.public_display_consent)) errors.push('public_display_consent 无效');
  if (row.contact_mode !== 'request_only') errors.push('contact_mode 必须为 request_only，联系方式不能自动公开');
  if (row.migration_status && !MIGRATION_STATUSES.includes(row.migration_status)) errors.push('migration_status 无效');
  for (const [key, value] of Object.entries(row)) if (isUnsafeCell(value)) errors.push(`${key} 疑似 CSV 公式，已拒绝`);
  const eligibleForReview = errors.length === 0 && row.public_display_consent === 'yes' && row.migration_status === 'ready';
  if (row.public_display_consent !== 'yes') warnings.push('未明确同意公开，不进入公开名册审核');
  return { index, valid: errors.length === 0, disposition: eligibleForReview ? 'needs_human_review' : 'excluded', errors, warnings, normalized: { ...row, eligibleForReview, reviewStatus: 'pending', crmSyncAllowed: false } };
}
function previewVoluntaryDirectoryCsv(csv, mapping = {}) {
  const parsed = parseCsv(csv); const mapped = mappedRows(parsed, mapping); const headers = parsed.headers.map(h => mapping[h] || h);
  return { kind: 'voluntary_directory', headers, headerErrors: baseHeaderErrors(headers, voluntaryDirectoryFields), results: mapped.map(validateVoluntaryDirectoryRow) };
}

module.exports = { KNOWLEDGE_DIRECTORIES, knowledgeFields, memberOrderFields, shopOrderFields, voluntaryDirectoryFields, parseCsv, validateKnowledgeRow, validateMemberOrderRow, validateShopOrderRow, validateVoluntaryDirectoryRow, previewKnowledgeCsv, previewMemberOrdersCsv, previewShopOrdersCsv, previewVoluntaryDirectoryCsv };
