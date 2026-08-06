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
const CRM_VERIFICATION_STATUSES = ['verified', 'needs_review', 'rejected'];
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
  if (nonEmpty.slice(1).some(values => values.length !== headers.length)) throw new Error('CSV 数据行列数与表头不一致');
  return { headers, rows: nonEmpty.slice(1).map(values => Object.fromEntries(headers.map((h, i) => [h, (values[i] || '').trim()]))) };
}

function isUnsafeCell(value) { return /^[=+@]/.test(String(value || '').trim()) || /^-\D/.test(String(value || '').trim()); }
function isIsoDate(value) { return /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) && !Number.isNaN(Date.parse(value)); }
function baseHeaderErrors(headers, allowed, permittedProtected = []) {
  const errors = [];
  if (new Set(headers).size !== headers.length) errors.push('映射后的 CSV 表头存在重复字段');
  const dangerous = headers.filter(h => DANGEROUS_HEADERS.test(h) && !permittedProtected.includes(h));
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

const crmVerificationFields = ['internal_member_ref','contact_match_token','wechat_group_nickname','wechat_id','phone','real_name','remark_name','payment_name','crm_verification_status','membership_start','membership_end','membership_expiry_month','membership_tier','first_group_entry_month','accumulated_group_months','renewal_price_cents','notice_status','latest_notice_month','payment_status','payment_month','group_status','evidence_note','operator_note','migration_status'];
const CRM_SOURCE_ALIASES={昵称:'wechat_group_nickname',群昵称:'wechat_group_nickname',微信群昵称:'wechat_group_nickname',备注名:'remark_name',微信号:'wechat_id',手机号:'phone',手机号码:'phone',真实姓名:'real_name',姓名:'real_name',付款姓名:'payment_name',支付姓名:'payment_name',到期月份:'membership_expiry_month',到期月:'membership_expiry_month',会籍到期月:'membership_expiry_month',会员等级:'membership_tier',会员档位:'membership_tier',首次入群月份:'first_group_entry_month',首次入群月:'first_group_entry_month',累计在群月数:'accumulated_group_months',续费价格:'renewal_price_cents',应付金额:'renewal_price_cents',通知状态:'notice_status',通知日期:'latest_notice_month',最近通知月份:'latest_notice_month',最近通知月:'latest_notice_month',付款状态:'payment_status',付款日期:'payment_month',支付日期:'payment_month',群状态:'group_status',是否在群:'group_status',操作备注:'operator_note',备注:'operator_note'};
const CRM_NOTICE_ALIASES={未通知:'not_notified',尚未通知:'not_notified',待跟进:'follow_up_pending',待续费跟进:'follow_up_pending',已通知:'notified',已通知逾期:'notified_overdue'};
const CRM_PAYMENT_ALIASES={未付:'unpaid',未付款:'unpaid',已付:'paid',已付款:'paid',待核对:'needs_review',待确认:'needs_review'};
const CRM_GROUP_ALIASES={在群:'in_group',仍在群:'in_group',已退群:'left',退群:'left',已移除:'removed',未知:'unknown',待确认:'unknown'};
const CRM_TIER_ALIASES={'天使轮股东':'angel_shareholder','A1轮股东':'a1_shareholder','A1 轮股东':'a1_shareholder','A2轮股东':'a2_shareholder','A2 轮股东':'a2_shareholder','荣誉董事':'honorary_director'};
function validateCrmVerificationRow(row, index) {
  row={...row};const errors = []; const warnings = [];
  for(const field of ['membership_expiry_month','first_group_entry_month','latest_notice_month','payment_month'])if(/^\d{4}-\d{2}-\d{2}/.test(row[field]||''))row[field]=row[field].slice(0,7);
  if(CRM_NOTICE_ALIASES[row.notice_status])row.notice_status=CRM_NOTICE_ALIASES[row.notice_status];
  if(CRM_PAYMENT_ALIASES[row.payment_status])row.payment_status=CRM_PAYMENT_ALIASES[row.payment_status];
  if(CRM_GROUP_ALIASES[row.group_status])row.group_status=CRM_GROUP_ALIASES[row.group_status];
  if(CRM_TIER_ALIASES[row.membership_tier])row.membership_tier=CRM_TIER_ALIASES[row.membership_tier];
  if(!['internal_member_ref','contact_match_token','wechat_group_nickname','remark_name','wechat_id','phone','real_name'].some(field=>row[field]))errors.push('至少需要昵称、备注名、微信号、手机号、真实姓名或内部引用之一作为匹配线索');
  if (row.crm_verification_status && !CRM_VERIFICATION_STATUSES.includes(row.crm_verification_status)) errors.push('crm_verification_status 无效');
  if (row.membership_start && !isIsoDate(row.membership_start)) errors.push('membership_start 必须是有效日期');
  if (row.membership_end && !isIsoDate(row.membership_end)) errors.push('membership_end 必须是有效日期');
  for(const field of ['membership_expiry_month','first_group_entry_month','latest_notice_month','payment_month'])if(row[field]&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(row[field]))errors.push(`${field} 必须为 YYYY-MM`);
  if(row.renewal_price_cents&&!/^\d+$/.test(row.renewal_price_cents))errors.push('renewal_price_cents 必须是非负整数分');
  if(row.accumulated_group_months&&!/^\d+$/.test(row.accumulated_group_months))errors.push('accumulated_group_months 必须是非负整数月');
  if(row.notice_status&&!['not_notified','follow_up_pending','notified','notified_overdue'].includes(row.notice_status))warnings.push('通知状态待人工映射');
  if(row.payment_status&&!['unpaid','paid','needs_review'].includes(row.payment_status))warnings.push('付款状态待人工映射');
  if(row.membership_tier&&!['angel_shareholder','a1_shareholder','a2_shareholder','honorary_director'].includes(row.membership_tier))warnings.push('会员等级待人工映射');
  if (isIsoDate(row.membership_start) && isIsoDate(row.membership_end) && new Date(row.membership_end) <= new Date(row.membership_start)) errors.push('membership_end 必须晚于 membership_start');
  if (row.group_status && !GROUP_STATUSES.includes(row.group_status)) errors.push('group_status 无效');
  if (row.migration_status && !MIGRATION_STATUSES.includes(row.migration_status)) errors.push('migration_status 无效');
  if (row.evidence_note?.length > 500) errors.push('evidence_note 超过 500 字');
  for (const [key, value] of Object.entries(row)) if (isUnsafeCell(value)) errors.push(`${key} 疑似 CSV 公式，已拒绝`);
  const missing=['wechat_group_nickname','wechat_id','phone','real_name'].filter(field=>!row[field]);if(missing.length)warnings.push(`会员主档案待补全 ${missing.length} 项；允许导入后逐项核对`);
  if (row.group_status !== 'in_group' || row.crm_verification_status !== 'verified') warnings.push('该行只能进入人工复核，不能自动激活会籍；未付款也不直接判无效');
  const { internal_member_ref, contact_match_token,wechat_group_nickname,wechat_id,phone,real_name,remark_name,payment_name,evidence_note,operator_note,renewal_price_cents,...safe } = row;
  const honoraryCandidate=row.membership_tier==='honorary_director'||renewal_price_cents==='49900'||renewal_price_cents==='499';
  return { index, valid: errors.length === 0, disposition: errors.length ? 'error' : 'needs_human_review', errors, warnings, normalized: { ...safe, memberReferencePresent:Boolean(internal_member_ref), contactMatchPresent:Boolean(contact_match_token),wechatGroupNicknamePresent:Boolean(wechat_group_nickname),wechatIdPresent:Boolean(wechat_id),phonePresent:Boolean(phone),realNamePresent:Boolean(real_name),remarkNamePresent:Boolean(remark_name),paymentNamePresent:Boolean(payment_name),renewalPricePresent:Boolean(renewal_price_cents),honoraryDirectorCandidate:honoraryCandidate,missingCoreFieldCount:missing.length,evidenceNotePresent:Boolean(evidence_note),operatorNotePresent:Boolean(operator_note), determinesMembershipAlone:false,publicDirectoryMutationAllowed:false }, protected: { internal_member_ref, contact_match_token,wechat_group_nickname,wechat_id,phone,real_name,remark_name,payment_name,evidence_note,operator_note,renewal_price_cents } };
}
function previewCrmVerificationCsv(csv, mapping = {}) {
  const parsed = parseCsv(csv); const combinedMapping=Object.fromEntries(parsed.headers.map(header=>[header,mapping[header]||CRM_SOURCE_ALIASES[header]||header]));const mapped = mappedRows(parsed, combinedMapping); const headers = parsed.headers.map(h => combinedMapping[h]);
  const dangerous = parsed.headers.filter(h => DANGEROUS_HEADERS.test(h) && h!=='contact_match_token');
  const headerErrors = [...(dangerous.length ? [`原始表头包含禁止导入的敏感字段：${dangerous.join('、')}`] : []), ...baseHeaderErrors(headers, crmVerificationFields,['contact_match_token'])];
  return { kind:'crm_verification', headers, headerErrors:[...new Set(headerErrors)], results:mapped.map(validateCrmVerificationRow) };
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

module.exports = { KNOWLEDGE_DIRECTORIES, knowledgeFields, memberOrderFields, crmVerificationFields, shopOrderFields, voluntaryDirectoryFields, parseCsv, validateKnowledgeRow, validateMemberOrderRow, validateCrmVerificationRow, validateShopOrderRow, validateVoluntaryDirectoryRow, previewKnowledgeCsv, previewMemberOrdersCsv, previewCrmVerificationCsv, previewShopOrdersCsv, previewVoluntaryDirectoryCsv };
