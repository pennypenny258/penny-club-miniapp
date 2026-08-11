'use strict';

const BASELINE=Object.freeze({memberEntitlement:'004_wechat_identity_entitlement',adminAuthorization:'008_admin_session_rbac'});
const REQUIRED_CONTRACTS=Object.freeze({
  entitlementRead:'CloudBaseGatewayRepository.resolveMemberEntitlement(subjectHash)',
  adminSessionRead:'CloudBaseAdminSessionRepository.resolveSession(sessionHash)',
  adminAuthorization:'CloudBaseAdminSessionRepository.reserveAction(...)',
  bindingCandidateWrite:'server-side allowlisted binding candidate operation (not present in 004/008)',
  exactCrmMatch:'server-side minimal CRM match projection (not present in 004/008)',
  identityBindingWrite:'server-side idempotent binding write and entitlement re-evaluation (not present in 004/008)',
  memberSessionRevocation:'persistent member-session revocation adapter (not present in 004/008)'
});

function inspectMemberIdentityIntegration({entitlementRepository,adminSessionRepository,bindingRepository,sessionRevocationStore}={}){
  const ready={
    entitlementRead:entitlementRepository?.kind==='cloudbase_gateway'&&typeof entitlementRepository.resolveMemberEntitlement==='function',
    adminSessionRead:typeof adminSessionRepository?.resolveSession==='function',
    adminAuthorization:typeof adminSessionRepository?.reserveAction==='function',
    bindingCandidateWrite:bindingRepository?.kind==='member_binding_gateway_contract'&&typeof bindingRepository.stageCandidate==='function',
    identityBindingWrite:bindingRepository?.kind==='member_binding_gateway_contract'&&typeof bindingRepository.confirmAndReevaluate==='function',
    memberSessionRevocation:typeof sessionRevocationStore?.isRevoked==='function'
  };
  // 004 exposes only an entitlement read view. It cannot prove that an exact CRM
  // matcher or a durable binding-write adapter exists, so runtime activation stays blocked.
  const blockers=['exactCrmMatch'];for(const [key,value] of Object.entries(ready))if(!value)blockers.push(key);
  return {activated:false,migrationBaseline:BASELINE,ready,blockers:[...new Set(blockers)],requiredContracts:REQUIRED_CONTRACTS,memoryFallback:false,crmWrites:false,routesEnabled:false};
}

module.exports={BASELINE,REQUIRED_CONTRACTS,inspectMemberIdentityIntegration};
