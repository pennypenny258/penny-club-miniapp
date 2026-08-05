'use strict';

const ROLE_PERMISSIONS=Object.freeze({
  system_admin:Object.freeze(['admin.role.manage','admin.session.revoke','admin.readiness.read','resource.manage','activity.manage','demand.manage','audit.read','member_import.stage','member_import.review','member_import.rollback','member_import.materialize.request','member_import.materialize.execute','member_import.materialize.compensate','membership.recompute','directory.publish.approve']),
  operations:Object.freeze(['admin.readiness.read','resource.manage','activity.manage','demand.manage','member_import.stage','member_import.rollback','member_import.materialize.execute']),
  reviewer:Object.freeze(['admin.readiness.read','resource.review','demand.review','member_import.review','member_import.materialize.request','member_import.materialize.compensate','membership.recompute','directory.publish.approve']),
  auditor:Object.freeze(['admin.readiness.read','audit.read'])
});
const HIGH_RISK_PERMISSIONS=new Set(['admin.role.manage','admin.session.revoke','member_import.rollback','member_import.materialize.request','member_import.materialize.execute','member_import.materialize.compensate','membership.recompute','directory.publish.approve']);

function permissionsForRoles(roles){const roleCodes=[...new Set((roles||[]).map(String))];for(const role of roleCodes)if(!Object.hasOwn(ROLE_PERMISSIONS,role))throw new Error('后台角色不在服务端白名单');return [...new Set(roleCodes.flatMap(role=>ROLE_PERMISSIONS[role]))].sort()}
function requirePermission(admin,permission){if(!admin?.verified||!admin.userId||!Array.isArray(admin.permissions)||!admin.permissions.includes(permission)){const error=new Error('后台操作权限不足');error.code='ADMIN_PERMISSION_DENIED';error.statusCode=403;throw error}return true}
function requiresStepUp(permission){return HIGH_RISK_PERMISSIONS.has(permission)}

module.exports={ROLE_PERMISSIONS,HIGH_RISK_PERMISSIONS,permissionsForRoles,requirePermission,requiresStepUp};
