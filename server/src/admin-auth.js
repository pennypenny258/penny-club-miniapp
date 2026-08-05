'use strict';

const ROLE_DEFINITIONS = {
  administrator:{label:'系统管理员',permissions:['*'],note:'负责角色、生产配置和高风险最终操作；不用于日常批量处理。'},
  operator:{label:'运营人员',permissions:['dashboard.read','membership.summary.read','crm.read','crm.manage','payment.read','payment.manage','renewal.manage','directory.read','artifact.metadata.read','content.read','content.review','imports.manage','feishu.manage','activity.read','activity.manage','matching.read','matching.manage','matching.review','audit.read'],note:'处理会员、资料、活动和撮合日常工作，不管理角色或密钥。'},
  reviewer:{label:'审核人员',permissions:['dashboard.read','directory.read','directory.review','artifact.metadata.read','artifact.review','content.read','content.review','matching.read','matching.review'],note:'只处理公开资料、在职材料安全元数据、内容和需求审核；不可读取 CRM 或付款域。'},
  auditor:{label:'审计人员',permissions:['dashboard.read','audit.read','release.read'],note:'只读查看工作台、审计与上线检查，不执行业务变更。'}
};

const READ_COLLECTION_PERMISSIONS = {
  members:'membership.summary.read','membership-decisions':'membership.summary.read','renewal-offers':'membership.summary.read',
  'crm-verifications':'crm.read',orders:'payment.read','payment-evidence':'payment.read',
  'directory-profiles':'directory.read','public-profile-updates':'directory.read','employment-verifications':'artifact.metadata.read',
  resources:'content.read','import-batches':'content.read','import-items':'content.read',
  activities:'activity.read',registrations:'activity.read','notification-jobs':'activity.read',
  demands:'matching.read','ai-reviews':'matching.read',applications:'matching.read','member-connections':'matching.read',
  'audit-logs':'audit.read'
};

function roleFromRequest(req){const requested=String(req.headers['x-demo-role']||'administrator');return ROLE_DEFINITIONS[requested]?requested:'invalid'}
function hasPermission(role,permission){const permissions=ROLE_DEFINITIONS[role]?.permissions||[];return permissions.includes('*')||permissions.includes(permission)}
function permissionForRequest(method,pathname){
  if(pathname==='/api/admin/session'||pathname==='/api/admin/dashboard'||pathname==='/api/admin/operations-readiness')return 'dashboard.read';
  if(pathname.includes('/feishu-'))return method==='GET'?'content.read':'feishu.manage';
  if(pathname.includes('/local-import'))return method==='GET'?'content.read':'imports.manage';
  if(pathname.includes('/imports/')||pathname.includes('/import-items/')||pathname.includes('/import-templates/'))return method==='GET'?'content.read':'imports.manage';
  if(pathname.includes('/public-profile-updates/')||pathname.includes('/directory-profiles/'))return method==='GET'?'directory.read':'directory.review';
  if(pathname.includes('/employment-verifications/'))return method==='GET'?'artifact.metadata.read':'artifact.review';
  if(pathname.includes('/crm-verifications/')||pathname.includes('/members/'))return method==='GET'?'crm.read':'crm.manage';
  if(pathname.includes('/payment-evidence/')||pathname.includes('/renewal-offers/'))return method==='GET'?'payment.read':pathname.includes('renewal-offers')?'renewal.manage':'payment.manage';
  if(pathname.includes('/resources/'))return method==='GET'?'content.read':'content.review';
  if(pathname.includes('/activities/')||pathname.includes('/notification-jobs/'))return method==='GET'?'activity.read':'activity.manage';
  if(pathname.includes('/demands/')||pathname.includes('/applications/')||pathname.includes('/member-connections/'))return method==='GET'?'matching.read':'matching.review';
  if(pathname.includes('/bulk-actions/'))return 'dashboard.read';
  const match=pathname.match(/^\/api\/admin\/([^/]+)$/);if(match&&method==='GET')return READ_COLLECTION_PERMISSIONS[match[1]]||'dashboard.read';
  return 'admin.manage';
}
function authorizeAdmin(req,permission){const role=roleFromRequest(req);if(!hasPermission(role,permission)){const error=new Error('当前后台角色无权执行此操作');error.statusCode=403;error.code='ADMIN_PERMISSION_DENIED';throw error}return {id:`demo-${role}`,role,label:ROLE_DEFINITIONS[role].label,permission}}
function safeSession(req){const role=roleFromRequest(req),definition=ROLE_DEFINITIONS[role];if(!definition){const error=new Error('后台角色无效');error.statusCode=403;throw error}return {role,label:definition.label,note:definition.note,permissions:definition.permissions,authenticationMode:'demo_header_only',productionReady:false}}
function requireHighRiskConfirmation(req,action){if(req.headers['x-admin-confirmation']!==action){const error=new Error('该操作需要再次确认');error.statusCode=428;error.code='HIGH_RISK_CONFIRMATION_REQUIRED';throw error}if(!String(req.headers['idempotency-key']||'').trim()){const error=new Error('该操作需要幂等键以防重复提交');error.statusCode=428;error.code='IDEMPOTENCY_KEY_REQUIRED';throw error}return true}

module.exports={ROLE_DEFINITIONS,READ_COLLECTION_PERMISSIONS,roleFromRequest,hasPermission,permissionForRequest,authorizeAdmin,safeSession,requireHighRiskConfirmation};
